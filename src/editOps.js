import * as store from './store.js';
import { chainLines } from './geom.js';
import { mergeLines, splitLine, splitPolygon, unionPolygons } from './geometryOps.js';
import { confirmTopology } from './topology.js';

/**
 * Orquestación de las herramientas de edición avanzada. Aísla al store de
 * JSTS: aquí se decide qué elementos se tocan y con qué atributos quedan las
 * piezas resultantes.
 */

/**
 * Aplica una línea de corte. Si hay selección, corta solo lo seleccionado;
 * si no, cualquier elemento que la línea cruce — igual que la herramienta de
 * corte de QGIS respecto de la capa activa.
 */
export async function applyCut(cut) {
  const st = store.getState();

  let cutter;
  let cutterId = null;
  if (cut && cut.type === 'feature') {
    const f = st.features.find((x) => x.properties.id === cut.id);
    if (!f) throw new Error('The cutting feature no longer exists');
    // Un polígono corta por su borde; de eso se encarga geometryOps.
    cutter = f.geometry;
    cutterId = cut.id;
  } else {
    if (!cut || !Array.isArray(cut.coords) || cut.coords.length < 2) {
      throw new Error('Invalid split line: expected {type:"coords", coords:[...]}');
    }
    cutter = { type: 'LineString', coordinates: cut.coords };
  }

  const base = st.selection.length ? store.selectedFeatures() : st.features;
  // El cortador nunca se corta a sí mismo.
  const targets = base.filter((f) => f.properties.id !== cutterId);

  const removed = [];
  const added = [];
  for (const f of targets) {
    const geom = f.geometry;
    const pieces =
      geom.type === 'Polygon'
        ? await splitPolygon(geom, cutter)
        : await splitLine(geom, cutter);
    if (!pieces) continue;
    removed.push(f.properties.id);
    for (const g of pieces) added.push(store.derivedFeature(f, g));
  }

  if (removed.length === 0) return { cortados: 0, piezas: 0 };
  store.replaceFeatures(removed, added);
  return { cortados: removed.length, piezas: added.length };
}

/**
 * Confirmación topológica sobre la selección, o sobre todo el dibujo si no hay
 * nada seleccionado. Deja a los elementos contiguos compartiendo vértices.
 */
export function applyTopology() {
  const st = store.getState();
  const targets = st.selection.length ? store.selectedFeatures() : st.features;
  if (targets.length < 2) {
    throw new Error('The topology check needs at least two features.');
  }

  const result = confirmTopology(targets, { toleranceMeters: st.topoTolerance });
  const byId = new Map(result.features.map((f) => [f.properties.id, f]));
  const features = st.features.map((f) => byId.get(f.properties.id) || f);

  const cambio =
    result.fusionados > 0 || result.insertados > 0
      ? features.some((f, i) => f !== st.features[i])
      : false;
  if (cambio) {
    store.pushHistory();
    store.setFeatures(features);
  }
  return { ...result, revisados: targets.length, cambio };
}

/** Une los elementos seleccionados; todos deben ser del mismo tipo. */
export async function applyMerge() {
  const sel = store.selectedFeatures();
  if (sel.length < 2) throw new Error('Select at least two features to merge');

  const kinds = new Set(sel.map((f) => f.geometry.type));
  if (kinds.size > 1) throw new Error('Lines and polygons cannot be merged together');

  const esPoligono = kinds.has('Polygon');
  // Antes de unir polígonos se fuerza la topología entre ellos: dos bordes
  // que no coincidían al milímetro producirían slivers, y un sliver es un
  // hueco interior en la unión. Snapear primero es más barato que limpiarlos
  // después, y deja el resultado con nodos compartidos de verdad.
  const geoms = esPoligono
    ? confirmTopology(sel, { toleranceMeters: store.getState().topoTolerance }).features.map(
        (f) => f.geometry,
      )
    : sel.map((f) => f.geometry);

  let result = esPoligono ? await unionPolygons(geoms) : await mergeLines(geoms);
  if (!result || result.length === 0) throw new Error('The merge produced no geometry');

  // Líneas que no se tocan: en vez de rendirse, se encadenan por sus extremos
  // más próximos, que es lo que uno haría a mano.
  let puenteadas = 0;
  if (!esPoligono && result.length > 1) {
    const chained = chainLines(result.map((g) => g.coordinates));
    if (chained) {
      puenteadas = result.length - 1;
      result = [{ type: 'LineString', coordinates: chained }];
    }
  }

  store.replaceFeatures(
    sel.map((f) => f.properties.id),
    result.map((g) => store.derivedFeature(sel[0], g)),
  );
  return { desde: sel.length, hasta: result.length, puenteadas };
}
