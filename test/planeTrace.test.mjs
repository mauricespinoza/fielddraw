import {
  DEFAULT_TRACE_KM,
  MAX_TRACE_KM,
  MIN_TRACE_DIP_DEG,
  corridorFor,
  traceFromPlane,
} from '../src/planeTrace.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320;

const ORIGIN = [-71.5, -36.5];
const cosLat = Math.cos(ORIGIN[1] * DEG);

/** De lng/lat al sistema local (Este, Norte) en metros, como hace el módulo. */
const aEN = (lng, lat) => [
  (lng - ORIGIN[0]) * M_PER_DEG_LNG * cosLat,
  (lat - ORIGIN[1]) * M_PER_DEG_LAT,
];

/**
 * Terreno sintético expresado en el marco (s, u) de una medida concreta: así
 * la raíz de g tiene forma cerrada y el resultado se puede comprobar contra un
 * número, no contra "parece razonable".
 */
function terrenoEnRumbo(strike, f) {
  const sS = Math.sin(strike * DEG);
  const cS = Math.cos(strike * DEG);
  const sA = Math.sin((strike + 90) * DEG);
  const cA = Math.cos((strike + 90) * DEG);
  // (e, n) = s·(sS, cS) + u·(sA, cA); el marco es ortonormal, así que se
  // invierte con el producto escalar.
  return async (lng, lat) => {
    const [e, n] = aEN(lng, lat);
    const s = e * sS + n * cS;
    const u = e * sA + n * cA;
    return f(s, u);
  };
}

/** Distancia horizontal entre dos lng/lat, en metros, en el mismo marco. */
const dist = (a, b) => {
  const [ea, na] = aEN(a[0], a[1]);
  const [eb, nb] = aEN(b[0], b[1]);
  return Math.hypot(eb - ea, nb - na);
};

/** Desplazamiento de un punto respecto de la recta del rumbo por el origen. */
function offsetDe(p, strike) {
  const [e, n] = aEN(p[0], p[1]);
  return e * Math.sin((strike + 90) * DEG) + n * Math.cos((strike + 90) * DEG);
}

function alongDe(p, strike) {
  const [e, n] = aEN(p[0], p[1]);
  return e * Math.sin(strike * DEG) + n * Math.cos(strike * DEG);
}

console.log('== terreno horizontal: la traza es la recta del rumbo ==');
{
  const strike = 30;
  const r = await traceFromPlane({
    origin: ORIGIN,
    strike,
    dip: 45,
    backKm: 1,
    forwardKm: 1,
    elevationAt: terrenoEnRumbo(strike, () => 1000),
  });
  ok('traza', r.ok, r.reason);
  ok('sale una polilínea con puntos a los dos lados', r.coords.length > 50, String(r.coords.length));
  const maxOff = Math.max(...r.coords.map((c) => Math.abs(offsetDe(c, strike))));
  ok('no se separa del rumbo ni un metro', maxOff < 1, `${maxOff.toFixed(2)} m`);
  const extremos = [alongDe(r.coords[0], strike), alongDe(r.coords.at(-1), strike)];
  ok(
    'llega al kilómetro pedido a cada lado',
    Math.abs(extremos[0] + 1000) < 40 && Math.abs(extremos[1] - 1000) < 40,
    JSON.stringify(extremos.map((x) => Math.round(x))),
  );
  ok('sin avisos', r.warnings.length === 0, JSON.stringify(r.warnings));
}

console.log('== terreno inclinado a lo largo del rumbo: u = −Δz / tan δ ==');
{
  const strike = 120;
  const dip = 40;
  const k = 0.08; // 8 % de pendiente a lo largo del rumbo
  const r = await traceFromPlane({
    origin: ORIGIN,
    strike,
    dip,
    backKm: 0.5,
    forwardKm: 0.5,
    elevationAt: terrenoEnRumbo(strike, (s) => 1000 + k * s),
  });
  ok('traza', r.ok, r.reason);

  let peor = 0;
  for (const c of r.coords) {
    const s = alongDe(c, strike);
    const u = offsetDe(c, strike);
    const esperado = (-k * s) / Math.tan(dip * DEG);
    peor = Math.max(peor, Math.abs(u - esperado));
  }
  ok('cada punto cae donde dice la fórmula', peor < 1.5, `${peor.toFixed(2)} m`);
  ok(
    'y el desvío va en el sentido correcto',
    offsetDe(r.coords.at(-1), strike) < -20,
    String(offsetDe(r.coords.at(-1), strike)),
  );
}

console.log('== quebrada: la traza hace la V y vuelve ==');
{
  const strike = 0;
  const dip = 20;
  const A = 60; // 60 m de desnivel
  const L = 250;
  const r = await traceFromPlane({
    origin: ORIGIN,
    strike,
    dip,
    backKm: 0.6,
    forwardKm: 0.6,
    elevationAt: terrenoEnRumbo(strike, (s) => 1000 + A * Math.sin(s / L)),
  });
  ok('traza', r.ok, r.reason);

  let peor = 0;
  for (const c of r.coords) {
    const s = alongDe(c, strike);
    const u = offsetDe(c, strike);
    const esperado = (-A * Math.sin(s / L)) / Math.tan(dip * DEG);
    peor = Math.max(peor, Math.abs(u - esperado));
  }
  ok('sigue la ondulación sin saltar de rama', peor < 3, `${peor.toFixed(2)} m`);

  const offs = r.coords.map((c) => offsetDe(c, strike));
  ok(
    'se va a los dos lados del rumbo, que es la V',
    Math.max(...offs) > 80 && Math.min(...offs) < -80,
    `${Math.round(Math.min(...offs))}…${Math.round(Math.max(...offs))}`,
  );
  ok(
    'el desvío declarado es el real',
    Math.abs(r.stats.maxOffset - Math.max(...offs.map(Math.abs))) < 1,
    String(r.stats.maxOffset),
  );
}

console.log('== plano vertical: recto, pase lo que pase con el terreno ==');
{
  const strike = 75;
  const r = await traceFromPlane({
    origin: ORIGIN,
    strike,
    dip: 90,
    backKm: 0.4,
    forwardKm: 0.4,
    elevationAt: terrenoEnRumbo(strike, (s, u) => 1000 + 0.3 * s - 0.5 * u),
  });
  ok('traza pese a que tan(90°) no existe', r.ok, r.reason);
  const maxOff = Math.max(...r.coords.map((c) => Math.abs(offsetDe(c, strike))));
  ok('y sale perfectamente recta', maxOff < 1, `${maxOff.toFixed(3)} m`);
}

console.log('== el terreno ES el plano: no hay un corte, hay infinitos ==');
{
  const strike = 10;
  const dip = 30;
  // z = z0 − u·tan δ es exactamente el plano medido: g ≡ 0 en todas partes.
  // El solver no encuentra un cambio de signo y corta la traza en vez de
  // devolver un punto cualquiera.
  const r = await traceFromPlane({
    origin: ORIGIN,
    strike,
    dip,
    backKm: 0.5,
    forwardKm: 0.5,
    elevationAt: terrenoEnRumbo(strike, (s, u) => 1000 - u * Math.tan(dip * DEG)),
  });
  // Con g ≡ 0 la semilla ya cumple la tolerancia, así que la traza sale por la
  // recta del rumbo: es UNA de las infinitas soluciones y es la honrada.
  ok('no revienta', r.ok, r.reason);
  const maxOff = Math.max(...r.coords.map((c) => Math.abs(offsetDe(c, strike))));
  ok('se queda en la semilla en vez de vagar', maxOff < 1, `${maxOff.toFixed(2)} m`);
}

console.log('== se corta donde el terreno deja de tener cota ==');
{
  const strike = 0;
  const r = await traceFromPlane({
    origin: ORIGIN,
    strike,
    dip: 45,
    backKm: 1,
    forwardKm: 1,
    elevationAt: terrenoEnRumbo(strike, (s) => (Math.abs(s) > 400 ? null : 1000)),
  });
  ok('traza lo que puede', r.ok, r.reason);
  const alongs = r.coords.map((c) => alongDe(c, strike));
  ok(
    'y no pasa del borde del dato',
    Math.max(...alongs.map(Math.abs)) < 430,
    String(Math.round(Math.max(...alongs.map(Math.abs)))),
  );
  ok('avisando de que la cortó', r.warnings.length >= 1, JSON.stringify(r.warnings));
}

console.log('== lo que se niega a hacer, y lo dice ==');
{
  const plano = terrenoEnRumbo(0, () => 1000);

  const suave = await traceFromPlane({ origin: ORIGIN, strike: 0, dip: 1, elevationAt: plano });
  ok('un manteo casi horizontal no se traza', !suave.ok);
  ok(
    'y explica que ahí la traza es una curva de nivel',
    suave.reason.includes('contour line'),
    suave.reason,
  );

  const sinCota = await traceFromPlane({
    origin: ORIGIN,
    strike: 0,
    dip: 45,
    elevationAt: async () => null,
  });
  ok('sin cota en el punto no hay plano que proyectar', !sinCota.ok);

  const sinDip = await traceFromPlane({ origin: ORIGIN, strike: 0, elevationAt: plano });
  ok('sin manteo tampoco', !sinDip.ok, sinDip.reason);

  const sinSitio = await traceFromPlane({ origin: ORIGIN, strike: 0, dip: 45, elevationAt: plano, backKm: 0, forwardKm: 0 });
  ok('cero kilómetros a cada lado no es una traza', !sinSitio.ok, sinSitio.reason);

  const sinPunto = await traceFromPlane({ origin: null, strike: 0, dip: 45, elevationAt: plano });
  ok('sin posición tampoco', !sinPunto.ok, sinPunto.reason);
}

console.log('== la dirección de manteo manda sobre el rumbo ==');
{
  // Rumbo y dipAzimuth incoherentes a propósito: el símbolo dibujado usa el
  // acimut, así que la traza tiene que salir del mismo plano que se ve.
  const r = await traceFromPlane({
    origin: ORIGIN,
    strike: 0,
    dipAzimuth: 180,
    dip: 45,
    backKm: 0.3,
    forwardKm: 0.3,
    elevationAt: terrenoEnRumbo(90, () => 1000),
  });
  ok('el rumbo devuelto es el coherente con el acimut', r.strike === 90, String(r.strike));
}

console.log('== los topes ==');
{
  ok('un solo lado basta', DEFAULT_TRACE_KM > 0);
  ok('el corredor crece con lo pedido pero tiene techo',
     corridorFor(0.1, 0.1) === 750 && corridorFor(20, 20) === 8000,
     `${corridorFor(0.1, 0.1)} / ${corridorFor(20, 20)}`);

  const r = await traceFromPlane({
    origin: ORIGIN,
    strike: 0,
    dip: 45,
    backKm: 0,
    forwardKm: 999,
    elevationAt: terrenoEnRumbo(0, () => 1000),
    maxPointsPerSide: 50,
  });
  ok('una distancia absurda se recorta al máximo', r.stats.forwardKm === MAX_TRACE_KM);
  ok('y el presupuesto de puntos se respeta', r.stats.points <= 52, String(r.stats.points));
  ok('bajando el detalle, no el alcance',
     Math.abs(alongDe(r.coords.at(-1), 0) - MAX_TRACE_KM * 1000) < r.stats.step * 2,
     String(Math.round(alongDe(r.coords.at(-1), 0))));
}

console.log('== determinista ==');
{
  const hacer = () =>
    traceFromPlane({
      origin: ORIGIN,
      strike: 45,
      dip: 8,
      backKm: 0.4,
      forwardKm: 0.4,
      elevationAt: terrenoEnRumbo(45, (s, u) => 1000 + 40 * Math.sin(s / 200) + 0.1 * u),
    });
  const a = await hacer();
  const b = await hacer();
  ok('la misma entrada da la misma traza', JSON.stringify(a.coords) === JSON.stringify(b.coords));
  ok('el punto de la medida está en la traza',
     dist(a.coords[Math.floor(a.coords.length / 2)], ORIGIN) < a.stats.step * 3);
  ok('avisa de la sensibilidad con manteo suave',
     a.warnings.some((w) => w.includes('sensitive')), JSON.stringify(a.warnings));
  ok('el umbral mínimo es el que documenta', MIN_TRACE_DIP_DEG === 3);
}

console.log(fails ? `\n${fails} fallo(s)` : '\ntodo bien');
process.exit(fails ? 1 : 0);
