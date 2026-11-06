/**
 * Declinación magnética local, del World Magnetic Model (WMM2025, NOAA/NGA,
 * dominio público), calculada en el propio teléfono: sin red, que en terreno
 * no suele haber.
 *
 * La brújula del teléfono —como cualquier brújula— apunta al norte MAGNÉTICO.
 * La declinación es el ángulo entre ese norte y el geográfico (positiva al
 * Este): rumbo verdadero = rumbo magnético + declinación. En Chile central es
 * de unos pocos grados, pero en otras zonas pasa de 20°, y cambia con los
 * años (la columna de variación secular de abajo), así que un número fijo
 * apuntado en la libreta deja de valer.
 *
 * El modelo es el desarrollo en armónicos esféricos de grado 12 del campo
 * principal; los coeficientes son los publicados para la época 2025.0, con su
 * variación anual, válidos de fines de 2024 a fines de 2029. Fuera de ese
 * rango se sigue calculando (el error crece despacio) pero se marca como
 * fuera de validez.
 *
 * Coeficientes indexados por n(n+1)/2 + m, en nT y nT/año.
 */

const G = [0, -29351.8, -1410.8, -2556.6, 2951.1, 1649.3, 1361, -2404.1, 1243.8, 453.6, 895, 799.5, 55.7, -281.1, 12.1, -233.2, 368.9, 187.2, -138.7, -142, 20.9, 64.4, 63.8, 76.9, -115.7, -40.9, 14.9, -60.7, 79.5, -77, -8.8, 59.3, 15.8, 2.5, -11.1, 14.2, 23.2, 10.8, -17.5, 2, -21.7, 16.9, 15, -16.8, 0.9, 4.6, 7.8, 3, -0.2, -2.5, -13.1, 2.4, 8.6, -8.7, -12.9, -1.3, -6.4, 0.2, 2, -1, -0.6, -0.9, 1.5, 0.9, -2.7, -3.9, 2.9, -1.5, -2.5, 2.4, -0.6, -0.1, -0.6, -0.1, 1.1, -1, -0.2, 2.6, -2, -0.2, 0.3, 1.2, -1.3, 0.6, 0.6, 0.5, -0.1, -0.4, -0.2, -1.3, -0.7];
const H = [0, 0, 4545.4, 0, -3133.6, -815.1, 0, -56.6, 237.5, -549.5, 0, 278.6, -133.9, 212, -375.6, 0, 45.4, 220.2, -122.9, 43, 106.1, 0, -18.4, 16.8, 48.8, -59.8, 10.9, 72.7, 0, -48.9, -14.4, -1, 23.4, -7.4, -25.1, -2.3, 0, 7.1, -12.6, 11.4, -9.7, 12.7, 0.7, -5.2, 3.9, 0, -24.8, 12.2, 8.3, -3.3, -5.2, 7.2, -0.6, 0.8, 10, 0, 3.3, 0, 2.4, 5.3, -9.1, 0.4, -4.2, -3.8, 0.9, -9.1, 0, 0, 2.9, -0.6, 0.2, 0.5, -0.3, -1.2, -1.7, -2.9, -1.8, -2.3, 0, -1.3, 0.7, 1, -1.4, 0, 0.6, -0.1, 0.8, 0.1, -1, 0.1, 0.2];
const GDOT = [0, 12, 9.7, -11.6, -5.2, -8, -1.3, -4.2, 0.4, -15.6, -1.6, -2.4, -6, 5.6, -7, 0.6, 1.4, 0, 0.6, 2.2, 0.9, -0.2, -0.4, 0.9, 1.2, -0.9, 0.3, 0.9, 0, -0.1, -0.1, 0.5, -0.1, -0.8, -0.8, 0.8, -0.1, 0.2, 0, 0.5, -0.1, 0.3, 0.2, 0, 0.2, 0, -0.1, 0.1, 0.3, -0.3, 0, 0.3, -0.1, 0.1, -0.1, 0.1, 0, 0.1, 0.1, 0, -0.3, 0, -0.1, -0.1, 0, 0, 0, 0, 0, 0, 0, -0.1, 0, 0, -0.1, -0.1, -0.1, -0.1, 0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, -0.1, 0, -0.1];
const HDOT = [0, 0, -21.5, 0, -27.7, -12.1, 0, 4, -0.3, -4.1, 0, -1.1, 4.1, 1.6, -4.4, 0, -0.5, 2.2, 0.4, 1.7, 1.9, 0, 0.3, -1.6, -0.4, 0.9, 0.7, 0.9, 0, 0.6, 0.5, -0.8, 0, -1, 0.6, -0.2, 0, -0.2, 0.5, -0.4, 0.4, -0.5, -0.6, 0.3, 0.2, 0, -0.3, 0.3, -0.3, 0.3, 0.2, -0.1, -0.2, 0.4, 0.1, 0, 0, 0, -0.2, 0.1, -0.1, 0.1, 0, -0.1, 0.2, 0, 0, 0, 0.1, 0, 0.1, 0, 0, 0.1, 0, 0, 0, 0, 0, 0, 0, -0.1, 0.1, 0, 0, 0, 0, 0, 0, 0, -0.1];

const N_MAX = 12;
const EPOCH = 2025.0;
export const WMM_NAME = 'WMM2025';
const VALID_FROM = Date.UTC(2024, 10, 13);
const VALID_TO = Date.UTC(2029, 10, 13);

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
/** Elipsoide WGS84 y radio de referencia del modelo, en km. */
const A = 6378.137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const RE = 6371.2;

/** Año decimal de una fecha. */
export function decimalYear(date) {
  const y = date.getUTCFullYear();
  const t0 = Date.UTC(y, 0, 1);
  const t1 = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - t0) / (t1 - t0);
}

/**
 * Campo magnético en un punto: componentes Norte (X), Este (Y) y abajo (Z)
 * en nT, en el marco geodésico local, más declinación e inclinación en
 * grados.
 *
 * @param {number} lat latitud geodésica, grados
 * @param {number} lon longitud, grados (Este positivo)
 * @param {number} [altKm] altura sobre el elipsoide, km
 * @param {Date} [date]
 */
export function geomagneticField(lat, lon, altKm = 0, date = new Date()) {
  const t = decimalYear(date) - EPOCH;
  const phi = lat * RAD;
  const lam = lon * RAD;

  // Geodésica -> geocéntrica esférica.
  const sphi = Math.sin(phi);
  const cphi = Math.cos(phi);
  const rc = A / Math.sqrt(1 - E2 * sphi * sphi);
  const p = (rc + altKm) * cphi;
  const z = (rc * (1 - E2) + altKm) * sphi;
  const r = Math.hypot(p, z);
  const phic = Math.asin(z / r);

  // Funciones de Legendre semi-normalizadas de Schmidt y sus derivadas
  // respecto de la colatitud θ, con x = cos θ = sin φ', s = sin θ = cos φ'.
  const x = Math.sin(phic);
  const s = Math.cos(phic);
  const P = [];
  const dP = [];
  for (let n = 0; n <= N_MAX; n++) {
    P.push(new Float64Array(n + 1));
    dP.push(new Float64Array(n + 1));
  }
  P[0][0] = 1;
  dP[0][0] = 0;
  for (let n = 1; n <= N_MAX; n++) {
    if (n === 1) {
      P[1][1] = s;
      dP[1][1] = x;
    } else {
      const k = Math.sqrt((2 * n - 1) / (2 * n));
      P[n][n] = k * s * P[n - 1][n - 1];
      dP[n][n] = k * (x * P[n - 1][n - 1] + s * dP[n - 1][n - 1]);
    }
    for (let m = 0; m < n; m++) {
      const den = Math.sqrt(n * n - m * m);
      const k2 = n >= 2 && m <= n - 2 ? Math.sqrt((n - 1) * (n - 1) - m * m) : 0;
      const p2 = k2 ? P[n - 2][m] : 0;
      const d2 = k2 ? dP[n - 2][m] : 0;
      P[n][m] = ((2 * n - 1) * x * P[n - 1][m] - k2 * p2) / den;
      dP[n][m] = ((2 * n - 1) * (x * dP[n - 1][m] - s * P[n - 1][m]) - k2 * d2) / den;
    }
  }

  let Xc = 0;
  let Yc = 0;
  let Zc = 0;
  const cosm = [];
  const sinm = [];
  for (let m = 0; m <= N_MAX; m++) {
    cosm.push(Math.cos(m * lam));
    sinm.push(Math.sin(m * lam));
  }
  let ratio = (RE / r) ** 2;
  for (let n = 1; n <= N_MAX; n++) {
    ratio *= RE / r; // (RE/r)^(n+2)
    for (let m = 0; m <= n; m++) {
      const i = (n * (n + 1)) / 2 + m;
      const g = G[i] + t * GDOT[i];
      const h = H[i] + t * HDOT[i];
      const gc = g * cosm[m] + h * sinm[m];
      const gs = g * sinm[m] - h * cosm[m];
      Xc += ratio * gc * dP[n][m];
      Yc += s > 1e-10 ? (ratio * m * gs * P[n][m]) / s : 0;
      Zc -= ratio * (n + 1) * gc * P[n][m];
    }
  }

  // Geocéntrico -> geodésico: un giro en el meridiano por φ' − φ.
  const psi = phic - phi;
  const X = Xc * Math.cos(psi) - Zc * Math.sin(psi);
  const Y = Yc;
  const Z = Xc * Math.sin(psi) + Zc * Math.cos(psi);
  const Hh = Math.hypot(X, Y);
  return {
    X,
    Y,
    Z,
    declination: Math.atan2(Y, X) * DEG,
    inclination: Math.atan2(Z, Hh) * DEG,
    valid: date.getTime() >= VALID_FROM && date.getTime() <= VALID_TO,
    model: WMM_NAME,
  };
}

/** Declinación en grados (Este positivo). */
export function magneticDeclination(lat, lon, altKm = 0, date = new Date()) {
  return geomagneticField(lat, lon, altKm, date).declination;
}

/** «3.2° E» / «12.5° W». */
export function formatDeclination(d) {
  if (!Number.isFinite(d)) return '—';
  const v = Math.round(Math.abs(d) * 10) / 10;
  return v === 0 ? '0.0°' : `${v.toFixed(1)}° ${d > 0 ? 'E' : 'W'}`;
}

/* ---------- preferencia y última posición conocida ---------- */

const TRUE_NORTH_KEY = 'fielddraw.trueNorth';
const POS_KEY = 'fielddraw.declinationPos';

function leer(key) {
  try {
    return globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function escribir(key, v) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(key, v);
  } catch {
    /* sin storage: vale para esta sesión */
  }
}

/**
 * Si las medidas de la brújula del teléfono se corrigen al norte verdadero.
 * Por omisión SÍ: es como se publica un mapa, y lo que hace StraboSpot cuando
 * se le da la declinación.
 */
let trueNorth = leer(TRUE_NORTH_KEY) !== '0';
export const getTrueNorth = () => trueNorth;
export function setTrueNorth(on) {
  trueNorth = !!on;
  escribir(TRUE_NORTH_KEY, trueNorth ? '1' : '0');
  return trueNorth;
}

/**
 * Última posición conocida, para saber qué declinación aplicar. La
 * declinación cambia décimas de grado cada decenas de km, así que una
 * posición de hace horas —o de la última salida— sirve igual; se guarda en
 * el dispositivo para tenerla aun antes del primer GPS del día.
 */
let lastPos = (() => {
  try {
    const p = JSON.parse(leer(POS_KEY));
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null;
  } catch {
    return null;
  }
})();

export function noteDeclinationPosition(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  // No reescribir el storage por cada lectura del GPS: solo si se movió algo.
  if (lastPos && Math.abs(lastPos.lat - lat) < 0.01 && Math.abs(lastPos.lon - lon) < 0.01) return;
  lastPos = { lat, lon };
  escribir(POS_KEY, JSON.stringify(lastPos));
}

/** Declinación en la última posición conocida, o `NaN` si nunca hubo una. */
export function declinationHere(date = new Date()) {
  return lastPos ? magneticDeclination(lastPos.lat, lastPos.lon, 0, date) : NaN;
}

/**
 * La corrección que hay que sumar a un acimut magnético AHORA: la
 * declinación si la preferencia está activa y hay posición, si no 0.
 */
export function activeDeclination() {
  if (!trueNorth) return 0;
  const d = declinationHere();
  return Number.isFinite(d) ? d : 0;
}
