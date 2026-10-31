/**
 * El app shell, coherente.
 *
 * Desde que `sw.js` instala todo o nada, un archivo de la lista SHELL que no
 * exista bloquea TODAS las actualizaciones (la instalación falla siempre y se
 * queda la versión vieja), y un módulo nuevo que no esté en la lista falla sin
 * señal. Lo mismo con la precarga de módulos de index.html. Esto lo pilla
 * antes de publicar.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const shellBlock = /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
const shell = [...shellBlock.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const modules = walk(join(ROOT, 'src'))
  .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
  .map((f) => relative(ROOT, f).split('\\').join('/'));

console.log('== SHELL de sw.js ==');
const faltan = shell.filter((f) => f && !existsSync(join(ROOT, f)));
ok('todo lo listado existe', faltan.length === 0, faltan.join(', '));
const fuera = modules.filter((m) => !shell.includes(m));
ok('todo src/ está listado', fuera.length === 0, fuera.join(', '));
ok('sin repetidos', new Set(shell).size === shell.length);

console.log('== modulepreload de index.html ==');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const pre = [...html.matchAll(/<link rel="modulepreload" href="\.\/([^"]+)"/g)].map((m) => m[1]);
const js = modules.filter((m) => m.endsWith('.js'));
ok('cada módulo de src/ se precarga', js.every((m) => pre.includes(m)), js.filter((m) => !pre.includes(m)).join(', '));
ok('no se precarga nada que no exista', pre.every((p) => existsSync(join(ROOT, p))));
ok('la precarga va después del import map', html.indexOf('type="importmap"') < html.indexOf('rel="modulepreload"'));


/* ---------------------------------------------- sw.js en una caja de arena */

/** Carga sw.js con caches/fetch falsos y devuelve sus manejadores. */
function cargarSW({ fetchImpl, host = 'example.org' } = {}) {
  const almacenes = new Map();
  const abrir = (nombre) => {
    if (!almacenes.has(nombre)) {
      const m = new Map();
      almacenes.set(nombre, {
        m,
        async match(req) { return m.get(typeof req === 'string' ? new URL(req, `https://${host}/`).href : req.url); },
        async put(req, res) { m.set(typeof req === 'string' ? new URL(req, `https://${host}/`).href : req.url, res); },
        async keys() { return [...m.keys()].map((u) => ({ url: u })); },
        async delete(req) { return m.delete(req.url || req); },
      });
    }
    return almacenes.get(nombre);
  };
  const handlers = {};
  const self = {
    location: new URL(`https://${host}/sw.js`),
    navigator: { onLine: true },
    addEventListener: (t, f) => { handlers[t] = f; },
    skipWaiting: () => { self.skipped = true; },
    clients: { claim: async () => {} },
  };
  const ctx = {
    self, caches: { open: async (n) => abrir(n), keys: async () => [...almacenes.keys()], delete: async (n) => almacenes.delete(n) },
    fetch: fetchImpl, Request: class { constructor(u, o = {}) { this.url = new URL(u, `https://${host}/`).href; Object.assign(this, o); this.headers = new Map(); this.method = 'GET'; } },
    Response: class { constructor(b, o = {}) { this.body = b; this.status = o.status ?? 200; this.ok = this.status < 300; } clone() { return this; } },
    URL, AbortController, setTimeout, clearTimeout, console: { warn() {}, log() {} }, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, 'sw.js'), 'utf8') + '\n;globalThis.__sw = { parsearTesela, urlCanonica, PRECACHE };', ctx);
  return { handlers, almacenes, self, sw: ctx.__sw };
}

const instalar = async (env) => {
  let p;
  env.handlers.install({ waitUntil: (x) => { p = x; } });
  try { await p; return true; } catch { return false; }
};

console.log('== sw.js: instalar es todo o nada ==');
{
  const okRes = () => ({ ok: true, status: 200, clone() { return this; } });
  const env = cargarSW({ fetchImpl: async () => okRes() });
  ok('con todo disponible, instala', await instalar(env));
  ok('y no toma el control solo', !env.self.skipped);

  const caida = cargarSW({ fetchImpl: async (req) => { if ((req.url || '').endsWith('ui.js')) throw new Error('sin red'); return okRes(); } });
  ok('si falta un archivo, la instalación FALLA (el worker viejo sigue)', !(await instalar(caida)));
  // Lo ya bajado de esta versión no se vuelve a pedir en el reintento.
  const cache = caida.almacenes.get(caida.sw.PRECACHE);
  ok('lo bajado queda para el reintento', cache.m.size === shell.length - 1);
}

console.log('== sw.js: teselas ==');
{
  const { sw } = cargarSW({ fetchImpl: async () => { throw new Error('x'); } });
  const esri = sw.parsearTesela('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/20000/10000');
  ok('Esri: z/y/x', esri && esri.z === 15 && esri.y === 20000 && esri.x === 10000);
  ok('Esri: la padre', esri.url(14, 5000, 10000 >> 1) === 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/14/5000/5000');
  const osm = sw.parsearTesela('https://a.tile.opentopomap.org/12/1300/2400.png');
  ok('XYZ: z/x/y', osm && osm.z === 12 && osm.x === 1300 && osm.y === 2400);
  ok('XYZ: la padre', osm.url(11, 650, 1200) === 'https://a.tile.opentopomap.org/11/650/1200.png');
  ok('el DEM no se amplía', sw.parsearTesela('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1/2.png') === null);
  ok('subdominio canónico', sw.urlCanonica('https://c.basemaps.cartocdn.com/rastertiles/voyager/3/1/2.png') === 'https://a.basemaps.cartocdn.com/rastertiles/voyager/3/1/2.png');
  ok('sin subdominio no cambia', sw.urlCanonica('https://tile.openstreetmap.org/1/0/0.png') === 'https://tile.openstreetmap.org/1/0/0.png');
}

console.log(fails ? `\n${fails} FALLOS` : '\ntodo bien');
process.exit(fails ? 1 : 0);
