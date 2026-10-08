/**
 * ZIP mínimo para el paquete de proyecto: el `.fdproj.json` más los mapas
 * offline y el modelo de elevación, en un solo archivo que se abre tal cual en
 * otro dispositivo.
 *
 * SIN COMPRIMIR, A PROPÓSITO. Un PMTiles/MBTiles ya trae sus teselas en PNG,
 * JPEG, WebP o gzip: deflate no gana casi nada y obligaría a pasar cada byte
 * por la CPU del iPad dos veces. Guardados tal cual, el ZIP se arma como un
 * `Blob` que solo REFERENCIA los archivos —sin copiarlos a memoria— y al
 * abrirlo cada entrada vuelve a ser un trozo (`slice`) del propio ZIP, que
 * PMTiles sigue leyendo por rangos igual que el original.
 *
 * Lo único que obliga a leer los archivos enteros es el CRC-32 que exige el
 * formato, y se calcula por bloques.
 *
 * Sin ZIP64: hasta 4 GB en total. Más que eso no cabe en el formato clásico, y
 * se avisa en vez de producir un archivo que otro programa leería roto.
 */

const LIMITE = 0xffffffff;
const BLOQUE = 8 * 1024 * 1024;

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32Update(crc, bytes) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function leer(blob) {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Response(blob).arrayBuffer());
}

/** CRC-32 de un Blob, leído por bloques para no cargar un GB en memoria. */
export async function crc32Blob(blob, onBytes) {
  let crc = 0;
  for (let off = 0; off < blob.size; off += BLOQUE) {
    const parte = await leer(blob.slice(off, Math.min(blob.size, off + BLOQUE)));
    crc = crc32Update(crc, parte);
    if (onBytes) onBytes(parte.length);
  }
  return crc;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Arma el ZIP.
 *
 * @param {{name: string, blob: Blob}[]} entries
 * @param {(hechos: number, total: number) => void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function buildZip(entries, onProgress) {
  const total = entries.reduce((n, e) => n + e.blob.size, 0);
  if (total + entries.length * 200 > LIMITE) {
    throw new Error('the package would exceed 4 GB, the limit of a plain ZIP');
  }
  let hechos = 0;
  const avanza = (n) => {
    hechos += n;
    if (onProgress) onProgress(hechos, total);
  };
  const { time, date } = dosTime(new Date());

  const partes = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nombre = enc.encode(e.name);
    const crc = await crc32Blob(e.blob, avanza);
    const size = e.blob.size;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versión necesaria
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // sin comprimir
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nombre.length, true);
    local.setUint16(28, 0, true);
    partes.push(local.buffer, nombre, e.blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nombre.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nombre);

    offset += 30 + nombre.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...partes, ...central, eocd.buffer], { type: 'application/zip' });
}

/** ¿Empieza como un ZIP? Basta con mirar los cuatro primeros bytes. */
export async function isZip(blob) {
  if (!blob || blob.size < 22) return false;
  const b = await leer(blob.slice(0, 4));
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/**
 * Lee el índice de un ZIP sin cargarlo: cada entrada vuelve como un `slice`
 * del propio archivo. Solo entradas sin comprimir —las que escribe
 * `buildZip`—; las comprimidas se devuelven marcadas para poder avisar.
 *
 * @returns {Promise<{name: string, blob: Blob|null, compressed: boolean}[]>}
 */
export async function readZip(blob) {
  const cola = Math.min(blob.size, 22 + 0xffff);
  const fin = await leer(blob.slice(blob.size - cola));
  let p = -1;
  for (let i = fin.length - 22; i >= 0; i--) {
    if (fin[i] === 0x50 && fin[i + 1] === 0x4b && fin[i + 2] === 0x05 && fin[i + 3] === 0x06) {
      p = i;
      break;
    }
  }
  if (p < 0) throw new Error('not a ZIP file (no central directory)');
  const ev = new DataView(fin.buffer, fin.byteOffset + p, 22);
  const n = ev.getUint16(10, true);
  const cdSize = ev.getUint32(12, true);
  const cdOff = ev.getUint32(16, true);
  const cd = await leer(blob.slice(cdOff, cdOff + cdSize));
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);

  const out = [];
  let q = 0;
  for (let k = 0; k < n; k++) {
    if (v.getUint32(q, true) !== 0x02014b50) throw new Error('damaged ZIP central directory');
    const metodo = v.getUint16(q + 10, true);
    const comp = v.getUint32(q + 20, true);
    const largoNombre = v.getUint16(q + 28, true);
    const largoExtra = v.getUint16(q + 30, true);
    const largoComent = v.getUint16(q + 32, true);
    const local = v.getUint32(q + 42, true);
    const name = dec.decode(cd.subarray(q + 46, q + 46 + largoNombre));
    q += 46 + largoNombre + largoExtra + largoComent;

    // El dato empieza tras la cabecera local, cuyo nombre y extra pueden
    // medir distinto que en el índice.
    const lh = await leer(blob.slice(local, local + 30));
    const lv = new DataView(lh.buffer, lh.byteOffset, 30);
    if (lv.getUint32(0, true) !== 0x04034b50) throw new Error(`damaged ZIP entry ${name}`);
    const inicio = local + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
    out.push({
      name,
      compressed: metodo !== 0,
      blob: metodo === 0 ? blob.slice(inicio, inicio + comp) : null,
    });
  }
  return out;
}
