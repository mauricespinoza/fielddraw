/**
 * Todo el post-proceso del trazo a mano alzada ocurre en coordenadas de
 * PANTALLA (px), no en grados. Así la tolerancia se comporta igual a cualquier
 * escala y no hay que convertir a metros ni lidiar con la deformación de
 * Mercator con la latitud.
 */

function perpDistanceSq(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return ex * ex + ey * ey;
  }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const ox = p[0] - (a[0] + t * dx);
  const oy = p[1] - (a[1] + t * dy);
  return ox * ox + oy * oy;
}

/** Douglas-Peucker iterativo (sin recursión, para trazos largos de Pencil). */
export function simplifyDP(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const tolSq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistanceSq(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolSq) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Suavizado de Chaikin (corner cutting). Es lo que hace que un contacto
 * trazado con el Pencil se lea como un contacto geológico y no como un
 * sismograma. Conserva los extremos para no romper el snapping posterior.
 */
export function chaikin(points, iterations = 2) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Descarta puntos consecutivos más cercanos que `minDist` px. */
export function dedupe(points, minDist = 0.75) {
  if (points.length === 0) return [];
  const out = [points[0]];
  const minSq = minDist * minDist;
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const dx = points[i][0] - prev[0];
    const dy = points[i][1] - prev[1];
    if (dx * dx + dy * dy >= minSq) out.push(points[i]);
  }
  return out;
}

/** Pipeline completo: trazo freehand crudo → polilínea utilizable. */
export function processStroke(raw, { tolerance, smooth }) {
  const cleaned = dedupe(raw);
  if (cleaned.length <= 2) return cleaned;
  const simplified = simplifyDP(cleaned, tolerance);
  return smooth ? chaikin(simplified, 2) : simplified;
}
