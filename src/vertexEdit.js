import { nearestOnSegment } from './geom.js';

/**
 * Edición de vértices.
 *
 * Todo aquí son funciones puras sobre features GeoJSON: reciben la lista, la
 * proyección a pantalla y una operación, y devuelven features nuevas. El
 * estado y el mapa quedan fuera, para poder probar la lógica sin navegador.
 *
 * Convención interna: los anillos de polígono se manejan SIN el punto de
 * cierre duplicado y se vuelven a cerrar al escribir. Así el vértice 0 es uno
 * solo y no hay que acordarse de mover también el último.
 */

/** @returns {{rings: Array<Array<[number,number]>>, closed: boolean}|null} */
export function ringsOfFeature(feature) {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === 'LineString') return { rings: [g.coordinates.slice()], closed: false };
  if (g.type === 'Polygon') {
    return { rings: g.coordinates.map((r) => dropClosing(r)), closed: true };
  }
  return null;
}

function dropClosing(ring) {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring.slice();
}

export function geometryFromRings(feature, rings) {
  const g = feature.geometry;
  if (g.type === 'LineString') return { type: 'LineString', coordinates: rings[0] };
  return { type: 'Polygon', coordinates: rings.map((r) => [...r, r[0]]) };
}

const withGeometry = (feature, geometry) => ({ ...feature, geometry });

/**
 * Manijas de vértice de las features dadas.
 * `ring` e `index` identifican la posición dentro de la geometría.
 */
export function collectHandles(features, project, limit = 4000) {
  const out = [];
  for (const f of features) {
    const parsed = ringsOfFeature(f);
    if (!parsed) continue;
    parsed.rings.forEach((ring, ri) => {
      ring.forEach((c, i) => {
        if (out.length >= limit) return;
        const p = project(c);
        out.push({ featureId: f.properties.id, ring: ri, index: i, lngLat: c, screen: [p.x, p.y] });
      });
    });
  }
  return out;
}

/**
 * Puntos medios de cada segmento. Arrastrar uno inserta un vértice ahí, que es
 * como QGIS deja densificar una geometría sin cambiar de herramienta.
 */
export function collectMidpoints(features, project, limit = 4000) {
  const out = [];
  for (const f of features) {
    const parsed = ringsOfFeature(f);
    if (!parsed) continue;
    parsed.rings.forEach((ring, ri) => {
      const n = parsed.closed ? ring.length : ring.length - 1;
      for (let i = 0; i < n; i++) {
        if (out.length >= limit) return;
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const p = project(mid);
        // `index` es la posición donde se insertaría el vértice nuevo.
        out.push({ featureId: f.properties.id, ring: ri, index: i + 1, lngLat: mid, screen: [p.x, p.y] });
      }
    });
  }
  return out;
}

/** Manija más cercana dentro de la tolerancia, en píxeles. */
export function findHandle(handles, screen, tolerance) {
  let best = null;
  const tolSq = tolerance * tolerance;
  for (const h of handles) {
    const dx = h.screen[0] - screen[0];
    const dy = h.screen[1] - screen[1];
    const d = dx * dx + dy * dy;
    if (d <= tolSq && (!best || d < best.d)) best = { handle: h, d };
  }
  return best ? best.handle : null;
}

/**
 * Manijas que ocupan el mismo punto que la dada — incluida ella misma.
 *
 * Esto es lo que hace posible la edición topológica: dos polígonos contiguos
 * comparten físicamente los vértices de su borde común, así que al mover uno
 * hay que mover todos o se abre un gap.
 *
 * La comparación se hace en píxeles y no en grados: es tolerante con datos
 * importados cuyos vértices "compartidos" difieren en la última cifra, sin
 * llegar a fusionar vértices que el usuario ve separados.
 */
export function coincidentHandles(handles, target, tolerance = 2) {
  const tolSq = tolerance * tolerance;
  return handles.filter((h) => {
    const dx = h.screen[0] - target.screen[0];
    const dy = h.screen[1] - target.screen[1];
    return dx * dx + dy * dy <= tolSq;
  });
}

/**
 * Versión indexada de `coincidentHandles`, para cuando hay que consultar la
 * coincidencia de miles de manijas: comparar todas contra todas sería
 * cuadrático, así que se reparten en una grilla del tamaño de la tolerancia.
 *
 * @returns {(handle) => Array} función de consulta
 */
export function buildCoincidence(handles, tolerance = 2) {
  const cell = Math.max(tolerance, 0.5) * 2;
  const grid = new Map();
  handles.forEach((h, i) => {
    const k = `${Math.floor(h.screen[0] / cell)},${Math.floor(h.screen[1] / cell)}`;
    let arr = grid.get(k);
    if (!arr) {
      arr = [];
      grid.set(k, arr);
    }
    arr.push(i);
  });

  const tolSq = tolerance * tolerance;
  return (target) => {
    const kx = Math.floor(target.screen[0] / cell);
    const ky = Math.floor(target.screen[1] / cell);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(`${kx + dx},${ky + dy}`);
        if (!arr) continue;
        for (const i of arr) {
          const o = handles[i];
          const ex = o.screen[0] - target.screen[0];
          const ey = o.screen[1] - target.screen[1];
          if (ex * ex + ey * ey <= tolSq) out.push(o);
        }
      }
    }
    return out;
  };
}

/**
 * Mueve un conjunto de vértices a una posición nueva, en una sola pasada.
 * @param {Array<{featureId, ring, index}>} targets
 */
export function moveVertices(features, targets, lngLat) {
  const byFeature = new Map();
  for (const t of targets) {
    if (!byFeature.has(t.featureId)) byFeature.set(t.featureId, []);
    byFeature.get(t.featureId).push(t);
  }

  return features.map((f) => {
    const list = byFeature.get(f.properties.id);
    if (!list) return f;
    const parsed = ringsOfFeature(f);
    if (!parsed) return f;
    const rings = parsed.rings.map((r) => r.slice());
    for (const t of list) {
      const ring = rings[t.ring];
      if (ring && t.index >= 0 && t.index < ring.length) ring[t.index] = [lngLat[0], lngLat[1]];
    }
    return withGeometry(f, geometryFromRings(f, rings));
  });
}

/**
 * Punto de inserción sobre el segmento más cercano al toque, en píxeles.
 *
 * Es lo que hace falta para el modo "añadir vértice": el punto medio solo sirve
 * si se apunta justo a él, mientras que aquí vale cualquier lugar del borde y
 * el vértice nuevo cae exactamente sobre la línea, no al lado.
 *
 * @returns {{featureId, ring, index, lngLat}|null} `index` es la posición donde
 *   insertar, y `lngLat` se deja en `null` porque solo el mapa sabe
 *   desproyectar: el llamador convierte `screen`.
 */
export function findInsertion(features, project, screen, tolerance) {
  let best = null;
  for (const f of features) {
    const parsed = ringsOfFeature(f);
    if (!parsed) continue;
    parsed.rings.forEach((ring, ri) => {
      const pts = ring.map((c) => {
        const p = project(c);
        return [p.x, p.y];
      });
      const n = parsed.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const r = nearestOnSegment(screen, pts[i], pts[(i + 1) % pts.length]);
        if (r.distSq > tolerance * tolerance) continue;
        if (best && r.distSq >= best.distSq) continue;
        best = {
          distSq: r.distSq,
          featureId: f.properties.id,
          ring: ri,
          index: i + 1,
          screen: r.point,
        };
      }
    });
  }
  return best;
}

/** Inserta un vértice en la posición indicada. */
export function insertVertex(features, target, lngLat) {
  return features.map((f) => {
    if (f.properties.id !== target.featureId) return f;
    const parsed = ringsOfFeature(f);
    if (!parsed) return f;
    const rings = parsed.rings.map((r) => r.slice());
    const ring = rings[target.ring];
    if (!ring) return f;
    const at = Math.max(0, Math.min(ring.length, target.index));
    ring.splice(at, 0, [lngLat[0], lngLat[1]]);
    return withGeometry(f, geometryFromRings(f, rings));
  });
}

/** Mínimo de vértices para que la geometría siga siendo válida. */
function minVertices(feature) {
  // Un anillo de polígono necesita 3, sin contar el punto de cierre.
  return feature.geometry.type === 'LineString' ? 2 : 3;
}

/**
 * Borra vértices. Se ignoran los que dejarían la geometría degenerada, así que
 * borrar el vértice compartido de un triángulo no destruye al vecino.
 *
 * @returns {{features: Array, borrados: number, omitidos: number}}
 */
export function deleteVertices(features, targets) {
  const byFeature = new Map();
  for (const t of targets) {
    if (!byFeature.has(t.featureId)) byFeature.set(t.featureId, []);
    byFeature.get(t.featureId).push(t);
  }

  let borrados = 0;
  let omitidos = 0;

  const out = features.map((f) => {
    const list = byFeature.get(f.properties.id);
    if (!list) return f;
    const parsed = ringsOfFeature(f);
    if (!parsed) return f;
    const rings = parsed.rings.map((r) => r.slice());

    // De mayor a menor índice: si no, cada borrado desplaza a los siguientes.
    const byRing = new Map();
    for (const t of list) {
      if (!byRing.has(t.ring)) byRing.set(t.ring, []);
      byRing.get(t.ring).push(t.index);
    }
    for (const [ri, indices] of byRing) {
      const ring = rings[ri];
      if (!ring) continue;
      const unique = [...new Set(indices)].sort((a, b) => b - a);
      for (const i of unique) {
        if (ring.length - 1 < minVertices(f)) {
          omitidos++;
          continue;
        }
        if (i >= 0 && i < ring.length) {
          ring.splice(i, 1);
          borrados++;
        }
      }
    }
    return withGeometry(f, geometryFromRings(f, rings));
  });

  return { features: out, borrados, omitidos };
}
