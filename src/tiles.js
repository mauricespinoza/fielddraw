import maplibregl from 'maplibre-gl';
import { loadSql } from './gpkg/index.js';
import { loadVendorScript } from './vendorPaths.js';

/**
 * Mapas offline: MBTiles y PMTiles.
 *
 * Los dos formatos guardan lo mismo, pero se leen de forma muy distinta:
 *
 * - **PMTiles** está pensado para lecturas por rango, así que `FileSource`
 *   sirve teselas haciendo `blob.slice()` sobre el archivo local. Un mapa de
 *   varios GB funciona sin cargar nada en memoria. Es el formato recomendado.
 * - **MBTiles** es SQLite, y sql.js solo opera sobre una base en memoria: hay
 *   que cargar el archivo entero. Va bien hasta unos cientos de MB y de ahí en
 *   adelante conviene convertirlo a PMTiles.
 */

/** Umbral a partir del cual avisamos de que el MBTiles puede no caber. */
export const MBTILES_WARN_BYTES = 250 * 1024 * 1024;

const PNG_1x1_TRANSPARENT = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

const mbtilesRegistry = new Map();
let protocolsReady = false;
let pmtilesProtocol = null;

let pmtilesPromise = null;
/**
 * PMTiles sale de `vendor/` como script clásico, no como módulo: es la única
 * forma de tener un archivo autocontenido que el service worker pueda
 * precachear entero, y abrir un mapa offline es justo lo que hay que poder
 * hacer sin señal.
 */
function loadPmtiles() {
  if (!pmtilesPromise) {
    pmtilesPromise = loadVendorScript('pmtiles.js').then(() => {
      if (!globalThis.pmtiles) throw new Error('pmtiles no expuso el objeto global');
      return globalThis.pmtiles;
    });
  }
  return pmtilesPromise;
}

/** Las teselas vectoriales de MBTiles vienen gzipeadas casi siempre. */
async function maybeGunzip(bytes) {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('El navegador no soporta DecompressionStream (necesario para teselas gzip)');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Devuelve la tesela XYZ pedida. Un hueco no es un error: se responde con un
 * PNG transparente (o una tesela vectorial vacía) para que MapLibre no marque
 * la petición como fallida en zonas sin cobertura.
 */
export async function readMbtilesTile(key, z, x, y) {
  const entry = mbtilesRegistry.get(key);
  if (!entry) throw new Error(`MBTiles no registrado: ${key}`);

  // MBTiles indexa en TMS: la fila 0 es la de más al sur, al revés que XYZ.
  const tmsY = (1 << z) - 1 - y;

  const stmt = entry.db.prepare(
    'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=? LIMIT 1',
  );
  let data = null;
  try {
    stmt.bind([z, x, tmsY]);
    if (stmt.step()) data = stmt.get()[0];
  } finally {
    stmt.free();
  }

  if (!data || data.length === 0) {
    return entry.tileKind === 'raster' ? PNG_1x1_TRANSPARENT.slice() : new Uint8Array(0);
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return entry.tileKind === 'vector' ? maybeGunzip(bytes) : bytes;
}

async function registerProtocols() {
  if (protocolsReady) return;

  maplibregl.addProtocol('mbtiles', async (params) => {
    const m = /^mbtiles:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`URL mbtiles inválida: ${params.url}`);
    const bytes = await readMbtilesTile(m[1], Number(m[2]), Number(m[3]), Number(m[4]));
    return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  });

  const pmtiles = await loadPmtiles();
  pmtilesProtocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);
  protocolsReady = true;
}

function parseBounds(value) {
  if (!value) return null;
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts; // [w, s, e, n]
}

function vectorLayersFrom(json) {
  if (!json) return [];
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    const list = parsed.vector_layers || [];
    return list.map((l) => ({ id: l.id, description: l.description || '' }));
  } catch {
    return [];
  }
}

async function openMbtiles(file, id) {
  const SQL = await loadSql();
  const buf = await file.arrayBuffer();
  const db = new SQL.Database(new Uint8Array(buf));

  const meta = {};
  try {
    const stmt = db.prepare('SELECT name, value FROM metadata');
    while (stmt.step()) {
      const [name, value] = stmt.get();
      meta[name] = value;
    }
    stmt.free();
  } catch {
    // metadata es opcional en la práctica; seguimos con valores por defecto.
  }

  const format = String(meta.format || 'png').toLowerCase();
  const tileKind = format === 'pbf' || format === 'mvt' ? 'vector' : 'raster';

  let minzoom = Number(meta.minzoom);
  let maxzoom = Number(meta.maxzoom);
  if (!Number.isFinite(minzoom) || !Number.isFinite(maxzoom)) {
    const r = db.exec('SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles');
    const v = r[0] && r[0].values[0];
    if (v) {
      minzoom = Number(v[0]);
      maxzoom = Number(v[1]);
    }
  }

  mbtilesRegistry.set(id, { db, tileKind });

  return {
    id,
    label: meta.name || file.name,
    protocol: 'mbtiles',
    url: `mbtiles://${id}/{z}/{x}/{y}`,
    tileKind,
    format,
    minzoom: Number.isFinite(minzoom) ? minzoom : 0,
    maxzoom: Number.isFinite(maxzoom) ? maxzoom : 14,
    bounds: parseBounds(meta.bounds),
    vectorLayers: vectorLayersFrom(meta.json),
    bytes: file.size,
  };
}

const PMTILES_KIND = { 1: 'vector', 2: 'raster', 3: 'raster', 4: 'raster', 5: 'raster' };

async function openPmtiles(file, id) {
  const pmtiles = await loadPmtiles();
  const archive = new pmtiles.PMTiles(new pmtiles.FileSource(file));
  const header = await archive.getHeader();
  pmtilesProtocol.add(archive);

  const tileKind = PMTILES_KIND[header.tileType] || 'raster';
  let vectorLayers = [];
  let name = file.name;
  try {
    const meta = await archive.getMetadata();
    vectorLayers = vectorLayersFrom(meta);
    if (meta && meta.name) name = meta.name;
  } catch {
    // Metadatos opcionales.
  }

  return {
    id,
    label: name,
    protocol: 'pmtiles',
    url: `pmtiles://${archive.source.getKey()}/{z}/{x}/{y}`,
    tileKind,
    format: tileKind === 'vector' ? 'pbf' : 'raster',
    minzoom: header.minZoom ?? 0,
    maxzoom: header.maxZoom ?? 14,
    bounds:
      Number.isFinite(header.minLon)
        ? [header.minLon, header.minLat, header.maxLon, header.maxLat]
        : null,
    vectorLayers,
    bytes: file.size,
  };
}

/** Abre un .mbtiles o .pmtiles y devuelve su descriptor. */
export async function openTileFile(file, id) {
  await registerProtocols();
  const name = file.name.toLowerCase();
  if (name.endsWith('.pmtiles')) return openPmtiles(file, id);
  if (name.endsWith('.mbtiles')) return openMbtiles(file, id);
  throw new Error('Formato no reconocido: se esperaba .mbtiles o .pmtiles');
}

export function disposeTileSet(descriptor) {
  if (descriptor.protocol !== 'mbtiles') return;
  const entry = mbtilesRegistry.get(descriptor.id);
  if (entry) {
    try {
      entry.db.close();
    } catch {
      /* ya cerrada */
    }
    mbtilesRegistry.delete(descriptor.id);
  }
}

/** Color estable por nombre de capa vectorial, para el render genérico. */
export function layerColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 65%, 55%)`;
}

/**
 * Especificación de fuente y capas para un set de teselas.
 *
 * Las vectoriales se pintan con un estilo genérico tipo "inspector" — una capa
 * por geometría y color estable por nombre — porque un .mbtiles vectorial
 * arbitrario no trae con qué simbolizarlo.
 */
export function buildTileLayers(descriptor) {
  const sourceId = `tiles-src-${descriptor.id}`;
  const common = {
    minzoom: descriptor.minzoom,
    maxzoom: descriptor.maxzoom,
    ...(descriptor.bounds ? { bounds: descriptor.bounds } : {}),
  };

  if (descriptor.tileKind === 'raster') {
    return {
      sourceId,
      source: { type: 'raster', tiles: [descriptor.url], tileSize: 256, ...common },
      layers: [
        {
          id: `tiles-${descriptor.id}`,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': 1 },
        },
      ],
    };
  }

  const source = { type: 'vector', tiles: [descriptor.url], ...common };
  const layers = [];
  const names = descriptor.vectorLayers.length
    ? descriptor.vectorLayers.map((l) => l.id)
    : ['default'];

  for (const name of names) {
    const color = layerColor(name);
    const base = { source: sourceId, 'source-layer': name };
    layers.push({
      ...base,
      id: `tiles-${descriptor.id}-${name}-fill`,
      type: 'fill',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': color, 'fill-opacity': 0.25 },
    });
    layers.push({
      ...base,
      id: `tiles-${descriptor.id}-${name}-line`,
      type: 'line',
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: { 'line-color': color, 'line-width': 1, 'line-opacity': 0.9 },
    });
    layers.push({
      ...base,
      id: `tiles-${descriptor.id}-${name}-point`,
      type: 'circle',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-color': color, 'circle-radius': 2.5, 'circle-opacity': 0.9 },
    });
  }

  return { sourceId, source, layers };
}
