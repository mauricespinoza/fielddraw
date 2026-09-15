import { CERTAINTIES, LINE_TYPES, POLYGON_TYPES, effectiveLineColor } from './symbology.js';

export const GEOLOGY_SOURCE = 'geology-src';
export const DRAFT_SOURCE = 'draft-src';

/**
 * El color de las líneas también cambia en caliente: el módulo de simbología
 * deja reescribir el de los tipos con ornamento, y mapView reaplica esta
 * expresión igual que hace con el relleno de las unidades.
 */
export function lineColorExpr(ornaments) {
  return [
    'match',
    ['get', 'type'],
    ...LINE_TYPES.flatMap((t) => [t.id, effectiveLineColor(t.id, ornaments)]),
    '#888888',
  ];
}

const defaultLineColorExpr = lineColorExpr(null);

const lineWeightExpr = [
  'match',
  ['get', 'type'],
  ...LINE_TYPES.flatMap((t) => [t.id, t.weight]),
  1,
];

/**
 * MapLibre exige que la expresión `zoom` sea entrada directa de un
 * `interpolate` de nivel superior: envolverla en un `*` invalida la propiedad
 * y el ancho cae silenciosamente al valor por defecto. Por eso el factor por
 * tipo se aplica dentro de cada parada, no por fuera.
 */
function zoomWidth(at) {
  return ['interpolate', ['linear'], ['zoom'], 8, at(1.5), 13, at(2.4), 18, at(4.2)];
}

const zoomWidthExpr = zoomWidth((v) => v);
const lineWidthExpr = zoomWidth((v) => ['*', lineWeightExpr, v]);
const casingWidthExpr = zoomWidth((v) => ['+', ['*', lineWeightExpr, v], 2.4]);

/**
 * El color de los polígonos sale de las unidades definidas por el usuario, que
 * cambian en caliente: mapView reescribe estas expresiones cada vez que se
 * edita el módulo de unidades.
 */
export function unitFillExpr(units) {
  const list = units && units.length ? units : POLYGON_TYPES.map((t) => ({ id: t.id, color: t.color }));
  return ['match', ['get', 'type'], ...list.flatMap((u) => [u.id, u.color]), '#999999'];
}

/**
 * El texto del rótulo: el código de la unidad a la que pertenece el polígono.
 *
 * Se resuelve por el catálogo de unidades y no por el atributo `code` del
 * elemento, por el mismo motivo que el color: renombrar el código de una
 * unidad tiene que verse en el mapa en el acto, sin tocar cada polígono. El
 * atributo del elemento queda de reserva para lo que venga de fuera con un
 * código propio y sin unidad que lo respalde.
 */
export function unitCodeExpr(units) {
  const reserva = ['coalesce', ['get', 'code'], ''];
  const list = (units || []).filter((u) => u && u.id);
  if (!list.length) return reserva;
  return ['match', ['get', 'type'], ...list.flatMap((u) => [u.id, String(u.code || '')]), reserva];
}

export function unitOutlineExpr(units) {
  const list = units && units.length ? units : POLYGON_TYPES.map((t) => ({ id: t.id, color: t.color }));
  return ['match', ['get', 'type'], ...list.flatMap((u) => [u.id, shade(u.color)]), '#555555'];
}

const fillColorExpr = unitFillExpr(null);
const outlineColorExpr = unitOutlineExpr(null);

/**
 * Opacidad propia de cada elemento, editable desde el menú de propiedades.
 * Se multiplica por la opacidad de la capa, así que ambas se componen.
 */
export const FEATURE_ALPHA = ['coalesce', ['get', 'opacity'], 1];

/** Combina la opacidad de capa (número) con la del elemento (dato). */
export function withFeatureAlpha(value) {
  return ['*', value, FEATURE_ALPHA];
}

/**
 * Opacidad base de cada capa. El slider del panel multiplica sobre esto, para
 * que el relleno de polígono no tape el basemap ni estando "al 100%".
 */
export const BASE_OPACITY = {};

/**
 * `line-dasharray` no admite expresiones data-driven en MapLibre, así que el
 * grado de certeza se resuelve con una capa por patrón, filtrada por atributo.
 */
export function geologyLayers() {
  const layers = [];

  layers.push({
    id: 'geology-fill',
    type: 'fill',
    source: GEOLOGY_SOURCE,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': fillColorExpr, 'fill-opacity': 0.45 },
  });
  BASE_OPACITY['geology-fill'] = 0.45;

  // Resalte de selección: va debajo del trazo real para leerse como un halo.
  // El filtro lo reescribe mapView cada vez que cambia la selección.
  layers.push({
    id: 'geology-selected',
    type: 'line',
    source: GEOLOGY_SOURCE,
    filter: ['in', ['get', 'id'], ['literal', []]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#00E5FF',
      'line-width': zoomWidth((v) => v + 7),
      'line-opacity': 0.75,
      'line-blur': 1.5,
    },
  });
  BASE_OPACITY['geology-selected'] = 0.75;

  for (const c of CERTAINTIES) {
    const id = `geology-outline-${c.id}`;
    layers.push({
      id,
      type: 'line',
      source: GEOLOGY_SOURCE,
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'certainty'], c.id]],
      layout: { 'line-cap': c.cap, 'line-join': 'round' },
      paint: {
        'line-color': outlineColorExpr,
        'line-width': zoomWidthExpr,
        'line-opacity': 0.95,
        ...(c.dash ? { 'line-dasharray': c.dash } : {}),
      },
    });
    BASE_OPACITY[id] = 0.95;
  }

  for (const c of CERTAINTIES) {
    /*
     * Halo blanco: sin esto las líneas oscuras desaparecen sobre el satélite.
     *
     * Solo lo llevan las líneas CONTINUAS. En una segmentada o punteada el
     * halo es un segundo patrón de guiones por detrás del primero, más ancho y
     * con la escala corregida, así que nunca calza: los guiones blancos asoman
     * entre los del trazo y el patrón de certeza —que es justo lo que hay que
     * distinguir a ojo— se lee emborronado. Una línea segmentada ya se separa
     * del fondo por su propio ritmo.
     */
    if (!c.dash) {
      const casingId = `geology-line-casing-${c.id}`;
      layers.push({
        id: casingId,
        type: 'line',
        source: GEOLOGY_SOURCE,
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'certainty'], c.id]],
        layout: { 'line-cap': c.cap, 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': casingWidthExpr,
          'line-opacity': 0.55,
        },
      });
      BASE_OPACITY[casingId] = 0.55;
    }

    const id = `geology-line-${c.id}`;
    layers.push({
      id,
      type: 'line',
      source: GEOLOGY_SOURCE,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'certainty'], c.id]],
      layout: { 'line-cap': c.cap, 'line-join': 'round' },
      paint: {
        'line-color': defaultLineColorExpr,
        'line-width': lineWidthExpr,
        'line-opacity': 1,
        ...(c.dash ? { 'line-dasharray': c.dash } : {}),
      },
    });
    BASE_OPACITY[id] = 1;
  }

  /*
   * EL CÓDIGO DE LA UNIDAD, ROTULADO SOBRE EL POLÍGONO.
   *
   * Va la última —encima de todo lo demás del dibujo— y apagada de fábrica:
   * un mapa de terreno a medio levantar tiene decenas de polígonos pequeños y
   * rotularlos todos lo vuelve ilegible justo cuando hace falta ver la
   * geometría. Se enciende cuando el mapa ya se está leyendo, no mientras se
   * dibuja.
   *
   * QUIÉN LLEVA ETIQUETA NO SE DECIDE AQUÍ. El filtro nace vacío y lo
   * reescribe mapView con la lista de polígonos que en ESTE encuadre son lo
   * bastante grandes para que quepa el rótulo dentro, y solo con los más
   * grandes de ellos: ver `syncUnitLabels`. La razón de hacerlo por lista y no
   * con una expresión es que «lo bastante grande» se mide en píxeles de
   * pantalla, y eso depende del zoom, de la latitud y de la forma del
   * polígono, que ninguna expresión de estilo sabe calcular.
   *
   * `symbol-placement: point` sobre un polígono hace que MapLibre coloque el
   * rótulo en el polo de inaccesibilidad —el punto más adentro—, así que la
   * etiqueta cae DENTRO de la unidad aunque sea cóncava, y no en el centroide,
   * que en una unidad en forma de arco queda fuera.
   */
  layers.push({
    id: 'geology-unit-label',
    type: 'symbol',
    source: GEOLOGY_SOURCE,
    filter: ['in', ['get', 'id'], ['literal', []]],
    layout: {
      'symbol-placement': 'point',
      'text-field': unitCodeExpr(null),
      'text-font': ['Noto Sans Regular'],
      'text-size': 13,
      'text-padding': 6,
      // Sin solape y sin recorte por el borde: una etiqueta a medias miente
      // sobre qué unidad rotula.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      // El rótulo se lee horizontal aunque la vista esté girada: es una
      // etiqueta, no un elemento del terreno.
      'text-rotation-alignment': 'viewport',
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#12181f',
      'text-halo-color': 'rgba(255,255,255,0.92)',
      'text-halo-width': 1.6,
    },
  });
  BASE_OPACITY['geology-unit-label'] = 1;

  return layers;
}

export const GEOLOGY_LAYER_IDS = geologyLayers().map((l) => l.id);

/** La capa de rótulos de unidad, que mapView enciende y filtra. */
export const UNIT_LABEL_LAYER_ID = 'geology-unit-label';

/** Capas cuyo `line-color` sale del catálogo de tipos de línea. */
export const GEOLOGY_LINE_LAYER_IDS = CERTAINTIES.map((c) => `geology-line-${c.id}`);

/** Capas del elemento en construcción: siempre por encima de todo. */
export function draftLayers() {
  return [
    {
      id: 'draft-fill',
      type: 'fill',
      source: DRAFT_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#00E5FF', 'fill-opacity': 0.18 },
    },
    {
      id: 'draft-casing',
      type: 'line',
      source: DRAFT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#00131a', 'line-width': 6, 'line-opacity': 0.5 },
    },
    {
      id: 'draft-line',
      type: 'line',
      source: DRAFT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#00E5FF', 'line-width': 2.6 },
    },
    {
      id: 'draft-vertices',
      type: 'circle',
      source: DRAFT_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#00E5FF',
        'circle-stroke-width': 2.5,
      },
    },
  ];
}

export const EDIT_SOURCE = 'edit-src';

/**
 * Manijas de la herramienta de vértices. Los compartidos van en magenta: es la
 * señal de que, con edición topológica activa, moverlos arrastra también al
 * polígono vecino.
 */
export function editLayers() {
  return [
    {
      id: 'edit-midpoints',
      type: 'circle',
      source: EDIT_SOURCE,
      filter: ['==', ['get', 'kind'], 'mid'],
      paint: {
        'circle-radius': 3.5,
        'circle-color': 'rgba(255,255,255,0.55)',
        'circle-stroke-color': '#2dd4bf',
        'circle-stroke-width': 1.2,
      },
    },
    {
      id: 'edit-vertices',
      type: 'circle',
      source: EDIT_SOURCE,
      filter: ['all', ['==', ['get', 'kind'], 'vertex'], ['!=', ['get', 'shared'], true]],
      paint: {
        'circle-radius': 5.5,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#2dd4bf',
        'circle-stroke-width': 2.4,
      },
    },
    {
      id: 'edit-vertices-shared',
      type: 'circle',
      source: EDIT_SOURCE,
      filter: ['all', ['==', ['get', 'kind'], 'vertex'], ['==', ['get', 'shared'], true]],
      paint: {
        'circle-radius': 6,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#ff2fd0',
        'circle-stroke-width': 2.8,
      },
    },
  ];
}

export const EDIT_LAYER_IDS = editLayers().map((l) => l.id);

export const DRAFT_LAYER_IDS = draftLayers().map((l) => l.id);

/** Oscurece un hex para usarlo como borde del relleno del mismo tipo. */
function shade(hex, factor = 0.62) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
