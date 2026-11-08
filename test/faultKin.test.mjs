// Solución de plano de falla: port del plugin Fault-plane Solver v1.7.
// Los valores de referencia salen del código Python del plugin
// (core/kinematics.py, bingham.py, michael.py) corrido sobre los mismos datos.
const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};
const cerca = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

const K = await import(BASE + 'faultKin.js');

console.log('== sentido de movimiento y vector de deslizamiento ==');

// Falla normal pura: rumbo N, mantea 60° E, estría de manteo puro.
const n1 = K.resolveSlip(0, 60, 90, 60, 'N');
ok('normal pura es válida', n1.valid, JSON.stringify(n1.errors));
ok('el colgante baja (slip con z < 0)', n1.slip[2] < 0);
ok('rake −90 (Aki-Richards)', cerca(n1.rake, -90, 1e-6), `${n1.rake}`);

// La misma estría con sentido inverso: el colgante sube.
const t1 = K.resolveSlip(0, 60, 90, 60, 'T');
ok('inversa: el colgante sube', t1.valid && t1.slip[2] > 0);
ok('rake +90', cerca(t1.rake, 90, 1e-6), `${t1.rake}`);

// Dextral sobre plano vertical N-S: el colgante (E) va hacia el S.
const r1 = K.resolveSlip(0, 90, 0, 0, 'R');
ok('dextral: colgante hacia el sur', r1.valid && r1.slip[1] < -0.99);
const l1 = K.resolveSlip(0, 90, 180, 0, 'L');
ok('sinestral: colgante hacia el norte', l1.valid && l1.slip[1] > 0.99);

// Sentido que la estría no permite: rumbo puro marcado como normal.
const malo = K.resolveSlip(0, 60, 0, 0, 'N');
ok('normal sobre estría horizontal → inválida', !malo.valid);

// Estría 20° fuera del plano: se rechaza (umbral duro 15°).
const fuera = K.resolveSlip(0, 60, 90, 80, 'N');
ok('estría 20° fuera del plano → inválida', !fuera.valid, `${fuera.deviation}`);

console.log('== ejes P/T por falla ==');
const k1 = K.faultKinematics(30, 70, 120, 68, 'N');
ok('P de una normal 030/70: 300/65', cerca(k1.Ptp.trend, 300) && cerca(k1.Ptp.plunge, 65), JSON.stringify(k1.Ptp));
ok('T: 120/25', cerca(k1.Ttp.trend, 120) && cerca(k1.Ttp.plunge, 25), JSON.stringify(k1.Ttp));
ok('P ⟂ T ⟂ B', Math.abs(k1.P[0] * k1.T[0] + k1.P[1] * k1.T[1] + k1.P[2] * k1.T[2]) < 1e-9);

console.log('== población: Bingham y Michael, contra el plugin ==');
const DATA = [
  [10, 60, 95, 58, 'N'],
  [200, 55, 280, 52, 'N'],
  [30, 70, 120, 68, 'N'],
  [350, 50, 70, 40, 'N'],
  [185, 65, 250, 50, 'N'],
  [40, 45, 110, 42, 'N'],
  [120, 80, 125, 20, 'R'],
  [300, 75, 302, 5, 'L'],
  [220, 40, 300, 38, 'T'],
];
const fks = DATA.map((d) => K.faultKinematics(...d));
const b = K.binghamAnalysis(fks);
ok('P̄ 292.351/84.796', cerca(b.Ptp.trend, 292.351) && cerca(b.Ptp.plunge, 84.796), JSON.stringify(b.Ptp));
ok('T̄ 93.254/4.919', cerca(b.Ttp.trend, 93.254) && cerca(b.Ttp.plunge, 4.919), JSON.stringify(b.Ttp));
ok('B̄ 183.4/1.694', cerca(b.Btp.trend, 183.4) && cerca(b.Btp.plunge, 1.694), JSON.stringify(b.Btp));
ok('K 0.5241', cerca(b.K, 0.5241, 1e-4), `${b.K}`);
ok('CLVD 0.0278', cerca(b.clvd, 0.0278, 1e-4), `${b.clvd}`);

const s = K.michaelInversion(fks);
ok('σ1 300.463/79.097', cerca(s.s1.trend, 300.463) && cerca(s.s1.plunge, 79.097), JSON.stringify(s.s1));
ok('σ2 171.99/6.834', cerca(s.s2.trend, 171.99) && cerca(s.s2.plunge, 6.834), JSON.stringify(s.s2));
ok('σ3 80.969/8.455', cerca(s.s3.trend, 80.969) && cerca(s.s3.plunge, 8.455), JSON.stringify(s.s3));
ok('R 0.2747', cerca(s.R, 0.2747, 1e-4), `${s.R}`);
ok('β medio 42.24°', cerca(s.meanMisfit, 42.24, 1e-2), `${s.meanMisfit}`);
ok('Michael pide ≥ 4 fallas', K.michaelInversion(fks.slice(0, 3)) === null);

console.log('== apagar una falla cambia la solución ==');
const feats = DATA.map(([strike, dip, lineTrend, linePlunge, s], i) => ({
  properties: {
    id: `f${i}`,
    geomKind: 'measurement',
    type: 'fault-plane',
    strike,
    dip,
    lineTrend,
    linePlunge,
    faultSense: { N: 'normal', T: 'inverse', R: 'right-lateral', L: 'left-lateral' }[s],
  },
}));
// Un plano de falla sin estría y otro sin sentido: no son dato completo.
feats.push({ properties: { id: 'x1', geomKind: 'measurement', type: 'fault-plane', strike: 10, dip: 50, faultSense: 'normal' } });
feats.push({
  properties: { id: 'x2', geomKind: 'measurement', type: 'fault-plane', strike: 10, dip: 50, lineTrend: 100, linePlunge: 50, faultSense: 'undetermined' },
});
feats.push({ properties: { id: 'b1', geomKind: 'measurement', type: 'bedding', strike: 10, dip: 20 } });

const data = K.faultSlipData(feats, []);
ok('entran solo las 9 de dato completo', data.faults.length === 9, `${data.faults.length}`);
ok('2 planos de falla incompletos quedan fuera', data.incomplete === 2, `${data.incomplete}`);

const todo = K.faultPlaneSolution(data.faults, new Set());
ok('régimen normal con las 9', todo.regime === 'normal', todo.regime);
ok('R′ = R en régimen normal', cerca(todo.RPrime, todo.stress.R, 1e-12));
const sinInversa = K.faultPlaneSolution(data.faults, new Set(['f8']));
ok('apagar la inversa: 8 encendidas', sinInversa.nOn === 8);
ok('…y el β medio baja', sinInversa.stress.meanMisfit < todo.stress.meanMisfit - 5,
  `${todo.stress.meanMisfit} → ${sinInversa.stress.meanMisfit}`);
ok('…sin β para la falla apagada', !sinInversa.misfitById.has('f8'));

// Con la selección puesta en tres fallas, solo esas (y sin Michael).
const sel = K.faultSlipData(feats, ['f0', 'f1', 'f2', 'b1']);
ok('selección: 3 fallas', sel.faults.length === 3 && sel.usingSelection);
const sol3 = K.faultPlaneSolution(sel.faults);
ok('con 3 fallas no hay inversión de esfuerzos', sol3.stress === null);
ok('…y el régimen sale de los ejes cinemáticos', sol3.regimeSource === 'kinematic' && sol3.regime === 'normal', sol3.regime);
const ninguna = K.faultPlaneSolution(sel.faults, new Set(['f0', 'f1', 'f2']));
ok('todas apagadas: sin solución', ninguna.bingham === null && ninguna.nOn === 0);

console.log('== régimen ==');
ok('σ1 vertical → normal', K.classifyRegime(80, 5, 8) === 'normal');
ok('σ3 vertical → thrust', K.classifyRegime(5, 8, 80) === 'thrust');
ok('σ2 vertical → strike-slip', K.classifyRegime(5, 80, 8) === 'strike-slip');
ok("R' de Delvaux en thrust", K.delvauxRPrime(0.4, 'thrust') === 2.4);

console.log('== radiación ==');
// En el doble par de una normal pura (P vertical), el centro de la red es
// compresional y el borde sobre T es extensional.
const sign = (x, y) => K.radiationSign(K.schmidtInverse(x, y), { P: [0, 0, -1], T: [1, 0, 0] });
ok('centro compresional', sign(0, 0) === -1);
ok('borde E extensional', sign(0.99, 0) === 1);

if (fails) {
  console.log(`\n${fails} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nfaultKin: todo bien');
