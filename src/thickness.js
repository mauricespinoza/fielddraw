/**
 * Espesor estratigráfico verdadero entre dos puntos de una capa.
 *
 * El espesor de una unidad NO es la distancia que se mide en el mapa ni la
 * diferencia de cotas: es la distancia entre las dos superficies paralelas que
 * la limitan, o sea la componente del vector separación a lo largo de la
 * NORMAL a la estratificación. Sobre una capa de 30° de manteo, medir 500 m en
 * planta y anotar 500 m de espesor sobra en un factor dos.
 *
 *     e = |(p_techo - p_base) · n|,    n = normal a la capa
 *
 * Es la misma fórmula —y la misma convención de normal hacia arriba con su
 * componente horizontal apuntando hacia el manteo— que usa la herramienta «Dip
 * to Thickness» de Structural Modeller, para que un espesor medido en terreno
 * con FieldDraw y otro medido en gabinete sobre la misma carta den el mismo
 * número y se puedan comparar.
 *
 * Lo que este módulo se toma en serio es lo de siempre: decir cuánto vale el
 * número. Las dos cotas salen del DEM, con varios metros de error cada una, y
 * la orientación de la capa tiene la suya; sobre una base corta eso puede ser
 * la mitad del espesor. Va todo propagado, y con los avisos al lado.
 */

import { DEM_VERTICAL_SIGMA_M } from './dem.js';
import { gaussPair, makeRandom, seedFrom, toLocalENU } from './structure.js';

const RAD = Math.PI / 180;

/**
 * Error típico de una orientación tomada con brújula, en grados (1σ).
 *
 * El rumbo va peor que el manteo y no por el instrumento: leer la traza de una
 * estratificación en un afloramiento irregular es más ambiguo que apoyar el
 * clinómetro. Son los valores que se usan cuando la medida no trae los suyos
 * —es decir, cuando se tomó con brújula y no se calculó sobre el modelo—.
 */
export const COMPASS_STRIKE_SIGMA_DEG = 5;
export const COMPASS_DIP_SIGMA_DEG = 2;

/**
 * Por debajo de esta oblicuidad el espesor se lee casi directo; por encima, los
 * dos puntos están casi en la misma superficie y el espesor es una diferencia
 * pequeña entre números grandes.
 */
export const OBLIQUITY_WARN_DEG = 75;

/**
 * Normal unitaria HACIA ARRIBA del plano, con su componente horizontal
 * apuntando hacia donde mantea la capa. Convención de azimut: x al Este,
 * y al Norte, que es la que devuelve `toLocalENU`.
 */
export function normalFromStrikeDip(strikeDeg, dipDeg) {
  const dipDir = ((strikeDeg + 90) % 360) * RAD;
  const d = dipDeg * RAD;
  return [Math.sin(dipDir) * Math.sin(d), Math.cos(dipDir) * Math.sin(d), Math.cos(d)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));

/** Ángulo entre dos vectores, en grados. */
export function angleBetweenDeg(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return NaN;
  const c = Math.min(1, Math.max(-1, dot(a, b) / (na * nb)));
  return Math.acos(c) / RAD;
}

/**
 * Espesor a partir de dos puntos YA en metros locales.
 *
 * @param {{x:number,y:number,z:number}} base
 * @param {{x:number,y:number,z:number}} techo
 * @returns {{thickness, signedThickness, separation, mapDistance, elevationDiff, obliquity, overturned}}
 */
export function thicknessFromENU(base, techo, strikeDeg, dipDeg) {
  const v = [techo.x - base.x, techo.y - base.y, techo.z - base.z];
  const n = normalFromStrikeDip(strikeDeg, dipDeg);
  const firmado = dot(v, n);
  const sep = norm(v);
  return {
    thickness: Math.abs(firmado),
    signedThickness: firmado,
    separation: sep,
    mapDistance: Math.hypot(v[0], v[1]),
    elevationDiff: v[2],
    obliquity: sep > 1e-9 ? angleBetweenDeg(v, n) : NaN,
    // El «techo» cae por debajo del plano de la base a lo largo de la normal:
    // o la capa está invertida, o se marcaron los dos puntos al revés.
    overturned: firmado < 0,
  };
}

/**
 * Incertidumbre del espesor, por Monte Carlo.
 *
 * Se perturban las DOS cotas —cada una con el error vertical del modelo, e
 * independientes entre sí— y la orientación de la capa con la suya. No hay
 * fórmula cerrada cómoda porque el espesor depende de la normal, que depende
 * de dos ángulos: propagar a mano obligaría a linealizar y a perder justo el
 * caso que importa, el de la base corta donde la no linealidad manda.
 *
 * El generador es determinista y sembrado con los propios datos, igual que en
 * rumbo/manteo: volver a calcular el mismo espesor tiene que dar el mismo
 * margen, o el número deja de ser citable.
 */
export function propagateThickness(
  base,
  techo,
  strikeDeg,
  dipDeg,
  {
    sigmaZ = DEM_VERTICAL_SIGMA_M,
    sigmaStrike = COMPASS_STRIKE_SIGMA_DEG,
    sigmaDip = COMPASS_DIP_SIGMA_DEG,
    trials = 400,
  } = {},
) {
  const rnd = makeRandom(seedFrom([base, techo, { x: strikeDeg, y: dipDeg, z: 0 }]));
  const muestras = [];
  for (let t = 0; t < trials; t++) {
    const [g1, g2] = gaussPair(rnd);
    const [g3, g4] = gaussPair(rnd);
    const b = { ...base, z: base.z + g1 * sigmaZ };
    const c = { ...techo, z: techo.z + g2 * sigmaZ };
    const r = thicknessFromENU(b, c, strikeDeg + g3 * sigmaStrike, dipDeg + g4 * sigmaDip);
    muestras.push(r.thickness);
  }
  if (muestras.length < 2) return { sd: NaN, trials: muestras.length };
  const media = muestras.reduce((s, v) => s + v, 0) / muestras.length;
  const varianza = muestras.reduce((s, v) => s + (v - media) ** 2, 0) / (muestras.length - 1);
  return { sd: Math.sqrt(varianza), mean: media, trials: muestras.length };
}

/**
 * Avisos sobre cuánto vale el espesor calculado.
 *
 * Ninguno impide el cálculo: son las tres maneras en que un espesor puede ser
 * un número correcto y aun así no significar nada.
 */
export function thicknessWarnings({ thickness, obliquity, separation, sd, resolution, overturned }) {
  const avisos = [];
  if (overturned) {
    avisos.push(
      'The second point lies below the first along the bedding normal: either the bed is overturned, or the two points are the wrong way round.',
    );
  }
  if (Number.isFinite(obliquity) && obliquity > OBLIQUITY_WARN_DEG) {
    avisos.push(
      `The separation is ${Math.round(obliquity)}° off the bedding normal: the two points sit almost in the same bedding plane, so the thickness is a small difference between large numbers.`,
    );
  }
  if (Number.isFinite(resolution) && separation < 2 * resolution) {
    avisos.push(
      `The two points are ${Math.round(separation)} m apart, under two cells of the ${Math.round(resolution)} m model: the elevations carry more error than the measurement.`,
    );
  }
  if (Number.isFinite(sd) && Number.isFinite(thickness) && thickness > 0 && sd > thickness * 0.5) {
    avisos.push('The uncertainty is over half the thickness: read it as an order of magnitude.');
  }
  return avisos;
}

/**
 * Espesor entre dos puntos del mapa, con su incertidumbre y sus avisos.
 *
 * @param {object} opts
 * @param {{lngLat:[number,number], elevation:number}} opts.base   donde está la medida
 * @param {{lngLat:[number,number], elevation:number}} opts.top    el punto marcado
 * @param {number} opts.strike
 * @param {number} opts.dip
 * @param {number} [opts.resolution]   resolución del DEM, en metros
 * @param {number} [opts.sigmaZ]
 * @param {number} [opts.sigmaStrike]
 * @param {number} [opts.sigmaDip]
 * @returns {{ok: boolean, reason?: string, ...}}
 */
export function measureThickness({
  base,
  top,
  strike,
  dip,
  resolution,
  sigmaZ = DEM_VERTICAL_SIGMA_M,
  sigmaStrike = COMPASS_STRIKE_SIGMA_DEG,
  sigmaDip = COMPASS_DIP_SIGMA_DEG,
}) {
  if (!base || !top) return { ok: false, reason: 'Two points are needed.' };
  if (!Number.isFinite(base.elevation) || !Number.isFinite(top.elevation)) {
    return {
      ok: false,
      reason:
        'The elevation model has no data at one of the two points, so there is no thickness to compute.',
    };
  }
  if (!Number.isFinite(strike) || !Number.isFinite(dip)) {
    return { ok: false, reason: 'That measurement has no strike and dip.' };
  }

  const { enu } = toLocalENU([base, top]);
  if (enu.length < 2) return { ok: false, reason: 'The two points have no valid coordinates.' };
  const [b, t] = enu;

  const r = thicknessFromENU(b, t, strike, dip);
  const u = propagateThickness(b, t, strike, dip, { sigmaZ, sigmaStrike, sigmaDip });
  const warnings = thicknessWarnings({ ...r, sd: u.sd, resolution });

  return { ok: true, ...r, sd: u.sd, trials: u.trials, warnings, strike, dip };
}
