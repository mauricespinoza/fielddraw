import { DEM_VERTICAL_SIGMA_M } from './dem.js';

/**
 * Rumbo y manteo a partir de puntos con cota.
 *
 * Dos formas del mismo problema:
 *
 * - **Tres puntos**: el problema clásico. Tres cotas definen un plano exacto.
 * - **N nodos**: ajuste por mínimos cuadrados sobre una línea digitalizada a lo
 *   largo de una traza. Es la generalización natural y bastante más robusta,
 *   porque el error de una cota se reparte entre muchas.
 *
 * La matemática es trivial; lo que NO lo es —y es la razón de que este módulo
 * sea más largo de lo que parece necesario— es decir cuánto vale el número.
 *
 * Sobre un DEM de 30 m con varios metros de error vertical, un manteo medido
 * en una base de 100 m puede equivocarse en varios grados; en una base de 30 m,
 * en decenas. Entregar "32°" sin más sería falsa precisión. Por eso cada
 * resultado viaja con su incertidumbre, propagada por Monte Carlo desde el
 * error del modelo, y con la geometría de la base que lo produjo: si los
 * puntos están casi alineados el plano queda indeterminado en torno a ese eje,
 * y eso hay que decirlo, no esconderlo.
 *
 * Convención: rumbo por la **regla de la mano derecha** — el manteo cae 90° en
 * sentido horario desde el rumbo. Es la que usan StraboSpot y QGIS, así que un
 * dato exportado se dibuja rotado igual en las tres.
 */

/** Métodos disponibles, en el orden en que se ofrecen. */
export const MEASURE_METHODS = [
  {
    id: 'manual',
    label: 'Manual',
    short: 'Man',
    glyph: '✎',
    help: 'Place the point and type the strike and dip you measured with the compass',
  },
  {
    id: 'three-point',
    label: 'Three points',
    short: '3 pts',
    glyph: '△',
    help: 'Tap three points on the same surface; the DEM supplies the elevations',
  },
  {
    id: 'plane-fit',
    label: 'Trace fit',
    short: 'Fit',
    glyph: '∿',
    help: 'Draw along the outcrop trace; the plane is least-squares fitted to every node',
  },
];

export const METHOD_BY_ID = new Map(MEASURE_METHODS.map((m) => [m.id, m]));

/** Métodos que leen la cota del modelo de elevación y no de una brújula. */
export const DEM_METHODS = new Set(['three-point', 'plane-fit']);

/** Metros por grado, suficiente para un ajuste local de pocos kilómetros. */
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320;

/**
 * Pasa a coordenadas locales en metros (Este, Norte, Arriba) respecto del
 * centroide. Una proyección equirectangular local basta: sobre unos pocos
 * kilómetros el error es del orden del 0,1 %, tres órdenes de magnitud por
 * debajo del error vertical del DEM, que es lo que de verdad manda aquí.
 */
export function toLocalENU(points) {
  const validos = points.filter(
    (p) => Number.isFinite(p.lngLat[0]) && Number.isFinite(p.lngLat[1]) && Number.isFinite(p.elevation),
  );
  if (validos.length === 0) return { origin: null, enu: [] };

  const lng0 = validos.reduce((s, p) => s + p.lngLat[0], 0) / validos.length;
  const lat0 = validos.reduce((s, p) => s + p.lngLat[1], 0) / validos.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);

  return {
    origin: [lng0, lat0],
    enu: validos.map((p) => ({
      x: (p.lngLat[0] - lng0) * M_PER_DEG_LNG * cos,
      y: (p.lngLat[1] - lat0) * M_PER_DEG_LAT,
      z: p.elevation,
    })),
  };
}

const norm360 = (deg) => ((deg % 360) + 360) % 360;

/**
 * Rumbo y manteo a partir del gradiente del plano `z = a·x + b·y + c`.
 *
 * `(a, b)` es la dirección de máxima PENDIENTE ascendente en el plano del mapa,
 * así que el manteo cae hacia `(-a, -b)`. El acimut se mide en horario desde
 * el norte, o sea `atan2(Este, Norte)`.
 */
export function strikeDipFromGradient(a, b) {
  const pendiente = Math.hypot(a, b);
  const dip = (Math.atan(pendiente) * 180) / Math.PI;
  // Un plano horizontal no tiene dirección de manteo; se declara 0 por
  // convenio, y el símbolo que le corresponde tampoco se rota.
  const dipAzimuth = pendiente === 0 ? 0 : norm360((Math.atan2(-a, -b) * 180) / Math.PI);
  return { strike: norm360(dipAzimuth - 90), dip, dipAzimuth };
}

/**
 * Ajusta `z = a·x + b·y + c` por mínimos cuadrados sobre puntos ya en metros.
 *
 * Se centran primero en el centroide, lo que reduce el sistema a un 2×2 y
 * evita el mal condicionamiento de resolver directamente el 3×3 con
 * coordenadas grandes.
 *
 * @returns {{a, b, c, rms, residuals, eigMax, eigMin}|null} null si los puntos
 *   están alineados y el plano queda indeterminado.
 */
export function solvePlane(enu) {
  const n = enu.length;
  if (n < 3) return null;

  const mx = enu.reduce((s, p) => s + p.x, 0) / n;
  const my = enu.reduce((s, p) => s + p.y, 0) / n;
  const mz = enu.reduce((s, p) => s + p.z, 0) / n;

  let Sxx = 0;
  let Sxy = 0;
  let Syy = 0;
  let Sxz = 0;
  let Syz = 0;
  for (const p of enu) {
    const dx = p.x - mx;
    const dy = p.y - my;
    const dz = p.z - mz;
    Sxx += dx * dx;
    Sxy += dx * dy;
    Syy += dy * dy;
    Sxz += dx * dz;
    Syz += dy * dz;
  }

  const det = Sxx * Syy - Sxy * Sxy;
  // Autovalores de la matriz de dispersión horizontal. El menor mide cuánto se
  // separan los puntos de una recta: si es ~0, el plano puede girar libremente
  // en torno a ella y no hay manteo que valga.
  const traza = Sxx + Syy;
  const disc = Math.sqrt(Math.max(0, (Sxx - Syy) ** 2 + 4 * Sxy * Sxy));
  const eigMax = (traza + disc) / 2;
  const eigMin = (traza - disc) / 2;

  // El umbral es relativo, no absoluto: lo que importa es la forma de la nube,
  // no su tamaño.
  if (!(eigMax > 0) || det <= 0 || eigMin / eigMax < 1e-9) return null;

  const a = (Syy * Sxz - Sxy * Syz) / det;
  const b = (Sxx * Syz - Sxy * Sxz) / det;
  const c = mz - a * mx - b * my;

  const residuals = enu.map((p) => p.z - (a * p.x + b * p.y + c));
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);

  return { a, b, c, rms, residuals, eigMax, eigMin, centroid: { x: mx, y: my, z: mz } };
}

/**
 * Generador pseudoaleatorio determinista.
 *
 * El Monte Carlo tiene que dar SIEMPRE el mismo margen de error para los
 * mismos puntos: si volver a calcular la misma medida cambiara la
 * incertidumbre, el número dejaría de ser comprobable y nadie podría citarlo.
 */
function makeRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32: barato, sin dependencias y de calidad de sobra para esto.
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Semilla derivada de los propios datos, para que sea reproducible. */
function seedFrom(enu) {
  let h = 2166136261;
  for (const p of enu) {
    for (const v of [p.x, p.y, p.z]) {
      h ^= Math.round(v * 1000) | 0;
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/** Par de normales estándar por Box-Muller. */
function gaussPair(rnd) {
  const u = Math.max(1e-12, rnd());
  const v = rnd();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

/**
 * Desviación estándar circular, en grados. El rumbo es un ángulo: promediar
 * 359° y 1° como números daría 180°, que es exactamente el rumbo contrario.
 */
export function circularStdDeg(angulos) {
  if (angulos.length === 0) return NaN;
  let sx = 0;
  let sy = 0;
  for (const a of angulos) {
    const r = (a * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const R = Math.hypot(sx, sy) / angulos.length;
  if (R >= 1) return 0;
  return (Math.sqrt(-2 * Math.log(R)) * 180) / Math.PI;
}

/** Media aritmética y desviación estándar de una muestra. */
function meanSd(valores) {
  const n = valores.length;
  if (n === 0) return { mean: NaN, sd: NaN };
  const mean = valores.reduce((s, v) => s + v, 0) / n;
  const varianza = valores.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1);
  return { mean, sd: Math.sqrt(varianza) };
}

/**
 * Propaga el error vertical del DEM al rumbo y al manteo.
 *
 * Se hace por Monte Carlo y no por derivadas analíticas por una razón
 * concreta: el manteo es `atan(|∇z|)`, y cerca de la horizontal esa función
 * deja de ser lineal — la linealización daría una barra de error demasiado
 * optimista justo donde el problema es peor, en las capas de bajo ángulo.
 */
export function propagateUncertainty(enu, { sigmaZ = DEM_VERTICAL_SIGMA_M, trials = 240 } = {}) {
  const rnd = makeRandom(seedFrom(enu));
  const rumbos = [];
  const manteos = [];

  for (let t = 0; t < trials; t++) {
    const perturbado = [];
    for (let i = 0; i < enu.length; i += 2) {
      const [g1, g2] = gaussPair(rnd);
      perturbado.push({ ...enu[i], z: enu[i].z + g1 * sigmaZ });
      if (i + 1 < enu.length) perturbado.push({ ...enu[i + 1], z: enu[i + 1].z + g2 * sigmaZ });
    }
    const plano = solvePlane(perturbado);
    if (!plano) continue;
    const sd = strikeDipFromGradient(plano.a, plano.b);
    rumbos.push(sd.strike);
    manteos.push(sd.dip);
  }

  if (manteos.length < 2) return { strikeSd: NaN, dipSd: NaN, trials: manteos.length };
  return {
    strikeSd: circularStdDeg(rumbos),
    dipSd: meanSd(manteos).sd,
    trials: manteos.length,
  };
}

/** Extensión mayor y menor de la nube de puntos en planta, en metros. */
function extents(plano, n) {
  // Los autovalores son sumas de cuadrados; la desviación por eje es su raíz
  // dividida por n, y la extensión útil ronda el doble de esa desviación.
  return {
    baseline: 2 * Math.sqrt(plano.eigMax / n),
    minorSpread: 2 * Math.sqrt(plano.eigMin / n),
  };
}

/**
 * Motivos por los que un resultado no es de fiar, en orden de gravedad.
 * Devuelve textos ya listos para mostrar: la interfaz no debería tener que
 * saber cuándo un manteo es basura.
 */
export function qualityWarnings({ baseline, minorSpread, dipSd, dip, resolution, rms }) {
  const avisos = [];
  const celda = Number.isFinite(resolution) ? resolution : 30;

  if (baseline < 2 * celda) {
    avisos.push(
      `The base is ${Math.round(baseline)} m across, under two DEM cells (~${Math.round(celda)} m each): the result is mostly model noise.`,
    );
  }
  if (minorSpread < celda) {
    avisos.push(
      `The points are nearly collinear (${Math.round(minorSpread)} m of spread across the trend), so the plane can pivot about that line and the dip is poorly constrained.`,
    );
  }
  if (Number.isFinite(dipSd) && dipSd > 10) {
    avisos.push(`Dip uncertainty is ±${Math.round(dipSd)}°, too wide to map with.`);
  }
  if (Number.isFinite(dip) && Number.isFinite(dipSd) && dip < dipSd) {
    avisos.push('The dip is smaller than its own uncertainty: it cannot be told apart from horizontal.');
  }
  if (Number.isFinite(rms) && rms > 3 * DEM_VERTICAL_SIGMA_M) {
    avisos.push(
      `Residuals of ${Math.round(rms)} m: the points do not lie on one plane — the surface is probably folded, faulted, or the trace strayed off the contact.`,
    );
  }
  return avisos;
}

/**
 * Resuelve rumbo y manteo a partir de puntos muestreados sobre el DEM.
 *
 * @param {Array<{lngLat: [number, number], elevation: number}>} points
 * @param {{sigmaZ?: number, resolution?: number, trials?: number}} opts
 * @returns {{ok: boolean, reason?: string, ...}}
 */
export function planeFromPoints(points, opts = {}) {
  const { enu, origin } = toLocalENU(points);
  if (enu.length < 3) {
    return {
      ok: false,
      reason:
        enu.length === points.length
          ? 'Three points with an elevation are needed to define a plane.'
          : 'Some points had no elevation in the DEM, and fewer than three are left.',
    };
  }

  const plano = solvePlane(enu);
  if (!plano) {
    return {
      ok: false,
      reason: 'The points lie on a straight line in plan view, so they define no single plane. Spread them across the outcrop.',
    };
  }

  const { strike, dip, dipAzimuth } = strikeDipFromGradient(plano.a, plano.b);
  const { baseline, minorSpread } = extents(plano, enu.length);
  const { strikeSd, dipSd } = propagateUncertainty(enu, opts);

  const relief = Math.max(...enu.map((p) => p.z)) - Math.min(...enu.map((p) => p.z));

  return {
    ok: true,
    // Punto de aplicación: el centroide, que es donde el ajuste es más firme.
    lngLat: [
      origin[0] + plano.centroid.x / (M_PER_DEG_LNG * Math.cos((origin[1] * Math.PI) / 180)),
      origin[1] + plano.centroid.y / M_PER_DEG_LAT,
    ],
    strike,
    dip,
    dipAzimuth,
    strikeSd,
    dipSd,
    rms: plano.rms,
    n: enu.length,
    baseline,
    minorSpread,
    relief,
    dropped: points.length - enu.length,
    warnings: qualityWarnings({
      baseline,
      minorSpread,
      dipSd,
      dip,
      rms: plano.rms,
      resolution: opts.resolution,
    }),
  };
}

/** Rumbo/manteo formateados como se escriben en una libreta: `045/32`. */
export function formatStrikeDip(strike, dip) {
  if (!Number.isFinite(strike) || !Number.isFinite(dip)) return '—';
  return `${String(Math.round(norm360(strike))).padStart(3, '0')}/${Math.round(dip)}`;
}

/** Cuadrante del acimut de manteo, que es como se dicta en terreno. */
export function quadrant(azimuth) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  if (!Number.isFinite(azimuth)) return '';
  return dirs[Math.round(norm360(azimuth) / 22.5) % 16];
}

export { norm360 };
