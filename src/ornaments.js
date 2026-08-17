import { GEOLOGY_SOURCE } from './geologyStyle.js';
import { LINE_TYPE_BY_ID, ORNAMENT_TYPES, defaultOrnaments } from './symbology.js';

/**
 * Ornamentos de falla: dientes en las inversas, tics en las normales y pares
 * de medias flechas en las de rumbo.
 *
 * Se dibujan como capas `symbol` con `symbol-placement: 'line'`, que reparte
 * iconos a lo largo del trazo y los rota con él. `icon-offset` desplaza en el
 * marco YA rotado, así que un desplazamiento en Y deja el ornamento siempre
 * al mismo lado de la falla, sea cual sea su rumbo.
 *
 * Los iconos se generan en canvas ya coloreados —uno por tipo— en vez de usar
 * SDF: un SDF real necesita un campo de distancias, y una máscara alfa cruda
 * se ve sucia al recolorearla.
 */

const DPR = 2;

function makeImage(map, name, w, h, draw) {
  if (map.hasImage(name)) return;
  const canvas = document.createElement('canvas');
  canvas.width = w * DPR;
  canvas.height = h * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  draw(ctx);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  map.addImage(
    name,
    { width: canvas.width, height: canvas.height, data: new Uint8Array(data.buffer) },
    { pixelRatio: DPR },
  );
}

/** Media flecha: astil y punta, apuntando a la derecha desde (x0,y). */
function halfArrow(ctx, x0, x1, y, color, up) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  const dir = x1 > x0 ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x1 - dir * 5, y + (up ? -4 : 4));
  ctx.lineTo(x1 - dir * 3.2, y);
  ctx.closePath();
  ctx.fill();
}

export function addOrnamentImages(map) {
  const thrust = LINE_TYPE_BY_ID.get('thrust-fault').color;
  const normal = LINE_TYPE_BY_ID.get('normal-fault').color;
  const dextral = LINE_TYPE_BY_ID.get('dextral-fault').color;
  const sinistral = LINE_TYPE_BY_ID.get('sinistral-fault').color;

  // Diente de cabalgamiento: triángulo con la base sobre la traza.
  makeImage(map, 'orn-thrust', 11, 9, (ctx) => {
    ctx.fillStyle = thrust;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(11, 9);
    ctx.lineTo(5.5, 0);
    ctx.closePath();
    ctx.fill();
  });

  // Tic de falla normal: cuadradito colgando del bloque hundido.
  makeImage(map, 'orn-normal', 7, 9, (ctx) => {
    ctx.strokeStyle = normal;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(3.5, 9);
    ctx.lineTo(3.5, 5);
    ctx.stroke();
    ctx.fillStyle = normal;
    ctx.fillRect(1, 0, 5, 5);
  });

  // Par de medias flechas: sentido dextral y sinestral.
  makeImage(map, 'orn-dextral', 30, 16, (ctx) => {
    halfArrow(ctx, 6, 24, 5, dextral, true);
    halfArrow(ctx, 24, 6, 11, dextral, false);
  });
  makeImage(map, 'orn-sinistral', 30, 16, (ctx) => {
    halfArrow(ctx, 24, 6, 5, sinistral, true);
    halfArrow(ctx, 6, 24, 11, sinistral, false);
  });
}

/**
 * Los ornamentos solo se dibujan en fallas observadas o inferidas: una falla
 * cubierta no tiene expresión superficial que ornamentar.
 */
const VISIBLE_CERTAINTY = ['!=', ['get', 'certainty'], 'covered'];

const IMAGE_OF = {
  'thrust-fault': 'orn-thrust',
  'normal-fault': 'orn-normal',
  'dextral-fault': 'orn-dextral',
  'sinistral-fault': 'orn-sinistral',
};

/**
 * El "flip" invierte de lado el ornamento. Se resuelve con DOS capas por tipo
 * en vez de con una expresión data-driven: `icon-offset` e `icon-rotate` sí
 * admiten expresiones, pero el par offset+rotación tiene que ir sincronizado y
 * dos capas con filtros mutuamente excluyentes es más fácil de leer y de
 * comprobar. Espejar = cruzar la traza (offset opuesto) y girar 180°, que es
 * exactamente la reflexión respecto de la línea.
 */
const flipFilter = (flipped) =>
  flipped ? ['==', ['get', 'flip'], true] : ['!=', ['get', 'flip'], true];

export const ornamentLayerId = (type, flipped) =>
  `orn-${type}${flipped ? '-flip' : ''}-layer`;

function ornamentLayer(type, style, flipped) {
  const s = style[type] || defaultOrnaments()[type];
  const offset = flipped ? -s.offset : s.offset;
  return {
    id: ornamentLayerId(type, flipped),
    type: 'symbol',
    source: GEOLOGY_SOURCE,
    minzoom: s.minzoom,
    filter: ['all', ['==', ['get', 'type'], type], VISIBLE_CERTAINTY, flipFilter(flipped)],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': s.spacing,
      'icon-image': IMAGE_OF[type],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-offset': [0, offset],
      'icon-rotate': flipped ? 180 : 0,
      'icon-size': iconSize(s.size),
    },
    paint: { 'icon-opacity': 1 },
  };
}

/** El tamaño elegido escala la rampa por zoom, no la reemplaza. */
const iconSize = (size) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  0.7 * size,
  16,
  1 * size,
];

export function ornamentLayers(style = defaultOrnaments()) {
  const out = [];
  for (const type of ORNAMENT_TYPES) {
    out.push(ornamentLayer(type, style, false));
    out.push(ornamentLayer(type, style, true));
  }
  return out;
}

/**
 * Reaplica los parámetros sobre las capas ya añadidas. Cambiar propiedades de
 * layout es mucho más barato —y no parpadea— que quitar y volver a añadir las
 * ocho capas cada vez que se mueve un deslizador.
 */
export function applyOrnamentStyle(map, style) {
  for (const type of ORNAMENT_TYPES) {
    const s = style[type] || defaultOrnaments()[type];
    for (const flipped of [false, true]) {
      const id = ornamentLayerId(type, flipped);
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, 'symbol-spacing', s.spacing);
      map.setLayoutProperty(id, 'icon-offset', [0, flipped ? -s.offset : s.offset]);
      map.setLayoutProperty(id, 'icon-size', iconSize(s.size));
      map.setLayerZoomRange(id, s.minzoom, 24);
    }
  }
}

export const ORNAMENT_LAYER_IDS = ornamentLayers().map((l) => l.id);
