/**
 * Coordenadas geográficas ↔ UTM (WGS84) y su texto de campo.
 *
 * Es matemática pura, sin DOM, para poder probarla con `node` (ver
 * `test/utm.test.mjs`). Usa la serie de Krüger/Snyder de la proyección
 * Transversa de Mercator, con k0 = 0,9996 y falso este de 500 000 m. En el
 * hemisferio sur se suma el falso norte de 10 000 000 m. Con la serie de
 * sexto orden el error es de milímetros dentro del huso, que es mucho más fino
 * que cualquier GPS de teléfono.
 *
 * El huso sigue las excepciones de Noruega (32V) y Svalbard (31X, 33X, 35X,
 * 37X). Fuera de 80°S–84°N no hay UTM: la proyección se reemplaza por la polar
 * estereográfica, y `toUTM` devuelve `null` en lugar de inventar un número.
 */

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const BANDAS = 'CDEFGHJKLMNPQRSTUVWX';

const rad = (d) => (d * Math.PI) / 180;

/** Número de huso (1–60) que corresponde a una posición, con excepciones. */
export function zonaUTM(lat, lon) {
  let z = Math.floor((lon + 180) / 6) + 1;
  if (z > 60) z = 60;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) return 31;
    if (lon >= 9 && lon < 21) return 33;
    if (lon >= 21 && lon < 33) return 35;
    if (lon >= 33 && lon < 42) return 37;
  }
  return z;
}

/** Letra de banda de latitud (C…X, sin I ni O). */
export function bandaUTM(lat) {
  if (lat >= 72) return 'X';
  return BANDAS[Math.floor((lat + 80) / 8)];
}

/**
 * @returns {{zone:number, band:string, south:boolean, easting:number, northing:number}|null}
 */
export function toUTM(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -80 || lat > 84 || lon < -180 || lon > 180) return null;

  const zone = zonaUTM(lat, lon);
  const lon0 = rad((zone - 1) * 6 - 180 + 3);
  const p = rad(lat);
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const tp = Math.tan(p);

  const N = A / Math.sqrt(1 - E2 * sp * sp);
  const T = tp * tp;
  const C = EP2 * cp * cp;
  const a = (rad(lon) - lon0) * cp;

  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const M =
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * p -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * p) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * p) -
      ((35 * e6) / 3072) * Math.sin(6 * p));

  const easting =
    K0 *
      N *
      (a +
        ((1 - T + C) * a ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120) +
    500000;
  let northing =
    K0 *
    (M +
      N *
        tp *
        ((a * a) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720));
  const south = lat < 0;
  if (south) northing += 10000000;

  return { zone, band: bandaUTM(lat), south, easting, northing };
}

/** `19H 710234 5923456`, el formato que se dicta y se teclea en un GPS. */
export function formatUTM(u) {
  if (!u) return '';
  return `${u.zone}${u.band} ${Math.round(u.easting)} ${Math.round(u.northing)}`;
}

/** `36.827000° S`, con el hemisferio en letra y no con el signo. */
export function formatLat(lat) {
  return `${Math.abs(lat).toFixed(6)}° ${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLon(lon) {
  return `${Math.abs(lon).toFixed(6)}° ${lon >= 0 ? 'E' : 'W'}`;
}
