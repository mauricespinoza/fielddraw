/**
 * Ajustes de imagen de las capas raster: traducción a propiedades de pintura
 * de MapLibre, saneo de lo guardado, preajustes, el store y que vivan en el
 * dispositivo y no en el proyecto.
 */

// localStorage de mentira antes de importar nada que lo lea.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const ra = await import('../src/rasterAdjust.js');
const store = await import('../src/store.js');
const { saveRasterAdjust, loadSavedRasterAdjust } = await import('../src/persistence.js');
const { serializeProject } = await import('../src/project.js');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};
const near = (a, b) => Math.abs(a - b) < 1e-9;

console.log('== rasterPaint ==');
{
  const p = ra.rasterPaint(ra.NEUTRAL);
  ok('neutro = valores por omisión de MapLibre',
    p['raster-brightness-min'] === 0 && p['raster-brightness-max'] === 1 &&
    p['raster-contrast'] === 0 && p['raster-saturation'] === 0 && p['raster-hue-rotate'] === 0,
    JSON.stringify(p));

  const claro = ra.rasterPaint({ brightness: 0.3 });
  ok('brillo positivo levanta el negro', near(claro['raster-brightness-min'], 0.3) && claro['raster-brightness-max'] === 1);
  const oscuro = ra.rasterPaint({ brightness: -0.3 });
  ok('brillo negativo apaga el blanco', oscuro['raster-brightness-min'] === 0 && near(oscuro['raster-brightness-max'], 0.7));

  const inv = ra.rasterPaint({ invert: true });
  ok('invertir intercambia min y max', inv['raster-brightness-min'] === 1 && inv['raster-brightness-max'] === 0);
  const invOsc = ra.rasterPaint({ invert: true, brightness: -0.3 });
  ok('invertir respeta el brillo', near(invOsc['raster-brightness-min'], 0.7) && invOsc['raster-brightness-max'] === 0);

  const todo = ra.rasterPaint({ contrast: 0.4, saturation: -1, hue: 90 });
  ok('contraste, saturación y tono pasan tal cual',
    todo['raster-contrast'] === 0.4 && todo['raster-saturation'] === -1 && todo['raster-hue-rotate'] === 90);
}

console.log('== sanitizeAdjust ==');
{
  const a = ra.sanitizeAdjust({ brightness: 5, contrast: -9, saturation: 'x', hue: 400, invert: 'yes' });
  ok('recorta al rango', a.brightness === 1 && a.contrast === -1 && a.hue === 180);
  ok('lo que no es número vuelve a cero', a.saturation === 0);
  ok('invert solo con true', a.invert === false);
  ok('null es neutro', ra.isNeutral(null) && ra.isNeutral(undefined) && ra.isNeutral('basura'));
  ok('un ajuste no es neutro', !ra.isNeutral({ contrast: 0.1 }));
  ok('invert solo ya no es neutro', !ra.isNeutral({ invert: true }));
}

console.log('== preajustes ==');
{
  ok('son cuatro', ra.PRESETS.length === 4);
  ok('ids únicos', new Set(ra.PRESETS.map((p) => p.id)).size === 4);
  ok('ninguno es neutro', ra.PRESETS.every((p) => !ra.isNeutral(p.adjust)));
  ok('cada uno dentro de rango', ra.PRESETS.every((p) => JSON.stringify(ra.sanitizeAdjust(p.adjust)) === JSON.stringify({ ...ra.NEUTRAL, ...p.adjust })));
  ok('matchPreset reconoce cada uno', ra.PRESETS.every((p) => ra.matchPreset(p.adjust) === p.id));
  ok('matchPreset de algo a mano es null', ra.matchPreset({ contrast: 0.05 }) === null);
  const base = ra.PRESETS.find((p) => p.id === 'mapping-base');
  ok('la base para cartografiar es gris', base.adjust.saturation === -1);
}

console.log('== sanitizeAdjustMap ==');
{
  const m = ra.sanitizeAdjustMap({ a: { contrast: 0.2 }, b: { contrast: 0 }, '': { contrast: 1 } });
  ok('quita neutros e ids vacíos', Object.keys(m).join() === 'a');
  ok('no acepta arrays ni basura', Object.keys(ra.sanitizeAdjustMap([1, 2])).length === 0 && Object.keys(ra.sanitizeAdjustMap('x')).length === 0);
}

console.log('== store ==');
{
  ok('arranca sin ajustes', Object.keys(store.getState().rasterAdjust).length === 0);
  store.setRasterAdjust('esri-imagery', { saturation: -1 });
  ok('se fija por capa', store.rasterAdjustOf('esri-imagery').saturation === -1);
  ok('las otras siguen neutras', ra.isNeutral(store.rasterAdjustOf('otra')));
  store.setRasterAdjust('esri-imagery', ra.NEUTRAL);
  ok('neutro deja la capa sin entrada', !('esri-imagery' in store.getState().rasterAdjust));

  store.addTileSet({ id: 'carta', label: 'Carta', tileKind: 'raster' });
  store.setRasterAdjust('carta', { contrast: 0.3 });
  store.removeTileSet('carta');
  ok('quitar un mapa offline borra su ajuste', !('carta' in store.getState().rasterAdjust));

  store.restoreRasterAdjust({ x: { hue: 30 }, y: null });
  ok('restaurar sanea', Object.keys(store.getState().rasterAdjust).join() === 'x' && store.rasterAdjustOf('x').hue === 30);
}

console.log('== del dispositivo, no del proyecto ==');
{
  saveRasterAdjust({ 'esri-imagery': { contrast: 0.4 }, neutra: {} });
  const leido = loadSavedRasterAdjust();
  ok('se guarda y se relee', leido['esri-imagery'].contrast === 0.4 && !('neutra' in leido));
  saveRasterAdjust({});
  ok('sin ajustes no deja la clave', mem.get('fielddraw.raster-adjust.v1') === undefined);
  mem.set('fielddraw.raster-adjust.v1', '{roto');
  ok('lo corrupto se lee como vacío', Object.keys(loadSavedRasterAdjust()).length === 0);

  store.setRasterAdjust('esri-imagery', { saturation: -1 });
  const proj = serializeProject('p');
  ok('el proyecto no lleva los ajustes', !/raster|saturation/i.test(proj));
  store.resetProject();
  ok('un proyecto nuevo no los borra', store.rasterAdjustOf('esri-imagery').saturation === -1);
}

if (fails) {
  console.log(`\n${fails} FALLOS`);
  process.exit(1);
}
console.log('\ntodo ok');
