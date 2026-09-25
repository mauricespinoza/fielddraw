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
ok('el zoom de las etiquetas de manteo es editable y se acota',
  Sym.sanitizeStructureStyle({ labelMinzoom: 16.4 }).labelMinzoom === 16 &&
    Sym.sanitizeStructureStyle({ labelMinzoom: 99 }).labelMinzoom === 20 &&
    Sym.defaultStructureStyle().labelMinzoom === 13);

console.log('== tipos de superficie ==');
const ids = Sym.STRUCTURE_TYPES.map((t) => t.id);
ok('ids únicos', new Set(ids).size === ids.length);
ok('todos tienen color hex', Sym.STRUCTURE_TYPES.every((t) => /^#[0-9a-f]{6}$/i.test(t.color)));
ok('los métodos tienen id único',
  new Set(S.MEASURE_METHODS.map((m) => m.id)).size === S.MEASURE_METHODS.length);
ok('los dos métodos que leen el DEM están marcados',
  S.DEM_METHODS.has('three-point') && S.DEM_METHODS.has('plane-fit') && !S.DEM_METHODS.has('manual'));

console.log('== geometría geográfica de Digitize ==');

// Acimut de un punto exactamente al Este de otro: 90°, sin importar cuánto
// pese la longitud a esa latitud.
{
  const az = S.geoAzimuth([-71.4, -37.2], [-71.39, -37.2]);
  ok('al Este da 90°', cerca(az, 90, 0.5), `${az}`);
}
{
  const az = S.geoAzimuth([-71.4, -37.2], [-71.4, -37.19]);
  ok('al Norte da 0°', cerca(az, 0, 0.5), `${az}`);
}

// Punto medio: el promedio simple de las dos coordenadas.
{
  const mid = S.lngLatMidpoint([-71.4, -37.2], [-71.38, -37.18]);
  ok('el punto medio es el promedio de lng/lat', cerca(mid[0], -71.39) && cerca(mid[1], -37.19));
}

// Ida y vuelta: moverse `distMeters` desde `origin` en un acimut y volver a
// medir la distancia y el acimut tiene que devolver lo mismo con lo que se
// entró — es la comprobación de que `destinationPoint` es de verdad el
// inverso de `geoDistance`/`geoAzimuth`.
{
  const origin = [-71.4, -37.2];
  for (const [bearing, dist] of [[0, 500], [90, 500], [200, 1200], [315, 80]]) {
    const dest = S.destinationPoint(origin, bearing, dist);
    const azBack = S.geoAzimuth(origin, dest);
    const distBack = S.geoDistance(origin, dest);
    ok(`ida y vuelta en acimut ${bearing}°: mismo acimut`, cerca(azBack, bearing, 0.5), `${azBack}`);
    ok(`ida y vuelta en acimut ${bearing}°: misma distancia`, cerca(distBack, dist, dist * 0.02), `${distBack}`);
  }
}

// Distancia cero cuando los dos puntos coinciden, y positiva si no.
{
  ok('distancia nula entre un punto y sí mismo', S.geoDistance([-71.4, -37.2], [-71.4, -37.2]) === 0);
  ok('distancia positiva entre dos puntos distintos', S.geoDistance([-71.4, -37.2], [-71.39, -37.2]) > 0);
}

console.log('== qué lado se arrastró (Digitize) ==');

// Arrastrar hacia el candidato A (rumboBase + 90) no toca el rumbo.
{
  const r = S.resolveDipSide(40, 130); // candA = 130
  ok('lado A: el rumbo no cambia', r.strike === 40);
  ok('lado A: dipAzimuth es el candidato A', r.dipAzimuth === 130);
}

// Arrastrar hacia el candidato B (rumboBase + 270) voltea el rumbo 180°: es
// la MISMA traza, leída con la convención de la mano derecha al revés.
{
  const r = S.resolveDipSide(40, 310); // candB = 310
  ok('lado B: el rumbo se voltea 180°', r.strike === 220);
  ok('lado B: dipAzimuth es el candidato B', r.dipAzimuth === 310);
}

// La invariante que el resto de la app da por cierta siempre, en cualquier
// rumbo base y cualquier lado.
{
  for (const strikeBase of [0, 40, 90, 179, 271, 359]) {
    for (const dragAzimuth of [strikeBase + 91, strikeBase - 91, strikeBase + 200]) {
      const r = S.resolveDipSide(strikeBase, ((dragAzimuth % 360) + 360) % 360);
      ok(`dipAzimuth = rumbo + 90 (base ${strikeBase}, arrastre ${dragAzimuth})`,
        cerca(((r.dipAzimuth - r.strike + 720) % 360), 90, 1e-6),
        `strike=${r.strike} dipAzimuth=${r.dipAzimuth}`);
    }
  }
}

// Arrastrar EXACTAMENTE hacia uno de los dos candidatos siempre elige ESE
// lado, sea cual sea el rumbo base — no hay ningún ángulo donde el criterio
// de "más cerca" se equivoque de lado.
{
  for (const strikeBase of [0, 17, 123, 250, 359]) {
    const candA = ((strikeBase + 90) % 360 + 360) % 360;
    const candB = ((strikeBase + 270) % 360 + 360) % 360;
    ok(`hacia el propio candidato A (base ${strikeBase})`,
      S.resolveDipSide(strikeBase, candA).dipAzimuth === candA);
    ok(`hacia el propio candidato B (base ${strikeBase})`,
      S.resolveDipSide(strikeBase, candB).dipAzimuth === candB);
  }
}

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
  // Colocada la medida, la herramienta vuelve a Elegir: el siguiente toque en
  // el mapa ya no crea otra sin querer. El tipo y la unidad ya se eligieron
  // en la paleta antes de tocar el mapa, así que no hace falta preguntarlos
  // otra vez.
  ok('la herramienta vuelve a Elegir', store.getState().tool === 'select');
}

// El rumbo y el manteo tienen dominio propio: 400° y 120° no existen.
store.setManualStrike(400);
store.setManualDip(120);
ok('el rumbo se normaliza a [0,360)', store.getState().manualStrike === 40);
ok('el manteo se acota a [0,90]', store.getState().manualDip === 90);

// --- tres puntos: se cierra solo al tercero ---
store.clearFeatures();
// Hay que volver a entrar en la herramienta: crear la medida anterior la
// devolvió a Elegir, que es justo lo que se acaba de comprobar.
store.setTool('measure');
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

// --- digitalizar desde el mapa: UN arrastre dibuja la traza de rumbo (ya no
// dos toques), luego arrastrar (y arrastrar de nuevo) congela el manteo, y
// solo Done lo convierte en medida ---
store.clearFeatures();
store.setTool('measure');
store.setMeasureMethod('digitize');

// Un toque suelto ya no hace nada: la traza se dibuja arrastrando
// (`beginStrikeDrag`/`endStrikeDrag` en mapView.js llaman a
// `startDigitizeDip` al soltar), y `addVertex` es la puerta de los TOQUES.
store.addVertex([-71.4, -37.2]);
ok('un toque suelto no abre ningún borrador', store.getState().draft === null);

// Traza E-W (mismo lat, lng distinto): el rumbo geográfico real es 90°, y
// el punto medio el promedio simple de las dos coordenadas.
store.startDigitizeDip([-71.4, -37.2], [-71.39, -37.2]);
{
  const d = store.getState().draft;
  ok('el arrastre abre de una vez la fase de ajuste', d.kind === 'digitize-dip');
  ok('con las dos puntas de la traza', d.coords.length === 2);
  ok('todavía sin ninguna lectura', d.reading === null);
  ok('el rumbo ya queda fijo por los dos puntos', cerca(d.strike, 90, 0.5), `${d.strike}`);
  ok('y el punto medio también', cerca(d.mid[0], -71.395) && cerca(d.mid[1], -37.2));
}

// Sin ninguna lectura congelada, Done no crea nada: se limita a cerrar.
store.finishDraft();
ok('Done sin arrastrar no crea ninguna medida', store.getState().features.length === 0);
ok('y descarta el intento entero', store.getState().draft === null);

// Se rehace la traza para lo que sigue.
store.setTool('measure');
store.startDigitizeDip([-71.4, -37.2], [-71.39, -37.2]);

// Deshacer en esta fase no recorta coordenadas —la traza se dibujó entera de
// un solo arrastre, no hay "un punto menos" que pedir— sino que descarta el
// intento completo, igual que Discard.
store.undoVertex();
ok('deshacer en esta fase descarta el intento entero', store.getState().draft === null);
store.startDigitizeDip([-71.4, -37.2], [-71.39, -37.2]);

// Un arrastre soltado congela la lectura en el borrador, sin crear nada
// todavía: es la diferencia con el diseño de un solo gesto. Arrastrando hacia
// el lado A (candA = rumbo + 90 = 180°) el rumbo no cambia.
store.setDigitizeDipReading({ strike: 90, dip: 42, dipAzimuth: 180 });
{
  const d = store.getState().draft;
  ok('la lectura queda congelada en el borrador', d.reading && d.reading.dip === 42);
  ok('sin crear ninguna medida todavía', store.getState().features.length === 0);
}

// Se puede volver a arrastrar cuantas veces haga falta: la última lectura es
// la que cuenta. Esta vez hacia el lado B (candB = rumbo + 270 = 0°): por la
// regla de la mano derecha eso es EL MISMO plano con el rumbo volteado 180°
// (`resolveDipSide`), y `setDigitizeDipReading` lo guarda ya volteado.
store.setDigitizeDipReading({ strike: 270, dip: 67, dipAzimuth: 0 });
{
  const d = store.getState().draft;
  ok('un segundo arrastre reemplaza la lectura', d.reading.dip === 67);
  ok('...y el rumbo que lo acompaña', d.strike === 270);
}

// Ahora sí: Done crea la medida con el rumbo y el manteo de la última
// lectura congelada, en el punto medio de los dos extremos de la traza.
store.finishDraft();
{
  const fs = store.getState().features;
  ok('Done crea la medida', fs.length === 1);
  const p = fs[0].properties;
  ok('con el rumbo de la última lectura, no el de la traza sin más', p.strike === 270);
  ok('y el manteo de la última lectura congelada', p.dip === 67);
  ok('la dirección de manteo también es la congelada', p.dipAzimuth === 0);
  // La relación que el resto de la app da por cierta siempre.
  ok('dipAzimuth = strike + 90, por la regla de la mano derecha',
    S.norm360(p.dipAzimuth) === S.norm360(p.strike + 90));
  ok('el método queda declarado', p.method === 'digitize');
  ok('vuelve a Elegir, como cualquier otra medida', store.getState().tool === 'select');
}
{
  const geom = store.getState().features[0].geometry.coordinates;
  ok('el punto queda en el punto medio geográfico', cerca(geom[0], -71.395) && cerca(geom[1], -37.2));
}

// Cancelar en cualquier momento descarta todo: no queda ni la traza.
store.clearFeatures();
store.setTool('measure');
store.startDigitizeDip([-71.4, -37.2], [-71.39, -37.2]);
store.setDigitizeDipReading({ strike: 90, dip: 30, dipAzimuth: 180 });
store.cancelDraft();
ok('cancelar no crea ninguna medida', store.getState().features.length === 0);
ok('y no deja nada del intento', store.getState().draft === null);

// `setDigitizeDipReading` no hace nada fuera de la fase de ajuste: no hay
// ninguna traza sobre la que congelar un manteo.
store.setMeasureMethod('manual');
store.setDigitizeDipReading({ strike: 0, dip: 10, dipAzimuth: 90 });
ok('sin borrador de digitize-dip, no pasa nada', store.getState().draft === null);

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

console.log('== sentido de un plano de falla ==');
store.clearFeatures();
store.setMeasureType('fault-plane');
store.setMeasureFaultSense('right-lateral');
{
  const f = store.createMeasurement({ lngLat: [0, 0], strike: 10, dip: 70 });
  ok('Flt toma el sentido elegido en la paleta', f.properties.faultSense === 'right-lateral');
  store.setSelection([f.properties.id]);
  store.updateMeasurement({ faultSense: 'inverse' });
  ok('y se cambia desde el panel', store.getState().features[0].properties.faultSense === 'inverse');
  store.updateMeasurement({ type: 'bedding' });
  ok('dejar de ser falla quita el sentido', store.getState().features[0].properties.faultSense === undefined);
  store.updateMeasurement({ type: 'fault-plane' });
  ok('volver a serlo toma el de la paleta',
    store.getState().features[0].properties.faultSense === 'right-lateral');
}
store.setMeasureType('bedding');
{
  const b = store.createMeasurement({ lngLat: [0, 0], strike: 10, dip: 20 });
  ok('una estratificación no lleva sentido', b.properties.faultSense === undefined);
}
store.setMeasureFaultSense('cualquiera');
ok('un sentido desconocido cae en normal', store.getState().measureFaultSense === 'normal');

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

// El relieve 3D es modo de visualización: con él puesto solo se sigue
// digitalizando Línea y Polígono (con menos precisión); el resto sale a
// Navegar y no se puede volver a elegir mientras el relieve siga puesto.
store.setTool('line');
store.addVertex([-71.4, -37.2]);
store.setTerrain3d(true);
ok('línea sigue activa con el relieve puesto', store.getState().tool === 'line');
// Encender la vista no puede tirar un contacto a medio trazar: es un cambio de
// cómo se mira, no de lo que se está dibujando.
ok('y el borrador en curso no se descarta', store.getState().draft.coords.length === 1);
store.cancelDraft();
ok('se puede seguir eligiendo línea', store.setTool('line') !== false);
ok('y también polígono', store.setTool('polygon') !== false);
ok('la herramienta pasó a polígono', store.getState().tool === 'polygon');
ok('un hueco no se puede activar con el relieve puesto', store.setTool('hole') === false);
ok('la herramienta no cambió', store.getState().tool === 'polygon');
store.setTerrain3d(false);

store.setTool('hole');
store.setTerrain3d(true);
ok('activar el relieve con un hueco activo sí saca a navegar', store.getState().tool === 'navigate');
ok('navegar sí se permite', store.setTool('navigate') !== false);
store.setTerrain3d(false);
ok('al apagarlo se vuelve a poder dibujar', store.setTool('hole') === true);

store.setTerrainExaggeration(99);
ok('la exageración se acota', store.getState().terrainExaggeration === 3);
store.setTerrainExaggeration(0.1);
ok('y también por abajo', store.getState().terrainExaggeration === 0.5);
store.setProfileSamples(5);
ok('las muestras del perfil tienen mínimo', store.getState().profileSamples === 20);

console.log('== plano + línea (estría / lineación) ==');
{
  // Plano 000/30 (mantea al E). Línea de máxima pendiente: 30→090, rake 90.
  const r = S.lineOnPlane(0, 30, 90, 30);
  ok('la línea de máxima pendiente tiene rake 90', cerca(r.rake, 90, 1e-6), `${r.rake}`);
  ok('y cae en el plano', cerca(r.misfit, 0, 1e-6), `${r.misfit}`);
  // Horizontal a lo largo del rumbo: rake 0 (o 180 para el sentido opuesto).
  ok('a lo largo del rumbo RHR, rake 0', cerca(S.lineOnPlane(0, 30, 0, 0).rake, 0, 1e-6));
  ok('contra el rumbo, rake 180', cerca(S.lineOnPlane(0, 30, 180, 0).rake, 180, 1e-6));
  // Ida y vuelta por lineFromRake.
  const l = S.lineFromRake(40, 60, 35);
  const back = S.lineOnPlane(40, 60, l.trend, l.plunge);
  ok('lineFromRake y lineOnPlane son inversas', cerca(back.rake, 35, 1e-6) && cerca(back.misfit, 0, 1e-6),
    JSON.stringify({ l, back }));
  // Una línea vertical sobre un plano de 30° se sale 60° de él.
  ok('una línea fuera del plano se detecta', cerca(S.lineOnPlane(0, 30, 0, 90).misfit, 60, 1e-6));
  ok('formatTrendPlunge', S.formatTrendPlunge(245.2, 12.4) === '12→245');
  ok('calidad 1–5', S.sanitizeQuality(3) === 3 && S.sanitizeQuality('5') === 5);
  ok('calidad fuera de rango o vacía es null',
    S.sanitizeQuality(0) === null && S.sanitizeQuality(6) === null && S.sanitizeQuality(null) === null && S.sanitizeQuality('') === null);
}
{
  store.clearFeatures();
  store.setMeasureType('fault-plane');
  store.setMeasureLine(true);
  store.setManualTrend(90);
  store.setManualPlunge(30);
  store.setMeasureQuality(4);
  const f = store.createMeasurement({ lngLat: [0, 0], strike: 0, dip: 30 });
  const p = f.properties;
  ok('Flt hereda la estría de la paleta', p.lineTrend === 90 && p.linePlunge === 30, JSON.stringify(p));
  ok('y calcula su rake', cerca(p.rake, 90, 0.05));
  ok('y hereda la calidad', p.quality === 4);
  store.setSelection([p.id]);
  store.updateMeasurement({ line: { trend: 0, plunge: 0 }, note: 'slickensides with steps', quality: null });
  const q = store.getState().features[0].properties;
  ok('la línea se edita y el rake se recalcula', q.lineTrend === 0 && cerca(q.rake, 0, 0.05), JSON.stringify(q));
  ok('la nota se guarda', q.note === 'slickensides with steps');
  ok('la calidad se puede quitar', q.quality === undefined);
  store.updateMeasurement({ type: 'bedding' });
  const b = store.getState().features[0].properties;
  ok('una estratificación no lleva línea', b.lineTrend === undefined && b.rake === undefined);
  store.setMeasureType('joint');
  const j = store.createMeasurement({ lngLat: [0, 0], strike: 0, dip: 30 });
  ok('una diaclasa no hereda la línea de la paleta', j.properties.lineTrend === undefined);
  store.setMeasureType('foliation');
  const s1 = store.createMeasurement({ lngLat: [0, 0], strike: 0, dip: 30, line: { trend: 45, plunge: 10 } });
  ok('S₁ admite lineación', s1.properties.lineTrend === 45 && s1.properties.linePlunge === 10);
  store.setSelection([s1.properties.id]);
  store.updateMeasurement({ line: null });
  const s1b = store.getState().features.find((x) => x.properties.id === s1.properties.id).properties;
  ok('y se puede quitar', s1b.lineTrend === undefined && s1b.rake === undefined);
  store.setMeasureLine(false);
  store.setMeasureQuality(null);
  store.setMeasureType('bedding');
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
