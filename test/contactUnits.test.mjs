const S = await import('../src/store.js');
let fails = 0;
const ok = (n, c) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails++; };

const [a, b] = S.getState().units;
S.loadFeatures([
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    properties: { id: 'c1', type: 'stratigraphic-contact', certainty: 'observed' } },
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    properties: { id: 'f1', type: 'thrust-fault', certainty: 'observed' } },
]);
S.setSelection(['c1', 'f1']);
ok('solo cambia el contacto', S.setSelectedContactUnits({ above: a.id, below: b.id }) === 1);
const get = (id) => S.getState().features.find((f) => f.properties.id === id).properties;
ok('rótulo arriba-abajo', get('c1').contactLabel === `${a.code}-${b.code}`);
ok('falla intacta', get('f1').contactLabel === undefined);
S.updateUnit(a.id, { code: 'ZZ' });
ok('renombrar la unidad actualiza el rótulo', get('c1').contactLabel === `ZZ-${b.code}`);
S.setSelectedContactUnits({ below: null });
ok('quitar un lado', get('c1').contactLabel === 'ZZ' && !get('c1').unitBelowId);

const E = await import('../src/editOps.js');
const u = S.addUnit({ name: 'Mixta', code: 'KiGr', color: '#123456' });
ok('código con mayúsculas y minúsculas', S.getState().units.find((x) => x.id === u.id).code === 'KiGr');
const L = (id, c, above) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c },
  properties: { id, type: 'stratigraphic-contact', certainty: 'observed', ...(above ? { unitAboveId: above } : {}) } });
S.loadFeatures([
  L('a', [[0, 0], [1, 0]], u.id), L('b', [[1, 0], [1, 1]], u.id), L('c', [[1, 1], [0, 0]], b.id),
]);
S.setSelection(['a', 'b', 'c']);
E.applyLinesToPolygon();
const poly = S.getState().features.find((f) => f.geometry.type === 'Polygon');
ok('el polígono conserva la unidad mayoritaria', poly && poly.properties.type === u.id && poly.properties.code === 'KiGr');
ok('sin atributos de contacto', poly && poly.properties.unitAboveId === undefined);
process.exit(fails ? 1 : 0);
