/**
 * Puntos de control: el modelo, la fecha de toma, la salida a CSV y a
 * GeoPackage, la adopción desde StraboSpot y la vuelta a StraboSpot como
 * muestra.
 *
 * Lo que se vigila aquí, más que cada función suelta, son las dos cosas que
 * este tipo de punto promete: que la FECHA DE TOMA no se pierde ni se
 * reemplaza por la de la exportación, y que el CÓDIGO DE MUESTRA no se hereda
 * de un punto al siguiente —dos muestras con el mismo código ya no se pueden
 * separar en el laboratorio.
 */

const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

const CP = await import(BASE + 'controlPoints.js');
const St = await import(BASE + 'store.js');

const punto = (props, coords = [-70.48, -33.73]) => ({
  type: 'Feature',
  properties: { kind: 'point', geomKind: 'control-point', ...props },
  geometry: { type: 'Point', coordinates: coords },
});

console.log('== modelo ==');
{
  ok('el propósito es una lista cerrada con los valores de StraboSpot',
     CP.SAMPLING_PURPOSES.every((p) => /^[a-z_]+$/.test(p.id)));
  ok('y contiene los dos verificados contra un export real',
     CP.PURPOSE_BY_ID.has('geochronology') && CP.PURPOSE_BY_ID.has('petrology'));
  ok('no hay campo de litología: va en las notas',
     !CP.CONTROL_POINT_COLUMNS.some((c) => /litho/i.test(c.csv)));

  const t = new Date(2026, 0, 6, 15, 29, 36).getTime();
  ok('la fecha se formatea en hora local, legible',
     CP.formatCaptureDate(t) === '2026-01-06 15:29:36', CP.formatCaptureDate(t));

  const estilo = CP.sanitizeControlPointStyle({ labelField: 'inventado', size: 99 });
  ok('un campo de rótulo desconocido cae al de fábrica', estilo.labelField === 'sampleId');
  ok('y el tamaño se acota', estilo.size === CP.CONTROL_POINT_SIZE_LIMITS.max, String(estilo.size));
  ok('el rótulo del mapa y la columna del GeoPackage son el mismo campo',
     CP.labelColumnFor('sampleId') === 'sample_id' && CP.labelColumnFor('none') === null);
  ok('Name es una opción de rótulo, para el punto sin muestra que igual necesita nombre',
     CP.LABEL_FIELD_BY_ID.has('name') && CP.labelColumnFor('name') === 'name');
  ok('Name va primero en las columnas: es la identidad del punto, antes que la de la muestra',
     CP.CONTROL_POINT_COLUMNS[0].csv === 'Name' && CP.CONTROL_POINT_COLUMNS[0].gpkg === 'name');
}

console.log('== CSV ==');
{
  const features = [
    punto({
      sampleId: 'ACRC1',
      sampleDescription: 'CT, litarenita',
      purpose: 'petrology',
      note: 'Granodiorita de bt, grano medio',
      unit: 'Plutón La Obra',
      code: 'Migla',
      createdAt: new Date(2026, 0, 6, 15, 29, 36).getTime(),
    }),
    // Una medida no es un punto de control y no tiene nada que hacer aquí.
    {
      type: 'Feature',
      properties: { kind: 'point', geomKind: 'measurement', strike: 30, dip: 70 },
      geometry: { type: 'Point', coordinates: [-70.4, -33.7] },
    },
  ];
  const csv = CP.controlPointsCSV(features);
  const lineas = csv.replace(/^﻿/, '').trim().split('\r\n');

  ok('lleva BOM, o Excel en Windows rompe los acentos', csv.startsWith('﻿'));
  ok('solo exporta puntos de control', lineas.length === 2, `-> ${lineas.length}`);
  ok('el encabezado empieza por el nombre del punto y el código de muestra',
     lineas[0].startsWith('Name,Sample ID,Date,Unit,Code,Purpose'), lineas[0]);
  ok('y termina en las coordenadas, que un CSV no puede guardar de otro modo',
     lineas[0].endsWith('Longitude,Latitude'), lineas[0]);
  ok('la fecha de toma sale formateada, sin pedírsela a nadie',
     lineas[1].includes('2026-01-06 15:29:36'), lineas[1]);
  ok('una descripción con coma se entrecomilla',
     lineas[1].includes('"CT, litarenita"'), lineas[1]);
  ok('y las coordenadas van al final', lineas[1].endsWith('-70.48,-33.73'), lineas[1]);

  const raro = CP.controlPointsCSV([punto({ sampleId: 'A"1', note: 'linea1\nlinea2' })]);
  ok('las comillas se duplican y el salto de línea no parte la fila',
     raro.includes('"A""1"') && raro.includes('"linea1\nlinea2"'));
}

console.log('== store ==');
{
  St.loadFeatures([]);
  St.setControlPointField({ unit: 'sedimentary-unit', purpose: 'geochronology', sampleId: 'ATRC2' });
  St.setControlPointField({ sampleDescription: 'AFT AHe', note: 'granodiorita de anf', name: 'DCR02' });
  const antes = Date.now();
  const f = St.createControlPoint({ lngLat: [-70.48, -33.73] });
  const p = f.properties;

  ok('el punto hereda lo que decía la paleta',
     p.sampleId === 'ATRC2' && p.purpose === 'geochronology' && p.sampleDescription === 'AFT AHe');
  ok('incluido su propio nombre, distinto del código de muestra',
     p.name === 'DCR02', p.name);
  ok('y la unidad, con su nombre y su código denormalizados',
     p.unitId === 'sedimentary-unit' && p.unit && p.code === 'SED', JSON.stringify(p.unit));
  ok('la fecha se sella sola al colocarlo', p.createdAt >= antes && p.createdAt <= Date.now());
  ok('nace seleccionado y devuelve a Elegir, como una medida',
     St.getState().selection[0] === p.id && St.getState().tool === 'select');

  const s = St.getState();
  ok('el nombre y el código de muestra NO se heredan al punto siguiente',
     s.controlPointName === '' && s.controlPointSampleId === '');
  ok('ni la descripción ni las notas', s.controlPointSampleDescription === '' && s.controlPointNote === '');
  ok('la unidad y el propósito sí se quedan puestos: se repiten toda la jornada',
     s.controlPointUnit === 'sedimentary-unit' && s.controlPointPurpose === 'geochronology');

  St.setControlPointField({ purpose: 'lo-que-sea' });
  ok('un propósito fuera de la lista no entra en la paleta',
     St.getState().controlPointPurpose === '');

  St.updateControlPoint({ name: 'DCR02b', sampleId: 'ATRC3', note: 'reescrito' });
  const editado = St.getState().features.find((x) => x.properties.id === p.id).properties;
  ok('se puede corregir después',
     editado.name === 'DCR02b' && editado.sampleId === 'ATRC3' && editado.note === 'reescrito');
  ok('y la fecha de toma no se toca al editar', editado.createdAt === p.createdAt);

  St.assignUnitToSelection('volcanic-unit');
  const reunido = St.getState().features.find((x) => x.properties.id === p.id).properties;
  ok('la unidad se cambia como en una medida', reunido.unitId === 'volcanic-unit');

  St.removeUnit('volcanic-unit');
  const huerfano = St.getState().features.find((x) => x.properties.id === p.id).properties;
  ok('borrar la unidad le quita la etiqueta entera, sin dejarla apuntando a nada',
     huerfano.unitId === undefined && huerfano.unit === undefined);

  ok('sin coordenadas válidas no se crea nada', St.createControlPoint({ lngLat: [NaN, 0] }) === null);
}

console.log('== proyecto ==');
{
  const P = await import(BASE + 'project.js');
  const guardado = {
    format: 'fielddraw-project',
    version: 1,
    features: [
      punto({ id: 'cp1', name: 'DCR02', sampleId: 'ACRC1', purpose: 'petrology', createdAt: 1767000000000 }),
      // Un punto sin rumbo ni manteo que tampoco es de control: ese sí se tira.
      {
        type: 'Feature',
        properties: { id: 'x', kind: 'point' },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    ],
  };
  const { project } = P.parseProject(JSON.stringify(guardado));
  ok('un punto de control sobrevive a guardar y abrir el proyecto',
     project.features.length === 1 && project.features[0].properties.sampleId === 'ACRC1',
     JSON.stringify(project.features.map((f) => f.properties.geomKind)));
  ok('con su fecha de toma intacta', project.features[0].properties.createdAt === 1767000000000);
  ok('y con su propio nombre, no solo el de la muestra',
     project.features[0].properties.name === 'DCR02');
}

console.log('== GeoPackage ==');
{
  const G = await import(BASE + 'gpkg/index.js');
  const Q = await import(BASE + 'gpkg/qml.js');
  const units = [{ id: 'u1', name: 'Abanico', code: 'OMa', color: '#E57373' }];
  const puntos = [
    punto({ name: 'DCR02', unit: 'Abanico', sampleId: 'A1' }),
    punto({ unit: 'Unidad que ya no está en el catálogo' }),
    punto({}),
  ];

  const presentes = G.controlPointUnits(puntos, units);
  ok('la leyenda solo trae las unidades presentes', presentes.length === 2, JSON.stringify(presentes));
  ok('con el código al lado, que es como se rotula una carta',
     presentes[0].label === 'Abanico (OMa)', presentes[0].label);
  ok('una unidad que ya no está en el catálogo se conserva igual, en gris',
     presentes[1].color === CP.CONTROL_POINT_NO_UNIT_COLOR);

  ok('los valores de una fila cuadran con las columnas declaradas',
     CP.controlPointValues(puntos[0].properties).length === CP.CONTROL_POINT_COLUMNS.length);
  ok('el nombre del punto es el primer valor de la fila',
     CP.controlPointValues(puntos[0].properties)[0] === 'DCR02');

  const fs = await import('node:fs');
  const gpkgSrc = fs.readFileSync(new URL(BASE + 'gpkg/index.js', import.meta.url), 'utf8');
  ok('el esquema del GeoPackage declara la columna name',
     /CREATE TABLE geol_control_points \([\s\S]*?\bname TEXT,/.test(gpkgSrc));

  const qml = Q.buildControlPointQML(presentes, 'sample_id');
  ok('el QML categoriza por unidad', qml.includes("&quot;unit&quot; = 'Abanico'"));
  ok('y rotula por el campo elegido', qml.includes('fieldName="sample_id"'));
  ok('un punto sin unidad no desaparece del mapa: cae en la regla ELSE',
     qml.includes('filter="ELSE"'));
  const sinRotulo = Q.buildControlPointQML(presentes, null);
  ok('«sin rótulo» no escribe bloque de etiquetado', !sinRotulo.includes('<labeling'));
}

console.log('== adopción desde StraboSpot ==');
{
  const A = await import(BASE + 'strabo/adopt.js');
  const fc = (features) => ({ type: 'FeatureCollection', features });
  const r = A.adoptStrabo(
    {
      datasetName: 'Cajón del Maipo',
      estructuras: fc([]),
      lineas: fc([]),
      observacion: fc([
        {
          type: 'Feature',
          properties: {
            Name: 'DCR02',
            Date: '2026-01-06T18:29:36.000Z',
            Unit: 'Plutón La Obra',
            Notes: 'Granodiorita de bt',
            'Sample Code': 'ATRC2',
            'Sample Description': 'AFT AHe',
            Purpose: 'geochronology',
            Altitude: 1120,
          },
          geometry: { type: 'Point', coordinates: [-70.487, -33.738] },
        },
        {
          type: 'Feature',
          properties: { Name: 'DCR03', Unit: 'Abanico', Notes: 'contacto cubierto' },
          geometry: { type: 'Point', coordinates: [-70.49, -33.72] },
        },
      ]),
    },
    { units: [] },
  );

  const [muestra, sinMuestra] = r.features;
  ok('la observación entra como punto de control', muestra.properties.geomKind === 'control-point');
  ok('con el nombre del spot de StraboSpot', muestra.properties.name === 'DCR02');
  ok('con el código de muestra de StraboSpot', muestra.properties.sampleId === 'ATRC2');
  ok('su descripción y su propósito, sin traducir el vocabulario ajeno',
     muestra.properties.sampleDescription === 'AFT AHe' && muestra.properties.purpose === 'geochronology');
  ok('la fecha es la del terreno, no la de la importación',
     muestra.properties.createdAt === Date.parse('2026-01-06T18:29:36.000Z'),
     new Date(muestra.properties.createdAt).toISOString());
  ok('la procedencia va en la nota, junto a lo que el geólogo escribió',
     muestra.properties.note.includes('Granodiorita de bt') &&
       muestra.properties.note.includes('Cajón del Maipo'),
     muestra.properties.note);
  ok('la altitud del spot se conserva', muestra.properties.altitude === 1120);
  ok('el tag de unidad se vuelve una unidad del proyecto y el punto la apunta',
     r.units.length === 2 && muestra.properties.unitId === r.units[0].id);
  ok('dos unidades distintas no entran del mismo color, o el color por unidad no diría nada',
     r.units[0].color !== r.units[1].color, r.units.map((u) => u.color).join());
  ok('todo lo adoptado queda marcado como venido de StraboSpot',
     r.features.every((f) => f.properties.source === 'strabospot'));
  ok('un punto sin muestra igual llega con su nombre: es su única identidad',
     sinMuestra.properties.name === 'DCR03' && sinMuestra.properties.sampleId === '');
}

console.log('== vuelta a StraboSpot ==');
{
  const U = await import(BASE + 'strabo/upload.js');
  const cp = punto({
    id: 'cp1',
    name: 'DCR02',
    sampleId: 'ATRC2',
    sampleDescription: 'AFT AHe',
    purpose: 'geochronology',
    note: 'Granodiorita de bt',
    unitId: 'u1',
    unit: 'Plutón La Obra',
    code: 'Migla',
    createdAt: Date.parse('2026-01-06T18:29:36.000Z'),
  });
  const r = U.featuresToSpots([cp], {
    units: [{ id: 'u1', name: 'Plutón La Obra', code: 'Migla', color: '#E57373' }],
    geologist: 'MEV',
  });
  const spot = r.collection.features[0].properties;
  const [sample] = spot.samples;

  ok('un punto de control es subible', U.uploadableCount([cp]) === 1);
  ok('y se cuenta aparte en el desglose', U.uploadBreakdown([cp]).controlPoints === 1);
  ok('sube como muestra, no como medición', !!sample && !('orientation_data' in spot));
  ok('el Sample ID alimenta el Specific ID/Name de StraboSpot',
     sample.sample_id_name === 'ATRC2');
  ok('la descripción alimenta su homóloga', sample.sample_description === 'AFT AHe');
  ok('el propósito viaja con el valor de su lista', sample.main_sampling_purpose === 'geochronology');
  ok('la fecha de recolección es la de la toma, no la de la subida',
     sample.collection_date === '2026-01-06T18:29:36.000Z' && spot.date === sample.collection_date,
     `${sample.collection_date} / ${spot.date}`);
  ok('no se inventan las observaciones del formulario que nadie hizo',
     !('material_type' in sample) && !('degree_of_weathering' in sample) &&
       !('inplaceness_of_sample' in sample));
  ok('el spot se llama como el punto —la estación—, no como la muestra',
     spot.name === 'DCR02', spot.name);
  ok('la unidad sube como tag geologic_unit con el punto colgado',
     r.tags.length === 1 && r.tags[0].name === 'Plutón La Obra' && r.tags[0].spots.length === 1);

  const soloMuestra = punto({ id: 'cp2', sampleId: 'ATRC3', createdAt: Date.now() });
  const r2 = U.featuresToSpots([soloMuestra], {});
  ok('sin nombre propio, el spot se llama como la muestra',
     r2.collection.features[0].properties.name === 'ATRC3');

  const sinNinguno = punto({ id: 'cp3', note: 'punto de observación', createdAt: Date.now() });
  const r3 = U.featuresToSpots([sinNinguno], {});
  ok('sin nombre ni código de muestra también sube, y se numera por lo que es',
     r3.collection.features[0].properties.name === 'Control point 1',
     r3.collection.features[0].properties.name);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
