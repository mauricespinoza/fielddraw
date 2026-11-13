/**
 * Proyectos más livianos: coordenadas a 7 decimales y texto comprimido.
 *
 * COORDENADAS. Un vértice salía con todos los dígitos de un double —
 * `-71.25702961457641`, quince decimales—, que en el terreno son nanómetros.
 * Siete decimales son ~1 cm en latitud y menos en longitud: muy por debajo de
 * lo que dan un GPS o un dedo sobre la pantalla. Con 3000 elementos y ~250 000
 * vértices el JSON baja de 10,6 a 6,9 MB, y eso es lo que se escribe en cada
 * autoguardado y lo que viaja en cada proyecto.
 *
 * Solo se redondean los arrays bajo la clave `coordinates` (las geometrías
 * GeoJSON). Un rumbo, una cota o una dispersión son números de otra escala y
 * se dejan como estén.
 *
 * COMPRESIÓN. Un proyecto es texto muy repetitivo —las mismas claves en cada
 * elemento, dígitos—: gzip lo deja en ~¼. Se usa `CompressionStream`, que
 * viene en el navegador (Safari 16.4+, Chrome 80+), así que no hace falta
 * ninguna librería. Si no está, se guarda sin comprimir y el archivo sigue
 * siendo un proyecto válido.
 */

const ESCALA = 1e7;

const redondear = (v) => Math.round(v * ESCALA) / ESCALA;

/** Copia de unas coordenadas GeoJSON con cada número a 7 decimales. */
export function roundCoords(c) {
  if (typeof c === 'number') return Number.isFinite(c) ? redondear(c) : c;
  if (!Array.isArray(c)) return c;
  const out = new Array(c.length);
  for (let i = 0; i < c.length; i++) out[i] = roundCoords(c[i]);
  return out;
}

function replacer(key, value) {
  return key === 'coordinates' && Array.isArray(value) ? roundCoords(value) : value;
}

/**
 * Copia de cada elemento con la geometría a 7 decimales, recordada por
 * identidad.
 *
 * Es lo que usa el autoguardado. El store no muta: un elemento que no cambió
 * es el MISMO objeto que en el guardado anterior, así que su copia redondeada
 * se reutiliza y solo se redondea lo que cambió. Redondear el dibujo entero
 * cada vez costaba más que lo que se ahorraba al escribirlo.
 */
const copias = new WeakMap();
export function compactFeatures(list) {
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (!f || typeof f !== 'object' || !f.geometry || !f.geometry.coordinates) {
      out[i] = f;
      continue;
    }
    let c = copias.get(f);
    if (!c) {
      c = { ...f, geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) } };
      copias.set(f, c);
    }
    out[i] = c;
  }
  return out;
}

/** `JSON.stringify` con las coordenadas a 7 decimales. */
export function stringifyCompact(value) {
  return JSON.stringify(value, replacer);
}

/* ------------------------------------------------------------------ gzip */

/** ¿Hay `CompressionStream` con este formato? */
export function canCompress(format = 'gzip') {
  try {
    // eslint-disable-next-line no-new
    new CompressionStream(format);
    return true;
  } catch {
    return false;
  }
}

/** Los bytes de un `Blob` pasados por un stream de (des)compresión. */
function transformar(blob, stream) {
  return new Response(blob.stream().pipeThrough(stream)).blob();
}

/**
 * El texto comprimido con gzip, o tal cual si el navegador no sabe.
 * @returns {Promise<{blob: Blob, gzip: boolean}>}
 */
export async function gzipText(text, type = 'application/json') {
  const plano = new Blob([text], { type });
  if (!canCompress('gzip')) return { blob: plano, gzip: false };
  const blob = await transformar(plano, new CompressionStream('gzip'));
  return { blob: new Blob([blob], { type: 'application/gzip' }), gzip: true };
}

/** ¿Empieza con la firma de gzip (1f 8b)? */
export async function isGzip(blob) {
  if (!blob || blob.size < 18) return false;
  const b = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  return b[0] === 0x1f && b[1] === 0x8b;
}

/**
 * El texto de un archivo, comprimido con gzip o no: se mira la firma y no la
 * extensión, porque un archivo compartido por correo o por el chat puede
 * llegar renombrado.
 */
export async function readMaybeGzipText(blob) {
  if (!(await isGzip(blob))) return blob.text();
  if (typeof DecompressionStream !== 'function') {
    throw new Error('this browser cannot open compressed projects (it needs Safari 16.4 / Chrome 80 or newer)');
  }
  return (await transformar(blob, new DecompressionStream('gzip'))).text();
}

/** Comprime con deflate crudo (el método 8 de ZIP); `null` si no se puede. */
export async function deflateRaw(blob) {
  if (!canCompress('deflate-raw')) return null;
  return transformar(blob, new CompressionStream('deflate-raw'));
}

/** Descomprime deflate crudo; `null` si el navegador no sabe. */
export async function inflateRaw(blob) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    // eslint-disable-next-line no-new
    new DecompressionStream('deflate-raw');
  } catch {
    return null;
  }
  return transformar(blob, new DecompressionStream('deflate-raw'));
}
