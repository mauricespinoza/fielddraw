/**
 * Cortar y unir geometrías, sobre JSTS (el port JavaScript de JTS).
 *
 * Se carga por <script> y no como módulo: jsts no publica build ESM. Son ~500
 * KB que salen de `vendor/`, así que también están disponibles sin señal; se
 * piden la primera vez que se usa una de estas dos herramientas.
 */

import { removeCollinear } from './topology.js';
import { loadVendorScript } from './vendorPaths.js';

let jstsPromise = null;

export function loadJsts() {
  if (!jstsPromise) {
    jstsPromise = (async () => {
      if (!globalThis.jsts) await loadVendorScript('jsts.min.js');
      if (!globalThis.jsts) throw new Error('jsts no expuso el objeto global');
      return globalThis.jsts;
    })();
  }
  return jstsPromise;
}

/** JSTS devuelve colecciones estilo Java; esto las normaliza a un array. */
function toArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.toArray === 'function') return Array.from(collection.toArray());
  if (typeof collection.iterator === 'function') {
    const out = [];
    const it = collection.iterator();
    while (it.hasNext()) out.push(it.next());
    return out;
  }
  return [];
}

/**
 * Un polígono usado como cortador corta por su BORDE. Sin esto, `union` con
 * una geometría de área no noda nada útil y el corte no ocurriría.
 */
function asCutter(geometry) {
  return geometry.getDimension() === 2 ? geometry.getBoundary() : geometry;
}

function parts(geometry) {
  const n = geometry.getNumGeometries();
  const out = [];
  for (let i = 0; i < n; i++) out.push(geometry.getGeometryN(i));
  return out;
}

/**
 * Corta una línea con otra.
 *
 * `union` noda ambas geometrías en sus intersecciones; después nos quedamos
 * con los trozos que pertenecen a la línea original — los que no aportan nada
 * al restarles la original.
 *
 * @returns {object[]|null} geometrías GeoJSON, o null si no hubo corte real.
 */
export async function splitLine(lineGeoJSON, cutterGeoJSON) {
  const jsts = await loadJsts();
  const reader = new jsts.io.GeoJSONReader();
  const writer = new jsts.io.GeoJSONWriter();

  const line = reader.read(lineGeoJSON);
  const cutter = asCutter(reader.read(cutterGeoJSON));
  if (!line.intersects(cutter)) return null;

  const noded = line.union(cutter);
  const kept = parts(noded).filter((g) => {
    if (g.isEmpty() || g.getLength() === 0) return false;
    return g.difference(line).isEmpty();
  });
  return kept.length > 1 ? kept.map((g) => writer.write(g)) : null;
}

/**
 * Corta un polígono con una línea.
 *
 * Receta clásica de JTS: se unen los anillos del polígono con la línea de
 * corte para nodarlos, se poligoniza el resultado y se descartan las piezas
 * que caen fuera del polígono original.
 */
export async function splitPolygon(polygonGeoJSON, cutterGeoJSON) {
  const jsts = await loadJsts();
  const reader = new jsts.io.GeoJSONReader();
  const writer = new jsts.io.GeoJSONWriter();

  const poly = reader.read(polygonGeoJSON);
  const cutter = asCutter(reader.read(cutterGeoJSON));
  if (!poly.intersects(cutter)) return null;

  const noded = poly.getBoundary().union(cutter);
  const polygonizer = new jsts.operation.polygonize.Polygonizer();
  polygonizer.add(noded);

  const pieces = toArray(polygonizer.getPolygons()).filter((p) => {
    if (p.isEmpty() || p.getArea() === 0) return false;
    return poly.contains(p.getInteriorPoint());
  });
  return pieces.length > 1 ? pieces.map((p) => writer.write(p)) : null;
}

/**
 * Une líneas contiguas en el menor número posible de polilíneas — el
 * equivalente de "Unir elementos seleccionados" de QGIS sobre líneas.
 * Las que no se tocan quedan como estaban.
 */
export async function mergeLines(geometries) {
  const jsts = await loadJsts();
  const reader = new jsts.io.GeoJSONReader();
  const writer = new jsts.io.GeoJSONWriter();

  const merger = new jsts.operation.linemerge.LineMerger();
  for (const g of geometries) merger.add(reader.read(g));
  const merged = toArray(merger.getMergedLineStrings());
  if (merged.length === 0) return null;
  return merged.map((g) => writer.write(g));
}

/**
 * Une polígonos. Si el resultado queda en piezas inconexas se devuelven por
 * separado: el modelo de datos guarda polígonos simples, no multiparte.
 *
 * Con `clean` (por omisión) el resultado se deja como un polígono limpio: solo
 * el anillo exterior y sin nodos colineales. Es lo que se quiere al fusionar
 * unidades contiguas — los huecos que aparecen ahí no son geología, son
 * slivers de dos bordes que no coincidían al milímetro, y la fila de vértices
 * que deja el borde común desaparecido no aporta forma.
 */
export async function unionPolygons(geometries, { clean = true } = {}) {
  const jsts = await loadJsts();
  const reader = new jsts.io.GeoJSONReader();
  const writer = new jsts.io.GeoJSONWriter();

  // `buffer(0)` normaliza geometrías con autointersecciones: sin esto, un
  // polígono dibujado a mano que se cruza a sí mismo hace fallar el union.
  const read = (g) => {
    const geom = reader.read(g);
    return geom.isValid() ? geom : geom.buffer(0);
  };

  let acc = read(geometries[0]);
  for (let i = 1; i < geometries.length; i++) acc = acc.union(read(geometries[i]));
  if (acc.isEmpty()) return null;

  const out = parts(acc).filter((p) => !p.isEmpty() && p.getArea() > 0);
  if (!out.length) return null;
  const written = out.map((p) => writer.write(p));
  return clean ? written.map(cleanPolygon) : written;
}

/**
 * Resta un área a un polígono.
 *
 * Es la operación que abre una ventana dentro de una unidad: un stock que la
 * atraviesa, una laguna, un techo colgante. El resultado puede ser de tres
 * formas, y las tres son legítimas:
 *
 * - un polígono CON ANILLO INTERIOR, si lo restado cae entero dentro;
 * - varias piezas, si lo restado lo atraviesa de lado a lado — ahí restar
 *   parte en dos, igual que un corte;
 * - nada, si lo restado lo cubre por completo. Eso se devuelve como lista
 *   vacía y NO como null: quien llama tiene que poder distinguir "no se tocaron"
 *   de "no queda nada", porque borrar el elemento entero sin decirlo sería la
 *   peor manera de responder a un trazo mal cerrado.
 *
 * @returns {object[]|null} piezas GeoJSON, [] si no queda nada, null si no se
 *   tocan y por tanto no hay nada que hacer.
 */
export async function differencePolygons(polygonGeoJSON, holeGeoJSON) {
  const jsts = await loadJsts();
  const reader = new jsts.io.GeoJSONReader();
  const writer = new jsts.io.GeoJSONWriter();

  // `buffer(0)` normaliza un trazo a mano que se cruza a sí mismo; sin esto,
  // un anillo con un lazo hace fallar la resta en vez de dar el hueco.
  const normaliza = (g) => {
    const geom = reader.read(g);
    return geom.isValid() ? geom : geom.buffer(0);
  };

  const poly = normaliza(polygonGeoJSON);
  const hueco = normaliza(holeGeoJSON);
  if (poly.isEmpty() || hueco.isEmpty()) return null;
  if (!poly.intersects(hueco)) return null;

  const resto = poly.difference(hueco);
  if (resto.isEmpty()) return [];

  const piezas = parts(resto).filter((g) => !g.isEmpty() && g.getArea() > 0);
  if (!piezas.length) return [];
  // Nada cambió de verdad: el área restada caía fuera salvo por el contacto.
  if (piezas.length === 1 && Math.abs(piezas[0].getArea() - poly.getArea()) < poly.getArea() * 1e-12) {
    return null;
  }
  return piezas.map((g) => writer.write(g));
}

/**
 * Compacidad de Polsby-Popper: 4π·área/perímetro².
 *
 * Vale 1 en un círculo y tiende a 0 en una astilla larga y fina. Es lo que
 * separa un hueco de verdad —un stock, una laguna: formas compactas— de un
 * sliver, que es el hilo que dejan dos bordes que no coincidían al milímetro.
 */
function compacidad(ring) {
  let area = 0;
  let perimetro = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    perimetro += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
  }
  if (perimetro === 0) return 0;
  return (4 * Math.PI * Math.abs(area / 2)) / (perimetro * perimetro);
}

/** Por debajo de esto un anillo interior es un hilo, no una ventana. */
const SLIVER_MAX = 0.02;

/**
 * Quita los vértices redundantes de un polígono y descarta los anillos
 * interiores que son slivers.
 *
 * Antes tiraba TODOS los anillos interiores, porque los únicos que aparecían
 * eran los slivers que deja unir dos unidades contiguas. Desde que se puede
 * restar un área, un anillo interior puede ser un dato: una ventana
 * cartografiada a mano que fusionar la unidad con su vecina no tiene por qué
 * borrar. Se distinguen por la forma, no por el tamaño — un stock chico y un
 * sliver enorme existen los dos, pero solo el sliver es un hilo.
 *
 * La tolerancia de colinealidad va en grados: 1e-9° son ~0,1 mm, así que solo
 * cae lo que de verdad está sobre la recta.
 */
export function cleanPolygon(geometry) {
  if (!geometry || geometry.type !== 'Polygon' || !geometry.coordinates.length) return geometry;
  const shell = removeCollinear(geometry.coordinates[0]);
  const huecos = geometry.coordinates
    .slice(1)
    .filter((r) => r.length >= 4 && compacidad(r) >= SLIVER_MAX)
    .map((r) => removeCollinear(r))
    .filter((r) => r.length >= 4);
  return { type: 'Polygon', coordinates: [shell, ...huecos] };
}

/** ¿La línea de corte toca esta geometría? Filtro previo antes de cortar. */
export async function intersects(aGeoJSON, bGeoJSON) {
  const jsts = await loadJsts();
  const reader = new jsts.io.GeoJSONReader();
  return reader.read(aGeoJSON).intersects(reader.read(bGeoJSON));
}
