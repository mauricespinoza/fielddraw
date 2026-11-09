import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildZip, crc32Update, isZip, readZip } from '../src/zip.js';
import { buildProjectPackage, packageFilename, parseProject, readProjectPackage } from '../src/project.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

console.log('== CRC-32 ==');
ok('valor de referencia de "123456789"', crc32Update(0, new TextEncoder().encode('123456789')) === 0xcbf43926);

console.log('== ZIP de ida y vuelta ==');
{
  const grande = new Uint8Array(300000).map((_, i) => (i * 7) & 255);
  const zip = await buildZip([
    { name: 'a.txt', blob: new Blob(['hola mundo']) },
    { name: 'files/mapa ñ.pmtiles', blob: new Blob([grande]) },
  ]);
  ok('se reconoce como ZIP', await isZip(zip));
  ok('un JSON no', !(await isZip(new Blob(['{"format":"x", "padding": "....................."}']))));
  const entries = await readZip(zip);
  ok('dos entradas', entries.length === 2, JSON.stringify(entries.map((e) => e.name)));
  ok('nombre UTF-8', entries[1].name === 'files/mapa ñ.pmtiles');
  ok('texto intacto', (await entries[0].blob.text()) === 'hola mundo');
  const back = new Uint8Array(await entries[1].blob.arrayBuffer());
  ok('binario intacto', back.length === grande.length && back.every((v, i) => v === grande[i]));

  // Que otro programa lo lea también: `unzip -t` comprueba los CRC.
  let unzip = null;
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    unzip = true;
  } catch {
    unzip = false;
  }
  if (unzip) {
    const dir = mkdtempSync(join(tmpdir(), 'fdzip-'));
    const p = join(dir, 't.zip');
    writeFileSync(p, Buffer.from(await zip.arrayBuffer()));
    let salida = '';
    try {
      salida = execFileSync('unzip', ['-t', p]).toString();
    } catch (e) {
      salida = String(e.stdout || e);
    }
    ok('unzip -t lo da por bueno', /No errors detected/.test(salida), salida);
  } else console.log('  (sin unzip: se omite la comprobación externa)');
}

console.log('== paquete de proyecto ==');
{
  const pm = new Uint8Array([80, 77, 84, 105, 108, 101, 115, 3, 1, 2, 3]);
  const { data, blob } = await buildProjectPackage('Cerro Colorado', [
    { role: 'tiles', name: 'orto.pmtiles', file: new Blob([pm]) },
    { role: 'dem', name: 'dem.pmtiles', file: new Blob([pm, pm]) },
    { role: 'tiles', name: 'orto.pmtiles', file: new Blob([pm]) },
  ]);
  ok('nombre .fdproj.zip', packageFilename('Cerro Colorado').endsWith('.fdproj.zip'));
  ok('el manifiesto nombra los tres', data.offlineFiles.length === 3);
  ok('rutas sin repetir', new Set(data.offlineFiles.map((f) => f.path)).size === 3, JSON.stringify(data.offlineFiles));
  const pkg = await readProjectPackage(blob);
  const { project } = parseProject(pkg.text);
  ok('el proyecto se lee', project.name === 'Cerro Colorado');
  ok('vuelven los tres archivos', pkg.files.length === 3 && pkg.warnings.length === 0);
  ok('con su rol', pkg.files.filter((f) => f.role === 'dem').length === 1);
  ok('y sus bytes', pkg.files[1].file.size === pm.length * 2 && pkg.files[1].file.name === 'dem.pmtiles');
}

console.log('== paquete de proyecto: capas importadas (puntos de control, datos estructurales) ==');
{
  const punto = (props, c) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });
  const capas = [
    {
      id: 'gpkg-a-0', table: 'puntos_control', label: 'Puntos de control', kind: 'point',
      geojson: { type: 'FeatureCollection', features: [punto({ name: 'CP1' }, [-71, -37]), punto({ name: 'CP2' }, [-71.1, -37])] },
      style: { color: '#ff0000' },
    },
    {
      id: 'gpkg-a-1', table: 'estructural/rumbos', label: 'Datos: estructurales', kind: 'point',
      geojson: { type: 'FeatureCollection', features: [punto({ strike: 30, dip: 40 }, [-71, -37.1])] },
      style: null,
    },
  ];
  const { data, blob } = await buildProjectPackage('Con capas', [], undefined, { imported: capas });
  ok('el manifiesto nombra las dos capas', data.importedLayers.length === 2);
  ok('rutas bajo layers/ y sin caracteres prohibidos', data.importedLayers.every((l) => /^layers\/[^/\\:*?"<>|]+\.json$/.test(l.path)), JSON.stringify(data.importedLayers));
  const entradas = await readZip(blob);
  ok('el zip lleva las capas como archivos', entradas.filter((e) => e.name.startsWith('layers/')).length === 2);
  const pkg = await readProjectPackage(blob);
  ok('vuelven las dos capas sin avisos', pkg.importedLayers.length === 2 && pkg.warnings.length === 0, JSON.stringify(pkg.warnings));
  ok('con sus elementos intactos', pkg.importedLayers[0].geojson.features.length === 2 && pkg.importedLayers[1].geojson.features[0].properties.dip === 40);
  ok('con su id, estilo y etiqueta', pkg.importedLayers[0].id === 'gpkg-a-0' && pkg.importedLayers[0].style.color === '#ff0000' && pkg.importedLayers[0].label === 'Puntos de control');
  ok('y sin archivos de mapa', pkg.files.length === 0);

  // Un paquete anterior a esto (sin `importedLayers`) sigue abriéndose.
  const viejo = await buildZip([{ name: 'project.fdproj.json', blob: new Blob([JSON.stringify({ format: 'fielddraw-project', version: 1, features: [] })]) }]);
  const pk = await readProjectPackage(viejo);
  ok('un paquete sin capas sigue abriéndose', pk.importedLayers.length === 0 && pk.warnings.length === 0);

  // Una capa listada pero ausente o rota se avisa, no tumba el resto.
  const roto = await buildZip([
    { name: 'project.fdproj.json', blob: new Blob([JSON.stringify({ format: 'fielddraw-project', version: 1, features: [], importedLayers: [{ path: 'layers/x.json', id: 'x', label: 'X' }, { path: 'layers/falta.json', id: 'y', label: 'Y' }, { path: 'layers/ok.json', id: 'z', label: 'Z' }] })]) },
    { name: 'layers/x.json', blob: new Blob(['no es json']) },
    { name: 'layers/ok.json', blob: new Blob([JSON.stringify(capas[0])]) },
  ]);
  const pr = await readProjectPackage(roto);
  ok('la capa buena se conserva', pr.importedLayers.length === 1);
  ok('y se avisa de la rota y de la ausente', pr.warnings.length === 2, JSON.stringify(pr.warnings));
}

console.log(fails ? `\n${fails} FALLO(S)` : '\nTODO OK');
process.exit(fails ? 1 : 0);
