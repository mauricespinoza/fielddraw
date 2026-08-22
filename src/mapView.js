import maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';

import { BASEMAPS, TERRARIUM_URL } from './basemaps.js';
import { DEM_MAX_ZOOM, haversine } from './dem.js';
import { vendorBase } from './vendorPaths.js';
import * as store from './store.js';
import { denominatorFromMpp, scaleDrifted, zoomDelta } from './scale.js';
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
  GEOLOGY_LINE_LAYER_IDS,
  GEOLOGY_SOURCE,
  draftLayers,
  editLayers,
  geologyLayers,
  lineColorExpr,
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
  STRUCTURE_LAYER_IDS,
  addStructureImages,
  applyStructureStyle,
  structureLayers,
} from './structureSymbols.js';
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

/**
 * Terrain-RGB crudo, para el sombreado y para el relieve 3D.
 *
 * Es la MISMA URL que alimenta las curvas de nivel, pero declarada como
 * `raster-dem` en vez de pasar por el protocolo de maplibre-contour: ese
 * protocolo entrega teselas vectoriales de curvas, no alturas, así que no
 * sirve ni para `hillshade` ni para `setTerrain`. Al compartir origen, el
 * service worker cachea las mismas teselas una sola vez.
 */
const TERRAIN_SOURCE = 'terrain-dem-src';
const HILLSHADE_LAYER_IDS = ['hillshade'];

/** Traza del perfil topográfico y la muestra que señala el gráfico. */
const PROFILE_SOURCE = 'profile-src';
const PROFILE_LAYER_IDS = ['profile-casing', 'profile-line', 'profile-nodes', 'profile-cursor'];

/**
 * Resalte del elemento ajeno que se está consultando —una capa importada—.
 * Es propio y no reutiliza el de la selección porque ese vive en la fuente del
 * dibujo, que no contiene lo importado.
 */
const PICK_SOURCE = 'foreign-pick-src';
const PICK_LAYER_IDS = ['foreign-pick-fill', 'foreign-pick-line', 'foreign-pick-point'];

/** Un toque de dedo más lejos que esto del trazo en curso lo da por cerrado. */
const OUTSIDE_TAP_PX = 36;

const BASE = {
  ...BASE_OPACITY,
  'contour-lines': 0.6,
  'contour-index': 0.85,
  'contour-labels': 0.95,
  // El halo de una medida seleccionada es translúcido por diseño; sin esta
  // entrada, el deslizador de la capa lo subiría a opaco y taparía el símbolo.
  'structure-selected': 0.35,
};

const basemapLayerId = (id) => `bm-${id}`;

/** id lógico -> ids de las capas MapLibre que lo representan. */
const importedLayerIds = new Map();
const tileLayerIds = new Map();

function mlIdsFor(layer) {
  if (layer.kind === 'basemap') return [basemapLayerId(layer.id)];
  if (layer.kind === 'contours') return CONTOUR_LAYER_IDS;
  if (layer.kind === 'hillshade') return HILLSHADE_LAYER_IDS;
  if (layer.kind === 'imported') return importedLayerIds.get(layer.id) || [];
  if (layer.kind === 'tiles') return tileLayerIds.get(layer.id) || [];
  if (layer.kind === 'strabo') return STRABO_LAYER_IDS;
  // Los ornamentos van después para dibujarse sobre la traza de la falla, y
  // los símbolos de rumbo/manteo al final: son puntos y no deben quedar
  // tapados por el relleno del polígono sobre el que se midieron.
  return [...GEOLOGY_LAYER_IDS, ...ORNAMENT_LAYER_IDS, ...STRUCTURE_LAYER_IDS];
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
    case 'hillshade':
      map.setPaintProperty(id, 'hillshade-exaggeration', v);
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
  /*
   * El resalte de lo consultado, el elemento en construcción, la traza del
   * perfil y las manijas de edición van siempre encima.
   *
   * El resalte tiene que estar aquí y no donde se creó: las capas importadas se
   * añaden DESPUÉS —al importar el archivo, no al arrancar—, así que quedarían
   * por encima y el resalte se vería tapado justo por la capa que señala.
   * Va el primero del grupo, o sea el más bajo de los cuatro: lo que se está
   * dibujando ahora mismo manda sobre lo que se está consultando.
   */
  for (const id of [
    ...PICK_LAYER_IDS,
    ...PROFILE_LAYER_IDS,
    ...DRAFT_LAYER_IDS,
    ...EDIT_LAYER_IDS,
  ]) {
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
  onImportedFeatureTap,
  onScale,
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
  /*
   * Control de GPS de MapLibre. Se conserva tal cual —trae el marcador, el
   * círculo de precisión y el seguimiento ya resueltos— pero además se expone
   * su `trigger()` a la barra de herramientas: el botón del control queda
   * pequeño y abajo a la derecha, que es justo donde estorban los dedos al
   * sujetar la tablet.
   */
  const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
  });
  map.addControl(geolocate, 'bottom-right');

  geolocate.on('error', (err) => {
    // `code` 1 es permiso denegado; el resto son "no hay señal" o timeout.
    const msg =
      err && err.code === 1
        ? 'Location permission denied. Allow it in the browser settings to centre on your position.'
        : 'Could not get a GPS fix. WiFi-only iPads have no GPS receiver.';
    onEditMessage(msg, 'warn');
  });

  /**
   * Centra el mapa en la posición del GPS.
   *
   * Requiere contexto seguro (HTTPS o localhost), igual que el service worker:
   * servida por IP en la red local, `navigator.geolocation` ni siquiera
   * pregunta por el permiso, así que conviene decirlo en vez de dejar un botón
   * que no hace nada.
   */
  function locateMe() {
    if (!('geolocation' in navigator)) {
      onEditMessage('This device has no geolocation available.', 'warn');
      return;
    }
    if (!window.isSecureContext) {
      onEditMessage(
        'Location needs HTTPS. It works on the published site, not over a local IP address.',
        'warn',
      );
      return;
    }
    geolocate.trigger();
  }

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

    /*
     * DEM crudo. La fuente se declara siempre, pero MapLibre no pide una sola
     * tesela mientras nadie la use: con el sombreado apagado y sin relieve,
     * esto no cuesta nada de red. Es lo que permite encender cualquiera de los
     * dos sin recomponer el estilo.
     */
    map.addSource(TERRAIN_SOURCE, {
      type: 'raster-dem',
      tiles: [TERRARIUM_URL],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: DEM_MAX_ZOOM,
      attribution: 'Elevation: AWS Terrain Tiles (public domain)',
    });
    map.addLayer({
      id: 'hillshade',
      type: 'hillshade',
      source: TERRAIN_SOURCE,
      layout: { visibility: 'none' },
      paint: {
        'hillshade-exaggeration': 0.5,
        'hillshade-shadow-color': '#101820',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#2b2419',
      },
    });

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
      addOrnamentImages(map, store.getState().ornaments);
      for (const l of ornamentLayers(store.getState().ornaments)) map.addLayer(l);
    } catch (err) {
      console.warn('[ornamentos]', err);
    }

    // Símbolos de rumbo y manteo. Comparten la fuente del dibujo: una medida
    // es un elemento más del mapa geológico, no una capa aparte.
    try {
      addStructureImages(map);
      for (const l of structureLayers(store.getState().structureStyle)) map.addLayer(l);
    } catch (err) {
      console.warn('[estructural]', err);
    }
    applyUnitColors();
    applyLineColors();

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
    /*
     * Clic en modo Navegar. Selecciona lo propio y, si no hay nada propio bajo
     * el puntero, muestra los atributos de un spot importado.
     *
     * Que Navegar seleccione importa sobre todo desde un PC. En tablet el dedo
     * ya selecciona en cualquier herramienta, pero ese camino pasa por
     * `onFingerTap`, que solo existe para punteros `touch` no consumidos: con
     * ratón nunca se dispara. Sin esto, desde escritorio había que entrar a
     * **Elegir** para señalar cualquier cosa — incluido el paso previo a
     * continuar una línea, que es donde más se nota.
     *
     * Con Shift se añade a la selección en vez de reemplazarla, como en
     * cualquier escritorio.
     */
    map.on('click', (e) => {
      if (store.getState().tool !== 'navigate') return;
      const screen = [e.point.x, e.point.y];

      const hit = pickAt(screen, 12);
      if (hit) {
        const id = hit.properties.id;
        const shift = e.originalEvent && e.originalEvent.shiftKey;
        if (shift) store.toggleSelection(id);
        else store.setSelection([id]);
        return;
      }

      const spot = onStraboFeatureTap && straboHitAt(screen);
      if (spot) {
        onStraboFeatureTap(spot, screen);
        return;
      }
      if (store.getState().selection.length) store.clearSelection();
    });

    // Cursor de mano al pasar por encima, como cualquier elemento con el que se
    // puede interactuar: es la única pista de que ahí hay algo que tocar.
    const CLICKABLE_LAYER_IDS = [
      ...(onStraboFeatureTap ? STRABO_INTERACTIVE_LAYER_IDS : []),
      'geology-fill',
      ...GEOLOGY_LINE_LAYER_IDS,
      'structure-symbols',
    ];
    for (const id of CLICKABLE_LAYER_IDS) {
      if (!map.getLayer(id)) continue;
      map.on('mouseenter', id, () => {
        if (store.getState().tool === 'navigate') map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', id, () => {
        if (store.getState().tool === 'navigate') map.getCanvas().style.cursor = '';
      });
    }

    /*
     * Resalte de lo que se está consultando en una capa importada.
     *
     * Va en cian, el mismo color con el que se marca la selección propia: no
     * hace falta aprender dos códigos, y lo que dice es lo mismo —«este es el
     * elemento del que estás leyendo»—. Sin él, el recuadro de atributos de un
     * GeoPackage con varios polígonos contiguos no dice de CUÁL habla.
     */
    map.addSource(PICK_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'foreign-pick-fill',
      type: 'fill',
      source: PICK_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#00E5FF', 'fill-opacity': 0.22 },
    });
    map.addLayer({
      id: 'foreign-pick-line',
      type: 'line',
      source: PICK_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#00E5FF', 'line-width': 3.5, 'line-opacity': 0.9, 'line-blur': 0.6 },
    });
    map.addLayer({
      id: 'foreign-pick-point',
      type: 'circle',
      source: PICK_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 9,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#00E5FF',
        'circle-stroke-width': 3,
      },
    });

    map.addSource(EDIT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    for (const l of editLayers()) map.addLayer(l);

    /*
     * Traza del perfil ya calculado. Se mantiene visible mientras el panel lo
     * está: sin ella, el gráfico es una curva sin lugar — hay que poder mirar
     * el mapa y saber por dónde va el corte. El ámbar la separa del dibujo
     * geológico, que nunca usa ese color.
     */
    map.addSource(PROFILE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'profile-casing',
      type: 'line',
      source: PROFILE_SOURCE,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1a1200', 'line-width': 7, 'line-opacity': 0.55 },
    });
    map.addLayer({
      id: 'profile-line',
      type: 'line',
      source: PROFILE_SOURCE,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffb300', 'line-width': 2.8 },
    });
    map.addLayer({
      id: 'profile-nodes',
      type: 'circle',
      source: PROFILE_SOURCE,
      filter: ['==', ['get', 'kind'], 'node'],
      paint: {
        'circle-radius': 3.4,
        'circle-color': '#ffb300',
        'circle-stroke-color': '#1a1200',
        'circle-stroke-width': 1.2,
      },
    });
    map.addLayer({
      id: 'profile-cursor',
      type: 'circle',
      source: PROFILE_SOURCE,
      filter: ['==', ['get', 'kind'], 'cursor'],
      paint: {
        'circle-radius': 7,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#ffb300',
        'circle-stroke-width': 3,
      },
    });

    ready = true;
    applyScaleLock();
    applyLayerStack(map, store.getState().layers);
    syncGeology();
    syncStrabo();
    syncDraft();
    syncProfile();
    applyTerrain();
    collectSnapSources();
    rebuildHandles();
  });

  /**
   * Repinta las trazas cuando cambia un color en el módulo de simbología. Es el
   * gemelo de `applyUnitColors` para las líneas: la expresión se reconstruye
   * entera, que es más barato que llevar la cuenta de qué tipo cambió.
   */
  function applyLineColors() {
    const expr = lineColorExpr(store.getState().ornaments);
    for (const id of GEOLOGY_LINE_LAYER_IDS) {
      if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', expr);
    }
  }

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
    const st = store.getState();
    const d = st.draft;

    /*
     * Línea marcada para continuarse: se pintan sus dos extremos como si ya
     * fueran vértices del borrador.
     *
     * Antes no había ninguna señal de que "Línea" con una línea seleccionada
     * fuese a CONTINUARLA en vez de empezar una nueva, y el primer clic caía a
     * ciegas. Marcar los extremos dice además lo que de verdad hace falta
     * saber: que se continúa por el más cercano al clic, así que apuntando a
     * uno u otro se elige el sentido.
     */
    if (!d && st.extendFrom) {
      const src2 = st.features.find((f) => f.properties.id === st.extendFrom);
      const coords = src2 && src2.geometry.type === 'LineString' ? src2.geometry.coordinates : null;
      if (coords && coords.length >= 2) {
        src.setData({
          type: 'FeatureCollection',
          features: [coords[0], coords[coords.length - 1]].map((c) => ({
            type: 'Feature',
            properties: { kind: 'extend-end' },
            geometry: { type: 'Point', coordinates: c },
          })),
        });
        return;
      }
    }

    const committed = d ? d.coords : [];
    const all = [...committed, ...preview];
    const out = [];

    if (all.length >= 2) {
      // El contorno de un hueco se previsualiza cerrado igual que un polígono:
      // lo que se está decidiendo es un ÁREA, y verla como línea abierta no
      // deja juzgar qué se va a quitar.
      if (d && (d.kind === 'polygon' || d.kind === 'hole') && all.length >= 3) {
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

  /**
   * Enciende o apaga el relieve real.
   *
   * Con `setTerrain` el dibujo se drapea solo sobre el terreno: MapLibre
   * proyecta cada vértice a la altura del DEM, así que los contactos siguen la
   * ladera sin que haya que tocar la geometría.
   *
   * La inclinación de cámara se mueve con el interruptor porque un terreno
   * visto en planta se ve exactamente igual que sin terreno, y quien lo
   * activara pensaría que no funcionó.
   */
  function applyTerrain() {
    if (!ready) return;
    const { terrain3d, terrainExaggeration } = store.getState();

    if (!map.getSource(TERRAIN_SOURCE)) {
      // La fuente se declara en 'load'; si no está, el estilo no llegó a
      // montarse entero. Encender el interruptor sin ella dejaría el botón
      // iluminado y el mapa plano, que es exactamente el fallo que se reporta
      // como "el 3D no funciona".
      if (terrain3d) {
        store.setTerrain3d(false);
        onEditMessage('The elevation source is not loaded yet; try again in a moment.', 'warn');
      }
      return;
    }

    try {
      if (terrain3d) {
        map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: terrainExaggeration });
        /*
         * Se comprueba que quedó puesto. `setTerrain` no siempre lanza cuando
         * no puede: en un contexto WebGL sin las extensiones que necesita
         * vuelve sin terreno y sin excepción, y entonces el botón se quedaba
         * encendido sobre un mapa plano y con el dibujo bloqueado — el peor de
         * los dos mundos, y sin nada que lo explicara.
         */
        if (!map.getTerrain || !map.getTerrain()) {
          throw new Error('the renderer did not accept the terrain');
        }
        if (map.getPitch() < 20) map.easeTo({ pitch: 58, duration: 600 });
      } else {
        map.setTerrain(null);
        if (map.getPitch() > 1) map.easeTo({ pitch: 0, duration: 400 });
      }
    } catch (err) {
      // Un dispositivo sin el soporte de WebGL que pide el terreno no debe
      // dejar la app en un estado a medias.
      try {
        map.setTerrain(null);
      } catch {
        /* ya estaba sin terreno */
      }
      store.setTerrain3d(false);
      onEditMessage(
        `3D terrain could not be enabled on this device (${err && err.message ? err.message : err}).`,
        'warn',
      );
    }
  }

  /** Traza del perfil y la muestra que el gráfico tiene señalada. */
  function syncProfile() {
    if (!ready) return;
    const src = map.getSource(PROFILE_SOURCE);
    if (!src) return;
    const { profile, profileCursor } = store.getState();
    if (!profile || !profile.coords) {
      src.setData(EMPTY_FC);
      return;
    }
    const out = [
      {
        type: 'Feature',
        properties: { kind: 'trace' },
        geometry: { type: 'LineString', coordinates: profile.coords },
      },
    ];
    for (const c of profile.coords) {
      out.push({ type: 'Feature', properties: { kind: 'node' }, geometry: { type: 'Point', coordinates: c } });
    }
    const m = Number.isInteger(profileCursor) ? profile.samples[profileCursor] : null;
    if (m) {
      out.push({
        type: 'Feature',
        properties: { kind: 'cursor' },
        geometry: { type: 'Point', coordinates: m.lngLat },
      });
    }
    src.setData({ type: 'FeatureCollection', features: out });
  }

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
      /*
       * `generateId` numera las features por su posición en el array. Es lo
       * que permite volver de un resultado de `queryRenderedFeatures` —que
       * llega recortado por tesela— a la geometría original completa, que es
       * la que hay que resaltar. Un GeoPackage no garantiza traer `fid`, así
       * que no se puede depender de sus atributos para esto.
       */
      map.addSource(`src-${l.id}`, { type: 'geojson', data: l.geojson, generateId: true });
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

  /* ---------- escala de trabajo ---------- */

  /**
   * Metros de terreno por píxel en el CENTRO de la pantalla.
   *
   * Se mide sobre el propio mapa —dos puntos separados cien píxeles, y cuánto
   * terreno hay entre ellos— en vez de despejarla del nivel de zoom. Así no
   * depende de la convención interna de MapLibre y, con la cámara inclinada,
   * da la del centro, que es la única escala que se puede declarar cuando el
   * resto de la pantalla ya no está a la misma.
   */
  function metresPerPixelNow() {
    const c = map.getContainer();
    const y = c.clientHeight / 2;
    const x = c.clientWidth / 2;
    const a = map.unproject([x - 50, y]);
    const b = map.unproject([x + 50, y]);
    return haversine([a.lng, a.lat], [b.lng, b.lat]) / 100;
  }

  function currentDenominator() {
    return denominatorFromMpp(metresPerPixelNow(), store.getState().scalePixelMm);
  }

  /**
   * Lleva el mapa a una escala. Un solo salto basta: a latitud fija los metros
   * por píxel van con 2^-zoom, así que el delta es exacto.
   */
  function goToScale(denominator, { animate = true } = {}) {
    if (!ready || !Number.isFinite(denominator) || denominator <= 0) return;
    const z = map.getZoom() + zoomDelta(currentDenominator(), denominator);
    const objetivo = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), z));
    if (Math.abs(objetivo - map.getZoom()) < 1e-4) return;
    if (animate) map.easeTo({ zoom: objetivo, duration: 260 });
    else map.jumpTo({ zoom: objetivo });
  }

  /**
   * Con la escala fijada, el zoom deja de ser del usuario.
   *
   * Se apagan los gestos cuyo ÚNICO efecto es hacer zoom: la rueda, el pellizco
   * y la caja. El teclado NO se toca, porque en MapLibre las flechas que
   * desplazan y el +/- que hace zoom son el mismo manejador, y apagarlo dejaría
   * sin paneo por teclado a cambio de nada — el +/- se corrige igual por el
   * otro camino.
   *
   * Ese otro camino es la corrección al terminar cada movimiento, que recoge lo
   * que no pasa por los gestos: los botones de la brújula, cualquier zoom por
   * programa, y sobre todo el desplazamiento en latitud, que corre la escala
   * sola sin tocar el zoom.
   */
  function applyScaleLock() {
    if (!ready) return;
    const fijada = store.getState().scaleLock;
    const gestos = [map.scrollZoom, map.touchZoomRotate, map.boxZoom];
    for (const g of gestos) {
      if (!g) continue;
      if (fijada) g.disable();
      else g.enable();
    }
    if (fijada) goToScale(fijada);
    publishScale(true);
  }

  let scaleUltimo = null;
  /**
   * Publica la escala vigente.
   *
   * Durante el movimiento se salta lo que no cambia la lectura —un 0,2 %—
   * porque esto corre en cada frame del paneo. Al terminar se publica `force`:
   * si no, la banda muerta dejaba el número parado un pelo antes del real, y
   * con la escala fijada en 1:25.000 el rótulo decía 1:24.954. La diferencia no
   * significa nada en el mapa, pero un número que no cuadra con el que se
   * acaba de elegir hace dudar de todo lo demás.
   */
  function publishScale(force = false) {
    if (!ready || !onScale) return;
    const d = currentDenominator();
    if (!Number.isFinite(d)) return;
    if (!force && scaleUltimo !== null && Math.abs(d - scaleUltimo) / scaleUltimo < 0.002) return;
    scaleUltimo = d;
    onScale(d);
  }

  map.on('move', () => publishScale());
  map.on('moveend', () => {
    const fijada = store.getState().scaleLock;
    // Mantener la escala al desplazarse: el denominador depende del coseno de
    // la latitud, así que un paneo norte-sur la corre sin tocar el zoom.
    if (fijada && scaleDrifted(currentDenominator(), fijada)) goToScale(fijada, { animate: false });
    publishScale(true);
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
    const base = st.selection.length ? store.selectedFeatures() : st.features;
    // Una medida estructural es un punto: no tiene vértices que mover, y darle
    // una manija haría creer que se puede reformar.
    return base.filter((f) => f.geometry && f.geometry.type !== 'Point');
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

  /**
   * Spot de StraboSpot bajo el toque. Se consulta un recuadro y no el píxel
   * exacto: los símbolos estructurales son chicos y en terreno se tocan con el
   * dedo, no con el ratón. El primer resultado es el de la capa dibujada más
   * arriba, que es el que se ve.
   */
  function straboHitAt(screen, tolerance = 10) {
    if (!ready) return null;
    const box = [
      [screen[0] - tolerance, screen[1] - tolerance],
      [screen[0] + tolerance, screen[1] + tolerance],
    ];
    const capas = STRABO_INTERACTIVE_LAYER_IDS.filter((id) => map.getLayer(id));
    if (capas.length === 0) return null;
    const hits = map.queryRenderedFeatures(box, { layers: capas });
    return hits.length ? hits[0] : null;
  }

  /**
   * Elemento de una capa importada bajo el toque.
   *
   * Se pregunta a lo RENDERIZADO y no se recorre la geometría a mano: un
   * GeoPackage de una carta trae decenas de miles de elementos, y proyectar
   * cada vértice de cada uno en cada pulsación sostenida congelaría la app —el
   * coste dependería del tamaño del archivo y no de lo que hay en pantalla.
   * De regalo, respeta lo que de verdad se ve: una capa apagada no contesta.
   *
   * Devuelve el elemento ORIGINAL, no el que devuelve MapLibre: ese llega
   * recortado por tesela y con los valores pasados por texto.
   */
  function importedHitAt(screen, tolerance = 14) {
    if (!ready) return null;
    const porCapa = new Map();
    for (const [logico, ids] of importedLayerIds) {
      for (const id of ids) if (map.getLayer(id)) porCapa.set(id, logico);
    }
    if (porCapa.size === 0) return null;

    const box = [
      [screen[0] - tolerance, screen[1] - tolerance],
      [screen[0] + tolerance, screen[1] + tolerance],
    ];
    const hits = map.queryRenderedFeatures(box, { layers: [...porCapa.keys()] });
    if (!hits.length) return null;

    // El primero es el de la capa dibujada más arriba, que es el que se ve.
    const hit = hits[0];
    const logico = porCapa.get(hit.layer.id);
    const capa = store.getState().imported.find((l) => l.id === logico);
    if (!capa) return null;

    const original =
      typeof hit.id === 'number' ? capa.geojson.features[hit.id] : null;
    return {
      layer: capa,
      feature: original || { type: 'Feature', properties: hit.properties, geometry: hit.geometry },
      // Sin `generateId` no habría forma de volver al original; se dice, para
      // que quien resalte sepa que la geometría puede venir recortada.
      exact: !!original,
    };
  }

  /** Marca en el mapa el elemento ajeno del que se están leyendo atributos. */
  function highlightForeign(geometry) {
    if (!ready) return;
    const src = map.getSource(PICK_SOURCE);
    if (!src) return;
    src.setData(
      geometry
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] }
        : EMPTY_FC,
    );
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
      if (hit) {
        store.toggleSelection(hit.properties.id);
        return;
      }
      // Elegir consume el puntero, así que el `click` de MapLibre —que es por
      // donde se abren los atributos en Navegar— aquí no llega nunca. Sin
      // esto, tocar un spot importado con la herramienta con la que uno
      // naturalmente lo intenta no hacía absolutamente nada.
      // Se limpia igual que con cualquier otro toque en vacío: el spot no es
      // un elemento del dibujo y no entra en la selección, solo se lee.
      store.clearSelection();
      const spot = onStraboFeatureTap && straboHitAt(screen);
      if (spot) onStraboFeatureTap(spot, screen);
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

  /**
   * Pulsación sostenida: enseña lo que hay debajo del dedo.
   *
   * El orden importa y va de lo más específico a lo más general:
   *
   * 1. **Lo propio**, seleccionado o bajo el dedo: abre el menú de propiedades,
   *    que además EDITA. Si hay dibujo encima de una capa importada, gana el
   *    dibujo: es lo único sobre lo que se puede actuar.
   * 2. **Un spot de StraboSpot**: son símbolos pequeños, así que si uno cae
   *    sobre un polígono importado el pequeño es el que se estaba apuntando.
   * 3. **Una capa importada**: sus atributos, en solo lectura.
   *
   * Los dos últimos no entran en `store.selection`: esa lista alimenta borrar,
   * cortar, unir y mover vértices, y meter ahí algo que no está en `features`
   * dejaría esas herramientas apuntando a nada. Lo que se hace en su lugar es
   * resaltarlo en el mapa, que es lo que la selección aportaba aquí: saber de
   * cuál de los tres polígonos contiguos habla el recuadro.
   */
  function openPropsFor(screen) {
    if (store.getState().selection.length === 0) {
      const hit = pickAt(screen);
      if (hit) store.toggleSelection(hit.properties.id);
    }
    if (store.getState().selection.length > 0) {
      highlightForeign(null);
      onOpenProps(screen);
      return;
    }

    const spot = onStraboFeatureTap && straboHitAt(screen);
    if (spot) {
      highlightForeign(null);
      onStraboFeatureTap(spot, screen);
      return;
    }

    const imported = onImportedFeatureTap && importedHitAt(screen);
    if (imported) {
      highlightForeign(imported.exact ? imported.feature.geometry : null);
      onImportedFeatureTap(imported, screen);
    }
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
    // Seleccionar es solo tocar: el trazo libre ahí no tendría sentido. Y en
    // rumbo/manteo solo lo admite el ajuste a una traza — con brújula o con
    // tres puntos, un trazo libre pondría cientos de puntos donde se esperan
    // uno o tres.
    freehandMode: () => {
      const st = store.getState();
      if (st.tool === 'select') return 'none';
      if (st.tool === 'measure' && st.measureMethod !== 'plane-fit') return 'none';
      return st.freehandMode;
    },
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

      /*
       * Rumbo y manteo. No se engancha a nada: una medida se toma donde está
       * el afloramiento, y pegarla al vértice más cercano de un contacto
       * movería el punto donde se leyó la cota — que es de donde sale el
       * número.
       */
      if (st.tool === 'measure') {
        clearPreview();
        store.addVertex(toLngLat(screen));
        // Con brújula la medida ya existe: se abre el menú para escribir los
        // números sin tener que buscarla y volver a tocarla.
        if (st.measureMethod === 'manual') onOpenProps(screen);
        return;
      }

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

    onHover: (p, pointerType) => {
      if (!p || store.getState().tool === 'navigate') {
        hoverEl.hidden = true;
        showSnapMarker(null);
        if (previewKind === 'trace') clearPreview();
        return;
      }
      /*
       * El anillo de hover solo con lápiz. Existe porque el Pencil flota a un
       * centímetro de la pantalla y hay que saber dónde va a aterrizar; con
       * ratón el propio cursor ya lo dice, y superponerle un anillo solo
       * duplica el indicador. El marcador de enganche sí se pinta en los dos.
       */
      hoverEl.hidden = pointerType !== 'pen';
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
    if (store.changed('terrain3d') || store.changed('terrainExaggeration')) applyTerrain();
    if (store.changed('scaleLock')) applyScaleLock();
    if (store.changed('scalePixelMm')) {
      // Cambia lo que "1:25.000" significa, no dónde está el mapa: se recalcula
      // el número y, si hay escala fijada, se vuelve a llevar el mapa a ella.
      scaleUltimo = null;
      if (store.getState().scaleLock) goToScale(store.getState().scaleLock);
      publishScale(true);
    }
    if (store.changed('profile') || store.changed('profileCursor')) syncProfile();
    if (store.changed('units')) applyUnitColors();
    if (store.changed('ornaments')) {
      applyOrnamentStyle(map, store.getState().ornaments);
      applyLineColors();
    }
    if (store.changed('strabo')) {
      syncStrabo();
      applyLayerStack(map, store.getState().layers);
      if (store.getState().strabo) fitToStrabo();
    }
    if (store.changed('structureStyle')) applyStructureStyle(map, store.getState().structureStyle);
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
    // `extendFrom` también repinta el borrador: es lo que marca los extremos
    // de la línea que se va a continuar.
    if (store.changed('draft') || store.changed('extendFrom')) syncDraft();

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
      const seleccion = ['literal', store.getState().selection];
      map.setFilter('geology-selected', ['in', ['get', 'id'], seleccion]);
      if (map.getLayer('structure-selected')) {
        // El halo de una medida es un círculo y no un trazo engrosado, así que
        // tiene su propia capa y hay que reapuntarle el mismo filtro.
        map.setFilter('structure-selected', [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['==', ['get', 'geomKind'], 'measurement'],
          ['in', ['get', 'id'], seleccion],
        ]);
      }
    }

    if (store.changed('tool')) {
      /*
       * Las líneas auxiliares se pintan distinto del elemento que se está
       * digitalizando, para que no se confundan con él: rojo para cortar,
       * porque es destructivo, y ámbar para reshape, que modifica pero no
       * destruye.
       */
      const herramienta = store.getState().tool;
      const AUX_COLOR = {
        cut: '#ff3b30',
        reshape: '#ffa726',
        profile: '#ffb300',
        measure: '#b388ff',
      };
      const auxColor = AUX_COLOR[herramienta] || '#00E5FF';
      if (map.getLayer('draft-line')) {
        map.setPaintProperty('draft-line', 'line-color', auxColor);
        map.setPaintProperty('draft-fill', 'fill-color', auxColor);
        map.setPaintProperty('draft-vertices', 'circle-stroke-color', auxColor);
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
    locateMe,
    /** Lleva el mapa a una escala concreta, sin fijarla. */
    goToScale,
    /** Quita el resalte del elemento ajeno; lo llama la interfaz al cerrar. */
    clearForeignHighlight: () => highlightForeign(null),
    /** Encuadra una polilínea: lo usa el perfil de una línea ya dibujada. */
    fitToCoords(coords) {
      if (!Array.isArray(coords) || coords.length === 0) return;
      fitToGeoJSON({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        ],
      });
    },
    destroy() {
      controller.destroy();
      map.remove();
    },
  };
}
