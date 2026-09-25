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

console.log('== vector medio de un cúmulo de polos ==');

// `strikeDipFromPole` es el inverso exacto de `poleOf`: ida y vuelta sobre
// varios rumbos y manteos.
for (const [strike, dip] of [[0, 30], [137, 52], [270, 5], [10, 88]]) {
  const polo = S.poleOf(strike, dip);
  const vuelta = S.strikeDipFromPole(polo.trend, polo.plunge);
  ok(`ida y vuelta ${strike}/${dip}: mismo rumbo`, cerca(vuelta.strike, strike), `${vuelta.strike}`);
  ok(`ida y vuelta ${strike}/${dip}: mismo manteo`, cerca(vuelta.dip, dip), `${vuelta.dip}`);
}

// Un cúmulo de polos IDÉNTICOS promedia exactamente a ese mismo rumbo y
// manteo, con la máxima concentración posible (r = 1).
{
  const iguales = [
    S.stereogramPoint({ properties: { id: 'a', type: 'bedding', strike: 40, dip: 30 } }),
    S.stereogramPoint({ properties: { id: 'b', type: 'bedding', strike: 40, dip: 30 } }),
    S.stereogramPoint({ properties: { id: 'c', type: 'bedding', strike: 40, dip: 30 } }),
  ];
  const mp = S.meanPole(iguales);
  ok('polos idénticos: el promedio es el mismo rumbo', cerca(mp.strike, 40));
  ok('polos idénticos: el mismo manteo', cerca(mp.dip, 30));
  ok('polos idénticos: concentración máxima', cerca(mp.r, 1, 1e-9));
  ok('trae la cuenta de cuántos polos entraron', mp.n === 3);
}

// Un cúmulo APRETADO alrededor de un rumbo/manteo promedia cerca de él, con
// una concentración alta pero no exactamente 1.
{
  const cerca4 = [
    S.stereogramPoint({ properties: { id: 'a', type: 'bedding', strike: 35, dip: 28 } }),
    S.stereogramPoint({ properties: { id: 'b', type: 'bedding', strike: 45, dip: 32 } }),
    S.stereogramPoint({ properties: { id: 'c', type: 'bedding', strike: 38, dip: 31 } }),
    S.stereogramPoint({ properties: { id: 'd', type: 'bedding', strike: 42, dip: 29 } }),
  ];
  const mp = S.meanPole(cerca4);
  ok('cúmulo apretado: rumbo cerca del centro', Math.abs(mp.strike - 40) < 2, `${mp.strike}`);
  ok('cúmulo apretado: manteo cerca del centro', Math.abs(mp.dip - 30) < 2, `${mp.dip}`);
  ok('cúmulo apretado: concentración alta pero no perfecta', mp.r > 0.99 && mp.r < 1);
}

// Sin polos no hay promedio que dar.
ok('sin datos, no hay vector medio', S.meanPole([]) === null);

// Trae ya la posición proyectada, como cualquier otro punto ploteable.
{
  const uno = [S.stereogramPoint({ properties: { id: 'a', type: 'bedding', strike: 90, dip: 45 } })];
  const mp = S.meanPole(uno);
  ok('un solo polo: el vector medio es ese mismo punto', cerca(mp.x, uno[0].x) && cerca(mp.y, uno[0].y));
}

console.log('== cono de confianza de Fisher (alpha95) ==');

{
  // Un cúmulo casi idéntico apenas se abre: alpha95 chico y k grande.
  const apretado = [[35, 28], [45, 32], [38, 31], [42, 29], [40, 30], [39, 29]].map(([s, d], i) =>
    S.stereogramPoint({ properties: { id: `a${i}`, type: 'bedding', strike: s, dip: d } }));
  const mp = S.meanPole(apretado);
  ok('cúmulo apretado: alpha95 menor a 5°', mp.alpha95 < 5, `${mp.alpha95}`);
  ok('cúmulo apretado: k grande', mp.k > 100, `${mp.k}`);

  // Un cúmulo repartido por toda la red: alpha95 grande, k chico.
  const disperso = [[0, 10], [90, 80], [180, 40], [270, 60], [45, 20], [300, 70]].map(([s, d], i) =>
    S.stereogramPoint({ properties: { id: `b${i}`, type: 'bedding', strike: s, dip: d } }));
  const mpDisperso = S.meanPole(disperso);
  ok('cúmulo disperso: alpha95 mayor a 30°', mpDisperso.alpha95 > 30, `${mpDisperso.alpha95}`);
  ok('cúmulo disperso: k chico', mpDisperso.k < apretado.length, `${mpDisperso.k}`);

  // Con menos de 3 polos no hay de dónde sacar una dispersión.
  const dos = [S.stereogramPoint({ properties: { id: 'x', type: 'bedding', strike: 0, dip: 30 } }),
    S.stereogramPoint({ properties: { id: 'y', type: 'bedding', strike: 10, dip: 32 } })];
  ok('menos de 3 polos: alpha95 no definido', Number.isNaN(S.meanPole(dos).alpha95));

  // Polos exactamente idénticos: concentración máxima, cono cerrado a 0°.
  const iguales = [
    S.stereogramPoint({ properties: { id: 'p', type: 'bedding', strike: 10, dip: 20 } }),
    S.stereogramPoint({ properties: { id: 'q', type: 'bedding', strike: 10, dip: 20 } }),
    S.stereogramPoint({ properties: { id: 'r', type: 'bedding', strike: 10, dip: 20 } }),
  ];
  const mpIguales = S.meanPole(iguales);
  ok('polos idénticos: cono cerrado a 0°', mpIguales.alpha95 === 0, `${mpIguales.alpha95}`);
  ok('polos idénticos: k infinito', mpIguales.k === Infinity);
}

console.log('== eje beta (eje de pliegue) ==');

{
  // Dos planos de un "diagrama beta" clásico: su eje es la intersección,
  // perpendicular a los dos polos a la vez.
  const dosPlanos = [
    S.stereogramPoint({ properties: { id: 'a', type: 'bedding', strike: 0, dip: 40 } }),
    S.stereogramPoint({ properties: { id: 'b', type: 'bedding', strike: 90, dip: 40 } }),
  ];
  const beta = S.betaAxis(dosPlanos);
  const v = S.lineVector(beta.trend, beta.plunge);
  for (const f of dosPlanos) {
    const pv = S.lineVector(f.trend, f.plunge);
    const dot = Math.abs(v.x * pv.x + v.y * pv.y + v.z * pv.z);
    ok('el eje beta es perpendicular a cada polo', dot < 1e-6, `${dot}`);
  }
  // El AJUSTE del cinturón (`girdle`, el índice G de Vollmer) es una cuenta
  // distinta de si el eje da perpendicular a los polos: dos polos SIEMPRE
  // caen justo en un círculo máximo —cualesquiera dos puntos de la esfera lo
  // hacen—, pero cuánto lo respalda ESE círculo en particular depende de qué
  // tan repartidos estén a lo largo de él. Con dos polos ORTOGONALES entre
  // sí —el reparto máximo posible para solo dos puntos— el ajuste es
  // perfecto; con los de este par, separados 90°.68 en vez de 90°+algo más
  // parejo, sale un ajuste bueno pero no perfecto — se prueba el caso
  // perfecto aparte, con dos polos exactamente ortogonales.
  ok('con dos planos, el ajuste no es cero', beta.girdle > 0.3, `${beta.girdle}`);

  const sdOrtogonal1 = S.strikeDipFromPole(0, 0); // polo horizontal, apuntando al norte
  const sdOrtogonal2 = S.strikeDipFromPole(0, 90); // polo vertical
  const ortogonales = [
    S.stereogramPoint({ properties: { id: 'o1', type: 'bedding', strike: sdOrtogonal1.strike, dip: sdOrtogonal1.dip } }),
    S.stereogramPoint({ properties: { id: 'o2', type: 'bedding', strike: sdOrtogonal2.strike, dip: sdOrtogonal2.dip } }),
  ];
  ok('dos polos ortogonales: ajuste perfecto', cerca(S.betaAxis(ortogonales).girdle, 1, 1e-6));

  // Un cinturón horizontal (polos todos con plunge 0): el eje del pliegue es
  // vertical, la normal de ese cinturón.
  const horizontal = [0, 30, 60, 90, 120, 150, 200, 250, 300].map((t) =>
    S.stereogramPoint({ properties: { id: `h${t}`, type: 'bedding', strike: t, dip: 90 } }));
  const betaVert = S.betaAxis(horizontal);
  ok('cinturón horizontal: eje vertical', cerca(betaVert.plunge, 90, 1e-6), `${betaVert.plunge}`);
  ok('cinturón horizontal: cinturón bien ajustado', betaVert.girdle > 0.85, `${betaVert.girdle}`);

  // Un cúmulo apretado (sin fábrica de cinturón) da un ajuste pobre: el eje
  // que sale no significa nada y `girdle` tiene que decirlo.
  const apretado = [[35, 28], [45, 32], [38, 31], [42, 29]].map(([s, d], i) =>
    S.stereogramPoint({ properties: { id: `c${i}`, type: 'bedding', strike: s, dip: d } }));
  ok('cúmulo apretado: mal ajuste de cinturón', S.betaAxis(apretado).girdle < 0.5, `${S.betaAxis(apretado).girdle}`);

  ok('con menos de 2 polos, no hay eje que calcular', S.betaAxis([S.stereogramPoint({ properties: { id: 'z', type: 'bedding', strike: 0, dip: 10 } })]) === null);
}

console.log('== ciclogramas ==');

const radio = (p) => Math.hypot(p.x, p.y);

// El ciclograma de un plano 000/30E tiene que tocar el círculo primitivo
// justo en N y en S —los dos extremos de su línea de rumbo— y alejarse del
// centro hacia el Este, al punto que ocupa su línea de máxima pendiente.
{
  const arco = S.greatCirclePath(0, 30).flat();
  const este = arco.reduce((a, b) => (b.x > a.x ? b : a));
  ok('el ciclograma pasa por la línea de máxima pendiente',
    cerca(este.x, Math.SQRT2 * Math.sin(Math.PI / 12 * 2), 1e-4) && cerca(este.y, 0, 1e-6),
    `${este.x}, ${este.y}`);
  const norte = arco.reduce((a, b) => (b.y < a.y ? b : a));
  const sur = arco.reduce((a, b) => (b.y > a.y ? b : a));
  ok('y acaba en los dos extremos del rumbo, sobre el primitivo',
    cerca(radio(norte), 1, 1e-6) && cerca(radio(sur), 1, 1e-6) && cerca(norte.x, 0, 1e-6) && cerca(sur.x, 0, 1e-6));
  ok('ningún punto se sale de la red', arco.every((p) => radio(p) <= 1 + 1e-9));
}

// Un plano vertical proyecta como un diámetro recto en la dirección de su
// rumbo: todos sus puntos caen sobre esa recta.
{
  const arco = S.greatCirclePath(45, 90).flat();
  const fuera = arco.filter((p) => Math.abs(p.x + p.y) > 1e-6); // recta NE-SW: y = -x
  ok('un plano vertical es un diámetro recto', fuera.length === 0, `${fuera.length} fuera de la recta`);
  ok('...de extremo a extremo del primitivo',
    cerca(Math.max(...arco.map(radio)), 1, 1e-6));
}

// El polo de un plano está siempre a 90° de cualquier línea contenida en él:
// es la comprobación que liga las dos cosas que se dibujan en la red y la que
// detectaría que una de las dos se calculó con otro convenio.
{
  const polo = S.poleOf(137, 52);
  const v = S.lineVector(polo.trend, polo.plunge);
  const RADIANES = Math.PI / 180;
  const arco = S.smallCircleSegments(v, 90, { steps: 60 }).flat();
  // Se reconstruye la dirección 3D de cada punto proyectado y se mide su
  // ángulo con el polo: la proyección equiareal es invertible.
  const angulos = arco.map((p) => {
    const r = Math.min(1, radio(p));
    const theta = 2 * Math.asin(r / Math.SQRT2);
    const trend = Math.atan2(p.x, -p.y);
    const plunge = Math.PI / 2 - theta;
    const l = S.lineVector(trend / RADIANES, plunge / RADIANES);
    return Math.abs(Math.acos(Math.max(-1, Math.min(1, l.x * v.x + l.y * v.y + l.z * v.z))) / RADIANES);
  });
  ok('todo el ciclograma está a 90° de su polo',
    angulos.every((a) => Math.abs(a - 90) < 1e-6), `máx desvío ${Math.max(...angulos.map((a) => Math.abs(a - 90)))}`);
}

console.log('== la red de Schmidt ==');

{
  const net = S.schmidtNet({ step: 10 });
  ok('trae las dos familias', net.great.length > 0 && net.small.length > 0);
  const todos = [...net.great, ...net.small].flat();
  ok('nada se sale del primitivo', todos.every((p) => radio(p) <= 1 + 1e-9));

  /*
   * LO QUE NO PUEDE TENER: radios. La red anterior dibujaba seis diámetros
   * cada 30° —una rosa polar—, y sobre eso no se puede rotar un dato ni leer
   * la intersección de dos planos. Los únicos tramos rectos que pasan por el
   * centro son el diámetro N-S y el E-W, que sí pertenecen a las familias.
   */
  // Solo dos curvas de la red llegan al centro: la más cercana de todas las
  // demás se queda a r = 0.12 (el manteo de 80° y el cono de 80°), así que a
  // 0.02 del centro únicamente puede haber muestras de esos dos diámetros.
  const porElCentro = todos.filter((p) => radio(p) < 0.02);
  ok('alguna curva llega al centro', porElCentro.length > 0);
  const acimutes = new Set(
    porElCentro
      .filter((p) => radio(p) > 1e-6)
      .map((p) => Math.round((((Math.atan2(p.x, -p.y) * 180) / Math.PI) % 180 + 180) % 180)),
  );
  const ejes = [...acimutes].filter((a) => Math.min(a % 90, 90 - (a % 90)) > 2);
  ok('por el centro solo pasan los diámetros N-S y E-W', ejes.length === 0, `acimutes ${ejes.join(',')}`);

  /*
   * NINGUNA CURVA DA UN SALTO. Es la regresión del fallo que convertía la red
   * en un abanico de rectas: los extremos de cada arco caen exactamente en el
   * horizonte, donde `z` vale ±1e-17 según el redondeo, y dejar que ese ruido
   * decidiera el hemisferio mandaba el último punto a su antípoda. La
   * polilínea lo unía con el anterior y dibujaba una cuerda de un borde al
   * otro de la red. Un salto no puede pasar del paso de muestreo.
   */
  const saltoMaximo = (seg) =>
    Math.max(...seg.slice(1).map((p, i) => Math.hypot(p.x - seg[i].x, p.y - seg[i].y)));
  const peor = Math.max(...[...net.great, ...net.small].map(saltoMaximo));
  ok('ninguna curva salta a su antípoda', peor < 0.05, `salto de ${peor}`);

  // Lo mismo para un ciclograma de dato, que sale de la misma función.
  ok('tampoco los ciclogramas de las medidas',
    S.greatCirclePath(0, 10).every((seg) => saltoMaximo(seg) < 0.05));

  // Cada familia arranca en 10° y llega hasta la vertical: con menos, la red
  // no sirve para estimar nada a ojo.
  ok('hay círculos máximos a ambos lados del eje N-S',
    net.great.flat().some((p) => p.x > 0.5) && net.great.flat().some((p) => p.x < -0.5));
  ok('los círculos menores llegan cerca del N y del S',
    net.small.flat().some((p) => p.y < -0.9) && net.small.flat().some((p) => p.y > 0.9));
}

console.log('== línea y flecha del colgante ==');
{
  const base = { strike: 0, dip: 60, type: 'fault-plane', lineTrend: 90, linePlunge: 60 };
  const sin = S.lineOf({ ...base });
  ok('la línea se plotea donde va 60→090', sin && cerca(sin.x, S.schmidtPoint(90, 60).x) && sin.arrow === null);
  const nor = S.lineOf({ ...base, faultSense: 'normal' });
  ok('normal: flecha hacia afuera (al E)', nor.arrow && cerca(nor.arrow.dx, 1, 1e-6) && cerca(nor.arrow.dy, 0, 1e-6), JSON.stringify(nor.arrow));
  const inv = S.lineOf({ ...base, faultSense: 'inverse' });
  ok('inversa: flecha hacia el centro (al W)', inv.arrow && cerca(inv.arrow.dx, -1, 1e-6), JSON.stringify(inv.arrow));
  const dex = S.lineOf({ strike: 0, dip: 80, type: 'fault-plane', lineTrend: 0, linePlunge: 0, faultSense: 'right-lateral' });
  ok('dextral: flecha al S, tangente al primitivo', dex.arrow && cerca(dex.arrow.dy, 1, 1e-6), JSON.stringify(dex.arrow));
  ok('sin línea no hay nada', S.lineOf({ strike: 0, dip: 30 }) === null);
  const lin = S.lineOf({ strike: 0, dip: 30, type: 'foliation', lineTrend: 90, linePlunge: 30, faultSense: 'normal' });
  ok('una lineación no lleva flecha', lin.arrow === null);
}

console.log(fails ? `\n${fails} FALLADAS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
