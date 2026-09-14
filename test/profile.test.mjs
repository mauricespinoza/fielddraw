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

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
