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

console.log('== tamaño de la pantalla ==');
/*
 * Las cifras de contraste salen de fichas técnicas reales, no de la propia
 * fórmula: un test que se comprueba contra sí mismo no comprueba nada.
 *
 *   - portátil de 15,6" a 1920×1080 → 141 ppp → 0,180 mm el píxel;
 *   - iPad Pro de 11" → 264 ppp físicos, y como el navegador da píxeles CSS a
 *     2×, el píxel CSS son 132 ppp → 0,192 mm. Por eso se pasa 834×1194, que
 *     es la resolución CSS y no la del panel.
 */
ok(
  'un 15,6" a 1920×1080 da un píxel de 0,180 mm',
  Math.abs(S.pixelMmFromDiagonal(15.6, 1920, 1080) - 0.18) < 0.002,
  String(S.pixelMmFromDiagonal(15.6, 1920, 1080)),
);
ok(
  'un iPad Pro de 11" da 0,192 mm en píxeles CSS',
  Math.abs(S.pixelMmFromDiagonal(11, 834, 1194) - 0.192) < 0.002,
  String(S.pixelMmFromDiagonal(11, 834, 1194)),
);
ok('sin diagonal no hay cálculo', S.pixelMmFromDiagonal(0, 1920, 1080) === null);
ok('sin resolución tampoco', S.pixelMmFromDiagonal(15.6, 0, 1080) === null);
ok('ni con basura', S.pixelMmFromDiagonal('grande', 1920, 1080) === null);

// La vuelta tiene que devolver la diagonal de partida: es lo que permite que
// el desplegable marque solo el tamaño que corresponde al píxel en uso.
ok(
  'la diagonal se recupera del píxel',
  Math.abs(S.diagonalFromPixelMm(S.pixelMmFromDiagonal(15.6, 1920, 1080), 1920, 1080) - 15.6) < 0.05,
);

console.log('== calibración con regla ==');
// La barra dice medir 100 mm y la regla lee 112: el píxel es un 12 % mayor.
ok(
  'una barra que mide de más agranda el píxel',
  S.calibratePixelMm(0.28, 112, 100) === 0.314,
  String(S.calibratePixelMm(0.28, 112, 100)),
);
ok('medir lo declarado no cambia nada', S.calibratePixelMm(0.28, 100, 100) === 0.28);
ok('con otro nominal también', S.calibratePixelMm(0.2, 40, 80) === 0.1);
ok('una lectura imposible se rechaza', S.calibratePixelMm(0.28, 1000, 100) === null);
ok('y una lectura de cero también', S.calibratePixelMm(0.28, 0, 100) === null);

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
