/** Capas importadas: restauradas con su estado y editables (adoptables) tras reabrir. */
import * as store from '../src/store.js';

let fails = 0;
const ok = (name, cond) => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name}`); }
};

const capa = {
  id: 'gpkg-abc-0',
  label: 'Geologia',
  style: null,
  geojson: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { type: 'fault' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      { type: 'Feature', properties: { name: 'Fm A' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    ],
  },
};

console.log('== restaurar capas importadas ==');
store.restoreImportedLayers([capa]);
let st = store.getState();
ok('la capa vuelve con su id', st.imported.some((l) => l.id === 'gpkg-abc-0'));
ok('tiene su fila en el panel', st.layers.some((l) => l.id === 'gpkg-abc-0' && l.kind === 'imported'));
store.restoreImportedLayers([capa]);
ok('restaurar dos veces no duplica', store.getState().imported.length === 1);
store.applyLayerState([{ id: 'gpkg-abc-0', visible: false, opacity: 0.4 }]);
const fila = store.getState().layers.find((l) => l.id === 'gpkg-abc-0');
ok('visibilidad y opacidad guardadas', fila.visible === false && fila.opacity === 0.4);
ok('el estado de la capa se guarda', store.currentLayerState().some((l) => l.id === 'gpkg-abc-0'));

console.log('== editable tras restaurar ==');
const r = store.adoptImported('gpkg-abc-0');
st = store.getState();
ok('pasa al dibujo', r && r.features.length === 2 && st.features.length === 2);
ok('deja de ser capa de solo lectura', st.imported.length === 0);

console.log(fails ? `\n${fails} fallo(s)` : '\ntodo bien');
process.exit(fails ? 1 : 0);
