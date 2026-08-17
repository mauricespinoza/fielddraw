import * as store from '../src/store.js';
import { PROJECT_FORMAT, openProject, parseProject, projectFilename, serializeProject } from '../src/project.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const feature = (id, coords) => ({
  type: 'Feature',
  id,
  properties: { id, kind: 'line', type: 'thrust-fault', certainty: 'observed' },
  geometry: { type: 'LineString', coordinates: coords },
});

console.log('== serializar recoge todo el estado ==');
{
  store.loadFeatures([feature('f1', [[0, 0], [1, 1]])]);
  store.setSnapTolerance(9);
  store.setTraceTolerance(31);
  store.setTopoTolerance(12);
  store.setOrnament('thrust-fault', { size: 1.6, spacing: 44 });
  store.addUnit({ name: 'Granodiorita Santa Gertrudis', code: 'Kgsg', color: '#ff0000' });

  const p = serializeProject('Cerro Colorado');
  ok('lleva el formato y la versión', p.format === PROJECT_FORMAT && p.version === 1);
  ok('lleva el nombre', p.name === 'Cerro Colorado');
  ok('lleva los elementos', p.features.length === 1);
  ok('lleva las unidades añadidas', p.units.some((u) => u.code === 'Kgsg'));
  ok('lleva la simbología', p.ornaments['thrust-fault'].size === 1.6);
  ok('lleva los ajustes', p.settings.snapTolerance === 9 && p.settings.traceTolerance === 31);
  ok('lleva el estado de capas', Array.isArray(p.layers) && p.layers.length > 0);
  ok(
    'no arrastra capas importadas',
    p.layers.every((l) => l.id !== undefined) && !('imported' in p),
  );
}

console.log('== ida y vuelta ==');
{
  const original = serializeProject('Ida y vuelta');
  const texto = JSON.stringify(original);

  // Se ensucia el estado antes de volver a cargar, para comprobar que restaura
  // de verdad y no que "ya estaba así".
  store.loadFeatures([]);
  store.setSnapTolerance(20);
  store.setOrnament('thrust-fault', { size: 1, spacing: 26 });

  const { project, warnings } = parseProject(texto);
  ok('no avisa de nada', warnings.length === 0, JSON.stringify(warnings));
  const n = openProject(project);

  const s = store.getState();
  ok('restaura los elementos', n === 1 && s.features.length === 1);
  ok('restaura los ajustes', s.snapTolerance === 9 && s.traceTolerance === 31);
  ok('restaura la tolerancia topológica', s.topoTolerance === 12);
  ok('restaura la simbología', s.ornaments['thrust-fault'].spacing === 44);
  ok('restaura las unidades', s.units.some((u) => u.code === 'Kgsg'));
  ok('deja el borrador y la selección limpios', s.draft === null && s.selection.length === 0);
  ok('corta el historial', !store.canUndo());
}

console.log('== validación ==');
{
  let err = null;
  try { parseProject('{no es json'); } catch (e) { err = e; }
  ok('rechaza el JSON inválido', !!err && /JSON/.test(err.message), err && err.message);

  err = null;
  try { parseProject(JSON.stringify({ hola: 1 })); } catch (e) { err = e; }
  ok('rechaza un JSON que no es proyecto', !!err, err && err.message);

  const futuro = parseProject(
    JSON.stringify({ format: PROJECT_FORMAT, version: 99, features: [] }),
  );
  ok('avisa si viene de una versión más nueva', futuro.warnings.some((w) => /v99/.test(w)));
}

console.log('== acepta un GeoJSON pelado ==');
{
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
    ],
  };
  const { project, warnings } = parseProject(JSON.stringify(fc));
  ok('carga solo la geometría dibujable', project.features.length === 1);
  ok('les asigna id', !!project.features[0].properties.id);
  ok('les pone certeza por defecto', project.features[0].properties.certainty === 'observed');
  ok('avisa de lo descartado', warnings.some((w) => /unsupported/.test(w)));
  ok('avisa de que era un GeoJSON', warnings.some((w) => /GeoJSON/.test(w)));
}

console.log('== nombre de archivo ==');
{
  const f = projectFilename('Mapa Ñuble — Cerro Colorado');
  ok('sin acentos ni signos', /^mapa-nuble-cerro-colorado-\d{4}-\d{2}-\d{2}\.fdproj\.json$/.test(f), f);
  ok('con nombre vacío usa uno por defecto', projectFilename('').startsWith('fielddraw-'));
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
