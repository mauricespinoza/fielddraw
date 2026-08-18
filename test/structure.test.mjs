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

const S = await import(BASE + 'structure.js');
const Sym = await import(BASE + 'symbology.js');

console.log('== gradiente -> rumbo y manteo ==');

// Plano horizontal: manteo cero y ninguna dirección que declarar.
const llano = S.strikeDipFromGradient(0, 0);
ok('un plano horizontal mantea 0°', llano.dip === 0);
ok('un plano horizontal no inventa dirección de manteo', llano.dipAzimuth === 0);

// z crece hacia el este (a > 0) => el terreno baja hacia el OESTE (270°).
const haciaOeste = S.strikeDipFromGradient(1, 0);
ok('manteo de 45° con gradiente unidad', cerca(haciaOeste.dip, 45, 1e-9));
ok('si z sube al este, mantea al oeste', cerca(haciaOeste.dipAzimuth, 270, 1e-9), `${haciaOeste.dipAzimuth}`);
// Regla de la mano derecha: el manteo cae 90° en horario desde el rumbo.
ok('rumbo = dirección de manteo − 90', cerca(haciaOeste.strike, 180, 1e-9), `${haciaOeste.strike}`);

// z crece hacia el norte (b > 0) => baja hacia el SUR (180°).
const haciaSur = S.strikeDipFromGradient(0, 1);
ok('si z sube al norte, mantea al sur', cerca(haciaSur.dipAzimuth, 180, 1e-9), `${haciaSur.dipAzimuth}`);
ok('rumbo este-oeste', cerca(haciaSur.strike, 90, 1e-9), `${haciaSur.strike}`);

// Un gradiente pequeño da un manteo pequeño, no uno grande.
ok('gradiente 0.1 -> ~5.7°', cerca(S.strikeDipFromGradient(0.1, 0).dip, 5.7106, 1e-3));
ok('el rumbo siempre cae en [0, 360)',
  [0.3, -0.3, 1, -1].every((a) => {
    const r = S.strikeDipFromGradient(a, a).strike;
    return r >= 0 && r < 360;
  }));

console.log('== ajuste del plano ==');

// Plano exacto: z = 0.5x + 0y + 100. Tres puntos bien repartidos.
const enu = [
  { x: 0, y: 0, z: 100 },
  { x: 100, y: 0, z: 150 },
  { x: 0, y: 100, z: 100 },
];
const plano = S.solvePlane(enu);
ok('recupera el coeficiente en x', cerca(plano.a, 0.5, 1e-9), `${plano.a}`);
ok('recupera el coeficiente en y', cerca(plano.b, 0, 1e-9), `${plano.b}`);
ok('tres puntos ajustan exacto (RMS 0)', cerca(plano.rms, 0, 1e-9));

// Puntos alineados: el plano puede pivotar libremente sobre esa recta, así que
// NO hay respuesta. Devolver un número aquí sería el peor error posible.
ok('rechaza puntos colineales',
  S.solvePlane([{ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 5 }, { x: 20, y: 20, z: 10 }]) === null);
ok('rechaza menos de tres puntos', S.solvePlane([{ x: 0, y: 0, z: 0 }]) === null);
ok('rechaza tres puntos coincidentes',
  S.solvePlane([{ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 5 }, { x: 1, y: 1, z: 9 }]) === null);

// Con más puntos y ruido, el ajuste debe acercarse al plano verdadero.
const conRuido = [];
for (let i = 0; i < 40; i++) {
  const x = (i % 8) * 25;
  const y = Math.floor(i / 8) * 25;
  conRuido.push({ x, y, z: 0.3 * x - 0.2 * y + 500 + (i % 3 === 0 ? 1 : -1) });
}
const ajuste = S.solvePlane(conRuido);
ok('mínimos cuadrados recupera el plano bajo ruido',
  cerca(ajuste.a, 0.3, 0.01) && cerca(ajuste.b, -0.2, 0.01), `${ajuste.a}, ${ajuste.b}`);
ok('el RMS refleja el ruido', ajuste.rms > 0.5 && ajuste.rms < 2, `${ajuste.rms}`);

console.log('== ENU local ==');
const { enu: local, origin } = S.toLocalENU([
  { lngLat: [-71.0, -37.0], elevation: 1000 },
  { lngLat: [-71.0, -36.999], elevation: 1000 },
]);
ok('el origen es el centroide', cerca(origin[1], -36.9995, 1e-9));
// 0,001° de latitud son ~110,5 m; el punto sur queda a ~-55 m del centroide.
ok('convierte grados a metros', cerca(local[0].y, -55.27, 0.1), `${local[0].y}`);
ok('descarta puntos sin cota',
  S.toLocalENU([
    { lngLat: [0, 0], elevation: 10 },
    { lngLat: [0, 1], elevation: null },
  ]).enu.length === 1);

console.log('== estadística circular ==');
// Promediar 359 y 1 como números daría 180: el rumbo opuesto.
ok('la dispersión circular no explota cruzando el norte',
  S.circularStdDeg([359, 0, 1]) < 2, `${S.circularStdDeg([359, 0, 1])}`);
ok('ángulos idénticos dan dispersión 0', cerca(S.circularStdDeg([45, 45, 45]), 0, 1e-9));
ok('ángulos opuestos dan dispersión grande', S.circularStdDeg([0, 180]) > 60);

console.log('== incertidumbre ==');

// Base larga (600 m) sobre un plano de 26°: el DEM la resuelve bien.
const baseLarga = [
  { lngLat: [-71.0, -37.0], elevation: 1000 },
  { lngLat: [-70.9932, -37.0], elevation: 1300 },
  { lngLat: [-71.0, -36.9946], elevation: 1000 },
];
const rLarga = S.planeFromPoints(baseLarga, { resolution: 30 });
ok('resuelve una base larga', rLarga.ok);
ok('la base medida es de cientos de metros', rLarga.baseline > 250, `${rLarga.baseline}`);
ok('el manteo es el esperado', rLarga.dip > 20 && rLarga.dip < 40, `${rLarga.dip}`);
ok('la incertidumbre de una base larga es baja', rLarga.dipSd < 3, `${rLarga.dipSd}`);
ok('no avisa de nada sobre una base buena', rLarga.warnings.length === 0, rLarga.warnings.join(' | '));

// Misma pendiente sobre 30 m de base: el mismo error vertical se traduce en
// muchísimos más grados. Es EXACTAMENTE el problema que hay que declarar.
const baseCorta = [
  { lngLat: [-71.0, -37.0], elevation: 1000 },
  { lngLat: [-70.99966, -37.0], elevation: 1015 },
  { lngLat: [-71.0, -36.99973], elevation: 1000 },
];
const rCorta = S.planeFromPoints(baseCorta, { resolution: 30 });
ok('resuelve también una base corta', rCorta.ok);
ok('una base corta da mucha más incertidumbre que una larga',
  rCorta.dipSd > rLarga.dipSd * 3, `${rCorta.dipSd} vs ${rLarga.dipSd}`);
ok('avisa de que la base es más corta que dos celdas',
  rCorta.warnings.some((w) => /under two DEM cells/.test(w)), rCorta.warnings.join(' | '));

// Casi colineal: el plano pivota sobre la recta y el manteo no está definido.
const casiRecta = [
  { lngLat: [-71.0, -37.0], elevation: 1000 },
  { lngLat: [-70.995, -37.0], elevation: 1100 },
  { lngLat: [-70.99, -37.00002], elevation: 1200 },
];
const rRecta = S.planeFromPoints(casiRecta, { resolution: 30 });
ok('avisa de puntos casi alineados',
  rRecta.ok && rRecta.warnings.some((w) => /collinear/.test(w)), rRecta.warnings.join(' | '));

// Exactamente colineal: no hay resultado que dar.
const recta = [
  { lngLat: [-71.0, -37.0], elevation: 1000 },
  { lngLat: [-70.99, -37.0], elevation: 1100 },
  { lngLat: [-70.98, -37.0], elevation: 1200 },
];
ok('puntos perfectamente alineados no producen medida', S.planeFromPoints(recta).ok === false);
ok('y explica por qué', /straight line/.test(S.planeFromPoints(recta).reason));

// Menos de tres cotas válidas.
const sinCotas = S.planeFromPoints([
  { lngLat: [-71, -37], elevation: 1000 },
  { lngLat: [-70.99, -37], elevation: null },
  { lngLat: [-71, -36.99], elevation: null },
]);
ok('sin tres cotas no hay plano', sinCotas.ok === false);
ok('y lo dice', /elevation/.test(sinCotas.reason), sinCotas.reason);

// Determinismo: la misma entrada tiene que dar la misma barra de error, o el
// número deja de ser comprobable.
const a1 = S.planeFromPoints(baseLarga, { resolution: 30 });
const a2 = S.planeFromPoints(baseLarga, { resolution: 30 });
ok('la incertidumbre es reproducible', a1.dipSd === a2.dipSd && a1.strikeSd === a2.strikeSd);

// Un plano casi horizontal no debe afirmar dirección de manteo con confianza.
const casiLlano = S.planeFromPoints(
  [
    { lngLat: [-71.0, -37.0], elevation: 1000 },
    { lngLat: [-70.994, -37.0], elevation: 1001 },
    { lngLat: [-71.0, -36.995], elevation: 1000.5 },
  ],
  { resolution: 30 },
);
ok('avisa cuando el manteo es menor que su propio error',
  casiLlano.warnings.some((w) => /cannot be told apart from horizontal/.test(w)),
  `dip ${casiLlano.dip} ± ${casiLlano.dipSd} | ${casiLlano.warnings.join(' | ')}`);

console.log('== formato ==');
ok('formatStrikeDip rellena a tres dígitos', S.formatStrikeDip(45, 32) === '045/32');
ok('formatStrikeDip normaliza el rumbo', S.formatStrikeDip(-10, 5) === '350/5');
ok('formatStrikeDip sin dato', S.formatStrikeDip(null, 30) === '—');
ok('cuadrante norte', S.quadrant(0) === 'N');
ok('cuadrante sureste', S.quadrant(135) === 'SE');
ok('el cuadrante da la vuelta en 360', S.quadrant(359) === 'N');

console.log('== variantes del símbolo ==');
// Un manteo de 2° sobre un DEM de 30 m no puede afirmar dirección: se dibuja
// el símbolo de horizontal, que no la tiene.
ok('manteo casi nulo -> horizontal', Sym.structureVariant(2) === 'horizontal');
ok('manteo casi vertical -> vertical', Sym.structureVariant(89) === 'vertical');
ok('manteo intermedio -> inclinado', Sym.structureVariant(35) === 'inclined');
ok('invertido -> símbolo con gancho', Sym.structureVariant(35, true) === 'overturned');
// Un estrato invertido pero horizontal no lleva gancho: no hay tic donde
// ponerlo.
ok('invertido y horizontal manda horizontal', Sym.structureVariant(1, true) === 'horizontal');
ok('sin manteo cae en inclinado', Sym.structureVariant(null) === 'inclined');

console.log('== estilo de los símbolos ==');
const st = Sym.sanitizeStructureStyle({ size: 99, minzoom: -5, showLabels: 'sí' });
ok('acota el tamaño', st.size === Sym.STRUCTURE_SIZE_LIMITS.max);
ok('acota el zoom mínimo', st.minzoom === 0);
ok('ignora un booleano que no lo es', st.showLabels === true);
ok('sin nada devuelve los valores por defecto',
  JSON.stringify(Sym.sanitizeStructureStyle(null)) === JSON.stringify(Sym.defaultStructureStyle()));

console.log('== tipos de superficie ==');
const ids = Sym.STRUCTURE_TYPES.map((t) => t.id);
ok('ids únicos', new Set(ids).size === ids.length);
ok('todos tienen color hex', Sym.STRUCTURE_TYPES.every((t) => /^#[0-9a-f]{6}$/i.test(t.color)));
ok('los métodos tienen id único',
  new Set(S.MEASURE_METHODS.map((m) => m.id)).size === S.MEASURE_METHODS.length);
ok('los dos métodos que leen el DEM están marcados',
  S.DEM_METHODS.has('three-point') && S.DEM_METHODS.has('plane-fit') && !S.DEM_METHODS.has('manual'));

console.log('== flujo en el store ==');
const store = await import(BASE + 'store.js');

// --- método manual: el toque crea la medida directamente ---
store.setTool('measure');
store.setMeasureMethod('manual');
store.setManualStrike(120);
store.setManualDip(35);
store.addVertex([-71.4, -37.2]);
{
  const fs = store.getState().features;
  ok('un toque con brújula crea la medida', fs.length === 1);
  const p = fs[0].properties;
  ok('la geometría es un punto', fs[0].geometry.type === 'Point');
  ok('se marca como medida', p.geomKind === 'measurement');
  ok('toma el rumbo y el manteo de la paleta', p.strike === 120 && p.dip === 35);
  ok('deriva la dirección de manteo', p.dipAzimuth === 210);
  ok('queda seleccionada para poder corregirla', store.getState().selection[0] === p.id);
  ok('no deja borrador abierto', store.getState().draft === null);
}

// El rumbo y el manteo tienen dominio propio: 400° y 120° no existen.
store.setManualStrike(400);
store.setManualDip(120);
ok('el rumbo se normaliza a [0,360)', store.getState().manualStrike === 40);
ok('el manteo se acota a [0,90]', store.getState().manualDip === 90);

// --- tres puntos: se cierra solo al tercero ---
store.clearFeatures();
store.setMeasureMethod('three-point');
store.addVertex([-71.4, -37.2]);
store.addVertex([-71.39, -37.2]);
ok('con dos puntos aún no resuelve', store.getState().pendingPlane === null);
ok('los puntos se acumulan en el borrador', store.getState().draft.coords.length === 2);
ok('el borrador es de tipo plano', store.getState().draft.kind === 'plane');
store.addVertex([-71.4, -37.19]);
{
  const pend = store.getState().pendingPlane;
  ok('el tercer punto cierra la medida solo', !!pend && pend.coords.length === 3);
  ok('declara el método usado', pend.method === 'three-point');
  ok('y cierra el borrador', store.getState().draft === null);
}
store.clearPendingPlane();

// --- ajuste a una traza: se cierra a mano y admite muchos nodos ---
store.setMeasureMethod('plane-fit');
ok('cambiar de método descarta lo que había a medias', store.getState().draft === null);
for (let i = 0; i < 6; i++) store.addVertex([-71.4 + i * 0.002, -37.2 + (i % 2) * 0.001]);
ok('con seis nodos sigue abierto', store.getState().draft.coords.length === 6);
ok('no se cierra solo', store.getState().pendingPlane === null);
store.finishDraft();
{
  const pend = store.getState().pendingPlane;
  ok('cerrar publica los nodos', !!pend && pend.coords.length === 6);
  ok('declara el ajuste como método', pend.method === 'plane-fit');
}
store.clearPendingPlane();

// Menos de tres nodos no definen un plano: no se publica nada.
store.addVertex([-71.4, -37.2]);
store.addVertex([-71.39, -37.2]);
store.finishDraft();
ok('dos nodos no producen medida', store.getState().pendingPlane === null);

// --- editar a mano invalida la incertidumbre del ajuste ---
store.clearFeatures();
const medida = store.createMeasurement({
  lngLat: [-71.4, -37.2],
  strike: 90,
  dip: 40,
  method: 'three-point',
  quality: { strikeSd: 2.1, dipSd: 3.4, rms: 1.2, n: 3, baseline: 400, minorSpread: 180 },
});
store.setSelection([medida.properties.id]);
store.updateMeasurement({ dip: 55 });
{
  const p = store.getState().features[0].properties;
  ok('el manteo escrito a mano se aplica', p.dip === 55);
  ok('la dirección de manteo se recalcula', p.dipAzimuth === 180);
  ok('el método pasa a "editado"', p.method === 'edited');
  // Las barras de error eran del ajuste; mantenerlas afirmaría una precisión
  // que este número escrito a mano ya no tiene.
  ok('se retiran las barras de error del ajuste',
    p.dipSd === undefined && p.strikeSd === undefined && p.rms === undefined,
    JSON.stringify({ dipSd: p.dipSd, strikeSd: p.strikeSd, rms: p.rms }));
}
// Cambiar solo el tipo no toca los números ni el método.
store.clearFeatures();
const otra = store.createMeasurement({ lngLat: [0, 0], strike: 10, dip: 20, method: 'plane-fit', quality: { dipSd: 1 } });
store.setSelection([otra.properties.id]);
store.updateMeasurement({ type: 'joint' });
{
  const p = store.getState().features[0].properties;
  ok('cambiar el tipo conserva el método', p.method === 'plane-fit');
  ok('y conserva la incertidumbre', p.dipSd === 1);
}

console.log('== perfil y relieve en el store ==');
store.clearFeatures();
store.setTool('profile');
store.addVertex([-71.4, -37.2]);
store.addVertex([-71.3, -37.1]);
ok('la traza del perfil es un borrador propio', store.getState().draft.kind === 'profile');
store.finishDraft();
ok('cerrar publica la traza', store.getState().pendingProfile.coords.length === 2);
ok('la traza NO se guarda como elemento del mapa', store.getState().features.length === 0);
store.clearProfile();

// El relieve 3D es modo de visualización: con él puesto no se digitaliza.
store.setTool('line');
store.setTerrain3d(true);
ok('activar el relieve saca de la herramienta de dibujo', store.getState().tool === 'navigate');
ok('y con él puesto no se puede volver a dibujar', store.setTool('line') === false);
ok('la herramienta no cambió', store.getState().tool === 'navigate');
ok('navegar sí se permite', store.setTool('navigate') !== false);
store.setTerrain3d(false);
ok('al apagarlo se vuelve a poder dibujar', store.setTool('line') === true);

store.setTerrainExaggeration(99);
ok('la exageración se acota', store.getState().terrainExaggeration === 3);
store.setTerrainExaggeration(0.1);
ok('y también por abajo', store.getState().terrainExaggeration === 0.5);
store.setProfileSamples(5);
ok('las muestras del perfil tienen mínimo', store.getState().profileSamples === 20);

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
