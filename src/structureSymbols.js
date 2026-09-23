import { GEOLOGY_SOURCE } from './geologyStyle.js';
import {
  FAULT_SENSES,
  HORIZONTAL_DIP_MAX,
  IMPORTED_FILTER,
  STRUCTURE_TYPES,
  STRUCTURE_TYPE_BY_ID,
  STRUCTURE_VARIANTS,
  VERTICAL_DIP_MIN,
  defaultImportStyle,
  defaultStructureStyle,
} from './symbology.js';

/**
 * Símbolos de rumbo y manteo.
 *
 * Se dibujan en canvas como los ornamentos de falla, y no como SVG traídos de
 * `vendor/`: son cuatro trazos por variante, el color va por tipo de
 * superficie, y generarlos evita cargar dieciséis archivos que además habría
 * que precachear para el modo sin señal.
 *
 * **Orientación.** El icono se dibuja con el trazo de rumbo VERTICAL, es decir
 * apuntando al norte del lienzo, y el tic de manteo hacia la derecha. Con
 * `icon-rotation-alignment: 'map'` e `icon-rotate` igual al rumbo, el trazo
 * queda sobre el rumbo real y el tic sobre rumbo+90°, que es exactamente la
 * dirección de manteo bajo la regla de la mano derecha. Es la misma convención
 * con la que ya se rotan por `Strike` los símbolos de StraboSpot, así que un
 * afloramiento propio y uno importado se leen igual.
 *
 * El punto de aplicación es el CENTRO del trazo de rumbo, así que el lienzo es
 * simétrico respecto de él: el tic sale hacia un lado, pero el ancho reserva
 * el mismo espacio a ambos.
 */

const DPR = 2;

/** Lienzo del icono, en píxeles lógicos. El trazo de rumbo va en x = W/2. */
const W = 24;
const H = 30;
const CX = W / 2;
const CY = H / 2;
/** Medio largo del trazo de rumbo y largo del tic de manteo. */
const HALF_STRIKE = 11.5;
const TICK = 7;

/**
 * Halo blanco por detrás del símbolo.
 *
 * Es el mismo problema —y la misma solución— que en las trazas: sobre imagen
 * satelital, un símbolo de estratificación en casi negro desaparece. Aquí no
 * se puede resolver con una capa de casing como en las líneas, porque un icono
 * es un mapa de bits: se dibuja el mismo trazo dos veces en el canvas, primero
 * ancho y blanco y encima el del color del tipo.
 *
 * A diferencia de las líneas, aquí SÍ lo llevan todos los símbolos: no hay
 * patrón de guiones que emborronar, que era el motivo de excluir las
 * segmentadas.
 */
const HALO_COLOR = 'rgba(255, 255, 255, 0.9)';
const HALO_EXTRA = 2.4;

/** Los dos pases de cada dibujo: primero el halo, luego el color del tipo. */
const passes = (color) => [
  { color: HALO_COLOR, extra: HALO_EXTRA },
  { color, extra: 0 },
];

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

/** Prepara el contexto para un pase: color del pase y grosor ya engordado. */
function prepare(ctx, p, width) {
  ctx.strokeStyle = p.color;
  ctx.lineWidth = width + p.extra;
  ctx.lineCap = p.extra ? 'round' : 'butt';
  ctx.lineJoin = 'round';
}

/** Trazo de rumbo: la línea larga norte-sur del lienzo. */
function strikeLine(ctx, p, width = 2) {
  prepare(ctx, p, width);
  ctx.beginPath();
  ctx.moveTo(CX, CY - HALF_STRIKE);
  ctx.lineTo(CX, CY + HALF_STRIKE);
  ctx.stroke();
}

/** Tic de manteo, perpendicular al rumbo. `dir` = +1 al este, −1 al oeste. */
function dipTick(ctx, p, dir = 1, largo = TICK) {
  prepare(ctx, p, 2);
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.lineTo(CX + dir * largo, CY);
  ctx.stroke();
}

/**
 * Polígono relleno. En el pase del halo se rellena Y se contornea en blanco,
 * para que el borde del halo tenga el mismo grosor que en los trazos.
 */
function fillShape(ctx, p, puntos) {
  ctx.beginPath();
  puntos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = p.color;
  ctx.fill();
  prepare(ctx, p, 0.6);
  ctx.stroke();
}

/**
 * Triángulo relleno pegado al trazo de rumbo, hacia el lado del manteo: el
 * «tic» de la FOLIACIÓN (S₁) en las cartas, que es lo que la separa a simple
 * vista de la estratificación (S₀) aunque las dos se midan en el mismo punto.
 */
function dipTriangle(ctx, p, dir = 1, largo = TICK + 1.5, base = 3.6) {
  fillShape(ctx, p, [
    [CX, CY - base],
    [CX + dir * largo, CY],
    [CX, CY + base],
  ]);
}

/** Tic de manteo: una raya en S₀, un triángulo en S₁. */
function tick(ctx, p, estilo, dir = 1, largo = TICK) {
  if (estilo === 'triangle') dipTriangle(ctx, p, dir, largo + 1.5);
  else dipTick(ctx, p, dir, largo);
}

/**
 * Las cuatro variantes, con el tic que corresponda a la superficie.
 * `estilo` es 'line' (estratificación, diaclasa, plano de falla) o
 * 'triangle' (foliación).
 */
const DRAWINGS = {
  /** Inclinado: trazo de rumbo y tic hacia el lado del manteo. */
  inclined: (ctx, p, estilo) => {
    strikeLine(ctx, p);
    tick(ctx, p, estilo, 1);
  },

  /** Vertical: tic a los dos lados, porque no hay bloque que cabecee. */
  vertical: (ctx, p, estilo) => {
    strikeLine(ctx, p, 2.4);
    tick(ctx, p, estilo, 1, TICK - 1.5);
    tick(ctx, p, estilo, -1, TICK - 1.5);
  },

  /**
   * Horizontal: cruz dentro de un círculo (dentro de un cuadrado en la
   * foliación). Sin dirección de manteo, que es justamente lo que afirma —y
   * lo que un tic apuntando a algún lado negaría.
   */
  horizontal: (ctx, p, estilo) => {
    prepare(ctx, p, 1.8);
    ctx.beginPath();
    if (estilo === 'triangle') ctx.rect(CX - 5.5, CY - 5.5, 11, 11);
    else ctx.arc(CX, CY, 6.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CX - 9, CY);
    ctx.lineTo(CX + 9, CY);
    ctx.moveTo(CX, CY - 9);
    ctx.lineTo(CX, CY + 9);
    ctx.stroke();
  },

  /**
   * Invertido: el tic termina en un gancho que vuelve sobre sí mismo. El
   * gancho apunta al norte del lienzo por convenio; lo que importa es que se
   * distinga de un estrato en posición normal a simple vista.
   */
  overturned: (ctx, p, estilo) => {
    strikeLine(ctx, p);
    tick(ctx, p, estilo, 1);
    prepare(ctx, p, 2);
    ctx.beginPath();
    ctx.moveTo(CX + TICK, CY);
    ctx.lineTo(CX + TICK, CY - 5.5);
    ctx.stroke();
  },
};

/**
 * Media flecha paralela al rumbo, a `dx` del trazo (con signo: + al este) y
 * apuntando hacia `sentido` (−1 al norte del lienzo, +1 al sur). Ocupa solo
 * la mitad del trazo hacia la que apunta, así que las dos flechas quedan
 * desfasadas —como en las cartas— y ninguna pisa el tic de manteo, que sale
 * del centro. La barba va hacia AFUERA del trazo: la flecha dice hacia dónde
 * se mueve ESE bloque.
 */
function halfArrow(ctx, p, dx, sentido) {
  const x = CX + dx;
  const cola = CY + sentido * 3;
  const punta = CY + sentido * (HALF_STRIKE - 0.5);
  prepare(ctx, p, 1.6);
  ctx.beginPath();
  ctx.moveTo(x, cola);
  ctx.lineTo(x, punta);
  ctx.lineTo(x + Math.sign(dx) * 3.2, punta - sentido * 4.2);
  ctx.stroke();
}

/**
 * Ornamento de la cinemática de un plano de falla, sobre el símbolo base.
 *
 * El lienzo tiene el rumbo al norte y el manteo al este (derecha), así que el
 * bloque colgante es el de la derecha:
 *
 * - **Normal**: bola en el extremo del tic, del lado que baja — la bola de
 *   las cartas va sobre el bloque hundido.
 * - **Inverse**: diente triangular del lado del bloque colgante, el que
 *   cabalga, como los dientes de una traza de cabalgamiento.
 * - **Left / Right-lateral**: dos medias flechas paralelas al rumbo, una por
 *   bloque, en sentidos opuestos. En una dextral, mirando a través de la
 *   falla el otro bloque se va hacia la DERECHA: el bloque este baja por el
 *   lienzo y el oeste sube. La sinistral es el espejo.
 *
 * En una falla sin sentido declarado (lo importado que no lo trae) no se
 * dibuja nada: inventarle cinemática sería peor que no mostrarla.
 */
const FAULT_ORNAMENTS = {
  none: () => {},
  normal: (ctx, p) => {
    ctx.beginPath();
    ctx.arc(CX + TICK + 0.5, CY, 2.7, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    prepare(ctx, p, 0.6);
    ctx.stroke();
  },
  inverse: (ctx, p) => {
    fillShape(ctx, p, [
      [CX, CY - 4.2],
      [CX + 7, CY],
      [CX, CY + 4.2],
    ]);
  },
  'right-lateral': (ctx, p) => {
    halfArrow(ctx, p, 5, 1);
    halfArrow(ctx, p, -5, -1);
  },
  'left-lateral': (ctx, p) => {
    halfArrow(ctx, p, 5, -1);
    halfArrow(ctx, p, -5, 1);
  },
};

const FAULT_TYPE = 'fault-plane';

/** Claves de sentido de un plano de falla, más la de «sin declarar». */
const FAULT_SENSE_KEYS = [...FAULT_SENSES.map((f) => f.id), 'none'];

/** Dibujo completo de un símbolo, un pase (halo o color). */
function drawSymbol(ctx, p, key, variant) {
  if (key.startsWith(`${FAULT_TYPE}-`)) {
    const sentido = key.slice(FAULT_TYPE.length + 1);
    // El trazo de rumbo de una falla es más grueso: se lee como falla antes
    // que como capa, incluso donde el color no alcanza a distinguirse.
    // Una falla horizontal no tiene rumbo con el que orientar el ornamento:
    // se dibuja la cruz de siempre, sin cinemática que no se puede situar.
    if (variant === 'horizontal') {
      DRAWINGS.horizontal(ctx, p, 'line');
      return;
    }
    strikeLine(ctx, p, 2.8);
    if (sentido !== 'inverse') dipTick(ctx, p, 1);
    if (variant === 'vertical') dipTick(ctx, p, -1);
    (FAULT_ORNAMENTS[sentido] || FAULT_ORNAMENTS.none)(ctx, p);
    return;
  }
  DRAWINGS[variant](ctx, p, key === 'foliation' ? 'triangle' : 'line');
}

/**
 * Sufijo de la copia en el color de lo importado.
 *
 * Una medida bajada de StraboSpot es el mismo símbolo —mismo trazo, mismo
 * tic— pero en el color único de lo ajeno, para que se vea de un vistazo qué
 * manteos midió uno y cuáles vienen de la libreta de otro. Es una SEGUNDA
 * imagen y no un recoloreado en vivo por el mismo motivo que en los
 * ornamentos: MapLibre no recolorea un icono que no sea SDF, y un SDF de
 * cuatro trazos finos se ve sucio.
 */
const IMPORTED_SUFFIX = '-imp';

export const structureImageName = (key, variant, imported = false) =>
  `str-${key}-${variant}${imported ? IMPORTED_SUFFIX : ''}`;

/**
 * Claves de símbolo: una por tipo de superficie, salvo el plano de falla, que
 * tiene una por sentido de movimiento (`fault-plane-normal`, …) porque el
 * ornamento es parte del dibujo.
 */
export function structureImageKeys() {
  return STRUCTURE_TYPES.flatMap((t) =>
    t.id === FAULT_TYPE ? FAULT_SENSE_KEYS.map((k) => `${FAULT_TYPE}-${k}`) : [t.id],
  );
}

const typeOfKey = (key) => (key.startsWith(`${FAULT_TYPE}-`) ? FAULT_TYPE : key);

/** Todos los pares clave × variante que hay que registrar. */
function everyImage() {
  const out = [];
  for (const k of structureImageKeys()) {
    for (const v of STRUCTURE_VARIANTS) out.push([k, v]);
  }
  return out;
}

const imageFor = (key, variant, color) =>
  render(W, H, (ctx) => {
    for (const p of passes(color)) drawSymbol(ctx, p, key, variant);
  });

/** Último color con el que se rasterizaron las copias de lo importado. */
let importedColorDrawn = null;

export function addStructureImages(map, importStyle = defaultImportStyle()) {
  for (const [key, variant] of everyImage()) {
    const name = structureImageName(key, variant);
    if (!map.hasImage(name)) {
      const color = STRUCTURE_TYPE_BY_ID.get(typeOfKey(key)).color;
      map.addImage(name, imageFor(key, variant, color), { pixelRatio: DPR });
    }
    const ajeno = structureImageName(key, variant, true);
    if (!map.hasImage(ajeno)) {
      map.addImage(ajeno, imageFor(key, variant, importStyle.color), { pixelRatio: DPR });
    }
  }
  importedColorDrawn = importStyle.color;
}

/**
 * Cambiar el color de lo importado redibuja solo esa tanda de iconos, y solo
 * si de verdad cambió: arrastrar el selector de color dispara un evento por
 * píxel de recorrido.
 */
export function applyImportStyle(map, importStyle) {
  if (!importStyle || importStyle.color === importedColorDrawn) return;
  for (const [key, variant] of everyImage()) {
    const name = structureImageName(key, variant, true);
    if (map.hasImage(name)) map.updateImage(name, imageFor(key, variant, importStyle.color));
  }
  importedColorDrawn = importStyle.color;
}

/**
 * Elige el icono según tipo, manteo e inversión. Los umbrales viven en
 * `symbology.js` y aquí se replican como expresión de MapLibre, porque
 * `icon-image` se evalúa por elemento en el motor de estilo y no puede llamar
 * a `structureVariant()`.
 */
const variantExpr = [
  'case',
  ['<=', ['coalesce', ['get', 'dip'], 0], HORIZONTAL_DIP_MAX],
  'horizontal',
  ['>=', ['coalesce', ['get', 'dip'], 0], VERTICAL_DIP_MIN],
  'vertical',
  ['==', ['get', 'overturned'], true],
  'overturned',
  'inclined',
];

const typeExpr = [
  'match',
  ['get', 'type'],
  ...STRUCTURE_TYPES.filter((t) => t.id !== FAULT_TYPE).flatMap((t) => [t.id, t.id]),
  FAULT_TYPE,
  [
    'concat',
    `${FAULT_TYPE}-`,
    [
      'match',
      ['coalesce', ['get', 'faultSense'], ''],
      ...FAULT_SENSES.flatMap((f) => [f.id, f.id]),
      'none',
    ],
  ],
  'bedding',
];

/**
 * El icono: tipo y variante, más el sufijo de lo importado cuando el color
 * único está encendido. Con él apagado, un manteo de StraboSpot se dibuja con
 * la simbología de siempre, que es lo que pide quien ya no quiere distinguir.
 */
export function structureIconExpr(importStyle = defaultImportStyle()) {
  const base = ['concat', 'str-', typeExpr, '-', variantExpr];
  if (!importStyle.uniform) return base;
  return ['concat', base, ['case', IMPORTED_FILTER, IMPORTED_SUFFIX, '']];
}

/**
 * Solo se rotan los símbolos que tienen orientación. El de horizontal es una
 * cruz en un círculo: rotarlo por un rumbo que no está determinado sugeriría
 * una dirección inexistente.
 */
const rotateExpr = [
  'case',
  ['<=', ['coalesce', ['get', 'dip'], 0], HORIZONTAL_DIP_MAX],
  0,
  ['coalesce', ['get', 'strike'], 0],
];

const iconSize = (size) => ['interpolate', ['linear'], ['zoom'], 11, 0.75 * size, 16, 1 * size];

/** Filtro común: puntos de medida, y nada más. */
const MEASUREMENT_FILTER = [
  'all',
  ['==', ['geometry-type'], 'Point'],
  ['==', ['get', 'geomKind'], 'measurement'],
];

export const STRUCTURE_SOURCE = GEOLOGY_SOURCE;

/**
 * Desde qué zoom se escribe el manteo. Lo elige el usuario —en un
 * afloramiento denso los números tapan los símbolos hasta muy cerca, y en uno
 * disperso se quieren ver desde lejos—, pero nunca por debajo del zoom del
 * propio símbolo: un número sin el trazo que lo explica no se lee.
 */
const labelMinzoom = (style) =>
  Math.max(style.minzoom, Number.isFinite(style.labelMinzoom) ? style.labelMinzoom : 13);

export function structureLayers(style = defaultStructureStyle(), importStyle = defaultImportStyle()) {
  return [
    // Halo de selección, hermano del de las líneas: va debajo del símbolo.
    {
      id: 'structure-selected',
      type: 'circle',
      source: GEOLOGY_SOURCE,
      filter: ['all', ...MEASUREMENT_FILTER.slice(1), ['in', ['get', 'id'], ['literal', []]]],
      paint: {
        'circle-radius': 13,
        'circle-color': '#00E5FF',
        'circle-opacity': 0.35,
        'circle-blur': 0.5,
      },
    },
    {
      id: 'structure-symbols',
      type: 'symbol',
      source: GEOLOGY_SOURCE,
      minzoom: style.minzoom,
      filter: MEASUREMENT_FILTER,
      layout: {
        'icon-image': structureIconExpr(importStyle),
        'icon-rotate': rotateExpr,
        'icon-rotation-alignment': 'map',
        // Las medidas se agrupan en los afloramientos buenos: dejar que
        // MapLibre descarte las que chocan escondería justo las que más hay.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': iconSize(style.size),
      },
      paint: { 'icon-opacity': 1 },
    },
    {
      id: 'structure-labels',
      type: 'symbol',
      source: GEOLOGY_SOURCE,
      minzoom: labelMinzoom(style),
      filter: MEASUREMENT_FILTER,
      layout: {
        /*
         * Solo el manteo, que es la convención cartográfica: el rumbo ya lo
         * dice la orientación del trazo, y repetirlo en texto duplica la
         * información y ensucia el mapa. En un plano horizontal ni siquiera hay
         * manteo que escribir.
         */
        'text-field': [
          'case',
          ['<=', ['coalesce', ['get', 'dip'], 0], HORIZONTAL_DIP_MAX],
          '',
          ['to-string', ['round', ['coalesce', ['get', 'dip'], 0]]],
        ],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0.9, 0.7],
        'text-anchor': 'left',
        'text-allow-overlap': false,
        'visibility': style.showLabels ? 'visible' : 'none',
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 1.4,
      },
    },
  ];
}

export const STRUCTURE_LAYER_IDS = structureLayers().map((l) => l.id);

/** Reaplica tamaño, zoom mínimo y etiquetas sin recrear las capas. */
export function applyStructureStyle(map, style, importStyle) {
  if (map.getLayer('structure-symbols')) {
    if (importStyle) {
      map.setLayoutProperty('structure-symbols', 'icon-image', structureIconExpr(importStyle));
    }
    map.setLayoutProperty('structure-symbols', 'icon-size', iconSize(style.size));
    map.setLayerZoomRange('structure-symbols', style.minzoom, 24);
  }
  if (map.getLayer('structure-labels')) {
    map.setLayoutProperty('structure-labels', 'visibility', style.showLabels ? 'visible' : 'none');
    map.setLayerZoomRange('structure-labels', labelMinzoom(style), 24);
  }
}
