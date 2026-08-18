import { GEOLOGY_SOURCE } from './geologyStyle.js';
import {
  HORIZONTAL_DIP_MAX,
  STRUCTURE_TYPES,
  STRUCTURE_TYPE_BY_ID,
  STRUCTURE_VARIANTS,
  VERTICAL_DIP_MIN,
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

const DRAWINGS = {
  /** Inclinado: trazo de rumbo y tic hacia el lado del manteo. */
  inclined: (ctx, p) => {
    strikeLine(ctx, p);
    dipTick(ctx, p, 1);
  },

  /** Vertical: tic a los dos lados, porque no hay bloque que cabecee. */
  vertical: (ctx, p) => {
    strikeLine(ctx, p, 2.4);
    dipTick(ctx, p, 1, TICK - 1.5);
    dipTick(ctx, p, -1, TICK - 1.5);
  },

  /**
   * Horizontal: cruz dentro de un círculo. Sin dirección de manteo, que es
   * justamente lo que afirma —y lo que un tic apuntando a algún lado negaría.
   */
  horizontal: (ctx, p) => {
    prepare(ctx, p, 1.8);
    ctx.beginPath();
    ctx.arc(CX, CY, 6.5, 0, Math.PI * 2);
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
  overturned: (ctx, p) => {
    strikeLine(ctx, p);
    dipTick(ctx, p, 1);
    prepare(ctx, p, 2);
    ctx.beginPath();
    ctx.moveTo(CX + TICK, CY);
    ctx.lineTo(CX + TICK, CY - 5.5);
    ctx.stroke();
  },
};

export const structureImageName = (type, variant) => `str-${type}-${variant}`;

/** Todos los pares tipo × variante que hay que registrar. */
function everyImage() {
  const out = [];
  for (const t of STRUCTURE_TYPES) {
    for (const v of STRUCTURE_VARIANTS) out.push([t.id, v]);
  }
  return out;
}

export function addStructureImages(map) {
  for (const [type, variant] of everyImage()) {
    const name = structureImageName(type, variant);
    if (map.hasImage(name)) continue;
    const color = STRUCTURE_TYPE_BY_ID.get(type).color;
    const dibujo = DRAWINGS[variant];
    map.addImage(
      name,
      render(W, H, (ctx) => {
        for (const p of passes(color)) dibujo(ctx, p);
      }),
      { pixelRatio: DPR },
    );
  }
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
  ...STRUCTURE_TYPES.flatMap((t) => [t.id, t.id]),
  'bedding',
];

export const structureIconExpr = ['concat', 'str-', typeExpr, '-', variantExpr];

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

export function structureLayers(style = defaultStructureStyle()) {
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
        'icon-image': structureIconExpr,
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
      minzoom: Math.max(style.minzoom, 13),
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
export function applyStructureStyle(map, style) {
  if (map.getLayer('structure-symbols')) {
    map.setLayoutProperty('structure-symbols', 'icon-size', iconSize(style.size));
    map.setLayerZoomRange('structure-symbols', style.minzoom, 24);
  }
  if (map.getLayer('structure-labels')) {
    map.setLayoutProperty('structure-labels', 'visibility', style.showLabels ? 'visible' : 'none');
    map.setLayerZoomRange('structure-labels', Math.max(style.minzoom, 13), 24);
  }
}
