import { vendorUrl } from '../vendorPaths.js';

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

export function straboLayers() {
  return [
    /* ---------------- líneas y polígonos del dataset ---------------- */
    {
      id: 'strabo-lines-fill',
      type: 'fill',
      source: STRABO_LINES_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#7E57C2', 'fill-opacity': 0.25 },
    },
    {
      id: 'strabo-lines-line',
      type: 'line',
      source: STRABO_LINES_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#7E57C2', 'line-width': 2, 'line-opacity': 0.9 },
    },

    /* ---------------- observación ---------------- */
    {
      id: 'strabo-observations',
      type: 'circle',
      source: STRABO_OBSERVATIONS_SOURCE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 7],
        'circle-color': PROCESS_COLORS,
        'circle-stroke-color': '#0d1117',
        'circle-stroke-width': 1.4,
        'circle-opacity': 0.95,
      },
    },
    {
      id: 'strabo-observations-labels',
      type: 'symbol',
      source: STRABO_OBSERVATIONS_SOURCE,
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
      id: 'strabo-structures',
      type: 'symbol',
      source: STRABO_STRUCTURES_SOURCE,
      layout: {
        'icon-image': iconImageExpr,
        // La rotación por Strike es lo que hace que el símbolo apunte como la
        // estructura en el terreno; sin `rotation-alignment: map` giraría con
        // la pantalla y dejaría de significar nada.
        'icon-rotate': ['coalesce', ['get', 'Strike'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 16, 1],
      },
      paint: { 'icon-opacity': 1 },
    },
    {
      id: 'strabo-structures-labels',
      type: 'symbol',
      source: STRABO_STRUCTURES_SOURCE,
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

export const STRABO_SOURCES = [
  STRABO_LINES_SOURCE,
  STRABO_OBSERVATIONS_SOURCE,
  STRABO_STRUCTURES_SOURCE,
];
