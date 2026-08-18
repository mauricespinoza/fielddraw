/**
 * Service worker de FieldDraw.
 *
 * Dos cachés con políticas distintas, porque son dos problemas distintos:
 *
 * - **App shell** (`PRECACHE`): el HTML, los módulos, el CSS, los iconos y todo
 *   `vendor/`. Se precachea entero al instalar y se sirve primero desde caché.
 *   Es lo que hace que la app abra sin señal, incluso desde el icono de la
 *   pantalla de inicio.
 * - **Teselas** (`TILES`): basemaps, DEM y fuentes que se piden a la red. Van a
 *   una caché aparte, con tope de entradas, porque son ilimitadas por
 *   naturaleza: se guarda lo que se haya mirado y punto.
 *
 * Lo que NO puede resolver un service worker: la cobertura completa de un
 * basemap en terreno. Para eso está la importación de PMTiles/MBTiles, que
 * guarda el mapa en un archivo propio. Aquí solo sobrevive lo ya visitado.
 */

const VERSION = 'v5';
const PRECACHE = `fielddraw-shell-${VERSION}`;
const TILES = `fielddraw-tiles-${VERSION}`;

/** Tope de teselas guardadas. A ~15 KB cada una son unos 90 MB. */
const TILE_LIMIT = 6000;

/**
 * Todo lo que la app necesita para arrancar. Las rutas son relativas al scope,
 * así que funcionan igual en la raíz de un dominio que en un subdirectorio.
 */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',

  './src/app.js',
  './src/basemaps.js',
  './src/drawController.js',
  './src/editOps.js',
  './src/geologyStyle.js',
  './src/geom.js',
  './src/geometryOps.js',
  './src/importedStyle.js',
  './src/mapView.js',
  './src/ornaments.js',
  './src/persistence.js',
  './src/project.js',
  './src/simplify.js',
  './src/snapping.js',
  './src/store.js',
  './src/symbology.js',
  './src/tiles.js',
  './src/topology.js',
  './src/ui.js',
  './src/vendorPaths.js',
  './src/vertexEdit.js',
  './src/strabo/api.js',
  './src/strabo/spots.js',
  './src/strabo/layers.js',
  './src/strabo/upload.js',
  './src/strabo/panel.js',
  './src/strabo/style.js',
  './src/styles/app.css',
  './src/gpkg/index.js',
  './src/gpkg/qml.js',
  './src/gpkg/wkb.js',

  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css',
  './vendor/maplibre-contour.js',
  './vendor/esm/maplibre-gl.js',
  './vendor/esm/maplibre-contour.js',
  './vendor/pmtiles.js',
  './vendor/proj4.js',
  './vendor/jsts.min.js',
  './vendor/sql-wasm.js',
  './vendor/sql-wasm.wasm',
  './vendor/strabo-svg/bedding.svg',
  './vendor/strabo-svg/falla-dextral-punto-azul.svg',
  './vendor/strabo-svg/falla-indeterminada.svg',
  './vendor/strabo-svg/falla-inversa.svg',
  './vendor/strabo-svg/falla-normal-punto.svg',
  './vendor/strabo-svg/falla-sinestral-punto-azul.svg',
  './vendor/strabo-svg/joint_inclined.svg',
  './vendor/fonts/Noto Sans Regular/0-255.pbf',
  './vendor/fonts/Noto Sans Regular/256-511.pbf',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // Uno a uno y no con addAll: si un solo archivo falla, addAll aborta la
      // instalación entera y la app se queda sin caché sin decir por qué.
      const fallos = [];
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await cache.put(url, res);
          } catch (err) {
            fallos.push(`${url}: ${err.message}`);
          }
        }),
      );
      if (fallos.length) console.warn('[sw] no se precachearon:', fallos);
    })(),
  );
  // La versión nueva toma el control en cuanto esté lista.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE, TILES]);
      for (const key of await caches.keys()) {
        if (key.startsWith('fielddraw-') && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** Teselas y demás datos que se piden a servidores externos. */
function esTesela(url) {
  return (
    /\.(png|jpg|jpeg|webp|pbf|mvt)(\?|$)/i.test(url.pathname) ||
    /tile|terrarium|elevation/i.test(url.hostname)
  );
}

/** Deja la caché de teselas por debajo del tope, tirando las más antiguas. */
async function podarTeselas() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  if (keys.length <= TILE_LIMIT) return;
  for (const req of keys.slice(0, keys.length - TILE_LIMIT)) await cache.delete(req);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Los blob: y data: no pasan por aquí, pero sí las peticiones de rango que
  // hace PMTiles sobre un archivo local: esas no se tocan.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (request.headers.has('range')) return;

  // Navegación: la app siempre debe abrir, haya o no red.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(PRECACHE);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  const mismoOrigen = url.origin === self.location.origin;

  if (mismoOrigen) {
    // App shell: caché primero. En terreno la velocidad importa y el contenido
    // solo cambia cuando se publica una versión nueva.
    event.respondWith(
      (async () => {
        const cache = await caches.open(PRECACHE);
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) {
          // Refresco en segundo plano: la próxima carga ya trae lo nuevo.
          event.waitUntil(
            (async () => {
              try {
                const fresh = await fetch(request);
                if (fresh.ok) await cache.put(request, fresh);
              } catch {
                /* sin red: seguimos con lo cacheado */
              }
            })(),
          );
          return hit;
        }
        try {
          const res = await fetch(request);
          if (res.ok) await cache.put(request, res.clone());
          return res;
        } catch (err) {
          return new Response('Sin conexión y sin copia en caché', {
            status: 504,
            statusText: 'Offline',
          });
        }
      })(),
    );
    return;
  }

  if (esTesela(url)) {
    // Teselas: red primero para tener lo más nuevo, con la caché de respaldo.
    event.respondWith(
      (async () => {
        const cache = await caches.open(TILES);
        try {
          const res = await fetch(request);
          // Las respuestas opacas (sin CORS) también sirven para pintar.
          if (res.ok || res.type === 'opaque') {
            await cache.put(request, res.clone());
            event.waitUntil(podarTeselas());
          }
          return res;
        } catch (err) {
          const hit = await cache.match(request);
          if (hit) return hit;
          throw err;
        }
      })(),
    );
  }
});

/** Permite a la app forzar la actualización y consultar el estado. */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'skipWaiting') self.skipWaiting();
  if (data === 'estado' && event.source) {
    event.waitUntil(
      (async () => {
        const [shell, tiles] = await Promise.all([caches.open(PRECACHE), caches.open(TILES)]);
        const [a, b] = await Promise.all([shell.keys(), tiles.keys()]);
        event.source.postMessage({ tipo: 'estado', version: VERSION, shell: a.length, teselas: b.length });
      })(),
    );
  }
});
