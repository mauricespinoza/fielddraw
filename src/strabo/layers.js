import { vendorUrl } from '../vendorPaths.js';
import { defaultStraboStyle } from './style.js';

/**
 * Simbología de las capas de StraboSpot, replicando la del plugin de QGIS
 * `Strabo_to_Spots`:
 *
 * - **Estructuras**: categorizada por `Type`, con los MISMOS símbolos SVG del
 *   plugin, rotados por `Strike` (en el QML es una rotación definida por datos
 *   con la expresión `"Strike"`).
 * - **Observación**: categorizada por `Process` y etiquetada con `Name`.
 *
 * Los SVG viajan en `vendor/strabo-svg/` —copiados del plugin— porque el QML
 * original los referencia por ruta absoluta del equipo donde se exportó, y
 * porque tienen que estar disponibles sin señal como todo lo demás.
 *
 * MapLibre no dibuja SVG: se rasterizan en un canvas y se registran como
 * imágenes del mapa. Se hace a 4× para que aguanten el zoom del iPad sin verse
 * pixelados, y `icon-size` compensa la escala.
 */

export const STRABO_STRUCTURES_SOURCE = 'strabo-structures-src';
export const STRABO_OBSERVATIONS_SOURCE = 'strabo-observations-src';
export const STRABO_LINES_SOURCE = 'strabo-lines-src';

/**
 * VARIOS DATASETS A LA VEZ
 *
 * Cada dataset cargado tiene sus propias fuentes y capas, con el mismo id
 * base y su clave detrás de una arroba: `strabo-lines-line@3`. Así cada uno se
 * enciende, se apaga, se ordena y se transparenta por separado desde el panel
 * de capas —que es lo que permite mirar el trabajo de dos geólogos y apagar
 * uno— sin que las expresiones de simbología tengan que saber de datasets.
 *
 * Sin clave se usan los ids de siempre, que es lo que siguen viendo las
 * pruebas y cualquier código que no hable de datasets.
 */
export const withStraboKey = (base, key) =>
  key === undefined || key === null || key === '' ? base : `${base}@${key}`;

/** `strabo-lines-line@3` -> `strabo-lines-line`. */
export const straboBaseId = (id) => String(id).split('@')[0];

/** Clave del dataset dueño de una capa, o null si es una capa sin clave. */
export const straboKeyOf = (id) => {
  const i = String(id).indexOf('@');
  return i < 0 ? null : String(id).slice(i + 1);
};

export function straboSourceIds(key) {
  return {
    structures: withStraboKey(STRABO_STRUCTURES_SOURCE, key),
    observations: withStraboKey(STRABO_OBSERVATIONS_SOURCE, key),
    lines: withStraboKey(STRABO_LINES_SOURCE, key),
  };
}

/**
 * Color propio de cada dataset, para distinguir de un vistazo de quién es
 * cada traza. El primero es el morado de siempre; los demás se eligieron
 * legibles sobre imagen satelital y lejos de los colores de la simbología
 * geológica (rojo de falla, negro de contacto).
 */
export const STRABO_DATASET_COLORS = [
  '#7E57C2',
  '#26A69A',
  '#FFA726',
  '#EC407A',
  '#42A5F5',
  '#D4E157',
  '#8D6E63',
  '#26C6DA',
];

const RASTER_SCALE = 4;
/** Lado del símbolo en píxeles de pantalla a zoom nominal. */
const SYMBOL_PX = 26;

/**
 * `Type` de StraboSpot -> archivo SVG, tal como los empareja el QML.
 * Las llaves son los valores que produce `processType()`.
 */
const SYMBOL_FILES = {
  'strabo-bedding': 'bedding.svg',
  'strabo-fault-dextral': 'falla-dextral-punto-azul.svg',
  'strabo-fault-sinistral': 'falla-sinestral-punto-azul.svg',
  'strabo-fault-normal': 'falla-normal-punto.svg',
  'strabo-fault-thrust': 'falla-inversa.svg',
  'strabo-fracture': 'joint_inclined.svg',
  'strabo-undefined': 'falla-indeterminada.svg',
};

/**
 * Expresión que elige el icono según `Type`. El orden importa: se comprueban
 * los casos concretos antes que el genérico "fault", igual que en el QML.
 */
export const iconImageExpr = [
  'match',
  ['downcase', ['coalesce', ['get', 'Type'], '']],
  'bedding', 'strabo-bedding',
  'fault dextral', 'strabo-fault-dextral',
  'fault sinistral', 'strabo-fault-sinistral',
  'fault normal', 'strabo-fault-normal',
  ['fault thrust', 'fault reverse'], 'strabo-fault-thrust',
  ['fracture', 'joint'], 'strabo-fracture',
  'strabo-undefined',
];

/** Rasteriza un SVG y lo registra como imagen del mapa. */
function addSvgImage(map, name, file) {
  return new Promise((resolve) => {
    if (map.hasImage(name)) return resolve();
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const side = SYMBOL_PX * RASTER_SCALE;
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, side, side);
      const { data } = ctx.getImageData(0, 0, side, side);
      if (!map.hasImage(name)) {
        map.addImage(
          name,
          { width: side, height: side, data: new Uint8Array(data.buffer) },
          { pixelRatio: RASTER_SCALE },
        );
      }
      resolve();
    };
    // Un símbolo que no carga no debe impedir que se dibujen los demás.
    img.onerror = () => resolve();
    img.src = vendorUrl(`strabo-svg/${file}`);
  });
}

export function addStraboImages(map) {
  return Promise.all(Object.entries(SYMBOL_FILES).map(([name, file]) => addSvgImage(map, name, file)));
}

/**
 * Colores de `Process` en Observación. El QML del plugin categoriza por este
 * campo; aquí se conserva el criterio (una tonalidad por estado de la muestra)
 * con una paleta legible sobre imagen satelital.
 */
const PROCESS_COLORS = [
  'match',
  ['coalesce', ['get', 'Process'], ''],
  'Muestra', '#FFB74D',
  'Corte listo', '#4FC3F7',
  'Enviada a separar', '#BA68C8',
  'Separada', '#9575CD',
  'Analizada', '#66BB6A',
  '#B0BEC5',
];

const structureIconSize = (scale) => [
  'interpolate', ['linear'], ['zoom'], 10, 0.55 * scale, 16, 1 * scale,
];
const observationRadius = (scale) => [
  'interpolate', ['linear'], ['zoom'], 10, 3.5 * scale, 16, 7 * scale,
];

/**
 * @param {object} [style]  tamaños de símbolo (ver `style.js`)
 * @param {string} [key]    clave del dataset; sin ella, los ids de siempre
 * @param {string} [color]  color propio del dataset
 */
export function straboLayers(style = defaultStraboStyle(), key = undefined, color = STRABO_DATASET_COLORS[0]) {
  const id = (base) => withStraboKey(base, key);
  const src = straboSourceIds(key);
  return [
    /* ---------------- líneas y polígonos del dataset ---------------- */
    {
      id: id('strabo-lines-fill'),
      type: 'fill',
      source: src.lines,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': color, 'fill-opacity': 0.25 },
    },
    {
      id: id('strabo-lines-line'),
      type: 'line',
      source: src.lines,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 2, 'line-opacity': 0.9 },
    },

    /* ---------------- observación ---------------- */
    {
      id: id('strabo-observations'),
      type: 'circle',
      source: src.observations,
      paint: {
        'circle-radius': observationRadius(style.observationSize),
        'circle-color': PROCESS_COLORS,
        // El borde dice de qué dataset es; sin clave, el oscuro de siempre.
        'circle-stroke-color': key === undefined ? '#0d1117' : color,
        'circle-stroke-width': 1.4,
        'circle-opacity': 0.95,
      },
    },
    {
      id: id('strabo-observations-labels'),
      type: 'symbol',
      source: src.observations,
      minzoom: 13,
      layout: {
        'text-field': ['coalesce', ['get', 'Sample Code'], ['get', 'Name'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.75)',
        'text-halo-width': 1.3,
      },
    },

    /* ---------------- estructuras ---------------- */
    {
      id: id('strabo-structures'),
      type: 'symbol',
      source: src.structures,
      layout: {
        'icon-image': iconImageExpr,
        // La rotación por Strike es lo que hace que el símbolo apunte como la
        // estructura en el terreno; sin `rotation-alignment: map` giraría con
        // la pantalla y dejaría de significar nada.
        'icon-rotate': ['coalesce', ['get', 'Strike'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': structureIconSize(style.structureSize),
      },
      paint: { 'icon-opacity': 1 },
    },
    {
      id: id('strabo-structures-labels'),
      type: 'symbol',
      source: src.structures,
      minzoom: 14,
      layout: {
        // Rumbo/manteo, que es lo que se anota a mano en un mapa geológico.
        'text-field': [
          'case',
          ['all', ['has', 'Strike'], ['has', 'Dip']],
          ['concat', ['to-string', ['round', ['get', 'Strike']]], '/', ['to-string', ['round', ['get', 'Dip']]]],
          '',
        ],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 1.2,
      },
    },
  ];
}

export const STRABO_LAYER_IDS = straboLayers().map((l) => l.id);

/** Las capas con contenido real, sin las de etiqueta: sobre estas se hace clic. */
export const STRABO_INTERACTIVE_LAYER_IDS = [
  'strabo-structures',
  'strabo-observations',
  'strabo-lines-fill',
  'strabo-lines-line',
];

export const STRABO_SOURCES = [
  STRABO_LINES_SOURCE,
  STRABO_OBSERVATIONS_SOURCE,
  STRABO_STRUCTURES_SOURCE,
];

/** Ids de capa de un dataset, en el orden en que se añaden. */
export const straboLayerIds = (key) => STRABO_LAYER_IDS.map((id) => withStraboKey(id, key));

/** Las capas pulsables de un dataset. */
export const straboInteractiveLayerIds = (key) =>
  STRABO_INTERACTIVE_LAYER_IDS.map((id) => withStraboKey(id, key));

/** Reaplica el tamaño sobre las capas ya añadidas, sin recrearlas. */
export function applyStraboStyle(map, style, key = undefined) {
  const structures = withStraboKey('strabo-structures', key);
  const observations = withStraboKey('strabo-observations', key);
  if (map.getLayer(structures)) {
    map.setLayoutProperty(structures, 'icon-size', structureIconSize(style.structureSize));
  }
  if (map.getLayer(observations)) {
    map.setPaintProperty(observations, 'circle-radius', observationRadius(style.observationSize));
  }
}

/**
 * Campo por el que se filtra cada categoría, y las capas que ese filtro debe
 * tocar (la de contenido y su etiqueta, cuando la tiene).
 */
export const STRABO_FILTER_FIELD = {
  structures: 'Type',
  observations: 'Process',
  lines: 'Type',
};

export const STRABO_FILTER_LAYERS = {
  structures: ['strabo-structures', 'strabo-structures-labels'],
  observations: ['strabo-observations', 'strabo-observations-labels'],
  lines: ['strabo-lines-fill', 'strabo-lines-line'],
};

/**
 * Filtro propio de cada capa antes de tocar nada — `strabo-lines-fill` ya
 * distingue Polygon de LineString para no rellenar una línea suelta. El
 * filtro de categoría se combina con este, nunca lo reemplaza.
 */
const BASE_FILTER = {
  'strabo-lines-fill': ['==', ['geometry-type'], 'Polygon'],
};

/**
 * Aplica el filtro de una categoría. `values === null` quita el filtro de
 * tipo —a propósito no se construye un `in` con la lista completa de
 * valores: un dataset nuevo puede traer valores que el filtro anterior no
 * conocía, y con `null` esos elementos nuevos aparecen visibles en vez de
 * ocultos por omisión.
 */
export function applyStraboFilter(map, category, values, key = undefined) {
  const field = STRABO_FILTER_FIELD[category];
  const layers = STRABO_FILTER_LAYERS[category] || [];
  const typeFilter = values === null ? null : ['in', ['get', field], ['literal', values]];
  for (const baseId of layers) {
    const id = withStraboKey(baseId, key);
    if (!map.getLayer(id)) continue;
    const base = BASE_FILTER[baseId];
    const combined = base && typeFilter ? ['all', base, typeFilter] : typeFilter || base || null;
    map.setFilter(id, combined);
  }
}

/** Valores distintos de un campo presentes en una FeatureCollection, ordenados. */
export function distinctValues(featureCollection, field) {
  const set = new Set();
  for (const f of (featureCollection && featureCollection.features) || []) {
    const v = f.properties && f.properties[field];
    if (v !== undefined && v !== null && v !== '') set.add(String(v));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
