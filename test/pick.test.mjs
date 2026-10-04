import { pickFeatures } from '../src/geom.js';

let fails = 0;
const ok = (n, c) => { if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n}`); } };
// Proyección identidad: coordenadas = píxeles.
const project = (c) => ({ x: c[0], y: c[1] });
const pt = (id, x, y) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [x, y] } });
const line = (id, coords) => ({ type: 'Feature', properties: { id }, geometry: { type: 'LineString', coordinates: coords } });
const poly = (id, ring) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Polygon', coordinates: [ring] } });
const ids = (r) => r.map((f) => f.properties.id).join(',');

const P = poly('poly', [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]);
const L = line('line', [[0, 50], [100, 50]]);
const A = pt('a', 50, 50);

ok('polígono solo', ids(pickFeatures([P], [50, 20], project, 12)) === 'poly');
ok('línea gana al polígono', ids(pickFeatures([P, L], [50, 52], project, 12)) === 'line');
ok('punto gana a línea y polígono', ids(pickFeatures([P, L, A], [50, 52], project, 12)) === 'a');
ok('punto lejano de la tolerancia: gana la línea', ids(pickFeatures([P, L, pt('far', 50, 80)], [50, 52], project, 12)) === 'line');
ok('dos puntos en el mismo lugar: ambos', ids(pickFeatures([A, pt('b', 52, 51)], [50, 50], project, 12)).split(',').sort().join() === 'a,b');
ok('dos puntos separados: solo el más cercano', ids(pickFeatures([A, pt('c', 60, 50)], [50, 50], project, 16)) === 'a');
ok('nada al alcance', pickFeatures([P, L, A], [300, 300], project, 12).length === 0);
process.exit(fails ? 1 : 0);
