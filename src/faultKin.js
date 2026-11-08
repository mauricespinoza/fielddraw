/**
 * Solución de plano de falla (fault-plane solution) a partir de datos de falla
 * con DATO COMPLETO: plano (rumbo/manteo RHR) + estría (trend/plunge) +
 * sentido de movimiento.
 *
 * Es un port directo del núcleo del plugin de QGIS «Fault-plane Solver»
 * (MesoFaultKin v1.7, del mismo autor que FieldDraw): `sense_to_slip.py`,
 * `kinematics.py`, `bingham.py`, `michael.py` y `classify_regime` de
 * `beachball.py`. Mismas convenciones, mismos umbrales, mismas fórmulas, para
 * que una estación analizada en terreno con FieldDraw y después en QGIS dé el
 * mismo régimen, la misma R y los mismos ejes.
 *
 * Todo en vectores ENU (Este, Norte, Arriba); ángulos en grados en la frontera
 * del módulo. Las direcciones que salen como trend/plunge se reportan siempre
 * en el hemisferio inferior.
 *
 * Referencias:
 * - Marrett, R., Allmendinger, R. W. (1990). Kinematic analysis of fault-slip
 *   data. J. Struct. Geol. 12(8), 973–986. (ejes P/T/B, tensor de momento,
 *   promedio de Bingham)
 * - Michael, A. J. (1984). Determination of stress from slip data: faults and
 *   folds. JGR 89(B13), 11517–11526. (inversión de esfuerzos)
 * - Zoback (1992); Heidbach et al. (2018) — clasificación de régimen WSM.
 * - Delvaux et al. (1997) — R'.
 *
 * Este módulo NO dibuja ni toca el DOM: lo que se puede probar sin navegador.
 */

import { norm360 } from './structure.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/* ---------- álgebra mínima ---------- */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function unit(a) {
  const l = len(a);
  return l < 1e-12 ? [0, 0, 0] : scale(a, 1 / l);
}
const clamp1 = (x) => Math.min(1, Math.max(-1, x));

/* ---------- geometría (geometry.py) ---------- */

/** Normal unitaria ASCENDENTE del plano (apunta al bloque colgante). */
export function normalVector(strike, dip) {
  const f = strike * RAD;
  const d = dip * RAD;
  return [Math.cos(f) * Math.sin(d), -Math.sin(f) * Math.sin(d), Math.cos(d)];
}

/** Vector horizontal según el rumbo (RHR). */
export function strikeVector(strike) {
  const f = strike * RAD;
  return [Math.sin(f), Math.cos(f), 0];
}

/** Vector de máxima pendiente dentro del plano, hacia abajo. */
export function downDipVector(strike, dip) {
  const f = strike * RAD;
  const d = dip * RAD;
  return [Math.cos(f) * Math.cos(d), -Math.sin(f) * Math.cos(d), -Math.sin(d)];
}

/** Vector unitario de una línea trend/plunge (plunge > 0 → hacia abajo). */
export function trendPlungeVector(trend, plunge) {
  const t = trend * RAD;
  const p = plunge * RAD;
  return [Math.cos(p) * Math.sin(t), Math.cos(p) * Math.cos(t), -Math.sin(p)];
}

/** Trend/plunge de un vector, forzado al hemisferio inferior. */
export function vectorTrendPlunge(v) {
  let w = unit(v);
  if (w[2] > 0) w = scale(w, -1);
  return {
    trend: norm360(Math.atan2(w[0], w[1]) * DEG),
    plunge: Math.asin(clamp1(-w[2])) * DEG,
  };
}

/** Ángulo sin signo entre dos vectores, en grados [0, 180]. */
export function angleBetween(a, b) {
  return Math.acos(clamp1(dot(unit(a), unit(b)))) * DEG;
}

/** Proyecta `v` sobre el plano de normal `n` y renormaliza. */
function projectOntoPlane(v, n) {
  const nn = unit(n);
  const p = sub(v, scale(nn, dot(v, nn)));
  const l = len(p);
  return l < 1e-12 ? p : scale(p, 1 / l);
}

/* ---------- sentido de movimiento (sense_to_slip.py) ---------- */

/**
 * Sentidos de FieldDraw (`FAULT_SENSES` en symbology.js) → letra del plugin.
 * `undetermined` no tiene letra: sin sentido no hay dato completo.
 */
export const SENSE_LETTER = {
  normal: 'N',
  inverse: 'T',
  'right-lateral': 'R',
  'left-lateral': 'L',
};

/** Signos exigidos a (a_dip, a_strike) por cada sentido. 0 = libre. */
const SIGN_RULES = {
  N: [+1, 0],
  T: [-1, 0],
  R: [0, -1],
  L: [0, +1],
  NR: [+1, -1],
  NL: [+1, +1],
  TR: [-1, -1],
  TL: [-1, +1],
  RN: [+1, -1],
  RT: [-1, -1],
  LN: [+1, +1],
  LT: [-1, +1],
};

export const PROJECTION_WARN_DEG = 5;
export const PROJECTION_HARD_DEG = 15;
const OBLIQUE_PITCH_FRACTION = 0.2;
const OBLIQUE_PITCH_TOL_DEG = 30;

/** Rake de Aki-Richards (−180, 180] desde las componentes del deslizamiento. */
function deriveRake(aDip, aStrike) {
  return Math.atan2(-aDip, aStrike) * DEG;
}

/** Código oblicuo, dominante primero (N, NR, RN, …). */
function senseOblique(aDip, aStrike) {
  const m = Math.hypot(aDip, aStrike);
  if (m < 1e-9) return '';
  const pd = aDip > 0 ? 'N' : 'T';
  const ps = aStrike < 0 ? 'R' : 'L';
  const thr = OBLIQUE_PITCH_FRACTION * m;
  if (Math.abs(aDip) < thr) return ps;
  if (Math.abs(aStrike) < thr) return pd;
  return Math.abs(aDip) >= Math.abs(aStrike) ? pd + ps : ps + pd;
}

function matchesRule(aDip, aStrike, [rd, rs], minMagnitude = 0.05) {
  const m = Math.hypot(aDip, aStrike);
  const thr = minMagnitude * Math.max(m, 1);
  if (rd > 0 && aDip <= thr) return false;
  if (rd < 0 && aDip >= -thr) return false;
  if (rs > 0 && aStrike <= thr) return false;
  if (rs < 0 && aStrike >= -thr) return false;
  return true;
}

/**
 * Vector de deslizamiento CON SIGNO del bloque colgante a partir del dato de
 * terreno. La estría es un eje; el sentido elige cuál de sus dos direcciones
 * es el movimiento del colgante. Siempre devuelve; `valid: false` y `errors`
 * dicen por qué un dato no sirve.
 */
export function resolveSlip(strike, dip, trend, plunge, sense) {
  const warnings = [];
  const errors = [];
  if (!(strike >= 0 && strike <= 360)) errors.push(`Strike ${strike} out of [0, 360]`);
  if (!(dip >= 0 && dip <= 90)) errors.push(`Dip ${dip} out of [0, 90]`);
  if (!(trend >= 0 && trend <= 360)) errors.push(`Trend ${trend} out of [0, 360]`);
  if (!(plunge >= 0 && plunge <= 90)) errors.push(`Plunge ${plunge} out of [0, 90]`);
  const s = String(sense || '').toUpperCase();
  if (!SIGN_RULES[s]) errors.push(`Unrecognised sense of slip ${JSON.stringify(sense)}`);

  const n = normalVector(strike, dip);
  const d = downDipVector(strike, dip);
  const sTr = strikeVector(strike);
  const sMeas = trendPlungeVector(trend, plunge);

  const sPlane = projectOntoPlane(sMeas, n);
  const deviation = angleBetween(sMeas, sPlane);
  if (deviation > PROJECTION_HARD_DEG) {
    errors.push(`Striae ${deviation.toFixed(1)}° off the fault plane (limit ${PROJECTION_HARD_DEG}°)`);
  } else if (deviation > PROJECTION_WARN_DEG) {
    warnings.push(`Striae ${deviation.toFixed(1)}° off the fault plane`);
  }

  let aDip = dot(sPlane, d);
  let aStrike = dot(sPlane, sTr);
  let sign = 1;
  if (SIGN_RULES[s]) {
    if (matchesRule(aDip, aStrike, SIGN_RULES[s])) sign = 1;
    else if (matchesRule(-aDip, -aStrike, SIGN_RULES[s])) sign = -1;
    else {
      errors.push(
        `Sense ${s} does not fit the striae (dip component ${aDip.toFixed(2)}, strike component ${aStrike.toFixed(2)})`,
      );
    }
  }
  const slip = scale(sPlane, sign);
  aDip *= sign;
  aStrike *= sign;

  const computed = senseOblique(aDip, aStrike);
  if (s.length === 1 && computed.length === 2) {
    const pitch = Math.atan2(Math.abs(aDip), Math.abs(aStrike)) * DEG;
    const oblicuidad = s === 'N' || s === 'T' ? 90 - pitch : pitch;
    if (oblicuidad > OBLIQUE_PITCH_TOL_DEG) {
      warnings.push(`Reported ${s} but the striae are clearly oblique (${computed})`);
    }
  }

  return {
    slip,
    normal: n,
    sense: s,
    senseComputed: computed,
    rake: s ? deriveRake(aDip, aStrike) : NaN,
    deviation,
    aDip,
    aStrike,
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/* ---------- cinemática de una falla (kinematics.py) ---------- */

/** Tensor de momento unitario ½(n sᵀ + s nᵀ), como matriz 3×3. */
export function momentTensor(n, s) {
  const M = [];
  for (let i = 0; i < 3; i++) {
    M.push([0, 1, 2].map((j) => 0.5 * (n[i] * s[j] + s[i] * n[j])));
  }
  return M;
}

/**
 * Ejes P, T, B y tensor de momento de un dato de falla. `P = (n−s)/|n−s|`,
 * `T = (n+s)/|n+s|`, `B = n×s`.
 */
export function faultKinematics(strike, dip, trend, plunge, sense) {
  const res = resolveSlip(strike, dip, trend, plunge, sense);
  const n = res.normal;
  const s = res.slip;
  const P = unit(sub(n, s));
  const T = unit(add(n, s));
  const B = unit(cross(n, s));
  return {
    ...res,
    strike,
    dip,
    trend,
    plunge,
    P,
    T,
    B,
    Ptp: vectorTrendPlunge(P),
    Ttp: vectorTrendPlunge(T),
    Btp: vectorTrendPlunge(B),
    slipTp: vectorTrendPlunge(s),
    moment: momentTensor(n, s),
  };
}

/* ---------- autovalores de una simétrica 3×3 (Jacobi) ---------- */

/**
 * Autovalores en orden DECRECIENTE y sus autovectores unitarios (columnas
 * alineadas), por el método de Jacobi cíclico: para 3×3 converge en un puñado
 * de barridos y, al revés que la fórmula cerrada, no pierde los vectores
 * cuando dos autovalores casi coinciden.
 */
export function eigSym3(M) {
  const a = M.map((r) => r.slice());
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 60; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => unit([v[0][i], v[1][i], v[2][i]])),
  };
}

/* ---------- promedio de Bingham (bingham.py) ---------- */

/**
 * Doble par (double-couple) que mejor ajusta un tensor y su residuo CLVD.
 * Devuelve la fracción CLVD = |M − M_DC|_F / |M|_F en [0, 1].
 */
function clvdFraction(M) {
  const tr = (M[0][0] + M[1][1] + M[2][2]) / 3;
  const dev = M.map((r, i) => r.map((x, j) => x - (i === j ? tr : 0)));
  const { values } = eigSym3(dev);
  const [l1, l2, l3] = values;
  const ldc = (l1 - l3) / 2;
  const fro = Math.hypot(l1, l2, l3);
  if (fro < 1e-14) return NaN;
  return Math.hypot(l1 - ldc, l2, l3 + ldc) / fro;
}

/**
 * Ejes cinemáticos medios de una población: suma de tensores de momento y
 * diagonalización. λ₁ ≥ λ₂ ≥ λ₃ → T̄, B̄, P̄. `K = (λ₂−λ₃)/(λ₁−λ₃)`.
 */
export function binghamAnalysis(faults) {
  const valid = faults.filter((f) => f.valid);
  if (valid.length === 0) return null;
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const f of valid) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += f.moment[i][j] / valid.length;
  }
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const m = 0.5 * (M[i][j] + M[j][i]);
      M[i][j] = m;
      M[j][i] = m;
    }
  }
  const { values, vectors } = eigSym3(M);
  const [T, B, P] = vectors;
  const [l1, l2, l3] = values;
  const den = l1 - l3;
  return {
    n: valid.length,
    meanTensor: M,
    eigenvalues: values,
    P,
    T,
    B,
    Ptp: vectorTrendPlunge(P),
    Ttp: vectorTrendPlunge(T),
    Btp: vectorTrendPlunge(B),
    K: Math.abs(den) > 1e-12 ? (l2 - l3) / den : NaN,
    clvd: clvdFraction(M),
  };
}

/**
 * Terna ortonormal (P, T, B) para dibujar el doble par: conserva P, reproyecta
 * T ortogonal a P (Gram-Schmidt) y cierra con B = T×P.
 */
export function orthogonalizePT(Pin, Tin) {
  const P = unit(Pin);
  let T = sub(Tin, scale(P, dot(Tin, P)));
  if (len(T) < 1e-12) {
    let ref = [1, 0, 0];
    if (Math.abs(dot(ref, P)) > 0.95) ref = [0, 1, 0];
    T = sub(ref, scale(P, dot(ref, P)));
  }
  T = unit(T);
  const B = unit(cross(T, P));
  return { P, T, B };
}

/* ---------- inversión de esfuerzos de Michael (michael.py) ---------- */

/** Bloque 3×5 de una falla de normal `n`; parámetros [σ11, σ12, σ13, σ22, σ23]. */
function aBlock([n1, n2, n3]) {
  return [
    [n1 * (1 - n1 * n1 + n3 * n3), n2 * (1 - 2 * n1 * n1), n3 * (1 - 2 * n1 * n1), -n1 * (n2 * n2 - n3 * n3), -2 * n1 * n2 * n3],
    [-n2 * (n1 * n1 - n3 * n3), n1 * (1 - 2 * n2 * n2), -2 * n1 * n2 * n3, n2 * (1 - n2 * n2 + n3 * n3), n3 * (1 - 2 * n2 * n2)],
    [-n3 * (1 + n1 * n1 - n3 * n3), -2 * n1 * n2 * n3, n1 * (1 - 2 * n3 * n3), -n3 * (1 + n2 * n2 - n3 * n3), n2 * (1 - 2 * n3 * n3)],
  ];
}

/** Resuelve un sistema lineal pequeño por eliminación con pivoteo parcial. */
function solveLinear(A, b) {
  const n = b.length;
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-14) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

/** Dirección de cizalle τ̂ que el tensor predice sobre el plano de normal n. */
function predictedShear(sigma, n) {
  const sn = [0, 1, 2].map((i) => dot(sigma[i], n));
  const tau = sub(sn, scale(n, dot(n, sn)));
  return len(tau) < 1e-12 ? null : unit(tau);
}

/** Mínimo de fallas para la inversión de Michael (5 incógnitas, 3 ecuaciones por falla). */
export const MICHAEL_MIN_FAULTS = 4;

/**
 * Inversión lineal de Michael (1984). Hipótesis de Wallace-Bott: la estría es
 * paralela al cizalle resuelto de un tensor uniforme.
 *
 * Salida en convención GEOLÓGICA (compresión positiva): σ1 = eje más
 * compresivo, σ3 = el más extensional. `R = (σ2−σ3)/(σ1−σ3)` ∈ [0, 1].
 * `misfits` es el ángulo β por falla (en el mismo orden que `faults`
 * válidas).
 *
 * @returns {null|object} null con menos de 4 fallas válidas o un sistema
 *   singular.
 */
export function michaelInversion(faults) {
  const valid = faults.filter((f) => f.valid);
  if (valid.length < MICHAEL_MIN_FAULTS) return null;
  // Ecuaciones normales (AᵀA) t = Aᵀ s: 5×5, de sobra estable para esto.
  const AtA = Array.from({ length: 5 }, () => new Array(5).fill(0));
  const Ats = new Array(5).fill(0);
  for (const f of valid) {
    const n = unit(f.normal);
    const s = unit(f.slip);
    const A = aBlock(n);
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 5; i++) {
        Ats[i] += A[r][i] * s[r];
        for (let j = 0; j < 5; j++) AtA[i][j] += A[r][i] * A[r][j];
      }
    }
  }
  const t = solveLinear(AtA, Ats);
  if (!t) return null;
  const [s11, s12, s13, s22, s23] = t;
  const sigma = [
    [s11, s12, s13],
    [s12, s22, s23],
    [s13, s23, -s11 - s22],
  ];
  const { values, vectors } = eigSym3(sigma);
  // Etiquetas geológicas: el autovalor más chico (tensión positiva) es σ1.
  const sigma1 = vectors[2];
  const sigma2 = vectors[1];
  const sigma3 = vectors[0];
  const misfits = valid.map((f) => {
    const p = predictedShear(sigma, unit(f.normal));
    return p ? angleBetween(f.slip, p) : NaN;
  });
  const ok = misfits.filter(Number.isFinite);
  const den = values[0] - values[2];
  return {
    n: valid.length,
    tensor: sigma,
    sigma1,
    sigma2,
    sigma3,
    s1: vectorTrendPlunge(sigma1),
    s2: vectorTrendPlunge(sigma2),
    s3: vectorTrendPlunge(sigma3),
    R: Math.abs(den) > 1e-12 ? (values[0] - values[1]) / den : NaN,
    misfits,
    meanMisfit: ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN,
    maxMisfit: ok.length ? Math.max(...ok) : NaN,
    rmsMisfit: ok.length ? Math.sqrt(ok.reduce((a, b) => a + b * b, 0) / ok.length) : NaN,
  };
}

/* ---------- régimen (beachball.py) ---------- */

/**
 * Régimen tectónico según los plunges de σ1/σ2/σ3 (compresión positiva),
 * umbrales del World Stress Map: normal, thrust, strike-slip u oblique.
 */
export function classifyRegime(p1, p2, p3) {
  if (p1 >= 52 && p3 <= 35) return 'normal';
  if (p1 <= 35 && p3 >= 52) return 'thrust';
  if (p2 >= 52) return 'strike-slip';
  return 'oblique';
}

/** R' de Delvaux et al. (1997): R, 2−R, 2+R según el régimen. */
export function delvauxRPrime(R, regime) {
  if (!Number.isFinite(R)) return NaN;
  if (regime === 'normal') return R;
  if (regime === 'strike-slip') return 2 - R;
  if (regime === 'thrust') return 2 + R;
  return NaN;
}

/** Colores por régimen del plugin (cuadrantes extensionales). */
export const REGIME_STYLE = {
  normal: { label: 'Normal', color: '#3B82C4' },
  thrust: { label: 'Thrust', color: '#C0392B' },
  'strike-slip': { label: 'Strike-slip', color: '#2E8B57' },
  oblique: { label: 'Oblique', color: '#7F8C8D' },
};

/* ---------- de las medidas de FieldDraw a la solución ---------- */

/**
 * ¿Tiene esta medida el dato completo de falla? Plano de falla, estría con
 * trend/plunge numéricos y un sentido que no sea «undetermined».
 */
export function isCompleteFaultDatum(p) {
  return (
    p.geomKind === 'measurement' &&
    p.type === 'fault-plane' &&
    Number.isFinite(p.strike) &&
    Number.isFinite(p.dip) &&
    Number.isFinite(p.lineTrend) &&
    Number.isFinite(p.linePlunge) &&
    Boolean(SENSE_LETTER[p.faultSense])
  );
}

/**
 * Qué fallas entran: las de dato completo en la selección del mapa si hay
 * alguna, o todas las del dibujo — la misma regla que la pestaña Plot.
 *
 * @returns {{faults, usingSelection, total, incomplete}} `incomplete` cuenta
 *   los planos de falla que quedaron fuera por no tener estría o sentido.
 */
export function faultSlipData(features, selectionIds) {
  const fallas = features.filter(
    (f) => f.properties.geomKind === 'measurement' && f.properties.type === 'fault-plane',
  );
  const ids = new Set(selectionIds);
  const elegidas = fallas.filter((f) => ids.has(f.properties.id));
  const fuente = elegidas.length > 0 ? elegidas : fallas;
  const completas = fuente.filter((f) => isCompleteFaultDatum(f.properties));
  const faults = completas.map((f) => {
    const p = f.properties;
    const k = faultKinematics(norm360(p.strike), p.dip, norm360(p.lineTrend), p.linePlunge, SENSE_LETTER[p.faultSense]);
    return { id: p.id, faultSense: p.faultSense, note: p.note || '', unit: p.unit || '', ...k };
  });
  return {
    faults,
    usingSelection: elegidas.length > 0,
    total: fallas.filter((f) => isCompleteFaultDatum(f.properties)).length,
    incomplete: fuente.length - completas.length,
  };
}

/**
 * La solución completa de las fallas ENCENDIDAS: Bingham, Michael, régimen.
 *
 * El régimen sale de la inversión de esfuerzos cuando la hay (≥ 4 fallas);
 * con menos, de los ejes cinemáticos medios tomando P̄ ≈ σ1, B̄ ≈ σ2,
 * T̄ ≈ σ3 — la misma tabla WSM, marcada como cinemática.
 *
 * @param {Array} faults salida de `faultSlipData().faults`
 * @param {Set<string>} disabled ids apagados con la casilla
 */
export function faultPlaneSolution(faults, disabled = new Set()) {
  const on = faults.filter((f) => f.valid && !disabled.has(f.id));
  const bingham = binghamAnalysis(on);
  const stress = michaelInversion(on);
  let regime = 'oblique';
  let regimeSource = null;
  if (stress) {
    regime = classifyRegime(stress.s1.plunge, stress.s2.plunge, stress.s3.plunge);
    regimeSource = 'stress';
  } else if (bingham) {
    regime = classifyRegime(bingham.Ptp.plunge, bingham.Btp.plunge, bingham.Ttp.plunge);
    regimeSource = 'kinematic';
  }
  const misfitById = new Map();
  if (stress) on.forEach((f, i) => misfitById.set(f.id, stress.misfits[i]));
  return {
    on,
    nOn: on.length,
    nInvalid: faults.filter((f) => !f.valid).length,
    bingham,
    stress,
    regime,
    regimeSource,
    RPrime: stress ? delvauxRPrime(stress.R, regime) : NaN,
    misfitById,
  };
}

/**
 * Patrón de radiación sobre la red: +1 extensional, −1 compresional. Con
 * `tensor` es el patrón riguroso n·M·n (asimétrico si hay CLVD); sin él, el
 * doble par puro (n·T)² − (n·P)².
 */
export function radiationSign(n, { P, T, tensor = null }) {
  if (tensor) {
    const Mn = [0, 1, 2].map((i) => dot(tensor[i], n));
    return dot(n, Mn) > 0 ? 1 : -1;
  }
  return dot(n, T) ** 2 - dot(n, P) ** 2 > 0 ? 1 : -1;
}

/** Inversa de la proyección equiareal (radio 1, y hacia abajo = sur). */
export function schmidtInverse(x, y) {
  const r = Math.hypot(x, y);
  if (r > 1 + 1e-9) return null;
  const theta = 2 * Math.asin(Math.min(1, r / Math.SQRT2));
  const plunge = 90 - theta * DEG;
  const trend = r < 1e-12 ? 0 : norm360(Math.atan2(x, -y) * DEG);
  return trendPlungeVector(trend, plunge);
}
