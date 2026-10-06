const BASE = '../src/';
let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const H = await import(BASE + 'hiking.js');
const perfil = (pts) => pts.map(([distance, elevation]) => ({ distance, elevation }));

console.log('== Naismith ==');
{
  const plano = perfil([[0, 1000], [5000, 1000]]);
  ok('5 km en plano, normal = 60 min', cerca(H.walkingTime(plano, 0, 5000, 'normal').minutes, 60, 1e-6));
  const sube = perfil([[0, 0], [5000, 600]]);
  ok('5 km con +600 m, normal = 120 min', cerca(H.walkingTime(sube, 0, 5000, 'normal').minutes, 120, 1e-6));
  const a = H.walkingTime(sube, 0, 5000, 'amateur').minutes;
  const e = H.walkingTime(sube, 0, 5000, 'expert').minutes;
  ok('amateur > normal > expert', a > 120 && e < 120, `${a} ${e}`);
}

console.log('== Langmuir ==');
{
  // 1000 m horizontales, -100 m: 5.7° → bajada suave, más rápida que el plano.
  const suave = perfil([[0, 100], [1000, 0]]);
  const t = H.walkingTime(suave, 0, 1000, 'normal').minutes;
  ok('bajada suave más rápida que el plano', t < 12 && t >= 6, String(t));
  // 1000 m, -400 m: 21.8° → empinada, más lenta que el plano.
  const fuerte = perfil([[0, 400], [1000, 0]]);
  const tf = H.walkingTime(fuerte, 0, 1000, 'normal').minutes;
  ok('bajada empinada más lenta que el plano', cerca(tf, 12 + (400 / 300) * 10, 1e-6), String(tf));
  ok('ida y vuelta no son simétricas',
     !cerca(H.walkingTime(fuerte, 0, 1000).minutes, H.walkingTime(fuerte, 1000, 0).minutes, 1));
  const atras = H.walkingTime(fuerte, 1000, 0);
  ok('hacia atrás sube: cuenta ascenso', cerca(atras.ascent, 400) && cerca(atras.descent, 0));
}

console.log('== bordes ==');
{
  const p = perfil([[0, 0], [100, 10], [200, NaN], [300, 0]]);
  ok('un hueco en medio da null', H.walkingTime(p, 0, 300) === null);
  ok('tramo nulo = 0', H.walkingTime(p, 50, 50).minutes === 0);
  ok('interpola extremos', cerca(H.elevationInterp(p, 50), 5));
  ok('formato', H.formatDuration(85) === '1 h 25 min' && H.formatDuration(0.2) === '<1 min');
}

console.log('== plano ==');
{
  const p = [0, 100, 200].map((d) => ({ distance: d, elevation: 0, lngLat: [d / 1000, 0] }));
  ok('interpola lng/lat', cerca(H.lngLatInterp(p, 150)[0], 0.15));
  const ruta = H.walkPathLngLat(p, 50, 180);
  ok('camino con extremos y vértice', ruta.length === 3 && cerca(ruta[0][0], 0.05) && cerca(ruta[2][0], 0.18));
  ok('hacia atrás invierte', cerca(H.walkPathLngLat(p, 180, 50)[0][0], 0.18));
}

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
