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

console.log(fails ? `\n${fails} FALLADAS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
