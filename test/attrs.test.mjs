const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

// attrs.js toca el DOM solo dentro de las funciones que pintan; las de aquí
// son puras y se pueden probar sin navegador.
const A = await import(BASE + 'attrs.js');

console.log('== formato de un valor ==');
ok('un texto pasa tal cual', A.formatValue('Fm. Cura-Mallín') === 'Fm. Cura-Mallín');
ok('un entero no gana decimales', A.formatValue(1) === '1');
ok('un decimal no arrastra ruido binario', A.formatValue(0.1 + 0.2) === '0.3');
ok('un booleano se escribe', A.formatValue(false) === 'false');
// Vacío y ausente se distinguen con una raya: en un GeoPackage esa diferencia
// es información, y una celda en blanco las confunde.
ok('null es raya', A.formatValue(null) === '—');
ok('undefined es raya', A.formatValue(undefined) === '—');
ok('cadena vacía es raya', A.formatValue('') === '—');
ok('el cero NO es raya', A.formatValue(0) === '0');
ok('un objeto se serializa', A.formatValue({ a: 1 }) === '{"a":1}');

console.log('== qué campos se enseñan ==');
{
  const f = {
    properties: {
      fid: 7,
      geom: new Uint8Array([1, 2, 3]),
      unit: 'Fm. Cura-Mallín',
      code: 'Kcm',
      note: '',
    },
  };
  const e = A.importedEntries(f);
  const claves = e.map(([k]) => k);
  // fid se queda: es lo que permite volver a encontrar la fila en QGIS.
  ok('la clave de la fila se conserva', claves.includes('fid'));
  ok('la columna de geometría se descarta', !claves.includes('geom'));
  ok('un campo vacío se conserva', claves.includes('note'));
  ok('respeta el orden de la tabla', claves.join() === 'fid,unit,code,note', claves.join());

  const conBlob = A.importedEntries({ properties: { foto: new Uint8Array([9]) } });
  ok('cualquier blob se descarta, no solo la geometría', conBlob.length === 0);

  ok('sin propiedades no revienta', A.importedEntries({}).length === 0);
  ok('sin feature tampoco', A.importedEntries(null).length === 0);

  // Otros nombres de columna de geometría que usan QGIS, PostGIS y ogr2ogr.
  for (const g of ['geometry', 'the_geom', 'SHAPE', 'wkb_geometry']) {
    ok(`descarta "${g}"`, A.importedEntries({ properties: { [g]: 1, x: 2 } }).length === 1);
  }
}

console.log('== título del recuadro ==');
{
  const t = (props) => A.importedTitle('Unidades de mapa', { properties: props });
  // Lo que identifica al polígono es su unidad, no la tabla en la que vive.
  ok('gana el campo que lo nombra', t({ fid: 1, unit: 'Fm. Cura-Mallín' }) === 'Fm. Cura-Mallín · Unidades de mapa');
  ok('la capa acompaña siempre', t({ unit: 'X' }).endsWith(' · Unidades de mapa'));
  ok('sin campo de nombre, la capa sola', t({ fid: 1, area_m2: 33 }) === 'Unidades de mapa');

  // Los nombres de columna vienen como los dejó quien hizo la capa.
  ok('la mayúscula no importa', t({ NOMBRE: 'Cerro Azul' }) === 'Cerro Azul · Unidades de mapa');
  ok('el acento tampoco', t({ 'código': 'Kcm' }) === 'Kcm · Unidades de mapa');

  // Un campo presente pero vacío no nombra nada: hay que seguir buscando.
  ok('un nombre vacío no gana', t({ name: '   ', unit: 'Fm. X' }) === 'Fm. X · Unidades de mapa');
  ok('el orden de preferencia manda', t({ tipo: 'Falla', nombre: 'Los Maitenes' }) === 'Los Maitenes · Unidades de mapa');
  ok('un número también nombra', t({ code: 3 }) === '3 · Unidades de mapa');
  ok('sin propiedades, la capa sola', A.importedTitle('Capa', {}) === 'Capa');
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
