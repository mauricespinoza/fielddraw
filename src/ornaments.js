import { GEOLOGY_SOURCE } from './geologyStyle.js';
import {
  IMPORTED_FILTER,
  ORNAMENT_LIMITS,
  ORNAMENT_TYPES,
  defaultImportStyle,
  defaultOrnaments,
  effectiveLineColor,
} from './symbology.js';

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

/**
 * Halo blanco del ornamento, FUSIONADO con el de la traza.
 *
 * La traza continua ya lleva su halo (la capa de casing de `geologyStyle.js`),
 * y sin uno propio el diente, la bola o las medias flechas quedaban pegados
 * al fondo: sobre una ortofoto oscura el trazo se leía y su cinemática no.
 *
 * Pero el halo no puede ir DENTRO del icono del ornamento: el icono se pinta
 * por encima de la línea, y su borde blanco tapaba la traza allí donde el
 * símbolo la toca —un triángulo o un círculo blanco recortado sobre la falla—.
 * Por eso cada ornamento tiene DOS imágenes: el halo solo, en blanco puro, en
 * una capa que va POR DEBAJO de la traza y de su casing y con la misma
 * opacidad que el casing; y el símbolo solo, en su color, encima de todo. El
 * blanco queda envolviendo por fuera al conjunto línea + símbolo, como un
 * único contorno, y nada blanco cae sobre la línea.
 */
const HALO_COLOR = '#ffffff';
const HALO_EXTRA = 2.4;

/** Opacidad de la capa de halos: la misma del casing de la traza. */
export const ORNAMENT_HALO_OPACITY = 0.55;

/** Margen del lienzo para que el halo no se recorte en los bordes. */
const PAD = HALO_EXTRA / 2 + 0.4;

const HALO_PASS = { color: HALO_COLOR, extra: HALO_EXTRA };
const colorPass = (color) => ({ color, extra: 0 });

/** Trazo con el grosor del pase. */
function stroke(ctx, p, width, cap = 'round') {
  ctx.strokeStyle = p.color;
  ctx.lineWidth = width + p.extra;
  ctx.lineCap = p.extra ? 'round' : cap;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Relleno; en el pase del halo, además contorneado para engordarlo. */
function fill(ctx, p) {
  ctx.fillStyle = p.color;
  ctx.fill();
  if (p.extra) {
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.extra;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/** Media flecha: astil y punta, apuntando a la derecha desde (x0,y). */
function halfArrow(ctx, p, x0, x1, y, up) {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  stroke(ctx, p, 1.6);
  const dir = x1 > x0 ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x1 - dir * 5, y + (up ? -4 : 4));
  ctx.lineTo(x1 - dir * 3.2, y);
  ctx.closePath();
  fill(ctx, p);
}

/**
 * Flecha vertical con la punta en `yHead`. Es la que marca, a cada lado del
 * eje, hacia dónde manteen los flancos: hacia afuera en un antiforme y hacia
 * el eje en un sinforme.
 */
function foldArrow(ctx, p, x, yTail, yHead) {
  const dir = Math.sign(yHead - yTail);
  ctx.beginPath();
  ctx.moveTo(x, yTail);
  ctx.lineTo(x, yHead - dir * 3.6);
  stroke(ctx, p, 1.5, 'butt');
  ctx.beginPath();
  ctx.moveTo(x, yHead);
  ctx.lineTo(x - 2.9, yHead - dir * 4.4);
  ctx.lineTo(x + 2.9, yHead - dir * 4.4);
  ctx.closePath();
  fill(ctx, p);
}

/**
 * Alto del lienzo de las medias flechas. Es FIJO —el de la separación
 * máxima— aunque la separación sea editable: `updateImage` exige que la
 * imagen nueva tenga las mismas dimensiones que la registrada, y rehacer el
 * icono al mover el deslizador es justamente lo que hay que poder hacer.
 */
const STRIKE_SLIP_H = 2 * (ORNAMENT_LIMITS.gap.max + 5);

/**
 * Par de medias flechas a `gap` px de la traza, una por bloque. La traza pasa
 * por el centro del lienzo; la flecha de arriba va con la barba hacia arriba
 * y la de abajo hacia abajo, siempre hacia AFUERA de la traza.
 */
function strikeSlipPair(ctx, p, gap, dextral) {
  const cy = STRIKE_SLIP_H / 2;
  const [arriba, abajo] = dextral ? [[6, 24], [24, 6]] : [[24, 6], [6, 24]];
  halfArrow(ctx, p, arriba[0], arriba[1], cy - gap, true);
  halfArrow(ctx, p, abajo[0], abajo[1], cy + gap, false);
}

/**
 * Cómo se dibuja el icono de cada tipo. La traza pasa por el centro vertical
 * del lienzo, así que un pliegue con offset 0 queda con la mitad del símbolo a
 * cada lado del eje. `draw(ctx, pase, estilo)`: el estilo es el del tipo en el
 * módulo de simbología, del que solo las de rumbo leen algo (la separación).
 */
const DRAWINGS = {
  // Diente de cabalgamiento: triángulo con la base sobre la traza.
  'thrust-fault': {
    w: 11,
    h: 9,
    draw: (ctx, p) => {
      ctx.beginPath();
      ctx.moveTo(0, 9);
      ctx.lineTo(11, 9);
      ctx.lineTo(5.5, 0);
      ctx.closePath();
      fill(ctx, p);
    },
  },

  // Tic de falla normal: bolita colgando del bloque hundido.
  'normal-fault': {
    w: 7,
    h: 9,
    draw: (ctx, p) => {
      ctx.beginPath();
      ctx.moveTo(3.5, 9);
      ctx.lineTo(3.5, 5);
      stroke(ctx, p, 1.4, 'butt');
      // El círculo se apoya donde terminaba el cuadrado, con el mismo
      // diámetro que su lado, para no alterar el tamaño aparente del tic.
      ctx.beginPath();
      ctx.arc(3.5, 2.5, 2.5, 0, Math.PI * 2);
      fill(ctx, p);
    },
  },

  // Par de medias flechas: sentido dextral y sinestral, a la separación que
  // se haya elegido.
  'dextral-fault': {
    w: 30,
    h: STRIKE_SLIP_H,
    draw: (ctx, p, s) => strikeSlipPair(ctx, p, gapOf(s), true),
  },
  'sinistral-fault': {
    w: 30,
    h: STRIKE_SLIP_H,
    draw: (ctx, p, s) => strikeSlipPair(ctx, p, gapOf(s), false),
  },

  // Antiforme: las dos flechas se alejan del eje — los flancos manteen hacia
  // afuera desde la charnela.
  antiform: {
    w: 13,
    h: 22,
    draw: (ctx, p) => {
      foldArrow(ctx, p, 6.5, 10.4, 0.9);
      foldArrow(ctx, p, 6.5, 11.6, 21.1);
    },
  },

  // Sinforme: las mismas flechas apuntando al eje.
  synform: {
    w: 13,
    h: 22,
    draw: (ctx, p) => {
      foldArrow(ctx, p, 6.5, 0.9, 10.4);
      foldArrow(ctx, p, 6.5, 21.1, 11.6);
    },
  },
};

const DEFAULT_GAP = 3;
const gapOf = (s) => (s && Number.isFinite(s.gap) ? s.gap : DEFAULT_GAP);

export const IMAGE_OF = Object.fromEntries(ORNAMENT_TYPES.map((t) => [t, `orn-${t}`]));

/**
 * El mismo icono, en el color único de lo traído de StraboSpot.
 *
 * Sin esta segunda tanda, adoptar un dataset dejaba la traza morada y sus
 * dientes del color de la falla propia: el símbolo se partía en dos colores y
 * el mapa dejaba de decir de un vistazo qué venía de fuera, que es justo para
 * lo que está el color único.
 */
export const IMPORTED_IMAGE_OF = Object.fromEntries(
  ORNAMENT_TYPES.map((t) => [t, `orn-${t}-imp`]),
);

/** El halo de cada tipo: blanco, sin color propio, y uno solo para lo propio y lo importado. */
export const HALO_IMAGE_OF = Object.fromEntries(
  ORNAMENT_TYPES.map((t) => [t, `orn-${t}-halo`]),
);

/** Un pase de dibujo sobre un lienzo del tamaño del tipo, con el margen del halo. */
const drawWith = (type, pase, s) => {
  const d = DRAWINGS[type];
  return render(d.w + 2 * PAD, d.h + 2 * PAD, (ctx) => {
    ctx.translate(PAD, PAD);
    d.draw(ctx, pase, s);
  });
};

const imageWith = (type, color, s) => drawWith(type, colorPass(color), s);

const haloImage = (type, s) => drawWith(type, HALO_PASS, s);

const imageFor = (type, style) =>
  imageWith(type, effectiveLineColor(type, style), style && style[type]);

/** Lo que decide los píxeles de un icono: el color y, en las de rumbo, la separación. */
const imageKey = (type, style) => `${effectiveLineColor(type, style)}|${gapOf(style && style[type])}`;

/**
 * Lo que decide los píxeles de la copia de lo importado: el color único y la
 * separación de las medias flechas, que es del tipo y vale igual para lo
 * propio que para lo adoptado.
 */
const importedKey = (type, style, importStyle) =>
  `${importStyle.color}|${gapOf(style && style[type])}`;

/** Última clave rasterizada de cada icono importado, por mapa. */
const lastImported = new WeakMap();

/** Registra los iconos que falten, con los colores del estilo actual. */
export function addOrnamentImages(map, style = defaultOrnaments(), importStyle = defaultImportStyle()) {
  const visto = lastImported.get(map) || {};
  const halos = lastHalo.get(map) || {};
  for (const type of ORNAMENT_TYPES) {
    const halo = HALO_IMAGE_OF[type];
    if (!map.hasImage(halo)) {
      map.addImage(halo, haloImage(type, style[type]), { pixelRatio: DPR });
      halos[type] = gapOf(style[type]);
    }
    const name = IMAGE_OF[type];
    if (!map.hasImage(name)) map.addImage(name, imageFor(type, style), { pixelRatio: DPR });
    const ajeno = IMPORTED_IMAGE_OF[type];
    if (!map.hasImage(ajeno)) {
      map.addImage(ajeno, imageWith(type, importStyle.color, style[type]), { pixelRatio: DPR });
      visto[type] = importedKey(type, style, importStyle);
    }
  }
  lastImported.set(map, visto);
  lastHalo.set(map, halos);
}

/** Última separación con la que se rasterizó cada halo, por mapa. */
const lastHalo = new WeakMap();

/** El halo solo cambia con la forma: en las de rumbo, con la separación. */
function updateHaloImages(map, style) {
  let visto = lastHalo.get(map);
  if (!visto) {
    visto = {};
    lastHalo.set(map, visto);
  }
  for (const type of ORNAMENT_TYPES) {
    const gap = gapOf(style && style[type]);
    if (visto[type] === gap) continue;
    visto[type] = gap;
    const name = HALO_IMAGE_OF[type];
    if (map.hasImage(name)) map.updateImage(name, haloImage(type, style[type]));
  }
}

/** Redibuja los iconos de lo importado, y solo los que de verdad cambiaron. */
export function updateImportedOrnamentImages(map, importStyle, style = defaultOrnaments()) {
  if (!importStyle) return;
  let visto = lastImported.get(map);
  if (!visto) {
    visto = {};
    lastImported.set(map, visto);
  }
  for (const type of ORNAMENT_TYPES) {
    const clave = importedKey(type, style, importStyle);
    if (visto[type] === clave) continue;
    visto[type] = clave;
    const name = IMPORTED_IMAGE_OF[type];
    if (map.hasImage(name)) map.updateImage(name, imageWith(type, importStyle.color, style[type]));
  }
}

/** `icon-image` de un tipo: el suyo, o el de lo importado si el color único está puesto. */
export function ornamentIconExpr(type, importStyle = defaultImportStyle()) {
  if (!importStyle.uniform) return IMAGE_OF[type];
  return ['case', IMPORTED_FILTER, IMPORTED_IMAGE_OF[type], IMAGE_OF[type]];
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
    const clave = imageKey(type, style);
    if (seen[type] === clave) continue;
    seen[type] = clave;
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

export const ornamentHaloLayerId = (type, flipped) =>
  `orn-${type}${flipped ? '-flip' : ''}-halo-layer`;

/**
 * Capa del halo: la misma colocación que la del símbolo —mismo espaciado,
 * offset, giro y tamaño, así que cada halo cae exactamente detrás de su
 * símbolo— con la imagen blanca. Va por debajo de la traza (ver `mapView`).
 */
function ornamentHaloLayer(type, style, flipped) {
  const base = ornamentLayer(type, style, flipped, defaultImportStyle());
  return {
    ...base,
    id: ornamentHaloLayerId(type, flipped),
    layout: { ...base.layout, 'icon-image': HALO_IMAGE_OF[type] },
    paint: { 'icon-opacity': ORNAMENT_HALO_OPACITY },
  };
}

function ornamentLayer(type, style, flipped, importStyle) {
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
      'icon-image': ornamentIconExpr(type, importStyle),
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

export function ornamentLayers(style = defaultOrnaments(), importStyle = defaultImportStyle()) {
  const out = [];
  for (const type of ORNAMENT_TYPES) {
    out.push(ornamentLayer(type, style, false, importStyle));
    out.push(ornamentLayer(type, style, true, importStyle));
  }
  return out;
}

/** Las capas de halo, una por tipo y por flip, para ir debajo de la traza. */
export function ornamentHaloLayers(style = defaultOrnaments()) {
  const out = [];
  for (const type of ORNAMENT_TYPES) {
    out.push(ornamentHaloLayer(type, style, false));
    out.push(ornamentHaloLayer(type, style, true));
  }
  return out;
}

/**
 * Reaplica los parámetros sobre las capas ya añadidas. Cambiar propiedades de
 * layout es mucho más barato —y no parpadea— que quitar y volver a añadir las
 * ocho capas cada vez que se mueve un deslizador.
 */
export function applyOrnamentStyle(map, style, importStyle) {
  for (const type of ORNAMENT_TYPES) {
    const s = style[type] || defaultOrnaments()[type];
    for (const flipped of [false, true]) {
      for (const id of [ornamentLayerId(type, flipped), ornamentHaloLayerId(type, flipped)]) {
        if (!map.getLayer(id)) continue;
        if (importStyle && id === ornamentLayerId(type, flipped)) {
          map.setLayoutProperty(id, 'icon-image', ornamentIconExpr(type, importStyle));
        }
        map.setLayoutProperty(id, 'symbol-spacing', s.spacing);
        map.setLayoutProperty(id, 'icon-offset', [0, s.offset]);
        map.setLayoutProperty(id, 'icon-size', iconSize(s.size));
        map.setLayerZoomRange(id, s.minzoom, 24);
      }
    }
  }
  updateHaloImages(map, style);
  updateOrnamentImages(map, style);
  updateImportedOrnamentImages(map, importStyle, style);
}

export const ORNAMENT_LAYER_IDS = ornamentLayers().map((l) => l.id);

export const ORNAMENT_HALO_LAYER_IDS = ornamentHaloLayers().map((l) => l.id);
