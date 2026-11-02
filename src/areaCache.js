/**
 * Descargar un área por adelantado para tenerla sin señal.
 *
 * El service worker ya guarda lo que se ha mirado, pero eso obliga a recorrer
 * la zona con el dedo la noche antes y confiar en que quedó todo. Esto es lo
 * contrario: se dice qué recuadro y hasta qué zoom, se ve cuánto pesa ANTES de
 * empezar, y se baja entero con una barra de progreso.
 *
 * TRES DECISIONES QUE NO SON OBVIAS
 *
 * 1. **Caché propia, `fielddraw-areas`, separada de la del service worker.**
 *    La de teselas visitadas tiene tope y se poda por orden de llegada: panear
 *    un rato por otra zona bastaría para tirar lo que alguien bajó a
 *    propósito. Lo descargado a conciencia no compite con lo que se miró de
 *    paso. Tampoco lleva la versión de la app en el nombre, por lo mismo que
 *    la otra: publicar no puede borrar un área de terreno.
 *
 * 2. **Se escribe desde la página, no desde el service worker.** La Cache API
 *    existe igual en los dos y hacerlo aquí evita inventar un protocolo de
 *    mensajes para progreso y cancelación. El service worker solo lee.
 *
 * 3. **El DEM primero y casi gratis.** Un área de 10 × 10 km de z10 a z14 son
 *    ~180 teselas terrarium, unos 5 MB, y con eso quedan offline el sombreado,
 *    el relieve 3D, los perfiles y los ajustes de plano. La misma área de
 *    imagen satelital hasta z17 son ~2000 teselas y decenas de MB. Por precio
 *    y por utilidad no son la misma compra, así que la interfaz las separa.
 */

import { BASEMAPS, PREFETCH_BLOCKED, TERRARIUM_URL } from './basemaps.js';
import { DEM_MAX_ZOOM } from './dem.js';
import { STORE_AREAS, del, getAll, put } from './idb.js';

/** Caché de lo descargado a propósito. Sin versión: ver la cabecera. */
export const AREA_CACHE = 'fielddraw-areas';

/**
 * Topes por área, en teselas.
 *
 * El del DEM es holgado porque el dato es de dominio público (AWS Open Data) y
 * pesa poco: a ~10 KB la tesela, 8000 son unos 80 MB y cubren una campaña
 * entera. El del basemap es estricto a propósito: son teselas de un tercero
 * que la app no paga, y un tope alto convierte "llevarme mi zona" en "clonar
 * medio país", que es justo lo que ningún proveedor quiere.
 */
export const MAX_DEM_TILES = 8000;
/*
 * Era 1500, y con eso z17 alcanzaba para unos 8 × 8 km y z18 para apenas
 * 4 × 4: pedir más detalle obligaba a encoger el área hasta que dejaba de ser
 * una zona de trabajo. 5000 (~140 MB de imagen) da unos 15 × 15 km a z17 y
 * 7 × 7 km a z18, que es una campaña, no un país.
 */
export const MAX_BASEMAP_TILES = 5000;

/** Peso típico por tesela, para estimar antes de bajar nada. */
const BYTES_PER_DEM_TILE = 10 * 1024;
const BYTES_PER_IMAGE_TILE = 28 * 1024;

/** Cuántas a la vez. Cuatro llena el enlace sin ahogar un móvil en terreno. */
const CONCURRENCY = 4;

/** Plazo por tesela. Una que no llega no puede parar la descarga entera. */
const TILE_TIMEOUT_MS = 20000;

/**
 * Intentos por tesela. Con señal de terreno un fallo suelto es lo normal, y
 * una tesela que falla queda como un cuadro en blanco que solo se ve después,
 * sin señal. Un 404 no se reintenta: es que no hay tesela, no que no llegó.
 */
const INTENTOS = 3;
const ESPERA_REINTENTO_MS = [1000, 3000];

/* ------------------------------------------------ matemática de teselas */

/** Tesela X que contiene una longitud, a un zoom dado. */
export function lngToTileX(lng, z) {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
}

/** Tesela Y que contiene una latitud, a un zoom dado (Web Mercator). */
export function latToTileY(lat, z) {
  const n = 2 ** z;
  // Mercator no llega a los polos; fuera de ±85.0511 no hay tesela que valga.
  const clamped = Math.min(85.05112878, Math.max(-85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return Math.min(n - 1, Math.max(0, Math.floor(y)));
}

/**
 * Rango de teselas que cubre un bbox a un zoom.
 * @param {[number,number,number,number]} bbox [w, s, e, n]
 */
export function tileRange(bbox, z) {
  const [w, s, e, n] = bbox;
  const x0 = lngToTileX(Math.min(w, e), z);
  const x1 = lngToTileX(Math.max(w, e), z);
  // La Y crece hacia el sur: el norte del bbox da la fila más baja.
  const y0 = latToTileY(Math.max(s, n), z);
  const y1 = latToTileY(Math.min(s, n), z);
  return { x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

/** Cuántas teselas son un bbox y un rango de zoom, sin generarlas. */
export function countTiles(bbox, zmin, zmax) {
  let total = 0;
  for (let z = zmin; z <= zmax; z++) total += tileRange(bbox, z).count;
  return total;
}

/** Las teselas de un bbox y un rango de zoom, de menos a más detalle. */
export function* tilesOf(bbox, zmin, zmax) {
  for (let z = zmin; z <= zmax; z++) {
    const { x0, x1, y0, y1 } = tileRange(bbox, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) yield { z, x, y };
    }
  }
}

/**
 * Sustituye {z}/{x}/{y} en una plantilla.
 *
 * Los servicios de Esri piden {z}/{y}/{x} —el orden va en la propia plantilla,
 * así que aquí no hay nada que adivinar— y `{s}` de subdominio se resuelve a
 * uno fijo: repartir carga entre a/b/c es justo lo que no toca hacer cuando se
 * baja en masa.
 */
export function tileUrl(template, z, x, y) {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{s}', 'a');
}

/** Metros por tesela a un zoom y latitud: para decir qué detalle se está pidiendo. */
export function metresPerTile(z, lat) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/* ---------------------------------------------------------- estimación */

/**
 * Qué se va a bajar, cuánto pesa y si se puede.
 *
 * Devuelve siempre el desglose completo aunque algo esté vetado: la interfaz
 * necesita poder decir "el DEM sí, el basemap no y por esto".
 */
export function planArea({ bbox, demZoom, basemapId, basemapZoom }) {
  const partes = [];

  if (demZoom != null) {
    const zmax = Math.min(demZoom, DEM_MAX_ZOOM);
    const tiles = countTiles(bbox, 0, zmax);
    partes.push({
      kind: 'dem',
      label: 'Elevation (AWS Terrain Tiles)',
      template: TERRARIUM_URL,
      zmin: 0,
      zmax,
      tiles,
      bytes: tiles * BYTES_PER_DEM_TILE,
      limit: MAX_DEM_TILES,
      blocked: null,
    });
  }

  if (basemapId) {
    const bm = BASEMAPS.find((b) => b.id === basemapId);
    if (bm) {
      const zmax = Math.min(basemapZoom, bm.maxzoom);
      const tiles = countTiles(bbox, 0, zmax);
      partes.push({
        kind: 'basemap',
        basemapId: bm.id,
        label: bm.label,
        template: bm.tiles[0],
        attribution: bm.attribution,
        zmin: 0,
        zmax,
        // Se pidió más detalle del que el proveedor tiene: la interfaz lo
        // dice, en vez de dejar creer que se bajó z18 de un mapa que acaba en z13.
        topado: basemapZoom > bm.maxzoom ? bm.maxzoom : null,
        tiles,
        bytes: tiles * BYTES_PER_IMAGE_TILE,
        limit: MAX_BASEMAP_TILES,
        blocked:
          bm.prefetch === PREFETCH_BLOCKED
            ? `${bm.label} does not allow downloading areas in advance: its tile policy forbids bulk downloading, and those servers are paid for by donations. Import a PMTiles of your area instead — that is the route with no asterisks.`
            : null,
      });
    }
  }

  const usable = partes.filter((p) => !p.blocked);
  return {
    partes,
    tiles: usable.reduce((a, p) => a + p.tiles, 0),
    bytes: usable.reduce((a, p) => a + p.bytes, 0),
    // Un tope por parte, no uno global: el DEM no debe quedarse fuera porque
    // alguien haya pedido demasiada imagen.
    excede: usable.filter((p) => p.tiles > p.limit),
  };
}

/* ----------------------------------------------------------- descarga */

function conPlazo(url, ms, signal) {
  const abort = new AbortController();
  const corte = setTimeout(() => abort.abort(), ms);
  const cancelar = () => abort.abort();
  if (signal) signal.addEventListener('abort', cancelar, { once: true });
  return fetch(url, { mode: 'cors', signal: abort.signal }).finally(() => {
    clearTimeout(corte);
    if (signal) signal.removeEventListener('abort', cancelar);
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pide una tesela con reintentos. Devuelve la respuesta buena, o null si no
 * hay forma: 4xx (no existe), o se agotaron los intentos.
 */
async function pedirTesela(url, signal) {
  for (let i = 0; i < INTENTOS; i++) {
    if (signal && signal.aborted) return null;
    try {
      const res = await conPlazo(url, TILE_TIMEOUT_MS, signal);
      if (res.ok) return res;
      // 404/403/400: no hay tesela; insistir solo gasta datos.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return null;
    } catch {
      /* sin red o plazo agotado: se reintenta */
    }
    if (i < INTENTOS - 1) await dormir(ESPERA_REINTENTO_MS[i] || 3000);
  }
  return null;
}

/**
 * La plantilla de una parte de un área ya guardada.
 *
 * Las áreas nuevas la llevan dentro; las bajadas antes de 0.50 no, y se
 * deduce del basemap (o es el DEM). Sin esto no se podrían comprobar ni
 * completar las áreas viejas, que son justo las que alguien tiene en el
 * teléfono ahora mismo.
 */
export function templateOf(parte) {
  if (parte.template) return parte.template;
  if (parte.kind === 'dem') return TERRARIUM_URL;
  const bm =
    BASEMAPS.find((b) => b.id === parte.basemapId) || BASEMAPS.find((b) => b.label === parte.label);
  return bm ? bm.tiles[0] : null;
}

/**
 * Baja un área y la deja en la caché propia.
 *
 * `onProgress({hechas, total, fallidas})` se llama seguido; `signal` la
 * cancela. Una tesela que falla NO aborta el resto: en terreno se baja con la
 * señal que hay, y un área con tres huecos sirve, mientras que una a medias
 * que se cayó al primer 503 no sirve de nada. Las fallidas se cuentan y se
 * informan.
 */
export async function downloadArea({ id, name, bbox, partes, savedAt }, { onProgress, signal } = {}) {
  /*
   * Pedir almacenamiento persistente justo aquí, con el gesto de descargar:
   * sin él el navegador puede tirar la caché cuando le falta espacio (y
   * Safari, si la web no está instalada en la pantalla de inicio, a los siete
   * días sin abrirla). `app.js` ya lo pide al arrancar, pero Chrome lo
   * concede según el uso, y tras una descarga a propósito es cuando más
   * probable es que diga que sí.
   */
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {
    /* sin persist() la caché funciona igual, solo con menos garantías */
  }
  const cache = await caches.open(AREA_CACHE);
  const usables = partes.filter((p) => !p.blocked);
  const total = usables.reduce((a, p) => a + p.tiles, 0);

  let hechas = 0;
  let fallidas = 0;
  let bytes = 0;
  /*
   * Las URLs que de verdad quedaron guardadas.
   *
   * Se guardan una a una, en vez de recalcularlas al borrar a partir del
   * bbox: deducir z/x/y de una URL obliga a adivinar su forma, y basta con
   * que una plantilla lleve parámetros de consulta —una clave de API, un
   * WMTS— para que el borrado no encuentre nada y el área quede ocupando
   * disco para siempre. A ~60 caracteres por URL, las 8000 de un área tope
   * son unos 480 KB contra decenas de MB de teselas: medio punto porcentual
   * a cambio de que borrar sea exacto.
   */
  const urls = [];

  const avisar = () => onProgress && onProgress({ hechas, total, fallidas });

  for (const parte of usables) {
    const template = templateOf(parte);
    if (!template) continue;
    const cola = tilesOf(bbox, parte.zmin ?? 0, parte.zmax);
    const pesoTipico = parte.kind === 'dem' ? BYTES_PER_DEM_TILE : BYTES_PER_IMAGE_TILE;
    // Un pool de N trabajadores sobre el mismo iterador: cada uno toma la
    // siguiente en cuanto termina, sin montar un array de miles de promesas.
    const trabajador = async () => {
      for (;;) {
        if (signal && signal.aborted) return;
        const siguiente = cola.next();
        if (siguiente.done) return;
        const { z, x, y } = siguiente.value;
        const url = tileUrl(template, z, x, y);
        try {
          const req = new Request(url, { mode: 'cors' });
          const ya = await cache.match(req, { ignoreVary: true });
          if (ya) {
            // Ya estaba de un área anterior que se solapa: no se vuelve a pedir,
            // pero sí se apunta, o borrar aquella se llevaría esta.
            bytes += Number(ya.headers.get('content-length')) || pesoTipico;
            urls.push(url);
            hechas++;
            avisar();
            continue;
          }
          const res = await pedirTesela(url, signal);
          if (res) {
            // Se lee entera ANTES de guardarla: una respuesta cortada a medio
            // cuerpo con señal mala haría fallar `put` o, peor, dejaría una
            // imagen truncada que sin señal se ve como un cuadro gris.
            const blob = await res.blob();
            if (!blob.size) throw new Error('vacía');
            const headers = new Headers(res.headers);
            headers.set('Content-Length', String(blob.size));
            await cache.put(req, new Response(blob, { status: 200, headers }));
            bytes += blob.size;
            urls.push(url);
            hechas++;
          } else if (!(signal && signal.aborted)) {
            fallidas++;
          }
        } catch {
          // Sin red, cuerpo cortado o cuota llena: se cuenta y se sigue.
          if (!(signal && signal.aborted)) fallidas++;
        }
        avisar();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, trabajador));
    if (signal && signal.aborted) break;
  }

  const registro = {
    id,
    name,
    bbox,
    partes: usables.map((p) => ({
      kind: p.kind,
      label: p.label,
      zmin: p.zmin ?? 0,
      zmax: p.zmax,
      tiles: p.tiles,
      basemapId: p.basemapId,
      template: templateOf(p),
    })),
    urls,
    tiles: hechas,
    fallidas,
    // El `content-length` no viene en respuestas opacas, así que cuando no hay
    // dato se cae a la estimación en vez de decir "0 MB", que sería mentira.
    bytes: bytes || usables.reduce((a, p) => a + p.bytes, 0),
    savedAt: savedAt || Date.now(),
    checkedAt: Date.now(),
    cancelada: !!(signal && signal.aborted),
  };
  await put(STORE_AREAS, registro);
  return registro;
}

/* ------------------------------------------------------- administración */

export async function listAreas() {
  const all = await getAll(STORE_AREAS);
  return all.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/**
 * Borra un área del manifiesto y sus teselas de la caché.
 *
 * Una tesela que TAMBIÉN pertenece a otra área guardada se conserva: si no,
 * borrar la zona grande dejaría agujeros en la pequeña que la solapa, y esos
 * agujeros no se verían hasta estar en el cerro sin señal.
 */
export async function deleteArea(id) {
  const areas = await listAreas();
  const victima = areas.find((a) => a.id === id);
  await del(STORE_AREAS, id);
  if (!victima) return { borradas: 0 };

  const deOtras = new Set();
  for (const a of areas) {
    if (a.id === id) continue;
    for (const u of a.urls || []) deOtras.add(u);
  }

  const cache = await caches.open(AREA_CACHE);
  let borradas = 0;
  for (const url of victima.urls || []) {
    if (deOtras.has(url)) continue;
    if (await cache.delete(url)) borradas++;
  }
  return { borradas };
}

/**
 * Cuántas teselas de un área están de verdad en la caché, sin usar la red.
 *
 * Es la prueba que vale antes de salir a terreno: no lo que dijo la descarga
 * en su momento, sino lo que hay AHORA en el disco —el navegador puede haber
 * desalojado algo, o la descarga pudo cortarse—. Se recorre la rejilla
 * esperada a partir del bbox, no la lista de URLs guardadas, para que una
 * tesela que nunca llegó cuente como hueco.
 */
export async function checkArea(area, { signal } = {}) {
  const cache = await caches.open(AREA_CACHE);
  let esperadas = 0;
  let presentes = 0;
  const porParte = [];
  for (const parte of area.partes || []) {
    const template = templateOf(parte);
    if (!template) continue;
    let e = 0;
    let p = 0;
    for (const { z, x, y } of tilesOf(area.bbox, parte.zmin ?? 0, parte.zmax)) {
      if (signal && signal.aborted) break;
      e++;
      if (await cache.match(tileUrl(template, z, x, y), { ignoreVary: true })) p++;
    }
    esperadas += e;
    presentes += p;
    porParte.push({ label: parte.label, kind: parte.kind, esperadas: e, presentes: p });
  }
  return { esperadas, presentes, faltan: esperadas - presentes, porParte };
}

/**
 * Completa un área ya guardada: baja solo lo que falta y rehace su registro.
 *
 * Sirve para una descarga cancelada, una que dejó teselas fallidas por la
 * señal, o una que el navegador desalojó en parte. Lo que ya está no se pide
 * otra vez, así que sobre un área completa solo cuesta recorrer la caché.
 */
export function completeArea(area, opts) {
  const partes = (area.partes || []).map((p) => ({
    ...p,
    zmin: p.zmin ?? 0,
    template: templateOf(p),
    tiles: countTiles(area.bbox, p.zmin ?? 0, p.zmax),
    blocked: null,
  }));
  return downloadArea(
    { id: area.id, name: area.name, bbox: area.bbox, partes, savedAt: area.savedAt },
    opts,
  );
}

/** Cuánto ocupa lo descargado y cuánto deja el navegador, en bytes. */
export async function storageUse() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usage: usage || 0, quota: quota || 0 };
}
