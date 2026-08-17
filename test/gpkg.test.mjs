import {
  decodeGeoPackageBinary,
  encodeGeoPackageBinary,
  encodeWKB,
  envelopeOf,
} from '../src/gpkg/wkb.js';
import { parseQgisColor, parseQgisFilter } from '../src/gpkg/qml.js';
import { buildImportedLayers } from '../src/importedStyle.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('== WKB / GeoPackageBinary ==');
{
  const line = { type: 'LineString', coordinates: [[-71.5, -37.2], [-71.4, -37.1], [-71.3, -37.35]] };
  const blob = encodeGeoPackageBinary(line, 4326);
  ok('magic "GP"', blob[0] === 0x47 && blob[1] === 0x50);
  ok('versión 0', blob[2] === 0);
  ok('flags: little endian + envelope XY', blob[3] === 0b011);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  ok('srs_id = 4326', dv.getInt32(4, true) === 4326);
  ok('envelope minX', Math.abs(dv.getFloat64(8, true) - -71.5) < 1e-12);
  ok('envelope maxX', Math.abs(dv.getFloat64(16, true) - -71.3) < 1e-12);
  ok('envelope minY', Math.abs(dv.getFloat64(24, true) - -37.35) < 1e-12);
  ok('envelope maxY', Math.abs(dv.getFloat64(32, true) - -37.1) < 1e-12);
  ok('round-trip LineString', eq(decodeGeoPackageBinary(blob), line));
}
{
  const poly = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
      [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]],
    ],
  };
  ok('round-trip Polygon con hueco', eq(decodeGeoPackageBinary(encodeGeoPackageBinary(poly)), poly));
  ok('envelope de polígono', eq(envelopeOf(poly), [0, 2, 0, 2]));
}
{
  const pt = { type: 'Point', coordinates: [-72.1, -36.8] };
  ok('round-trip Point', eq(decodeGeoPackageBinary(encodeGeoPackageBinary(pt)), pt));
  const mls = { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3], [4, 4]]] };
  ok('round-trip MultiLineString', eq(decodeGeoPackageBinary(encodeGeoPackageBinary(mls)), mls));
  const mp = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] };
  ok('round-trip MultiPolygon', eq(decodeGeoPackageBinary(encodeGeoPackageBinary(mp)), mp));
}
{
  // WKB big-endian escrito a mano: LineString (0,0)-(1,1).
  const wkb = new Uint8Array(1 + 4 + 4 + 4 * 8);
  const d = new DataView(wkb.buffer);
  d.setUint8(0, 0); // big endian
  d.setUint32(1, 2, false);
  d.setUint32(5, 2, false);
  d.setFloat64(9, 0, false);
  d.setFloat64(17, 0, false);
  d.setFloat64(25, 1, false);
  d.setFloat64(33, 1, false);
  const blob = new Uint8Array(8 + wkb.length);
  blob[0] = 0x47; blob[1] = 0x50; blob[2] = 0; blob[3] = 0b001; // sin envelope
  new DataView(blob.buffer).setInt32(4, 4326, true);
  blob.set(wkb, 8);
  ok('decodifica WKB big-endian', eq(decodeGeoPackageBinary(blob),
    { type: 'LineString', coordinates: [[0, 0], [1, 1]] }));
}
{
  // ISO WKB 3D (tipo 1002): debe descartar la Z y quedarse con XY.
  const wkb = new Uint8Array(1 + 4 + 4 + 2 * 24);
  const d = new DataView(wkb.buffer);
  d.setUint8(0, 1);
  d.setUint32(1, 1002, true);
  d.setUint32(5, 2, true);
  d.setFloat64(9, 10, true); d.setFloat64(17, 20, true); d.setFloat64(25, 999, true);
  d.setFloat64(33, 30, true); d.setFloat64(41, 40, true); d.setFloat64(49, 888, true);
  const blob = new Uint8Array(8 + wkb.length);
  blob[0] = 0x47; blob[1] = 0x50; blob[2] = 0; blob[3] = 0b001;
  new DataView(blob.buffer).setInt32(4, 4326, true);
  blob.set(wkb, 8);
  ok('decodifica WKB 3D descartando Z', eq(decodeGeoPackageBinary(blob),
    { type: 'LineString', coordinates: [[10, 20], [30, 40]] }));
}
{
  let threw = false;
  try { decodeGeoPackageBinary(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])); } catch { threw = true; }
  ok('rechaza blob sin cabecera GP', threw);
  ok('tamaño WKB de LineString', encodeWKB({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }).byteLength === 41);
}

console.log('== colores QGIS ==');
ok('r,g,b,a', eq(parseQgisColor('211,47,47,255'), { color: '#d32f2f', opacity: 1 }));
ok('alfa parcial', Math.abs(parseQgisColor('211,47,47,115').opacity - 115 / 255) < 1e-9);
ok('cola rgb: de QGIS 3.30+',
   parseQgisColor('211,47,47,255,rgb:0.82745098,0.18431373,0.18431373,1').color === '#d32f2f');
ok('hexadecimal', eq(parseQgisColor('#2E7D32'), { color: '#2e7d32', opacity: 1 }));
ok('basura devuelve null', parseQgisColor('no-es-un-color') === null);

console.log('== filtros QGIS ==');
ok('igualdad de texto', eq(parseQgisFilter(`"type" = 'thrust-fault'`), ['==', ['get', 'type'], 'thrust-fault']));
ok('AND', eq(parseQgisFilter(`"type" = 'dike' AND "certainty" = 'observed'`),
   ['all', ['==', ['get', 'type'], 'dike'], ['==', ['get', 'certainty'], 'observed']]));
ok('OR', eq(parseQgisFilter(`"a" = 1 OR "b" = 2`),
   ['any', ['==', ['get', 'a'], 1], ['==', ['get', 'b'], 2]]));
ok('comparación numérica', eq(parseQgisFilter(`"dip" >= 45`), ['>=', ['get', 'dip'], 45]));
ok('distinto de', eq(parseQgisFilter(`"x" <> 'a'`), ['!=', ['get', 'x'], 'a']));
ok('paréntesis', eq(parseQgisFilter(`("type" = 'a')`), ['==', ['get', 'type'], 'a']));
ok('ELSE => sin filtro', parseQgisFilter('ELSE') === null);
ok('vacío => sin filtro', parseQgisFilter('') === null);
ok('expresión no soportada => undefined', parseQgisFilter(`intersects($geometry, @atlas_geometry)`) === undefined);

console.log('== capas MapLibre desde estilo importado ==');
{
  const style = {
    rules: [
      { filter: ['==', ['get', 't'], 'a'], symbol: { kind: 'line', color: '#ff0000', opacity: 1, width: 2, dash: null } },
      { filter: ['==', ['get', 't'], 'b'], symbol: { kind: 'line', color: '#00ff00', opacity: 1, width: 3, dash: [4, 2] } },
      { filter: ['==', ['get', 't'], 'c'], symbol: { kind: 'line', color: '#0000ff', opacity: 1, width: 1, dash: null } },
    ],
  };
  const { layers } = buildImportedLayers({ id: 'imp', sourceId: 'src', kind: 'line', style });
  ok('una capa por patrón de guiones', layers.length === 2, `-> ${layers.length}`);
  const solid = layers.find((l) => !l.paint['line-dasharray']);
  const dashed = layers.find((l) => l.paint['line-dasharray']);
  ok('la punteada conserva el dasharray', eq(dashed.paint['line-dasharray'], [4, 2]));
  ok('la continua agrupa dos reglas', solid.filter[0] === 'any' && solid.filter.length === 3);
  ok('el color es una expresión case', solid.paint['line-color'][0] === 'case');
  // La regla 2 debe excluir explícitamente a la 1, o se pisarían.
  const second = dashed.filter[1];
  ok('las reglas posteriores niegan a las previas',
     JSON.stringify(second).includes('"!"'), JSON.stringify(second));
}
{
  const { layers } = buildImportedLayers({ id: 'imp', sourceId: 'src', kind: 'polygon', style: null });
  ok('polígono sin estilo produce relleno y contorno', layers.length === 2 &&
     layers[0].type === 'fill' && layers[1].type === 'line');
  ok('el relleno filtra por geometría', eq(layers[0].filter, ['==', ['geometry-type'], 'Polygon']));
}
{
  const { layers } = buildImportedLayers({ id: 'imp', sourceId: 'src', kind: 'point', style: null });
  ok('punto produce una capa circle', layers.length === 1 && layers[0].type === 'circle');
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
