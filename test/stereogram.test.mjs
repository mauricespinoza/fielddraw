const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const S = await import(BASE + 'stereogram.js');

console.log('== polo de un plano ==');

// Ejemplo de libro de texto: rumbo N-S (000°), mantea 30° al Este (090°) ->
// polo en 270°(W) / 60°. Es el caso que trae cualquier manual de geología
// estructural para comprobar a mano que la fórmula del polo está bien.
const p1 = S.poleOf(0, 30);
ok('trend del polo a 270°', cerca(p1.trend, 270), `${p1.trend}`);
ok('plunge del polo a 60°', cerca(p1.plunge, 60), `${p1.plunge}`);

// Un plano horizontal no tiene dirección de manteo: su polo cae vertical, en
// el centro exacto de la red — cualquier rumbo produce el mismo punto.
const horiz = S.poleOf(45, 0);
ok('manteo 0 -> polo vertical (plunge 90)', cerca(horiz.plunge, 90));
const c0 = S.schmidtPoint(horiz.trend, horiz.plunge, 100);
ok('...que proyecta al centro', cerca(Math.hypot(c0.x, c0.y), 0, 1e-9));

// Un plano vertical mantea 90°: su polo es horizontal (plunge 0) y cae sobre
// el círculo primitivo (r = R).
const vert = S.poleOf(0, 90);
ok('manteo 90 -> polo horizontal (plunge 0)', cerca(vert.plunge, 0));
const cv = S.schmidtPoint(vert.trend, vert.plunge, 100);
ok('...que proyecta sobre el círculo primitivo', cerca(Math.hypot(cv.x, cv.y), 100, 1e-6));

console.log('== punto ploteable ==');

// `stereogramPoint` tiene que entregar YA la posición cartesiana (x, y) y no
// solo el polo en polares — es justo el paso que se le olvidó a la primera
// versión, y `renderStereogram` lo descubrió pintando círculos en NaN.
const punto = S.stereogramPoint({
  properties: { id: 'x1', geomKind: 'measurement', type: 'bedding', strike: 0, dip: 30 },
});
ok('trae x/y numéricos', Number.isFinite(punto.x) && Number.isFinite(punto.y), JSON.stringify(punto));
ok('coincide con schmidtPoint del mismo polo', (() => {
  const xy = S.schmidtPoint(punto.trend, punto.plunge, 1);
  return cerca(xy.x, punto.x) && cerca(xy.y, punto.y);
})());

console.log('== selección de datos ==');

const medida = (id, type, strike, dip) => ({
  type: 'Feature',
  properties: { id, geomKind: 'measurement', type, strike, dip },
  geometry: { type: 'Point', coordinates: [0, 0] },
});
const features = [
  medida('a', 'bedding', 10, 20),
  medida('b', 'joint', 100, 80),
  medida('c', 'bedding', 200, 40),
];

const sinSeleccion = S.stereogramData(features, []);
ok('sin selección, entran todas', sinSeleccion.points.length === 3);
ok('...y lo dice', sinSeleccion.usingSelection === false);

const conSeleccion = S.stereogramData(features, ['a', 'c']);
ok('con selección, solo las elegidas', conSeleccion.points.length === 2);
ok('...y lo dice', conSeleccion.usingSelection === true);

const counts = S.countsByType(sinSeleccion.points);
ok('cuenta por tipo', counts.get('bedding') === 2 && counts.get('joint') === 1);

console.log(fails ? `\n${fails} FALLADAS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
