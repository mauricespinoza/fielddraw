/**
 * La parte calculable de la figura del perfil.
 *
 * Lo que se dibuja necesita un DOM y se comprueba en `test/browser.html`; aquí
 * va lo que decide QUÉ dice la figura, que es donde puede mentir sin que se
 * note: la orientación de la traza y la exageración vertical rotulada.
 */

const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

const P = await import(BASE + 'profile.js');

console.log('== rótulos de los extremos ==');
ok('el norte es N', P.endLabel(0) === 'N');
ok('el este es E', P.endLabel(90) === 'E');
ok('357° sigue siendo N', P.endLabel(357) === 'N');
ok('un azimut negativo se normaliza', P.endLabel(-90) === 'W');
ok('y uno mayor que la vuelta también', P.endLabel(450) === 'E');

console.log('== orientación de la traza ==');
const muestras = (pares) =>
  pares.map(([lng, lat], i) => ({ distance: i * 100, lngLat: [lng, lat], elevation: 100 + i }));

// Una traza que va hacia el este tiene que rotularse W a la izquierda y E a la
// derecha: al revés, la figura sale con el norte al sur y nadie lo nota hasta
// que intenta correlacionar con el mapa.
const alEste = P.traceAzimuth(muestras([[-71.6, -37.2], [-71.2, -37.2]]));
ok('de oeste a este da ~90°', Math.abs(alEste - 90) < 1, String(alEste));
ok('y el extremo izquierdo se rotula W', P.endLabel(alEste + 180) === 'W');

const alNorte = P.traceAzimuth(muestras([[-71.4, -37.6], [-71.4, -37.0]]));
ok('de sur a norte da ~0°', Math.abs(alNorte) < 1 || Math.abs(alNorte - 360) < 1, String(alNorte));

ok('una traza de un solo punto no revienta', Number.isFinite(P.traceAzimuth(muestras([[-71.4, -37.2]]))));
ok('ni una vacía', Number.isFinite(P.traceAzimuth([])));

console.log('== exageración vertical ==');
/*
 * El caso que hay que atrapar: 10 km de recorrido con 500 m de desnivel en un
 * gráfico apaisado. Sin rotularlo, cualquiera mide la pendiente sobre la
 * figura y se lleva un número que no existe en el terreno.
 */
const resultado = {
  samples: muestras([[-71.5, -37.2], [-71.4, -37.2]]),
  stats: { min: 0, max: 500, length: 10000, gain: 500, loss: 0, samples: 2 },
};
resultado.samples[1].distance = 10000;
const s = P.profileScales(resultado, 1000, 400);
const ve = P.verticalExaggeration(s);
// A lo ancho ~10,6 m/px; a lo alto ~1,6 m/px (el eje se abre un 8 % arriba y
// abajo). El factor sale cerca de 7, y lo que importa es que sea > 1 y estable.
ok('un perfil apaisado sale exagerado', ve > 5 && ve < 9, String(ve));

const cuadrado = P.verticalExaggeration({ total: 1000, yMin: 0, yMax: 1000, plotW: 500, plotH: 500 });
ok('a escala 1:1 el factor es 1', Math.abs(cuadrado - 1) < 1e-9, String(cuadrado));
ok('sin recorrido no hay factor', Number.isNaN(P.verticalExaggeration({ total: 0, yMin: 0, yMax: 1, plotW: 1, plotH: 1 })));

{
  const samples = [0, 1000, 2000, 3000, 4000].map((d, i) => ({ distance: d, elevation: 1000 + i * 100 }));
  const r = { samples, stats: { min: 1000, max: 1400 } };
  for (const ve of [1, 3]) {
    const w = 800;
    const h = P.profileHeightFor(r, w, ve);
    const got = P.verticalExaggeration(P.profileScales(r, w, h));
    ok(`profileHeightFor da V.E. ${ve}`, Math.abs(got - ve) < 0.05, String(got));
  }
}

console.log('== pendiente local y media ==');
{
  // 100 m de avance: plano, +100 m (45°), hueco, −10 m (≈5.7°).
  const samples = [
    { distance: 0, elevation: 500 },
    { distance: 100, elevation: 500 },
    { distance: 200, elevation: 600 },
    { distance: 300, elevation: NaN },
    { distance: 400, elevation: 600 },
    { distance: 500, elevation: 590 },
  ];
  const g = P.segmentSlopes(samples);
  ok('un tramo por par de muestras', g.length === 5);
  ok('plano da 0°', g[0] === 0);
  ok('subir lo mismo que se avanza da 45°', Math.abs(g[1] - 45) < 1e-4);
  ok('un tramo que toca un hueco no tiene pendiente', Number.isNaN(g[2]) && Number.isNaN(g[3]));
  ok('bajar también es pendiente (positiva)', Math.abs(g[4] - 5.7106) < 1e-3, String(g[4]));
  ok('clases: <2 es la 0', P.slopeClass(0) === 0 && P.slopeClass(1.9) === 0);
  ok('clases: 45° es la última', P.slopeClass(45) === P.SLOPE_COLORS.length - 1);
  ok('un color por clase', P.SLOPE_COLORS.length === P.SLOPE_BREAKS.length + 1);
  const m = P.meanSlope(samples);
  // desnivel acumulado 110 m sobre 300 m con dato
  ok('pendiente media = desnivel acumulado / distancia con dato', Math.abs(m.percent - (110 / 300) * 100) < 1e-9, String(m.percent));
  ok('y su ángulo', Math.abs(m.degrees - (Math.atan(110 / 300) * 180) / Math.PI) < 1e-9);
  ok('sin dato no hay pendiente media', P.meanSlope([{ distance: 0, elevation: NaN }]) === null);
  const s = { x: (d) => d, y: (z) => z };
  const paths = P.profileSlopePaths(samples, s, g);
  ok('un camino por clase', paths.length === P.SLOPE_COLORS.length);
  ok('el tramo plano va en la clase fría', paths[0].startsWith('M0.00 500.00L100.00 500.00'));
  ok('el de 45° en la más cálida', paths[P.SLOPE_COLORS.length - 1] === 'M100.00 500.00L200.00 600.00');
  ok('el hueco no se une', !paths.join('').includes('L300'));
  const n = paths.filter(Boolean).length;
  ok('solo las clases presentes llevan trazo', n === 3, String(n));
  ok('la leyenda tiene un rótulo por color', P.slopeLegend().length === P.SLOPE_COLORS.length);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
