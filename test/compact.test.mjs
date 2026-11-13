import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  compactFeatures,
  gzipText,
  isGzip,
  readMaybeGzipText,
  roundCoords,
  stringifyCompact,
} from '../src/compact.js';
import { buildZip, readZip } from '../src/zip.js';

/*
 * Proyectos más livianos. Lo que no puede pasar: que el redondeo mueva un
 * vértice más de lo prometido, que toque un número que no es coordenada, o
 * que un proyecto comprimido no se pueda volver a abrir —en terreno no hay
 * otra copia—.
 */

const linea = (id, coords, props = {}) => ({
  type: 'Feature',
  id,
  properties: { id, strike: 123.456789123, ...props },
  geometry: { type: 'LineString', coordinates: coords },
});

test('las coordenadas quedan a 7 decimales y se mueven menos de 1 cm', () => {
  const c = [[-71.25702961457641, -37.52023316530916], [-71.1, -37.2]];
  const r = roundCoords(c);
  assert.deepEqual(r, [[-71.2570296, -37.5202332], [-71.1, -37.2]]);
  // 1e-7° de latitud son ~1,1 cm.
  for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) assert.ok(Math.abs(r[i][k] - c[i][k]) <= 5e-8);
  // No toca el original: el store no muta.
  assert.equal(c[0][0], -71.25702961457641);
});

test('solo se redondea lo que está bajo `coordinates`', () => {
  const f = linea('a', [[-71.123456789, -37.987654321]]);
  const back = JSON.parse(stringifyCompact({ features: [f], declination: 1.23456789 }));
  assert.deepEqual(back.features[0].geometry.coordinates, [[-71.1234568, -37.9876543]]);
  assert.equal(back.features[0].properties.strike, 123.456789123);
  assert.equal(back.declination, 1.23456789);
});

test('polígonos con huecos y multigeometrías también', () => {
  const g = {
    type: 'MultiPolygon',
    coordinates: [[[[1.123456789, 2.1], [3, 4], [1.123456789, 2.1]], [[5.987654321, 6], [7, 8], [5.987654321, 6]]]],
  };
  const back = JSON.parse(stringifyCompact({ type: 'Feature', properties: {}, geometry: g }));
  assert.equal(back.geometry.coordinates[0][0][0][0], 1.1234568);
  assert.equal(back.geometry.coordinates[0][1][0][0], 5.9876543);
});

test('el autoguardado reutiliza la copia de lo que no cambió', () => {
  const a = linea('a', [[-71.123456789, -37.1]]);
  const b = linea('b', [[-71.2, -37.987654321]]);
  const primera = compactFeatures([a, b]);
  const b2 = { ...b, properties: { ...b.properties, note: 'x' } };
  const segunda = compactFeatures([a, b2]);
  assert.equal(segunda[0], primera[0], 'el elemento intacto no se vuelve a redondear');
  assert.notEqual(segunda[1], primera[1]);
  assert.equal(segunda[1].properties.note, 'x');
  assert.deepEqual(segunda[1].geometry.coordinates, [[-71.2, -37.9876543]]);
  // Sin geometría (o raro) pasa tal cual.
  const raro = { type: 'Feature', properties: { id: 'z' }, geometry: null };
  assert.equal(compactFeatures([raro])[0], raro);
});

test('gzip: ida y vuelta, y un .json plano se sigue abriendo', async () => {
  const texto = JSON.stringify({ format: 'fielddraw-project', features: Array.from({ length: 200 }, (_, i) => linea(`f${i}`, [[i, i]])) });
  const { blob, gzip } = await gzipText(texto);
  assert.ok(gzip);
  assert.ok(await isGzip(blob));
  assert.ok(blob.size < texto.length / 4, `${blob.size} no es menos de ¼ de ${texto.length}`);
  assert.equal(await readMaybeGzipText(blob), texto);
  const plano = new Blob([texto]);
  assert.equal(await isGzip(plano), false);
  assert.equal(await readMaybeGzipText(plano), texto);
});

test('ZIP: el texto va con deflate, lo binario tal cual, y unzip lo da por bueno', async () => {
  const texto = JSON.stringify(Array.from({ length: 500 }, (_, i) => linea(`f${i}`, [[i, i]])));
  const binario = new Uint8Array(4096).map((_, i) => (i * 7919) % 251);
  const zip = await buildZip([
    { name: 'project.fdproj.json', blob: new Blob([texto]), deflate: true },
    { name: 'files/orto.pmtiles', blob: new Blob([binario]) },
  ]);
  assert.ok(zip.size < texto.length / 3, 'el texto ocupa bastante menos dentro del ZIP');
  const entries = await readZip(zip);
  assert.equal(entries[0].compressed, false, 'se descomprime al leer');
  assert.equal(await entries[0].blob.text(), texto);
  const back = new Uint8Array(await entries[1].blob.arrayBuffer());
  assert.deepEqual(back, binario);

  let unzip = true;
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    unzip = false;
  }
  if (!unzip) return;
  const dir = mkdtempSync(join(tmpdir(), 'fdzip-'));
  const p = join(dir, 't.zip');
  writeFileSync(p, Buffer.from(await zip.arrayBuffer()));
  const salida = execFileSync('unzip', ['-v', p]).toString();
  assert.match(salida, /Defl:N.*project\.fdproj\.json/);
  assert.match(salida, /Stored.*orto\.pmtiles/);
  assert.match(execFileSync('unzip', ['-t', p]).toString(), /No errors detected/);
});
