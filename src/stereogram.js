/**
 * Red estereográfica: proyección equiareal (Schmidt), hemisferio inferior.
 *
 * Se plotea el POLO de cada plano y no el círculo máximo: con más de un
 * puñado de medidas un ciclograma por dato se convierte en una maraña
 * ilegible, mientras que los polos se agrupan solos donde el afloramiento
 * tiene una fábrica — que es justo lo que esta pestaña tiene que enseñar de
 * un vistazo.
 *
 * Convención: rumbo/manteo entran por la regla de la mano derecha, la misma
 * que usa todo el resto de la app (`structure.js`). El polo de un plano con
 * esa convención es un vector unitario que:
 *
 * - Mantea 90°−manteo respecto de la vertical (manteo 0 → polo vertical;
 *   manteo 90 → polo horizontal).
 * - Su proyección horizontal apunta en la MISMA dirección que el manteo, no
 *   en la contraria: es la misma normal ascendente que ya usa
 *   `strikeDipFromGradient` — ahí la normal de `z = a·x + b·y + c` es
 *   proporcional a `(−a, −b, 1)`, y `(−a, −b)` es EXACTAMENTE la dirección de
 *   manteo que esa función calcula. No son dos convenciones que haya que
 *   hacer calzar; es la misma cuenta mirada al revés.
 */

import { STRUCTURE_TYPE_BY_ID } from './symbology.js';
import { norm360 } from './structure.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Polo de un plano rumbo/manteo, como {trend, plunge} en grados.
 *
 * `trend` es hacia dónde apunta el polo en planta (acimut), `plunge` cuánto
 * se hunde bajo el horizonte. Ver la nota de convención más arriba.
 */
export function poleOf(strike, dip) {
  const dipAzimuth = norm360(strike + 90);
  return { trend: norm360(dipAzimuth + 180), plunge: 90 - dip };
}

/**
 * El inverso de `poleOf`: rumbo y manteo del plano cuyo polo apunta a
 * `{trend, plunge}`. Deshace exactamente la misma cuenta —`trend =
 * dipAzimuth + 180`, `plunge = 90 − dip`— así que sirve para leer de vuelta
 * cualquier polo que no venga ya de un `strike/dip` conocido, como el vector
 * medio de `meanPole`.
 */
export function strikeDipFromPole(trend, plunge) {
  const dip = 90 - plunge;
  const dipAzimuth = norm360(trend - 180);
  return { strike: norm360(dipAzimuth - 90), dip, dipAzimuth };
}

/**
 * Punto {x, y} de una dirección {trend, plunge} en la red equiareal de
 * Schmidt, relativo al centro y en unidades del radio `R`.
 *
 * `theta` es la distancia angular al centro de la proyección —que representa
 * la vertical hacia abajo—, y `r = R·√2·sin(theta/2)` es la fórmula estándar
 * de Lambert que conserva el ÁREA, no el ángulo: es la que se usa para leer
 * densidades de puntos, que es para lo que sirve este gráfico.
 */
export function schmidtPoint(trend, plunge, R = 1) {
  const theta = (90 - plunge) * RAD;
  const r = R * Math.SQRT2 * Math.sin(theta / 2);
  const t = trend * RAD;
  return { x: r * Math.sin(t), y: -r * Math.cos(t) };
}

/**
 * Un punto ploteable: su posición YA proyectada (radio unitario, la vista la
 * escala a su gusto), el polo del que sale, color por tipo, y de qué medida
 * viene.
 */
export function stereogramPoint(feature) {
  const p = feature.properties;
  const pole = poleOf(p.strike, p.dip);
  const xy = schmidtPoint(pole.trend, pole.plunge, 1);
  const tipo = STRUCTURE_TYPE_BY_ID.get(p.type);
  return {
    id: p.id,
    type: p.type,
    typeLabel: tipo ? tipo.label : p.type || 'measurement',
    color: tipo ? tipo.color : '#9aa4b2',
    strike: p.strike,
    dip: p.dip,
    ...pole,
    ...xy,
  };
}

/**
 * Qué medidas entran al gráfico: la selección actual si hay alguna medida en
 * ella, o todas las medidas del dibujo si no. Es la misma regla que ya usa el
 * corte estructural para decidir qué manteos proyectar (`sectionPanel.js`):
 * con selección se respeta lo elegido, sin ella hay que ofrecer algo y lo que
 * tiene sentido es todo.
 */
export function stereogramData(features, selectionIds) {
  const medidas = features.filter((f) => f.properties.geomKind === 'measurement');
  const ids = new Set(selectionIds);
  const elegidas = medidas.filter((f) => ids.has(f.properties.id));
  const fuente = elegidas.length > 0 ? elegidas : medidas;
  return {
    points: fuente.map(stereogramPoint),
    usingSelection: elegidas.length > 0,
    total: medidas.length,
  };
}

/** Recuento por tipo, para la leyenda — en el mismo orden que el catálogo. */
export function countsByType(points) {
  const out = new Map();
  for (const p of points) out.set(p.type, (out.get(p.type) || 0) + 1);
  return out;
}

/**
 * Vector medio de un cúmulo de polos, como punto ploteable más su rumbo y
 * manteo en la convención de siempre.
 *
 * Un polo es una dirección, no un eje: al revés que un rumbo de brújula —que
 * es la misma línea mirada de los dos lados—, `poleOf` entrega SIEMPRE la
 * misma mitad de la esfera (`plunge` cae en [0°, 90°] porque `dip` cae en
 * [0°, 90°]), así que promediar los vectores unitarios sin más, sin ninguna
 * corrección de signo, ya da la dirección media que corresponde.
 *
 * `r`, el largo del vector resultante dividido por el número de polos, es la
 * misma cifra que usa la estadística de Fisher para decir qué tan apretado
 * está el cúmulo: 1 es todos los polos exactamente juntos, cerca de 0 es
 * dispersos en cualquier dirección. Viaja con el resultado por la misma razón
 * que el resto de la app nunca da un número sin decir cuánto pesa: un rumbo y
 * manteo medios de un cúmulo disperso son un promedio, no una medida.
 */
export function meanPole(points) {
  if (points.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of points) {
    const v = lineVector(p.trend, p.plunge);
    sx += v.x;
    sy += v.y;
    sz += v.z;
  }
  const largo = Math.hypot(sx, sy, sz);
  // Polos repartidos en todas direcciones —o exactamente opuestos entre
  // sí—: el vector medio se cancela y no hay ninguna dirección que reportar.
  if (largo < 1e-9) return null;

  const plunge = Math.asin(Math.min(1, Math.max(-1, -sz / largo))) * DEG;
  const trend = norm360(Math.atan2(sx / largo, sy / largo) * DEG);
  const { strike, dip, dipAzimuth } = strikeDipFromPole(trend, plunge);
  const xy = schmidtPoint(trend, plunge, 1);
  const n = points.length;
  const { k, alpha95 } = fisherConfidence(n, largo);

  return { trend, plunge, strike, dip, dipAzimuth, r: largo / n, n, k, alpha95, ...xy };
}

/**
 * Parámetro de concentración de Fisher (`k`) y semiángulo del cono de 95% de
 * confianza (`alpha95`) alrededor de la dirección media verdadera, a partir
 * de cuántos polos entraron (`n`) y el largo de su vector resultante SIN
 * normalizar (`resultante`, entre 0 y `n`).
 *
 * Es la fórmula de Fisher (1953) que trae cualquier libro de estadística
 * direccional (p.ej. Davis, *Statistics and Data Analysis in Geology*), la
 * misma que usan Stereonet/OSXStereonet para dibujar el óvalo alrededor del
 * vector medio: con menos de 3 polos no hay de dónde sacar una dispersión, y
 * con el cúmulo en la máxima concentración posible (`resultante` ≈ `n`, los
 * polos prácticamente idénticos) el cono se cierra a 0° en vez de dividir por
 * cero.
 */
function fisherConfidence(n, resultante) {
  if (n < 3) return { k: NaN, alpha95: NaN };
  const dispersión = n - resultante;
  if (dispersión < 1e-9) return { k: Infinity, alpha95: 0 };
  const k = (n - 1) / dispersión;
  const término = (1 / 0.05) ** (1 / (n - 1)) - 1;
  const cosAlpha = 1 - (dispersión / resultante) * término;
  const alpha95 = Math.acos(Math.min(1, Math.max(-1, cosAlpha))) * DEG;
  return { k, alpha95 };
}

/**
 * Eje beta (eje de pliegue) de un conjunto de polos, por el MÉTODO DE LOS
 * AUTOVALORES.
 *
 * Los polos de un pliegue cilíndrico —uno con un eje recto, aunque las capas
 * se curven a su alrededor— caen todos sobre un mismo círculo máximo (el
 * "cinturón" o girdle): cada polo es perpendicular a su plano, y todo plano
 * que contiene al eje del pliegue tiene su polo perpendicular A ESE EJE. La
 * normal de ese cinturón —la dirección menos representada entre los
 * polos— ES el eje del pliegue.
 *
 * Esa normal es el AUTOVECTOR DE MENOR AUTOVALOR del tensor de orientación
 * `T = Σ vᵢ⊗vᵢ` de los polos: es el mismo método que usa cualquier programa
 * de estereograma moderno (Stereonet, Orient) para no depender de trazar dos
 * ciclogramas a mano y leer dónde se cruzan —que es exactamente lo que da
 * este cálculo con solo 2 polos, como caso límite exacto—.
 *
 * `girdle` dice qué tan bien se ajustan los polos a ese cinturón —el índice
 * `G` de Vollmer (1990), el que compara los TRES autovalores y no solo el
 * menor—: 1 es un cinturón perfecto (los polos repartidos a lo largo de un
 * círculo máximo), cerca de 0 es o bien un cúmulo apretado en un solo punto
 * —dos polos casi idénticos también hacen que el menor autovalor se anule,
 * pero eso no es un cinturón, es la falta total de dispersión— o una nube
 * pareja sin ninguna dirección privilegiada. Ninguna de esas dos se puede
 * distinguir mirando solo el autovalor menor; hace falta el del medio
 * también.
 */
export function betaAxis(points) {
  if (points.length < 2) return null;
  let Sxx = 0;
  let Syy = 0;
  let Szz = 0;
  let Sxy = 0;
  let Sxz = 0;
  let Syz = 0;
  for (const p of points) {
    const v = lineVector(p.trend, p.plunge);
    Sxx += v.x * v.x;
    Syy += v.y * v.y;
    Szz += v.z * v.z;
    Sxy += v.x * v.y;
    Sxz += v.x * v.z;
    Syz += v.y * v.z;
  }
  const { values, vectorFor } = eigenSym3(Sxx, Syy, Szz, Sxy, Syz, Sxz);
  const menor = values[2]; // `values` ya viene en orden decreciente
  let axis = vectorFor(menor);
  if (!axis) return null; // autovalor repetido de sobra: no hay una sola dirección que reportar
  if (axis.z > 0) axis = { x: -axis.x, y: -axis.y, z: -axis.z };

  const plunge = Math.asin(Math.min(1, Math.max(-1, -axis.z))) * DEG;
  const trend = norm360(Math.atan2(axis.x, axis.y) * DEG);
  const xy = schmidtPoint(trend, plunge, 1);
  // El total es siempre `n`: cada polo aporta 1 de largo unitario a la
  // diagonal del tensor (Sxx+Syy+Szz = Σ|vᵢ|² = n), así que los tres
  // autovalores normalizados por `n` sirven de sobra sin volver a sumarlos.
  const total = points.length;
  const girdle = total > 1e-9 ? Math.max(0, Math.min(1, (2 * (values[1] - menor)) / total)) : 0;
  return { trend, plunge, n: points.length, girdle, ...xy };
}

/**
 * Autovalores (orden decreciente) y una función para pedir el autovector de
 * cualquiera de ellos, de la matriz simétrica 3×3:
 * ```
 *  a  d  f
 *  d  b  e
 *  f  e  c
 * ```
 * Los autovalores salen de la solución trigonométrica cerrada para matrices
 * simétricas 3×3 —no hace falta iterar—. El autovector de un autovalor `λ`
 * es el producto cruz de dos filas cualesquiera de `(A − λI)`, y de las tres
 * combinaciones posibles se usa la que dé el cruce más largo: con filas casi
 * paralelas ese cruce se acerca a cero y el resultado se vuelve ruido, así
 * que se prueban las tres y se elige la que sí tenga un largo de sobra.
 */
function eigenSym3(a, b, c, d, e, f) {
  const p1 = d * d + e * e + f * f;
  let values;
  if (p1 < 1e-18) {
    // Ya diagonal: los autovalores son los de la diagonal, sin más cuenta.
    values = [a, b, c].sort((x, y) => y - x);
  } else {
    const q = (a + b + c) / 3;
    const p2 = (a - q) ** 2 + (b - q) ** 2 + (c - q) ** 2 + 2 * p1;
    const p = Math.sqrt(p2 / 6);
    const B = [(a - q) / p, d / p, f / p, d / p, (b - q) / p, e / p, f / p, e / p, (c - q) / p];
    const det = B[0] * (B[4] * B[8] - B[5] * B[7]) - B[1] * (B[3] * B[8] - B[5] * B[6]) + B[2] * (B[3] * B[7] - B[4] * B[6]);
    const r = Math.min(1, Math.max(-1, det / 2));
    const phi = Math.acos(r) / 3;
    const eig1 = q + 2 * p * Math.cos(phi);
    const eig3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
    const eig2 = 3 * q - eig1 - eig3; // la traza es la suma de los tres
    values = [eig1, eig2, eig3];
  }

  function vectorFor(lambda) {
    const m = [a - lambda, d, f, d, b - lambda, e, f, e, c - lambda];
    const row = (i) => ({ x: m[i * 3], y: m[i * 3 + 1], z: m[i * 3 + 2] });
    const filas = [row(0), row(1), row(2)];
    const pares = [
      [filas[0], filas[1]],
      [filas[0], filas[2]],
      [filas[1], filas[2]],
    ];
    let mejor = null;
    let mejorLargo = -1;
    for (const [u, v] of pares) {
      const w = cross(u, v);
      const largo = Math.hypot(w.x, w.y, w.z);
      if (largo > mejorLargo) {
        mejorLargo = largo;
        mejor = w;
      }
    }
    if (mejorLargo < 1e-9) return null;
    return { x: mejor.x / mejorLargo, y: mejor.y / mejorLargo, z: mejor.z / mejorLargo };
  }

  return { values, vectorFor };
}

/* ---------- geometría de la red y de los ciclogramas ---------- */

/**
 * Vector unitario de una línea `trend`/`plunge` en el marco (Este, Norte,
 * Arriba), apuntando HACIA ABAJO cuando el plunge es positivo.
 *
 * Todo lo que sigue —el ciclograma de un plano, los círculos de la red— se
 * calcula con vectores y no con ángulos: una circunferencia sobre la esfera no
 * tiene ninguna singularidad, pero su parametrización en rumbo y buzamiento
 * las tiene en el cenit y en el nadir, que es justo por donde pasan la mitad
 * de las curvas que hay que dibujar.
 */
export function lineVector(trend, plunge) {
  const t = trend * RAD;
  const p = plunge * RAD;
  return { x: Math.sin(t) * Math.cos(p), y: Math.cos(t) * Math.cos(p), z: -Math.sin(p) };
}

/**
 * Proyecta un vector cualquiera en la red equiareal, forzándolo al HEMISFERIO
 * INFERIOR: un eje y su opuesto son la misma dirección estructural, y el
 * convenio de esta red —como el de cualquier estereograma geológico— es
 * enseñar la mitad de abajo.
 */
export function projectVector(v, R = 1) {
  const s = v.z > 0 ? -1 : 1;
  const x = v.x * s;
  const y = v.y * s;
  const z = v.z * s;
  const largo = Math.hypot(x, y, z) || 1;
  const trend = Math.atan2(x / largo, y / largo);
  const plunge = Math.asin(Math.min(1, Math.max(-1, -z / largo)));
  const theta = Math.PI / 2 - plunge;
  const r = R * Math.SQRT2 * Math.sin(theta / 2);
  return { x: r * Math.sin(trend), y: -r * Math.cos(trend) };
}

const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function unit(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * Traza de un CÍRCULO MENOR —el cono de semiángulo `psi` alrededor de `axis`—
 * en el hemisferio inferior, como una o dos polilíneas ya proyectadas.
 *
 * Con `psi = 90` el cono es un plano y la traza es un CÍRCULO MÁXIMO: los dos
 * dibujos de la red salen de esta misma función, que es la razón de que no
 * puedan desalinearse entre sí.
 *
 * Un círculo que cruza el horizonte sale de la mitad de abajo y vuelve a
 * entrar, así que se devuelve partido: unirlo daría una cuerda recta cruzando
 * la red. El punto exacto del cruce se afina por bisección en vez de dejarlo
 * caer en la muestra más cercana — sin eso, cada curva termina un grado antes
 * del círculo primitivo y la red se ve deshilachada por el borde.
 */
export function smallCircleSegments(axis, psi, { R = 1, steps = 240 } = {}) {
  const a = unit(axis);
  const auxiliar = Math.abs(a.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const u = unit(cross(a, auxiliar));
  const v = cross(a, u);
  const c = Math.cos(psi * RAD);
  const s = Math.sin(psi * RAD);
  const at = (t) => ({
    x: c * a.x + s * (Math.cos(t) * u.x + Math.sin(t) * v.x),
    y: c * a.y + s * (Math.cos(t) * u.y + Math.sin(t) * v.y),
    z: c * a.z + s * (Math.cos(t) * u.z + Math.sin(t) * v.z),
  });

  /** Parámetro del cruce por z = 0 entre dos muestras, por bisección. */
  const cruce = (t1, t2) => {
    let lo = t1;
    let hi = t2;
    const zLo = at(lo).z;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid).z * zLo > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  /*
   * Proyecta SIN dejar que la componente vertical decida el hemisferio.
   *
   * `projectVector` manda al hemisferio inferior tomando el opuesto de lo que
   * apunte hacia arriba, y eso es lo correcto para un dato suelto. Pero los
   * puntos de esta curva ya están todos abajo por construcción, y los de los
   * extremos están EXACTAMENTE en el horizonte, donde `z` vale ±1e-17 según
   * cómo caiga el redondeo. Dejar que ese ruido elija hemisferio mandaba el
   * extremo del arco a su antípoda, y la polilínea lo unía con el punto
   * anterior: una cuerda recta cruzando la red entera, de un borde al otro.
   * Con 34 curvas eso era un abanico de rectas por el centro — justamente la
   * rosa polar que esta red viene a reemplazar.
   */
  const proyecta = (p) => projectVector({ x: p.x, y: p.y, z: Math.min(0, p.z) }, R);

  const TOL = 1e-9;
  const segmentos = [];
  let actual = [];
  let tPrev = null;
  let abajo = false;
  const cierra = () => {
    // Un arco que solo ROZA el horizonte deja dos puntos en el mismo sitio: no
    // es una curva, es un punto, y dibujarlo solo ensucia el borde. Se mide el
    // largo recorrido y no la distancia entre extremos, porque un círculo
    // entero bajo el horizonte vuelve a su punto de partida y sí hay que
    // dibujarlo.
    let largo = 0;
    for (let i = 1; i < actual.length; i++) {
      largo += Math.hypot(actual[i].x - actual[i - 1].x, actual[i].y - actual[i - 1].y);
    }
    if (actual.length > 1 && largo > 1e-9) segmentos.push(actual);
    actual = [];
  };
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const p = at(t);
    const dentro = p.z <= TOL;
    if (dentro && !abajo && tPrev !== null) actual.push(proyecta(at(cruce(tPrev, t))));
    if (dentro) {
      actual.push(proyecta(p));
    } else if (abajo) {
      actual.push(proyecta(at(cruce(tPrev, t))));
      cierra();
    }
    abajo = dentro;
    tPrev = t;
  }
  cierra();
  return segmentos;
}

/**
 * Ciclograma (círculo máximo) de un plano rumbo/manteo: el lugar de todas las
 * líneas contenidas en él. Es el cono de 90° alrededor de su polo.
 */
export function greatCirclePath(strike, dip, opts = {}) {
  const polo = poleOf(strike, dip);
  return smallCircleSegments(lineVector(polo.trend, polo.plunge), 90, opts);
}

/**
 * La RED DE SCHMIDT propiamente dicha, como listas de polilíneas ya
 * proyectadas y en unidades del radio.
 *
 * Es la red estándar y no una rosa de coordenadas polares: círculos máximos de
 * los planos que contienen el eje horizontal N-S, y círculos menores de los
 * conos alrededor de ese mismo eje. Las ÚNICAS rectas que salen son los dos
 * diámetros N-S y E-W, que son casos de esas mismas dos familias (el plano
 * vertical N-S y el cono de 90°). La versión anterior dibujaba en su lugar
 * circunferencias concéntricas y seis diámetros cada 30°: eso es un papel
 * polar, sirve para leer un acimut y un ángulo, y NO es sobre lo que se lee un
 * estereograma —no se puede rotar un dato sobre él, ni leer la intersección de
 * dos planos, ni estimar un eje de pliegue, que es para lo que existe la red.
 */
export function schmidtNet({ step = 10, R = 1, steps = 240 } = {}) {
  const ejeNS = { x: 0, y: 1, z: 0 };
  const opciones = { R, steps };
  const great = [];
  const small = [];
  for (let dip = step; dip <= 90; dip += step) {
    // Buzando al Este y al Oeste: juntos forman la familia completa. A 90° los
    // dos son el mismo plano vertical, así que solo entra una vez.
    great.push(...greatCirclePath(0, dip, opciones));
    if (dip !== 90) great.push(...greatCirclePath(180, dip, opciones));
  }
  for (let psi = step; psi < 180; psi += step) {
    small.push(...smallCircleSegments(ejeNS, psi, opciones));
  }
  return { great, small };
}
