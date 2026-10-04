import * as store from '../src/store.js';
import {
  buildEstructuras,
  buildLineasPoligonos,
  buildObservacion,
  flattenPointFeatures,
  rowsToGeoJSON,
} from '../src/strabo/spots.js';
import { baselineOf, isEditedLocally } from '../src/strabo/sync.js';
import { assembleCollection, buildPush, spotIdsOf, stripProvenance } from '../src/strabo/push.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

/** Spots NATIVOS como los devolvería StraboSpot, con lo que FieldDraw no conoce. */
const nativos = () => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-71.31, -37.41], [-71.29, -37.39]] },
      properties: {
        id: 11, name: 'C-1', date: '2026-09-01T00:00:00.000Z', notes: 'contacto neto',
        images: [{ id: 555, caption: 'foto del contacto' }],
        campo_raro: { anidado: [1, 2] },
        trace: { trace_feature: true, trace_type: 'contact', contact_type: 'depositional',
          depositional_contact_type: 'stratigraphic', trace_quality: 'known', trace_notes: 'nota de traza' },
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-71.3, -37.4, 1234] },
      properties: {
        id: 21, name: 'E-1', date: '2026-09-01T00:00:00.000Z', notes: 'afloramiento',
        images: [{ id: 556 }],
        orientation_data: [
          { id: 900, type: 'planar_orientation', feature_type: 'bedding', strike: 30, dip: 40, quality: '4', notes: 'S0' },
          { id: 901, type: 'planar_orientation', feature_type: 'foliation', strike: 100, dip: 50 },
        ],
        samples: [{ id: 700, sample_id_name: 'S1', sample_description: 'arenisca', main_sampling_purpose: 'geochronology', material_type: 'intact_rock' }],
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-71.32, -37.42], [-71.31, -37.42], [-71.31, -37.41], [-71.32, -37.42]]] },
      properties: { id: 31, name: 'P-1', surface_feature: { surface_feature_type: 'rock_unit', surface_feature_quality: 'known' } },
    },
  ],
});

/** Lo mismo aplanado, como lo deja `fetchDataset`. */
function aplanar(native) {
  const point = native.features.filter((f) => f.geometry.type === 'Point');
  const rest = native.features.filter((f) => f.geometry.type !== 'Point');
  const rows = flattenPointFeatures(point, {});
  return {
    estructuras: rowsToGeoJSON(buildEstructuras(rows, {})),
    observacion: rowsToGeoJSON(buildObservacion(rows, {})),
    lineas: { type: 'FeatureCollection', features: buildLineasPoligonos(rest, {}) },
    baseline: baselineOf({ point, line: rest.filter((f) => f.geometry.type === 'LineString'), polygon: rest.filter((f) => f.geometry.type === 'Polygon') }),
  };
}

console.log('== la procedencia no sube ==');
{
  ok('se quita la coletilla', stripProvenance('contacto neto — [C-1 · StraboSpot · Ana]') === 'contacto neto');
  ok('también sola', stripProvenance('[C-1 · StraboSpot · Ana]') === '');
  ok('una nota sin coletilla queda igual', stripProvenance('ver [foto 3]') === 'ver [foto 3]');
}

const NATIVE = nativos();
const remote = aplanar(NATIVE);
store.loadProject({ features: [] });
const { key } = store.addStraboDataset({ datasetId: '77', datasetName: 'Ana', projectId: '1', ...remote });
store.setStraboLocked(key, false);
const dataset = () => store.getState().straboDatasets.find((d) => d.key === key);
const deEste = () => store.getState().features.filter((f) => f.properties.straboDataset === key);
const bySpot = (id) => deEste().filter((f) => f.properties.straboSpotId === String(id));
const editar = (pred, fn) => store.setFeatures(store.getState().features.map((f) => (pred(f) ? fn(f) : f)));
const push = () => buildPush({ native: NATIVE, data: remote, dataset: dataset(), features: deEste() });

console.log('== sin editar no hay nada que subir ==');
{
  ok('(adoptado: línea, medidas, muestra, polígono)', deEste().length >= 5, String(deEste().length));
  const r = push();
  ok('nada cambiado', r.changed.length === 0 && r.skipped.length === 0 && r.deleted.length === 0, JSON.stringify(r.changed));
}

console.log('== solo cambia lo editado ==');
{
  // La línea pasa a cabalgamiento; la estratificación a 35°; la muestra cambia de descripción.
  editar((f) => f.properties.straboSpotId === '11', (f) => ({ ...f, properties: { ...f.properties, type: 'thrust-fault' } }));
  editar((f) => f.properties.straboSpotId === '21' && f.properties.type === 'bedding',
    (f) => ({ ...f, properties: { ...f.properties, strike: 35, dipAzimuth: 125 } }));
  editar((f) => f.properties.straboSpotId === '21' && f.properties.geomKind === 'control-point',
    (f) => ({ ...f, properties: { ...f.properties, sampleDescription: 'arenisca gruesa' } }));

  const r = push();
  ok('dos spots cambiados', r.changed.length === 2, JSON.stringify(r.changed));
  ok('nada omitido', r.skipped.length === 0, JSON.stringify(r.skipped));
  const linea = r.spots.get('11').properties;
  ok('la traza ahora es cabalgamiento', linea.trace.trace_type === 'geologic_struc' && linea.trace.shear_sense === 'thrust');
  ok('sin los campos de contacto viejos', linea.trace.contact_type === undefined && linea.trace.depositional_contact_type === undefined);
  ok('conserva la calidad y sus notas de traza', linea.trace.trace_quality === 'known' && linea.trace.trace_notes === 'nota de traza');
  ok('conserva fotos y campos desconocidos', linea.images[0].caption === 'foto del contacto' && linea.campo_raro.anidado[1] === 2);
  ok('las notas del spot no se ensucian', linea.notes === 'contacto neto');
  ok('la geometría no se tocó', JSON.stringify(r.spots.get('11').geometry) === JSON.stringify(NATIVE.features[0].geometry));
  ok('marca la modificación', Number.isFinite(linea.modified_timestamp));
  ok('dice qué cambió', r.changed.find((c) => c.id === '11').fields.join() === 'type');

  const punto = r.spots.get('21').properties;
  const s0 = punto.orientation_data.find((o) => o.id === 900);
  const s1 = punto.orientation_data.find((o) => o.id === 901);
  ok('la estratificación sube con el rumbo nuevo', s0.strike === 35 && s0.dip === 40 && s0.dip_direction === 125);
  ok('con su calidad y sus notas de allá', s0.quality === '4' && s0.notes === 'S0');
  ok('la foliación del mismo spot intacta', JSON.stringify(s1) === JSON.stringify(NATIVE.features[1].properties.orientation_data[1]));
  ok('la muestra cambia solo su descripción', punto.samples[0].sample_description === 'arenisca gruesa' &&
     punto.samples[0].sample_id_name === 'S1' && punto.samples[0].material_type === 'intact_rock');
  ok('la altitud del punto se conserva', r.spots.get('21').geometry.coordinates[2] === 1234);
  ok('el original no se modificó', NATIVE.features[0].properties.trace.trace_type === 'contact');

  const col = assembleCollection(NATIVE, { spots: r.spots });
  ok('se manda el dataset entero', col.features.length === 3);
  ok('el polígono va tal cual (el mismo objeto)', col.features[2] === NATIVE.features[2]);
  ok('en su orden', col.features.map((f) => f.properties.id).join() === '11,21,31');
}

console.log('== lo que no se puede traducir no se sube ==');
{
  // Mover el punto: cambia de lugar y sigue siendo traducible.
  const antes = push().changed.length;
  // Cambiar la unidad del polígono: vive en los tags del proyecto.
  editar((f) => f.properties.straboSpotId === '31', (f) => ({ ...f, properties: { ...f.properties, unit: 'Otra unidad' } }));
  // Partir la línea en dos.
  const linea = bySpot(11)[0];
  store.setFeatures([...store.getState().features, { ...linea, properties: { ...linea.properties, id: 'pieza-2' } }]);
  const r = push();
  const omitidos = Object.fromEntries(r.skipped.map((s) => [s.id, s.reasons.join(' ')]));
  ok('la línea partida se omite', /split/.test(omitidos['11'] || ''), JSON.stringify(omitidos));
  ok('el cambio de unidad se omite', /unit/.test(omitidos['31'] || ''), JSON.stringify(omitidos));
  ok('lo demás sigue subiendo', r.changed.map((c) => c.id).join() === '21', `${antes} -> ${JSON.stringify(r.changed)}`);
  ok('lo omitido no entra en lo que se manda', !r.spots.has('11') && !r.spots.has('31'));
  store.setFeatures(store.getState().features.filter((f) => f.properties.id !== 'pieza-2'));
}

console.log('== lo borrado aquí se ofrece, no se borra solo ==');
{
  store.setFeatures(store.getState().features.filter((f) => f.properties.straboSpotId !== '31'));
  const r = push();
  ok('el polígono borrado aparece como borrado', r.deleted.length === 1 && r.deleted[0].id === '31' && r.deleted[0].name === 'P-1');
  const sin = assembleCollection(NATIVE, { spots: r.spots });
  ok('sin decidirlo, sigue en lo que se manda', spotIdsOf(sin).has('31'));
  const con = assembleCollection(NATIVE, { spots: r.spots, deletedIds: ['31'] });
  ok('decidido, sale', !spotIdsOf(con).has('31') && con.features.length === 2);
  const nuevo = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 99 } };
  ok('lo nuevo va al final', assembleCollection(NATIVE, { spots: r.spots, added: [nuevo] }).features.at(-1) === nuevo);
}

console.log('== tras subir, lo subido deja de contar como editado ==');
{
  // Uno propio que se sube como spot nuevo.
  const propio = { type: 'Feature', id: 'mio', properties: { id: 'mio', kind: 'line', type: 'normal-fault', certainty: 'observed' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } };
  store.setFeatures([...store.getState().features, propio]);
  // Y uno editado que NO se pudo subir (la unidad del polígono ya no está; se usa la línea).
  editar((f) => f.properties.straboSpotId === '11', (f) => ({ ...f, properties: { ...f.properties, note: 'editada sin subir' } }));
  store.markStraboPushed(key, { baseline: { '11': 'x', '21': 'y', '99': 'z' }, newSpotIds: { mio: '99' }, skippedSpotIds: ['11'] });
  ok('lo subido ya no está editado', bySpot(21).every((f) => !isEditedLocally(f)));
  ok('lo omitido sigue editado', bySpot(11).some(isEditedLocally));
  const m = store.getState().features.find((f) => f.properties.id === 'mio');
  ok('lo propio pasa al dataset con su spot', m.properties.straboDataset === key && m.properties.straboSpotId === '99' && !isEditedLocally(m));
  ok('la referencia nueva queda guardada', dataset().baseline['99'] === 'z');
}

if (fails) {
  console.log(`\n${fails} FAIL`);
  process.exit(1);
}
console.log('\nTODO OK');
