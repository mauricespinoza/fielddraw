import { TERRARIUM_URL } from './basemaps.js';

/**
 * Lectura de cotas desde el DEM.
 *
 * Usa las mismas teselas terrarium de AWS que ya alimentan las curvas de nivel
 * (`elevation-tiles-prod`, dominio público). Eso no es casualidad ni pereza:
 * son las únicas que cumplen las dos condiciones que hacen falta para leerlas
 * desde el navegador —responden `Access-Control-Allow-Origin: *`, así que el
 * canvas no queda contaminado y `getImageData` funciona— y además el service
 * worker ya las cachea, con lo que un perfil sobre una zona que se miró antes
 * de salir se calcula **sin señal**.
 *
 * El Copernicus 30 m de AWS se descartó tras comprobarlo: admite lecturas por
 * rango (206) pero no manda cabeceras CORS y su preflight responde 403, así
 * que el navegador no puede leerlo sin un proxy propio — y un proxy rompe que
 * la app sea estática y funcione offline. La vía limpia para Copernicus es la
 * API de OpenTopography, que sí manda CORS pero exige clave y red.
 */

/** Terrarium llega hasta z15; por encima, MapLibre repetiría la misma tesela. */
export const DEM_MAX_ZOOM = 15;

/**
 * Zoom por omisión del muestreo. A z13 y latitud 37° cada píxel son ~15 m,
 * por debajo del tamaño real del dato (~30 m), así que subir más solo
 * interpola: se descargarían cuatro veces más teselas para el mismo detalle.
 */
export const DEM_DEFAULT_ZOOM = 13;

/**
 * Decodifica la cota de un píxel terrarium.
 * El esquema empaqueta metros sobre -32768 con el azul como fracción.
 */
export function decodeElevation(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/** Metros por píxel del DEM a un zoom y latitud dados. Sirve para avisar. */
export function metresPerPixel(zoom, lat) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Posición de un punto dentro del esquema de teselas: qué tesela y qué píxel.
 * @returns {{x: number, y: number, px: number, py: number}}
 */
export function lngLatToTilePixel(lng, lat, zoom, tileSize = 256) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const fx = ((lng + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  // Fuera del rango de latitudes de Mercator no hay tesela que valga.
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return {
    x: ((x % n) + n) % n,
    y: Math.min(Math.max(y, 0), n - 1),
    px: Math.min(tileSize - 1, Math.max(0, Math.floor((fx - x) * tileSize))),
    py: Math.min(tileSize - 1, Math.max(0, Math.floor((fy - y) * tileSize))),
  };
}

const R_EARTH = 6371008.8;

/** Distancia entre dos puntos lng/lat, en metros. */
export function haversine(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitud total de una polilínea, en metros. */
export function lineLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

/**
 * Reparte `samples` puntos equiespaciados **por distancia** a lo largo de la
 * polilínea. Equiespaciar por vértice daría un perfil deformado en cuanto los
 * tramos midan distinto, que es lo normal al dibujar a mano.
 *
 * @returns {Array<{lngLat: [number, number], distance: number}>}
 */
export function densify(coords, samples = 200) {
  const limpio = coords.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (limpio.length < 2) return [];

  const acumulado = [0];
  for (let i = 1; i < limpio.length; i++) {
    acumulado.push(acumulado[i - 1] + haversine(limpio[i - 1], limpio[i]));
  }
  const total = acumulado[acumulado.length - 1];
  if (total === 0) return [{ lngLat: limpio[0].slice(), distance: 0 }];

  const n = Math.max(2, Math.floor(samples));
  const out = [];
  let seg = 1;
  for (let i = 0; i < n; i++) {
    const d = (total * i) / (n - 1);
    while (seg < acumulado.length - 1 && acumulado[seg] < d) seg++;
    const d0 = acumulado[seg - 1];
    const d1 = acumulado[seg];
    const t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    const a = limpio[seg - 1];
    const b = limpio[seg];
    out.push({
      lngLat: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      distance: d,
    });
  }
  return out;
}

/**
 * Estadísticas de un perfil. Los desniveles acumulados ignoran el ruido por
 * debajo de `umbral`: un DEM tiene error vertical de varios metros y, sin ese
 * filtro, un perfil llano acumularía cientos de metros de "subida" que solo
 * son ruido.
 *
 * El umbral por omisión es el propio error vertical del modelo y no un número
 * suelto: por debajo de una sigma, un escalón entre muestras contiguas es
 * indistinguible del error del dato.
 */
export function profileStats(muestras, umbral = DEM_VERTICAL_SIGMA_M) {
  const validas = muestras.filter((m) => Number.isFinite(m.elevation));
  if (validas.length === 0) {
    return { min: null, max: null, gain: 0, loss: 0, length: 0, samples: 0, missing: muestras.length };
  }

  let min = Infinity;
  let max = -Infinity;
  let gain = 0;
  let loss = 0;
  let ref = validas[0].elevation;

  for (const m of validas) {
    if (m.elevation < min) min = m.elevation;
    if (m.elevation > max) max = m.elevation;
    const delta = m.elevation - ref;
    if (Math.abs(delta) >= umbral) {
      if (delta > 0) gain += delta;
      else loss -= delta;
      ref = m.elevation;
    }
  }

  return {
    min,
    max,
    gain,
    loss,
    length: muestras.length ? muestras[muestras.length - 1].distance : 0,
    samples: validas.length,
    missing: muestras.length - validas.length,
  };
}

/**
 * Resolución nominal del dato que hay DETRÁS de las teselas terrarium.
 *
 * En Chile continental el relleno de `elevation-tiles-prod` es SRTM de 1 arco
 * de segundo, o sea unos 30 m. Se declara aparte del paso de muestreo porque
 * son cosas distintas y confundirlas es lo que produce perfiles con falsa
 * precisión: se puede muestrear cada 4 m sobre una tesela z15, pero eso no
 * crea información que el dato no tiene.
 */
export const TERRARIUM_NOMINAL_M = 30;

/**
 * Error vertical típico del DEM, en metros (1σ).
 *
 * SRTM/Copernicus rondan los 4-6 m de error absoluto en terreno montañoso. Es
 * el número que después propaga `structure.js` para decir cuánta
 * incertidumbre lleva un manteo calculado sobre el modelo, y el que filtra el
 * ruido del desnivel acumulado.
 */
export const DEM_VERTICAL_SIGMA_M = 5;

/**
 * @typedef {object} ProfileResult
 * @property {Array<{lngLat: [number, number], distance: number, elevation: number|null}>} samples
 * @property {object} stats
 * @property {string} source     id de la fuente usada
 * @property {string} label      nombre legible de la fuente
 * @property {number} step       separación entre muestras del ráster, en metros
 * @property {number} nominal    resolución real del dato, en metros
 * @property {boolean} offline   si la fuente puede responder sin señal
 */

/**
 * Esqueleto común de los dos muestreadores: densificar, pedir cotas y resumir.
 * Lo único que cambia entre fuentes es de dónde sale cada cota.
 */
export async function buildProfile(coords, samples, elevationAt, meta) {
  const puntos = densify(coords, samples);
  const cotas = await Promise.all(puntos.map((p) => elevationAt(p.lngLat[0], p.lngLat[1])));
  const muestras = puntos.map((p, i) => ({ ...p, elevation: cotas[i] }));
  return { samples: muestras, stats: profileStats(muestras), ...meta };
}

/**
 * Muestreador de cotas. Guarda las teselas ya decodificadas: un perfil de 200
 * puntos suele caer sobre dos o tres teselas, así que sin caché se pediría la
 * misma decenas de veces.
 */
export class DemSampler {
  constructor({ url = TERRARIUM_URL, zoom = DEM_DEFAULT_ZOOM, tileSize = 256 } = {}) {
    this.url = url;
    this.zoom = Math.min(zoom, DEM_MAX_ZOOM);
    this.tileSize = tileSize;
    /** clave "z/x/y" -> Promise<Float32Array|null> */
    this.tiles = new Map();
  }

  tileUrl(z, x, y) {
    return this.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  /** Descarga y decodifica una tesela a un array de cotas. */
  loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let pendiente = this.tiles.get(key);
    if (pendiente) return pendiente;

    pendiente = new Promise((resolve) => {
      const img = new Image();
      // Sin esto el canvas queda contaminado y getImageData lanza.
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = this.tileSize;
          canvas.height = this.tileSize;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, this.tileSize, this.tileSize);
          const { data } = ctx.getImageData(0, 0, this.tileSize, this.tileSize);
          const out = new Float32Array(this.tileSize * this.tileSize);
          for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            out[j] = decodeElevation(data[i], data[i + 1], data[i + 2]);
          }
          resolve(out);
        } catch {
          resolve(null);
        }
      };
      // Mar abierto, hueco de cobertura o falta de red: no hay cota, y eso no
      // es un error que deba tumbar el perfil entero.
      img.onerror = () => resolve(null);
      img.src = this.tileUrl(z, x, y);
    });

    this.tiles.set(key, pendiente);
    return pendiente;
  }

  async elevationAt(lng, lat) {
    const { x, y, px, py } = lngLatToTilePixel(lng, lat, this.zoom, this.tileSize);
    const tile = await this.loadTile(this.zoom, x, y);
    if (!tile) return null;
    const v = tile[py * this.tileSize + px];
    // El valor de "sin dato" del esquema queda muy por debajo de la fosa.
    return Number.isFinite(v) && v > -12000 ? v : null;
  }

  /**
   * Perfil de una polilínea.
   * @returns {Promise<import('./dem.js').ProfileResult>}
   */
  async profile(coords, samples = 200) {
    const latMedia = coords.length ? coords[Math.floor(coords.length / 2)][1] : 0;
    return buildProfile(coords, samples, (lng, lat) => this.elevationAt(lng, lat), {
      source: 'terrarium',
      label: 'Terrarium (AWS)',
      step: metresPerPixel(this.zoom, latMedia),
      nominal: TERRARIUM_NOMINAL_M,
      offline: true,
    });
  }
}

/* ==================================================== OpenTopography ==== */

/**
 * Copernicus GLO-30 a través de OpenTopography.
 *
 * Por qué no se lee el COG directo del bucket de AWS (`copernicus-dem-30m`):
 * admite peticiones por rango —responde 206— pero NO manda cabeceras CORS y su
 * preflight contesta 403, así que el navegador no puede tocarlo sin un proxy
 * propio. Un proxy convertiría FieldDraw en una app con backend, que es justo
 * lo contrario de lo que la hace publicable en cualquier hosting estático y
 * usable sin señal.
 *
 * OpenTopography sí manda `Access-Control-Allow-Origin: *`. El precio es una
 * clave gratuita y depender de la red: esta fuente NO sirve en terreno. Por eso
 * el terrarium sigue siendo la opción por omisión y esta es explícita.
 *
 * Se pide `AAIGrid` —el ASCII grid de ESRI— y no GeoTIFF a propósito: es texto
 * plano, se parsea en veinte líneas y evita meter una librería de GeoTIFF de
 * varios cientos de KB en `vendor/` para leer un recorte que cabe en memoria.
 */
export const OPENTOPO_URL = 'https://portal.opentopography.org/API/globaldem';

/** Dónde se saca la clave, para poder enlazarlo desde la interfaz. */
export const OPENTOPO_SIGNUP = 'https://portal.opentopography.org/myopentopo';

export const OPENTOPO_DEMS = [
  { id: 'COP30', label: 'Copernicus GLO-30', nominal: 30, maxAreaKm2: 450000 },
  { id: 'COP90', label: 'Copernicus GLO-90', nominal: 90, maxAreaKm2: 450000 },
  { id: 'SRTMGL1', label: 'SRTM GL1', nominal: 30, maxAreaKm2: 450000 },
];

export const OPENTOPO_DEM_BY_ID = new Map(OPENTOPO_DEMS.map((d) => [d.id, d]));

/**
 * Parsea un ASCII grid de ESRI.
 *
 * La cabecera son seis pares clave/valor y después vienen las filas, de norte
 * a sur. `xllcorner` es la esquina de la celda inferior izquierda; algunos
 * servidores mandan `xllcenter`, que es su centro — media celda de diferencia
 * que, sin corregir, desplaza el perfil entero.
 */
export function parseAAIGrid(text) {
  const tokens = String(text).trim().split(/\s+/);
  const head = {};
  let i = 0;
  // La cabecera termina en cuanto un token deja de ser una clave conocida.
  const CLAVES = new Set([
    'ncols', 'nrows', 'xllcorner', 'yllcorner', 'xllcenter', 'yllcenter',
    'cellsize', 'dx', 'dy', 'nodata_value',
  ]);
  while (i + 1 < tokens.length && CLAVES.has(tokens[i].toLowerCase())) {
    head[tokens[i].toLowerCase()] = Number(tokens[i + 1]);
    i += 2;
  }

  const ncols = head.ncols;
  const nrows = head.nrows;
  if (!Number.isFinite(ncols) || !Number.isFinite(nrows) || ncols <= 0 || nrows <= 0) {
    throw new Error('El grid no declara ncols/nrows');
  }
  const cellsize = Number.isFinite(head.cellsize) ? head.cellsize : head.dx;
  if (!Number.isFinite(cellsize) || cellsize <= 0) throw new Error('El grid no declara cellsize');

  const xll = Number.isFinite(head.xllcorner) ? head.xllcorner : head.xllcenter - cellsize / 2;
  const yll = Number.isFinite(head.yllcorner) ? head.yllcorner : head.yllcenter - cellsize / 2;
  if (!Number.isFinite(xll) || !Number.isFinite(yll)) throw new Error('El grid no declara su origen');

  const nodata = Number.isFinite(head.nodata_value) ? head.nodata_value : -9999;
  const data = new Float32Array(ncols * nrows);
  for (let k = 0; k < data.length; k++) {
    const v = Number(tokens[i + k]);
    data[k] = Number.isFinite(v) && v !== nodata ? v : NaN;
  }
  return { ncols, nrows, xll, yll, cellsize, nodata, data };
}

/**
 * Cota interpolada bilinealmente. Fuera del grid, o si alguna de las cuatro
 * celdas es "sin dato", devuelve null: interpolar contra un hueco inventaría
 * una cota intermedia que el dato no respalda.
 */
export function sampleGrid(grid, lng, lat) {
  const { ncols, nrows, xll, yll, cellsize, data } = grid;
  // Índice fraccionario sobre CENTROS de celda; la fila 0 es la del norte.
  const fx = (lng - xll) / cellsize - 0.5;
  const fy = (yll + nrows * cellsize - lat) / cellsize - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > ncols - 0.5 || fy > nrows - 0.5) return null;

  const x0 = Math.min(ncols - 1, Math.max(0, Math.floor(fx)));
  const y0 = Math.min(nrows - 1, Math.max(0, Math.floor(fy)));
  const x1 = Math.min(ncols - 1, x0 + 1);
  const y1 = Math.min(nrows - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));

  const v00 = data[y0 * ncols + x0];
  const v10 = data[y0 * ncols + x1];
  const v01 = data[y1 * ncols + x0];
  const v11 = data[y1 * ncols + x1];
  if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
    return null;
  }
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
}

/** Envolvente de una polilínea, con un margen en grados. */
export function bboxOfCoords(coords, pad = 0) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const c of coords) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    if (c[0] < west) west = c[0];
    if (c[0] > east) east = c[0];
    if (c[1] < south) south = c[1];
    if (c[1] > north) north = c[1];
  }
  if (west === Infinity) return null;
  return {
    west: Math.max(-180, west - pad),
    east: Math.min(180, east + pad),
    south: Math.max(-90, south - pad),
    north: Math.min(90, north + pad),
  };
}

/** Área aproximada de una envolvente, en km². Sirve para avisar antes de pedir. */
export function bboxAreaKm2(bbox) {
  const latMedia = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const alto = ((bbox.north - bbox.south) * Math.PI * R_EARTH) / 180;
  const ancho = ((bbox.east - bbox.west) * Math.PI * R_EARTH * Math.cos(latMedia)) / 180;
  return (alto * ancho) / 1e6;
}

/** Mensaje útil a partir del código de respuesta, que es lo único que manda. */
function mensajeOpenTopo(status, cuerpo) {
  if (status === 401) return 'OpenTopography rejected the API key (401). Check it in Settings.';
  if (status === 400) return `OpenTopography rejected the request (400): ${cuerpo || 'bad bounding box'}.`;
  if (status === 429) return 'OpenTopography quota exceeded (429). Try again later.';
  if (status >= 500) return `OpenTopography had a server error (${status}). Try again later.`;
  return `OpenTopography answered HTTP ${status}.`;
}

export class OpenTopoSampler {
  constructor({ key, demtype = 'COP30', pad = 0.005, fetchImpl } = {}) {
    this.key = key;
    this.demtype = demtype;
    this.pad = pad;
    // Inyectable para poder probar el parseo y la URL sin tocar la red.
    this.fetch = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.grid = null;
  }

  /**
   * URL del recorte. La clave viaja como parámetro porque es el único
   * mecanismo que ofrece esta API: no admite cabecera de autorización.
   */
  requestUrl(bbox) {
    const u = new URL(OPENTOPO_URL);
    u.searchParams.set('demtype', this.demtype);
    u.searchParams.set('south', String(bbox.south));
    u.searchParams.set('north', String(bbox.north));
    u.searchParams.set('west', String(bbox.west));
    u.searchParams.set('east', String(bbox.east));
    u.searchParams.set('outputFormat', 'AAIGrid');
    u.searchParams.set('API_Key', this.key || '');
    return u.toString();
  }

  /** Descarga y cachea el recorte que cubre toda la traza de una sola vez. */
  async loadGrid(coords) {
    if (!this.key) throw new Error('OpenTopography needs a free API key. Add it in Settings.');
    const bbox = bboxOfCoords(coords, this.pad);
    if (!bbox) throw new Error('The line has no valid coordinates.');

    const dem = OPENTOPO_DEM_BY_ID.get(this.demtype);
    const area = bboxAreaKm2(bbox);
    if (dem && area > dem.maxAreaKm2) {
      throw new Error(
        `That bounding box is ${Math.round(area).toLocaleString()} km²; ${dem.label} allows ${dem.maxAreaKm2.toLocaleString()} km² per request.`,
      );
    }

    const res = await this.fetch(this.requestUrl(bbox));
    if (!res.ok) {
      let cuerpo = '';
      try {
        cuerpo = (await res.text()).trim().slice(0, 200);
      } catch {
        // El cuerpo del error es opcional; el código de estado ya dice bastante.
      }
      throw new Error(mensajeOpenTopo(res.status, cuerpo));
    }
    this.grid = parseAAIGrid(await res.text());
    return this.grid;
  }

  elevationAt(lng, lat) {
    return this.grid ? sampleGrid(this.grid, lng, lat) : null;
  }

  async profile(coords, samples = 200) {
    await this.loadGrid(coords);
    const dem = OPENTOPO_DEM_BY_ID.get(this.demtype);
    const latMedia = coords.length ? coords[Math.floor(coords.length / 2)][1] : 0;
    return buildProfile(coords, samples, (lng, lat) => this.elevationAt(lng, lat), {
      source: this.demtype,
      label: `${dem ? dem.label : this.demtype} · OpenTopography`,
      step: this.grid
        ? this.grid.cellsize * 111320 * Math.cos((latMedia * Math.PI) / 180)
        : NaN,
      nominal: dem ? dem.nominal : 30,
      offline: false,
    });
  }
}
