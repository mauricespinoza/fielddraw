/**
 * Notación de planos: rumbo con la regla de la mano derecha (RHR) o
 * manteo/dirección de manteo (Dip/Azimuth).
 *
 * Es una preferencia de LECTURA, no un dato: el dibujo guarda siempre
 * `strike` (RHR) y `dipAzimuth = strike + 90`, que es lo que entienden QGIS,
 * StraboSpot y el resto de la app. Lo que cambia es cómo se escriben y se
 * teclean los números. Por eso vive en el dispositivo —como la clave de
 * OpenTopography— y no en el proyecto: dos geólogos que comparten un .fdproj
 * pueden leerlo cada uno a su manera sin pisarse.
 *
 * Las dos formas, para el mismo plano que mantea 32° hacia el SE:
 *
 *   RHR          045/32   rumbo (3 dígitos) / manteo
 *   Dip/Azimuth  32/135   manteo (2 dígitos) / dirección de manteo (3 dígitos)
 *
 * Los ceros a la izquierda no son adorno: con ellos el orden se lee sin
 * ambigüedad —el número de tres cifras es siempre el acimut—, que es lo que
 * evita confundir un «45/32» RHR con un «32/45» de manteo.
 */

export const NOTATION_RHR = 'rhr';
export const NOTATION_DIPDIR = 'dipdir';
export const NOTATIONS = [NOTATION_RHR, NOTATION_DIPDIR];

const KEY = 'fielddraw.planeNotation';

const norm360 = (a) => ((a % 360) + 360) % 360;

/** Lo guardado en el dispositivo, o RHR si no hay nada (o no hay storage). */
function leer() {
  try {
    const v = globalThis.localStorage && globalThis.localStorage.getItem(KEY);
    return NOTATIONS.includes(v) ? v : NOTATION_RHR;
  } catch {
    return NOTATION_RHR;
  }
}

let actual = leer();

export function getPlaneNotation() {
  return actual;
}

/** Cambia la notación y la recuerda. Devuelve la que quedó puesta. */
export function setPlaneNotation(n) {
  actual = NOTATIONS.includes(n) ? n : NOTATION_RHR;
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(KEY, actual);
  } catch {
    /* sin storage: vale para esta sesión */
  }
  return actual;
}

/** Dirección de manteo de un rumbo RHR. */
export const dipDirFromStrike = (strike) => norm360(strike + 90);

/** Rumbo RHR de una dirección de manteo. */
export const strikeFromDipDir = (dipDir) => norm360(dipDir - 90);

const pad = (n, w) => String(n).padStart(w, '0');

/**
 * Un plano escrito en la notación pedida (o la vigente).
 *
 * El acimut se redondea ANTES de normalizar a [0, 360): 359.6 tiene que salir
 * «000» y no «360».
 */
export function formatPlane(strike, dip, notation = actual) {
  if (!Number.isFinite(strike) || !Number.isFinite(dip)) return '—';
  const d = Math.round(dip);
  if (notation === NOTATION_DIPDIR) {
    return `${pad(d, 2)}/${pad(norm360(Math.round(dipDirFromStrike(strike))), 3)}`;
  }
  return `${pad(norm360(Math.round(norm360(strike))), 3)}/${d}`;
}

/** Nombre corto de la notación, para rótulos: «Strike (RHR) / Dip». */
export function notationLabel(notation = actual) {
  return notation === NOTATION_DIPDIR ? 'Dip / Dip azimuth' : 'Strike (RHR) / Dip';
}
