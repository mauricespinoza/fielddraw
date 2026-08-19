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

const S = await import(BASE + 'scale.js');

console.log('== zoom <-> denominador ==');
// La ida y la vuelta tienen que cerrar: si no, elegir 1:25.000 dejaría el mapa
// a otra escala y la propia lectura lo desmentiría.
for (const d of [1000, 25000, 100000]) {
  for (const lat of [0, -37.4, 60]) {
    const z = S.zoomFor(d, lat);
    ok(`1:${d} a ${lat}° cierra`, cerca(S.denominatorFor(z, lat), d, 1e-6 * d));
  }
}

// Un nivel de zoom es un factor dos de escala, en cualquier latitud.
ok('un zoom más es la mitad del denominador', cerca(
  S.denominatorFor(14, -37.4) * 2,
  S.denominatorFor(13, -37.4),
  1e-9,
));

// La latitud comprime la escala: el mismo zoom en Ñuble no es el mismo que en
// el ecuador, y es la razón de que la escala fijada haya que mantenerla.
ok('la latitud reduce el denominador', S.denominatorFor(13, -37.4) < S.denominatorFor(13, 0));

console.log('== medida empírica ==');
// El camino que usa el mapa: metros por píxel medidos sobre el propio mapa.
ok('0,28 mm por píxel a 7 m/px son 1:25.000', cerca(S.denominatorFromMpp(7), 25000, 1));
ok('el píxel supuesto escala el resultado', cerca(
  S.denominatorFromMpp(7, 0.14),
  2 * S.denominatorFromMpp(7, 0.28),
  1e-9,
));
ok('un zoom de diferencia entre 1:50.000 y 1:25.000', cerca(S.zoomDelta(50000, 25000), 1));
ok('sin cambio no hay salto', S.zoomDelta(25000, 25000) === 0);

console.log('== escritura y lectura ==');
ok('formato con separador fino', S.formatScale(25000) === '1:25\u2009000');
ok('formato de una escala corta', S.formatScale(500) === '1:500');
ok('formato de algo que no es escala', S.formatScale(NaN) === '—');

for (const [texto, esperado] of [
  ['25000', 25000],
  ['1:25000', 25000],
  ['1:25 000', 25000],
  ['25.000', 25000],
  ['25,000', 25000],
  ['1:25\u2009000', 25000],
  ['25k', 25000],
  ['  1 / 50000 ', 50000],
]) {
  ok(`lee "${texto}"`, S.parseScale(texto) === esperado, String(S.parseScale(texto)));
}
ok('rechaza lo que no es una escala', S.parseScale('mil') === null);
ok('rechaza el vacío', S.parseScale('') === null);
ok('satura por abajo', S.parseScale('1') === S.MIN_SCALE);

console.log('== redondeo a escala de mapeo ==');
// Fijar el accidente de dónde quedó el zoom no es fijar una escala de trabajo.
ok('37.412 redondea a 50.000', S.niceScale(37412) === 50000, String(S.niceScale(37412)));
ok('23.000 redondea a 25.000', S.niceScale(23000) === 25000, String(S.niceScale(23000)));
ok('9.800 redondea a 10.000', S.niceScale(9800) === 10000, String(S.niceScale(9800)));
ok('una escala ya redonda se queda', S.niceScale(50000) === 50000);

console.log('== lista de escalas ==');
ok('ordena y quita repetidas', S.sanitizeScales([50000, 1000, 50000, 25000]).join() === '1000,25000,50000');
ok('acepta texto', S.sanitizeScales(['1:10 000', '25k']).join() === '10000,25000');
ok('descarta la basura', S.sanitizeScales(['x', null, 5000]).join() === '5000');
ok('una lista vacía vuelve a la de fábrica', S.sanitizeScales([]).join() === S.DEFAULT_SCALES.join());
ok('lo que no es lista vuelve a la de fábrica', S.sanitizeScales(null).join() === S.DEFAULT_SCALES.join());

console.log('== deriva de la escala fijada ==');
// Medio por ciento: por debajo, corregir sería un temblor y no una corrección.
ok('un 0,3 % no cuenta como deriva', S.scaleDrifted(25075, 25000) === false);
ok('un 2 % sí', S.scaleDrifted(25500, 25000) === true);
ok('sin objetivo no hay deriva', S.scaleDrifted(25000, NaN) === false);

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
