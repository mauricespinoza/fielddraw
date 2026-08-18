import {
  buildEstructuras,
  buildLineasPoligonos,
  buildObservacion,
  flattenPointFeatures,
  pairOrientations,
  processType,
  rowsToGeoJSON,
  senseOfSlip,
} from '../src/strabo/spots.js';
import { featuresToSpots, uploadableCount } from '../src/strabo/upload.js';
import {
  STRABO_FILTER_FIELD,
  applyStraboFilter,
  applyStraboStyle,
  distinctValues,
  straboLayers,
} from '../src/strabo/layers.js';
import { defaultStraboStyle, sanitizeStraboStyle, STRABO_SIZE_LIMITS } from '../src/strabo/style.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const spot = (props, coords = [-71.3, -37.4, 900]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: coords },
  properties: props,
});

console.log('== la estría viene ANIDADA en el plano ==');
{
  // Es el bug que documenta el plugin: leer solo el primer nivel de
  // orientation_data deja Trend/Plunge vacíos en todas las fallas.
  const s = spot({
    id: 'x1',
    name: 'E-1',
    orientation_data: [
      {
        type: 'planar_orientation',
        feature_type: 'fault',
        fault_or_sz_type: 'normal',
        strike: 30,
        dip: 70,
        associated_orientation: [{ type: 'linear_orientation', trend: 120, plunge: 65 }],
      },
    ],
  });
  const rows = flattenPointFeatures([s]);
  ok('una fila por medición', rows.length === 1, `-> ${rows.length}`);
  const [e] = buildEstructuras(rows);
  ok('recupera el rumbo', e.Strike === 30);
  ok('recupera la estría anidada', e.Trend === 120 && e.Plunge === 65, JSON.stringify([e.Trend, e.Plunge]));
  ok('Type junta plano y tipo de falla', e.Type === 'fault normal', e.Type);
  ok('azimut = rumbo + 90', e.Azimuth === 120, String(e.Azimuth));
  ok('deduce el sentido normal', e['Sense of slip'] === 'N', e['Sense of slip']);
}

console.log('== emparejamiento posicional cuando no hay anidada ==');
{
  const s = spot({
    id: 'x2',
    orientation_data: [
      { type: 'planar_orientation', feature_type: 'fault', fault_or_sz_type: 'dextral', strike: 10, dip: 80 },
      { type: 'linear_orientation', trend: 95, plunge: 10 },
    ],
  });
  const [e] = buildEstructuras(flattenPointFeatures([s]));
  ok('empareja la lineal suelta con el plano', e.Trend === 95);
  ok('dextral => R', e['Sense of slip'] === 'R', e['Sense of slip']);
}

console.log('== varias mediciones => varias filas ==');
{
  const s = spot({
    id: 'x3',
    orientation_data: [
      { type: 'planar_orientation', feature_type: 'bedding', strike: 100, dip: 20 },
      { type: 'planar_orientation', feature_type: 'fracture', strike: 200, dip: 85 },
    ],
  });
  const rows = buildEstructuras(flattenPointFeatures([s]));
  ok('dos estructuras del mismo spot', rows.length === 2, `-> ${rows.length}`);
  ok('conservan su tipo', rows[0].Type === 'bedding' && rows[1].Type === 'fracture');
  ok('y las dos comparten posición', rows[0].Longitude === rows[1].Longitude);
}

console.log('== processType replica la comparación literal del plugin ==');
{
  ok('fault + tipo', processType({ 'Planar Orientation Planar Feature Type': 'fault', 'Planar Orientation Fault Or Sz Type': 'normal' }) === 'fault normal');
  ok('fault con "other" no concatena', processType({ 'Planar Orientation Planar Feature Type': 'fault', 'Planar Orientation Fault Or Sz Type': 'other' }) === 'fault');
  ok('other usa other_feature', processType({ 'Planar Orientation Planar Feature Type': 'other', 'Planar Orientation Other Feature': 'dique' }) === 'dique');
  ok('planar suelto pasa tal cual', processType({ 'Planar Orientation Planar Feature Type': 'bedding' }) === 'bedding');
  ok('sin nada => vacío', processType({}) === '');
  // Mayúsculas: el plugin NO normaliza, y eso es intencional.
  ok('"Fault" con mayúscula no concatena', processType({ 'Planar Orientation Planar Feature Type': 'Fault', 'Planar Orientation Fault Or Sz Type': 'normal' }) === 'Fault');
}

console.log('== sentido de movimiento solo con estría ==');
{
  ok('sin Trend no hay sentido', senseOfSlip({ Type: 'fault normal' }) === '');
  ok('inversa => T', senseOfSlip({ Type: 'fault thrust', Trend: 10 }) === 'T');
  ok('sinestral => L', senseOfSlip({ Type: 'fault sinistral', Trend: 10 }) === 'L');
  ok('bedding no tiene sentido', senseOfSlip({ Type: 'bedding', Trend: 10 }) === '');
}

console.log('== Observación descarta los puntos de paso ==');
{
  const paso = spot({ id: 'p1', name: 'W-1', notes: '' });
  const conNota = spot({ id: 'p2', name: 'W-2', notes: 'Contacto neto' }, [-71.2, -37.3, 0]);
  const conMuestra = spot({
    id: 'p3', name: 'W-3', notes: '',
    samples: [{ sample_id_name: 'MEV-01', main_sampling_purpose: 'geochronology' }],
  }, [-71.1, -37.2, 0]);

  const rows = flattenPointFeatures([paso, conNota, conMuestra]);
  const obs = buildObservacion(rows);
  ok('deja fuera el punto sin nada', !obs.some((o) => o.Name === 'W-1'), JSON.stringify(obs.map(o=>o.Name)));
  ok('conserva el que tiene notas', obs.some((o) => o.Name === 'W-2'));
  ok('conserva el que tiene muestra', obs.some((o) => o.Name === 'W-3'));
  ok('toma el código de muestra', obs.find((o) => o.Name === 'W-3')['Sample Code'] === 'MEV-01');
  ok('y su propósito', obs.find((o) => o.Name === 'W-3').Purpose === 'geochronology');
}

console.log('== la unidad sale de los tags del proyecto ==');
{
  const s = spot({ id: 'u1', name: 'U-1', notes: 'algo' });
  const rows = flattenPointFeatures([s], { u1: ['Fm. Cura-Mallín'] });
  const [o] = buildObservacion(rows);
  ok('Unit viene del tag', o.Unit === 'Fm. Cura-Mallín', o.Unit);
}

console.log('== deduplicado de observación ==');
{
  // Un spot con dos mediciones estructurales genera dos filas crudas, pero es
  // un solo punto de observación.
  const s = spot({
    id: 'd1', name: 'D-1', notes: 'afloramiento',
    orientation_data: [
      { type: 'planar_orientation', feature_type: 'bedding', strike: 10, dip: 20 },
      { type: 'planar_orientation', feature_type: 'bedding', strike: 20, dip: 30 },
    ],
  });
  const rows = flattenPointFeatures([s]);
  ok('dos filas crudas', rows.length === 2);
  ok('una sola observación', buildObservacion(rows).length === 1);
  ok('pero dos estructuras', buildEstructuras(rows).length === 2);
}

console.log('== conversión a GeoJSON ==');
{
  const fc = rowsToGeoJSON([
    { Name: 'A', Longitude: -71, Latitude: -37 },
    { Name: 'B', Longitude: null, Latitude: -37 },
  ]);
  ok('descarta los que no tienen coordenadas', fc.features.length === 1);
  ok('geometría de punto correcta', fc.features[0].geometry.coordinates[0] === -71);
  ok('conserva los atributos', fc.features[0].properties.Name === 'A');
}

console.log('== líneas y polígonos del dataset ==');
{
  const feats = buildLineasPoligonos([
    { properties: { name: 'L1', notes: 'n' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
    { properties: { name: 'P1' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    { properties: { name: 'sin geom' } },
  ], { geologist: 'MEV' });
  ok('descarta lo que no trae geometría', feats.length === 2);
  ok('conserva la geometría', feats[1].geometry.type === 'Polygon');
  ok('aplica el geólogo', feats[0].properties.Geologist === 'MEV');
}

console.log('== subida: features de FieldDraw -> spots ==');
{
  const features = [
    {
      type: 'Feature',
      properties: { id: 'f1', kind: 'line', type: 'thrust-fault', certainty: 'observed' },
      geometry: { type: 'LineString', coordinates: [[-71, -37], [-70.9, -37.1]] },
    },
    {
      type: 'Feature',
      properties: { id: 'f2', kind: 'polygon', type: 'unit-1', unit: 'Fm. Cura-Mallín', code: 'Kcm' },
      geometry: { type: 'Polygon', coordinates: [[[-71, -37], [-70, -37], [-70, -36], [-71, -37]]] },
    },
  ];

  ok('cuenta lo subible', uploadableCount(features) === 2);
  const { collection, count } = featuresToSpots(features, { geologist: 'MEV', field: 'Campaña 1' });
  ok('produce una FeatureCollection', collection.type === 'FeatureCollection' && count === 2);

  const [linea, poligono] = collection.features;
  ok('cada spot lleva id numérico', typeof linea.properties.id === 'number');
  ok('lleva modified_timestamp', typeof linea.properties.modified_timestamp === 'number');
  ok('spotType distingue la geometría', linea.properties.spotType === 'line' && poligono.properties.spotType === 'polygon');
  ok('la geometría se conserva', poligono.geometry.coordinates[0].length === 4);
  ok('el nombre de la falla es legible', /thrust|reverse/i.test(linea.properties.Name), linea.properties.Name);
  ok('el polígono se nombra por su unidad', poligono.properties.Name === 'Fm. Cura-Mallín (Kcm)', poligono.properties.Name);
  ok('columnas del plugin presentes', ['Name','Date','Unit','Notes','Type','Field','Geologist'].every((k) => k in linea.properties));
  ok('marca el origen', linea.properties.source === 'FieldDraw');
  ok('conserva la certeza', linea.properties.certainty === 'observed');

  const soloPuntos = featuresToSpots([{ properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }]);
  ok('ignora geometrías no soportadas', soloPuntos.count === 0);
}

console.log('== pairOrientations sin datos ==');
{
  ok('devuelve un par vacío, no una lista vacía', pairOrientations([]).length === 1);
  ok('y no revienta con basura', pairOrientations(null).length === 1);
}

console.log('== defaultStraboStyle / sanitizeStraboStyle ==');
{
  ok('el tamaño por defecto es 1×', defaultStraboStyle().structureSize === 1);
  ok('sin datos devuelve el default', JSON.stringify(sanitizeStraboStyle(null)) === JSON.stringify(defaultStraboStyle()));
  ok('ignora basura', JSON.stringify(sanitizeStraboStyle('nope')) === JSON.stringify(defaultStraboStyle()));

  const acotado = sanitizeStraboStyle({ structureSize: 99, observationSize: -5 });
  ok('acota el máximo', acotado.structureSize === STRABO_SIZE_LIMITS.max, String(acotado.structureSize));
  ok('acota el mínimo', acotado.observationSize === STRABO_SIZE_LIMITS.min, String(acotado.observationSize));

  const texto = sanitizeStraboStyle({ structureSize: '1.8' });
  ok('convierte números en texto', texto.structureSize === 1.8);
}

console.log('== distinctValues ==');
{
  const fc = rowsToGeoJSON([
    { Name: 'a', Longitude: 0, Latitude: 0, Type: 'fault normal' },
    { Name: 'b', Longitude: 1, Latitude: 1, Type: 'bedding' },
    { Name: 'c', Longitude: 2, Latitude: 2, Type: 'fault normal' },
    { Name: 'd', Longitude: 3, Latitude: 3, Type: '' },
    { Name: 'e', Longitude: 4, Latitude: 4 },
  ]);
  const vals = distinctValues(fc, 'Type');
  ok('sin duplicados', vals.length === 2, JSON.stringify(vals));
  ok('ordenado alfabéticamente', vals[0] === 'bedding' && vals[1] === 'fault normal', JSON.stringify(vals));
  ok('vacíos y ausentes no cuentan', !vals.includes(''));
  ok('campo desconocido no revienta, da lista vacía', distinctValues(fc, 'NoExiste').length === 0);
  ok('colección vacía no revienta', distinctValues(null, 'Type').length === 0);
}

console.log('== tamaño de símbolo aplicado a las capas ==');
{
  const layers = straboLayers({ structureSize: 2, observationSize: 0.5 });
  const structures = layers.find((l) => l.id === 'strabo-structures');
  const observations = layers.find((l) => l.id === 'strabo-observations');
  ok('icon-size sigue interpolando por zoom', structures.layout['icon-size'][0] === 'interpolate');
  ok('con las paradas escaladas ×2', structures.layout['icon-size'][6] === 2, JSON.stringify(structures.layout['icon-size']));
  ok('circle-radius escalado ×0.5', observations.paint['circle-radius'][6] === 3.5, JSON.stringify(observations.paint['circle-radius']));
}

console.log('== applyStraboStyle reconfigura en caliente ==');
{
  const calls = [];
  const fakeMap = {
    getLayer: (id) => (['strabo-structures', 'strabo-observations'].includes(id) ? { id } : undefined),
    setLayoutProperty: (id, prop, v) => calls.push(['layout', id, prop, v]),
    setPaintProperty: (id, prop, v) => calls.push(['paint', id, prop, v]),
  };
  applyStraboStyle(fakeMap, { structureSize: 1.5, observationSize: 2 });
  const iconSize = calls.find((c) => c[2] === 'icon-size');
  const radius = calls.find((c) => c[2] === 'circle-radius');
  ok('toca icon-size de estructuras', !!iconSize && iconSize[1] === 'strabo-structures');
  ok('toca circle-radius de observación', !!radius && radius[1] === 'strabo-observations');
  ok('con el valor escalado', iconSize[3][6] === 1.5, JSON.stringify(iconSize[3]));
}

console.log('== applyStraboFilter combina con el filtro base, no lo reemplaza ==');
{
  const calls = [];
  const ids = new Set([
    'strabo-structures', 'strabo-structures-labels',
    'strabo-lines-fill', 'strabo-lines-line',
  ]);
  const fakeMap = {
    getLayer: (id) => (ids.has(id) ? { id } : undefined),
    setFilter: (id, f) => calls.push([id, f]),
  };

  applyStraboFilter(fakeMap, 'structures', ['bedding', 'fault normal']);
  const struct = calls.find((c) => c[0] === 'strabo-structures');
  ok('filtra por el campo correcto', JSON.stringify(struct[1]) === JSON.stringify(['in', ['get', 'Type'], ['literal', ['bedding', 'fault normal']]]));
  ok('también filtra la etiqueta', calls.some((c) => c[0] === 'strabo-structures-labels'));

  calls.length = 0;
  applyStraboFilter(fakeMap, 'lines', ['Contact']);
  const fill = calls.find((c) => c[0] === 'strabo-lines-fill');
  ok(
    'el relleno conserva su filtro de geometría Y suma el de tipo',
    JSON.stringify(fill[1]) === JSON.stringify(['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'Type'], ['literal', ['Contact']]]]),
    JSON.stringify(fill[1]),
  );
  const line = calls.find((c) => c[0] === 'strabo-lines-line');
  ok('la línea no tenía filtro base, así que solo lleva el de tipo', JSON.stringify(line[1]) === JSON.stringify(['in', ['get', 'Type'], ['literal', ['Contact']]]));

  calls.length = 0;
  applyStraboFilter(fakeMap, 'lines', null);
  const fillSinFiltro = calls.find((c) => c[0] === 'strabo-lines-fill');
  ok(
    'sin filtro de tipo, el relleno vuelve a quedarse solo con su filtro de geometría',
    JSON.stringify(fillSinFiltro[1]) === JSON.stringify(['==', ['geometry-type'], 'Polygon']),
  );
  const lineSinFiltro = calls.find((c) => c[0] === 'strabo-lines-line');
  ok('y la línea queda sin filtro alguno', lineSinFiltro[1] === null);
}

console.log('== STRABO_FILTER_FIELD ==');
{
  ok('estructuras filtra por Type', STRABO_FILTER_FIELD.structures === 'Type');
  ok('observación filtra por Process', STRABO_FILTER_FIELD.observations === 'Process');
  ok('líneas/polígonos filtran por Type', STRABO_FILTER_FIELD.lines === 'Type');
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
