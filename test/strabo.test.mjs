import {
  buildEstructuras,
  buildLineasPoligonos,
  featureTypeLabel,
  buildObservacion,
  flattenPointFeatures,
  pairOrientations,
  processType,
  rowsToGeoJSON,
  senseOfSlip,
  spotTagsFrom,
} from '../src/strabo/spots.js';
import { featuresToSpots, uploadBreakdown, uploadableCount } from '../src/strabo/upload.js';
import {
  adoptStrabo,
  straboCertainty,
  straboLineType,
  straboFaultSense,
  straboStructureType,
} from '../src/strabo/adopt.js';
import { mergeGeologicUnitTags, planarOrientation } from '../src/strabo/mapping.js';
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

console.log('== Type de lineas y poligonos sale de trace / surface_feature ==');
{
  ok('una falla se lee entera',
    featureTypeLabel({ trace: { trace_type: 'geologic_struc', geologic_structure_type: 'fault', shear_sense: 'thrust' } })
      === 'geologic structure fault thrust');
  ok('un contacto dice de que tipo',
    featureTypeLabel({ trace: { trace_type: 'contact', contact_type: 'intrusive', intrusive_contact_type: 'dike' } })
      === 'contact intrusive dike');
  ok('un poligono sale de surface_feature',
    featureTypeLabel({ surface_feature: { surface_feature_type: 'rock_unit' } }) === 'rock unit');
  ok('un `other` muestra el texto escrito',
    featureTypeLabel({ surface_feature: { surface_feature_type: 'other', other_surface_feature_type: 'alteration zone' } })
      === 'alteration zone');
  ok('sin nada no revienta', featureTypeLabel(null) === '' && featureTypeLabel({}) === '');

  const fc = buildLineasPoligonos(
    [{ properties: { id: 55, name: 'P-1', surface_feature: { surface_feature_type: 'rock_unit' } }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
    { spotTags: { 55: ['Fm. Cura-Mallin'] } },
  );
  ok('la unidad del poligono sale de los tags', fc[0].properties.Unit === 'Fm. Cura-Mallin', fc[0].properties.Unit);
  ok('y el tipo de su superficie', fc[0].properties.Type === 'rock unit');
}

console.log('== subida: features de FieldDraw -> spots nativos ==');
{
  const features = [
    {
      type: 'Feature',
      properties: {
        id: 'm1', kind: 'point', geomKind: 'measurement', type: 'bedding',
        strike: 45.4, dip: 32.6, dipAzimuth: 135.4, overturned: true,
        method: 'plane-fit', strikeSd: 3.2, dipSd: 1.8, rms: 4.5, baseline: 180, n: 12,
        demSource: 'Terrarium', unitId: 'unit-1', unit: 'Fm. Cura-Mallin', code: 'Kcm',
        note: 'contact zone',
      },
      geometry: { type: 'Point', coordinates: [-71.2, -37.2] },
    },
    {
      type: 'Feature',
      properties: { id: 'f1', kind: 'line', type: 'thrust-fault', certainty: 'inferred' },
      geometry: { type: 'LineString', coordinates: [[-71, -37], [-70.9, -37.1]] },
    },
    {
      type: 'Feature',
      properties: { id: 'f2', kind: 'polygon', type: 'unit-1', unit: 'Fm. Cura-Mallin', code: 'Kcm', certainty: 'observed' },
      geometry: { type: 'Polygon', coordinates: [[[-71, -37], [-70, -37], [-70, -36], [-71, -37]]] },
    },
  ];
  const units = [{ id: 'unit-1', name: 'Fm. Cura-Mallin', code: 'Kcm', color: '#ffb74d' }];

  ok('cuenta lo subible', uploadableCount(features) === 3);
  ok('desglosa por tipo',
     JSON.stringify(uploadBreakdown(features)) ===
       JSON.stringify({ measurements: 1, controlPoints: 0, lines: 1, polygons: 1 }),
     JSON.stringify(uploadBreakdown(features)));

  const { collection, count, tags } = featuresToSpots(features, { geologist: 'MEV', field: 'Campana 1', units });
  ok('produce una FeatureCollection', collection.type === 'FeatureCollection' && count === 3);

  const [medida, linea, poligono] = collection.features;

  ok('cada spot lleva id de 14 digitos', String(medida.properties.id).length === 14, String(medida.properties.id));
  ok('los ids no se repiten', new Set(collection.features.map((f) => f.properties.id)).size === 3);
  ok('lleva modified_timestamp', typeof linea.properties.modified_timestamp === 'number');
  ok('la fecha va sin milisegundos', linea.properties.date.endsWith('.000Z'), linea.properties.date);
  ok('la geometria se conserva', poligono.geometry.coordinates[0].length === 4);

  // --- la medida entra como orientacion planar, que es lo que StraboSpot lee
  const [o] = medida.properties.orientation_data;
  ok('la medida lleva orientation_data', medida.properties.orientation_data.length === 1);
  ok('es una orientacion planar', o.type === 'planar_orientation');
  ok('feature_type es el de StraboSpot', o.feature_type === 'bedding', o.feature_type);
  ok('rumbo y manteo redondeados a entero', o.strike === 45 && o.dip === 33, JSON.stringify([o.strike, o.dip]));
  ok('el azimut de manteo viaja', o.dip_direction === 135, String(o.dip_direction));
  ok('el volcamiento es facing', o.facing === 'overturned');
  ok('NO se inventa quality', !('quality' in o), JSON.stringify(o.quality));
  ok('la trazabilidad va en las notas', /plane|least-squares/i.test(o.notes) && o.notes.includes('RMS'), o.notes);
  ok('el valor exacto se conserva aparte', medida.properties.fielddraw.strike === 45.4);
  ok('el nombre de la medida se lee', /Bedding/.test(medida.properties.name), medida.properties.name);

  // --- el error del ajuste va en las notas del SPOT, no solo en las de la orientacion
  ok('las notas del spot llevan el error del ajuste',
    medida.properties.notes.includes('RMS') && medida.properties.notes.includes('180 m'),
    medida.properties.notes);
  ok('y la nota propia del geologo tambien', medida.properties.notes.includes('contact zone'), medida.properties.notes);
  ok('las notas del spot y de la orientacion dicen lo mismo', medida.properties.notes === o.notes);

  // --- la unidad de una medida tambien genera / se suma al tag del proyecto
  ok('sigue siendo un solo tag: medida y poligono comparten unidad', tags.length === 1);
  ok('el tag incluye el spot de la medida y el del poligono',
    tags[0].spots.length === 2 && tags[0].spots.includes(medida.properties.id) && tags[0].spots.includes(poligono.properties.id));

  // --- un joint es fracture, no `option_13`
  const [joint] = featuresToSpots(
    [{ type: 'Feature', properties: { id: 'j', geomKind: 'measurement', type: 'joint', strike: 10, dip: 80 }, geometry: { type: 'Point', coordinates: [0, 0] } }],
  ).collection.features;
  ok('un joint es fracture con su subtipo',
    joint.properties.orientation_data[0].feature_type === 'fracture'
      && joint.properties.orientation_data[0].fracture_type === 'joint');

  // --- la linea entra como traza
  const t = linea.properties.trace;
  ok('la linea lleva trace', !!t);
  ok('trace_feature marcado', t.trace_feature === true);
  ok('una falla es estructura geologica', t.trace_type === 'geologic_struc' && t.geologic_structure_type === 'fault');
  ok('el tipo de falla va en shear_sense', t.shear_sense === 'thrust', t.shear_sense);
  ok('la certeza es trace_quality', t.trace_quality === 'inferred', t.trace_quality);
  ok('la linea no lleva orientation_data', !linea.properties.orientation_data);

  // --- contactos y pliegues
  const linea2 = (type, certainty = 'observed') => featuresToSpots([
    { type: 'Feature', properties: { id: 'x', kind: 'line', type, certainty }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
  ]).collection.features[0].properties.trace;

  const strat = linea2('stratigraphic-contact', 'covered');
  ok('un contacto estratigrafico es depositional/stratigraphic',
    strat.trace_type === 'contact' && strat.contact_type === 'depositional' && strat.depositional_contact_type === 'stratigraphic');
  ok('cubierto es concealed', strat.trace_quality === 'concealed', strat.trace_quality);

  const structural = linea2('structural-contact');
  ok('el contacto estructural sigue siendo contacto',
    structural.trace_type === 'contact' && structural.contact_type === 'other'
      && structural.other_contact_type === 'structural contact');

  const dique = linea2('dike');
  ok('un dique es contacto intrusivo, no estructura',
    dique.trace_type === 'contact' && dique.intrusive_contact_type === 'dike');

  ok('antiforme -> anticline', linea2('antiform').fold_type === 'anticline');
  ok('sinforme -> syncline', linea2('synform').fold_type === 'syncline');
  ok('el eje de pliegue es traza axial', linea2('antiform').geologic_structure_type === 'fold_axial_tra');

  // --- el poligono entra como superficie, y su unidad como tag del proyecto
  ok('el poligono lleva surface_feature', poligono.properties.surface_feature.surface_feature_type === 'rock_unit');
  ok('el poligono no lleva trace', !poligono.properties.trace);
  ok('se genera un tag por unidad', tags.length === 1);
  ok('el tag es de unidad geologica', tags[0].type === 'geologic_unit');
  ok('el tag lleva nombre, sigla y color',
    tags[0].name === 'Fm. Cura-Mallin' && tags[0].unit_label_abbreviation === 'Kcm' && tags[0].color === '#ffb74d');
  ok('el tag apunta al spot del poligono', tags[0].spots.includes(poligono.properties.id));

  const alteracion = featuresToSpots([
    { type: 'Feature', properties: { id: 'a', kind: 'polygon', type: 'alteration-zone', unit: 'Argilica' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
  ]).collection.features[0].properties.surface_feature;
  ok('una zona de alteracion no se declara unidad de roca',
    alteracion.surface_feature_type === 'other' && alteracion.other_surface_feature_type === 'alteration zone');

  const soloPuntos = featuresToSpots([{ properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }]);
  ok('un punto que no es medida no se sube', soloPuntos.count === 0);
}

console.log('== los tags de unidad se mezclan, no se pisan ==');
{
  const proyecto = {
    id: 1, description: { project_name: 'P' },
    tags: [
      { id: 9, type: 'geologic_unit', name: 'Fm. Cura-Mallin', color: '#123456', rock_type: 'sedimentary', spots: [111] },
      { id: 8, type: 'concept', name: 'Otro', spots: [222] },
    ],
  };
  const nuevos = [
    { id: 7, type: 'geologic_unit', name: 'fm. cura-mallin', color: '#ffffff', spots: [333] },
    { id: 6, type: 'geologic_unit', name: 'Fm. Nueva', color: '#00ff00', spots: [444] },
  ];
  const { project, added, updated } = mergeGeologicUnitTags(proyecto, nuevos);

  ok('la unidad que ya existia no se duplica', project.tags.filter((t) => t.type === 'geologic_unit').length === 2);
  ok('el color propio del proyecto se respeta', project.tags[0].color === '#123456');
  ok('la litologia del proyecto se respeta', project.tags[0].rock_type === 'sedimentary');
  ok('pero gana los spots nuevos', JSON.stringify(project.tags[0].spots) === JSON.stringify([111, 333]));
  ok('los tags que no son de unidad no se tocan', project.tags[1].type === 'concept');
  ok('la unidad nueva se agrega', project.tags[2].name === 'Fm. Nueva');
  ok('informa de lo agregado y lo actualizado', added.length === 1 && updated.length === 1);
  ok('el resto del proyecto viaja entero', project.description.project_name === 'P' && project.id === 1);
  ok('marca el proyecto como modificado', typeof project.modified_timestamp === 'number');

  const vacio = mergeGeologicUnitTags({ id: 2 }, nuevos);
  ok('un proyecto sin tags no revienta', vacio.project.tags.length === 2);
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

console.log('== leer la simbología de StraboSpot ==');
{
  const tipo = (t) => straboLineType(t).type;
  ok('una falla inversa entra como cabalgamiento',
     tipo('geologic structure fault thrust') === 'thrust-fault', tipo('geologic structure fault thrust'));
  ok('«reverse» también', tipo('geologic structure fault reverse') === 'thrust-fault');
  ok('normal, dextral y sinestral se distinguen',
     tipo('geologic structure fault normal') === 'normal-fault' &&
     tipo('geologic structure fault dextral') === 'dextral-fault' &&
     tipo('geologic structure fault sinistral') === 'sinistral-fault');
  ok('una falla sin sentido de movimiento es indiferenciada',
     tipo('geologic structure fault') === 'undefined-fault', tipo('geologic structure fault'));
  ok('el eje de un anticlinal es un antiforme',
     tipo('geologic structure fold axial trace anticline') === 'antiform');
  ok('y el de un sinclinal, un sinforme',
     tipo('geologic structure fold axial trace syncline') === 'synform');
  ok('un contacto depositacional es estratigráfico',
     tipo('contact depositional stratigraphic') === 'stratigraphic-contact');
  ok('un dique gana al contacto intrusivo, que es lo específico',
     tipo('contact intrusive dike') === 'dike', tipo('contact intrusive dike'));
  ok('un contacto intrusivo sin más es contacto intrusivo',
     tipo('contact intrusive') === 'intrusive-contact');
  ok('el contacto estructural vuelve como lo que subió',
     tipo('contact other structural contact') === 'structural-contact',
     tipo('contact other structural contact'));

  const sinTipo = straboLineType('');
  ok('sin tipo cae en el contacto neutro', sinTipo.type === 'stratigraphic-contact');
  ok('y se declara adivinado, para poder avisar', sinTipo.exact === false);
  ok('lo que sí casa se declara exacto', straboLineType('contact intrusive').exact === true);
  // Un dataset escrito a mano en castellano: lo lee el mismo lector de cartas
  // ajenas que ya se usa al adoptar un GeoPackage.
  ok('«falla inversa» escrito a mano también se entiende',
     tipo('falla inversa') === 'thrust-fault', tipo('falla inversa'));

  ok('la calidad de la traza decide la certeza',
     straboCertainty('known') === 'observed' &&
     straboCertainty('inferred') === 'inferred' &&
     straboCertainty('concealed') === 'covered');
  ok('sin calidad declarada, observado', straboCertainty('') === 'observed');

  ok('las superficies medidas se traducen',
     straboStructureType('bedding').type === 'bedding' &&
     straboStructureType('foliation').type === 'foliation' &&
     straboStructureType('fracture').type === 'joint' &&
     straboStructureType('fault normal').type === 'fault-plane');
  ok('una superficie sin tipo se asume estratificación, y se declara adivinada',
     straboStructureType('').type === 'bedding' && straboStructureType('').exact === false);
}

console.log('== adoptar un dataset ==');
{
  const fc = (features) => ({ type: 'FeatureCollection', features });
  const data = {
    datasetName: 'Río Blanco 2026',
    estructuras: fc([
      {
        type: 'Feature',
        properties: { Name: 'E-1', Type: 'bedding', Strike: 30, Dip: 70, Azimuth: 120, Unit: 'Fm Nieves', Notes: 'banco masivo' },
        geometry: { type: 'Point', coordinates: [-71.3, -37.4] },
      },
      // Un punto de paso: sin rumbo ni manteo no es una medida.
      {
        type: 'Feature',
        properties: { Name: 'E-2', Type: 'bedding' },
        geometry: { type: 'Point', coordinates: [-71.2, -37.3] },
      },
    ]),
    observacion: fc([
      {
        type: 'Feature',
        properties: { Name: 'M-1', 'Sample Code': 'RB-01' },
        geometry: { type: 'Point', coordinates: [-71.25, -37.35] },
      },
    ]),
    lineas: fc([
      {
        type: 'Feature',
        properties: { Name: 'F-1', Type: 'geologic structure fault thrust', Quality: 'inferred' },
        geometry: { type: 'LineString', coordinates: [[-71.3, -37.4], [-71.2, -37.3]] },
      },
      {
        type: 'Feature',
        properties: { Name: 'U-1', Type: 'rock unit', Unit: 'Granodiorita Lolco', Quality: 'known' },
        geometry: { type: 'Polygon', coordinates: [[[-71.3, -37.4], [-71.2, -37.4], [-71.2, -37.3], [-71.3, -37.4]]] },
      },
    ]),
  };

  let n = 0;
  const r = adoptStrabo(data, { units: [], newId: () => `x${++n}` });

  ok('cuenta lo que entró', r.stats.points === 1 && r.stats.lines === 1 && r.stats.polygons === 1,
     JSON.stringify(r.stats));
  ok('y descarta el punto sin rumbo ni manteo', r.stats.skipped === 1);

  const medida = r.features.find((f) => f.properties.geomKind === 'measurement');
  ok('la medida llega con su rumbo y su manteo',
     medida.properties.strike === 30 && medida.properties.dip === 70);
  ok('con el azimut que traía, no uno recalculado', medida.properties.dipAzimuth === 120);
  ok('y con método propio, que no es ni brújula de aquí ni ajuste sobre el DEM',
     medida.properties.method === 'strabospot');
  ok('la procedencia va en la nota del elemento, que es la que se exporta',
     medida.properties.note.includes('Río Blanco 2026') && medida.properties.note.includes('E-1'),
     medida.properties.note);

  const falla = r.features.find((f) => f.properties.kind === 'line');
  ok('la falla inversa entra como cabalgamiento', falla.properties.type === 'thrust-fault');
  ok('y la calidad de la traza, como certeza inferida', falla.properties.certainty === 'inferred');

  const poligono = r.features.find((f) => f.properties.kind === 'polygon');
  const granodiorita = r.units.find((u) => u.name === 'Granodiorita Lolco');
  const nieves = r.units.find((u) => u.name === 'Fm Nieves');
  ok('el tag de unidad se convierte en una unidad del proyecto',
     r.units.length === 2 && !!granodiorita && !!nieves, JSON.stringify(r.units));
  ok('y el polígono apunta a ella', poligono.properties.type === granodiorita.id);
  ok('la litología se adivina del nombre de la unidad',
     granodiorita.color === '#E57373', granodiorita.color);
  ok('la medida lleva su unidad en el campo Unit, enlazada al catálogo',
     medida.properties.unitId === nieves.id && medida.properties.unit === 'Fm Nieves',
     JSON.stringify(medida.properties));

  ok('todo lo adoptado queda marcado como venido de StraboSpot',
     r.features.every((f) => f.properties.source === 'strabospot'));
  ok('la observación entra como punto de control, no como medida',
     r.features.length === 4 && r.stats.controlPoints === 1, JSON.stringify(r.stats));
  ok('avisa de lo que descartó', r.warnings.some((w) => w.includes('skipped')), r.warnings.join(' | '));

  // Una unidad que ya existe no se duplica: el polígono se cuelga de ella.
  const otra = adoptStrabo(data, {
    units: [{ id: 'u-existente', name: 'Granodiorita Lolco', code: 'Gl', color: '#123456' }],
    newId: () => `y${++n}`,
  });
  ok('una unidad que ya existe no se duplica',
     otra.units.filter((u) => u.name === 'Granodiorita Lolco').length === 1 &&
       otra.stats.newUnits === 1,
     JSON.stringify(otra.units));
  ok('y el polígono se cuelga de la que había',
     otra.features.find((f) => f.properties.kind === 'polygon').properties.type === 'u-existente');
}

console.log('== la calidad de la traza sobrevive a la bajada ==');
{
  const [linea] = buildLineasPoligonos([
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      properties: {
        id: 'l1',
        name: 'F-9',
        trace: { trace_feature: true, trace_type: 'geologic_struc', geologic_structure_type: 'fault', shear_sense: 'thrust', trace_quality: 'concealed' },
      },
    },
  ]);
  ok('la columna Quality trae la calidad de la traza', linea.properties.Quality === 'concealed',
     JSON.stringify(linea.properties));
  ok('y el tipo sigue armándose de lo general a lo particular',
     linea.properties.Type === 'geologic structure fault thrust', linea.properties.Type);

  const [contacto] = buildLineasPoligonos([
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      properties: {
        id: 'l2',
        trace: { trace_feature: true, trace_type: 'contact', contact_type: 'other', other_contact_type: 'structural contact' },
      },
    },
  ]);
  ok('el término escrito a mano de un «other» no se pierde',
     contacto.properties.Type.includes('structural contact'), contacto.properties.Type);
}

console.log('== unidades y sentido de falla, de ida y vuelta ==');
{
  const tags = [
    { name: 'Outcrop', type: 'other', spots: [1, 2] },
    { name: 'Fm Abanico', type: 'geologic_unit', spots: [1] },
    { name: 'Granito viejo', unit_label_abbreviation: 'Pzg', spots: [2] },
  ];
  const porSpot = spotTagsFrom(tags);
  ok('solo los tags de unidad geológica dan la columna Unit',
     JSON.stringify(porSpot) === JSON.stringify({ 1: ['Fm Abanico'], 2: ['Granito viejo'] }),
     JSON.stringify(porSpot));

  ok('el sentido de falla se lee del tipo',
     straboFaultSense('fault normal') === 'normal' &&
       straboFaultSense('fault reverse') === 'inverse' &&
       straboFaultSense('fault thrust') === 'inverse' &&
       straboFaultSense('fault sinistral') === 'left-lateral' &&
       straboFaultSense('fault dextral_normal') === 'right-lateral' &&
       straboFaultSense('fault') === '' &&
       straboFaultSense('bedding normal') === '');

  const fc = (features) => ({ type: 'FeatureCollection', features });
  let n = 0;
  const r = adoptStrabo(
    {
      estructuras: fc([
        {
          type: 'Feature',
          properties: { Name: 'F-9', Type: 'fault sinistral', Strike: 10, Dip: 80 },
          geometry: { type: 'Point', coordinates: [-71.3, -37.4] },
        },
      ]),
    },
    { newId: () => `z${++n}` },
  );
  ok('el plano de falla adoptado conserva su sentido',
     r.features[0].properties.type === 'fault-plane' &&
       r.features[0].properties.faultSense === 'left-lateral',
     JSON.stringify(r.features[0].properties));

  const planar = planarOrientation({ type: 'fault-plane', faultSense: 'inverse', strike: 10, dip: 40 }, 1);
  ok('y sube con el fault_or_sz_type de StraboSpot',
     planar.feature_type === 'fault' && planar.fault_or_sz_type === 'reverse', JSON.stringify(planar));
  ok('una estratificación no declara sentido',
     planarOrientation({ type: 'bedding', faultSense: 'normal', strike: 1, dip: 2 }, 1).fault_or_sz_type === undefined);

  // Una medida con la unidad escrita pero sin id (adopciones anteriores)
  // también sube con su tag.
  const { tags: subida } = featuresToSpots(
    [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-71.3, -37.4] },
        properties: { id: 'm1', kind: 'point', geomKind: 'measurement', type: 'bedding', strike: 10, dip: 20, unit: 'Fm Nieves' },
      },
    ],
    { units: [{ id: 'u1', name: 'Fm Nieves', code: 'Kn', color: '#123456' }] },
  );
  ok('la unidad sin id se resuelve por nombre al subir',
     subida.length === 1 && subida[0].name === 'Fm Nieves' && subida[0].unit_label_abbreviation === 'Kn',
     JSON.stringify(subida));
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
