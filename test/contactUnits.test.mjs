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
process.exit(fails ? 1 : 0);
