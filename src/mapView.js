import maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';

import { BASEMAPS, TERRARIUM_URL } from './basemaps.js';
import { vendorBase } from './vendorPaths.js';
import * as store from './store.js';
import { DrawController } from './drawController.js';
import { processStroke } from './simplify.js';
import { bboxIntersects, bboxOf, nearestOnPolyline, pickFeature, ringsOf } from './geom.js';
import { baseOpacityOf, buildImportedLayers } from './importedStyle.js';
import { SnapIndex, buildGraph, tracePath } from './snapping.js';
import { buildTileLayers, disposeTileSet } from './tiles.js';
import {
  BASE_OPACITY,
  DRAFT_LAYER_IDS,
  DRAFT_SOURCE,
  EDIT_LAYER_IDS,
  EDIT_SOURCE,
  GEOLOGY_LAYER_IDS,
  GEOLOGY_SOURCE,
  draftLayers,
  editLayers,
  geologyLayers,
  unitFillExpr,
  unitOutlineExpr,
  withFeatureAlpha,
} from './geologyStyle.js';
import {
  ORNAMENT_LAYER_IDS,
  addOrnamentImages,
  applyOrnamentStyle,
  ornamentLayers,
} from './ornaments.js';
import {
  STRABO_INTERACTIVE_LAYER_IDS,
  STRABO_LAYER_IDS,
  STRABO_LINES_SOURCE,
  STRABO_OBSERVATIONS_SOURCE,
  STRABO_SOURCES,
  STRABO_STRUCTURES_SOURCE,
  addStraboImages,
  applyStraboFilter,
  applyStraboStyle,
  straboLayers,
} from './strabo/layers.js';
import {
  buildCoincidence,
  collectHandles,
  collectMidpoints,
  deleteVertices,
  findHandle,
  findInsertion,
  insertVertex,
  moveVertices,
} from './vertexEdit.js';

const CONTOUR_LAYER_IDS = ['contour-lines', 'contour-index', 'contour-labels'];

/** Un toque de dedo más lejos que esto del trazo en curso lo da por cerrado. */
const OUTSIDE_TAP_PX = 36;

const BASE = {
  ...BASE_OPACITY,
  'contour-lines': 0.6,
  'contour-index': 0.85,
  'contour-labels': 0.95,
};

const basemapLayerId = (id) => `bm-${id}`;

/** id lógico -> ids de las capas MapLibre que lo representan. */
const importedLayerIds = new Map();
const tileLayerIds = new Map();

function mlIdsFor(layer) {
  if (layer.kind === 'basemap') return [basemapLayerId(layer.id)];
  if (layer.kind === 'contours') return CONTOUR_LAYER_IDS;
  if (layer.kind === 'imported') return importedLayerIds.get(layer.id) || [];
  if (layer.kind === 'tiles') return tileLayerIds.get(layer.id) || [];
  if (layer.kind === 'strabo') return STRABO_LAYER_IDS;
  // Los ornamentos van al final para dibujarse sobre la traza de la falla.
  return [...GEOLOGY_LAYER_IDS, ...ORNAMENT_LAYER_IDS];
}

function applyOpacity(map, id, opacity) {
  const layer = map.getLayer(id);
  if (!layer) return;
  const v = (BASE[id] ?? 1) * opacity;
  // Cada elemento puede llevar su propia opacidad; si no la trae, vale 1, así
  // que la expresión es inocua también para las capas importadas.
  const dataDriven = withFeatureAlpha(v);
  switch (layer.type) {
    case 'raster':
      map.setPaintProperty(id, 'raster-opacity', v);
      break;
    case 'line':
      map.setPaintProperty(id, 'line-opacity', dataDriven);
      break;
    case 'fill':
      map.setPaintProperty(id, 'fill-opacity', dataDriven);
      break;
    case 'symbol':
      map.setPaintProperty(id, 'text-opacity', v);
      map.setPaintProperty(id, 'icon-opacity', dataDriven);
      break;
    case 'circle':
      map.setPaintProperty(id, 'circle-opacity', dataDriven);
      break;
    default:
      break;
  }
}

/**
 * El array de capas del store va de arriba hacia abajo. MapLibre pinta la
 * última capa encima, así que recorremos al revés moviendo cada una al tope.
 */
function applyLayerStack(map, layers) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    for (const id of mlIdsFor(l)) {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, 'visibility', l.visible ? 'visible' : 'none');
      applyOpacity(map, id, l.opacity);
      map.moveLayer(id);
    }
  }
  // El elemento en construcción y las manijas de edición, siempre encima.
  for (const id of [...DRAFT_LAYER_IDS, ...EDIT_LAYER_IDS]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

let demSource = null;
function ensureDemSource() {
  if (demSource) return demSource;
  const DemSource = mlcontour.DemSource || (mlcontour.default && mlcontour.default.DemSource);
  if (!DemSource) throw new Error('maplibre-contour no expone DemSource');
  demSource = new DemSource({
    url: TERRARIUM_URL,
    encoding: 'terrarium',
    maxzoom: 13,
    worker: true,
  });
  demSource.setupMaplibre(maplibregl);
  return demSource;
}

export function createMapView({
  onPointerInfo,
  onContourError,
  onEditMessage,
  onOpenProps,
  onMapTap,
  onStraboFeatureTap,
}) {
  const host = document.getElementById('map-host');
  const container = document.getElementById('map-container');
  const hoverEl = document.getElementById('pen-hover');
  const ringEl = document.getElementById('longpress-ring');
  const snapEl = document.getElementById('snap-marker');
  const lassoEl = document.getElementById('lasso');

  let ready = false;
  let preview = [];
  let lastInfoAt = 0;

  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      // Las fuentes van en vendor/, no en demotiles.maplibre.org: si no, las
      // etiquetas de las curvas de nivel desaparecen en cuanto no hay señal.
      // Se concatena en vez de usar `new URL()` porque MapLibre necesita los
      // marcadores literales y `new URL()` los escaparía.
      glyphs: `${vendorBase()}fonts/{fontstack}/{range}.pbf`,
      sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#10141a' } }],
    },
    center: [-71.35, -37.4],
    zoom: 11.5,
    maxZoom: 20,
    attributionControl: { compact: true },
  });

  // El doble toque de MapLibre choca con los gestos de la app: con un dedo
  // cierra el elemento y con dos deshace, así que su zoom estorba.
  map.doubleClickZoom.disable();

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: 'metric' }), 'bottom-left');
  map.addControl(
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    }),
    'bottom-right',
  );

  map.on('error', (e) => {
    const msg = (e && e.error && e.error.message) || '';
    // Los 404 de teselas en zonas sin cobertura son normales; no ensuciamos.
    if (!/40[34]|Failed to fetch|NetworkError/i.test(msg)) console.warn('[maplibre]', msg || e);
  });

  map.on('load', () => {
    for (const b of BASEMAPS) {
      map.addSource(`bm-src-${b.id}`, {
        type: 'raster',
        tiles: b.tiles,
        tileSize: 256,
        maxzoom: b.maxzoom,
        attribution: b.attribution,
      });
      map.addLayer({
        id: basemapLayerId(b.id),
        type: 'raster',
        source: `bm-src-${b.id}`,
        paint: { 'raster-opacity': 1 },
      });
    }

    // Curvas generadas en el cliente desde terrain-RGB. Si la librería falla,
    // no debe tumbar el mapa entero.
    try {
      const dem = ensureDemSource();
      map.addSource('contours-src', {
        type: 'vector',
        tiles: [
          dem.contourProtocolUrl({
            multiplier: 1,
            thresholds: {
              9: [1000, 2000],
              10: [500, 1000],
              11: [200, 1000],
              12: [100, 500],
              13: [100, 500],
              14: [50, 250],
              15: [20, 100],
            },
            elevationKey: 'ele',
            levelKey: 'level',
            contourLayer: 'contours',
          }),
        ],
        maxzoom: 15,
      });
      map.addLayer({
        id: 'contour-lines',
        type: 'line',
        source: 'contours-src',
        'source-layer': 'contours',
        filter: ['!=', ['get', 'level'], 1],
        paint: { 'line-color': '#8d5b2d', 'line-width': 0.8, 'line-opacity': 0.6 },
      });
      map.addLayer({
        id: 'contour-index',
        type: 'line',
        source: 'contours-src',
        'source-layer': 'contours',
        filter: ['==', ['get', 'level'], 1],
        paint: { 'line-color': '#7a4a1e', 'line-width': 1.5, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: 'contour-labels',
        type: 'symbol',
        source: 'contours-src',
        'source-layer': 'contours',
        filter: ['==', ['get', 'level'], 1],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          // Las curvas de nivel son muy sinuosas: con el ángulo máximo por
          // defecto (25°) MapLibre descartaba TODAS las etiquetas.
          'text-max-angle': 90,
          'symbol-spacing': 150,
          'text-padding': 2,
        },
        paint: {
          'text-color': '#5c3512',
          'text-halo-color': 'rgba(255,255,255,0.9)',
          'text-halo-width': 1.4,
        },
      });
    } catch (err) {
      onContourError(err && err.message ? err.message : String(err));
    }

    map.addSource(GEOLOGY_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    for (const l of geologyLayers()) map.addLayer(l);

    try {
      addOrnamentImages(map);
      for (const l of ornamentLayers(store.getState().ornaments)) map.addLayer(l);
    } catch (err) {
      console.warn('[ornamentos]', err);
    }
    applyUnitColors();

    map.addSource(DRAFT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    for (const l of draftLayers()) map.addLayer(l);

    // StraboSpot: fuentes vacías y capas listas desde el arranque, para que
    // descargar un dataset sea solo un setData y no una recomposición del
    // estilo. Los iconos se rasterizan aparte y pueden llegar después.
    for (const src of STRABO_SOURCES) {
      map.addSource(src, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    for (const l of straboLayers(store.getState().straboStyle)) map.addLayer(l);
    addStraboImages(map).then(() => map.triggerRepaint());
    for (const cat of ['structures', 'observations', 'lines']) {
      applyStraboFilter(map, cat, store.getState().straboFilters[cat]);
    }

    // Ver atributos: solo cuando nadie más está reclamando el toque. Fuera de
    // Navegar, DrawController ya consume el puntero para dibujar o arrastrar,
    // así que este listener nunca compite con esas herramientas — recibe el
    // evento nativo de MapLibre solo cuando pasó libre.
    if (onStraboFeatureTap) {
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: STRABO_INTERACTIVE_LAYER_IDS });
        if (hits.length) onStraboFeatureTap(hits[0], [e.point.x, e.point.y]);
      });
      // Cursor de mano al pasar por encima, como cualquier elemento con el que
      // se puede interactuar: es la única pista de que ahí hay algo que tocar.
      for (const id of STRABO_INTERACTIVE_LAYER_IDS) {
        map.on('mouseenter', id, () => {
          if (store.getState().tool === 'navigate') map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', id, () => {
          if (store.getState().tool === 'navigate') map.getCanvas().style.cursor = '';
        });
      }
    }

    map.addSource(EDIT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    for (const l of editLayers()) map.addLayer(l);

    ready = true;
    applyLayerStack(map, store.getState().layers);
    syncGeology();
    syncStrabo();
    syncDraft();
    collectSnapSources();
    rebuildHandles();
  });

  /** Repinta los polígonos cuando cambian las unidades del usuario. */
  function applyUnitColors() {
    if (!map.getLayer('geology-fill')) return;
    const units = store.getState().units;
    map.setPaintProperty('geology-fill', 'fill-color', unitFillExpr(units));
    for (const c of ['observed', 'inferred', 'covered']) {
      const id = `geology-outline-${c}`;
      if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', unitOutlineExpr(units));
    }
  }

  function syncGeology() {
    if (!ready) return;
    const src = map.getSource(GEOLOGY_SOURCE);
    if (src) src.setData({ type: 'FeatureCollection', features: store.getState().features });
  }

  function syncDraft() {
    if (!ready) return;
    const src = map.getSource(DRAFT_SOURCE);
    if (!src) return;
    const d = store.getState().draft;
    const committed = d ? d.coords : [];
    const all = [...committed, ...preview];
    const out = [];

    if (all.length >= 2) {
      if (d && d.kind === 'polygon' && all.length >= 3) {
        out.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[...all, all[0]]] },
        });
      } else {
        out.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: all },
        });
      }
    }
    // Solo los vértices confirmados llevan marcador; los del trazo son miles.
    for (const c of committed) {
      out.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } });
    }
    src.setData({ type: 'FeatureCollection', features: out });
  }

  const EMPTY_FC = { type: 'FeatureCollection', features: [] };

  /** Vuelca las tres colecciones del dataset de StraboSpot a sus fuentes. */
  function syncStrabo() {
    if (!ready) return;
    const data = store.getState().strabo;
    const put = (id, fc) => {
      const src = map.getSource(id);
      if (src) src.setData(fc || EMPTY_FC);
    };
    put(STRABO_STRUCTURES_SOURCE, data && data.estructuras);
    put(STRABO_OBSERVATIONS_SOURCE, data && data.observacion);
    put(STRABO_LINES_SOURCE, data && data.lineas);
  }

  /** Encuadra el mapa sobre lo que se acaba de traer de StraboSpot. */
  function fitToStrabo() {
    const data = store.getState().strabo;
    if (!data) return;
    const fc = {
      type: 'FeatureCollection',
      features: [
        ...((data.estructuras && data.estructuras.features) || []),
        ...((data.observacion && data.observacion.features) || []),
        ...((data.lineas && data.lineas.features) || []),
      ],
    };
    if (fc.features.length) fitToGeoJSON(fc);
  }

  function syncImported() {
    if (!ready) return;
    const list = store.getState().imported;
    const present = new Set(list.map((l) => l.id));

    for (const [id, ids] of [...importedLayerIds]) {
      if (present.has(id)) continue;
      for (const lid of ids) if (map.getLayer(lid)) map.removeLayer(lid);
      if (map.getSource(`src-${id}`)) map.removeSource(`src-${id}`);
      importedLayerIds.delete(id);
    }

    let added = null;
    for (const l of list) {
      if (importedLayerIds.has(l.id)) continue;
      map.addSource(`src-${l.id}`, { type: 'geojson', data: l.geojson });
      const { layers } = buildImportedLayers({
        id: l.id,
        sourceId: `src-${l.id}`,
        kind: l.kind,
        style: l.style,
      });
      for (const spec of layers) {
        map.addLayer(spec);
        BASE[spec.id] = baseOpacityOf(spec);
      }
      importedLayerIds.set(
        l.id,
        layers.map((s) => s.id),
      );
      if (!added) added = l;
    }

    applyLayerStack(map, store.getState().layers);
    if (added) fitToGeoJSON(added.geojson);
  }

  function syncTileSets() {
    if (!ready) return;
    const list = store.getState().tileSets;
    const present = new Set(list.map((t) => t.id));

    for (const [id, ids] of [...tileLayerIds]) {
      if (present.has(id)) continue;
      for (const lid of ids) if (map.getLayer(lid)) map.removeLayer(lid);
      if (map.getSource(`tiles-src-${id}`)) map.removeSource(`tiles-src-${id}`);
      tileLayerIds.delete(id);
      // Un MBTiles retiene toda la base SQLite en memoria: hay que soltarla.
      disposeTileSet({ id, protocol: 'mbtiles' });
    }

    let added = null;
    for (const t of list) {
      if (tileLayerIds.has(t.id)) continue;
      const { sourceId, source, layers } = buildTileLayers(t);
      map.addSource(sourceId, source);
      for (const spec of layers) {
        map.addLayer(spec);
        BASE[spec.id] =
          spec.type === 'raster'
            ? 1
            : spec.type === 'fill'
              ? spec.paint['fill-opacity']
              : spec.type === 'circle'
                ? spec.paint['circle-opacity']
                : spec.paint['line-opacity'];
      }
      tileLayerIds.set(
        t.id,
        layers.map((l) => l.id),
      );
      if (!added) added = t;
    }

    applyLayerStack(map, store.getState().layers);
    if (added && added.bounds) {
      map.fitBounds(
        [
          [added.bounds[0], added.bounds[1]],
          [added.bounds[2], added.bounds[3]],
        ],
        { padding: 40, maxZoom: added.maxzoom ?? 16, duration: 700 },
      );
    }
  }

  function fitToGeoJSON(fc) {
    const bounds = new maplibregl.LngLatBounds();
    let any = false;
    const visit = (c) => {
      if (typeof c[0] === 'number') {
        if (Number.isFinite(c[0]) && Number.isFinite(c[1])) {
          bounds.extend(c);
          any = true;
        }
      } else for (const x of c) visit(x);
    };
    for (const f of fc.features) if (f.geometry) visit(f.geometry.coordinates);
    if (any) map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 700 });
  }

  const toLngLat = (p) => {
    const ll = map.unproject(p);
    return [ll.lng, ll.lat];
  };

  /* ---------- snapping y trazado ---------- */

  const snapIndex = new SnapIndex();
  let snapSources = [];
  let snapGraph = null;
  let indexDirty = true;
  /**
   * Punto desde el que trazará el próximo toque, en lng/lat.
   *
   * Guardarlo como resultado de snap —con su índice de segmento— era el origen
   * de que el trace "a veces funcione y a veces no": el índice se reconstruye
   * en cuanto cambia el borrador o se mueve el mapa, y ese número pasa a
   * apuntar a otro segmento cualquiera, así que el camino salía desde un lugar
   * arbitrario, a menudo el extremo opuesto. En lng/lat el ancla no caduca: se
   * vuelve a proyectar y a enganchar contra el índice vigente.
   */
  let traceAnchor = null;
  let previewKind = null; // 'freehand' | 'trace'
  let lastPreviewKey = null;
  let snapExclude = null;

  /**
   * Anillos candidatos en lng/lat, con su bbox. Se recolectan cuando cambian
   * los datos; proyectarlos a pantalla se hace aparte, al reindexar.
   */
  function collectSnapSources() {
    const st = store.getState();
    const out = [];
    // Al arrastrar un vértice, su propia geometría sale del índice: si no,
    // el vértice se engancharía a su posición de origen y no habría forma de
    // hacer un ajuste pequeño.
    const skip = snapExclude;
    const push = (geometry) => {
      for (const ring of ringsOf(geometry)) {
        if (ring.coords.length < 2) continue;
        out.push({ coords: ring.coords, closed: ring.closed, bbox: bboxOf(ring.coords) });
      }
    };

    const geology = st.layers.find((l) => l.kind === 'geology');
    if (!geology || geology.visible) {
      for (const f of st.features) {
        if (skip && skip.has(f.properties.id)) continue;
        push(f.geometry);
      }
    }

    for (const l of st.imported) {
      const entry = st.layers.find((x) => x.id === l.id);
      if (entry && !entry.visible) continue;
      for (const f of l.geojson.features) if (f.geometry) push(f.geometry);
    }

    // El elemento en curso también es snapeable, para poder cerrar un polígono
    // sobre su primer vértice. Se excluye el ÚLTIMO vértice: si no, cada toque
    // cercano al anterior se pegaría a él y generaría segmentos de longitud 0.
    // Va marcado como borrador porque el grafo del trace lo deja fuera.
    if (st.draft && st.draft.coords.length > 2) {
      const coords = st.draft.coords.slice(0, -1);
      out.push({ coords, closed: false, bbox: bboxOf(coords), draft: true });
    }

    snapSources = out;
    indexDirty = true;
  }

  function rebuildIndex() {
    snapIndex.clear();
    snapGraph = null;
    const b = map.getBounds();
    const padX = 0.25 * (b.getEast() - b.getWest());
    const padY = 0.25 * (b.getNorth() - b.getSouth());
    const view = [
      b.getWest() - padX,
      b.getSouth() - padY,
      b.getEast() + padX,
      b.getNorth() + padY,
    ];
    for (const s of snapSources) {
      if (!bboxIntersects(s.bbox, view)) continue;
      const pts = s.coords.map((c) => {
        const q = map.project(c);
        return [q.x, q.y];
      });
      snapIndex.addPolyline(pts, s.closed, s.draft ? { draft: true } : null);
    }
    indexDirty = false;
  }

  const ensureIndex = () => {
    if (indexDirty) rebuildIndex();
  };

  function getGraph() {
    ensureIndex();
    if (!snapGraph) snapGraph = buildGraph(snapIndex);
    return snapGraph;
  }

  function snapAt(screen) {
    const st = store.getState();
    if (!st.snapEnabled) return null;
    ensureIndex();
    return snapIndex.query(screen, st.snapTolerance);
  }

  /**
   * Enganche con el radio del trace, que es aparte y más holgado: apuntar al
   * borde por el que se quiere trazar no exige la misma precisión que clavar un
   * vértice sobre otro.
   */
  function traceSnapAt(screen) {
    const st = store.getState();
    if (!st.traceEnabled) return null;
    ensureIndex();
    return snapIndex.query(screen, Math.max(st.snapTolerance, st.traceTolerance));
  }

  /** El ancla, re-enganchada contra el índice de este instante. */
  function anchorSnap() {
    if (!traceAnchor) return null;
    ensureIndex();
    const p = map.project(traceAnchor);
    const st = store.getState();
    return snapIndex.query([p.x, p.y], Math.max(st.snapTolerance, st.traceTolerance));
  }

  function showSnapMarker(snap) {
    if (!snap) {
      snapEl.hidden = true;
      return;
    }
    snapEl.hidden = false;
    snapEl.classList.toggle('vertex', snap.type === 'vertex');
    snapEl.style.left = `${snap.point[0]}px`;
    snapEl.style.top = `${snap.point[1]}px`;
  }

  function clearPreview() {
    if (preview.length === 0 && previewKind === null) return;
    preview = [];
    previewKind = null;
    lastPreviewKey = null;
    syncDraft();
  }

  /** Vista previa del camino que produciría el trace, como en QGIS. */
  function updateTracePreview(snap) {
    const st = store.getState();
    const active = st.traceEnabled && traceAnchor && snap && st.draft && st.draft.coords.length > 0;
    if (!active) {
      if (previewKind === 'trace') clearPreview();
      return;
    }
    const key = `${snap.segment}:${snap.t.toFixed(3)}`;
    if (previewKind === 'trace' && key === lastPreviewKey) return;
    const from = anchorSnap();
    const path = from ? tracePath(snapIndex, getGraph(), from, snap) : null;
    lastPreviewKey = key;
    previewKind = 'trace';
    preview = path && path.length >= 2 ? path.slice(1).map(toLngLat) : [];
    syncDraft();
  }

  map.on('move', () => {
    indexDirty = true;
    if (store.getState().tool === 'vertices' && !drag) rebuildHandles();
  });

  /* ---------- edición de vértices ---------- */

  let handles = [];
  let midpoints = [];
  let coincidence = null;
  let drag = null;

  const projectLngLat = (c) => map.project(c);

  /** Con selección se editan solo esos elementos; sin ella, todo el dibujo. */
  function editableFeatures() {
    const st = store.getState();
    return st.selection.length ? store.selectedFeatures() : st.features;
  }

  function rebuildHandles() {
    const st = store.getState();
    if (st.tool !== 'vertices') {
      handles = [];
      midpoints = [];
      coincidence = null;
      syncEditSource();
      return;
    }
    const fs = editableFeatures();
    handles = collectHandles(fs, projectLngLat, 4000);
    midpoints = collectMidpoints(fs, projectLngLat, 4000);
    coincidence = buildCoincidence(handles, 2);
    syncEditSource();
  }

  function syncEditSource() {
    if (!ready) return;
    const src = map.getSource(EDIT_SOURCE);
    if (!src) return;
    const feats = [];
    for (const m of midpoints) {
      feats.push({
        type: 'Feature',
        properties: { kind: 'mid' },
        geometry: { type: 'Point', coordinates: m.lngLat },
      });
    }
    for (const h of handles) {
      const shared = coincidence ? coincidence(h).length > 1 : false;
      feats.push({
        type: 'Feature',
        properties: { kind: 'vertex', shared },
        geometry: { type: 'Point', coordinates: h.lngLat },
      });
    }
    src.setData({ type: 'FeatureCollection', features: feats });
  }

  function targetsFor(handle) {
    const st = store.getState();
    const group = st.topoEdit && coincidence ? coincidence(handle) : [handle];
    return group.map((h) => ({ featureId: h.featureId, ring: h.ring, index: h.index }));
  }

  /** Inserta un vértice y lo deja agarrado, para poder colocarlo de una vez. */
  function insertAndDrag(target, lngLat) {
    const inserted = insertVertex(store.getState().features, target, lngLat);
    drag = {
      targets: [{ featureId: target.featureId, ring: target.ring, index: target.index }],
      base: inserted,
      // El historial guarda el estado ANTERIOR a la inserción.
      history: store.getState().features,
      inserted: true,
    };
    snapExclude = new Set([target.featureId]);
    store.setFeatures(inserted);
    collectSnapSources();
  }

  function beginVertexDrag(screen) {
    const st = store.getState();

    // En modo borrar no se arrastra nada: se resuelve al soltar, para que un
    // roce mientras se apunta no borre un vértice sin querer.
    if (st.vertexMode === 'delete') return;

    if (st.vertexMode === 'add') {
      // Punto medio si se apuntó a uno; si no, el borde más cercano. Así el
      // vértice nuevo cae exactamente sobre la línea, no al lado.
      const mid = findHandle(midpoints, screen, 16);
      if (mid) {
        insertAndDrag(mid, mid.lngLat);
        return;
      }
      const ins = findInsertion(editableFeatures(), projectLngLat, screen, 26);
      if (ins) insertAndDrag(ins, toLngLat(ins.screen));
      else onEditMessage('Tap the edge of a feature to add a vertex.', 'warn');
      return;
    }

    const handle = findHandle(handles, screen, 18);
    if (handle) {
      const group = coincidence ? coincidence(handle) : [handle];
      // La exclusión del snapping usa SIEMPRE el grupo completo, aunque la
      // topología esté apagada: si no, el vértice del vecino que ocupa el
      // mismo punto lo volvería a atraer y sería imposible separarlos.
      snapExclude = new Set(group.map((h) => h.featureId));
      drag = { targets: targetsFor(handle), base: st.features, history: st.features };
      collectSnapSources();
      return;
    }

    // Sobre un punto medio: se inserta el vértice y se arrastra el nuevo.
    const mid = findHandle(midpoints, screen, 16);
    if (mid) insertAndDrag(mid, mid.lngLat);
  }

  function moveVertexDrag(screen) {
    if (!drag) return;
    const snap = snapAt(screen);
    showSnapMarker(snap);
    const lngLat = toLngLat(snap ? snap.point : screen);
    store.setFeatures(moveVertices(drag.base, drag.targets, lngLat));
  }

  /* ---------- selección por toque y lazo rectangular ---------- */

  let lasso = null;

  function beginLasso(screen) {
    lasso = { start: screen };
  }

  function moveLasso(screen) {
    if (!lasso) return;
    const [x0, y0] = lasso.start;
    lassoEl.hidden = false;
    lassoEl.style.left = `${Math.min(x0, screen[0])}px`;
    lassoEl.style.top = `${Math.min(y0, screen[1])}px`;
    lassoEl.style.width = `${Math.abs(screen[0] - x0)}px`;
    lassoEl.style.height = `${Math.abs(screen[1] - y0)}px`;
  }

  /** Elementos completamente encerrados por el rectángulo. */
  function featuresInBox(box) {
    const out = [];
    for (const f of store.getState().features) {
      const rings = ringsOf(f.geometry);
      if (rings.length === 0) continue;
      let inside = true;
      for (const r of rings) {
        for (const c of r.coords) {
          const q = map.project(c);
          if (q.x < box[0] || q.x > box[2] || q.y < box[1] || q.y > box[3]) {
            inside = false;
            break;
          }
        }
        if (!inside) break;
      }
      if (inside) out.push(f.properties.id);
    }
    return out;
  }

  function pickAt(screen, tolerance = 16) {
    return pickFeature(store.getState().features, screen, projectLngLat, tolerance);
  }

  function endLasso(screen, info) {
    lassoEl.hidden = true;
    const l = lasso;
    lasso = null;
    if (!l) return;

    if (info.longPressed) {
      openPropsFor(screen);
      return;
    }

    if (!info.moved) {
      const hit = pickAt(screen);
      if (hit) store.toggleSelection(hit.properties.id);
      else store.clearSelection();
      return;
    }

    const box = [
      Math.min(l.start[0], screen[0]),
      Math.min(l.start[1], screen[1]),
      Math.max(l.start[0], screen[0]),
      Math.max(l.start[1], screen[1]),
    ];
    store.setSelection(featuresInBox(box));
  }

  /** Abre el menú de propiedades; si no hay selección, selecciona lo tocado. */
  function openPropsFor(screen) {
    if (store.getState().selection.length === 0) {
      const hit = pickAt(screen);
      if (hit) store.toggleSelection(hit.properties.id);
    }
    if (store.getState().selection.length > 0) onOpenProps(screen);
  }

  /** Borra la manija bajo el punto, con sus coincidentes si hay topología. */
  function deleteHandleAt(screen, tolerance = 18) {
    const handle = findHandle(handles, screen, tolerance);
    if (!handle) {
      onEditMessage('Tap a vertex to delete it.', 'warn');
      return;
    }
    const result = deleteVertices(store.getState().features, targetsFor(handle));
    if (result.borrados > 0) {
      store.pushHistory();
      store.setFeatures(result.features);
    }
    onEditMessage(
      result.borrados === 0
        ? 'Cannot delete: the geometry would degenerate.'
        : `${result.borrados} vertex/vertices deleted${result.omitidos ? `, ${result.omitidos} skipped to keep the geometry valid` : ''}.`,
      result.borrados === 0 ? 'warn' : 'info',
    );
  }

  function endVertexDrag(screen, info) {
    const active = drag;
    drag = null;
    snapExclude = null;
    showSnapMarker(null);

    // Mover o insertar un vértice pasa a ser deshacible: durante el arrastre
    // el estado cambia en cada frame, así que el snapshot se archiva aquí, ya
    // sabiendo si el gesto cambió algo.
    if (active && (info.moved || active.inserted)) store.pushHistorySnapshot(active.history);

    const mode = store.getState().vertexMode;

    // En modo borrar basta un toque; en modo mover hace falta el doble toque,
    // que es el gesto de siempre y evita borrar al intentar agarrar.
    // Un doble toque agarra la manija igual que un arrastre; lo que lo
    // distingue es que el puntero no se movió entre medio.
    if (mode === 'delete' && !info.moved) deleteHandleAt(screen, 22);
    else if (mode !== 'delete' && info.doubleTap && !info.moved) deleteHandleAt(screen);

    collectSnapSources();
    rebuildHandles();
  }

  const controller = new DrawController(host, container, {
    isDrawing: () => store.getState().tool !== 'navigate',
    fingerDrawEnabled: () => store.getState().fingerDraw,
    // Seleccionar es solo tocar: el trazo libre ahí no tendría sentido.
    freehandMode: () =>
      store.getState().tool === 'select' ? 'none' : store.getState().freehandMode,
    // Vértices arrastra manijas; Elegir arrastra el lazo rectangular. Los dos
    // necesitan el mismo modo de puntero, así que se despachan por herramienta.
    dragMode: () => ['vertices', 'select'].includes(store.getState().tool),
    onDragStart: (p) => {
      if (onMapTap) onMapTap();
      return store.getState().tool === 'select' ? beginLasso(p) : beginVertexDrag(p);
    },
    onDragMove: (p) => (store.getState().tool === 'select' ? moveLasso(p) : moveVertexDrag(p)),
    onDragEnd: (p, info) =>
      store.getState().tool === 'select' ? endLasso(p, info) : endVertexDrag(p, info),
    // Mantener pulsado abre el menú de propiedades en cualquier herramienta:
    // es el gesto para tocar los atributos de lo que ya está dibujado sin
    // tener que cambiar a Elegir y volver.
    onLongPress: (p) => {
      if (onMapTap) onMapTap();
      openPropsFor(p);
    },

    onMultiTap: (n) => {
      if (n === 2) {
        if (!store.undo()) onEditMessage('Nothing left to undo.', 'warn');
      } else if (n >= 3) {
        if (!store.redo()) onEditMessage('Nothing left to redo.', 'warn');
      }
    },

    onVertex: (screen) => {
      const st = store.getState();
      if (onMapTap) onMapTap();

      // Cortar usando un elemento que ya existe: se toca y se usa como cuchilla.
      if (st.tool === 'cut' && st.cutSource === 'feature') {
        const hit = pickFeature(st.features, screen, projectLngLat, 16);
        if (hit) store.requestCutByFeature(hit.properties.id);
        else onEditMessage('Tap the line or polygon you want to split with.', 'warn');
        return;
      }

      const snap = snapAt(screen);
      const hasDraft = !!st.draft && st.draft.coords.length > 0;
      // Con trace activo el objetivo puede venir del radio holgado; si no, es
      // el enganche normal.
      const target = st.traceEnabled ? snap || traceSnapAt(screen) : snap;

      if (st.traceEnabled && hasDraft && target) {
        const from = anchorSnap();
        const path = from ? tracePath(snapIndex, getGraph(), from, target) : null;
        if (path && path.length >= 2) {
          clearPreview();
          // El primer punto del camino ya está puesto como último vértice.
          store.appendStroke(path.slice(1).map(toLngLat));
          traceAnchor = toLngLat(target.point);
          return;
        }
      }

      clearPreview();
      const at = target;
      store.addVertex(toLngLat(at ? at.point : screen));
      traceAnchor = at ? toLngLat(at.point) : null;
    },

    onStrokeStart: () => {
      if (onMapTap) onMapTap();
      preview = [];
      previewKind = 'freehand';
    },

    onStrokeProgress: (screen) => {
      previewKind = 'freehand';
      preview = screen.map(toLngLat);
      syncDraft();
    },

    onStrokeEnd: (screen) => {
      const { tolerance, smoothing } = store.getState();
      // Se simplifica en px (invariante a la escala) y recién ahí se proyecta.
      const processed = processStroke(screen, { tolerance, smooth: smoothing });
      // Los extremos del trazo sí se enganchan: es donde importa que el
      // contacto cierre exactamente contra la geometría vecina.
      if (processed.length >= 2) {
        const first = snapAt(processed[0]);
        if (first) processed[0] = first.point;
        const last = snapAt(processed[processed.length - 1]) || traceSnapAt(processed[processed.length - 1]);
        if (last) processed[processed.length - 1] = last.point;
        traceAnchor = last ? toLngLat(last.point) : null;
      }
      clearPreview();
      store.appendStroke(processed.map(toLngLat));
    },

    onFinish: () => store.finishDraft(),

    onFingerTap: (screen) => {
      if (onMapTap) onMapTap();
      const st = store.getState();

      // Un toque fuera del elemento en construcción lo cierra, sea cual sea la
      // herramienta: es la salida de la edición que siempre está disponible,
      // incluso con el Pencil apoyado dibujando.
      const d = st.draft;
      if (d && d.coords.length > 0) {
        const pts = d.coords.map((c) => {
          const q = map.project(c);
          return [q.x, q.y];
        });
        const near = nearestOnPolyline(screen, pts, d.kind === 'polygon');
        if (!near || Math.sqrt(near.distSq) > OUTSIDE_TAP_PX) store.finishDraft();
        return;
      }

      // Sin nada en construcción, un toque limpio de dedo selecciona. Vale en
      // cualquier herramienta, no solo en Elegir: mientras el lápiz dibuja, el
      // dedo es lo que se tiene a mano para señalar un elemento.
      const hit = pickAt(screen, 18);
      if (hit) store.toggleSelection(hit.properties.id);
      else if (st.selection.length) store.clearSelection();
    },

    onHover: (p) => {
      if (!p || store.getState().tool === 'navigate') {
        hoverEl.hidden = true;
        showSnapMarker(null);
        if (previewKind === 'trace') clearPreview();
        return;
      }
      hoverEl.hidden = false;
      hoverEl.style.left = `${p[0]}px`;
      hoverEl.style.top = `${p[1]}px`;
      const snap = snapAt(p) || traceSnapAt(p);
      showSnapMarker(snap);
      updateTracePreview(snap);
    },

    onLongPressArm: (p) => {
      if (!p) {
        ringEl.hidden = true;
        return;
      }
      ringEl.style.left = `${p[0]}px`;
      ringEl.style.top = `${p[1]}px`;
      ringEl.hidden = false;
      // Reinicia la animación del anillo en cada pulsación.
      ringEl.style.animation = 'none';
      void ringEl.offsetWidth;
      ringEl.style.animation = '';
    },

    onPointerInfo: (info) => {
      // Alto tráfico: limitamos el refresco de la UI a ~10 Hz.
      const now = performance.now();
      if (info && now - lastInfoAt < 100) return;
      lastInfoAt = now;
      onPointerInfo(info);
    },
  });

  store.subscribe(() => {
    if (store.changed('units')) applyUnitColors();
    if (store.changed('ornaments')) applyOrnamentStyle(map, store.getState().ornaments);
    if (store.changed('strabo')) {
      syncStrabo();
      applyLayerStack(map, store.getState().layers);
      if (store.getState().strabo) fitToStrabo();
    }
    if (store.changed('straboStyle')) applyStraboStyle(map, store.getState().straboStyle);
    if (store.changed('straboFilters')) {
      const filters = store.getState().straboFilters;
      for (const cat of ['structures', 'observations', 'lines']) {
        applyStraboFilter(map, cat, filters[cat]);
      }
    }
    if (store.changed('imported')) syncImported();
    else if (store.changed('tileSets')) syncTileSets();
    else if (store.changed('layers')) applyLayerStack(map, store.getState().layers);
    if (store.changed('features')) syncGeology();
    if (store.changed('draft')) syncDraft();

    // Durante un arrastre de vértice el índice se gestiona a mano (con la
    // geometría editada excluida), así que no hay que rehacerlo en cada frame.
    if (
      !drag &&
      (store.changed('features') ||
        store.changed('imported') ||
        store.changed('layers') ||
        store.changed('draft'))
    ) {
      collectSnapSources();
    }

    if (
      !drag &&
      (store.changed('tool') || store.changed('features') || store.changed('selection'))
    ) {
      rebuildHandles();
    }
    if (store.changed('draft') && !store.getState().draft) {
      traceAnchor = null;
      showSnapMarker(null);
    }

    if (store.changed('selection') && map.getLayer('geology-selected')) {
      map.setFilter('geology-selected', [
        'in',
        ['get', 'id'],
        ['literal', store.getState().selection],
      ]);
    }

    if (store.changed('tool')) {
      // La línea de corte se pinta en rojo: es una operación destructiva y no
      // debe confundirse con el elemento que se está digitalizando.
      const cutting = store.getState().tool === 'cut';
      if (map.getLayer('draft-line')) {
        map.setPaintProperty('draft-line', 'line-color', cutting ? '#ff3b30' : '#00E5FF');
        map.setPaintProperty('draft-fill', 'fill-color', cutting ? '#ff3b30' : '#00E5FF');
        map.setPaintProperty('draft-vertices', 'circle-stroke-color', cutting ? '#ff3b30' : '#00E5FF');
      }
      const drawing = store.getState().tool !== 'navigate';
      host.classList.toggle('is-drawing', drawing);
      map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
      if (!drawing) {
        hoverEl.hidden = true;
        showSnapMarker(null);
        traceAnchor = null;
      }
      if (!drawing) lassoEl.hidden = true;
    }
  });

  window.addEventListener('keydown', (e) => {
    if (store.getState().tool === 'navigate') return;
    if (e.key === 'Enter') store.finishDraft();
    else if (e.key === 'Escape') store.cancelDraft();
    else if (e.key === 'Backspace') store.undoVertex();
  });

  // Gancho de depuración: útil para inspeccionar el estilo desde la consola
  // de Safari en el propio iPad, donde no hay devtools cómodas, y para que
  // las pruebas de navegador puedan ejercitar el snapping real.
  window.__fielddraw = {
    map,
    store,
    controller,
    snapIndex,
    snapAt,
    traceSnapAt,
    getGraph,
    getTraceAnchor: () => traceAnchor,
    setTraceAnchor: (c) => {
      traceAnchor = c;
    },
    collectSnapSources,
    rebuildHandles,
    getHandles: () => handles,
    getMidpoints: () => midpoints,
    beginVertexDrag,
    moveVertexDrag,
    endVertexDrag,
  };

  return {
    map,
    destroy() {
      controller.destroy();
      map.remove();
    },
  };
}
