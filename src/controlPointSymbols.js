import { GEOLOGY_SOURCE } from './geologyStyle.js';
import {
  CONTROL_POINT_KIND,
  CONTROL_POINT_NO_UNIT_COLOR,
  LABEL_FIELD_BY_ID,
  defaultControlPointStyle,
} from './controlPoints.js';
import { IMPORTED_FILTER, defaultImportStyle } from './symbology.js';

/**
 * Cómo se dibuja un punto de control: un círculo del COLOR DE SU UNIDAD, con
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

const radius = (size) => ['interpolate', ['linear'], ['zoom'], 11, 4 * size, 16, 7.5 * size];

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
      type: 'circle',
      source: GEOLOGY_SOURCE,
      minzoom: style.minzoom,
      filter: CONTROL_POINT_FILTER,
      paint: {
        'circle-radius': radius(style.size),
        'circle-color': controlPointColorExpr(units),
        'circle-stroke-color': controlPointStrokeExpr(importStyle),
        'circle-stroke-width': 1.6,
        'circle-opacity': ['coalesce', ['get', 'opacity'], 1],
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

/** Reaplica color, tamaño, rótulo y zoom mínimo sin recrear las capas. */
export function applyControlPointStyle(map, style, units, importStyle) {
  if (map.getLayer('control-points')) {
    map.setPaintProperty('control-points', 'circle-radius', radius(style.size));
    if (units) map.setPaintProperty('control-points', 'circle-color', controlPointColorExpr(units));
    if (importStyle) {
      map.setPaintProperty('control-points', 'circle-stroke-color', controlPointStrokeExpr(importStyle));
    }
    map.setLayerZoomRange('control-points', style.minzoom, 24);
  }
  if (map.getLayer('control-point-labels')) {
    map.setLayoutProperty('control-point-labels', 'text-field', controlPointLabelExpr(style.labelField));
    map.setLayerZoomRange('control-point-labels', style.minzoom, 24);
  }
}
