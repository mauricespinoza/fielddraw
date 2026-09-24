import { GEOLOGY_SOURCE } from './geologyStyle.js';
import {
  CONTROL_POINT_ICONS,
  CONTROL_POINT_ICON_BY_ID,
  CONTROL_POINT_KIND,
  CONTROL_POINT_NO_UNIT_COLOR,
  LABEL_FIELD_BY_ID,
  defaultControlPointStyle,
} from './controlPoints.js';
import { IMPORTED_FILTER, defaultImportStyle } from './symbology.js';

/**
 * Cómo se dibuja un punto de control: un icono (círculo por omisión, o la forma
 * elegida en el panel de simbología) del COLOR DE SU UNIDAD, con
 * el rótulo del campo que se haya elegido.
 *
 * El color sale del catálogo de unidades —el mismo que pinta los polígonos— y
 * no de una paleta propia, para que un punto tomado sobre la Formación Abanico
 * y el polígono de Abanico se vean del mismo color: si no coinciden, el mapa
 * obliga a leer la leyenda dos veces para contestar la misma pregunta.
 *
 * **Lo adoptado de StraboSpot conserva su color de unidad** y se distingue por
 * el BORDE, no por el relleno. Es la excepción a la regla del color único de
 * `importStyle`: en una línea o un polígono el color único quita el tipo, que
 * se sigue leyendo en el ornamento o en el rótulo; aquí quitaría justamente la
 * unidad, que es lo único que este símbolo dice. Con el borde, las dos cosas
 * caben —de qué unidad es, y que viene de la libreta de otra persona.
 */

const NO_UNIT = CONTROL_POINT_NO_UNIT_COLOR;

/** Relleno: el color de la unidad del punto, por id. */
export function controlPointColorExpr(units) {
  const list = (units || []).filter((u) => u && u.id);
  if (!list.length) return NO_UNIT;
  return ['match', ['coalesce', ['get', 'unitId'], ''], ...list.flatMap((u) => [u.id, u.color]), NO_UNIT];
}

/** Borde: morado en lo traído de StraboSpot, oscuro en lo propio. */
export function controlPointStrokeExpr(importStyle = defaultImportStyle()) {
  if (!importStyle.uniform) return '#0d1117';
  return ['case', IMPORTED_FILTER, importStyle.color, '#0d1117'];
}

/**
 * Texto del rótulo. `none` devuelve la cadena vacía y no esconde la capa: una
 * capa apagada dejaría de reservar sitio y los puntos se pisarían al volver a
 * encenderla.
 */
export function controlPointLabelExpr(labelField) {
  const campo = LABEL_FIELD_BY_ID.get(labelField) || LABEL_FIELD_BY_ID.get('sampleId');
  if (!campo || !campo.prop) return '';
  return ['coalesce', ['get', campo.prop], ''];
}

/* ---------- iconos ---------- */

/**
 * Los iconos son campos de distancia (SDF) y no dibujos a color: así MapLibre
 * los pinta del color de la unidad con `icon-color` y les pone el borde con
 * `icon-halo-*`, sin rasterizar una copia por unidad y por forma.
 *
 * El campo sigue la codificación de TinySDF que usa MapLibre: el borde de la
 * forma cae en 0,75 y cada píxel CSS hacia fuera resta 1/8 a icono de tamaño 1.
 */
const ICON_PR = 2; // pixelRatio: nítido en pantallas retina
const ICON_PX = 64; // lado de la imagen, en píxeles de imagen
const ICON_R = 22; // radio de la forma, en píxeles de imagen (11 px CSS)
/** Radio en píxeles CSS de la forma a `icon-size` 1. */
export const CONTROL_POINT_ICON_RADIUS = ICON_R / ICON_PR;

const regular = (n, r = 1, rot = -Math.PI / 2) =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  });

const star = () =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.45 : 1.05;
    return [r * Math.cos(a), r * Math.sin(a)];
  });

const cross = (w = 0.34) => [
  [-w, -1], [w, -1], [w, -w], [1, -w], [1, w], [w, w],
  [w, 1], [-w, 1], [-w, w], [-1, w], [-1, -w], [-w, -w],
];

/** Contorno de cada forma en coordenadas unitarias (y hacia abajo). */
export const ICON_SHAPES = {
  circle: null,
  square: [[-0.82, -0.82], [0.82, -0.82], [0.82, 0.82], [-0.82, 0.82]],
  triangle: regular(3, 1.1).map(([x, y]) => [x, y + 0.18]),
  diamond: regular(4, 1.05),
  star: star(),
  pentagon: regular(5, 0.98),
  cross: cross(),
};

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distancia con signo (negativa dentro) de un punto a la forma, en radios. */
export function shapeDistance(shape, x, y) {
  const poly = ICON_SHAPES[shape];
  if (!poly) return Math.hypot(x, y) - 1;
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    d = Math.min(d, segDist(x, y, xj, yj, xi, yi));
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? -d : d;
}

/** Imagen SDF de una forma, en el formato que acepta `map.addImage`. */
export function controlPointIconImage(shape) {
  const data = new Uint8Array(ICON_PX * ICON_PX * 4);
  const c = ICON_PX / 2;
  for (let py = 0; py < ICON_PX; py++) {
    for (let px = 0; px < ICON_PX; px++) {
      const d = shapeDistance(shape, (px + 0.5 - c) / ICON_R, (py + 0.5 - c) / ICON_R) * ICON_R;
      const a = Math.max(0, Math.min(1, 0.75 - d / (8 * ICON_PR)));
      const k = (py * ICON_PX + px) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(a * 255);
    }
  }
  return { width: ICON_PX, height: ICON_PX, data };
}

export const controlPointIconName = (id) => `cpoint-icon-${id}`;

/** Registra en el mapa las formas que falten. Barato: son siete imágenes. */
export function addControlPointIcons(map) {
  for (const i of CONTROL_POINT_ICONS) {
    const name = controlPointIconName(i.id);
    if (!map.hasImage(name)) {
      map.addImage(name, controlPointIconImage(i.id), { pixelRatio: ICON_PR, sdf: true });
    }
  }
}

const iconOf = (style) =>
  controlPointIconName(CONTROL_POINT_ICON_BY_ID.has(style.icon) ? style.icon : 'circle');

/** Mismo radio en pantalla que el círculo de antes: 4 px a z11, 7,5 px a z16. */
const iconSize = (size) => [
  'interpolate', ['linear'], ['zoom'],
  11, (4 * size) / CONTROL_POINT_ICON_RADIUS,
  16, (7.5 * size) / CONTROL_POINT_ICON_RADIUS,
];

const CONTROL_POINT_FILTER = [
  'all',
  ['==', ['geometry-type'], 'Point'],
  ['==', ['get', 'geomKind'], CONTROL_POINT_KIND],
];

export function controlPointLayers(
  style = defaultControlPointStyle(),
  units = [],
  importStyle = defaultImportStyle(),
) {
  return [
    // Halo de selección, hermano del de las medidas y el de las líneas.
    {
      id: 'control-point-selected',
      type: 'circle',
      source: GEOLOGY_SOURCE,
      filter: ['all', ...CONTROL_POINT_FILTER.slice(1), ['in', ['get', 'id'], ['literal', []]]],
      paint: {
        'circle-radius': 13,
        'circle-color': '#00E5FF',
        'circle-opacity': 0.35,
        'circle-blur': 0.5,
      },
    },
    {
      id: 'control-points',
      type: 'symbol',
      source: GEOLOGY_SOURCE,
      minzoom: style.minzoom,
      filter: CONTROL_POINT_FILTER,
      layout: {
        'icon-image': iconOf(style),
        'icon-size': iconSize(style.size),
        // Un punto de control no se descarta por chocar con otro: es un dato.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'viewport',
      },
      paint: {
        'icon-color': controlPointColorExpr(units),
        'icon-halo-color': controlPointStrokeExpr(importStyle),
        'icon-halo-width': 1.6,
        'icon-opacity': ['coalesce', ['get', 'opacity'], 1],
      },
    },
    {
      id: 'control-point-labels',
      /*
       * MISMO zoom mínimo que el punto, y no uno más alto como en las medidas.
       * El rótulo de una medida es un número de apoyo —el símbolo ya dice lo
       * suyo— pero aquí es lo único que identifica al punto: con el umbral en
       * 12, el primer punto que alguien coloca sale sin rótulo, porque la app
       * arranca en 11,5. Y eso no se lee como «está fuera de escala», se lee
       * como que la etiqueta no funciona.
       */
      type: 'symbol',
      source: GEOLOGY_SOURCE,
      minzoom: style.minzoom,
      filter: CONTROL_POINT_FILTER,
      layout: {
        'text-field': controlPointLabelExpr(style.labelField),
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        // Un código de muestra a medias —«ACRC» de «ACRC12»— nombra otra
        // muestra, así que antes que recortarlo se descarta el rótulo.
        'text-allow-overlap': false,
        'text-max-width': 10,
        'text-rotation-alignment': 'viewport',
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 1.4,
      },
    },
  ];
}

export const CONTROL_POINT_LAYER_IDS = controlPointLayers().map((l) => l.id);

/** Reaplica forma, color, tamaño, rótulo y zoom mínimo sin recrear las capas. */
export function applyControlPointStyle(map, style, units, importStyle) {
  if (map.getLayer('control-points')) {
    addControlPointIcons(map);
    map.setLayoutProperty('control-points', 'icon-image', iconOf(style));
    map.setLayoutProperty('control-points', 'icon-size', iconSize(style.size));
    if (units) map.setPaintProperty('control-points', 'icon-color', controlPointColorExpr(units));
    if (importStyle) {
      map.setPaintProperty('control-points', 'icon-halo-color', controlPointStrokeExpr(importStyle));
    }
    map.setLayerZoomRange('control-points', style.minzoom, 24);
  }
  if (map.getLayer('control-point-labels')) {
    map.setLayoutProperty('control-point-labels', 'text-field', controlPointLabelExpr(style.labelField));
    map.setLayerZoomRange('control-point-labels', style.minzoom, 24);
  }
}
