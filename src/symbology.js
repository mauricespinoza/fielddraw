/**
 * Simbología provisional: el TIPO se codifica en color y el grado de certeza
 * en el patrón de línea. Los ornamentos (dientes de cabalgamiento, ticks de
 * falla normal, flechas de rumbo) quedan para la fase de simbología QGIS.
 */

/**
 * Magenta para los pliegues: sobre imagen satelital no se confunde con ningún
 * contacto ni falla, que es justo lo que se le pide a un eje. Es solo el valor
 * de partida — el módulo de simbología lo cambia, y el nuevo viaja dentro del
 * proyecto.
 */
export const FOLD_COLOR = '#ff00ff';

/** `short` es lo que se ve en la paleta compacta; `label` va en tooltips. */
export const LINE_TYPES = [
  { id: 'stratigraphic-contact', short: 'Strat.', label: 'Stratigraphic contact', group: 'Contacts', color: '#212121', weight: 1 },
  { id: 'intrusive-contact', short: 'Intrus.', label: 'Intrusive contact', group: 'Contacts', color: '#C2185B', weight: 1 },
  { id: 'structural-contact', short: 'Struct.', label: 'Structural contact', group: 'Contacts', color: '#2E7D32', weight: 1 },
  { id: 'thrust-fault', short: 'Thrust', label: 'Reverse fault / thrust', group: 'Faults', color: '#D32F2F', weight: 1.35 },
  { id: 'normal-fault', short: 'Normal', label: 'Normal fault', group: 'Faults', color: '#F57C00', weight: 1.25 },
  { id: 'dextral-fault', short: 'Dextral', label: 'Dextral fault', group: 'Faults', color: '#7B1FA2', weight: 1.25 },
  { id: 'sinistral-fault', short: 'Sinistr.', label: 'Sinistral fault', group: 'Faults', color: '#00838F', weight: 1.25 },
  { id: 'undefined-fault', short: 'Undiff.', label: 'Undifferentiated fault', group: 'Faults', color: '#546E7A', weight: 1.15 },
  { id: 'antiform', short: 'Antif.', label: 'Antiform (anticline axial trace)', group: 'Folds', color: FOLD_COLOR, weight: 1.3 },
  { id: 'synform', short: 'Synf.', label: 'Synform (syncline axial trace)', group: 'Folds', color: FOLD_COLOR, weight: 1.3 },
  { id: 'dike', short: 'Dyke', label: 'Dyke', group: 'Dykes', color: '#6D4C41', weight: 1.1 },
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
 * Parámetros de los ornamentos, editables desde el módulo de simbología.
 *
 * - `color`: color del trazo Y de su ornamento. Sale del catálogo de arriba y
 *   se puede cambiar; es lo único del catálogo que el usuario reescribe, y por
 *   eso vive aquí, junto al resto de la simbología que ya se guarda en
 *   localStorage y viaja dentro del proyecto.
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

export function defaultOrnaments() {
  const color = (id) => LINE_TYPE_BY_ID.get(id).color;
  return {
    'thrust-fault': { color: color('thrust-fault'), size: 1, spacing: 26, offset: -4.5, minzoom: 11 },
    'normal-fault': { color: color('normal-fault'), size: 1, spacing: 30, offset: -4.5, minzoom: 11 },
    'dextral-fault': { color: color('dextral-fault'), size: 1, spacing: 80, offset: 0, minzoom: 11 },
    'sinistral-fault': { color: color('sinistral-fault'), size: 1, spacing: 80, offset: 0, minzoom: 11 },
    // Los pliegues van más espaciados: el símbolo es alto, y una fila apretada
    // sobre el eje se lee como una banda y no como un pliegue.
    antiform: { color: FOLD_COLOR, size: 1, spacing: 64, offset: 0, minzoom: 11 },
    synform: { color: FOLD_COLOR, size: 1, spacing: 64, offset: 0, minzoom: 11 },
  };
}

/** Rango admitido de cada parámetro numérico; lo usan la UI y la carga de proyectos. */
export const ORNAMENT_LIMITS = {
  size: { min: 0.4, max: 2.5, step: 0.05 },
  spacing: { min: 10, max: 200, step: 2 },
  offset: { min: -14, max: 14, step: 0.5 },
  minzoom: { min: 0, max: 18, step: 1 },
};

/**
 * El color se valida contra un hex de seis dígitos y no se acepta de otra
 * forma: acaba dentro de un atributo de estilo del panel y dentro del QML que
 * se exporta, y un proyecto ajeno no tiene por qué poder escribir ahí.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Normaliza un objeto de ornamentos venido de un proyecto o de localStorage. */
export function sanitizeOrnaments(raw) {
  const out = defaultOrnaments();
  if (!raw || typeof raw !== 'object') return out;
  for (const type of ORNAMENT_TYPES) {
    const src = raw[type];
    if (!src || typeof src !== 'object') continue;
    for (const [key, lim] of Object.entries(ORNAMENT_LIMITS)) {
      const v = Number(src[key]);
      if (Number.isFinite(v)) out[type][key] = Math.min(lim.max, Math.max(lim.min, v));
    }
    if (typeof src.color === 'string' && HEX_COLOR.test(src.color.trim())) {
      out[type].color = src.color.trim().toLowerCase();
    }
  }
  return out;
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
