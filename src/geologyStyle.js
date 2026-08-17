import { CERTAINTIES, LINE_TYPES, POLYGON_TYPES } from './symbology.js';

export const GEOLOGY_SOURCE = 'geology-src';
export const DRAFT_SOURCE = 'draft-src';

const lineColorExpr = [
  'match',
  ['get', 'type'],
  ...LINE_TYPES.flatMap((t) => [t.id, t.color]),
  '#888888',
];

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
    // Halo blanco: sin esto las líneas oscuras desaparecen sobre el satélite.
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
        ...(c.dash ? { 'line-dasharray': scaleDash(c.dash, 0.75) } : {}),
      },
    });
    BASE_OPACITY[casingId] = 0.55;

    const id = `geology-line-${c.id}`;
    layers.push({
      id,
      type: 'line',
      source: GEOLOGY_SOURCE,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'certainty'], c.id]],
      layout: { 'line-cap': c.cap, 'line-join': 'round' },
      paint: {
        'line-color': lineColorExpr,
        'line-width': lineWidthExpr,
        'line-opacity': 1,
        ...(c.dash ? { 'line-dasharray': c.dash } : {}),
      },
    });
    BASE_OPACITY[id] = 1;
  }

  return layers;
}

export const GEOLOGY_LAYER_IDS = geologyLayers().map((l) => l.id);

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

/** El casing es más ancho, así que su dasharray debe encogerse para calzar. */
function scaleDash(dash, f) {
  return dash.map((d) => Math.max(0.05, d * f));
}
