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
