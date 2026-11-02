import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  countTiles,
  latToTileY,
  lngToTileX,
  metresPerTile,
  planArea,
  templateOf,
  tileRange,
  tileUrl,
  tilesOf,
} from '../src/areaCache.js';
import { BASEMAPS, TERRARIUM_URL, rasterTileSize, sharpUntilZoom } from '../src/basemaps.js';

/*
 * Lo que se prueba aquí es la aritmética de teselas, y no por gusto: un error
 * de un índice o de signo no rompe nada a la vista, solo descarga el recuadro
 * de al lado. Eso se descubre en terreno, sin señal, que es exactamente donde
 * no tiene arreglo.
 */

test('z0 es una sola tesela para todo el mundo', () => {
  assert.equal(lngToTileX(-71, 0), 0);
  assert.equal(latToTileY(-37, 0), 0);
  assert.equal(countTiles([-180, -85, 180, 85], 0, 0), 1);
});

test('el meridiano y el ecuador parten el mundo en cuatro a z1', () => {
  assert.equal(lngToTileX(-1, 1), 0);
  assert.equal(lngToTileX(1, 1), 1);
  // La Y crece hacia el SUR: el hemisferio norte es la fila 0.
  assert.equal(latToTileY(10, 1), 0);
  assert.equal(latToTileY(-10, 1), 1);
});

test('fuera del rango de Mercator no se sale del índice', () => {
  // Mercator no llega a los polos; pedir 89°N no puede devolver una fila que
  // no existe, o la descarga pediría teselas 404 en bucle.
  const n = 2 ** 5;
  assert.equal(latToTileY(89, 5), 0);
  assert.equal(latToTileY(-89, 5), n - 1);
  assert.ok(latToTileY(-89, 5) < n);
});

test('el rango cubre el bbox y el norte da la fila más baja', () => {
  const bbox = [-71.6, -37.5, -71.4, -37.3];
  const r = tileRange(bbox, 12);
  assert.ok(r.x0 <= r.x1, 'x creciente');
  assert.ok(r.y0 <= r.y1, 'y creciente hacia el sur');
  assert.equal(r.count, (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1));
  // El extremo norte del bbox tiene que caer en la primera fila del rango.
  assert.equal(latToTileY(-37.3, 12), r.y0);
  assert.equal(latToTileY(-37.5, 12), r.y1);
});

test('un bbox al revés se entiende igual', () => {
  // Un bbox llega de `map.getBounds()` bien ordenado, pero uno escrito a mano
  // con el norte y el sur cambiados no debe devolver un rango vacío.
  const derecho = tileRange([-71.6, -37.5, -71.4, -37.3], 12);
  const alReves = tileRange([-71.4, -37.3, -71.6, -37.5], 12);
  assert.deepEqual(alReves, derecho);
});

test('contar y generar coinciden', () => {
  const bbox = [-71.6, -37.5, -71.4, -37.3];
  const contadas = countTiles(bbox, 10, 13);
  const generadas = [...tilesOf(bbox, 10, 13)];
  assert.equal(generadas.length, contadas);
  // Sin repetidas: una tesela bajada dos veces es ancho de banda de terreno.
  const claves = new Set(generadas.map((t) => `${t.z}/${t.x}/${t.y}`));
  assert.equal(claves.size, generadas.length);
});

test('cada zoom cuadruplica, más o menos', () => {
  const bbox = [-71.6, -37.5, -71.4, -37.3];
  const z12 = tileRange(bbox, 12).count;
  const z13 = tileRange(bbox, 13).count;
  assert.ok(z13 >= z12 * 2, `z13=${z13} vs z12=${z12}`);
});

test('la plantilla respeta el orden que traiga', () => {
  assert.equal(tileUrl('http://x/{z}/{x}/{y}.png', 5, 1, 2), 'http://x/5/1/2.png');
  // Esri pide {z}/{y}/{x}, y el orden va en la propia plantilla.
  assert.equal(tileUrl('http://x/tile/{z}/{y}/{x}', 5, 1, 2), 'http://x/tile/5/2/1');
  // El subdominio se fija: repartir carga es lo que NO toca al bajar en masa.
  assert.equal(tileUrl('http://{s}.x/{z}/{x}/{y}.png', 1, 0, 0), 'http://a.x/1/0/0.png');
});

test('metros por tesela se encoge con el zoom y con la latitud', () => {
  assert.ok(metresPerTile(12, 0) > metresPerTile(13, 0));
  // A 60° de latitud una tesela cubre la mitad de terreno que en el ecuador.
  assert.ok(Math.abs(metresPerTile(12, 60) / metresPerTile(12, 0) - 0.5) < 0.01);
});

test('planArea respeta el veto de OpenStreetMap', () => {
  const plan = planArea({
    bbox: [-71.6, -37.5, -71.4, -37.3],
    demZoom: 12,
    basemapId: 'osm',
    basemapZoom: 14,
  });
  const osm = plan.partes.find((p) => p.kind === 'basemap');
  assert.ok(osm.blocked, 'OSM prohibe la descarga masiva y debe salir vetado');
  assert.match(osm.blocked, /bulk downloading/i);
  // Lo vetado no cuenta ni en teselas ni en bytes: nadie va a bajarlo.
  const dem = plan.partes.find((p) => p.kind === 'dem');
  assert.equal(plan.tiles, dem.tiles);
});

test('planArea deja pasar Esri con tope', () => {
  const plan = planArea({
    bbox: [-71.45, -37.35, -71.4, -37.3],
    demZoom: 12,
    basemapId: 'esri-imagery',
    basemapZoom: 14,
  });
  const esri = plan.partes.find((p) => p.kind === 'basemap');
  assert.equal(esri.blocked, null);
  assert.ok(esri.limit > 0);
  assert.ok(plan.tiles > 0);
});

test('un área enorme excede el tope en vez de intentarlo', () => {
  const plan = planArea({
    bbox: [-75, -40, -68, -32], // medio Chile
    demZoom: 13,
    basemapId: 'esri-imagery',
    basemapZoom: 16,
  });
  assert.ok(plan.excede.length > 0, 'debe avisar en vez de bajar medio país');
});

test('el DEM se topa en su zoom real aunque se pida más', () => {
  // Terrarium llega a z15; pedir z18 no añade dato, solo teselas interpoladas.
  const plan = planArea({ bbox: [-71.5, -37.4, -71.4, -37.3], demZoom: 18 });
  assert.ok(plan.partes[0].zmax <= 15, `zmax=${plan.partes[0].zmax}`);
});

test('DEM y basemap se pueden bajar por separado', () => {
  const bbox = [-71.45, -37.35, -71.4, -37.3];
  const soloImagen = planArea({ bbox, demZoom: null, basemapId: 'esri-imagery', basemapZoom: 17 });
  assert.deepEqual(soloImagen.partes.map((p) => p.kind), ['basemap']);
  assert.equal(soloImagen.tiles, soloImagen.partes[0].tiles);
  const soloDem = planArea({ bbox, demZoom: 13, basemapId: null, basemapZoom: 17 });
  assert.deepEqual(soloDem.partes.map((p) => p.kind), ['dem']);
  const nada = planArea({ bbox, demZoom: null, basemapId: null, basemapZoom: 17 });
  assert.equal(nada.partes.length, 0);
  assert.equal(nada.tiles, 0);
});

test('z18 y z19 se pueden pedir, y se topan donde el basemap acaba', () => {
  const bbox = [-71.41, -37.31, -71.4, -37.3]; // ~1 km
  const z19 = planArea({ bbox, demZoom: null, basemapId: 'esri-imagery', basemapZoom: 19 });
  assert.equal(z19.partes[0].zmax, 19);
  assert.equal(z19.partes[0].topado, null);
  assert.equal(z19.excede.length, 0, 'un kilómetro a z19 tiene que caber');
  // Esri Terrain acaba en z13: pedir z18 baja z13 y lo dice.
  const terreno = planArea({ bbox, demZoom: null, basemapId: 'esri-terrain', basemapZoom: 18 });
  assert.equal(terreno.partes[0].zmax, 13);
  assert.equal(terreno.partes[0].topado, 13);
});

test('una zona de trabajo cabe a z17 sin encogerla hasta lo inútil', () => {
  // ~10 × 10 km a 37°S: con el tope viejo (1500) no cabía.
  const plan = planArea({ bbox: [-71.5, -37.4, -71.39, -37.31], demZoom: null, basemapId: 'esri-imagery', basemapZoom: 17 });
  assert.equal(plan.excede.length, 0, `teselas=${plan.tiles}`);
});

test('la plantilla de un área vieja se deduce para poder comprobarla y completarla', () => {
  assert.equal(templateOf({ kind: 'dem', label: 'Elevation' }), TERRARIUM_URL);
  const esri = BASEMAPS.find((b) => b.id === 'esri-imagery');
  assert.equal(templateOf({ kind: 'basemap', basemapId: 'esri-imagery' }), esri.tiles[0]);
  // Las primeras áreas no guardaban el id, solo el rótulo.
  assert.equal(templateOf({ kind: 'basemap', label: esri.label }), esri.tiles[0]);
  assert.equal(templateOf({ kind: 'basemap', template: 'http://x/{z}/{x}/{y}.png' }), 'http://x/{z}/{x}/{y}.png');
  assert.equal(templateOf({ kind: 'basemap', label: 'No existe' }), null);
});

test('la imagen satelital se pide a la resolución real de una pantalla retina', () => {
  const imagen = BASEMAPS.find((b) => b.id === 'esri-imagery');
  const topo = BASEMAPS.find((b) => b.id === 'esri-topo');
  assert.equal(rasterTileSize(imagen, 2), 128);
  assert.equal(rasterTileSize(imagen, 1), 256);
  // Un mapa con rótulos no: los nombres saldrían a la mitad de tamaño.
  assert.equal(rasterTileSize(topo, 2), 256);
  assert.equal(sharpUntilZoom(topo, 17, 2), 16);
  assert.equal(sharpUntilZoom(imagen, 17, 2), 15);
  assert.equal(sharpUntilZoom(imagen, 17, 1), 16);
});
