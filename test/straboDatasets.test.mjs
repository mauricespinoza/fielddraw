import * as store from '../src/store.js';
import { openProject, parseProject, serializeProject } from '../src/project.js';
import { straboLayers, straboBaseId, straboKeyOf, straboSourceIds } from '../src/strabo/layers.js';
import { buildLineasPoligonos } from '../src/strabo/spots.js';
import { lockedEntries } from '../src/strabo/panel.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const fc = (features) => ({ type: 'FeatureCollection', features });

/** Un dataset aplanado como lo deja `panel.js` tras la descarga. */
const dataset = (datasetId, datasetName, spotBase) => ({
  datasetId,
  datasetName,
  projectId: 'p1',
  estructuras: fc([
    {
      type: 'Feature',
      properties: { Name: `${datasetName}-E1`, Type: 'bedding', Strike: 30, Dip: 40, __spot_id__: `${spotBase}1` },
      geometry: { type: 'Point', coordinates: [-71.3, -37.4] },
    },
  ]),
  observacion: fc([]),
  lineas: fc([
    {
      type: 'Feature',
      properties: { Name: `${datasetName}-L1`, Type: 'geologic structure fault thrust', Quality: 'known', __spot_id__: `${spotBase}2` },
      geometry: { type: 'LineString', coordinates: [[-71.31, -37.41], [-71.29, -37.39]] },
    },
  ]),
});

const own = (id) => ({
  type: 'Feature',
  id,
  properties: { id, kind: 'line', type: 'stratigraphic-contact', certainty: 'observed' },
  geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
});

const filasStrabo = () => store.getState().layers.filter((l) => l.kind === 'strabo');
const ds = (key) => store.getState().straboDatasets.find((d) => d.key === key);
const deDataset = (key) => store.getState().features.filter((f) => f.properties.straboDataset === key);

console.log('== capas por dataset ==');
{
  const a = straboLayers(undefined, '3', '#26A69A');
  ok('cada capa lleva la clave del dataset', a.every((l) => l.id.endsWith('@3')));
  ok('y su fuente también', a.every((l) => Object.values(straboSourceIds('3')).includes(l.source)));
  ok('el color propio llega a la traza',
     a.find((l) => l.id === 'strabo-lines-line@3').paint['line-color'] === '#26A69A');
  ok('sin clave, los ids de siempre', straboLayers().some((l) => l.id === 'strabo-lines-line'));
  ok('se recupera el id base y la clave',
     straboBaseId('strabo-structures@12') === 'strabo-structures' && straboKeyOf('strabo-structures@12') === '12');
  ok('una capa sin clave no tiene dueño', straboKeyOf('strabo-structures') === null);
}

console.log('== el id del spot viaja con la línea aplanada ==');
{
  const [l] = buildLineasPoligonos([
    { type: 'Feature', properties: { id: 1234567890123, name: 'L' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
  ]);
  ok('__spot_id__ en las propiedades', l.properties.__spot_id__ === 1234567890123);
}

console.log('== varios datasets entran juntos y cerrados ==');
{
  store.loadProject({ features: [own('mio')] });
  const r1 = store.addStraboDataset(dataset('100', 'Ana', 'a'));
  const r2 = store.addStraboDataset(dataset('200', 'Beto', 'b'));
  const st = store.getState();
  ok('dos datasets', st.straboDatasets.length === 2);
  ok('claves distintas', r1.key !== r2.key);
  ok('los dos cerrados', st.straboDatasets.every((d) => d.locked));
  ok('una fila de capa por dataset', filasStrabo().length === 2);
  ok('colores distintos', ds(r1.key).color !== ds(r2.key).color);
  ok('la fila lleva su color', filasStrabo().every((l) => l.color));
  ok('las filas quedan bajo el dibujo propio',
     st.layers.findIndex((l) => l.kind === 'strabo') > st.layers.findIndex((l) => l.kind === 'units'));
  ok('el dibujo propio no se tocó', st.features.length === 1);

  const again = store.addStraboDataset(dataset('100', 'Ana v2', 'a'));
  ok('volver a bajar el mismo lo reemplaza', again.replaced && again.key === r1.key);
  ok('sin duplicar fila', filasStrabo().length === 2 && store.getState().straboDatasets.length === 2);
  ok('con el nombre nuevo', ds(r1.key).datasetName === 'Ana v2');
}

console.log('== abrir el candado adopta, y solo uno a la vez ==');
const [kA, kB] = store.getState().straboDatasets.map((d) => d.key);
{
  const r = store.setStraboLocked(kA, false);
  ok('devuelve la adopción', r && r.features.length === 2, JSON.stringify(r && r.stats));
  ok('queda abierto y adoptado', !ds(kA).locked && ds(kA).adopted);
  ok('su capa de consulta queda vacía', store.straboReadOnlyCount(ds(kA)) === 0);
  const suyos = deDataset(kA);
  ok('sus elementos en el dibujo, marcados con la clave', suyos.length === 2);
  ok('con el id del spot de origen', suyos.every((f) => /^a[12]$/.test(f.properties.straboSpotId)));
  ok('y el nombre del dataset', suyos.every((f) => f.properties.straboDatasetName === 'Ana v2'));
  ok('la falla inversa entró como cabalgamiento', suyos.some((f) => f.properties.type === 'thrust-fault'));

  store.setStraboLocked(kB, false);
  ok('abrir otro cierra el primero', ds(kA).locked && !ds(kB).locked);
  ok('el segundo también pasó al dibujo', deDataset(kB).length === 2);

  store.setStraboLocked(kB, true);
  ok('se puede cerrar sin abrir otro', store.getState().straboDatasets.every((d) => d.locked));
  ok('cerrar no devuelve nada a la capa de consulta', deDataset(kB).length === 2);

  store.setStraboLocked(kA, false);
  ok('reabrir uno ya adoptado no lo duplica', deDataset(kA).length === 2);
  ok('y lo deja abierto', !ds(kA).locked && ds(kB).locked);
}

console.log('== lo cerrado no se selecciona ni se edita ==');
{
  const idA = deDataset(kA)[0].properties.id;
  const idB = deDataset(kB)[0].properties.id;
  store.setSelection([idA, idB, 'mio']);
  const sel = store.getState().selection;
  ok('la selección deja fuera lo cerrado', !sel.includes(idB));
  ok('y conserva lo abierto y lo propio', sel.includes(idA) && sel.includes('mio'));
  store.clearSelection();
  store.toggleSelection(idB);
  ok('tampoco entra alternando', store.getState().selection.length === 0);

  ok('es un elemento cerrado', store.isLockedFeature(deDataset(kB)[0]));
  ok('el abierto no', !store.isLockedFeature(deDataset(kA)[0]));
  const editables = new Set(store.unlockedFeatures().map((f) => f.properties.id));
  ok('las herramientas no ven lo cerrado', !editables.has(idB) && editables.has(idA) && editables.has('mio'));

  store.setSelection([idA]);
  store.setStraboLocked(kA, true);
  ok('cerrar un dataset lo saca de la selección', store.getState().selection.length === 0);
  store.setStraboLocked(kA, false);
}

console.log('== borrar el último y vaciar el dibujo respetan lo cerrado ==');
{
  const antes = store.getState().features.length;
  // Lo último del dibujo es del dataset B, que está cerrado.
  const ultimo = store.getState().features[antes - 1];
  ok('(el último es de un dataset cerrado)', store.isLockedFeature(ultimo));
  store.deleteLastFeature();
  const st = store.getState();
  ok('borra uno', st.features.length === antes - 1);
  ok('pero no el cerrado', st.features.some((f) => f.properties.id === ultimo.properties.id));
  store.undo();
  ok('deshacer lo devuelve', store.getState().features.length === antes);

  store.clearFeatures();
  ok('vaciar deja lo cerrado', store.getState().features.length === deDataset(kB).length && deDataset(kB).length === 2);
  store.undo();
  ok('deshacer devuelve el resto', store.getState().features.length === antes);
}

console.log('== el ojo apaga también lo adoptado ==');
{
  store.setLayerVisible(store.straboLayerId(kB), false);
  ok('dataset apagado', store.hiddenStraboKeys().has(kB));
  const vis = store.visibleFeatures();
  ok('sus elementos no se ven', !vis.some((f) => f.properties.straboDataset === kB));
  ok('el resto sí', vis.some((f) => f.properties.straboDataset === kA) && vis.some((f) => f.properties.id === 'mio'));
  store.setLayerVisible(store.straboLayerId(kB), true);
  ok('encenderlo los devuelve', store.visibleFeatures().length === store.getState().features.length);
}

console.log('== el proyecto guarda datasets, candados y ojos ==');
{
  store.setLayerVisible(store.straboLayerId(kB), false);
  const texto = JSON.stringify(serializeProject('Con datasets'));
  store.loadProject({ features: [] });
  ok('(un proyecto nuevo no trae datasets)', store.getState().straboDatasets.length === 0 && filasStrabo().length === 0);

  const { project, warnings } = parseProject(texto);
  ok('se lee sin avisos', warnings.length === 0, JSON.stringify(warnings));
  openProject(project);
  const st = store.getState();
  ok('vuelven los dos datasets', st.straboDatasets.length === 2);
  ok('A sigue abierto, B cerrado', !ds(kA).locked && ds(kB).locked);
  ok('B sigue apagado', filasStrabo().find((l) => l.straboKey === kB).visible === false);
  ok('vuelven sus elementos', deDataset(kA).length === 2 && deDataset(kB).length === 2);
  ok('y siguen siendo intocables', !store.unlockedFeatures().some((f) => f.properties.straboDataset === kB));
  store.setLayerVisible(store.straboLayerId(kB), true);
}

console.log('== un dataset sin registro se rehace cerrado ==');
{
  const features = store.getState().features;
  store.loadProject({ features: [] });
  store.loadFeatures(features);
  const st = store.getState();
  ok('las dos filas vuelven a partir del dibujo', st.straboDatasets.length === 2 && filasStrabo().length === 2);
  ok('cerradas', st.straboDatasets.every((d) => d.locked));
  ok('con su nombre', st.straboDatasets.some((d) => d.datasetName === 'Ana v2'));
}

console.log('== nunca dos abiertos, aunque el archivo lo diga ==');
{
  store.loadProject({
    features: [],
    straboDatasets: [
      { key: '1', datasetId: '1', datasetName: 'X', locked: false, estructuras: dataset('1', 'X', 'x').estructuras },
      { key: '2', datasetId: '2', datasetName: 'Y', locked: false, estructuras: dataset('2', 'Y', 'y').estructuras },
    ],
  });
  const abiertos = store.getState().straboDatasets.filter((d) => !d.locked);
  ok('solo uno queda abierto', abiertos.length === 1 && abiertos[0].key === '1');
}

console.log('== deshacer la apertura lo devuelve cerrado y a su capa ==');
{
  store.loadProject({ features: [] });
  const { key } = store.addStraboDataset(dataset('300', 'Carla', 'c'));
  store.setStraboLocked(key, false);
  ok('(abierto y en el dibujo)', deDataset(key).length === 2);
  store.undo();
  ok('vuelve cerrado', ds(key).locked && !ds(key).adopted);
  ok('sin elementos en el dibujo', deDataset(key).length === 0);
  ok('con su capa de consulta llena', store.straboReadOnlyCount(ds(key)) === 2);
}

console.log('== un dataset ya abierto no se vuelve a bajar encima ==');
{
  const { key } = store.addStraboDataset(dataset('400', 'Dani', 'd'));
  store.setStraboLocked(key, false);
  let error = null;
  try {
    store.addStraboDataset(dataset('400', 'Dani', 'd'));
  } catch (err) {
    error = err;
  }
  ok('se rechaza', error && /already loaded/.test(error.message));
  ok('sin duplicar sus elementos', deDataset(key).length === 2);
}

console.log('== quitar un dataset se lleva sus elementos ==');
{
  const key = store.getState().straboDatasets.find((d) => d.datasetName === 'Dani').key;
  const n = store.removeStraboDataset(key);
  ok('quita sus elementos', n === 2 && deDataset(key).length === 0);
  ok('y su fila', !filasStrabo().some((l) => l.straboKey === key));
  store.undo();
  ok('deshacer lo devuelve', deDataset(key).length === 2 && ds(key));
}

console.log('== una clave quitada no se vuelve a dar ==');
{
  const ultima = store.getState().straboDatasets.at(-1);
  store.removeStraboDataset(ultima.key);
  const { key } = store.addStraboDataset(dataset('500', 'Eva', 'e'));
  ok('clave nueva', key !== ultima.key, `${key} vs ${ultima.key}`);
}

console.log('== atributos en solo lectura ==');
{
  const e = lockedEntries({
    type: 'Feature',
    properties: { geomKind: 'measurement', type: 'bedding', strike: 30, dip: 40, certainty: 'observed', note: 'E-1' },
    geometry: { type: 'Point', coordinates: [0, 0] },
  });
  const m = new Map(e);
  ok('rumbo y manteo', m.get('Strike') === 30 && m.get('Dip') === 40);
  ok('el tipo con su nombre, no su id', m.get('Type') && m.get('Type') !== 'bedding');
  ok('las notas', m.get('Notes') === 'E-1');
}

if (fails) {
  console.log(`\n${fails} FAIL`);
  process.exit(1);
}
console.log('\nTODO OK');
