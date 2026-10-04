import * as store from '../src/store.js';
import { openProject, parseProject, serializeProject } from '../src/project.js';
import {
  baselineOf,
  featureFingerprint,
  isEditedLocally,
  planIsEmpty,
  planUpdate,
  resolvePlan,
  spotFingerprint,
  stableStringify,
  subsetBySpot,
} from '../src/strabo/sync.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const fc = (features) => ({ type: 'FeatureCollection', features });
/** Una traza aplanada como la deja `buildLineasPoligonos`, con su spot. */
const linea = (spot, x, type = 'contact depositional stratigraphic') => ({
  type: 'Feature',
  properties: { Name: `L-${spot}`, Type: type, Quality: 'known', __spot_id__: spot },
  geometry: { type: 'LineString', coordinates: [[x, 0], [x + 0.01, 0.01]] },
});
const data = (lineas) => ({ estructuras: fc([]), observacion: fc([]), lineas: fc(lineas) });

console.log('== huellas ==');
{
  ok('el orden de las claves no cambia el texto', stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }) === stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 }));
  const s1 = { type: 'Feature', properties: { id: 1, name: 'A', strike: 30 }, geometry: { type: 'Point', coordinates: [1, 2] } };
  const s2 = { ...s1, properties: { ...s1.properties, strike: 31 } };
  ok('un manteo corregido cambia la huella', spotFingerprint(s1) !== spotFingerprint(s2));
  ok('lo que añade la app al bajar no cuenta', spotFingerprint(s1) === spotFingerprint({ ...s1, properties: { ...s1.properties, __geotype__: 'point' } }));
  const b = baselineOf({ point: [s1, { ...s1, properties: { name: 'sin id' } }], line: [], polygon: [] });
  ok('baseline por id de spot, sin los que no tienen id', Object.keys(b).length === 1 && b['1'] === spotFingerprint(s1));

  const f = { type: 'Feature', properties: { id: 'x', createdAt: 1, type: 'normal-fault' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } };
  f.properties.straboLocalHash = featureFingerprint(f);
  ok('recién adoptado no está editado', !isEditedLocally(f));
  ok('cortarlo (id y fecha nuevos) no es editarlo', !isEditedLocally({ ...f, properties: { ...f.properties, id: 'y', createdAt: 2 } }));
  ok('mover un vértice sí', isEditedLocally({ ...f, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 2]] } }));
  ok('cambiar el tipo sí', isEditedLocally({ ...f, properties: { ...f.properties, type: 'thrust-fault' } }));
  ok('sin huella se asume editado', isEditedLocally({ ...f, properties: { id: 'x' } }));
}

console.log('== plan de un dataset sin abrir ==');
{
  const plan = planUpdate({
    baseline: { a: 'h1', b: 'h2', c: 'h3' },
    remote: { a: 'h1', b: 'h2x', d: 'h4' },
    data: data([]),
    adopted: false,
  });
  ok('nuevo, cambiado y borrado', plan.added.join() === 'd' && plan.replaced.join() === 'b' && plan.removed.join() === 'c');
  ok('sin conflictos: no hay nada local', plan.conflicts.length === 0 && plan.unchanged === 1);
}

console.log('== plan de un dataset abierto: las siete combinaciones ==');
const local = (spot, editado) => {
  const f = { type: 'Feature', properties: { id: `f-${spot}`, straboDataset: '1', straboSpotId: spot, type: 'stratigraphic-contact', note: `[L-${spot} · StraboSpot · Ana]` }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } };
  f.properties.straboLocalHash = featureFingerprint(f);
  if (editado) f.geometry = { type: 'LineString', coordinates: [[0, 0], [1, 3]] };
  return f;
};
{
  const plan = planUpdate({
    baseline: { s1: 'h', s2: 'h', s3: 'h', s4: 'h', s5: 'h', s6: 'h' },
    remote: { s1: 'h', s2: 'X', s3: 'X', s6: 'X', s7: 'n' },
    data: data([linea('s3', 0), linea('s6', 1)]),
    adopted: true,
    features: [local('s1', true), local('s2', false), local('s3', true), local('s4', false), local('s5', true)],
  });
  ok('igual arriba, aunque editado aquí: nada', plan.unchanged === 1);
  ok('cambiado arriba, sin tocar aquí: se reemplaza', plan.replaced.join() === 's2');
  ok('borrado arriba, sin tocar aquí: se quita', plan.removed.join() === 's4');
  ok('nuevo arriba: se añade', plan.added.join() === 's7');
  const k = Object.fromEntries(plan.conflicts.map((c) => [c.spotId, c.kind]));
  ok('cambiado arriba y editado aquí: conflicto', k.s3 === 'changed');
  ok('borrado arriba y editado aquí: conflicto', k.s5 === 'removed');
  ok('cambiado arriba y borrado aquí: conflicto', k.s6 === 'deleted-here');
  ok('tres conflictos y nada más', plan.conflicts.length === 3);
  ok('el conflicto lleva el nombre del spot', plan.conflicts.find((c) => c.spotId === 's3').name === 'L-s3');
  ok('también el de uno borrado arriba', plan.conflicts.find((c) => c.spotId === 's5').name === 'L-s5');

  const mio = resolvePlan(plan, {});
  ok('por omisión se queda lo de aquí',
     mio.remove.sort().join() === 's2,s4' && mio.add.sort().join() === 's2,s7');
  const suyo = resolvePlan(plan, { s3: 'theirs', s5: 'theirs', s6: 'theirs' });
  ok('«theirs» reemplaza, quita y restaura',
     suyo.remove.sort().join() === 's2,s3,s4,s5' && suyo.add.sort().join() === 's2,s3,s6,s7');
}

console.log('== sin huellas previas solo se añade lo que falta ==');
{
  const plan = planUpdate({ baseline: null, remote: { s1: 'h', s9: 'h' }, data: data([]), adopted: true, features: [local('s1', false)] });
  ok('añade el que no está', plan.added.join() === 's9');
  ok('no toca el que está', plan.replaced.length === 0 && plan.removed.length === 0 && plan.conflicts.length === 0);
  ok('y avisa', plan.noBaseline);
  ok('un plan vacío se reconoce', planIsEmpty(planUpdate({ baseline: { a: 'h' }, remote: { a: 'h' }, data: data([]), adopted: true })));
}

console.log('== subconjunto por spot ==');
{
  const sub = subsetBySpot(data([linea('a', 0), linea('b', 1)]), ['b']);
  ok('solo el pedido', sub.lineas.features.length === 1 && sub.lineas.features[0].properties.__spot_id__ === 'b');
}

console.log('== aplicar sobre un dataset abierto ==');
{
  store.loadProject({ features: [] });
  const v1 = data([linea('s1', 0), linea('s2', 1), linea('s3', 2)]);
  const { key } = store.addStraboDataset({ datasetId: '9', datasetName: 'Ana', ...v1, baseline: { s1: 'h', s2: 'h', s3: 'h' } });
  store.setStraboLocked(key, false);
  const deEste = () => store.getState().features.filter((f) => f.properties.straboDataset === key);
  ok('(adoptado con huellas)', deEste().length === 3 && deEste().every((f) => f.properties.straboLocalHash && !isEditedLocally(f)));

  // Se edita s3 aquí: se mueve un vértice.
  const f3 = deEste().find((f) => f.properties.straboSpotId === 's3');
  store.setSelection([f3.properties.id]);
  store.transformSelectedGeometry((g) => ({ ...g, coordinates: [[9, 9], [9.1, 9.1]] }));
  store.clearSelection();
  ok('(s3 queda editado)', isEditedLocally(deEste().find((f) => f.properties.straboSpotId === 's3')));

  // Arriba: s1 igual, s2 cambia a falla, s3 cambia, s4 nuevo.
  const v2 = data([linea('s1', 0), linea('s2', 1, 'geologic structure fault normal'), linea('s3', 2.5), linea('s4', 3)]);
  const remote = { s1: 'h', s2: 'X', s3: 'X', s4: 'n' };
  const d = store.getState().straboDatasets.find((x) => x.key === key);
  const plan = planUpdate({ baseline: d.baseline, remote, data: v2, adopted: true, features: deEste() });
  ok('(un conflicto: s3)', plan.conflicts.length === 1 && plan.conflicts[0].spotId === 's3');

  const r = store.applyStraboUpdate(key, { data: v2, baseline: remote, plan, choices: {} });
  const ahora = deEste();
  ok('s4 entra', ahora.some((f) => f.properties.straboSpotId === 's4'));
  ok('s2 se reemplaza por la falla normal', ahora.find((f) => f.properties.straboSpotId === 's2').properties.type === 'normal-fault');
  ok('s3 conserva la edición de aquí', ahora.find((f) => f.properties.straboSpotId === 's3').geometry.coordinates[0][0] === 9);
  ok('sin duplicar', ahora.length === 4, String(ahora.length));
  ok('lo que entra trae su huella', ahora.every((f) => f.properties.straboLocalHash));
  ok('cuenta lo hecho', r.added === 2 && r.removed === 1, JSON.stringify(r));
  ok('las huellas nuevas quedan como referencia', store.getState().straboDatasets.find((x) => x.key === key).baseline.s4 === 'n');

  store.undo();
  ok('deshacer devuelve el dibujo de antes', deEste().length === 3 && !deEste().some((f) => f.properties.straboSpotId === 's4'));
  ok('y la referencia de antes', store.getState().straboDatasets.find((x) => x.key === key).baseline.s4 === undefined);
  store.redo();

  // «Theirs» en un conflicto: s3 cambia otra vez arriba.
  const v3 = data([linea('s1', 0), linea('s2', 1, 'geologic structure fault normal'), linea('s3', 4), linea('s4', 3)]);
  const remote3 = { ...remote, s3: 'Y' };
  const d3 = store.getState().straboDatasets.find((x) => x.key === key);
  const plan3 = planUpdate({ baseline: d3.baseline, remote: remote3, data: v3, adopted: true, features: deEste() });
  store.applyStraboUpdate(key, { data: v3, baseline: remote3, plan: plan3, choices: { s3: 'theirs' } });
  const s3 = deEste().filter((f) => f.properties.straboSpotId === 's3');
  ok('«theirs» trae la versión de arriba', s3.length === 1 && s3[0].geometry.coordinates[0][0] === 4);
  ok('y ya no cuenta como editado', !isEditedLocally(s3[0]));
}

console.log('== aplicar sobre uno sin abrir solo cambia su capa ==');
{
  const { key } = store.addStraboDataset({ datasetId: '10', datasetName: 'Beto', ...data([linea('b1', 0)]), baseline: { b1: 'h' } });
  const antes = store.getState().features.length;
  const v2 = data([linea('b1', 0), linea('b2', 1)]);
  const plan = planUpdate({ baseline: { b1: 'h' }, remote: { b1: 'h', b2: 'n' }, data: v2, adopted: false });
  store.applyStraboUpdate(key, { data: v2, baseline: { b1: 'h', b2: 'n' }, plan });
  const d = store.getState().straboDatasets.find((x) => x.key === key);
  ok('su capa trae lo nuevo', d.lineas.features.length === 2);
  ok('el dibujo no se toca', store.getState().features.length === antes);
  ok('sigue cerrado', d.locked && !d.adopted);
}

console.log('== la huella sobrevive a guardar y abrir el proyecto ==');
{
  const texto = JSON.stringify(serializeProject('Huellas'));
  store.loadProject({ features: [] });
  openProject(parseProject(texto).project);
  const adoptados = store.getState().features.filter((f) => f.properties.straboSpotId);
  ok('(hay adoptados)', adoptados.length > 0);
  const editados = adoptados.filter(isEditedLocally).map((f) => f.properties.straboSpotId);
  ok('ningún elemento queda como editado', editados.length === 0, editados.join());
  ok('las referencias viajan en el proyecto', store.getState().straboDatasets.every((d) => d.baseline));
}

if (fails) {
  console.log(`\n${fails} FAIL`);
  process.exit(1);
}
console.log('\nTODO OK');
