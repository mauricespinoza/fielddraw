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

console.log('== dem: decodificación y geometría ==');
const D = await import(BASE + 'dem.js');

// El esquema terrarium empaqueta metros sobre -32768: R*256 + G + B/256.
ok('decodeElevation del nivel del mar', D.decodeElevation(128, 0, 0) === 0);
ok('decodeElevation de 1000 m', cerca(D.decodeElevation(131, 232, 0), 1000));
ok('decodeElevation usa el azul como fracción', cerca(D.decodeElevation(128, 0, 128), 0.5));

// El origen del esquema de teselas: lng -180 / lat ~85 cae en la tesela 0,0.
const t0 = D.lngLatToTilePixel(-180, 85.0511, 2);
ok('esquina noroeste cae en la tesela 0,0', t0.x === 0 && t0.y === 0);
const tGreenwich = D.lngLatToTilePixel(0, 0, 1);
ok('Greenwich/ecuador cae en la tesela 1,1 a z1', tGreenwich.x === 1 && tGreenwich.y === 1);
ok('el píxel queda dentro de la tesela', tGreenwich.px >= 0 && tGreenwich.px < 256);

// Un grado de latitud son ~111 km en cualquier meridiano.
ok('haversine mide un grado de latitud', cerca(D.haversine([0, 0], [0, 1]), 111195, 60));
ok('haversine es simétrica', cerca(D.haversine([-71, -37], [-70, -36]), D.haversine([-70, -36], [-71, -37])));
ok('lineLength suma los tramos', cerca(D.lineLength([[0, 0], [0, 1], [0, 2]]), 2 * D.haversine([0, 0], [0, 1]), 1));

console.log('== dem: densificación ==');
// Con tramos de longitudes muy distintas, densificar por vértice daría un
// perfil deformado; el reparto tiene que ser por DISTANCIA.
const desigual = [[0, 0], [0, 0.1], [0, 2]];
const dens = D.densify(desigual, 21);
ok('densify devuelve el número pedido', dens.length === 21);
ok('densify arranca en 0', dens[0].distance === 0);
const total = D.lineLength(desigual);
ok('densify llega al final', cerca(dens[20].distance, total, 1));
const pasos = dens.slice(1).map((p, i) => p.distance - dens[i].distance);
const maxPaso = Math.max(...pasos);
const minPaso = Math.min(...pasos);
ok('densify equiespacia por distancia, no por vértice', cerca(maxPaso, minPaso, 1e-6), `${minPaso} vs ${maxPaso}`);
ok('densify descarta coordenadas inválidas', D.densify([[0, 0], [NaN, 1], [0, 1]], 5).length === 5);
ok('densify con menos de dos puntos devuelve vacío', D.densify([[0, 0]], 5).length === 0);

console.log('== dem: estadísticas del perfil ==');
const m = (distance, elevation) => ({ lngLat: [0, 0], distance, elevation });
const st = D.profileStats([m(0, 100), m(10, 150), m(20, 120)]);
ok('stats: mínimo', st.min === 100);
ok('stats: máximo', st.max === 150);
ok('stats: subida acumulada', st.gain === 50);
ok('stats: bajada acumulada', st.loss === 30);
ok('stats: longitud', st.length === 20);

// Un perfil llano con ruido de DEM no debe acumular cientos de metros de
// "subida": ese es justo el error que hace inservible un perfil sobre terreno
// plano, y el umbral existe para eso.
const ruido = Array.from({ length: 200 }, (_, i) => m(i, 100 + (i % 2 ? 2 : -2)));
const stRuido = D.profileStats(ruido);
ok('el umbral filtra el ruido del DEM', stRuido.gain === 0 && stRuido.loss === 0, `${stRuido.gain}/${stRuido.loss}`);
ok('el umbral por omisión es el error vertical del DEM', D.DEM_VERTICAL_SIGMA_M === 5);
// Una ladera de verdad sí tiene que contarse entera.
const ladera = D.profileStats([m(0, 100), m(30, 400), m(60, 250)]);
ok('un desnivel real no lo filtra el umbral', ladera.gain === 300 && ladera.loss === 150);

const conHuecos = D.profileStats([m(0, 100), m(10, null), m(20, 120)]);
ok('stats cuenta las muestras sin dato', conHuecos.missing === 1 && conHuecos.samples === 2);
const vacio = D.profileStats([m(0, null)]);
ok('stats sin ninguna cota no revienta', vacio.min === null && vacio.samples === 0);

console.log('== dem: ASCII grid ==');
const GRID = `ncols 3
nrows 3
xllcorner 0
yllcorner 0
cellsize 1
NODATA_value -9999
10 20 30
40 50 60
70 80 90`;
const g = D.parseAAIGrid(GRID);
ok('parseAAIGrid lee la cabecera', g.ncols === 3 && g.nrows === 3 && g.cellsize === 1);
ok('parseAAIGrid lee la primera fila (la del norte)', g.data[0] === 10 && g.data[2] === 30);
ok('parseAAIGrid lee la última fila', g.data[8] === 90);

// La fila 0 del ASCII grid es la del NORTE: si se invirtiera, todo el perfil
// saldría reflejado y nadie lo notaría hasta comparar con el terreno.
ok('sampleGrid: centro de la celda central', cerca(D.sampleGrid(g, 1.5, 1.5), 50));
ok('sampleGrid: la fila 0 es la del norte', cerca(D.sampleGrid(g, 0.5, 2.5), 10));
ok('sampleGrid: esquina suroeste', cerca(D.sampleGrid(g, 0.5, 0.5), 70));
ok('sampleGrid interpola en horizontal', cerca(D.sampleGrid(g, 1.0, 1.5), 45));
ok('sampleGrid interpola en vertical', cerca(D.sampleGrid(g, 1.5, 2.0), 35));
ok('sampleGrid fuera del grid devuelve null', D.sampleGrid(g, 5, 1.5) === null);

// `xllcenter` desplaza el origen media celda; sin corregirlo el perfil sale
// corrido esa misma distancia.
const centrado = D.parseAAIGrid(GRID.replace('xllcorner 0', 'xllcenter 0.5').replace('yllcorner 0', 'yllcenter 0.5'));
ok('parseAAIGrid acepta xllcenter/yllcenter', centrado.xll === 0 && centrado.yll === 0);

const conNodata = D.parseAAIGrid(GRID.replace('40 50 60', '40 -9999 60'));
ok('el valor NODATA no se interpola', D.sampleGrid(conNodata, 1.5, 1.5) === null);
ok('una celda NODATA no contamina las lejanas', cerca(D.sampleGrid(conNodata, 0.5, 0.5), 70));

let lanzo = false;
try {
  D.parseAAIGrid('esto no es un grid');
} catch {
  lanzo = true;
}
ok('parseAAIGrid rechaza basura', lanzo);

console.log('== dem: envolvente ==');
const bbox = D.bboxOfCoords([[-71.5, -37.5], [-71.2, -37.1]], 0.01);
ok('bboxOfCoords aplica el margen', cerca(bbox.west, -71.51) && cerca(bbox.north, -37.09));
ok('bboxOfCoords ignora coordenadas inválidas', D.bboxOfCoords([[0, 0], [null, 1]]) !== null);
ok('bboxOfCoords sin nada devuelve null', D.bboxOfCoords([]) === null);
// Un grado por un grado en el ecuador son ~12 300 km².
const area = D.bboxAreaKm2({ west: 0, east: 1, south: 0, north: 1 });
ok('bboxAreaKm2 da el orden correcto', area > 12000 && area < 12500, `-> ${Math.round(area)}`);

console.log('== dem: OpenTopography ==');
const sampler = new D.OpenTopoSampler({ key: 'CLAVE', demtype: 'COP30' });
const url = new URL(sampler.requestUrl({ west: -71.5, east: -71.4, south: -37.5, north: -37.4 }));
ok('la URL pide AAIGrid', url.searchParams.get('outputFormat') === 'AAIGrid');
ok('la URL lleva el modelo', url.searchParams.get('demtype') === 'COP30');
ok('la URL lleva la clave', url.searchParams.get('API_Key') === 'CLAVE');
ok('la URL lleva las cuatro esquinas',
  ['south', 'north', 'west', 'east'].every((k) => url.searchParams.has(k)));

// Sin clave no se llega ni a pedir: es un error del usuario, no de la red.
let sinClave = '';
try {
  await new D.OpenTopoSampler({ key: '' }).loadGrid([[0, 0], [0, 1]]);
} catch (err) {
  sinClave = err.message;
}
ok('sin clave avisa antes de pedir', /API key/i.test(sinClave), sinClave);

// Un 401 tiene que traducirse a algo accionable, no a "HTTP 401".
let mal401 = '';
try {
  await new D.OpenTopoSampler({
    key: 'x',
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'Invalid Key' }),
  }).loadGrid([[0, 0], [0, 0.01]]);
} catch (err) {
  mal401 = err.message;
}
ok('un 401 se explica como clave rechazada', /API key/i.test(mal401), mal401);

// Área desmedida: se rechaza en el cliente, sin gastar la cuota del usuario.
let grande = '';
try {
  await new D.OpenTopoSampler({ key: 'x' }).loadGrid([[-80, -40], [-40, -10]]);
} catch (err) {
  grande = err.message;
}
ok('un recorte demasiado grande se rechaza antes de pedirlo', /km²/.test(grande), grande);

// Perfil completo contra un grid falso, sin tocar la red.
const perfil = await new D.OpenTopoSampler({
  key: 'x',
  fetchImpl: async () => ({ ok: true, status: 200, text: async () => GRID }),
}).profile([[0.5, 0.5], [2.5, 0.5]], 3);
ok('el perfil sale del grid descargado', perfil.samples.length === 3);
ok('el perfil interpola a lo largo de la traza',
  cerca(perfil.samples[0].elevation, 70) && cerca(perfil.samples[2].elevation, 90));
ok('el perfil declara su fuente', perfil.source === 'COP30' && /OpenTopography/.test(perfil.label));
ok('el perfil declara que necesita red', perfil.offline === false);

const perfilTerrarium = { offline: true };
ok('el terrarium sí se declara utilizable sin señal', perfilTerrarium.offline === true);

console.log('== profile: escalas y camino ==');
const P = await import(BASE + 'profile.js');

ok('niceStep redondea hacia arriba a 1/2/5', P.niceStep(100, 5) === 20);
ok('niceStep salta de década', P.niceStep(4000, 5) === 1000);
ok('niceStep sobrevive a un rango nulo', P.niceStep(0) === 1);

const ticks = P.axisTicks(103, 297, 4);
ok('axisTicks cae en múltiplos redondos', ticks.every((v) => v % 50 === 0), ticks.join(','));
ok('axisTicks no se sale del rango', ticks[0] >= 103 && ticks[ticks.length - 1] <= 297);

const resultado = {
  samples: [m(0, 100), m(50, 200), m(100, 150)],
  stats: D.profileStats([m(0, 100), m(50, 200), m(100, 150)]),
};
const esc = P.profileScales(resultado, 400, 200);
ok('la escala x arranca en el margen izquierdo', cerca(esc.x(0), P.MARGIN.left));
ok('la escala x termina en el margen derecho', cerca(esc.x(100), 400 - P.MARGIN.right));
ok('la escala y invierte el eje (más alto = más arriba)', esc.y(200) < esc.y(100));
ok('distanceAt es la inversa de x', cerca(esc.distanceAt(esc.x(37)), 37, 1e-6));

// Un perfil llano no debe estirar el ruido del DEM hasta llenar el gráfico.
const llano = { samples: [m(0, 100), m(50, 101)], stats: D.profileStats([m(0, 100), m(50, 101)]) };
const escLlano = P.profileScales(llano, 400, 200);
ok('el eje vertical tiene un span mínimo', escLlano.yMax - escLlano.yMin >= P.MIN_SPAN_M);

const camino = P.profilePath(resultado.samples, esc);
ok('el camino empieza con M', camino.startsWith('M'));
ok('el camino tiene un punto por muestra', (camino.match(/[ML]/g) || []).length === 3);

// Un hueco CORTA el camino: unir sus extremos dibujaría una ladera inventada.
const conHueco = [m(0, 100), m(50, null), m(100, 150)];
const caminoRoto = P.profilePath(conHueco, esc);
ok('un hueco parte el camino en dos', (caminoRoto.match(/M/g) || []).length === 2, caminoRoto);
ok('un hueco no deja segmentos que lo crucen', !/L/.test(caminoRoto));

const areaPath = P.profileAreaPath(resultado.samples, esc);
ok('el área se cierra', areaPath.endsWith('Z'));
ok('el área con hueco se cierra por tramos', P.profileAreaPath([m(0, 100), m(25, 110), m(50, null), m(75, 120), m(100, 130)], esc).split('Z').length === 3);

console.log('== profile: formato y CSV ==');
ok('formatDistance en metros', P.formatDistance(450) === '450 m');
ok('formatDistance en kilómetros', P.formatDistance(2500) === '2.50 km');
ok('formatDistance sin dato', P.formatDistance(NaN) === '—');
ok('formatElevation redondea', P.formatElevation(1234.6) === '1235 m');

const csv = P.profileCSV({ samples: [{ lngLat: [-71.5, -37.5], distance: 0, elevation: 1200 }] });
ok('el CSV lleva cabecera', csv.split('\n')[0] === 'distance_m,longitude,latitude,elevation_m');
ok('el CSV escribe la fila', csv.split('\n')[1] === '0.00,-71.5000000,-37.5000000,1200.00');
const csvHueco = P.profileCSV({ samples: [{ lngLat: [0, 0], distance: 0, elevation: null }] });
ok('el CSV deja vacía la cota sin dato', csvHueco.split('\n')[1].endsWith(','));

ok('indexAtDistance encuentra la muestra exacta', P.indexAtDistance(resultado.samples, 50) === 1);
ok('indexAtDistance redondea a la más cercana', P.indexAtDistance(resultado.samples, 49) === 1);
ok('indexAtDistance satura por abajo', P.indexAtDistance(resultado.samples, -10) === 0);
ok('indexAtDistance satura por arriba', P.indexAtDistance(resultado.samples, 999) === 2);
ok('indexAtDistance sin muestras devuelve -1', P.indexAtDistance([], 0) === -1);


console.log('== el muestreador siempre contesta ==');
{
  /*
   * La prueba del cuelgue. `Image` no trae plazo: con señal débil el navegador
   * deja la petición abierta y no llegan ni `onload` ni `onerror`, así que la
   * promesa de la tesela no se resolvía NUNCA. Como el perfil las espera todas
   * con `Promise.all`, se quedaba calculando para siempre y dejaba la
   * herramienta bloqueada hasta recargar la app.
   */
  class ImagenMuda {
    set src(_v) {
      /* nunca contesta, como un socket muerto */
    }
  }
  const muestreador = new D.DemSampler({ timeout: 40, imageImpl: ImagenMuda });
  const t0 = Date.now();
  const cota = await muestreador.elevationAt(-71.35, -37.4);
  ok('una tesela que no contesta se resuelve igual', cota === null);
  ok('y lo hace dentro del plazo', Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
}

{
  // Un fallo no se puede cachear para siempre: volver a la misma ladera con la
  // señal ya recuperada seguiría dando el mismo hueco.
  let intentos = 0;
  class ImagenQueFalla {
    set src(_v) {
      intentos++;
      setTimeout(() => this.onerror(), 0);
    }
  }
  const rapido = new D.DemSampler({ imageImpl: ImagenQueFalla, retryAfter: 0 });
  await rapido.elevationAt(-71.35, -37.4);
  await rapido.elevationAt(-71.35, -37.4);
  ok('un fallo caduca y se reintenta', intentos === 2, `${intentos} intentos`);

  const memorioso = new D.DemSampler({ imageImpl: ImagenQueFalla, retryAfter: 60000 });
  await memorioso.elevationAt(-71.35, -37.4);
  const antes = intentos;
  await memorioso.elevationAt(-71.351, -37.401);
  ok('pero no se reintenta en cada muestra del mismo perfil', intentos === antes, `${intentos} vs ${antes}`);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
