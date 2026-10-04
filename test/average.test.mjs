import { averageMeasurements } from '../src/average.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const m = (id, strike, dip, lng, lat, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { id, geomKind: 'measurement', type: 'bedding', strike, dip, ...extra },
});

// Rumbos a ambos lados del norte: 359 y 1 promedian a 0, no a 180.
let a = averageMeasurements([m('a', 359, 40, -70, -33), m('b', 1, 40, -71, -34)]);
ok(Math.min(a.strike, 360 - a.strike) < 0.5, `strike 359/1 → ~0 (${a.strike})`);
ok(Math.abs(a.dip - 40) < 0.5, `dip ~40 (${a.dip})`);
ok(Math.abs(a.lngLat[0] + 70.5) < 1e-9 && Math.abs(a.lngLat[1] + 33.5) < 1e-9, 'centroid');
ok(a.n === 2 && a.sourceIds.join() === 'a,b', 'n and ids');
ok(/n=2/.test(a.notes) && /359\/40, 001\/40/.test(a.notes) && /SD/.test(a.notes), `notes: ${a.notes}`);

// Unidad y tipo por mayoría.
a = averageMeasurements([
  m('a', 100, 30, 0, 0, { unitId: 'u1' }),
  m('b', 102, 32, 0, 0, { unitId: 'u1' }),
  m('c', 98, 28, 0, 0, { unitId: 'u2', type: 'joint' }),
]);
ok(a.unitId === 'u1' && a.type === 'bedding', 'majority unit and type');
ok(a.strikeSd > 1.5 && a.strikeSd < 2.5, `strike SD ~2 (${a.strikeSd})`);

// Sin mayoría de unidad (la mayoría no tiene): no se inventa.
a = averageMeasurements([m('a', 10, 30, 0, 0, { unitId: 'u1' }), m('b', 12, 30, 0, 0), m('c', 11, 30, 0, 0)]);
ok(a.unitId === null, 'unit absent when most have none');

ok(averageMeasurements([]) === null, 'empty → null');
// Un solo dato: SD 0.
a = averageMeasurements([m('a', 45, 45, 1, 1)]);
ok(a.strikeSd === 0 && Math.abs(a.strike - 45) < 1e-6, 'single datum');

process.exit(fails ? 1 : 0);
