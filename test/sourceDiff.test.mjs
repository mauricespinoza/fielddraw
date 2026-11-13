import { strict as assert } from 'node:assert';
import test from 'node:test';

import { featureDiff, indexFeatures } from '../src/sourceDiff.js';

/*
 * Lo que se le manda al mapa cuando cambia el dibujo. Un error aquí no da
 * ninguna excepción: deja en pantalla un elemento que ya se borró, o pinta
 * uno debajo de otro que debía ir encima. Por eso se comprueba aplicando la
 * diferencia igual que la aplica el worker de MapLibre —un Map por id, donde
 * reemplazar conserva el lugar y lo nuevo va al final— y comparando con la
 * lista que tenía que quedar.
 */

const f = (id, v = 0) => ({ type: 'Feature', properties: { id, v }, geometry: null });

/** Lo que hace el worker con `{remove, add}`. */
function aplicar(prevList, diff) {
  const m = new Map(prevList.map((x) => [x.properties.id, x]));
  for (const id of diff.remove) m.delete(id);
  for (const x of diff.add) m.set(x.properties.id, x);
  return [...m.values()];
}

const comprobar = (prev, next) => {
  const diff = featureDiff(indexFeatures(prev), next);
  if (diff) assert.deepEqual(aplicar(prev, diff), next);
  return diff;
};

test('sin base no hay diferencia: se manda todo', () => {
  assert.equal(featureDiff(null, [f('a')]), null);
});

test('la misma lista no manda nada', () => {
  const prev = [f('a'), f('b'), f('c')];
  const diff = comprobar(prev, [...prev]);
  assert.deepEqual(diff, { remove: [], add: [] });
});

test('un elemento nuevo al final viaja solo', () => {
  const prev = [f('a'), f('b'), f('c')];
  const nuevo = f('d');
  const diff = comprobar(prev, [...prev, nuevo]);
  assert.deepEqual(diff.remove, []);
  assert.deepEqual(diff.add, [nuevo]);
});

test('un elemento editado se reemplaza en su sitio', () => {
  const prev = [f('a'), f('b'), f('c'), f('d')];
  const b2 = f('b', 1);
  const diff = comprobar(prev, [prev[0], b2, prev[2], prev[3]]);
  assert.deepEqual(diff.remove, []);
  assert.deepEqual(diff.add, [b2]);
});

test('borrar manda solo el id', () => {
  const prev = [f('a'), f('b'), f('c'), f('d')];
  const diff = comprobar(prev, [prev[0], prev[2], prev[3]]);
  assert.deepEqual(diff, { remove: ['b'], add: [] });
});

test('cortar una línea: sale una y entran dos al final', () => {
  const prev = [f('a'), f('b'), f('c'), f('d'), f('e'), f('g')];
  const diff = comprobar(prev, [prev[0], prev[2], prev[3], prev[4], prev[5], f('b1'), f('b2')]);
  assert.deepEqual(diff.remove, ['b']);
  assert.deepEqual(diff.add.map((x) => x.properties.id), ['b1', 'b2']);
});

test('lo que vuelve al medio (deshacer un borrado) obliga a mandar todo', () => {
  const b = f('b');
  const prev = [f('a'), f('c'), f('d'), f('e'), f('g'), f('h')];
  assert.equal(featureDiff(indexFeatures(prev), [prev[0], b, ...prev.slice(1)]), null);
});

test('un cambio de orden obliga a mandar todo', () => {
  const prev = [f('a'), f('b'), f('c'), f('d'), f('e'), f('g')];
  assert.equal(featureDiff(indexFeatures(prev), [prev[1], prev[0], ...prev.slice(2)]), null);
});

test('ids ausentes o repetidos: ni base ni diferencia', () => {
  const sinId = { type: 'Feature', properties: {}, geometry: null };
  assert.equal(indexFeatures([f('a'), sinId]), null);
  assert.equal(indexFeatures([f('a'), f('a')]), null);
  const prev = indexFeatures([f('a'), f('b'), f('c'), f('d')]);
  assert.equal(featureDiff(prev, [f('a'), sinId]), null);
  assert.equal(featureDiff(prev, [f('a'), f('a')]), null);
});

test('si cambia más de la mitad no compensa', () => {
  const prev = [f('a'), f('b'), f('c'), f('d')];
  assert.equal(featureDiff(indexFeatures(prev), [f('a', 1), f('b', 1), f('c', 1), prev[3]]), null);
  // Vaciar el dibujo también es «todo».
  assert.equal(featureDiff(indexFeatures(prev), []), null);
});

test('del dibujo vacío al primer elemento', () => {
  const diff = featureDiff(indexFeatures([]), [f('a')]);
  // Uno de uno es más de la mitad: va entero, que cuesta lo mismo.
  assert.equal(diff, null);
});

test('secuencia al azar: aplicar la diferencia siempre da la lista nueva', () => {
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let lista = Array.from({ length: 40 }, (_, i) => f(`x${i}`));
  let n = 40;
  let conDiff = 0;
  for (let paso = 0; paso < 400; paso++) {
    const r = rnd();
    let next = lista.slice();
    const k = Math.floor(rnd() * next.length);
    if (r < 0.3) next.push(f(`x${n++}`));
    else if (r < 0.6 && next.length > 5) next.splice(k, 1);
    else if (r < 0.9) next[k] = f(next[k].properties.id, paso);
    else if (next.length > 2) next.splice(Math.floor(rnd() * next.length), 0, f(`x${n++}`));
    if (comprobar(lista, next)) conDiff++;
    lista = next;
  }
  assert.ok(conDiff > 300, `solo ${conDiff} de 400 fueron por diferencia`);
});
