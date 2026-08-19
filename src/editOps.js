import * as store from './store.js';
import { chainLines } from './geom.js';
import {
  differencePolygons,
  mergeLines,
  splitLine,
  splitPolygon,
  unionPolygons,
} from './geometryOps.js';
import { confirmTopology } from './topology.js';
import { reshapeGeometry } from './reshape.js';

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
 * Resta un área dibujada a los polígonos: abre una ventana dentro de ellos.
 *
 * A qué se aplica:
 *
 * - con selección, a los polígonos seleccionados y a nadie más;
 * - sin selección, SOLO si hay exactamente un polígono que contenga el área
 *   dibujada. Ahí no hay ambigüedad posible y pedir que se seleccione primero
 *   sería un paso de más en terreno.
 *
 * Con dos o más candidatos se para y se pide elegir. Restarle el mismo hueco a
 * todo lo que se solape borraría área de unidades que nadie nombró, y eso es
 * justo lo que hace que una herramienta destructiva dé miedo usarla.
 *
 * @returns {{abiertos: number, piezas: number, partidos: number}}
 */
export async function applyHole(hole) {
  const st = store.getState();
  if (!hole || !Array.isArray(hole.coords) || hole.coords.length < 3) {
    throw new Error('The area to remove needs at least three vertices.');
  }
  const ring = closeRing(hole.coords);
  if (!ring) {
    throw new Error('That outline encloses no area: it needs three distinct vertices.');
  }
  const cutter = { type: 'Polygon', coordinates: [ring] };

  const base = st.selection.length ? store.selectedFeatures() : st.features;
  let targets = base.filter((f) => f.geometry && f.geometry.type === 'Polygon');

  if (!st.selection.length) {
    // Sin selección: solo el que de verdad contiene lo dibujado, y solo si es
    // uno. `pointInPolygon` no vale aquí —el hueco puede asomar por el borde—
    // así que se pregunta por el solape real, que es lo que importa.
    const dentro = [];
    for (const f of targets) {
      const r = await differencePolygons(f.geometry, cutter);
      if (r !== null) dentro.push(f);
    }
    if (dentro.length === 0) {
      throw new Error('That area does not fall on any polygon.');
    }
    if (dentro.length > 1) {
      throw new Error(
        `That area overlaps ${dentro.length} polygons. Select the one to open first (Select tool).`,
      );
    }
    targets = dentro;
  }

  if (targets.length === 0) {
    throw new Error('Holes are only cut out of polygons; nothing selected is one.');
  }

  const removed = [];
  const added = [];
  let partidos = 0;
  let vaciados = 0;
  for (const f of targets) {
    const piezas = await differencePolygons(f.geometry, cutter);
    if (piezas === null) continue;
    if (piezas.length === 0) {
      // El área cubría el polígono entero. Borrarlo sin decirlo sería la peor
      // respuesta posible a un trazo que se pasó de largo.
      vaciados++;
      continue;
    }
    removed.push(f.properties.id);
    if (piezas.length > 1) partidos++;
    for (const g of piezas) added.push(store.derivedFeature(f, g));
  }

  if (removed.length === 0) {
    if (vaciados) {
      throw new Error(
        `That area covers ${vaciados === 1 ? 'the whole polygon' : 'the whole of every polygon'}. Nothing was removed: draw the hole inside it.`,
      );
    }
    return { abiertos: 0, piezas: 0, partidos: 0 };
  }

  store.replaceFeatures(removed, added);
  return { abiertos: removed.length, piezas: added.length, partidos };
}

/**
 * Aplica una línea de reshape a los elementos seleccionados.
 *
 * Exige selección, por lo mismo que Cortar: el gesto es una línea cualquiera
 * sobre el mapa y, sin acotar a qué afecta, redibujaría de golpe todo lo que
 * cruce. Los que la línea no cruce lo suficiente se quedan como estaban, sin
 * que eso sea un error — es lo normal al trazar sobre un mapa con varias
 * geometrías cerca.
 *
 * Es síncrono: no usa JSTS, así que no hay nada que descargar ni esperar.
 *
 * @returns {{redibujados: number, intactos: number}}
 */
export function applyReshape(linea) {
  const st = store.getState();
  if (!linea || !Array.isArray(linea.coords) || linea.coords.length < 2) {
    throw new Error('Invalid reshape line');
  }
  if (st.selection.length === 0) {
    throw new Error(
      'Select what you want to reshape first: Select tool, tap it, then come back to Reshape.',
    );
  }

  const ids = new Set(st.selection);
  let redibujados = 0;
  const features = st.features.map((f) => {
    if (!ids.has(f.properties.id)) return f;
    const geometry = reshapeGeometry(f.geometry, linea.coords);
    if (!geometry) return f;
    redibujados++;
    return { ...f, geometry };
  });

  if (redibujados > 0) {
    store.pushHistory();
    store.setFeatures(features);
  }
  return { redibujados, intactos: st.selection.length - redibujados };
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

/**
 * Convierte las líneas seleccionadas en un polígono, cerrando el anillo.
 *
 * Con varias líneas se encadenan primero por sus extremos más próximos: en el
 * terreno el borde de una unidad casi nunca es un solo trazo, sino un contacto
 * más una falla más otro contacto, y lo que se quiere al seleccionarlos todos
 * es el polígono que encierran, no un polígono por trazo. El puente entre
 * pieza y pieza queda como un segmento recto, igual que en Unir.
 *
 * El polígono nace con la unidad activa de la paleta —una línea no tiene
 * unidad de la que heredarla— y conserva certeza y opacidad de la primera
 * línea. Las líneas de origen desaparecen: es una conversión, no una copia.
 */
export function applyLinesToPolygon() {
  const st = store.getState();
  const sel = store.selectedFeatures();
  const lineas = sel.filter((f) => f.geometry.type === 'LineString');
  if (lineas.length === 0) throw new Error('Select at least one line to convert');

  const chained =
    lineas.length === 1
      ? lineas[0].geometry.coordinates.slice()
      : chainLines(lineas.map((f) => f.geometry.coordinates));
  const ring = closeRing(chained || []);
  if (!ring) {
    throw new Error('The line does not enclose an area: it needs three distinct vertices.');
  }

  const unit = st.units.find((u) => u.id === st.polygonType);
  const source = lineas[0];
  const polygon = store.derivedFeature(source, { type: 'Polygon', coordinates: [ring] });
  // `flip` es del ornamento de la falla y no significa nada en un polígono;
  // `type` pasa de ser el tipo de línea a ser el id de la unidad.
  delete polygon.properties.flip;
  polygon.properties = {
    ...polygon.properties,
    kind: 'polygon',
    type: st.polygonType,
    unit: unit ? unit.name : '',
    code: unit ? unit.code : '',
  };

  store.replaceFeatures(
    lineas.map((f) => f.properties.id),
    [polygon],
  );
  return { desde: lineas.length, unidad: unit ? unit.name : '' };
}

/**
 * Anillo cerrado a partir de una polilínea: quita los puntos repetidos
 * seguidos —que un trazo a pulso deja de sobra— y repite el primero al final
 * si hacía falta. Devuelve null si no quedan tres vértices distintos, que es
 * lo mínimo para encerrar área.
 */
function closeRing(coords) {
  const pts = [];
  for (const c of coords) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) pts.push(c.slice());
  }
  // Un anillo que ya venía cerrado no debe contar dos veces su primer punto.
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && first[0] === last[0] && first[1] === last[1]) pts.pop();
  if (pts.length < 3) return null;
  return [...pts, first.slice()];
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
