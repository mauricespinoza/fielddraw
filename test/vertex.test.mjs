import {
  coincidentHandles,
  collectHandles,
  collectMidpoints,
  deleteVertices,
  findHandle,
  findInsertion,
  insertVertex,
  moveVertices,
  ringsOfFeature,
} from '../src/vertexEdit.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Pantalla == mundo, para poder razonar en números redondos.
const project = (c) => ({ x: c[0], y: c[1] });

const line = (id, coords) => ({
  type: 'Feature', id,
  properties: { id, kind: 'line', type: 'dike', certainty: 'observed', createdAt: 1 },
  geometry: { type: 'LineString', coordinates: coords },
});
const poly = (id, rings) => ({
  type: 'Feature', id,
  properties: { id, kind: 'polygon', type: 'volcanic-unit', certainty: 'observed', createdAt: 1 },
  geometry: { type: 'Polygon', coordinates: rings },
});
const geomOf = (fs, id) => fs.find((f) => f.properties.id === id).geometry;

console.log('== anillos sin punto de cierre ==');
{
  const p = poly('p', [[[0, 0], [10, 0], [10, 10], [0, 0]]]);
  const r = ringsOfFeature(p);
  ok('descarta el punto de cierre duplicado', r.rings[0].length === 3, JSON.stringify(r.rings[0]));
  ok('marca el anillo como cerrado', r.closed === true);
  const l = ringsOfFeature(line('l', [[0, 0], [1, 1]]));
  ok('la línea no se toca', l.rings[0].length === 2 && l.closed === false);
  ok('geometría no soportada => null', ringsOfFeature({ geometry: { type: 'Point', coordinates: [0, 0] } }) === null);
}

console.log('== manijas y puntos medios ==');
{
  const fs = [line('l', [[0, 0], [10, 0], [20, 0]])];
  const h = collectHandles(fs, project);
  ok('una manija por vértice', h.length === 3);
  ok('lleva la posición en la geometría', h[1].ring === 0 && h[1].index === 1);
  const m = collectMidpoints(fs, project);
  ok('un punto medio por segmento', m.length === 2, `-> ${m.length}`);
  ok('el punto medio está a mitad de camino', eq(m[0].lngLat, [5, 0]));
  ok('su índice es donde se insertaría', m[0].index === 1 && m[1].index === 2);

  const pf = [poly('p', [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])];
  ok('el polígono tiene 4 manijas, no 5', collectHandles(pf, project).length === 4);
  ok('y 4 puntos medios, incluido el del cierre', collectMidpoints(pf, project).length === 4);

  ok('respeta el límite', collectHandles([line('a', Array.from({ length: 50 }, (_, i) => [i, 0]))], project, 10).length === 10);
}

console.log('== búsqueda por cercanía ==');
{
  const h = collectHandles([line('l', [[0, 0], [100, 0]])], project);
  ok('encuentra la manija cercana', findHandle(h, [3, 3], 12).index === 0);
  ok('elige la más cercana', findHandle(h, [97, 2], 12).index === 1);
  ok('fuera de tolerancia => null', findHandle(h, [50, 0], 12) === null);
}

console.log('== vértices coincidentes (edición topológica) ==');
{
  // Dos polígonos que comparten el borde x=10.
  const a = poly('a', [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]);
  const b = poly('b', [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]]);
  const handles = collectHandles([a, b], project);
  const target = handles.find((h) => h.featureId === 'a' && eq(h.lngLat, [10, 0]));
  const group = coincidentHandles(handles, target);
  ok('agrupa el vértice compartido de ambos polígonos', group.length === 2, `-> ${group.length}`);
  ok('uno de cada polígono', new Set(group.map((g) => g.featureId)).size === 2);

  const solo = coincidentHandles(handles, handles.find((h) => eq(h.lngLat, [0, 0])));
  ok('un vértice no compartido queda solo', solo.length === 1);

  // Tolerancia: vértices "compartidos" que difieren en una fracción de píxel.
  const c = poly('c', [[[10.0000001, 0], [30, 0], [30, 10], [10.0000001, 0]]]);
  const h2 = collectHandles([a, c], project);
  const t2 = h2.find((h) => h.featureId === 'a' && eq(h.lngLat, [10, 0]));
  ok('tolera diferencias subpíxel', coincidentHandles(h2, t2).length === 2);

  // Vértices que el usuario ve separados (5 px) no deben agruparse.
  const d = poly('d', [[[15, 0], [30, 0], [30, 10], [15, 0]]]);
  const h3 = collectHandles([a, d], project);
  const t3 = h3.find((h) => h.featureId === 'a' && eq(h.lngLat, [10, 0]));
  ok('no fusiona vértices visiblemente distintos', coincidentHandles(h3, t3).length === 1,
     JSON.stringify(coincidentHandles(h3, t3).map((x) => x.lngLat)));
}

console.log('== mover vértices ==');
{
  const a = poly('a', [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]);
  const b = poly('b', [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]]);
  const fs = [a, b];
  const handles = collectHandles(fs, project);
  const target = handles.find((h) => h.featureId === 'a' && eq(h.lngLat, [10, 10]));

  const soloUno = moveVertices(fs, [target], [13, 12]);
  ok('mueve el vértice pedido', eq(geomOf(soloUno, 'a').coordinates[0][2], [13, 12]));
  ok('sin topología, el vecino queda como estaba',
     eq(geomOf(soloUno, 'b').coordinates[0][3], [10, 10]));

  const ambos = moveVertices(fs, coincidentHandles(handles, target), [13, 12]);
  ok('con topología se mueven los dos',
     eq(geomOf(ambos, 'a').coordinates[0][2], [13, 12]) &&
     eq(geomOf(ambos, 'b').coordinates[0][3], [13, 12]),
     JSON.stringify(geomOf(ambos, 'b').coordinates[0]));
  ok('el borde compartido sigue coincidiendo, sin gap',
     eq(geomOf(ambos, 'a').coordinates[0][1], geomOf(ambos, 'b').coordinates[0][0]));
  ok('el anillo sigue cerrado',
     eq(geomOf(ambos, 'a').coordinates[0][0], geomOf(ambos, 'a').coordinates[0].at(-1)));
  ok('no toca los demás vértices', eq(geomOf(ambos, 'a').coordinates[0][0], [0, 0]));
}
{
  // Mover el vértice 0 de un polígono debe arrastrar el punto de cierre.
  const fs = [poly('p', [[[0, 0], [10, 0], [10, 10], [0, 0]]])];
  const h = collectHandles(fs, project);
  const out = moveVertices(fs, [h[0]], [-5, -5]);
  const ring = geomOf(out, 'p').coordinates[0];
  ok('el vértice 0 y el de cierre se mueven juntos',
     eq(ring[0], [-5, -5]) && eq(ring.at(-1), [-5, -5]), JSON.stringify(ring));
  ok('el anillo conserva su longitud', ring.length === 4);
}
{
  const fs = [line('l', [[0, 0], [5, 0], [10, 0]])];
  const out = moveVertices(fs, [{ featureId: 'l', ring: 0, index: 1 }], [5, 9]);
  ok('mueve un vértice de línea', eq(geomOf(out, 'l').coordinates[1], [5, 9]));
  const noop = moveVertices(fs, [{ featureId: 'l', ring: 0, index: 99 }], [1, 1]);
  ok('índice fuera de rango no rompe', eq(geomOf(noop, 'l').coordinates, [[0, 0], [5, 0], [10, 0]]));
  ok('feature inexistente no rompe',
     eq(moveVertices(fs, [{ featureId: 'zzz', ring: 0, index: 0 }], [1, 1]), fs));
}

console.log('== insertar vértices ==');
{
  const fs = [line('l', [[0, 0], [10, 0]])];
  const mids = collectMidpoints(fs, project);
  const out = insertVertex(fs, mids[0], [5, 4]);
  ok('inserta en medio', eq(geomOf(out, 'l').coordinates, [[0, 0], [5, 4], [10, 0]]));

  const pf = [poly('p', [[[0, 0], [10, 0], [10, 10], [0, 0]]])];
  const pmids = collectMidpoints(pf, project);
  const cierre = pmids.find((m) => m.index === 3);
  const out2 = insertVertex(pf, cierre, [5, 5]);
  const ring = geomOf(out2, 'p').coordinates[0];
  ok('inserta en el segmento de cierre del polígono', ring.length === 5, JSON.stringify(ring));
  ok('y el anillo sigue cerrado', eq(ring[0], ring.at(-1)));
}

console.log('== borrar vértices ==');
{
  const fs = [line('l', [[0, 0], [5, 0], [10, 0]])];
  const r = deleteVertices(fs, [{ featureId: 'l', ring: 0, index: 1 }]);
  ok('borra el vértice', eq(geomOf(r.features, 'l').coordinates, [[0, 0], [10, 0]]));
  ok('lo reporta', r.borrados === 1 && r.omitidos === 0);

  const r2 = deleteVertices(r.features, [{ featureId: 'l', ring: 0, index: 0 }]);
  ok('no deja una línea con menos de 2 puntos', r2.borrados === 0 && r2.omitidos === 1);
  ok('y la geometría queda intacta', eq(geomOf(r2.features, 'l').coordinates, [[0, 0], [10, 0]]));
}
{
  const fs = [poly('p', [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])];
  const r = deleteVertices(fs, [{ featureId: 'p', ring: 0, index: 2 }]);
  ok('borra un vértice del polígono', geomOf(r.features, 'p').coordinates[0].length === 4);
  const r2 = deleteVertices(r.features, [{ featureId: 'p', ring: 0, index: 0 }]);
  ok('no deja un anillo con menos de 3', r2.borrados === 0 && r2.omitidos === 1);
}
{
  // Varios borrados en la misma geometría: los índices no deben desfasarse.
  const fs = [line('l', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])];
  const r = deleteVertices(fs, [
    { featureId: 'l', ring: 0, index: 1 },
    { featureId: 'l', ring: 0, index: 3 },
  ]);
  ok('borra ambos, no los vecinos',
     eq(geomOf(r.features, 'l').coordinates, [[0, 0], [2, 0], [4, 0]]),
     JSON.stringify(geomOf(r.features, 'l').coordinates));
}
{
  // Borrado topológico: el vértice compartido desaparece de los dos polígonos.
  const a = poly('a', [[[0, 0], [10, 0], [10, 5], [10, 10], [0, 10], [0, 0]]]);
  const b = poly('b', [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 5], [10, 0]]]);
  const handles = collectHandles([a, b], project);
  const target = handles.find((h) => h.featureId === 'a' && eq(h.lngLat, [10, 5]));
  const r = deleteVertices([a, b], coincidentHandles(handles, target));
  ok('borra el vértice compartido en ambos', r.borrados === 2, `-> ${r.borrados}`);
  ok('a queda con 4', geomOf(r.features, 'a').coordinates[0].length === 5);
  ok('b queda con 4', geomOf(r.features, 'b').coordinates[0].length === 5);
}

console.log('== punto de inserción sobre el borde (modo añadir) ==');
{
  const l = line('l', [[0, 0], [100, 0], [100, 100]]);
  const p = poly('p', [[[0, 200], [100, 200], [100, 300], [0, 300], [0, 200]]]);

  const ins = findInsertion([l, p], project, [40, 4], 10);
  ok('encuentra el segmento bajo el toque', !!ins, JSON.stringify(ins));
  ok('es el de la línea', ins && ins.featureId === 'l' && ins.ring === 0);
  ok('inserta después del primer vértice', ins && ins.index === 1, ins && `-> ${ins.index}`);
  ok('el punto cae EN la línea, no donde se tocó', ins && eq(ins.screen, [40, 0]), JSON.stringify(ins && ins.screen));

  ok('fuera de tolerancia => null', findInsertion([l, p], project, [40, 40], 10) === null);

  // Un anillo cerrado también ofrece su segmento de cierre.
  const cierre = findInsertion([p], project, [-3, 250], 10);
  ok('el segmento de cierre del anillo sirve', !!cierre && eq(cierre.screen, [0, 250]), JSON.stringify(cierre));

  // Con dos candidatos gana el más cercano.
  const cerca = line('c', [[0, 20], [100, 20]]);
  const elegido = findInsertion([l, cerca], project, [50, 16], 20);
  ok('elige el borde más próximo', elegido && elegido.featureId === 'c', JSON.stringify(elegido));

  // Y el resultado se puede pasar tal cual a insertVertex.
  const after = insertVertex([l], ins, ins.screen);
  ok('insertVertex lo acepta', geomOf(after, 'l').coordinates.length === 4);
  ok('en la posición correcta', eq(geomOf(after, 'l').coordinates[1], [40, 0]), JSON.stringify(geomOf(after, 'l').coordinates));
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
