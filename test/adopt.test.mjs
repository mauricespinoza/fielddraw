const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

const A = await import(BASE + 'adopt.js');

const capa = (features, label = 'Carta') => ({
  id: 'imp-1',
  label,
  geojson: { type: 'FeatureCollection', features },
});
const linea = (properties) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
});
const poligono = (properties) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});
/** Contador reproducible, para que los ids no cambien entre corridas. */
const contador = () => {
  let i = 0;
  return () => `id${++i}`;
};

console.log('== el propio GeoPackage vuelve idéntico ==');
{
  /*
   * Es el caso que más se repite: exportar a GeoPackage, abrirlo en QGIS,
   * volver a importarlo. Aquí acertar del todo no es deseable, es obligatorio;
   * si el tipo se «adivinara» el mapa cambiaría de simbología al ir y volver.
   */
  const r = A.adoptLayer(
    capa([
      linea({ type: 'thrust-fault', certainty: 'inferred' }),
      linea({ type: 'antiform', certainty: 'covered' }),
      poligono({ type: 'volcanic-unit', unit: 'Volcanic unit' }),
    ]),
    { units: [{ id: 'volcanic-unit', name: 'Volcanic unit', code: 'V', color: '#BA68C8' }], newId: contador() },
  );
  ok('el cabalgamiento se conserva', r.features[0].properties.type === 'thrust-fault');
  ok('y su certeza', r.features[0].properties.certainty === 'inferred');
  // Un eje de pliegue solo se cartografía observado; entrar «cubierto» desde
  // fuera tiene que corregirse aquí y no colarse en el dibujo.
  ok('un pliegue se normaliza a observado', r.features[1].properties.certainty === 'observed');
  ok('nada se adivinó', r.stats.guessed === 0, String(r.stats.guessed));
  ok('la unidad existente se reutiliza', r.stats.newUnits === 0);
  ok('sin unidades nuevas la lista no crece', r.units.length === 1);
}

console.log('== una carta ajena en castellano ==');
{
  const r = A.adoptLayer(
    capa([
      linea({ TIPO: 'Falla inversa' }),
      linea({ tipo: 'Falla normal' }),
      linea({ tipo: 'Falla dextral' }),
      linea({ tipo: 'Falla sinestral' }),
      linea({ tipo: 'Falla' }),
      linea({ tipo: 'Contacto', certeza: 'inferido' }),
      linea({ tipo: 'Contacto intrusivo' }),
      linea({ tipo: 'Eje de anticlinal' }),
      linea({ tipo: 'Sinclinal' }),
      linea({ tipo: 'Dique' }),
    ]),
    { newId: contador() },
  );
  const tipos = r.features.map((f) => f.properties.type);
  ok('falla inversa', tipos[0] === 'thrust-fault', tipos[0]);
  ok('falla normal', tipos[1] === 'normal-fault', tipos[1]);
  ok('falla dextral', tipos[2] === 'dextral-fault', tipos[2]);
  ok('falla sinestral', tipos[3] === 'sinistral-fault', tipos[3]);
  // «Falla» a secas tiene que caer en indiferenciada y no robarle las
  // específicas: por eso su palabra se prueba la última de la familia.
  ok('falla a secas es indiferenciada', tipos[4] === 'undefined-fault', tipos[4]);
  ok('contacto', tipos[5] === 'stratigraphic-contact', tipos[5]);
  ok('y su certeza en castellano', r.features[5].properties.certainty === 'inferred');
  ok('contacto intrusivo gana al contacto', tipos[6] === 'intrusive-contact', tipos[6]);
  ok('anticlinal', tipos[7] === 'antiform', tipos[7]);
  ok('sinclinal', tipos[8] === 'synform', tipos[8]);
  ok('dique', tipos[9] === 'dike', tipos[9]);
}

console.log('== unidades nacidas de la carta ==');
{
  /*
   * Lo que convierte una carta ajena en un proyecto propio. Sin esto, veinte
   * formaciones distintas entrarían todas como «unidad sedimentaria» y el mapa
   * perdería justo aquello que lo hacía un mapa.
   */
  const r = A.adoptLayer(
    capa([
      poligono({ unidad: 'Fm. Cura-Mallín', codigo: 'Kcm' }),
      poligono({ unidad: 'Fm. Cura-Mallín', codigo: 'Kcm' }),
      poligono({ unidad: 'Intrusivo Santa Bárbara', codigo: 'Msb' }),
    ]),
    { units: [], newId: contador() },
  );
  ok('se crean dos unidades, no tres', r.stats.newUnits === 2, String(r.stats.newUnits));
  ok('los dos polígonos de la misma formación comparten unidad',
     r.features[0].properties.type === r.features[1].properties.type);
  ok('y no la comparten con la otra',
     r.features[0].properties.type !== r.features[2].properties.type);
  ok('el código viaja a la unidad', r.units.some((u) => u.code === 'Kcm'));
  ok('el nombre queda denormalizado en el polígono',
     r.features[0].properties.unit === 'Fm. Cura-Mallín');

  // Una unidad que ya existe con ese nombre se reutiliza en vez de duplicarse.
  const conExistente = A.adoptLayer(
    capa([poligono({ unidad: 'Fm. Cura-Mallín' })]),
    { units: [{ id: 'u-previa', name: 'Fm. Cura-Mallín', code: 'Kcm', color: '#fff' }], newId: contador() },
  );
  ok('una unidad ya existente no se duplica', conExistente.stats.newUnits === 0);
  ok('y el polígono apunta a la que había',
     conExistente.features[0].properties.type === 'u-previa');
}

console.log('== multiparte ==');
{
  // El dibujo guarda líneas y polígonos SIMPLES. Quedarse con la primera parte
  // perdería el resto sin decirlo, así que se explota y se avisa.
  const r = A.adoptLayer(
    capa([
      {
        type: 'Feature',
        properties: { tipo: 'Falla' },
        geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]], [[4, 4], [5, 5]]] },
      },
    ]),
    { newId: contador() },
  );
  ok('una multilínea de tres partes da tres líneas', r.features.length === 3);
  ok('todas simples', r.features.every((f) => f.geometry.type === 'LineString'));
  ok('todas del mismo tipo', new Set(r.features.map((f) => f.properties.type)).size === 1);
  ok('se cuenta lo explotado', r.stats.exploded === 2, String(r.stats.exploded));
  ok('y se avisa', r.warnings.some((w) => w.includes('multipart')));
  ok('cada parte con su propio id', new Set(r.features.map((f) => f.properties.id)).size === 3);
}

console.log('== puntos ==');
{
  const punto = (properties) => ({
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates: [0, 0] },
  });
  const r = A.adoptLayer(
    capa([punto({ strike: 312, dip: 24, type: 'bedding' }), punto({ nombre: 'Muestra 3' })]),
    { newId: contador() },
  );
  ok('un punto con orientación es una medida', r.stats.points === 1);
  // Sin rumbo ni manteo, dibujar el símbolo afirmaría una orientación que
  // nadie midió: se descarta.
  ok('un punto sin orientación se descarta', r.stats.skipped === 1);
  ok('el rumbo llega como número', r.features[0].properties.strike === 312);
  ok('y se deriva la dirección de manteo', r.features[0].properties.dipAzimuth === 42);
}

console.log('== lo que la carta traía y no es nuestro ==');
{
  const r = A.adoptLayer(
    capa([linea({ tipo: 'Falla', autor: 'SERNAGEOMIN', escala_orig: 100000, fid: 12 })]),
    { newId: contador() },
  );
  const p = r.features[0].properties;
  // Perder los atributos del autor original al adoptar sería peor que no
  // poder editar: se conservan todos los que no pisamos.
  ok('los atributos ajenos se conservan', p.autor === 'SERNAGEOMIN' && p.escala_orig === 100000);
  ok('los nuestros se reescriben', p.type === 'undefined-fault' && p.kind === 'line');
  ok('el fid del origen no se cuela como id', p.id !== 12 && typeof p.id === 'string');
}

console.log('== casos límite ==');
{
  ok('una capa vacía no revienta', A.adoptLayer(capa([])).features.length === 0);
  ok('sin capa tampoco', A.adoptLayer(null).features.length === 0);
  const sinGeom = A.adoptLayer(capa([{ type: 'Feature', properties: {}, geometry: null }]));
  ok('un elemento sin geometría se descarta', sinGeom.stats.skipped === 1);
  ok('una línea sin atributos cae en contacto estratigráfico',
     A.adoptLayer(capa([linea({})])).features[0].properties.type === 'stratigraphic-contact');
  ok('normalizeText quita acentos y mayúsculas', A.normalizeText('Fallá INVERSA') === 'falla inversa');
  ok('explode deja pasar lo simple', A.explode({ type: 'LineString', coordinates: [] }).length === 1);
  ok('explode de algo desconocido da lista vacía', A.explode({ type: 'Rombo' }).length === 0);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
