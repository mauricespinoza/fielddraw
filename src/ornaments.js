import { GEOLOGY_SOURCE } from './geologyStyle.js';
import { ORNAMENT_TYPES, defaultOrnaments, effectiveLineColor } from './symbology.js';

/**
 * Ornamentos de falla y de pliegue: dientes en las inversas, tics en las
 * normales, pares de medias flechas en las de rumbo y flechas perpendiculares
 * al eje en los pliegues (divergentes en un antiforme, convergentes en un
 * sinforme).
 *
 * Se dibujan como capas `symbol` con `symbol-placement: 'line'`, que reparte
 * iconos a lo largo del trazo y los rota con él. `icon-offset` desplaza en el
 * marco YA rotado, así que un desplazamiento en Y deja el ornamento siempre
 * al mismo lado de la falla, sea cual sea su rumbo. Los pliegues van con
 * offset 0: el símbolo se dibuja a caballo del eje, mitad a cada lado.
 *
 * Los iconos se generan en canvas ya coloreados —uno por tipo— en vez de usar
 * SDF: un SDF real necesita un campo de distancias, y una máscara alfa cruda
 * se ve sucia al recolorearla. Como el color es editable, el canvas se vuelve a
 * dibujar cuando cambia y se sustituye con `updateImage`, que conserva el
 * nombre: así las capas no tienen que reapuntar a nada.
 */

const DPR = 2;

/** Canvas ya escalado a DPR, en el formato que espera `addImage`. */
function render(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w * DPR;
  canvas.height = h * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  draw(ctx);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(data.buffer) };
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

/**
 * Flecha vertical con la punta en `yHead`. Es la que marca, a cada lado del
 * eje, hacia dónde manteen los flancos: hacia afuera en un antiforme y hacia
 * el eje en un sinforme.
 */
function foldArrow(ctx, x, yTail, yHead, color) {
  const dir = Math.sign(yHead - yTail);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x, yTail);
  ctx.lineTo(x, yHead - dir * 3.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, yHead);
  ctx.lineTo(x - 2.9, yHead - dir * 4.4);
  ctx.lineTo(x + 2.9, yHead - dir * 4.4);
  ctx.closePath();
  ctx.fill();
}

/**
 * Cómo se dibuja el icono de cada tipo. La traza pasa por el centro vertical
 * del lienzo, así que un pliegue con offset 0 queda con la mitad del símbolo a
 * cada lado del eje.
 */
const DRAWINGS = {
  // Diente de cabalgamiento: triángulo con la base sobre la traza.
  'thrust-fault': {
    w: 11,
    h: 9,
    draw: (ctx, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 9);
      ctx.lineTo(11, 9);
      ctx.lineTo(5.5, 0);
      ctx.closePath();
      ctx.fill();
    },
  },

  // Tic de falla normal: bolita colgando del bloque hundido.
  'normal-fault': {
    w: 7,
    h: 9,
    draw: (ctx, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(3.5, 9);
      ctx.lineTo(3.5, 5);
      ctx.stroke();
      ctx.fillStyle = color;
      // El círculo se apoya donde terminaba el cuadrado, con el mismo
      // diámetro que su lado, para no alterar el tamaño aparente del tic.
      ctx.beginPath();
      ctx.arc(3.5, 2.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    },
  },

  // Par de medias flechas: sentido dextral y sinestral.
  'dextral-fault': {
    w: 30,
    h: 16,
    draw: (ctx, color) => {
      halfArrow(ctx, 6, 24, 5, color, true);
      halfArrow(ctx, 24, 6, 11, color, false);
    },
  },
  'sinistral-fault': {
    w: 30,
    h: 16,
    draw: (ctx, color) => {
      halfArrow(ctx, 24, 6, 5, color, true);
      halfArrow(ctx, 6, 24, 11, color, false);
    },
  },

  // Antiforme: las dos flechas se alejan del eje — los flancos manteen hacia
  // afuera desde la charnela.
  antiform: {
    w: 13,
    h: 22,
    draw: (ctx, color) => {
      foldArrow(ctx, 6.5, 10.4, 0.9, color);
      foldArrow(ctx, 6.5, 11.6, 21.1, color);
    },
  },

  // Sinforme: las mismas flechas apuntando al eje.
  synform: {
    w: 13,
    h: 22,
    draw: (ctx, color) => {
      foldArrow(ctx, 6.5, 0.9, 10.4, color);
      foldArrow(ctx, 6.5, 21.1, 11.6, color);
    },
  },
};

export const IMAGE_OF = Object.fromEntries(ORNAMENT_TYPES.map((t) => [t, `orn-${t}`]));

const imageFor = (type, style) => {
  const d = DRAWINGS[type];
  const color = effectiveLineColor(type, style);
  return render(d.w, d.h, (ctx) => d.draw(ctx, color));
};

/** Registra los iconos que falten, con los colores del estilo actual. */
export function addOrnamentImages(map, style = defaultOrnaments()) {
  for (const type of ORNAMENT_TYPES) {
    const name = IMAGE_OF[type];
    if (map.hasImage(name)) continue;
    map.addImage(name, imageFor(type, style), { pixelRatio: DPR });
  }
}

/**
 * Vuelve a dibujar los iconos cuyo color cambió. `updateImage` sustituye los
 * píxeles conservando el nombre —quitar y volver a añadir la imagen deja las
 * capas parpadeando— y solo se toca lo que de verdad cambió, porque esto se
 * llama en cada evento `input` del selector de color.
 */
const lastColors = new WeakMap();

export function updateOrnamentImages(map, style) {
  let seen = lastColors.get(map);
  if (!seen) {
    seen = {};
    lastColors.set(map, seen);
  }
  for (const type of ORNAMENT_TYPES) {
    const color = effectiveLineColor(type, style);
    if (seen[type] === color) continue;
    seen[type] = color;
    const name = IMAGE_OF[type];
    if (map.hasImage(name)) map.updateImage(name, imageFor(type, style));
  }
}

/**
 * Los ornamentos solo se dibujan en fallas observadas o inferidas: una falla
 * cubierta no tiene expresión superficial que ornamentar.
 */
const VISIBLE_CERTAINTY = ['!=', ['get', 'certainty'], 'covered'];

/**
 * El "flip" refleja el ornamento como en un espejo cuyo eje es la propia
 * traza. Se resuelve con DOS capas por tipo en vez de con una expresión
 * data-driven: `icon-offset` e `icon-rotate` sí admiten expresiones, pero el
 * par offset+rotación tiene que ir sincronizado y dos capas con filtros
 * mutuamente excluyentes es más fácil de leer y de comprobar.
 *
 * La reflexión la hace `icon-rotate: 180` ella sola, y por eso las dos capas
 * llevan el MISMO `icon-offset`. MapLibre hornea el offset en las esquinas del
 * quad del icono (`shapeIcon`) y recién después les aplica la matriz de
 * `icon-rotate` (`getIconQuads`), así que el giro arrastra también el
 * desplazamiento: 180° dejan el símbolo al otro lado de la traza, a la misma
 * distancia. Negar además el offset —que es lo que parece natural— lo devolvía
 * al lado de partida, y el flip terminaba dando vuelta el diente sin cambiarlo
 * de bloque.
 *
 * Que girar 180° equivalga a reflejar depende de que el icono sea simétrico
 * respecto de su eje vertical, y los cuatro lo son: el diente y el tic por
 * construcción, y el par de medias flechas porque su simetría es justamente de
 * 180°. En las de rumbo eso es además lo que corresponde — reflejar de verdad
 * un par dextral daría uno sinestral, que es otra falla, no la misma volteada.
 */
const flipFilter = (flipped) =>
  flipped ? ['==', ['get', 'flip'], true] : ['!=', ['get', 'flip'], true];

export const ornamentLayerId = (type, flipped) =>
  `orn-${type}${flipped ? '-flip' : ''}-layer`;

function ornamentLayer(type, style, flipped) {
  const s = style[type] || defaultOrnaments()[type];
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
      'icon-offset': [0, s.offset],
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
      map.setLayoutProperty(id, 'icon-offset', [0, s.offset]);
      map.setLayoutProperty(id, 'icon-size', iconSize(s.size));
      map.setLayerZoomRange(id, s.minzoom, 24);
    }
  }
  updateOrnamentImages(map, style);
}

export const ORNAMENT_LAYER_IDS = ornamentLayers().map((l) => l.id);
