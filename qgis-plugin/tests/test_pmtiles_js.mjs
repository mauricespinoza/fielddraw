/**
 * Lee un PMTiles escrito por el plugin con la **misma librería que usa
 * FieldDraw**: `vendor/pmtiles.js`, el build UMD que la app precachea.
 *
 * Es la prueba que de verdad importa. Que el archivo pase el lector propio de
 * `core/pmtiles.py` solo demuestra que sé leer lo que escribí; que lo abra
 * esta librería demuestra que lo abrirá el iPad en terreno.
 *
 *   node qgis-plugin/tests/test_pmtiles_js.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

let checks = 0;
const failures = [];

function check(condition, label) {
  checks += 1;
  if (!condition) {
    failures.push(label);
    console.log(`  FALLA  ${label}`);
  }
}

function equal(actual, expected, label) {
  check(
    Object.is(actual, expected),
    `${label} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`,
  );
}

function close(actual, expected, label, tolerance = 1e-6) {
  check(Math.abs(actual - expected) <= tolerance,
    `${label} (esperado ${expected} ± ${tolerance}, obtenido ${actual})`);
}

/** Carga el UMD de `vendor/` igual que lo carga `index.html`: como script. */
function loadVendorPmtiles() {
  const code = readFileSync(path.join(REPO, 'vendor', 'pmtiles.js'), 'utf8');
  const context = vm.createContext({
    console, TextDecoder, TextEncoder, DecompressionStream, CompressionStream,
    Response, Request, Blob, File, fetch, URL, Uint8Array, DataView, Math, JSON,
    setTimeout, clearTimeout, queueMicrotask, AbortController,
  });
  context.globalThis = context;
  context.self = context;
  vm.runInContext(code, context, { filename: 'vendor/pmtiles.js' });
  if (!context.pmtiles) throw new Error('vendor/pmtiles.js no expuso el global');
  return context.pmtiles;
}

const decoder = new TextDecoder();

async function main() {
  const pmtiles = loadVendorPmtiles();
  const dir = mkdtempSync(path.join(tmpdir(), 'fielddraw-pmtiles-'));
  try {
    const out = execFileSync('python3', [path.join(HERE, 'make_fixture.py'), dir],
      { encoding: 'utf8' }).trim().split('\n');
    const file = out[0];
    const expectedTiles = Number(out[2]);

    // Exactamente lo que hace `openPmtiles()` en `src/tiles.js`.
    const bytes = readFileSync(file);
    const blob = new File([bytes], path.basename(file));
    const archive = new pmtiles.PMTiles(new pmtiles.FileSource(blob));

    const header = await archive.getHeader();
    equal(header.tileType, 2, 'FieldDraw ve el archivo como raster PNG');
    equal(header.minZoom, 8, 'el zoom mínimo llega a la app');
    equal(header.maxZoom, 12, 'el zoom máximo llega a la app');
    close(header.minLon, -71.75, 'la extensión oeste llega a la app', 1e-6);
    close(header.minLat, -33.75, 'la extensión sur llega a la app', 1e-6);
    close(header.maxLon, -71.25, 'la extensión este llega a la app', 1e-6);
    close(header.maxLat, -33.25, 'la extensión norte llega a la app', 1e-6);
    check(Number.isFinite(header.centerZoom), 'el centro trae un zoom válido');

    const metadata = await archive.getMetadata();
    equal(metadata.name, 'Prueba FieldDraw',
      'los metadatos dan el nombre que la app pone en el panel de capas');

    // El descriptor que arma FieldDraw a partir de la cabecera.
    const descriptor = {
      tileKind: { 1: 'vector', 2: 'raster', 3: 'raster', 4: 'raster', 5: 'raster' }[header.tileType],
      minzoom: header.minZoom,
      maxzoom: header.maxZoom,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    };
    equal(descriptor.tileKind, 'raster', 'el descriptor sale como raster');

    // Y ahora las teselas, una por una, en todos los niveles.
    let found = 0;
    let holes = 0;
    for (let z = 8; z <= 12; z += 1) {
      const n = 1 << z;
      for (let x = 0; x < n; x += 1) {
        for (let y = 0; y < n; y += 1) {
          if (!inFixtureRange(z, x, y)) continue;
          const tile = await archive.getZxy(z, x, y);
          const skipped = (x * 31 + y) % 7 === 3;
          if (skipped) {
            check(tile === undefined || tile === null,
              `el hueco ${z}/${x}/${y} no devuelve datos`);
            holes += 1;
            continue;
          }
          if (!tile) {
            check(false, `falta la tesela ${z}/${x}/${y}`);
            continue;
          }
          const text = decoder.decode(new Uint8Array(tile.data).slice(0, 20));
          check(text.startsWith(`tesela|${z}|${x}|${y}|`),
            `la tesela ${z}/${x}/${y} devuelve su propio contenido`);
          found += 1;
        }
      }
    }
    equal(found, expectedTiles, 'están todas las teselas escritas');
    check(holes > 0, 'la prueba incluyó huecos de verdad');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Rango de teselas de la extensión del fixture, calculado aquí aparte. */
function inFixtureRange(z, x, y) {
  const [w, s, e, n] = [-71.75, -33.75, -71.25, -33.25];
  const lon2tile = (lon) => ((lon + 180) / 360) * (1 << z);
  const lat2tile = (lat) => {
    const rad = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * (1 << z);
  };
  const eps = 1e-9;
  return x >= Math.floor(lon2tile(w)) && x <= Math.ceil(lon2tile(e) - eps) - 1
    && y >= Math.floor(lat2tile(n)) && y <= Math.ceil(lat2tile(s) - eps) - 1;
}

main().then(() => {
  console.log('');
  if (failures.length) {
    console.log(`${failures.length} de ${checks} comprobaciones fallaron:`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`${checks} comprobaciones OK`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
