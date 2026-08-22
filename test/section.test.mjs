const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const S = await import(BASE + 'section.js');
const X = await import(BASE + 'sectionExport.js');
const SH = await import(BASE + 'shapefile.js');

console.log('== manteo aparente ==');
{
  /*
   * Los dos casos donde la respuesta se sabe de antemano, y que son los que
   * separan un perfil correcto de uno inventado. Capa con rumbo N-S que mantea
   * 30° al Este.
   */
  ok('corte en la dirección de manteo da el manteo real',
     cerca(S.apparentDip(0, 30, 90), 30, 1e-9));
  ok('corte a lo largo del rumbo da cero',
     cerca(S.apparentDip(0, 30, 0), 0, 1e-9));
  // El clásico: a 45° del manteo, atan(tan30 · cos45) = 22.2°, no 21.2 ni 30.
  ok('corte a 45° achata el manteo',
     cerca(S.apparentDip(0, 30, 45), Math.atan(Math.tan(30 * Math.PI / 180) * Math.cos(45 * Math.PI / 180)) * 180 / Math.PI, 1e-9));
  // El signo dice hacia qué lado del corte cae la capa: recorrer el mismo
  // corte al revés tiene que invertirlo, o las capas saldrían espejadas.
  ok('recorrer el corte al revés invierte el signo',
     cerca(S.apparentDip(0, 30, 270), -30, 1e-9));
  ok('el aparente nunca supera al real',
     [0, 15, 30, 45, 60, 90, 120, 180, 270].every(
       (az) => Math.abs(S.apparentDip(0, 55, az)) <= 55 + 1e-9,
     ));
  ok('una capa horizontal sale horizontal en cualquier corte',
     [0, 37, 91, 200].every((az) => cerca(S.apparentDip(0, 0, az), 0, 1e-9)));
}

console.log('== manteo aparente de una lineación ==');
{
  // Al revés que un plano: una línea se EMPINA al apartarse el corte de su
  // rumbo, hasta verse vertical a 90°.
  ok('corte según el rumbo da el cabeceo real', cerca(S.apparentPlunge(0, 30, 0), 30, 1e-9));
  ok('corte perpendicular la pone vertical', cerca(Math.abs(S.apparentPlunge(0, 30, 90)), 90, 1e-9));
  ok('a 45° la empina, no la achata', Math.abs(S.apparentPlunge(0, 30, 45)) > 30);
}

console.log('== la traza del corte ==');
{
  // Traza W-E de un décimo de grado a -37.4°: unos 8.8 km.
  const t = new S.SectionTrace([[-71.4, -37.4], [-71.3, -37.4]]);
  ok('el largo es el del terreno', t.length > 8000 && t.length < 9200, String(Math.round(t.length)));
  ok('el azimut es Este', cerca(t.azimuthAt(0), 90, 0.5), String(t.azimuthAt(0)));

  const p = t.project([-71.35, -37.4]);
  ok('un punto sobre la traza cae a media distancia', cerca(p.s, t.length / 2, 5), String(p.s));
  ok('y sin desviación', p.offset < 1, String(p.offset));

  const fuera = t.project([-71.35, -37.41]);
  ok('un punto al Sur se proyecta con su distancia', fuera.offset > 1000 && fuera.offset < 1200,
     String(Math.round(fuera.offset)));
  ok('y el lado queda registrado', fuera.side === 1 || fuera.side === -1);

  // Una traza quebrada tiene un azimut POR TRAMO: usar el medio daría un
  // aparente equivocado justo en la esquina, que es donde el corte se quiebra
  // porque cambia la estructura.
  const quebrada = new S.SectionTrace([[-71.4, -37.4], [-71.35, -37.4], [-71.35, -37.35]]);
  ok('el primer tramo va al Este', cerca(quebrada.azimuthAt(100), 90, 0.5));
  ok('el segundo va al Norte', cerca(quebrada.azimuthAt(quebrada.length - 100), 0, 0.5));

  ok('una traza de un punto se rechaza', (() => {
    try { new S.SectionTrace([[0, 0]]); return false; } catch { return true; }
  })());
}

console.log('== proyectar medidas ==');
{
  const t = new S.SectionTrace([[-71.4, -37.4], [-71.3, -37.4]]);
  const medida = (lng, lat, strike, dip, id) => ({
    properties: { id, strike, dip, type: 'bedding' },
    lngLat: [lng, lat],
    elevation: 1500,
  });
  const r = S.projectMeasurements(
    [medida(-71.36, -37.4, 0, 30, 'a'), medida(-71.34, -37.4, 90, 40, 'b')],
    t,
  );
  ok('salen las dos', r.length === 2);
  ok('ordenadas por posición en el corte', r[0].s < r[1].s);
  ok('la primera conserva su manteo real en un corte W-E', cerca(r[0].apparent, 30, 1e-6));
  // Rumbo E-W sobre un corte E-W: la capa se ve de canto, aparente cero.
  ok('la segunda sale horizontal', cerca(r[1].apparent, 0, 1e-6), String(r[1].apparent));
  ok('el achatamiento lo dice', r[1].foreshortening < 0.01 && r[0].foreshortening > 0.99);
  ok('cada una guarda dónde está', Array.isArray(r[0].lngLat));

  // El límite de distancia existe para que no se proyecte lo que está lejos.
  const lejos = S.projectMeasurements([medida(-71.35, -37.2, 0, 30, 'c')], t, { maxOffset: 2000 });
  ok('lo que está lejos se descarta', lejos.length === 0);
  const sinLimite = S.projectMeasurements([medida(-71.35, -37.2, 0, 30, 'c')], t);
  ok('sin límite se proyecta igual', sinLimite.length === 1);
  ok('pero se dice cuánto se estiró', sinLimite[0].offset > 20000);

  // Un punto sin orientación no es una medida y no puede proyectarse.
  const sinDatos = S.projectMeasurements(
    [{ properties: { id: 'x' }, lngLat: [-71.35, -37.4], elevation: 1000 }],
    t,
  );
  ok('sin rumbo ni manteo no se proyecta', sinDatos.length === 0);
}

console.log('== intersecciones con el dibujo ==');
{
  const t = new S.SectionTrace([[-71.4, -37.4], [-71.3, -37.4]]);
  const linea = (id, type, coords) => ({
    properties: { id, type, kind: 'line', certainty: 'observed' },
    geometry: { type: 'LineString', coordinates: coords },
  });
  const x = S.intersections(t, [
    linea('f1', 'thrust-fault', [[-71.36, -37.45], [-71.36, -37.35]]),
    linea('c1', 'stratigraphic-contact', [[-71.33, -37.45], [-71.33, -37.35]]),
    linea('n1', 'normal-fault', [[-71.36, -37.30], [-71.33, -37.30]]),
  ]);
  ok('encuentra las dos que cruzan', x.length === 2, String(x.length));
  ok('y no la que no cruza', !x.some((i) => i.id === 'n1'));
  ok('ordenadas a lo largo del corte', x[0].s < x[1].s);
  ok('con su tipo', x[0].type === 'thrust-fault');
  ok('y encendidas de partida', x.every((i) => i.enabled === true));
  ok('cada una sabe dónde cae en el mapa', Array.isArray(x[0].lngLat));

  // Un contacto plegado cruza el perfil varias veces, y esas repeticiones son
  // el dato: sin ellas el pliegue desaparece de la sección.
  const plegado = S.intersections(t, [
    linea('p1', 'stratigraphic-contact',
      [[-71.38, -37.45], [-71.37, -37.35], [-71.35, -37.45], [-71.33, -37.35]]),
  ]);
  ok('un contacto plegado cruza varias veces', plegado.length === 3, String(plegado.length));

  // El borde de un polígono también cuenta: es donde está el contacto.
  const poligono = S.intersections(t, [{
    properties: { id: 'u1', type: 'sedimentary-unit', kind: 'polygon' },
    geometry: { type: 'Polygon', coordinates: [[[-71.37, -37.45], [-71.35, -37.45], [-71.35, -37.35], [-71.37, -37.35], [-71.37, -37.45]]] },
  }]);
  ok('el borde de un polígono cruza dos veces', poligono.length === 2, String(poligono.length));
}

console.log('== construir el corte ==');
{
  const coords = [[-71.4, -37.4], [-71.3, -37.4]];
  const samples = Array.from({ length: 50 }, (_, i) => ({
    lngLat: [-71.4 + i * 0.002, -37.4],
    distance: (i / 49) * 8800,
    elevation: 1500 + 300 * Math.sin(i / 6),
  }));
  const sec = S.buildSection({
    coords,
    profile: { samples, label: 'Terrarium (AWS)' },
    measurements: [{ properties: { id: 'a', strike: 0, dip: 30 }, lngLat: [-71.35, -37.4], elevation: 1600 }],
    features: [{
      properties: { id: 'f1', type: 'normal-fault', kind: 'line', certainty: 'observed' },
      geometry: { type: 'LineString', coordinates: [[-71.36, -37.45], [-71.36, -37.35]] },
    }],
  });
  ok('trae la topografía', sec.samples.length === 50);
  ok('un manteo proyectado', sec.dips.length === 1);
  ok('una intersección', sec.intersections.length === 1);
  ok('el rango vertical deja sitio bajo el terreno', sec.zMin < 1200, String(sec.zMin));
  ok('y algo de aire arriba', sec.zMax > 1800, String(sec.zMax));
  ok('con el azimut del corte', cerca(sec.azimuth, 90, 0.5));

  console.log('== salida a Structural Modeller ==');
  const lineas = X.sectionLines3D(sec);
  ok('la topografía sale como línea 3D', lineas[0].attrs.Type === 'topography');
  ok('con las cotas como Z', lineas[0].vertices.every((v) => v.length === 3 && Number.isFinite(v[2])));
  ok('y una semilla por intersección', lineas.length === 2);
  // El plugin deduce la clase del texto: «normal-fault» ya contiene «fault».
  ok('el tipo viaja tal cual para que el plugin lo lea',
     lineas[1].attrs.Type === 'normal-fault');
  ok('y esa clase es falla', X.sectionKindOf('normal-fault') === 'fault');
  ok('un contacto es horizonte', X.sectionKindOf('stratigraphic-contact') === 'horizon');
  ok('la semilla baja, no sube', lineas[1].vertices[1][2] < lineas[1].vertices[0][2]);

  const apagada = { ...sec, intersections: sec.intersections.map((i) => ({ ...i, enabled: false })) };
  ok('una intersección apagada no se exporta', X.sectionLines3D(apagada).length === 1);

  const dips = X.sectionDips3D(sec);
  ok('los manteos salen como puntos 3D', dips.length === 1 && dips[0].vertex.length === 3);
  ok('con el aparente entre sus atributos', dips[0].attrs.AppDip === '30');
  ok('y con cuánto se estiró la proyección', 'Offset' in dips[0].attrs);

  const zipBytes = X.structuralModellerZip(sec, 'prueba');
  ok('el zip trae los dos shapefiles', zipBytes && zipBytes.length > 0);
  const entradas = X.unzipEntries(zipBytes).map((e) => e.name).sort();
  ok('con sus cuatro archivos cada uno',
     entradas.join(' ') === 'prueba_dips.dbf prueba_dips.prj prueba_dips.shp prueba_dips.shx ' +
       'prueba_lines.dbf prueba_lines.prj prueba_lines.shp prueba_lines.shx',
     entradas.join(' '));

  console.log('== salida a StructuralSketcher ==');
  const doc = X.sketcherDocument(sec);
  ok('se declara como documento del Sketcher', doc.app === 'StructuralSketcher' && doc.version === 1);
  ok('la sección trae su largo', doc.section.length === Math.round(sec.length));
  ok('la topografía es una línea de tipo topography',
     doc.section.lines.some((l) => l.kind === 'topography'));
  ok('en coordenadas de sección [s, z]',
     doc.section.lines[0].vertices[0].length === 2);
  ok('la falla llega como falla', doc.section.lines.some((l) => l.kind === 'fault'));
  ok('con un manteo', doc.section.dips.length === 1);
  ok('y con la etiqueta del rumbo y manteo reales', doc.section.dips[0].label === '0/30');
}

console.log('== la convención de manteo del Sketcher ==');
{
  /*
   * Allí un manteo es una magnitud de 0 a 180 medida en sentido horario desde
   * la horizontal, y el signo negativo marca capa invertida, no dirección. Sin
   * esta conversión una capa que mantea al oeste llegaría dibujada al este.
   */
  ok('un aparente positivo pasa igual', X.apparentToSketcherDip(30) === 30);
  ok('uno negativo se lleva a la mitad superior', X.apparentToSketcherDip(-30) === 150);
  ok('horizontal sigue siendo cero', X.apparentToSketcherDip(0) === 0);
  ok('lo invertido va con signo', X.apparentToSketcherDip(30, true) === -30);
}

console.log('== el shapefile por dentro ==');
{
  // Se relee lo escrito: es la única forma de saber que las cabeceras están
  // bien sin abrirlo en QGIS. El formato mezcla los dos órdenes de bytes en la
  // misma cabecera, que es su rareza y la fuente número uno de archivos rotos.
  const { shp, shx } = SH.writeShp(
    [[[-71.4, -37.4, 1200], [-71.3, -37.4, 900]]],
    SH.SHAPE_POLYLINE_Z,
  );
  const dv = new DataView(shp.buffer);
  ok('el código de archivo va en big-endian', dv.getInt32(0, false) === 9994);
  ok('el largo declarado es el real', dv.getInt32(24, false) * 2 === shp.length);
  ok('la versión va en little-endian', dv.getInt32(28, true) === 1000);
  ok('el tipo es PolylineZ', dv.getInt32(32, true) === 13);
  ok('el rango Z declara el mínimo', cerca(dv.getFloat64(68, true), 900));
  ok('y el máximo', cerca(dv.getFloat64(76, true), 1200));
  ok('el índice tiene una entrada por registro', shx.length === 100 + 8);

  const dbf = SH.writeDbf([{ name: 'Type', width: 8 }], [{ Type: 'fault' }]);
  const ddv = new DataView(dbf.buffer);
  ok('el dbf declara un registro', ddv.getInt32(4, true) === 1);
  ok('y termina con su marca de fin', dbf[dbf.length - 1] === 0x1a);

  const z = SH.zip([{ name: 'a.txt', data: new TextEncoder().encode('hola') }]);
  ok('el zip empieza por su firma', new DataView(z.buffer).getUint32(0, true) === 0x04034b50);
  ok('y se puede releer', X.unzipEntries(z)[0].name === 'a.txt');
  ok('con su contenido intacto',
     new TextDecoder().decode(X.unzipEntries(z)[0].data) === 'hola');
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
