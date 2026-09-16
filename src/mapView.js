import maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';

import { BASEMAPS, TERRARIUM_URL } from './basemaps.js';
import { haversine } from './dem.js';
import { vendorBase } from './vendorPaths.js';
import * as store from './store.js';
import { denominatorFromMpp, metresPerPixel, scaleDrifted, zoomDelta } from './scale.js';
import { DrawController } from './drawController.js';
import { chaikin, processStroke } from './simplify.js';
import { createStrokeBuffer } from './stroke.js';
import {
  bboxIntersects,
  bboxOf,
  featuresInBox,
  nearestOnPolyline,
  pickFeature,
  ringsOf,
} from './geom.js';
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
  UNIT_LABEL_LAYER_ID,
  draftLayers,
  editLayers,
  geologyLayers,
  lineColorExpr,
  unitCodeExpr,
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

/** Traza de afloramiento proyectada desde una medida; ver planeTrace.js. */
const PLANE_TRACE_SOURCE = 'plane-trace-src';
const PLANE_TRACE_LAYER_IDS = ['plane-trace-casing', 'plane-trace-line', 'plane-trace-anchor'];

/**
 * Resalte del elemento ajeno que se está consultando —una capa importada—.
 * Es propio y no reutiliza el de la selección porque ese vive en la fuente del
 * dibujo, que no contiene lo importado.
 */
/** Ancla y segmento de la medida de espesor estratigráfico. */
const THICKNESS_SOURCE = 'thickness-src';
const THICKNESS_LAYER_IDS = ['thickness-line', 'thickness-points'];

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
    ...THICKNESS_LAYER_IDS,
    ...PROFILE_LAYER_IDS,
    ...PLANE_TRACE_LAYER_IDS,
    ...DRAFT_LAYER_IDS,
    ...EDIT_LAYER_IDS,
  ]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/**
 * Zoom máximo al que se pide el DEM.
 *
 * Trece, y no quince, porque a z13 en latitudes medias cada píxel terrarium ya
 * son ~19 m: por debajo del tamaño REAL del dato, que ronda los 30. Pedir z14
 * o z15 no añade un metro de detalle —interpola— y sí multiplica por cuatro y
 * por dieciséis las teselas que hay que bajar, decodificar y mallar.
 *
 * Es el mismo número con el que se configura el generador de curvas, y esa
 * coincidencia no es estética: es lo que permite que las dos cosas compartan
 * una sola caché de teselas (ver `ensureDemSource`).
 */
const DEM_RENDER_MAXZOOM = 13;

let demSource = null;
function ensureDemSource() {
  if (demSource) return demSource;
  const DemSource = mlcontour.DemSource || (mlcontour.default && mlcontour.default.DemSource);
  if (!DemSource) throw new Error('maplibre-contour no expone DemSource');
  demSource = new DemSource({
    url: TERRARIUM_URL,
    encoding: 'terrarium',
    maxzoom: DEM_RENDER_MAXZOOM,
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

  /*
   * El teclado lo lleva la app entera, no MapLibre.
   *
   * Sus teclas son casi las mismas (flechas, +, −), así que con las dos manos
   * puestas cada flecha desplazaba DOS veces en cuanto el foco estaba en el
   * lienzo, y solo entonces: el mismo atajo movía distinto según dónde se
   * hubiera hecho clic por última vez. La tabla de `shortcuts.js` es la única
   * fuente de verdad, y esto la deja serlo también aquí.
   */
  map.keyboard.disable();

  /*
   * La caja de zoom de MapLibre —Shift+arrastrar— también se va, y por la
   * misma razón que el giro con Shift: ese modificador es ahora el de
   * selección múltiple. Sin esto, Shift+clic para añadir un contacto a la
   * selección arrancaba un recuadro de zoom en cuanto el ratón se movía un
   * píxel, y el mapa terminaba en otra escala.
   */
  map.boxZoom.disable();

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
     *
     * LAS TESELAS SE PIDEN UNA VEZ, NO DOS
     *
     * Va por el protocolo compartido de `maplibre-contour` y no por la URL de
     * AWS directamente. Apuntando a la URL, el relieve y las curvas de nivel
     * terminaban con DOS cachés independientes sobre exactamente el mismo
     * archivo: cada tesela del modelo se bajaba dos veces y se decodificaba
     * dos veces —PNG a Float32, que no es barato— una para mallar el terreno y
     * otra para trazar las curvas. Con el protocolo compartido se baja y se
     * decodifica una sola vez y las dos beben de ahí.
     *
     * Medido en el escritorio, con el relieve recién encendido y sin mover la
     * vista: 58 peticiones al modelo con las dos cachés.
     */
    let demTiles = [TERRARIUM_URL];
    try {
      demTiles = [ensureDemSource().sharedDemProtocolUrl];
    } catch {
      // Sin la librería de curvas no hay protocolo compartido, pero el relieve
      // tiene que seguir funcionando: se cae a la URL de siempre.
    }
    map.addSource(TERRAIN_SOURCE, {
      type: 'raster-dem',
      tiles: demTiles,
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: DEM_RENDER_MAXZOOM,
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
        /*
         * El mismo tope que el modelo, que es de donde salen. Estaba en 15, y
         * eso hacía que a z14 y z15 el generador recorriera CUATRO y DIECISÉIS
         * veces la misma tesela de z13 para dibujar exactamente las mismas
         * curvas. Topándolo aquí, MapLibre reescala la tesela vectorial ya
         * generada: se ve igual y no cuesta nada.
         */
        maxzoom: DEM_RENDER_MAXZOOM,
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
     * Clic en Navegar y en Elegir. Selecciona lo propio y, si no hay nada
     * propio bajo el puntero, muestra los atributos de un spot importado.
     *
     * Las dos herramientas comparten camino porque las dos dejan el puntero al
     * mapa: ninguna lo consume, así que el `click` de MapLibre llega intacto y
     * el arrastre desplaza la vista. Antes Elegir se quedaba el puntero para
     * dibujar un lazo rectangular, y por eso ahí ni el clic de MapLibre ni el
     * paneo con el botón primario existían.
     *
     * **Uno a la vez.** Un clic REEMPLAZA la selección; con **Shift** la
     * alterna, que es como selecciona cualquier escritorio. Antes alternaba
     * siempre, y el resultado era que seleccionar el segundo contacto dejaba
     * los dos marcados sin que nadie lo hubiera pedido: para cambiarle el tipo
     * a uno había que acordarse de deseleccionar el anterior.
     */
    map.on('click', (e) => {
      if (!['navigate', 'select'].includes(store.getState().tool)) return;
      /*
       * El toque de un dedo o de un lápiz YA se atendió en `onFingerTap`, con
       * los umbrales buenos y sin depender del navegador. El `click` que el
       * navegador sintetiza detrás del toque llega a veces —cuando el dedo se
       * movió poco— y a veces no; atenderlo también volvería a hacer el mismo
       * trabajo, y en el caso de un spot de StraboSpot volvería a abrir el
       * recuadro que el propio toque acaba de abrir.
       */
      if (performance.now() - taponPunteroAt < SYNTHETIC_CLICK_MS) return;
      selectAt([e.point.x, e.point.y], {
        additive: !!(e.originalEvent && e.originalEvent.shiftKey),
      });
    });

    /*
     * Cursor de mano al pasar por encima, como cualquier elemento con el que se
     * puede interactuar: es la única pista de que ahí hay algo que tocar.
     *
     * UN SOLO `mousemove`, Y NO UN `mouseenter` POR CAPA
     *
     * Esto estaba escrito como un `mouseenter`/`mouseleave` por cada capa
     * pulsable —nueve entre el dibujo, los símbolos y StraboSpot—, que es la
     * forma que enseña la documentación de MapLibre. El detalle que no cuenta
     * es que cada uno de esos pares obliga a MapLibre a consultar lo
     * renderizado POR SEPARADO en cada movimiento del ratón para saber si el
     * puntero entró o salió de esa capa.
     *
     * En plano eso es barato. **Con el relieve 3D puesto no lo es**: cada
     * consulta tiene que resolver a qué punto del terreno apunta el píxel, y
     * eso en MapLibre es una lectura SINCRÓNICA de la GPU —`readPixels`—, que
     * vacía la tubería de render y bloquea el hilo hasta que la tarjeta
     * contesta.
     *
     * Medido con el relieve puesto, moviendo el ratón cuarenta veces:
     * 1481 lecturas de GPU, unas 37 por movimiento, y 6,6 s para lo que en
     * plano tardaba 0,8. Era la causa principal de que "el 3D va lentísimo",
     * y no el dibujado del relieve en sí.
     *
     * Con un solo manejador se hace UNA consulta por movimiento, limitada
     * además a ~20 Hz y saltada entera mientras se dibuja —ahí el cursor es
     * una cruz y la respuesta no se usa para nada.
     */
    const CLICKABLE_LAYER_IDS = [
      ...(onStraboFeatureTap ? STRABO_INTERACTIVE_LAYER_IDS : []),
      'geology-fill',
      ...GEOLOGY_LINE_LAYER_IDS,
      'structure-symbols',
    ];
    let hoverAt = 0;
    let hoverCursor = '';
    map.on('mousemove', (e) => {
      const tool = store.getState().tool;
      if (!['navigate', 'select'].includes(tool)) {
        hoverCursor = '';
        return;
      }
      /*
       * Y con el relieve puesto no se consulta en absoluto.
       *
       * Medido: aun haciendo UNA sola consulta por movimiento, en 3D
       * `queryRenderedFeatures` cuesta lo que cuesta resolver contra qué
       * triángulo del terreno choca el píxel. Quitando el manejador entero, los
       * mismos cuarenta movimientos bajan de 14,6 s a 0,66 s — un factor
       * VEINTE. El cursor de mano es una cortesía; el mapa respondiendo, no.
       */
      if (terrainOn()) {
        if (hoverCursor) {
          hoverCursor = '';
          map.getCanvas().style.cursor = '';
        }
        return;
      }
      const now = performance.now();
      if (now - hoverAt < 50) return;
      hoverAt = now;

      const capas = CLICKABLE_LAYER_IDS.filter((id) => map.getLayer(id));
      if (capas.length === 0) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: capas }).length > 0;
      const quiero = hit ? 'pointer' : '';
      // Escribir `style.cursor` con el mismo valor fuerza un recálculo de
      // estilo en cada movimiento; se toca solo cuando de verdad cambia.
      if (quiero !== hoverCursor) {
        hoverCursor = quiero;
        map.getCanvas().style.cursor = quiero;
      }
    });

    /*
     * Resalte de lo que se está consultando en una capa importada.
     *
     * Va en cian, el mismo color con el que se marca la selección propia: no
     * hace falta aprender dos códigos, y lo que dice es lo mismo —«este es el
     * elemento del que estás leyendo»—. Sin él, el recuadro de atributos de un
     * GeoPackage con varios polígonos contiguos no dice de CUÁL habla.
     */
    /*
     * Espesor estratigráfico: el ancla mientras se elige el segundo punto, y
     * después el segmento entre los dos. Sin dibujarlo, el número aparece en un
     * aviso y no queda constancia en el mapa de ENTRE QUÉ se midió, que es la
     * mitad del dato.
     */
    map.addSource(THICKNESS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'thickness-line',
      type: 'line',
      source: THICKNESS_SOURCE,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#2dd4bf', 'line-width': 2.6, 'line-dasharray': [2, 1.4] },
    });
    map.addLayer({
      id: 'thickness-points',
      type: 'circle',
      source: THICKNESS_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'role'], 'anchor'], 7, 5],
        'circle-color': '#0d1117',
        'circle-stroke-color': '#2dd4bf',
        'circle-stroke-width': 2.6,
      },
    });

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

    /*
     * Traza de afloramiento a la espera de que se decida qué es.
     *
     * Va **punteada** y en el teal de la app, no en el negro de un contacto ni
     * en el azul de una falla: mientras esté así no es ninguna de las dos
     * cosas, es una predicción, y tiene que verse distinta de todo lo que sí
     * está cartografiado. En cuanto se le pone tipo pasa a la fuente del
     * dibujo y se pinta con su simbología de verdad.
     */
    map.addSource(PLANE_TRACE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'plane-trace-casing',
      type: 'line',
      source: PLANE_TRACE_SOURCE,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#04211f', 'line-width': 7, 'line-opacity': 0.6 },
    });
    map.addLayer({
      id: 'plane-trace-line',
      type: 'line',
      source: PLANE_TRACE_SOURCE,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#2dd4bf', 'line-width': 2.8, 'line-dasharray': [2.4, 1.6] },
    });
    map.addLayer({
      id: 'plane-trace-anchor',
      type: 'circle',
      source: PLANE_TRACE_SOURCE,
      filter: ['==', ['get', 'kind'], 'anchor'],
      paint: {
        'circle-radius': 5.5,
        'circle-color': '#2dd4bf',
        'circle-stroke-color': '#04211f',
        'circle-stroke-width': 2,
      },
    });

    ready = true;
    applyScaleLock();
    applyLayerStack(map, store.getState().layers);
    syncGeology();
    syncUnitLabels();
    syncStrabo();
    syncDraft();
    syncProfile();
    syncPlaneTrace();
    syncThickness();
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
    // El rótulo sale del mismo catálogo: renombrar un código se ve en el mapa
    // sin tocar los polígonos.
    if (map.getLayer(UNIT_LABEL_LAYER_ID)) {
      map.setLayoutProperty(UNIT_LABEL_LAYER_ID, 'text-field', unitCodeExpr(units));
    }
  }

  /* ---------- rótulos de unidad ---------- */

  /**
   * CUÁNTOS RÓTULOS Y CUÁLES, QUE ES TODA LA DIFICULTAD.
   *
   * Un mapa geológico levantado en terreno tiene decenas o cientos de
   * polígonos, y muchos son esquirlas de unos pocos píxeles al zoom al que se
   * está mirando. Rotularlos todos no produce un mapa rotulado: produce una
   * mancha de texto encima de la geología, con códigos que no se sabe a cuál
   * de los tres polígonos vecinos pertenecen. Por eso el rótulo se reparte con
   * tres criterios, y los tres se miden EN PÍXELES DE PANTALLA, que es donde
   * se lee:
   *
   * 1. **Que quepa.** El polígono tiene que tener, en la pantalla de ahora, un
   *    hueco de al menos `LABEL_MIN_SPAN_PX` de lado y `LABEL_MIN_AREA_PX` de
   *    superficie visible. Las dos condiciones y no solo el área: una cinta
   *    larga y angosta —un dique, un nivel guía— puede sumar mucha superficie
   *    y no tener sitio para una palabra en ninguna parte.
   * 2. **Unos pocos.** De los que caben, solo los `LABEL_MAX_LABELS` más
   *    grandes. Es la diferencia entre rotular un mapa y taparlo.
   * 3. **Repartidos entre unidades.** Como mucho `LABEL_MAX_PER_UNIT` por
   *    unidad. Sin esto, un mapa con cuarenta polígonos de la misma formación
   *    y tres de otra se gastaría todos los rótulos en la primera, y la
   *    segunda —que es la que hay que identificar— quedaría muda.
   *
   * Lo que sobre lo resuelve MapLibre, que no coloca dos etiquetas encima de
   * otra y prefiere no dibujar antes que solapar.
   */

  /** Lado mínimo, en píxeles, del hueco visible donde ha de caber el código. */
  const LABEL_MIN_SPAN_PX = 52;
  /** Y superficie mínima visible, para descartar cintas largas y angostas. */
  const LABEL_MIN_AREA_PX = 3000;
  /** Tope de rótulos en pantalla. Más que esto ya no es un mapa, es una lista. */
  const LABEL_MAX_LABELS = 14;
  /** Y tope por unidad, para que ninguna se coma todos los rótulos. */
  const LABEL_MAX_PER_UNIT = 3;
  /**
   * Vértices que se miran como mucho por anillo. Medir el tamaño en pantalla
   * no necesita el detalle del contacto —un anillo de diez mil vértices y su
   * versión de doscientos ocupan lo mismo— y esto se recalcula en cada
   * `moveend`, así que el coste tiene que depender de cuántos polígonos hay y
   * no de lo fino que se digitalizó cada uno.
   */
  const LABEL_RING_SAMPLES = 160;

  /** El anillo exterior proyectado a pantalla, submuestreado. */
  function ringToScreen(coords) {
    const n = coords.length;
    if (n < 3) return null;
    const paso = Math.max(1, Math.ceil(n / LABEL_RING_SAMPLES));
    const pts = [];
    for (let i = 0; i < n; i += paso) {
      const q = map.project(coords[i]);
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
      pts.push([q.x, q.y]);
    }
    return pts.length >= 3 ? pts : null;
  }

  /** Superficie de un polígono de pantalla, por la fórmula del agrimensor. */
  function screenArea(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    }
    return Math.abs(a) / 2;
  }

  /**
   * Cuánto de este polígono se ve, en píxeles.
   *
   * El recorte contra la ventana es a ojo —se recorta el rectángulo
   * envolvente, no el polígono— y con eso basta: lo que se decide aquí es si
   * hay sitio para una palabra, no una superficie que nadie va a leer. Un
   * polígono que sale de la pantalla por tres lados conserva así el trozo que
   * se ve, que es donde MapLibre va a intentar poner el rótulo.
   */
  function visibleFootprint(pts, w, h) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const x0 = Math.max(0, minX);
    const y0 = Math.max(0, minY);
    const x1 = Math.min(w, maxX);
    const y1 = Math.min(h, maxY);
    if (x1 <= x0 || y1 <= y0) return null;

    const anchoCaja = maxX - minX;
    const altoCaja = maxY - minY;
    /*
     * El área se prorratea: de la superficie real del polígono se conserva la
     * fracción de su caja que quedó dentro de la ventana. Es una aproximación,
     * y es la honesta que se puede hacer sin recortar la geometría de verdad.
     */
    const fraccion =
      anchoCaja > 0 && altoCaja > 0 ? ((x1 - x0) * (y1 - y0)) / (anchoCaja * altoCaja) : 1;
    return { span: Math.min(x1 - x0, y1 - y0), area: screenArea(pts) * fraccion };
  }

  /** Reescribe el filtro de la capa de rótulos para el encuadre de ahora. */
  function syncUnitLabels() {
    if (!ready || !map.getLayer(UNIT_LABEL_LAYER_ID)) return;
    const st = store.getState();

    const aplicar = (ids) =>
      map.setFilter(UNIT_LABEL_LAYER_ID, ['in', ['get', 'id'], ['literal', ids]]);

    if (!st.unitLabels) {
      aplicar([]);
      return;
    }

    const c = map.getContainer();
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!(w > 0 && h > 0)) return;

    const codigos = new Map(st.units.map((u) => [u.id, String(u.code || '')]));
    const candidatos = [];

    for (const f of st.features) {
      const g = f.geometry;
      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
      const tipo = f.properties ? f.properties.type : null;
      const code = codigos.has(tipo) ? codigos.get(tipo) : String((f.properties || {}).code || '');
      // Sin código no hay nada que rotular, y una unidad sin código es normal
      // mientras se está definiendo: no es un error, simplemente no se rotula.
      if (!code) continue;

      // De un multipolígono se mide solo la pieza mayor: es donde MapLibre va
      // a poner el rótulo y la única que decide si cabe.
      const anillos = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
      let mejor = null;
      for (const anillo of anillos) {
        const pts = ringToScreen(anillo);
        if (!pts) continue;
        const v = visibleFootprint(pts, w, h);
        if (v && (!mejor || v.area > mejor.area)) mejor = v;
      }
      if (!mejor) continue;
      if (mejor.span < LABEL_MIN_SPAN_PX || mejor.area < LABEL_MIN_AREA_PX) continue;
      candidatos.push({ id: f.properties.id, unit: tipo, area: mejor.area });
    }

    candidatos.sort((a, b) => b.area - a.area);
    const porUnidad = new Map();
    const ids = [];
    for (const cand of candidatos) {
      if (ids.length >= LABEL_MAX_LABELS) break;
      const n = porUnidad.get(cand.unit) || 0;
      if (n >= LABEL_MAX_PER_UNIT) continue;
      porUnidad.set(cand.unit, n + 1);
      ids.push(cand.id);
    }
    aplicar(ids);
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

  /** Ancla y segmento del espesor estratigráfico. */
  function syncThickness() {
    if (!ready) return;
    const src = map.getSource(THICKNESS_SOURCE);
    if (!src) return;
    const { thicknessFrom, thickness } = store.getState();
    const out = [];
    const punto = (c, role) => ({
      type: 'Feature',
      properties: { role },
      geometry: { type: 'Point', coordinates: c },
    });

    if (thickness && thickness.from && thickness.to) {
      out.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [thickness.from, thickness.to] },
      });
      out.push(punto(thickness.from, 'anchor'), punto(thickness.to, 'target'));
    } else if (thicknessFrom) {
      // Todavía sin segundo punto: se marca de dónde se está midiendo.
      out.push(punto(thicknessFrom.lngLat, 'anchor'));
    }
    src.setData({ type: 'FeatureCollection', features: out });
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

  /**
   * Traza proyectada desde una medida, con la propia medida marcada encima.
   *
   * El ancla importa tanto como la línea: lo que se está mirando es hasta
   * dónde se aleja la traza del único punto donde el plano se midió de verdad,
   * y sin ese punto la línea parecería medida de punta a punta.
   */
  function syncPlaneTrace() {
    if (!ready) return;
    const src = map.getSource(PLANE_TRACE_SOURCE);
    if (!src) return;
    const { planeTrace } = store.getState();
    if (!planeTrace || !planeTrace.coords || planeTrace.coords.length < 2) {
      src.setData(EMPTY_FC);
      return;
    }
    const out = [
      {
        type: 'Feature',
        properties: { kind: 'trace' },
        geometry: { type: 'LineString', coordinates: planeTrace.coords },
      },
    ];
    if (planeTrace.origin) {
      out.push({
        type: 'Feature',
        properties: { kind: 'anchor' },
        geometry: { type: 'Point', coordinates: planeTrace.origin },
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

  /** Caja que envuelve una lista de coordenadas [lng,lat], o null si ninguna vale. */
  function coordBounds(coords) {
    const bounds = new maplibregl.LngLatBounds();
    let any = false;
    for (const c of coords) {
      if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
        bounds.extend(c);
        any = true;
      }
    }
    return any ? bounds : null;
  }

  function fitToGeoJSON(fc, padding = 60) {
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
    if (any) map.fitBounds(bounds, { padding, maxZoom: 16, duration: 700 });
  }

  /*
   * DE UN PÍXEL DE PANTALLA AL PUNTO DEL TERRENO
   *
   * En planta esto es una línea: `unproject` y ya está. Con el relieve 3D
   * puesto deja de serlo, y es la razón por la que durante un tiempo no se
   * dejó digitalizar en 3D.
   *
   * Las dos direcciones no se resuelven igual. `project` consulta la cota en
   * el DEM y sube el punto, así que un contacto dibujado se pinta pegado a la
   * ladera. `unproject` resuelve el relieve al revés, lanzando un rayo contra
   * la malla del terreno a través de un framebuffer auxiliar — y ese camino
   * PUEDE NO ESTAR: si el búfer de coordenadas no llegó a dibujarse, MapLibre
   * vuelve en silencio al plano z = 0.
   *
   * Cuando vuelve al plano el vértice no queda un poco corrido, queda
   * lejísimos. Medido aquí, con la cámara a 60° sobre terreno de 3.000 m, un
   * clic en mitad de la pantalla guardaba un punto que se repintaba 700 px más
   * arriba, fuera de la ventana. Eso no es imprecisión: es geometría
   * inventada, y encima sin avisar.
   *
   * De ahí las tres capas de abajo, en orden de preferencia:
   *
   *   1. lo que diga `unproject`, que es la vía soportada;
   *   2. si el punto NO se repinta donde se tocó, se busca el que sí: es una
   *      raíz de `project(x) − píxel = 0`, y Newton con la jacobiana por
   *      diferencias la encuentra, porque la semilla ya está cerca;
   *   3. y si ni eso cierra —el rayo dio en el cielo, o el relieve de este
   *      dispositivo no está en condiciones—, se avisa UNA vez y se sigue con
   *      lo que haya. Un aviso es recuperable; un contacto movido un
   *      kilómetro sin decirlo, no.
   *
   * La comprobación es barata y es la clave de todo: solo se acepta un punto
   * que vuelve a caer sobre el píxel que se tocó, lo haya calculado quien lo
   * haya calculado.
   */

  /** A cuántos píxeles del toque se da por bueno el vértice. */
  const PICK_TOL_PX = 2;
  /**
   * Y a partir de cuántos ya no es imprecisión sino otro sitio.
   *
   * Los dos números son muy distintos a propósito. Dos píxeles es la puntería
   * que se BUSCA; doce es donde se deja de confiar. En medio hay desacuerdos
   * legítimos: `unproject` lee la malla teselada del terreno y `project`
   * consulta el DEM, y con exageración vertical las dos no tienen por qué
   * coincidir al píxel. Avisar de eso sería avisar de nada. El fallo que sí
   * importa se medía en cientos de píxeles.
   */
  const PICK_WARN_PX = 12;
  /** Pasos de Newton, y paso en grados para la jacobiana (~1 m). */
  const PICK_STEPS = 24;
  const PICK_EPS = 1e-5;

  /** Se avisa una vez por sesión: repetirlo en cada vértice sería insufrible. */
  let avisadoRelieve = false;

  /**
   * `project` de un punto que puede no existir.
   *
   * Newton da pasos largos, y un paso largo cerca de un horizonte se sale del
   * mundo. `map.project` no devuelve un valor raro en ese caso: LANZA
   * («Invalid LngLat latitude value»), y la excepción sube por el manejador de
   * puntero y mata el gesto entero. Visto de verdad al probar el 3D: un toque
   * dejaba la app sin responder a nada más. Aquí se acota y se envuelve.
   */
  function projectSafe(lng, lat) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (lat > 89.9 || lat < -89.9) return null;
    try {
      return map.project([lng, lat]);
    } catch {
      return null;
    }
  }

  /** Distancia en pantalla entre donde se tocó y donde se repinta el punto. */
  function pickError(lngLat, px, py) {
    const q = projectSafe(lngLat[0], lngLat[1]);
    return q ? Math.hypot(q.x - px, q.y - py) : Infinity;
  }

  /**
   * Newton sobre `project`, partiendo de una semilla ya cercana.
   *
   * Solo usa `project`, que consulta la cota en el DEM que ya está en memoria:
   * no toca la GPU ni espera a que termine de pintar. Devuelve el punto al que
   * llegó Y su error en pantalla, porque el criterio para quedárselo es el
   * mismo venga de donde venga la semilla — PICK_TOL_PX y nada más.
   */
  function refinePick(seed, px, py) {
    let lng = seed[0];
    let lat = seed[1];
    for (let i = 0; i < PICK_STEPS; i++) {
      const q = projectSafe(lng, lat);
      if (!q) break;
      const ex = px - q.x;
      const ey = py - q.y;
      const err = Math.hypot(ex, ey);
      if (err <= PICK_TOL_PX) return { point: [lng, lat], error: err };

      const qa = projectSafe(lng + PICK_EPS, lat);
      const qb = projectSafe(lng, lat + PICK_EPS);
      if (!qa || !qb) break;
      const a11 = (qa.x - q.x) / PICK_EPS;
      const a12 = (qb.x - q.x) / PICK_EPS;
      const a21 = (qa.y - q.y) / PICK_EPS;
      const a22 = (qb.y - q.y) / PICK_EPS;
      const det = a11 * a22 - a12 * a21;
      // Jacobiana degenerada: la pantalla ya no distingue movimientos del
      // suelo —se está mirando el horizonte, o una pared vertical—. Seguir
      // iterando solo produce ruido.
      if (!Number.isFinite(det) || Math.abs(det) < 1e-9) break;

      const dLng = (ex * a22 - ey * a12) / det;
      const dLat = (a11 * ey - a21 * ex) / det;
      if (!Number.isFinite(dLng) || !Number.isFinite(dLat)) break;
      lng += dLng;
      lat += dLat;
      // Salirse del mundo es señal de que esta raíz no existe —se tocó el
      // cielo—, no de que haga falta un paso más.
      if (lat > 89.9 || lat < -89.9 || lng > 360 || lng < -360) break;
    }
    return { point: [lng, lat], error: pickError([lng, lat], px, py) };
  }

  /**
   * Hasta qué separación en pantalla vale la semilla barata.
   *
   * `project` NO sabe de oclusión: devuelve dónde se pintaría un punto aunque
   * esté detrás de una loma, así que dos puntos muy distintos del terreno
   * pueden caer en el mismo píxel y Newton no distingue cuál de los dos es el
   * que se ve. Partiendo de un punto que ya está a unas decenas de píxeles esa
   * ambigüedad no existe: la raíz que encuentra es la vecina, que sobre un
   * trazo continuo es además la que se quiere. Más lejos se deja de adivinar y
   * se paga el rayo contra la malla, que sí resuelve la oclusión.
   */
  const PICK_SEED_PX = 64;

  /*
   * Radio de la segunda pasada al buscar qué elemento describe el menú de
   * propiedades.
   *
   * Un contacto se dibuja con dos píxeles de ancho, y apuntarle con el ratón a
   * dos píxeles no es puntería: es suerte. El radio normal de selección (16 px)
   * sirve para un clic, donde fallar no cuesta nada —no pasa nada y se vuelve a
   * hacer clic—, pero en el clic derecho fallar significa que el menú no sale,
   * o peor, que sale el de la selección anterior y parece que el programa
   * hubiera entendido mal. Aquí conviene errar por generoso.
   *
   * Es también el radio de la pulsación sostenida con el dedo, que va por esta
   * misma puerta y agradece todavía más el margen.
   */
  const MENU_PICK_PX = 30;

  /**
   * Radio de un toque de DEDO al seleccionar. Más ancho que el del ratón: el
   * cursor apunta a un píxel y la yema cubre cuarenta.
   */
  const FINGER_PICK_PX = 18;

  /**
   * Cuánto se ignora el `click` que el navegador sintetiza detrás de un toque.
   *
   * El toque ya se atendió sobre los eventos de puntero, que es donde se puede
   * medir con los umbrales de un dedo; este es el margen para que el `click`
   * tardío del navegador no repita el mismo trabajo. Medio segundo cubre de
   * sobra el retraso de un `click` sintetizado, incluso con el mapa repintando.
   */
  const SYNTHETIC_CLICK_MS = 500;

  /** Instante del último toque de dedo o lápiz ya atendido. Ver arriba. */
  let taponPunteroAt = 0;

  /**
   * @param {number[]|{x:number,y:number}} p  píxel tocado
   * @param {number[]} [seed]  punto de partida en lng/lat, típicamente el
   *   vértice anterior del mismo trazo. Ver abajo: es lo que evita la lectura
   *   sincrónica de la GPU en el camino caliente del dibujo en 3D.
   */
  const toLngLat = (p, seed) => {
    const px = Array.isArray(p) ? p[0] : p.x;
    const py = Array.isArray(p) ? p[1] : p.y;

    if (!terrainOn()) {
      const plano = map.unproject(p);
      return [plano.lng, plano.lat];
    }

    /*
     * LA VÍA BARATA, Y POR QUÉ EXISTE
     *
     * `unproject` con relieve resuelve el rayo leyendo el framebuffer de
     * coordenadas con `gl.readPixels`, lo que obliga a la GPU a terminar todo
     * lo pendiente antes de contestar. Medido aquí, con el relieve puesto:
     * 4,7 SEGUNDOS por llamada, contra 0,5 ms de `project`. Un trazo de
     * sesenta puntos son sesenta lecturas, y de ahí los más de cinco minutos
     * que tardaba en aparecer una línea dibujada en 3D.
     *
     * Con el punto anterior del trazo como semilla, la conversión se resuelve
     * entera con `project` —aritmética sobre el DEM que ya está en memoria— y
     * no toca la GPU. El listón para quedársela es el de siempre: que el
     * punto se repinte sobre el píxel que se tocó.
     */
    if (seed && pickError(seed, px, py) <= PICK_SEED_PX) {
      const cerca = refinePick(seed, px, py);
      if (cerca.error <= PICK_TOL_PX) return cerca.point;
    }

    const ll = map.unproject(p);
    const base = [ll.lng, ll.lat];
    const errBase = pickError(base, px, py);
    if (errBase <= PICK_TOL_PX) return base;

    /*
     * No se alcanzó la puntería, pero el refinado puede seguir siendo mejor
     * que la semilla: se queda el que menos se desvía, y solo se avisa si ni
     * siquiera ese está cerca.
     */
    const refinado = refinePick(base, px, py);
    if (refinado.error <= PICK_TOL_PX) return refinado.point;

    const mejor = refinado.error < errBase ? refinado.point : base;

    if (Math.min(refinado.error, errBase) > PICK_WARN_PX && !avisadoRelieve) {
      avisadoRelieve = true;
      onEditMessage(
        'This device cannot work out which point of the relief you are pointing at, so vertices placed in 3D may land well off the spot you touched. Turn 3D off to digitise; what you have already drawn is unaffected.',
        'warn',
      );
    }
    return mejor;
  };

  /*
   * Trazo libre. La caché vive en `stroke.js` con su porqué: convertir el
   * trazo entero en cada frame colgaba la página con el relieve 3D puesto,
   * porque ahí cada conversión es una lectura sincrónica de la GPU.
   */
  const STROKE_STEP_3D = 4; // px mínimos entre puntos convertidos, en 3D
  const stroke = createStrokeBuffer(toLngLat);

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
  /**
   * Factor entre la medida hecha sobre el mapa y la fórmula del zoom.
   *
   * Se aprende en planta, donde las dos vías valen, y se gasta con el relieve
   * puesto, donde solo vale la fórmula. Vale ~1: existe para no depender de
   * que MapLibre defina su zoom sobre teselas de 512 px, que es lo que la
   * medida sobre el mapa evitaba tener que suponer.
   */
  let mppFactor = 1;

  /** ¿Hay relieve real puesto ahora mismo? */
  function terrainOn() {
    try {
      return !!(map.getTerrain && map.getTerrain());
    } catch {
      return false;
    }
  }

  /**
   * Metros de terreno por píxel en el centro de la pantalla.
   *
   * EL RELIEVE OBLIGA A CAMBIAR DE VÍA, Y NO ES UN DETALLE
   *
   * Medir desproyectando dos puntos es lo correcto en planta, pero con
   * `setTerrain` puesto `unproject` deja de devolver el punto del plano y
   * devuelve el punto del SUELO: lanza el rayo contra la malla del relieve.
   * Sobre una ladera, dos píxeles contiguos pueden estar a mucha más distancia
   * en el terreno que en el mapa, así que lo medido ya no es la escala
   * cartográfica —que es plana, por definición— sino el largo de la pendiente.
   *
   * Eso rompía dos cosas a la vez. La lectura de la escala saltaba al pasar
   * sobre un cerro, y con la escala FIJADA el mapa se descontrolaba: la
   * corrección de `moveend` corregía contra un número que no dependía del zoom
   * como 2^-z, volvía a saltar, y en dos o tres rebotes el zoom se iba contra
   * el tope y ahí se quedaba clavado — con la rueda y el pellizco apagados por
   * el propio candado, y sin manera de salir. Era el "se queda pegado".
   *
   * Con relieve se usa la fórmula del zoom, que es plana por construcción.
   */
  function metresPerPixelNow() {
    const plano = metresPerPixel(map.getZoom(), map.getCenter().lat);
    if (!Number.isFinite(plano) || plano <= 0) return NaN;

    if (!terrainOn()) {
      const c = map.getContainer();
      const y = c.clientHeight / 2;
      const x = c.clientWidth / 2;
      const a = map.unproject([x - 50, y]);
      const b = map.unproject([x + 50, y]);
      const medido = haversine([a.lng, a.lat], [b.lng, b.lat]) / 100;
      if (Number.isFinite(medido) && medido > 0) {
        const k = medido / plano;
        // Un factor lejos de 1 es un error de lectura, no una convención
        // distinta: no se aprende de él.
        if (k > 0.5 && k < 2) mppFactor = k;
        return medido;
      }
    }
    return plano * mppFactor;
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
    // La caja de zoom no entra: está apagada siempre (ver arriba), y meterla
    // aquí la resucitaría al quitar el candado.
    const gestos = [map.scrollZoom, map.touchZoomRotate];
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

  /*
   * Candado contra la reentrada.
   *
   * `jumpTo` dispara `moveend` EN EL ACTO y de forma síncrona, así que la
   * corrección se llamaba a sí misma desde dentro de sí misma. Mientras
   * converge no se nota; en cuanto deja de converger —o el zoom topa con su
   * límite y la corrección ya no puede acercarse— es una escalera de saltos
   * que deja el mapa donde no se pidió. Corregir una vez por movimiento es
   * todo lo que hace falta: si quedara desviado, el propio salto genera otro
   * `moveend` cuando este termine.
   */
  let corrigiendo = false;
  map.on('moveend', () => {
    if (!corrigiendo) {
      const fijada = store.getState().scaleLock;
      // Mantener la escala al desplazarse: el denominador depende del coseno
      // de la latitud, así que un paneo norte-sur la corre sin tocar el zoom.
      if (fijada && scaleDrifted(currentDenominator(), fijada)) {
        corrigiendo = true;
        try {
          goToScale(fijada, { animate: false });
        } finally {
          corrigiendo = false;
        }
      }
    }
    publishScale(true);
    // El reparto de rótulos depende del encuadre, así que se rehace al acabar
    // de mover y no durante: durante el gesto no se lee, y hacerlo por cuadro
    // costaría proyectar todos los polígonos sesenta veces por segundo.
    syncUnitLabels();
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
      // Dónde está el vértice ahora mismo: es la semilla del arrastre en 3D.
      // Ver `moveVertexDrag`.
      at: lngLat,
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
      if (ins) insertAndDrag(ins, toLngLat(ins.screen, ins.seed));
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
      drag = {
        targets: targetsFor(handle),
        base: st.features,
        history: st.features,
        at: handle.lngLat,
      };
      collectSnapSources();
      return;
    }

    // Sobre un punto medio: se inserta el vértice y se arrastra el nuevo.
    const mid = findHandle(midpoints, screen, 16);
    if (mid) insertAndDrag(mid, mid.lngLat);
  }

  /**
   * Arrastre de una manija, cuadro a cuadro.
   *
   * `drag.at` —dónde estaba el vértice en el fotograma anterior— se le pasa a
   * `toLngLat` como semilla, y eso es lo que hace que editar nodos sobre el
   * relieve 3D sea usable: sin ella cada movimiento resuelve el rayo con
   * `unproject`, que obliga a leer el framebuffer de la GPU (medido, 4,7 s
   * por llamada con relieve). Con la semilla la conversión se hace con
   * aritmética sobre el DEM que ya está en memoria. En 2D no cambia nada: ahí
   * `toLngLat` ni mira la semilla.
   */
  function moveVertexDrag(screen) {
    if (!drag) return;
    const snap = snapAt(screen);
    showSnapMarker(snap);
    const lngLat = toLngLat(snap ? snap.point : screen, drag.at);
    drag.at = lngLat;
    store.setFeatures(moveVertices(drag.base, drag.targets, lngLat));
  }

  /* ---------- selección ---------- */

  function pickAt(screen, tolerance = 16) {
    return pickFeature(store.getState().features, screen, projectLngLat, tolerance);
  }

  /**
   * UN TOQUE SELECCIONA LO QUE HAY DEBAJO; SI NO HAY NADA, DESELECCIONA.
   *
   * Es el mismo camino para el clic del ratón y para el toque del dedo o del
   * lápiz, y por eso vive aquí y no dentro del manejador de MapLibre: los dos
   * tienen que decidir lo mismo, y lo único que cambia entre ellos es cuánta
   * puntería se les exige (`tolerance`) y si el modificador de selección
   * múltiple está pulsado, que un dedo no tiene.
   *
   * @returns {boolean} si el toque cayó sobre algo
   */
  /* ---------- lazo rectangular de Elegir ---------- */

  const lassoEl = document.getElementById('lasso');

  /** Cuánto hay que correrse para que un toque pase a ser lazo, en px. */
  const LASSO_MIN_PX = 6;

  let lasso = null;

  function beginLasso(screen) {
    lasso = { start: screen, box: null };
  }

  /**
   * Un arrastre corto no es un lazo: es un toque con pulso. Hasta pasar el
   * umbral no se pinta nada, y si nunca se pasa, `endLasso` lo resuelve como
   * la selección de siempre — que es lo que hace que seguir eligiendo con un
   * clic simple funcione igual que antes de que existiera el lazo.
   */
  function moveLasso(screen) {
    if (!lasso) return;
    const [x0, y0] = lasso.start;
    if (!lasso.box && Math.hypot(screen[0] - x0, screen[1] - y0) < LASSO_MIN_PX) return;

    const box = [
      Math.min(x0, screen[0]),
      Math.min(y0, screen[1]),
      Math.max(x0, screen[0]),
      Math.max(y0, screen[1]),
    ];
    lasso.box = box;
    lassoEl.hidden = false;
    lassoEl.style.left = `${box[0]}px`;
    lassoEl.style.top = `${box[1]}px`;
    lassoEl.style.width = `${box[2] - box[0]}px`;
    lassoEl.style.height = `${box[3] - box[1]}px`;
  }

  function hideLasso() {
    lasso = null;
    lassoEl.hidden = true;
  }

  /**
   * @param {[number, number]} screen  dónde se soltó
   * @param {{moved: boolean, longPressed: boolean}} info
   * @param {boolean} additive  con Shift: suma a lo ya marcado
   */
  function endLasso(screen, info, additive) {
    const l = lasso;
    hideLasso();
    /*
     * Tapón del clic sintético, el mismo que usa `onFingerTap`: el navegador
     * puede mandar un `click` detrás del gesto, y MapLibre lo atendería
     * seleccionando OTRA VEZ — deshaciendo el lazo recién hecho y dejando
     * marcado solo lo que hubiera bajo el punto donde se soltó.
     */
    taponPunteroAt = performance.now();
    // La pulsación sostenida ya abrió el menú de propiedades; resolver además
    // una selección aquí lo cerraría de inmediato.
    if (!l || (info && info.longPressed)) return;

    if (!l.box) {
      /*
       * No llegó a ser un lazo: un clic elige uno y reemplaza, y con Shift
       * alterna, que es como selecciona cualquier escritorio. La tolerancia
       * es la del dedo cuando lo que tocó fue un dedo: un contacto es una
       * línea de dos píxeles de ancho y la yema cubre cuarenta.
       */
      const dedo = info && info.pointerType && info.pointerType !== 'mouse';
      selectAt(screen, { additive, tolerance: dedo ? FINGER_PICK_PX : 12 });
      return;
    }

    const ids = featuresInBox(store.getState().features, l.box, projectLngLat);
    if (additive) {
      const ya = new Set(store.getState().selection);
      for (const id of ids) ya.add(id);
      store.setSelection([...ya]);
    } else {
      store.setSelection(ids);
    }
  }

  function selectAt(screen, { tolerance = 12, additive = false } = {}) {
    const hit = pickAt(screen, tolerance);
    if (hit) {
      const id = hit.properties.id;
      if (additive) store.toggleSelection(id);
      else store.setSelection([id]);
      return true;
    }

    const spot = onStraboFeatureTap && straboHitAt(screen, tolerance);
    if (spot) {
      onStraboFeatureTap(spot, screen);
      return true;
    }

    // Afuera: se suelta lo que estuviera marcado. Es la salida de la selección
    // que siempre está disponible, y en tablet la única que no pide teclado.
    if (store.getState().selection.length) store.clearSelection();
    return false;
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
    /*
     * Qué elemento describe el menú. Con varios seleccionados y el clic
     * derecho sobre UNO de ellos, el menú es de todos: es como se le cambia la
     * certeza a media docena de contactos de una vez. Pero si lo que hay
     * debajo NO está en la selección, manda lo que se está señalando — antes
     * se abría el menú de la selección anterior y parecía que el clic derecho
     * hubiera errado el elemento.
     *
     * Cada capa se busca en DOS pasadas y no en una sola holgada. La primera
     * con el radio fino: donde hay dos contactos juntos, gana el que se está
     * apuntando de verdad, y no el que quedó más cerca del centro de un
     * círculo de treinta píxeles. Solo si esa no encuentra nada se abre el
     * radio a `MENU_PICK_PX`, que es lo que hace que el clic derecho no falle
     * por medio milímetro contra una línea de dos píxeles de ancho.
     */
    const hit = pickAt(screen) || pickAt(screen, MENU_PICK_PX);
    const seleccion = store.getState().selection;
    if (hit && !seleccion.includes(hit.properties.id)) {
      store.setSelection([hit.properties.id]);
    }
    if (store.getState().selection.length > 0) {
      highlightForeign(null);
      onOpenProps(screen);
      return;
    }

    const spot =
      onStraboFeatureTap && (straboHitAt(screen) || straboHitAt(screen, MENU_PICK_PX));
    if (spot) {
      highlightForeign(null);
      onStraboFeatureTap(spot, screen);
      return;
    }

    const imported =
      onImportedFeatureTap && (importedHitAt(screen) || importedHitAt(screen, MENU_PICK_PX));
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

  /* ---------- cámara: mover la vista sin soltar la herramienta ---------- */

  /*
   * Los mismos grados por píxel que usa MapLibre al girar con el botón
   * derecho, para que arrastrar con Shift aquí y arrastrar en Navegar se
   * sientan igual. Bascular hacia arriba levanta la vista hacia el horizonte,
   * que es el sentido que tiene mirar un relieve.
   */
  const BEARING_PER_PX = 0.8;
  const PITCH_PER_PX = 0.5;
  const clampPitch = (v) => Math.max(map.getMinPitch(), Math.min(map.getMaxPitch(), v));

  const camera = {
    /** Mueve la cámara tantos píxeles de pantalla. */
    panBy(dx, dy) {
      map.panBy([dx, dy], { duration: 0 });
    },
    orbit(dBearing, dPitch) {
      map.jumpTo({
        bearing: map.getBearing() + dBearing,
        pitch: clampPitch(map.getPitch() + dPitch),
      });
    },
    zoom(delta) {
      map.easeTo({ zoom: map.getZoom() + delta, duration: 180 });
    },
    /** Vuelve al norte y a la planta, que es de donde se mide y se dibuja. */
    reset() {
      map.easeTo({ bearing: 0, pitch: 0, duration: 300 });
    },
  };

  const controller = new DrawController(host, container, {
    /*
     * Para el controlador, «dibujar» es quedarse el puntero. Elegir no lo
     * hace: en Elegir el arrastre con el botón primario TIENE que llegar al
     * mapa para que desplace, igual que en Navegar, y el clic derecho tiene
     * que abrir el menú en vez de cerrar un elemento que no existe.
     */
    isDrawing: () => !['navigate', 'select'].includes(store.getState().tool),
    fingerDrawEnabled: () => store.getState().fingerDraw,
    // Seleccionar es solo tocar: el trazo libre ahí no tendría sentido. Y en
    // rumbo/manteo solo lo admite el ajuste a una traza — con brújula o con
    // tres puntos, un trazo libre pondría cientos de puntos donde se esperan
    // uno o tres.
    //
    // El espesor es igual de tajante: es un solo toque sobre la otra
    // superficie. Sin esta excepción, el modo por defecto —mantener pulsado
    // arranca un trazo libre a los 320 ms— se cuela también aquí: un clic
    // sostenido un instante de más (no hace falta moverse; el temporizador de
    // `hold` no exige arrastre) convierte ese toque en el arranque de un
    // trazo libre, y como un trazo de un solo punto no llega a publicarse
    // (`onStrokeEnd` pide al menos dos), el segundo punto del espesor NUNCA
    // se registra: `thicknessFrom` queda puesto, la herramienta se queda en
    // «thickness» para siempre, y con ella el ancla punteada en el mapa y el
    // mapa entero capturado por el controlador de dibujo en vez de por
    // Elegir. Eso es justo lo que se veía como «el punteado no se quita» y
    // «Elegir se queda pegada» después de medir un espesor.
    freehandMode: () => {
      const st = store.getState();
      if (st.tool === 'select' || st.tool === 'thickness') return 'none';
      if (st.tool === 'measure' && st.measureMethod !== 'plane-fit') return 'none';
      return st.freehandMode;
    },
    /*
     * Con el relieve puesto, el `mousemove` de hover no llega a MapLibre
     * mientras hay una herramienta activa: no lo necesita y le cuesta una
     * escena entera. Ver `swallow` en drawController.js.
     */
    suppressHover: () => store.getState().terrain3d,
    // Nodos arrastra manijas. Elegir arrastra el lazo rectangular, que no es
    // dibujo y por eso entra por su propia puerta (ver `lassoMode` en
    // drawController.js); el mapa se sigue moviendo con dos dedos, o saliendo
    // a Navegar.
    dragMode: () => store.getState().tool === 'vertices',
    lassoMode: () => store.getState().tool === 'select',
    onDragStart: (p) => {
      if (onMapTap) onMapTap();
      if (store.getState().tool === 'select') return beginLasso(p);
      return beginVertexDrag(p);
    },
    onDragMove: (p) => (store.getState().tool === 'select' ? moveLasso(p) : moveVertexDrag(p)),
    onDragEnd: (p, info) =>
      store.getState().tool === 'select'
        ? endLasso(p, info, !!(info && info.shiftKey))
        : endVertexDrag(p, info),
    // Un segundo dedo aborta el gesto: la goma del lazo tiene que irse con él.
    onDragCancel: () => hideLasso(),
    // Mantener pulsado abre el menú de propiedades en cualquier herramienta:
    // es el gesto para tocar los atributos de lo que ya está dibujado sin
    // tener que cambiar a Elegir y volver.
    onLongPress: (p) => {
      if (onMapTap) onMapTap();
      openPropsFor(p);
    },

    /*
     * CLIC DERECHO: CERRAR LO QUE SE ESTÁ DIBUJANDO O, SI NO HAY NADA
     * ABIERTO, ABRIR EL MENÚ.
     *
     * Antes la decisión la tomaba el controlador mirando la HERRAMIENTA: con
     * cualquiera que no fuera Navegar o Elegir, el clic derecho cerraba el
     * elemento y ahí se acababa. Con una línea seleccionada y Edit Nodes en
     * la mano —justo cuando uno quiere el menú— no pasaba nada en absoluto.
     *
     * Lo que manda no es la herramienta sino si hay un elemento a medio
     * trazar: con borrador, el clic derecho lo cierra, igual que en QGIS; sin
     * borrador no hay nada que cerrar y el menú es lo único que tiene
     * sentido. Vale en 2D y en 3D: es el mismo mapa y el mismo controlador.
     */
    onSecondary: (p) => {
      const st = store.getState();
      if (st.draft && st.draft.coords.length > 0) {
        store.finishDraft();
        return;
      }
      if (onMapTap) onMapTap();
      openPropsFor(p);
    },

    // El botón central desplaza. (Shift+arrastrar giraba y basculaba; ahora
    // Shift es el modificador de selección múltiple.)
    onCameraDrag: (mode, dx, dy) => {
      /*
       * Mover la vista NO cierra los paneles, al revés que tocar el mapa: se
       * bascula el relieve justo mientras se ajusta su exageración en Capas, y
       * cerrar el panel en el primer píxel de arrastre haría ese ajuste
       * imposible. Además esto corre en cada frame del gesto.
       */
      // Arrastrar mueve la cámara al revés que el puntero: el mapa sigue al dedo.
      if (mode === 'pan') camera.panBy(-dx, -dy);
      else camera.orbit(dx * BEARING_PER_PX, -dy * PITCH_PER_PX);
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
      stroke.reset();
    },

    onStrokeProgress: (screen) => {
      previewKind = 'freehand';
      preview = stroke.push(screen, store.getState().terrain3d ? STROKE_STEP_3D : 0);
      syncDraft();
    },

    onStrokeEnd: (screen) => {
      const { tolerance, smoothing, terrain3d } = store.getState();
      /*
       * Con el relieve puesto se simplifica sobre los puntos que YA están
       * convertidos, y el suavizado se aplica en lng/lat —igual que el del
       * menú de propiedades— en vez de generar en pantalla cuatro veces más
       * puntos y tener que convertirlos todos. Si no, levantar el lápiz
       * disparaba de golpe las cientos de lecturas de GPU que el trazo se
       * había ahorrado.
       */
      const enCache = terrain3d && stroke.screen.length >= 2;
      const crudo = enCache ? stroke.screen : screen;
      // Se simplifica en px (invariante a la escala) y recién ahí se proyecta.
      const processed = processStroke(crudo, {
        tolerance,
        smooth: enCache ? false : smoothing,
      });
      // Los extremos del trazo sí se enganchan: es donde importa que el
      // contacto cierre exactamente contra la geometría vecina.
      if (processed.length >= 2) {
        const first = snapAt(processed[0]);
        if (first) processed[0] = first.point;
        const last = snapAt(processed[processed.length - 1]) || traceSnapAt(processed[processed.length - 1]);
        if (last) processed[processed.length - 1] = last.point;
        traceAnchor = last ? toLngLat(last.point) : null;
      }
      let coords = enCache ? stroke.coordsFor(processed) : processed.map(toLngLat);
      if (enCache && smoothing && coords.length >= 3) coords = chaikin(coords, 2);
      stroke.reset();
      clearPreview();
      store.appendStroke(coords);
    },

    onFinish: () => store.finishDraft(),

    onFingerTap: (screen) => {
      taponPunteroAt = performance.now();
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

      // Sin nada en construcción, un toque limpio de dedo selecciona, y un
      // toque afuera deselecciona. Vale en cualquier herramienta, no solo en
      // Elegir: mientras el lápiz dibuja, el dedo es lo que se tiene a mano
      // para señalar un elemento.
      //
      // Uno a la vez, igual que el clic: el dedo no tiene Shift, así que en
      // tablet la selección múltiple se arma desde el menú de propiedades o
      // con `Ctrl+A`. Alternar por omisión hacía que el segundo toque dejara
      // dos elementos marcados sin haberlo pedido.
      //
      // La tolerancia es la del dedo y no la del ratón: un contacto es una
      // línea de dos píxeles de ancho y la yema cubre cuarenta.
      selectAt(screen, { tolerance: FINGER_PICK_PX });
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
    if (store.changed('planeTrace')) syncPlaneTrace();
    if (store.changed('thickness') || store.changed('thicknessFrom')) syncThickness();
    if (store.changed('units')) {
      applyUnitColors();
      syncUnitLabels();
    }
    if (store.changed('unitLabels')) syncUnitLabels();
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
    if (store.changed('features')) {
      syncGeology();
      syncUnitLabels();
    }
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
    }
  });

  // Gancho de depuración: útil para inspeccionar el estilo desde la consola
  // de Safari en el propio iPad, donde no hay devtools cómodas, y para que
  // las pruebas de navegador puedan ejercitar el snapping real.
  // `Object.assign` y no una asignación limpia: la interfaz cuelga lo suyo del
  // mismo gancho, y quién arranca antes depende de cuándo cargue el estilo.
  window.__fielddraw = Object.assign(window.__fielddraw || {}, {
    map,
    // La captura de la lámina: se expone para poder comprobar desde una prueba
    // de navegador que el aplanado y el marco salen bien con la vista girada y
    // con el relieve puesto, que son los dos casos que a mano no se prueban.
    captureForExport,
    // De pantalla al terreno. Se expone porque es lo que hay que mirar cuando
    // en un dispositivo concreto los vértices caen corridos en 3D —el aviso de
    // `toLngLat` habla justo de eso— y ahí no suele haber devtools a mano:
    // desde la consola se comparan las dos vías, con semilla y sin ella.
    toLngLat,
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
  });

  /* ---------- la lámina ---------- */

  /**
   * La vista, medida y capturada, lista para componer una lámina.
   *
   * SE CAPTURA EN PLANTA, SIEMPRE. Con la cámara basculada o con el relieve
   * 3D puesto no hay una escala del mapa —cada franja de la pantalla tiene la
   * suya— ni un marco de coordenadas que valga, porque los bordes de la
   * pantalla dejan de ser rectas del terreno. Una lámina así mentiría en las
   * dos cosas que la hacen un mapa. Así que si hace falta se aplana, se
   * captura y se devuelve la vista tal como estaba; `flattened` lo dice, para
   * que la interfaz pueda avisar de por qué la figura no es lo que se veía.
   *
   * La captura del lienzo va DENTRO del manejador de `render` y no después.
   * El mapa se dibuja sin `preserveDrawingBuffer` —ponerlo cuesta una copia
   * del framebuffer en cada cuadro, y eso en una tablet se nota todo el rato
   * para algo que se usa una vez— y sin él, el contenido del lienzo solo es
   * legible dentro del cuadro en que se pintó. Un `await` de por medio y sale
   * una imagen en blanco.
   */
  async function captureForExport() {
    if (!ready) throw new Error('The map is still loading.');

    const antes = {
      pitch: map.getPitch(),
      terreno: !!(map.getTerrain && map.getTerrain()),
    };
    const aplanar = antes.pitch > 0.01 || antes.terreno;
    if (aplanar) {
      if (antes.terreno) map.setTerrain(null);
      map.jumpTo({ pitch: 0 });
    }

    try {
      // Aplanar puede pedir teselas que no estaban: se espera a que el mapa se
      // quede quieto, pero con tope. Una lámina con una tesela a medio cargar
      // es mejor que un botón que no responde.
      await waitForIdle(4000);

      const image = await new Promise((resolve, reject) => {
        const reloj = setTimeout(() => reject(new Error('the map did not finish drawing')), 8000);
        map.once('render', () => {
          clearTimeout(reloj);
          try {
            resolve(map.getCanvas().toDataURL('image/png'));
          } catch (err) {
            reject(err);
          }
        });
        map.triggerRepaint();
      });

      const lienzo = map.getCanvas();
      const caja = map.getContainer();
      const w = caja.clientWidth;
      const h = caja.clientHeight;
      const c = map.getCenter();

      return {
        image,
        pixelWidth: lienzo.width,
        pixelHeight: lienzo.height,
        width: w,
        height: h,
        bearing: map.getBearing(),
        center: [c.lng, c.lat],
        metresPerPixel: metresPerPixelNow(),
        denominator: currentDenominator(),
        edges: edgeSamples(w, h),
        flattened: aplanar,
      };
    } finally {
      if (aplanar) {
        map.jumpTo({ pitch: antes.pitch });
        if (antes.terreno) applyTerrain();
      }
    }
  }

  function waitForIdle(ms) {
    if (map.loaded() && !map.isMoving()) return Promise.resolve();
    return new Promise((resolve) => {
      const listo = () => {
        clearTimeout(reloj);
        map.off('idle', listo);
        resolve();
      };
      const reloj = setTimeout(listo, ms);
      map.on('idle', listo);
    });
  }

  /**
   * La longitud y la latitud a lo largo de los cuatro bordes de la pantalla.
   *
   * Es lo que el marco necesita para saber dónde cortan las líneas del
   * graticulado, y se entrega muestreado en vez de resuelto porque así el
   * mismo cálculo vale con el mapa al norte y con el mapa girado: el borde
   * superior de una vista girada no es una línea de latitud constante, y
   * cualquier fórmula cerrada tendría que tratar los dos casos por separado.
   *
   * Cada cuatro píxeles: el error de interpolar entre dos muestras a esa
   * distancia es muy inferior al píxel, y son unas mil llamadas a `unproject`
   * en total, que sin relieve es aritmética pura.
   */
  function edgeSamples(w, h, paso = 4) {
    const recorrer = (largo, punto, comp) => {
      const out = [];
      for (let t = 0; t <= largo; t += paso) {
        const ll = map.unproject(punto(t));
        out.push({ t, v: comp === 'lng' ? ll.lng : ll.lat });
      }
      if (out.length === 0 || out[out.length - 1].t < largo) {
        const ll = map.unproject(punto(largo));
        out.push({ t: largo, v: comp === 'lng' ? ll.lng : ll.lat });
      }
      return out;
    };
    return {
      top: recorrer(w, (t) => [t, 0], 'lng'),
      bottom: recorrer(w, (t) => [t, h], 'lng'),
      left: recorrer(h, (t) => [0, t], 'lat'),
      right: recorrer(h, (t) => [w, t], 'lat'),
    };
  }

  return {
    map,
    locateMe,
    /** La vista capturada y medida, para exportarla como lámina. */
    captureForExport,
    /** Lleva el mapa a una escala concreta, sin fijarla. */
    goToScale,
    /** Desplazar, girar, bascular y acercar desde el teclado. */
    camera,
    /** Quita el resalte del elemento ajeno; lo llama la interfaz al cerrar. */
    clearForeignHighlight: () => highlightForeign(null),
    /** Encuadra una polilínea: lo usa el perfil de una línea ya dibujada. */
    /**
     * Encuadra una polilínea. `padding` admite el objeto de MapLibre —`{top,
     * bottom, left, right}`— para dejar sitio a un panel abierto: encuadrar
     * sobre el centro de la ventana cuando la mitad de abajo está tapada
     * coloca justo lo que hay que mirar debajo del panel.
     */
    fitToCoords(coords, padding) {
      if (!Array.isArray(coords) || coords.length === 0) return;
      fitToGeoJSON(
        {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
          ],
        },
        padding,
      );
    },
    /**
     * Igual que `fitToCoords`, pero no mueve la vista si la polilínea ya cabe
     * entera en lo que se ve.
     *
     * La traza que sale de un corte del DEM se dibuja donde ya se estaba
     * mirando —el usuario tocó una medida ahí mismo—, así que la mayoría de
     * las veces cabe sola. Encuadrar siempre, sin preguntar, alejaba la vista
     * de golpe aunque la traza entera ya estuviera a la vista: un salto que no
     * hacía falta. Aquí solo se toca el zoom cuando de verdad se sale de
     * pantalla, y ahí sí se ajusta a su largo total y no más.
     */
    fitToCoordsIfOffscreen(coords, padding) {
      if (!Array.isArray(coords) || coords.length === 0) return;
      const bounds = coordBounds(coords);
      if (!bounds) return;
      const visible = map.getBounds();
      if (visible.contains(bounds.getNorthEast()) && visible.contains(bounds.getSouthWest())) {
        return;
      }
      map.fitBounds(bounds, { padding, maxZoom: 16, duration: 700 });
    },
    destroy() {
      controller.destroy();
      map.remove();
    },
  };
}
