/**
 * Dato promedio de un conjunto de planos medidos.
 *
 * El rumbo y manteo medios salen del vector medio de los polos (`meanPole`),
 * no de promediar los números sueltos: 359° y 1° de rumbo promediados como
 * números dan 180°, el plano contrario. La posición es el centroide de las
 * posiciones de los datos fuente, la unidad y el tipo son los de la mayoría.
 *
 * Qué se guarda en la nota es lo que permite rehacer el promedio a mano: el
 * número de datos, cada dato fuente en RHR (rumbo/manteo) y la desviación
 * estándar. Un promedio sin su dispersión al lado es un número que nadie
 * sabe si puede usar.
 */

import { meanPole, poleOf } from './stereogram.js';
import { norm360 } from './structure.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Diferencia con signo de dos rumbos, en (−90°, 90°]: el rumbo es un eje. */
function strikeDiff(a, b) {
  let d = (((a - b) % 180) + 180) % 180;
  if (d > 90) d -= 180;
  return d;
}

/** Desviación estándar muestral; con un solo dato no hay dispersión que medir. */
function sd(values) {
  const n = values.length;
  if (n < 2) return 0;
  const m = values.reduce((s, v) => s + v, 0) / n;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
}

/** Ángulo entre dos polos, en grados. */
function poleAngle(a, b) {
  const v = (p) => {
    const t = p.trend * RAD;
    const pl = p.plunge * RAD;
    return [Math.cos(pl) * Math.sin(t), Math.cos(pl) * Math.cos(t), -Math.sin(pl)];
  };
  const [x1, y1, z1] = v(a);
  const [x2, y2, z2] = v(b);
  return Math.acos(Math.min(1, Math.max(-1, x1 * x2 + y1 * y2 + z1 * z2))) * DEG;
}

/** El valor más frecuente; en empate gana el que apareció primero. */
function majority(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

const round = (v, d = 0) => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};

const pad3 = (n) => String(Math.round(n) % 360).padStart(3, '0');
const pad2 = (n) => String(Math.round(n)).padStart(2, '0');
const rhr = (strike, dip) => `${pad3(strike)}/${pad2(dip)}`;

/** Los planos medidos de una selección: los que tienen rumbo y manteo. */
export function averageable(features) {
  return features.filter(
    (f) =>
      f.geometry &&
      f.geometry.type === 'Point' &&
      f.properties.geomKind === 'measurement' &&
      Number.isFinite(f.properties.strike) &&
      Number.isFinite(f.properties.dip),
  );
}

/**
 * @returns {null|{lngLat, strike, dip, type, unitId, overturned, faultSense,
 *   n, strikeSd, dipSd, poleSd, sourceIds, notes}} o null si no hay con qué promediar
 *   (sin datos, o polos tan dispersos que el vector medio se cancela).
 */
export function averageMeasurements(features) {
  const src = averageable(features);
  if (src.length === 0) return null;
  const poles = src.map((f) => poleOf(f.properties.strike, f.properties.dip));
  const media = meanPole(poles);
  if (!media) return null;

  const strike = norm360(media.strike);
  const dip = media.dip;
  const lng = src.reduce((s, f) => s + f.geometry.coordinates[0], 0) / src.length;
  const lat = src.reduce((s, f) => s + f.geometry.coordinates[1], 0) / src.length;

  const strikeSd = sd(src.map((f) => strikeDiff(f.properties.strike, strike)));
  const dipSd = sd(src.map((f) => f.properties.dip));
  // Dispersión angular de los polos alrededor del polo medio: una sola cifra
  // que no depende de si el plano es casi horizontal (donde el rumbo se
  // vuelve inestable y su SD engaña).
  const poleSd =
    src.length < 2
      ? 0
      : Math.sqrt(poles.reduce((s, p) => s + poleAngle(p, media) ** 2, 0) / (src.length - 1));

  const type = majority(src.map((f) => f.properties.type));
  const withUnit = src.filter((f) => f.properties.unitId);
  const unitId = withUnit.length ? majority(withUnit.map((f) => f.properties.unitId)) : null;
  // Sin mayoría clara (menos de la mitad con unidad) tampoco se inventa una:
  // pero «según la mayoría» incluye a los que no tienen, así que se compara.
  const unitVotes = withUnit.filter((f) => f.properties.unitId === unitId).length;
  const noUnit = src.length - withUnit.length;
  const unit = unitId !== null && unitVotes >= noUnit ? unitId : null;

  const sameType = src.filter((f) => f.properties.type === type);
  const overturned = majority(sameType.map((f) => !!f.properties.overturned));
  const faultSense =
    type === 'fault-plane'
      ? majority(sameType.map((f) => f.properties.faultSense).filter(Boolean))
      : undefined;

  const list = src.map((f) => rhr(f.properties.strike, f.properties.dip)).join(', ');
  const notes =
    `Average of n=${src.length} planes. ` +
    `Source data (RHR strike/dip): ${list}. ` +
    `Mean (RHR): ${rhr(strike, dip)}. ` +
    `SD: strike ±${round(strikeSd, 1)}°, dip ±${round(dipSd, 1)}°, ` +
    `poles ±${round(poleSd, 1)}°.`;

  return {
    lngLat: [lng, lat],
    strike: round(strike, 1),
    dip: round(dip, 1),
    type,
    unitId: unit,
    overturned,
    faultSense,
    n: src.length,
    strikeSd: round(strikeSd, 1),
    dipSd: round(dipSd, 1),
    poleSd: round(poleSd, 1),
    sourceIds: src.map((f) => f.properties.id),
    notes,
  };
}
