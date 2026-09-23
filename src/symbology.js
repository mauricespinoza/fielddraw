/**
 * Simbología provisional: el TIPO se codifica en color y el grado de certeza
 * en el patrón de línea. Los ornamentos (dientes de cabalgamiento, ticks de
 * falla normal, flechas de rumbo) quedan para la fase de simbología QGIS.
 */

/**
 * El color dice el GRUPO, y el ornamento dice el tipo.
 *
 * Antes cada tipo tenía su color —el cabalgamiento rojo, la normal naranja, la
 * dextral morada— y eso obligaba a recordar diez colores para leer un mapa. Es
 * además al revés de como se publica: en una carta, todas las fallas son del
 * mismo color y lo que distingue una inversa de una normal son los dientes o
 * los ticks, que FieldDraw ya dibuja. Moviendo la distinción al ornamento, el
 * color queda libre para lo que de verdad hay que ver de un vistazo —esto es
 * una falla, esto es un contacto— y el mapa se lee sin leyenda.
 *
 * Son colores puros a propósito: sobre imagen satelital, un rojo apagado y un
 * café se confunden, y en terreno con sol de frente esa diferencia desaparece
 * del todo. Todos son el valor de PARTIDA — el módulo de simbología los cambia
 * uno a uno, y los nuevos viajan dentro del proyecto.
 */

/** Fallas. El azul no aparece en la naturaleza sobre la que se dibuja. */
export const FAULT_COLOR = '#0000ff';

/** Pliegues. Sobre satelital no se confunde con ningún contacto ni falla. */
export const FOLD_COLOR = '#ff00ff';

/** Contactos. Negro, como en cualquier carta impresa; el halo blanco lo separa
 *  del fondo oscuro de la imagen. */
export const CONTACT_COLOR = '#000000';

/** Diques. Rojo pleno: son cuerpos, no límites, y conviene que salten. */
export const DIKE_COLOR = '#ff0000';

/** `short` es lo que se ve en la paleta compacta; `label` va en tooltips. */
export const LINE_TYPES = [
  { id: 'stratigraphic-contact', short: 'Strat.', label: 'Stratigraphic contact', group: 'Contacts', color: CONTACT_COLOR, weight: 1 },
  { id: 'intrusive-contact', short: 'Intrus.', label: 'Intrusive contact', group: 'Contacts', color: CONTACT_COLOR, weight: 1 },
  { id: 'structural-contact', short: 'Struct.', label: 'Structural contact', group: 'Contacts', color: CONTACT_COLOR, weight: 1 },
  { id: 'thrust-fault', short: 'Thrust', label: 'Reverse fault / thrust', group: 'Faults', color: FAULT_COLOR, weight: 1.35 },
  { id: 'normal-fault', short: 'Normal', label: 'Normal fault', group: 'Faults', color: FAULT_COLOR, weight: 1.25 },
  { id: 'dextral-fault', short: 'Dextral', label: 'Dextral fault', group: 'Faults', color: FAULT_COLOR, weight: 1.25 },
  { id: 'sinistral-fault', short: 'Sinistr.', label: 'Sinistral fault', group: 'Faults', color: FAULT_COLOR, weight: 1.25 },
  { id: 'undefined-fault', short: 'Undiff.', label: 'Undifferentiated fault', group: 'Faults', color: FAULT_COLOR, weight: 1.15 },
  { id: 'antiform', short: 'Antif.', label: 'Antiform (anticline axial trace)', group: 'Folds', color: FOLD_COLOR, weight: 1.3 },
  { id: 'synform', short: 'Synf.', label: 'Synform (syncline axial trace)', group: 'Folds', color: FOLD_COLOR, weight: 1.3 },
  { id: 'dike', short: 'Dyke', label: 'Dyke', group: 'Dykes', color: DIKE_COLOR, weight: 1.1 },
];

export const LINE_GROUPS = ['Contacts', 'Faults', 'Folds', 'Dykes'];

export const POLYGON_TYPES = [
  { id: 'intrusive-unit', label: 'Intrusive unit', color: '#E57373' },
  { id: 'volcanic-unit', label: 'Volcanic unit', color: '#BA68C8' },
  { id: 'sedimentary-unit', label: 'Sedimentary unit', color: '#FFB74D' },
  { id: 'metamorphic-unit', label: 'Metamorphic unit', color: '#4DB6AC' },
  { id: 'quaternary-cover', label: 'Quaternary cover', color: '#FFF176' },
  { id: 'alteration-zone', label: 'Alteration zone', color: '#A1887F' },
];

/**
 * Superficies planares que se miden con rumbo y manteo.
 *
 * Deliberadamente corta: son las que se anotan en una jornada normal de
 * cartografía. Cada una lleva su color porque en un afloramiento con
 * estratificación y foliación superpuestas hay que distinguirlas de un vistazo,
 * y el símbolo de ambas es el mismo trazo con su tic.
 *
 * El margen de un dique NO es una de ellas: un dique es un CUERPO, no una
 * superficie suelta, y ya se cartografía como tal —con su propia traza en
 * `LINE_TYPES` y, si hace falta rellenarlo, su propia unidad en
 * `POLYGON_TYPES`—. Tratarlo además como un quinto tipo de medida puntual
 * duplicaba la pregunta: "¿qué es esto?" ya la contesta la traza o el
 * polígono que se dibuja, y no hace falta volver a contestarla en cada punto.
 */
export const STRUCTURE_TYPES = [
  { id: 'bedding', short: 'S₀', label: 'Bedding', color: '#212121' },
  { id: 'foliation', short: 'S₁', label: 'Foliation / cleavage', color: '#2E7D32' },
  { id: 'joint', short: 'Jnt', label: 'Joint', color: '#1565C0' },
  { id: 'fault-plane', short: 'Flt', label: 'Fault plane', color: '#D32F2F' },
];

export const STRUCTURE_TYPE_BY_ID = new Map(STRUCTURE_TYPES.map((t) => [t.id, t]));

/**
 * Sentido de movimiento de un plano de falla medido.
 *
 * Se pregunta al elegir Flt porque es lo que el símbolo tiene que decir: un
 * plano de falla sin cinemática es solo otra superficie, y el ornamento
 * —bola, diente, medias flechas— es justamente la convención de las cartas
 * para leerla sin leyenda. `none` queda para lo importado que no la declara.
 */
export const FAULT_SENSES = [
  { id: 'normal', short: 'N', label: 'Normal' },
  { id: 'inverse', short: 'Inv', label: 'Inverse' },
  { id: 'left-lateral', short: 'LL', label: 'Left-lateral' },
  { id: 'right-lateral', short: 'RL', label: 'Right-lateral' },
];

export const FAULT_SENSE_BY_ID = new Map(FAULT_SENSES.map((t) => [t.id, t]));

/** Sentido válido, o '' si no hay (o no se reconoce). */
export const sanitizeFaultSense = (v) => (FAULT_SENSE_BY_ID.has(v) ? v : '');

/**
 * Umbrales de las variantes del símbolo.
 *
 * No son adorno: un manteo de 2° medido sobre un DEM de 30 m es
 * indistinguible de cero, y dibujarle un tic apuntando a algún lado afirma una
 * dirección de manteo que el dato no sostiene. Por debajo de `HORIZONTAL_DIP_MAX`
 * se dibuja el símbolo de horizontal, que no tiene dirección; por encima de
 * `VERTICAL_DIP_MIN`, el de vertical, que tiene tic a los dos lados.
 */
export const HORIZONTAL_DIP_MAX = 3;
export const VERTICAL_DIP_MIN = 87;

/** Variante del símbolo que le toca a una medida. */
export function structureVariant(dip, overturned = false) {
  if (!Number.isFinite(dip)) return 'inclined';
  if (dip <= HORIZONTAL_DIP_MAX) return 'horizontal';
  if (dip >= VERTICAL_DIP_MIN) return 'vertical';
  return overturned ? 'overturned' : 'inclined';
}

export const STRUCTURE_VARIANTS = ['inclined', 'vertical', 'horizontal', 'overturned'];

export const STRUCTURE_SIZE_LIMITS = { min: 0.5, max: 2.5, step: 0.1 };

/**
 * El zoom mínimo existe para que a escala regional el mapa no se convierta en
 * una alfombra de símbolos. Pero tiene que quedar POR DEBAJO del zoom al que
 * arranca la app (11,5): con el valor anterior —12— la primera medida que
 * alguien tomaba no aparecía en pantalla, y eso no se lee como "está fuera de
 * escala", se lee como "no funciona".
 */
export function defaultStructureStyle() {
  return { size: 1, showLabels: true, minzoom: 10, labelMinzoom: 13 };
}

export function sanitizeStructureStyle(raw) {
  const out = defaultStructureStyle();
  if (!raw || typeof raw !== 'object') return out;
  const size = Number(raw.size);
  if (Number.isFinite(size)) {
    out.size = Math.min(STRUCTURE_SIZE_LIMITS.max, Math.max(STRUCTURE_SIZE_LIMITS.min, size));
  }
  const minzoom = Number(raw.minzoom);
  if (Number.isFinite(minzoom)) out.minzoom = Math.min(18, Math.max(0, Math.round(minzoom)));
  // Desde qué zoom se escribe el manteo junto al símbolo. Nunca por debajo del
  // del propio símbolo: un número flotando sin trazo que lo explique no se lee.
  const labelMinzoom = Number(raw.labelMinzoom);
  if (Number.isFinite(labelMinzoom)) {
    out.labelMinzoom = Math.min(20, Math.max(0, Math.round(labelMinzoom)));
  }
  if (typeof raw.showLabels === 'boolean') out.showLabels = raw.showLabels;
  return out;
}

/** `dash` va en múltiplos del ancho de línea, que es como lo lee MapLibre. */
export const CERTAINTIES = [
  { id: 'observed', short: 'Obs', label: 'Observed', dash: null, cap: 'round' },
  { id: 'inferred', short: 'Inf', label: 'Inferred', dash: [2.6, 1.7], cap: 'butt' },
  { id: 'covered', short: 'Cov', label: 'Concealed', dash: [0.1, 1.9], cap: 'round' },
];

/**
 * Tipos que solo se cartografían como observados.
 *
 * El eje de un pliegue se traza donde se ve el cierre o donde lo obligan los
 * manteos medidos; "inferido" o "cubierto" no son grados de certeza que se le
 * apliquen a un eje, y ofrecerlos solo produce datos que después nadie sabe
 * interpretar. La restricción se aplica en el store y no solo en la UI, para
 * que tampoco entre por un proyecto ajeno o por un GeoPackage importado.
 */
export const OBSERVED_ONLY_TYPES = new Set(['antiform', 'synform']);

export const isObservedOnly = (type) => OBSERVED_ONLY_TYPES.has(type);

/** La certeza que de verdad le corresponde a un tipo. */
export const certaintyFor = (type, certainty) =>
  isObservedOnly(type) ? 'observed' : certainty;

export const LINE_TYPE_BY_ID = new Map(LINE_TYPES.map((t) => [t.id, t]));
export const POLYGON_TYPE_BY_ID = new Map(POLYGON_TYPES.map((t) => [t.id, t]));
export const CERTAINTY_BY_ID = new Map(CERTAINTIES.map((c) => [c.id, c]));

/**
 * Parámetros de la simbología de línea, editables desde su módulo.
 *
 * Los lleva TODO tipo de línea, tenga ornamento o no: un contacto no tiene
 * dientes que espaciar, pero sí color y grosor, y esos dos son justamente lo
 * que se retoca al preparar una figura —un contacto fino y negro se pierde
 * sobre una ortofoto oscura, y engordarlo no debería obligar a exportar a
 * QGIS—. Los tipos con ornamento añaden encima los campos del icono.
 *
 * - `color`: color del trazo Y de su ornamento. Sale del catálogo de arriba y
 *   se puede cambiar; es lo único del catálogo que el usuario reescribe, y por
 *   eso vive aquí, junto al resto de la simbología que ya se guarda en
 *   localStorage y viaja dentro del proyecto.
 * - `width`: factor de grosor de la traza. Parte del `weight` del catálogo, así
 *   que 1 no es «un píxel» sino «el grosor nominal de este tipo».
 * - `size`: escala del icono (1 = tamaño nominal del dibujo en canvas).
 * - `spacing`: separación entre iconos a lo largo de la traza, en px.
 * - `offset`: desplazamiento perpendicular respecto de la traza, en px. Es
 *   negativo hacia el lado izquierdo del sentido de digitalización. El "flip"
 *   de un elemento concreto no toca este número: refleja el símbolo respecto
 *   de la traza, y con eso cambia de lado (ver `ornaments.js`). En los pliegues
 *   el offset es 0 y no se ofrece flip: las flechas van a caballo del eje.
 * - `minzoom`: por debajo de este zoom el ornamento no se dibuja, para que a
 *   escala regional la traza no se convierta en una fila de símbolos.
 */
export const ORNAMENT_TYPES = [
  'thrust-fault',
  'normal-fault',
  'dextral-fault',
  'sinistral-fault',
  'antiform',
  'synform',
];

/**
 * Los que tiene sentido voltear. Un pliegue no está: sus flechas son simétricas
 * respecto del eje, así que reflejarlas devuelve el mismo dibujo — y un
 * antiforme no pasa a ser sinforme por haberlo digitalizado al revés.
 */
export const FLIPPABLE_ORNAMENT_TYPES = [
  'thrust-fault',
  'normal-fault',
  'dextral-fault',
  'sinistral-fault',
];

/** Todos los tipos que el módulo de simbología deja tocar: o sea, todos. */
export const LINE_STYLE_TYPES = LINE_TYPES.map((t) => t.id);

/** Campos del icono; solo los llevan los tipos con ornamento. */
const ORNAMENT_FIELDS = {
  'thrust-fault': { size: 1, spacing: 26, offset: -4.5, minzoom: 11 },
  'normal-fault': { size: 1, spacing: 30, offset: -4.5, minzoom: 11 },
  // `gap`: separación de cada media flecha respecto de la traza, en px. Solo
  // la llevan las de rumbo: es lo que se ajusta cuando una traza gruesa se
  // come las flechas, o cuando quedan tan lejos que parecen de otra línea.
  'dextral-fault': { size: 1, spacing: 80, offset: 0, gap: 3, minzoom: 11 },
  'sinistral-fault': { size: 1, spacing: 80, offset: 0, gap: 3, minzoom: 11 },
  // Los pliegues van más espaciados: el símbolo es alto, y una fila apretada
  // sobre el eje se lee como una banda y no como un pliegue.
  antiform: { size: 1, spacing: 64, offset: 0, minzoom: 11 },
  synform: { size: 1, spacing: 64, offset: 0, minzoom: 11 },
};

export function defaultOrnaments() {
  const out = {};
  for (const t of LINE_TYPES) {
    out[t.id] = { color: t.color, width: t.weight, ...(ORNAMENT_FIELDS[t.id] || {}) };
  }
  return out;
}

/** Rango admitido de cada parámetro numérico; lo usan la UI y la carga de proyectos. */
export const ORNAMENT_LIMITS = {
  width: { min: 0.3, max: 4, step: 0.05 },
  size: { min: 0.4, max: 2.5, step: 0.05 },
  spacing: { min: 10, max: 200, step: 2 },
  offset: { min: -14, max: 14, step: 0.5 },
  gap: { min: 1, max: 12, step: 0.5 },
  minzoom: { min: 0, max: 18, step: 1 },
};

/**
 * El color se valida contra un hex de seis dígitos y no se acepta de otra
 * forma: acaba dentro de un atributo de estilo del panel y dentro del QML que
 * se exporta, y un proyecto ajeno no tiene por qué poder escribir ahí.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Normaliza un objeto de simbología de línea venido de un proyecto o de
 * localStorage. Un proyecto anterior a que los contactos fueran editables solo
 * trae los seis tipos con ornamento; el resto se completa con el catálogo, así
 * que abrirlo no cambia cómo se ve.
 *
 * Solo se acepta lo que el tipo REALMENTE tiene: un espaciado escrito sobre un
 * contacto no significa nada, y guardarlo dejaría un campo fantasma en el
 * proyecto que nadie lee.
 */
export function sanitizeOrnaments(raw) {
  const out = defaultOrnaments();
  if (!raw || typeof raw !== 'object') return out;
  for (const type of LINE_STYLE_TYPES) {
    const src = raw[type];
    if (!src || typeof src !== 'object') continue;
    for (const [key, lim] of Object.entries(ORNAMENT_LIMITS)) {
      if (!(key in out[type])) continue;
      const v = Number(src[key]);
      if (Number.isFinite(v)) out[type][key] = Math.min(lim.max, Math.max(lim.min, v));
    }
    if (typeof src.color === 'string' && HEX_COLOR.test(src.color.trim())) {
      out[type].color = src.color.trim().toLowerCase();
    }
  }
  return out;
}

/* ---------- lo que no se dibujó aquí ---------- */

/**
 * Marca de procedencia de un elemento adoptado. Va en `properties.source` y
 * viaja con el elemento: en el proyecto, en el GeoPackage y en la vuelta a
 * StraboSpot.
 */
export const STRABO_SOURCE = 'strabospot';

/**
 * Color único de lo traído de StraboSpot.
 *
 * Al adoptar un dataset, sus contactos y sus fallas pasan a ser elementos del
 * dibujo como cualquier otro, y ahí se pierde algo que importa: cuál de estos
 * trazos lo caminó uno y cuál viene de la libreta de otra persona. Pintarlos
 * todos de un color propio lo devuelve de un vistazo, sin abrir atributos y
 * sin renunciar a editarlos.
 *
 * Es el mismo morado con el que ya se dibujan las capas de StraboSpot en
 * solo lectura, así que adoptar no cambia el aspecto del mapa: cambia lo que
 * se puede hacer con él.
 */
export function defaultImportStyle() {
  return { uniform: true, color: '#7e57c2' };
}

export function sanitizeImportStyle(raw) {
  const out = defaultImportStyle();
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.uniform === 'boolean') out.uniform = raw.uniform;
  if (typeof raw.color === 'string' && HEX_COLOR.test(raw.color.trim())) {
    out.color = raw.color.trim().toLowerCase();
  }
  return out;
}

/** Condición de MapLibre «este elemento vino de StraboSpot». */
export const IMPORTED_FILTER = ['==', ['get', 'source'], STRABO_SOURCE];

/**
 * Envuelve una expresión de color para que lo importado salga del color único.
 * Con `uniform: false` devuelve la expresión tal cual: el usuario decidió que
 * quiere verlo con la simbología normal.
 */
export function withImportColor(expr, importStyle) {
  if (!importStyle || !importStyle.uniform) return expr;
  return ['case', IMPORTED_FILTER, importStyle.color, expr];
}

/**
 * Color con el que se dibuja un tipo de línea: el que el usuario haya puesto en
 * el módulo de simbología, o el del catálogo. Los tipos sin ornamento no son
 * editables y salen siempre del catálogo.
 */
export function effectiveLineColor(type, ornaments) {
  const o = ornaments && ornaments[type];
  if (o && o.color) return o.color;
  const t = LINE_TYPE_BY_ID.get(type);
  return t ? t.color : '#888888';
}

/** El mapa completo tipo -> color efectivo, para las expresiones de MapLibre. */
export function lineColorMap(ornaments) {
  const out = {};
  for (const t of LINE_TYPES) out[t.id] = effectiveLineColor(t.id, ornaments);
  return out;
}

/**
 * Grosor con el que se dibuja un tipo de línea: el que el usuario haya puesto,
 * o el `weight` del catálogo. Es un FACTOR sobre la rampa de zoom, no un ancho
 * en píxeles: así el mismo ajuste vale a escala regional y a escala de detalle.
 */
export function effectiveLineWeight(type, ornaments) {
  const o = ornaments && ornaments[type];
  const v = o && Number(o.width);
  if (Number.isFinite(v) && v > 0) return v;
  const t = LINE_TYPE_BY_ID.get(type);
  return t ? t.weight : 1;
}
