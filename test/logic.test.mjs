const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

console.log('== simplify ==');
const S = await import(BASE + 'simplify.js');

// Una recta con ruido de sub-píxel debe colapsar a 2 puntos.
const noisy = Array.from({ length: 200 }, (_, i) => [i, Math.sin(i) * 0.2]);
const simp = S.simplifyDP(noisy, 2);
ok('DP colapsa una recta ruidosa', simp.length === 2, `-> ${simp.length}`);

// Una L verdadera debe conservar el vértice del codo.
const L = [[0, 0], [50, 0], [50, 50]];
ok('DP conserva el codo de una L', S.simplifyDP(L, 2).length === 3);

// DP nunca debe mover los extremos.
const first = simp[0], last = simp[simp.length - 1];
ok('DP conserva extremos', first[0] === 0 && last[0] === 199);

const ch = S.chaikin(L, 2);
ok('Chaikin conserva extremos', ch[0][0] === 0 && ch[ch.length - 1][1] === 50);
ok('Chaikin aumenta densidad', ch.length > L.length, `-> ${ch.length}`);

ok('dedupe elimina puntos coincidentes', S.dedupe([[0,0],[0,0],[0,0],[10,10]]).length === 2);
ok('processStroke sobrevive a trazo de 2 puntos', S.processStroke([[0,0],[1,1]], {tolerance:2, smooth:true}).length === 2);

console.log('== symbology ==');
const Sym = await import(BASE + 'symbology.js');
const ids = Sym.LINE_TYPES.map(t => t.id);
ok('ids de línea únicos', new Set(ids).size === ids.length);
ok('todos los tipos tienen color hex', Sym.LINE_TYPES.every(t => /^#[0-9A-F]{6}$/i.test(t.color)));
// Los dos pliegues comparten el magenta a propósito: lo que distingue un
// antiforme de un sinforme es hacia dónde apuntan las flechas del eje, no el
// color. El resto de los tipos sí se distinguen por color.
const sinPliegues = Sym.LINE_TYPES.filter(t => t.group !== 'Folds');
ok('los colores de línea son distintos fuera de los pliegues',
   new Set(sinPliegues.map(t=>t.color)).size === sinPliegues.length);
ok('los dos pliegues salen del mismo magenta',
   Sym.LINE_TYPES.filter(t=>t.group === 'Folds').every(t => t.color === Sym.FOLD_COLOR));
ok('cada tipo pertenece a un grupo listado', Sym.LINE_TYPES.every(t => Sym.LINE_GROUPS.includes(t.group)));
ok('3 certezas: continua, segmentada, punteada',
   Sym.CERTAINTIES.length === 3 && Sym.CERTAINTIES[0].dash === null && Sym.CERTAINTIES[1].dash && Sym.CERTAINTIES[2].dash);
ok('tipos pedidos presentes',
   ['thrust-fault','normal-fault','dextral-fault','sinistral-fault','undefined-fault',
    'intrusive-contact','stratigraphic-contact','structural-contact','dike',
    'antiform','synform'].every(i => ids.includes(i)));

console.log('== pliegues: solo observados ==');
ok('antiforme y sinforme están acotados',
   Sym.isObservedOnly('antiform') && Sym.isObservedOnly('synform'));
ok('una falla no lo está', !Sym.isObservedOnly('thrust-fault'));
ok('certaintyFor fuerza observado en un pliegue',
   Sym.certaintyFor('antiform', 'covered') === 'observed');
ok('y deja pasar la del resto', Sym.certaintyFor('dike', 'covered') === 'covered');
ok('los pliegues no se pueden voltear',
   !Sym.FLIPPABLE_ORNAMENT_TYPES.includes('antiform') &&
   !Sym.FLIPPABLE_ORNAMENT_TYPES.includes('synform'));
ok('pero sí llevan ornamento',
   Sym.ORNAMENT_TYPES.includes('antiform') && Sym.ORNAMENT_TYPES.includes('synform'));

console.log('== color editable ==');
{
  const orn = Sym.defaultOrnaments();
  ok('cada ornamento arranca con el color del catálogo',
     Sym.ORNAMENT_TYPES.every(t => orn[t].color === Sym.LINE_TYPE_BY_ID.get(t).color));
  ok('sin override manda el catálogo',
     Sym.effectiveLineColor('dike', orn) === Sym.LINE_TYPE_BY_ID.get('dike').color);
  orn.antiform.color = '#00ff00';
  ok('con override manda el override', Sym.effectiveLineColor('antiform', orn) === '#00ff00');
  ok('y no contagia al otro pliegue', Sym.effectiveLineColor('synform', orn) === Sym.FOLD_COLOR);
  ok('lineColorMap cubre todos los tipos',
     Object.keys(Sym.lineColorMap(orn)).length === Sym.LINE_TYPES.length);

  const limpio = Sym.sanitizeOrnaments({ antiform: { color: '  #ABCDEF  ' } });
  ok('acepta un hex con espacios y lo normaliza', limpio.antiform.color === '#abcdef');
  const basura = Sym.sanitizeOrnaments({ antiform: { color: 'red; content: attr(x)' } });
  ok('rechaza lo que no es un hex de seis dígitos', basura.antiform.color === Sym.FOLD_COLOR);
  ok('y también un hex corto', Sym.sanitizeOrnaments({ antiform: { color: '#abc' } }).antiform.color === Sym.FOLD_COLOR);
}

console.log('== geologyStyle ==');
const G = await import(BASE + 'geologyStyle.js');
const gl = G.geologyLayers();
ok('una capa de traza por certeza', G.GEOLOGY_LINE_LAYER_IDS.length === 3);
// El halo solo va en las continuas: sobre una segmentada, el patrón blanco de
// atrás asoma entre los guiones y ensucia justo lo que hay que distinguir.
{
  const casings = gl.filter((l) => l.id.startsWith('geology-line-casing-'));
  ok('un solo casing, el de observado', casings.length === 1 && casings[0].id === 'geology-line-casing-observed',
     JSON.stringify(casings.map((l) => l.id)));
  ok('y ese casing no lleva dasharray', !('line-dasharray' in casings[0].paint));
}
ok('ids de capa únicos', new Set(gl.map(l=>l.id)).size === gl.length);
ok('BASE_OPACITY cubre todas las capas', gl.every(l => typeof G.BASE_OPACITY[l.id] === 'number'));
const obs = gl.find(l => l.id === 'geology-line-observed');
const inf = gl.find(l => l.id === 'geology-line-inferred');
ok('observado sin dasharray', !('line-dasharray' in obs.paint));
ok('inferido con dasharray', Array.isArray(inf.paint['line-dasharray']));
ok('color es expresión match sobre type', obs.paint['line-color'][0] === 'match' && obs.paint['line-color'][1][1] === 'type');
{
  const orn = Sym.defaultOrnaments();
  orn.antiform.color = '#123456';
  const expr = G.lineColorExpr(orn);
  ok('lineColorExpr refleja el color editado', expr[expr.indexOf('antiform') + 1] === '#123456');
  ok('y deja el resto del catálogo', expr[expr.indexOf('dike') + 1] === '#6D4C41');
  ok('GEOLOGY_LINE_LAYER_IDS son las capas de traza',
     G.GEOLOGY_LINE_LAYER_IDS.length === 3 && G.GEOLOGY_LINE_LAYER_IDS.every(id => gl.some(l => l.id === id)));
}
// MapLibre rechaza `zoom` anidado dentro de otra expresión: el interpolate
// debe ser el nodo raíz o el ancho se descarta en silencio.
for (const id of ['geology-line-observed', 'geology-line-casing-observed', 'geology-outline-observed']) {
  const w = gl.find((l) => l.id === id).paint['line-width'];
  ok(`${id}: interpolate de zoom en la raíz`,
     Array.isArray(w) && w[0] === 'interpolate' && JSON.stringify(w[2]) === '["zoom"]',
     JSON.stringify(w).slice(0, 80));
}
ok('capas draft definidas', G.DRAFT_LAYER_IDS.length === 4);

console.log('== store ==');
const St = await import(BASE + 'store.js');
St.setTool('line');
St.addVertex([-71, -37]);
St.addVertex([-71.1, -37.1]);
ok('draft acumula vértices', St.getState().draft.coords.length === 2);
St.appendStroke([[-71.2,-37.2],[-71.3,-37.3]]);
ok('appendStroke concatena', St.getState().draft.coords.length === 4);
St.undoVertex();
ok('undoVertex quita uno', St.getState().draft.coords.length === 3);
St.setCertainty('inferred');
St.setLineType('thrust-fault');
St.finishDraft();
ok('finishDraft crea feature', St.getState().features.length === 1);
const f = St.getState().features[0];
ok('geometría LineString', f.geometry.type === 'LineString');
ok('propiedades tipo+certeza', f.properties.type === 'thrust-fault' && f.properties.certainty === 'inferred');
ok('draft limpio tras finalizar', St.getState().draft === null);

St.setTool('polygon');
St.addVertex([0,0]); St.addVertex([1,0]); St.addVertex([1,1]);
St.finishDraft();
const p = St.getState().features[1];
ok('polígono se cierra solo', p.geometry.type === 'Polygon' &&
   JSON.stringify(p.geometry.coordinates[0][0]) === JSON.stringify(p.geometry.coordinates[0][3]));

St.setTool('line');
St.addVertex([5,5]);
St.finishDraft();
ok('línea de 1 vértice se descarta', St.getState().features.length === 2);

// Cambiar de herramienta debe cerrar lo abierto, no perderlo.
St.addVertex([1,1]); St.addVertex([2,2]);
St.setTool('polygon');
ok('cambiar herramienta cierra el draft', St.getState().features.length === 3 && St.getState().draft === null);

console.log('== capas ==');
const before = St.getState().layers.map(l=>l.id);
St.moveLayer(before[2], -1);
const after = St.getState().layers.map(l=>l.id);
ok('moveLayer intercambia', after[1] === before[2] && after[2] === before[1]);
St.moveLayer(after[0], -1);
ok('moveLayer no sale del rango', St.getState().layers.map(l=>l.id)[0] === after[0]);
St.setLayerOpacity('esri-imagery', 0.4);
ok('opacidad se guarda', St.getState().layers.find(l=>l.id==='esri-imagery').opacity === 0.4);
St.setLayerVisible('osm', true);
ok('visibilidad se guarda', St.getState().layers.find(l=>l.id==='osm').visible === true);
ok('capa geología va primera por defecto', before[0] === 'geology');

console.log('== notificación de cambios ==');
let hits = 0;
const unsub = St.subscribe(() => { if (St.changed('features')) hits++; });
St.deleteLastFeature();
ok('subscribe notifica cambios de features', hits === 1, `-> ${hits}`);
St.setLayerOpacity('osm', 0.5);
ok('changed() discrimina la clave', hits === 1, `-> ${hits}`);
unsub();

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
