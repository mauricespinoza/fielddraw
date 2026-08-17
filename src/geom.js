/**
 * Geometría 2D en coordenadas de pantalla (px). Todo el snapping, el trace y
 * la detección de "toque afuera" trabajan en píxeles: así las tolerancias se
 * expresan como el usuario las percibe y no dependen del zoom ni de la
 * deformación de Mercator con la latitud.
 */

/** Punto más cercano del segmento a-b respecto de p. */
export function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  const ex = p[0] - x;
  const ey = p[1] - y;
  return { point: [x, y], t, distSq: ex * ex + ey * ey };
}

export function distPointSegment(p, a, b) {
  return Math.sqrt(nearestOnSegment(p, a, b).distSq);
}

/**
 * Punto más cercano de una polilínea. `index` es el segmento donde cae, lo que
 * permite insertar un vértice ahí sin volver a buscar.
 */
export function nearestOnPolyline(p, pts, closed = false) {
  if (pts.length === 0) return null;
  if (pts.length === 1) {
    const ex = p[0] - pts[0][0];
    const ey = p[1] - pts[0][1];
    return { point: pts[0].slice(), index: 0, t: 0, distSq: ex * ex + ey * ey };
  }
  let best = null;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const r = nearestOnSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (!best || r.distSq < best.distSq) best = { ...r, index: i };
  }
  return best;
}

/** Vértice más cercano de una polilínea (para snapping a vértice). */
export function nearestVertex(p, pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const ex = p[0] - pts[i][0];
    const ey = p[1] - pts[i][1];
    const distSq = ex * ex + ey * ey;
    if (!best || distSq < best.distSq) best = { point: pts[i].slice(), index: i, distSq };
  }
  return best;
}

export function bboxOf(pts, pad = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

export function bboxIntersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

export function pointInBbox(p, b) {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

/** Ray casting sobre un anillo. Los puntos del borde pueden dar cualquiera. */
export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Primer anillo exterior, el resto huecos, como manda GeoJSON. */
export function pointInPolygon(p, rings) {
  if (rings.length === 0 || !pointInRing(p, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(p, rings[i])) return false;
  return true;
}

/**
 * Elemento bajo el dedo. Prioriza el más cercano al borde; un polígono tocado
 * en su interior cuenta como distancia cero, para que se pueda seleccionar sin
 * tener que apuntar justo al contorno.
 */
export function pickFeature(features, screen, project, tolerance) {
  let best = null;
  for (const f of features) {
    if (!f.geometry) continue;
    const rings = ringsOf(f.geometry).map((r) => ({
      ...r,
      pts: r.coords.map((c) => {
        const q = project(c);
        return [q.x, q.y];
      }),
    }));
    if (rings.length === 0) continue;

    let dist = Infinity;
    for (const r of rings) {
      const near = nearestOnPolyline(screen, r.pts, r.closed);
      if (near) dist = Math.min(dist, Math.sqrt(near.distSq));
    }
    if (f.geometry.type === 'Polygon' && pointInPolygon(screen, rings.map((r) => r.pts))) {
      dist = 0;
    }
    if (dist <= tolerance && (!best || dist < best.dist)) best = { feature: f, dist };
  }
  return best ? best.feature : null;
}

/**
 * Encadena polilíneas sueltas en una sola, uniéndolas por los extremos más
 * próximos. El salto entre una pieza y la siguiente queda como un segmento
 * recto, que es justo lo que se quiere al unir tramos de un mismo contacto
 * que quedaron separados.
 */
export function chainLines(lines) {
  const remaining = lines.filter((l) => l && l.length >= 2).map((l) => l.slice());
  if (remaining.length === 0) return null;
  let chain = remaining.shift();

  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  while (remaining.length > 0) {
    let best = null;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      // Se evalúan los cuatro emparejamientos posibles de extremos.
      const options = [
        { dist: d(chain.at(-1), cand[0]), at: 'end', reverse: false },
        { dist: d(chain.at(-1), cand.at(-1)), at: 'end', reverse: true },
        { dist: d(chain[0], cand.at(-1)), at: 'start', reverse: false },
        { dist: d(chain[0], cand[0]), at: 'start', reverse: true },
      ];
      for (const o of options) if (!best || o.dist < best.dist) best = { ...o, index: i };
    }
    const cand = remaining.splice(best.index, 1)[0];
    const piece = best.reverse ? cand.slice().reverse() : cand;
    chain = best.at === 'end' ? [...chain, ...piece] : [...piece, ...chain];
  }
  return chain;
}

/** Aplana la geometría de una feature GeoJSON a arrays de anillos/líneas. */
export function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [{ coords: geometry.coordinates, closed: false }];
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.map((c) => ({ coords: c, closed: false }));
  }
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((c) => ({ coords: c, closed: true }));
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat().map((c) => ({ coords: c, closed: true }));
  }
  return [];
}
