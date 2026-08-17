/**
 * Simbología provisional: el TIPO se codifica en color y el grado de certeza
 * en el patrón de línea. Los ornamentos (dientes de cabalgamiento, ticks de
 * falla normal, flechas de rumbo) quedan para la fase de simbología QGIS.
 */

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
  { id: 'dike', short: 'Dyke', label: 'Dyke', group: 'Dykes', color: '#6D4C41', weight: 1.1 },
];

export const LINE_GROUPS = ['Contacts', 'Faults', 'Dykes'];

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

export const LINE_TYPE_BY_ID = new Map(LINE_TYPES.map((t) => [t.id, t]));
export const POLYGON_TYPE_BY_ID = new Map(POLYGON_TYPES.map((t) => [t.id, t]));
export const CERTAINTY_BY_ID = new Map(CERTAINTIES.map((c) => [c.id, c]));

/**
 * Parámetros de los ornamentos de falla, editables desde el módulo de
 * simbología.
 *
 * - `size`: escala del icono (1 = tamaño nominal del dibujo en canvas).
 * - `spacing`: separación entre iconos a lo largo de la traza, en px.
 * - `offset`: desplazamiento perpendicular respecto de la traza, en px. Es
 *   negativo hacia el lado izquierdo del sentido de digitalización; invertir
 *   el signo es lo que hace el "flip" de un elemento concreto.
 * - `minzoom`: por debajo de este zoom el ornamento no se dibuja, para que a
 *   escala regional la traza no se convierta en una fila de símbolos.
 */
export const ORNAMENT_TYPES = ['thrust-fault', 'normal-fault', 'dextral-fault', 'sinistral-fault'];

export function defaultOrnaments() {
  return {
    'thrust-fault': { size: 1, spacing: 26, offset: -4.5, minzoom: 11 },
    'normal-fault': { size: 1, spacing: 30, offset: -4.5, minzoom: 11 },
    'dextral-fault': { size: 1, spacing: 80, offset: 0, minzoom: 11 },
    'sinistral-fault': { size: 1, spacing: 80, offset: 0, minzoom: 11 },
  };
}

/** Rango admitido de cada parámetro; lo usan la UI y la carga de proyectos. */
export const ORNAMENT_LIMITS = {
  size: { min: 0.4, max: 2.5, step: 0.05 },
  spacing: { min: 10, max: 200, step: 2 },
  offset: { min: -14, max: 14, step: 0.5 },
  minzoom: { min: 0, max: 18, step: 1 },
};

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
  }
  return out;
}
