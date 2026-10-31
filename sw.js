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

const VERSION = 'v62';
const PRECACHE = `fielddraw-shell-${VERSION}`;

/*
 * La caché de teselas NO lleva `VERSION` en el nombre, a propósito.
 *
 * El app shell sí debe llevarlo: es lo que permite que `activate` tire la
 * versión anterior de HTML/JS y no queden dos shells mezclados. Pero una
 * tesela no tiene "versión de la app" — un basemap descargado con v26 sigue
 * siendo la misma tesela con v27 — así que si el nombre cambia en cada
 * publicación, `activate` la trata como "caché vieja" y la borra igual que al
 * shell. Eso fue lo que pasaba: subir una versión por un arreglo de interfaz
 * borraba de un plumazo los cientos de MB que alguien había precargado antes
 * de salir a terreno. Con un nombre fijo, la caché de teselas sobrevive a
 * todas las publicaciones y solo la poda por tope (`podarTeselas`) la toca.
 */
const TILES = 'fielddraw-tiles';

/**
 * Áreas descargadas a propósito (ver `src/areaCache.js`). Tampoco lleva
 * versión, y además NUNCA se poda: lo que alguien bajó a conciencia para una
 * campaña no puede desaparecer porque después paneara un rato por otra zona,
 * que es exactamente lo que le pasaría si compartiera cupo con `TILES`.
 * El service worker solo lee de aquí; quien la llena es la página.
 */
const AREAS = 'fielddraw-areas';

/** Tope de teselas guardadas. A ~15 KB cada una son unos 90 MB. */
const TILE_LIMIT = 6000;

/** Plazo de una tesela que alguien está esperando para pintar, en ms. */
const TILE_TIMEOUT_MS = 15000;

/**
 * Plazo de la red cuando ya se sabe que está mala (ver `redMala`): lo justo
 * para aprovechar un hueco de señal, sin dejar el mapa esperando 15 s por
 * cada tesela que falta.
 */
const TILE_TIMEOUT_MALA_MS = 4000;

/** Plazo de cada archivo del shell al instalar una versión nueva. */
const SHELL_TIMEOUT_MS = 30000;

/**
 * Todo lo que la app necesita para arrancar. Las rutas son relativas al scope,
 * así que funcionan igual en la raíz de un dominio que en un subdirectorio.
 */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',

  './src/adopt.js',
  './src/app.js',
  './src/areaCache.js',
  './src/attrs.js',
  './src/basemaps.js',
  './src/compassWidget.js',
  './src/controlPointSymbols.js',
  './src/controlPoints.js',
  './src/dem.js',
  './src/deviceOrientation.js',
  './src/drawController.js',
  './src/editOps.js',
  './src/geologyStyle.js',
  './src/geom.js',
  './src/geometryOps.js',
  './src/geotiff.js',
  './src/idb.js',
  './src/importedFiles.js',
  './src/importedStyle.js',
  './src/mapExport.js',
  './src/mapFrame.js',
  './src/mapView.js',
  './src/notation.js',
  './src/ornaments.js',
  './src/planeTrace.js',
  './src/pdf.js',
  './src/persistence.js',
  './src/profile.js',
  './src/project.js',
  './src/reshape.js',
  './src/section.js',
  './src/average.js',
  './src/sectionExport.js',
  './src/sectionPanel.js',
  './src/sectionInk.js',
  './src/floating.js',
  './src/hiking.js',
  './src/profileWalk.js',
  './src/sketcherLink.js',
  './src/sectionView.js',
  './src/sectionWindow.js',
  './src/sectionZoom.js',
  './src/scale.js',
  './src/shapefile.js',
  './src/shortcuts.js',
  './src/simplify.js',
  './src/snapping.js',
  './src/stereogram.js',
  './src/stereogramPanel.js',
  './src/stereogramView.js',
  './src/store.js',
  './src/stroke.js',
  './src/structure.js',
  './src/structureSymbols.js',
  './src/symbology.js',
  './src/thickness.js',
  './src/tiles.js',
  './src/topology.js',
  './src/ui.js',
  './src/vendorPaths.js',
  './src/version.js',
  './src/vertexEdit.js',
  './src/zip.js',
  './src/strabo/adopt.js',
  './src/strabo/api.js',
  './src/strabo/mapping.js',
  './src/strabo/spots.js',
  './src/strabo/layers.js',
  './src/strabo/upload.js',
  './src/strabo/panel.js',
  './src/strabo/style.js',
  './src/strabo/sync.js',
  './src/strabo/push.js',
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

/*
 * INSTALAR ES TODO O NADA.
 *
 * Antes se precacheaba archivo a archivo, se toleraban los fallos con un
 * `console.warn`, y `skipWaiting` activaba la versión nueva igual. Con señal
 * intermitente eso era un desastre silencioso: la versión nueva quedaba con
 * la mitad de los módulos, `activate` borraba la caché vieja —la que SÍ
 * estaba completa—, y la página se recargaba sola sobre un shell roto. Ahí se
 * caía todo lo que depende de un módulo que faltaba: abrir los MBTiles/PMTiles
 * guardados, el DEM, el dibujo… y parecía que la app "borraba lo descargado".
 *
 * Ahora la instalación falla entera si falta un solo archivo. Un service
 * worker que no instala no reemplaza a nadie: el viejo sigue al mando con su
 * caché intacta y el navegador vuelve a intentarlo en la próxima visita. Lo ya
 * bajado de esta versión se reaprovecha en el reintento (está en la caché de
 * ESTA versión, así que no puede ser de otra), para que con señal mala la
 * actualización avance a trozos en vez de recomenzar cada vez.
 *
 * Y la versión nueva NO toma el control sola (`skipWaiting` ya no va aquí):
 * espera a que la página se lo pida al arrancar, antes de que haya nada
 * abierto que una recarga pudiera interrumpir. Ver `src/app.js`.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      const fallos = [];
      await Promise.all(
        SHELL.map(async (url) => {
          if (await cache.match(url)) return;
          for (let intento = 0; intento < 3; intento++) {
            try {
              const res = await conPlazo(new Request(url, { cache: 'reload' }), SHELL_TIMEOUT_MS);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              await cache.put(url, res);
              return;
            } catch (err) {
              if (intento === 2) fallos.push(`${url}: ${err.message}`);
            }
          }
        }),
      );
      if (fallos.length) {
        // Rechazar aquí deja la instalación en «redundant» y al worker viejo
        // en su sitio, que es justo lo que se quiere.
        throw new Error(`[sw] instalación incompleta, se conserva la versión anterior: ${fallos.join('; ')}`);
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE, TILES, AREAS]);
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

/**
 * La misma tesela con el subdominio canónico.
 *
 * CARTO (y otros) reparten las teselas entre a/b/c/d, y MapLibre elige uno
 * por tesela. Las áreas descargadas se guardan siempre con `a.` (ver
 * `tileUrl` en `areaCache.js`), así que sin esto tres de cada cuatro teselas
 * de un área bajada a propósito no se encontraban sin señal, aunque estaban.
 */
function urlCanonica(href) {
  return href.replace(/^(https?:\/\/)[a-d]\./i, '$1a.');
}

/** Busca en una caché por la URL tal cual y, si no, por la canónica. */
async function buscar(cache, request) {
  const hit = await cache.match(request);
  if (hit) return hit;
  const canon = urlCanonica(request.url);
  return canon !== request.url ? cache.match(canon) : undefined;
}

/** Deja la caché de teselas por debajo del tope, tirando las más antiguas. */
async function podarTeselas() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  if (keys.length <= TILE_LIMIT) return;
  for (const req of keys.slice(0, keys.length - TILE_LIMIT)) await cache.delete(req);
}

/*
 * Podar lista las miles de claves de la caché: hacerlo con cada tesela nueva
 * era trabajo de sobra. Se poda con la primera tras arrancar el service
 * worker y luego cada PODA_CADA teselas nuevas (el tope se pasa por poco y
 * por un rato, nada más).
 */
const PODA_CADA = 50;
let teselasNuevas = 0;

/**
 * Solo se guardan respuestas CORS correctas. Una opaca (sin CORS) puede ser un
 * 404 o un 500 escondido —quedaría guardado como si fuera la tesela— y el
 * navegador la cuenta como varios MB de cuota aunque pese 15 KB: unos cientos
 * bastan para llenar el cupo del sitio, y con él se arriesgan las áreas
 * descargadas y el dibujo en IndexedDB.
 *
 * Se guarda con la URL canónica: la misma tesela pedida por `b.` y por `c.`
 * no ocupa dos veces, y se encuentra igual la pida quien la pida.
 */
async function guardarTesela(cache, request, res) {
  if (!res.ok) return;
  await cache.put(urlCanonica(request.url), res.clone());
  if (teselasNuevas++ % PODA_CADA === 0) await podarTeselas();
}

/*
 * ¿LA RED ESTÁ MALA?
 *
 * Con señal intermitente el patrón es: una tesela llega, diez se cuelgan
 * hasta el plazo. Esperar 15 s por CADA una que falta deja el mapa a medio
 * pintar durante minutos aunque haya con qué rellenarlo. Tras un fallo de red
 * se recuerda durante un rato que está mala, y mientras tanto se usa un plazo
 * corto y se sirve antes el respaldo (la tesela padre reescalada, ver
 * `teselaDeRespaldo`). Una respuesta que llega bien lo borra al instante.
 */
const MALA_DURANTE_MS = 30000;
let malaHasta = 0;
const redMala = () => (self.navigator && self.navigator.onLine === false) || Date.now() < malaHasta;

/*
 * RESPALDO: LA TESELA PADRE, AMPLIADA.
 *
 * Un área bajada hasta z14 deja huecos en blanco en cuanto se acerca a z15 o
 * z16 sin señal: MapLibre pide las teselas de ese zoom, fallan, y una tesela
 * fallida cuenta como "cargada" —no se sigue mostrando la de menos detalle—.
 * Es lo que se veía como "no carga lo que descargué". Aquí, si la tesela no
 * está y la red no la da, se busca en caché su antecesora más cercana, se
 * recorta el cuarto (o el dieciseisavo…) que le corresponde y se amplía.
 * Se ve borrosa, que es la verdad: no hay más detalle descargado.
 *
 * Solo para imágenes (no DEM: interpolar un PNG terrarium mezcla los bytes de
 * la codificación y daría cotas falsas) y solo donde la URL dice claramente
 * dónde van z, x e y. No se guarda: cuando vuelva la señal llega la real.
 */
const MAX_SALTO_ZOOM = 6;

/** z/x/y de una URL de tesela, y cómo reconstruirla con otros valores. */
function parsearTesela(href) {
  const u = new URL(href);
  if (/terrarium|elevation/i.test(u.pathname + u.hostname)) return null;
  // Esri MapServer: …/tile/{z}/{y}/{x}
  let m = /^(.*\/tile\/)(\d+)\/(\d+)\/(\d+)(\/?(?:\.\w+)?)$/.exec(u.pathname);
  if (m) {
    const [, pre, z, y, x, post] = m;
    return {
      z: +z, x: +x, y: +y,
      url: (zz, xx, yy) => `${u.origin}${pre}${zz}/${yy}/${xx}${post}${u.search}`,
    };
  }
  // XYZ: …/{z}/{x}/{y}.png
  m = /^(.*\/)(\d+)\/(\d+)\/(\d+)(@2x)?(\.(?:png|jpe?g|webp))$/i.exec(u.pathname);
  if (m) {
    const [, pre, z, x, y, retina = '', ext] = m;
    return {
      z: +z, x: +x, y: +y,
      url: (zz, xx, yy) => `${u.origin}${pre}${zz}/${xx}/${yy}${retina}${ext}${u.search}`,
    };
  }
  return null;
}

const puedeReescalar = () =>
  typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';

async function teselaDeRespaldo(request) {
  if (!puedeReescalar()) return null;
  const t = parsearTesela(request.url);
  if (!t) return null;
  const [areas, tiles] = await Promise.all([caches.open(AREAS), caches.open(TILES)]);
  for (let salto = 1; salto <= MAX_SALTO_ZOOM && salto <= t.z; salto++) {
    const z = t.z - salto;
    const x = t.x >> salto;
    const y = t.y >> salto;
    const url = t.url(z, x, y);
    const req = new Request(url);
    const res = (await buscar(areas, req)) || (await buscar(tiles, req));
    if (!res || res.type === 'opaque') continue; // una opaca no se puede leer
    try {
      const img = await createImageBitmap(await res.blob());
      const n = 1 << salto;
      const lado = img.width / n;
      const sx = (t.x - (x << salto)) * lado;
      const sy = (t.y - (y << salto)) * lado;
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, lado, lado, 0, 0, img.width, img.height);
      img.close && img.close();
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'X-FieldDraw-Overzoom': String(salto),
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      return null;
    }
  }
  return null;
}

/** Sin copia, sin red y sin respaldo: que falle rápido y con un código claro. */
const sinTesela = () =>
  new Response('Tesela no disponible sin conexión', { status: 504, statusText: 'Offline' });

/** `localhost`: el servidor de desarrollo, no una publicación. */
const DESARROLLO = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname);

/** Copia del shell; `index.html` también responde por `./`. */
async function delShell(request) {
  const cache = await caches.open(PRECACHE);
  return (
    (await cache.match(request, { ignoreSearch: true })) ||
    (request.mode === 'navigate'
      ? (await cache.match('./index.html')) || (await cache.match('./'))
      : undefined)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Los blob: y data: no pasan por aquí, pero sí las peticiones de rango que
  // hace PMTiles sobre un archivo local: esas no se tocan.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (request.headers.has('range')) return;

  const mismoOrigen = url.origin === self.location.origin;

  /*
   * NAVEGACIÓN Y APP SHELL: CACHÉ PRIMERO, SIN IR A LA RED.
   *
   * Antes la navegación iba red-primero sin plazo: con señal débil el `fetch`
   * no falla, se queda colgado, y la app tardaba minutos en abrir —o no abría—
   * aunque la tuviera entera en caché. Era la causa principal del arranque
   * lento. Y cada módulo servido de caché disparaba además un refresco por
   * detrás: ~90 peticiones compitiendo con las teselas en cada arranque, y la
   * posibilidad de quedar con un HTML de una versión y módulos de otra.
   *
   * Ahora el shell es un bloque: sale entero de la caché de su versión, al
   * instante, y solo cambia cuando un service worker nuevo se instala
   * COMPLETO. El navegador revisa `sw.js` en cada navegación por su cuenta, así
   * que las versiones nuevas siguen llegando solas.
   */
  if (request.mode === 'navigate' || mismoOrigen) {
    event.respondWith(
      (async () => {
        // Desarrollando con `node serve.mjs` lo que se quiere es ver el
        // cambio al recargar, sin subir VERSION cada vez: red primero, y la
        // caché solo si el servidor no está.
        if (DESARROLLO) {
          try {
            return await fetch(request);
          } catch {
            /* servidor apagado: lo cacheado */
          }
        }
        const hit = await delShell(request);
        if (hit) return hit;
        // Primera visita, o un archivo fuera del shell (`test/`, por ejemplo).
        try {
          const res = await conPlazo(request, SHELL_TIMEOUT_MS);
          if (res.ok && mismoOrigen && request.mode !== 'navigate') {
            const cache = await caches.open(PRECACHE);
            await cache.put(request, res.clone());
          }
          return res;
        } catch {
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
    /*
     * Teselas: CACHÉ PRIMERO, y a la red solo lo que falta.
     *
     * Una tesela z/x/y no cambia nunca, así que pedirla a la red no aporta
     * nada; pero con señal débil el `fetch` no falla: se queda esperando en
     * un socket muerto, y todo lo que pasa por aquí —basemap, curvas,
     * sombreado, relieve 3D, cotas del perfil— se detenía a la vez aunque
     * estuviera ya descargado. Lo cacheado se sirve al instante; la red solo
     * se espera cuando no hay copia, con plazo, y si falla se rellena con la
     * tesela padre ampliada antes que dejar un hueco.
     *
     * NADA de lo descargado se borra ni se reemplaza por un error: una
     * respuesta fallida no toca la caché.
     */
    event.respondWith(
      (async () => {
        // Las áreas descargadas van PRIMERO y se sirven tal cual, sin
        // refrescarlas por detrás: se pidieron a propósito para trabajar
        // sin señal, y no cambian nunca.
        const areas = await caches.open(AREAS);
        const guardada = await buscar(areas, request);
        if (guardada) return guardada;

        const cache = await caches.open(TILES);
        const hit = await buscar(cache, request);
        if (hit) return hit;

        // Red mala conocida: si hay con qué rellenar, se rellena ya y se
        // intenta la red sin bloquear a nadie (si llega, queda para la
        // próxima vez que se mire).
        if (redMala()) {
          const respaldo = await teselaDeRespaldo(request);
          if (respaldo) {
            event.waitUntil(
              conPlazo(request, TILE_TIMEOUT_MS)
                .then((res) => {
                  malaHasta = 0;
                  return guardarTesela(cache, request, res);
                })
                .catch(() => {}),
            );
            return respaldo;
          }
        }

        try {
          const res = await conPlazo(request, redMala() ? TILE_TIMEOUT_MALA_MS : TILE_TIMEOUT_MS);
          malaHasta = 0;
          if (!res.ok && res.type !== 'opaque') {
            // Un 5xx de un proxy o del proveedor: mejor la padre ampliada.
            const respaldo = res.status >= 500 ? await teselaDeRespaldo(request) : null;
            return respaldo || res;
          }
          // Las opacas (sin CORS) sí se pintan, pero no se guardan: ver guardarTesela.
          event.waitUntil(guardarTesela(cache, request, res));
          return res;
        } catch {
          malaHasta = Date.now() + MALA_DURANTE_MS;
          return (await teselaDeRespaldo(request)) || sinTesela();
        }
      })(),
    );
  }
});

/** Petición con plazo. Sin esto, "sin señal" y "esperando" son lo mismo. */
function conPlazo(request, ms) {
  const abort = new AbortController();
  const corte = setTimeout(() => abort.abort(), ms);
  return fetch(request, { signal: abort.signal }).finally(() => clearTimeout(corte));
}

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
