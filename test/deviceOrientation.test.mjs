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

const D = await import(BASE + 'deviceOrientation.js');
const { strikeDipFromOrientation } = D;

console.log('== orientación del teléfono -> rumbo y manteo ==');

// Teléfono plano sobre una mesa, pantalla hacia el cielo: la normal es
// vertical y el manteo es 0, sin dirección que declarar — igual que un plano
// horizontal ajustado por mínimos cuadrados.
const plano = strikeDipFromOrientation(0, 0, 0);
ok('plano: manteo 0°', cerca(plano.dip, 0));
ok('plano: sin dirección de manteo', cerca(plano.dipAzimuth, 0));

// γ = 90°: el teléfono queda vertical, y su dorso (la normal) apunta al Este.
const vertical = strikeDipFromOrientation(0, 0, 90);
ok('γ=90°: queda vertical', cerca(vertical.dip, 90, 1e-6), `${vertical.dip}`);
ok('γ=90°: manteo hacia el Este', cerca(vertical.dipAzimuth, 90, 1e-6), `${vertical.dipAzimuth}`);
ok('γ=90°: rumbo norte-sur', cerca(vertical.strike, 0, 1e-6), `${vertical.strike}`);

// Rotar solo por α (la brújula) no puede cambiar cuánto se inclina el
// teléfono: un giro sobre el eje vertical deja el manteo intacto y solo
// desplaza la dirección. Es la propiedad que separa un error de signo del
// resto del cálculo: si α se colara en el manteo, esta prueba lo vería.
for (const alpha of [0, 45, 137, 289]) {
  const r = strikeDipFromOrientation(alpha, 22, 8);
  const r0 = strikeDipFromOrientation(0, 22, 8);
  ok(`α=${alpha}° no cambia el manteo`, cerca(r.dip, r0.dip, 1e-9), `${r.dip} vs ${r0.dip}`);
}

// La normal siempre tiene que ser unitaria: si no lo fuera, la matriz de
// rotación estaría mal escrita y el manteo (que sale de su componente
// vertical) sería una cifra sin sentido físico.
function normalLength(alpha, beta, gamma) {
  const RAD = Math.PI / 180;
  const a = alpha * RAD, b = beta * RAD, g = gamma * RAD;
  const nx = Math.cos(a) * Math.sin(g) + Math.cos(g) * Math.sin(a) * Math.sin(b);
  const ny = Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.cos(g) * Math.sin(b);
  const nz = Math.cos(b) * Math.cos(g);
  return Math.hypot(nx, ny, nz);
}
ok('la normal es unitaria en varios ángulos',
  [[0, 0, 0], [30, 15, 60], [200, -40, 80], [359, 89, -89]].every(([a, b, g]) =>
    cerca(normalLength(a, b, g), 1, 1e-9)));

// Un manteo siempre cae en [0°, 180°] por construcción (viene de un acos
// acotado), y la dirección en [0°, 360°).
ok('el manteo cae en [0,180] y el rumbo en [0,360)',
  [[10, 5, 5], [370, -200, 400], [0, 90, 0]].every(([a, b, g]) => {
    const r = strikeDipFromOrientation(a, b, g);
    return r.dip >= 0 && r.dip <= 180 && r.strike >= 0 && r.strike < 360;
  }));

// La normal se lleva al hemisferio de ARRIBA: un plano y su reflejo son la
// misma superficie, y sin este paso el teléfono pasado un pelo de la vertical
// —o apoyado bajo el techo de un volado— daba manteos de más de 90° que
// después se recortaban a 90 dejando la dirección apuntando al lado contrario.
console.log('== la normal, siempre al hemisferio de arriba ==');

for (const [a, b, g] of [[0, 0, 0], [30, 15, 60], [200, -40, 80], [359, 89, -89], [12, 170, 5], [77, 100, 120]]) {
  const r = strikeDipFromOrientation(a, b, g);
  ok(`(${a},${b},${g}) mantea entre 0° y 90°`, r.dip >= 0 && r.dip <= 90, `${r.dip}`);
}

// La misma superficie medida con la normal hacia arriba y hacia abajo tiene
// que dar EXACTAMENTE lo mismo. Es el caso que hacía saltar el rumbo 180°
// entre dos lecturas seguidas de una pared subvertical.
{
  const { strikeDipFromNormal } = D;
  const n = { x: 0.3, y: -0.5, z: 0.2 };
  const arriba = strikeDipFromNormal(n);
  const abajo = strikeDipFromNormal({ x: -n.x, y: -n.y, z: -n.z });
  ok('normal invertida -> mismo rumbo', cerca(arriba.strike, abajo.strike, 1e-9), `${arriba.strike} vs ${abajo.strike}`);
  ok('normal invertida -> mismo manteo', cerca(arriba.dip, abajo.dip, 1e-9));
  ok('normal invertida -> misma dirección', cerca(arriba.dipAzimuth, abajo.dipAzimuth, 1e-9));
  // Y la longitud no importa: solo la dirección.
  const larga = strikeDipFromNormal({ x: n.x * 7, y: n.y * 7, z: n.z * 7 });
  ok('la escala de la normal no cambia nada', cerca(larga.strike, arriba.strike, 1e-9) && cerca(larga.dip, arriba.dip, 1e-9));
}

console.log('== corrección de norte sin bloqueo de cardán ==');

// Rotar la normal alrededor de la vertical tiene que ser idéntico a haber
// leído `alpha + d`: es lo que permite aplicar la corrección de iOS sin
// recomponer la matriz, que es donde se rompía en vertical.
{
  const { normalFromOrientation, rotateYaw } = D;
  const p = normalFromOrientation(37 + 88, -22, 64);
  const q = rotateYaw(normalFromOrientation(37, -22, 64), 88);
  ok('rotar la normal == sumar a alpha', Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-12);
}

// El rumbo de brújula de iOS es el acimut del eje +Y del teléfono. La
// equivalencia con `alpha` CAMBIA DE FÓRMULA al pasar el teléfono de tumbado a
// boca abajo: usar la de siempre en el otro lado deja el rumbo 180° girado.
{
  const { alphaFromHeading } = D;
  const RADIANES = Math.PI / 180;
  const acimutY = (al, be) => {
    const ca = Math.cos(al * RADIANES), sa = Math.sin(al * RADIANES), cb = Math.cos(be * RADIANES);
    return ((Math.atan2(-sa * cb, ca * cb) / RADIANES) % 360 + 360) % 360;
  };
  for (const beta of [0, 30, -45, 120, 200, -160]) {
    const alpha = 123;
    const recuperado = alphaFromHeading(acimutY(alpha, beta), beta);
    ok(`β=${beta}°: se recupera alpha`, recuperado !== null && cerca(recuperado, alpha, 1e-9), `${recuperado}`);
  }
  // Con el eje +Y apuntando al cielo —el teléfono de pie contra una pared— el
  // rumbo de brújula no significa nada, y se dice en vez de inventarlo.
  ok('β≈90°: zona ciega declarada', alphaFromHeading(57, 91) === null);
  ok('β≈-90°: zona ciega declarada', alphaFromHeading(57, -89) === null);
}

console.log('== promedio de orientaciones ==');

{
  const { meanNormal, orientationSpread, strikeDipFromNormal } = D;
  const RADIANES = Math.PI / 180;
  const normalDe = (strike, dip) => {
    const az = (strike + 90) * RADIANES;
    const d = dip * RADIANES;
    return { x: Math.sin(d) * Math.sin(az), y: Math.sin(d) * Math.cos(az), z: Math.cos(d) };
  };

  // Tanda de una pared vertical, con la mitad de las normales apuntando a un
  // lado y la mitad al otro: promediarlas como flechas las cancelaría, y
  // promediar sus rumbos (0° y 180°) daría cualquier cosa. Como EJES, el
  // resultado es el único correcto.
  const pared = [];
  for (let i = 0; i < 10; i++) {
    const n = normalDe(0, 89.5 + i * 0.1);
    pared.push(i % 2 === 0 ? n : { x: -n.x, y: -n.y, z: -n.z });
  }
  const media = meanNormal(pared);
  const leida = strikeDipFromNormal(media);
  ok('pared vertical: manteo ~90°', Math.abs(leida.dip - 90) < 1, `${leida.dip}`);
  ok('pared vertical: rumbo N-S y no a medio camino',
    Math.min(Math.abs(leida.strike - 0), Math.abs(leida.strike - 180), Math.abs(leida.strike - 360)) < 1,
    `${leida.strike}`);

  // Una tanda quieta: la dispersión tiene que salir chica en las dos
  // direcciones, y el manteo medio el que se puso.
  const quieta = [];
  for (let i = 0; i < 20; i++) quieta.push(normalDe(120, 40 + (i % 2 ? 0.2 : -0.2)));
  const m2 = meanNormal(quieta);
  const r2 = strikeDipFromNormal(m2);
  ok('tanda quieta: rumbo 120', cerca(r2.strike, 120, 0.05), `${r2.strike}`);
  ok('tanda quieta: manteo 40', cerca(r2.dip, 40, 0.05), `${r2.dip}`);
  const disp = orientationSpread(quieta, m2);
  ok('tanda quieta: dispersión por debajo de medio grado', disp.spread < 0.5, `${disp.spread}`);
  ok('tanda quieta: error de manteo chico', disp.dipSd < 0.5, `${disp.dipSd}`);

  // El rumbo de una superficie CASI HORIZONTAL está mal definido por
  // geometría, no por ruido: el mismo temblor del polo vale muchos más grados
  // de rumbo. La cifra tiene que decirlo, no esconderlo.
  const tumbada = [];
  const empinada = [];
  for (let i = 0; i < 20; i++) {
    const jitter = (i % 2 ? 0.3 : -0.3);
    tumbada.push(normalDe(120 + jitter * 20, 2 + jitter));
    empinada.push(normalDe(120 + jitter, 80 + jitter));
  }
  const sdTumbada = orientationSpread(tumbada, meanNormal(tumbada)).strikeSd;
  const sdEmpinada = orientationSpread(empinada, meanNormal(empinada)).strikeSd;
  ok('el rumbo de un plano tumbado se reporta mucho menos preciso',
    sdTumbada > sdEmpinada * 3, `${sdTumbada} vs ${sdEmpinada}`);
  ok('...y nunca pasa de 180°, que es donde deja de informar', sdTumbada <= 180);
}

console.log('== canto del teléfono -> línea ==');
{
  const e = D.edgeFromOrientation(0, 0, 0);
  ok('canto horizontal al norte', cerca(e.x, 0) && cerca(e.y, 1) && cerca(e.z, 0), JSON.stringify(e));
  for (const [a, b, g] of [[30, 50, -20], [200, 80, 10], [95, -40, 60]]) {
    const n = D.normalFromOrientation(a, b, g);
    const c = D.edgeFromOrientation(a, b, g);
    ok(`canto ⟂ normal (${a},${b},${g})`, cerca(n.x * c.x + n.y * c.y + n.z * c.z, 0, 1e-9));
  }
  // Teléfono inclinado 30° con la parte de arriba levantada, mirando al N:
  // el canto sube al norte, así que la línea (hacia abajo) es 30→180.
  const l = D.lineFromAxis(D.edgeFromOrientation(0, 30, 0));
  ok('la línea se anota hacia abajo', cerca(l.plunge, 30, 1e-6) && cerca(l.trend, 180, 1e-6), JSON.stringify(l));
  const lp = D.lineFromAxis({ x: 0, y: 1, z: 0.2 }, { x: 0, y: 0, z: 1 });
  ok('proyectada al plano horizontal queda horizontal', cerca(lp.plunge, 0, 1e-9) && cerca(lp.trend, 0, 1e-9));
}


console.log('== salud de la brújula ==');
{
  // El giro entre la orientación absoluta y la relativa es el mismo en
  // cualquier postura, también de pie, donde alpha y gamma se confunden.
  for (const [a, b, g] of [[30, 10, -5], [200, 89.5, 30], [95, -40, 60], [300, 90, 0]]) {
    const Rrel = D.orientationMatrix(a, b, g);
    // Orientación absoluta = Rz(37°)·Rrel: se reconstruye desde la normal y el canto girados.
    const rot = (v) => D.rotateYaw(v, 37);
    const nAbs = rot(D.normalFromOrientation(a, b, g));
    const eAbs = rot(D.edgeFromOrientation(a, b, g));
    // Buscar (α, β, γ) absolutos: misma β y γ, α + 37 (R(α+d) = Rz(d)·R(α)).
    const d = D.yawOffsetBetween({ alpha: a + 37, beta: b, gamma: g }, { alpha: a, beta: b, gamma: g });
    ok(`desfase abs−rel = 37° en (${a},${b},${g})`, cerca(d, 37, 1e-6), `${d}`);
    const n2 = D.normalFromOrientation(a + 37, b, g);
    ok('…y coincide con rotateYaw', cerca(n2.x, nAbs.x, 1e-9) && cerca(n2.y, nAbs.y, 1e-9) && cerca(eAbs.z, D.edgeFromOrientation(a + 37, b, g).z, 1e-9));
    ok('matriz ortonormal', cerca(Rrel[0][0] ** 2 + Rrel[1][0] ** 2 + Rrel[2][0] ** 2, 1, 1e-9));
  }

  // Brújula sana: el desfase no depende del rumbo.
  const sana = [];
  const mala = [];
  for (let h = 0; h < 360; h += 2) {
    sana.push({ heading: h, offset: 123 + 0.5 * Math.sin((h * 7 * Math.PI) / 180) });
    // Hierro duro: error de rumbo de ±9° con una onda por vuelta.
    mala.push({ heading: h, offset: norm(355 + 9 * Math.sin((h * Math.PI) / 180)) });
  }
  function norm(x) {
    return ((x % 360) + 360) % 360;
  }
  const rs = D.evaluateCompassCheck(sana);
  ok('brújula sana: buena', rs.verdict === 'good' && rs.errorDeg < 1, JSON.stringify(rs));
  const rm = D.evaluateCompassCheck(mala);
  ok('hierro duro ±9°: mala', rm.verdict === 'poor' && cerca(rm.errorDeg, 9, 1), JSON.stringify(rm));
  ok('cruza 0°/360° sin romperse', rm.sectors === 8);
  const media = D.evaluateCompassCheck(sana.filter((s) => s.heading < 180));
  ok('media vuelta: incompleta', media.verdict === 'incomplete' && media.sectors === 4, JSON.stringify(media));
  ok('wrap180', D.wrap180(350) === -10 && D.wrap180(10) === 10);
  ok('media circular cruza 0°', cerca(D.circularMeanDeg([350, 10]), 0, 1e-9) || cerca(D.circularMeanDeg([350, 10]), 360, 1e-9));
}

console.log('== iOS: el norte solo se fija nivelado ==');
{
  // Un `window` de juguete: guarda los oyentes y deja disparar eventos.
  const oyentes = {};
  globalThis.window = {
    DeviceOrientationEvent: function () {},
    addEventListener: (t, f) => ((oyentes[t] ||= []).push(f)),
    removeEventListener: (t, f) => (oyentes[t] = (oyentes[t] || []).filter((g) => g !== f)),
  };
  globalThis.DeviceOrientationEvent = window.DeviceOrientationEvent;
  let t0 = 1000;
  const realNow = performance.now.bind(performance);
  performance.now = () => t0;
  const disparar = (e) => (oyentes.deviceorientation || []).forEach((f) => f(e));

  // Origen arbitrario del giroscopio: alphaRel = alphaVerdadero − 90.
  const ALFA = 100;
  const rel = ALFA - 90;
  let ultima = null;
  const stop = D.startOrientationCapture({ onReading: (r) => (ultima = r) });
  // 1) Nivelado y quieto: fija el norte. Rumbo de iOS = 360 − α.
  for (let i = 0; i < 20; i++) {
    t0 += 16;
    disparar({ alpha: rel, beta: 2, gamma: -1, webkitCompassHeading: 360 - ALFA, webkitCompassAccuracy: 5 });
  }
  // 2) Camino a la pared: inclinado y de lado, con el rumbo de iOS ya
  //    corrido 25° (la cámara trasera no apunta adonde el lado superior).
  for (let i = 0; i < 20; i++) {
    t0 += 16;
    disparar({ alpha: rel, beta: 60, gamma: 40, webkitCompassHeading: 360 - ALFA + 25, webkitCompassAccuracy: 5 });
  }
  // 3) Contra la pared subvertical.
  for (let i = 0; i < 70; i++) {
    t0 += 16;
    disparar({ alpha: rel, beta: 80, gamma: 25, webkitCompassHeading: 360 - ALFA + 25, webkitCompassAccuracy: 5 });
  }
  const esperado = D.strikeDipFromOrientation(ALFA, 80, 25);
  ok('rumbo correcto en plano de alto ángulo', cerca(ultima.strike, esperado.strike, 0.05), `${ultima.strike} vs ${esperado.strike}`);
  ok('manteo correcto', cerca(ultima.dip, esperado.dip, 0.05), `${ultima.dip} vs ${esperado.dip}`);
  ok('avisa que el norte viene de la última lectura nivelada', ultima.headingHeld === true);
  ok('informa la precisión de iOS', ultima.compassAccuracy === 5 && !ultima.compassUncalibrated);

  // Precisión mala: se marca descalibrada.
  for (let i = 0; i < 5; i++) {
    t0 += 16;
    disparar({ alpha: rel, beta: 80, gamma: 25, webkitCompassHeading: 360 - ALFA, webkitCompassAccuracy: 30 });
  }
  ok('±30° de iOS = descalibrada', ultima.compassUncalibrated === true);
  stop();

  // Prueba de calibración en iOS: vuelta completa, nivelado, despacio.
  let prog = null;
  const stopC = D.startCompassCheck({ onProgress: (r) => (prog = r) });
  for (let k = 0; k <= 720; k++) {
    t0 += 50; // 0,5° cada 50 ms = 10°/s
    const yaw = k * 0.5;
    const err = 7 * Math.sin((yaw * Math.PI) / 180); // brújula descalibrada
    const h = (((yaw + err) % 360) + 360) % 360;
    disparar({ alpha: (((360 - yaw - 40) % 360) + 360) % 360, beta: 1, gamma: 2, webkitCompassHeading: h, webkitCompassAccuracy: 5 });
  }
  ok('la prueba detecta ±7°', prog && prog.verdict === 'fair' && cerca(prog.errorDeg, 7, 1.2), JSON.stringify(prog));
  stopC();
  performance.now = realNow;
  delete globalThis.window;
}

console.log(fails ? `\n${fails} FALLADAS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
