/**
 * Escritor de shapefiles 3D, y del ZIP que los mantiene juntos.
 *
 * Existe por una razón concreta: es lo que abre Structural Modeller para
 * construir una sección a partir de datos ya interpretados. Su importador pide
 * **PolylineZ** —cada horizonte o falla como una polilínea cuyos vértices llevan
 * X, Y y Z— y un campo de texto `Type` del que deduce si la línea es un
 * horizonte o una falla. Ese es el contrato entero, y es el que se escribe aquí.
 *
 * Un `.shp` suelto no lo abre nadie: el formato son cuatro archivos hermanos
 * —`.shp` con la geometría, `.shx` con el índice, `.dbf` con los atributos y
 * `.prj` con el sistema de referencia— y falta uno y la capa no carga. Como el
 * navegador solo puede descargar un archivo por gesto, se empaquetan en un ZIP
 * sin comprimir, que es lo que QGIS y GDAL abren directamente.
 *
 * Todo a mano y sin dependencias, igual que el GeoPackage: son formatos
 * binarios pequeños y bien especificados, y meter una librería de cientos de KB
 * en `vendor/` para escribir cuatro cabeceras sería un mal negocio en una app
 * que tiene que arrancar sin señal.
 */

/* ============================================================ shapefile === */

/** Tipos de geometría del formato. Solo se escriben los dos con Z. */
export const SHAPE_POINT_Z = 11;
export const SHAPE_POLYLINE_Z = 13;

/** «Sin dato» del formato para las medidas M, que aquí no se usan. */
const NO_DATA = -1e39;

const HEADER_BYTES = 100;

/**
 * Cabecera de 100 bytes, común al `.shp` y al `.shx`.
 *
 * Mezcla los dos órdenes de bytes en el mismo bloque —el código de archivo y la
 * longitud en big-endian, el resto en little-endian— que es una rareza del
 * formato de 1998 y la fuente número uno de shapefiles ilegibles.
 * `fileLength` va en PALABRAS de 16 bits, no en bytes.
 */
function writeHeader(dv, fileLengthWords, shapeType, bbox, zRange) {
  dv.setInt32(0, 9994, false);
  for (let i = 4; i < 24; i += 4) dv.setInt32(i, 0, false);
  dv.setInt32(24, fileLengthWords, false);
  dv.setInt32(28, 1000, true);
  dv.setInt32(32, shapeType, true);
  dv.setFloat64(36, bbox[0], true);
  dv.setFloat64(44, bbox[1], true);
  dv.setFloat64(52, bbox[2], true);
  dv.setFloat64(60, bbox[3], true);
  dv.setFloat64(68, zRange[0], true);
  dv.setFloat64(76, zRange[1], true);
  dv.setFloat64(84, NO_DATA, true);
  dv.setFloat64(92, NO_DATA, true);
}

/** Envolvente XY y rango Z de una lista de geometrías [[x,y,z], ...]. */
function extentOf(geometries) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const g of geometries) {
    for (const [x, y, z] of g) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const zz = Number.isFinite(z) ? z : 0;
      if (zz < minZ) minZ = zz;
      if (zz > maxZ) maxZ = zz;
    }
  }
  if (minX === Infinity) return { bbox: [0, 0, 0, 0], zRange: [0, 0] };
  return { bbox: [minX, minY, maxX, maxY], zRange: [minZ, maxZ] };
}

/**
 * Contenido de un registro PolylineZ, en bytes.
 *
 * Los tres bloques van seguidos y en este orden: primero todas las X/Y, después
 * todas las Z y al final todas las M. No es intercalado; escribirlo intercalado
 * produce un archivo que abre pero con la geometría irreconocible.
 */
function polylineZBytes(vertices) {
  const n = vertices.length;
  const bytes = 44 + 4 + n * 16 + 16 + n * 8 + 16 + n * 8;
  const buf = new ArrayBuffer(bytes);
  const dv = new DataView(buf);
  const { bbox, zRange } = extentOf([vertices]);

  dv.setInt32(0, SHAPE_POLYLINE_Z, true);
  dv.setFloat64(4, bbox[0], true);
  dv.setFloat64(12, bbox[1], true);
  dv.setFloat64(20, bbox[2], true);
  dv.setFloat64(28, bbox[3], true);
  dv.setInt32(36, 1, true); // una sola parte
  dv.setInt32(40, n, true);
  dv.setInt32(44, 0, true); // índice del primer vértice de la parte

  let o = 48;
  for (const v of vertices) {
    dv.setFloat64(o, v[0], true);
    dv.setFloat64(o + 8, v[1], true);
    o += 16;
  }
  dv.setFloat64(o, zRange[0], true);
  dv.setFloat64(o + 8, zRange[1], true);
  o += 16;
  for (const v of vertices) {
    dv.setFloat64(o, Number.isFinite(v[2]) ? v[2] : 0, true);
    o += 8;
  }
  dv.setFloat64(o, NO_DATA, true);
  dv.setFloat64(o + 8, NO_DATA, true);
  o += 16;
  for (let i = 0; i < n; i++) {
    dv.setFloat64(o, NO_DATA, true);
    o += 8;
  }
  return new Uint8Array(buf);
}

/** Contenido de un registro PointZ. */
function pointZBytes(v) {
  const buf = new ArrayBuffer(36);
  const dv = new DataView(buf);
  dv.setInt32(0, SHAPE_POINT_Z, true);
  dv.setFloat64(4, v[0], true);
  dv.setFloat64(12, v[1], true);
  dv.setFloat64(20, Number.isFinite(v[2]) ? v[2] : 0, true);
  dv.setFloat64(28, NO_DATA, true);
  return new Uint8Array(buf);
}

/**
 * `.shp` y `.shx` a partir de una lista de geometrías.
 *
 * @param {Array} geometries  PolylineZ: [[x,y,z], ...] por elemento.
 *                            PointZ: un solo [x,y,z] por elemento.
 * @param {number} shapeType
 */
export function writeShp(geometries, shapeType) {
  const contenidos = geometries.map((g) =>
    shapeType === SHAPE_POINT_Z ? pointZBytes(g) : polylineZBytes(g),
  );
  const todas = geometries.map((g) => (shapeType === SHAPE_POINT_Z ? [g] : g));
  const { bbox, zRange } = extentOf(todas);

  const shpBytes = HEADER_BYTES + contenidos.reduce((s, c) => s + 8 + c.length, 0);
  const shxBytes = HEADER_BYTES + contenidos.length * 8;
  const shp = new Uint8Array(shpBytes);
  const shx = new Uint8Array(shxBytes);
  const shpView = new DataView(shp.buffer);
  const shxView = new DataView(shx.buffer);

  writeHeader(shpView, shpBytes / 2, shapeType, bbox, zRange);
  writeHeader(shxView, shxBytes / 2, shapeType, bbox, zRange);

  let o = HEADER_BYTES;
  let idx = HEADER_BYTES;
  contenidos.forEach((c, i) => {
    // La cabecera de registro va en big-endian y su longitud, otra vez, en
    // palabras de 16 bits.
    shpView.setInt32(o, i + 1, false);
    shpView.setInt32(o + 4, c.length / 2, false);
    shp.set(c, o + 8);
    shxView.setInt32(idx, o / 2, false);
    shxView.setInt32(idx + 4, c.length / 2, false);
    o += 8 + c.length;
    idx += 8;
  });

  return { shp, shx };
}

/* ================================================================= dbf === */

const enc = new TextEncoder();

/** Recorta y rellena un texto a un ancho fijo de bytes ASCII. */
function fixed(text, width) {
  const out = new Uint8Array(width).fill(0x20);
  const src = enc.encode(String(text === null || text === undefined ? '' : text));
  out.set(src.subarray(0, width));
  return out;
}

/**
 * `.dbf` en dBASE III, que es lo que todo el mundo lee.
 *
 * Solo campos de texto: los atributos que viajan a una sección son etiquetas
 * —el tipo, la unidad, la certeza— y un ancho fijo de caracteres evita el
 * campo numérico de dBASE, que tiene su propia manera de estropear decimales.
 *
 * @param {Array<{name: string, width: number}>} fields
 * @param {Array<object>} rows
 */
export function writeDbf(fields, rows) {
  const cabecera = 32 + fields.length * 32 + 1;
  const registro = 1 + fields.reduce((s, f) => s + f.width, 0);
  const total = cabecera + rows.length * registro + 1;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  const hoy = new Date();

  buf[0] = 0x03;
  buf[1] = hoy.getFullYear() - 1900;
  buf[2] = hoy.getMonth() + 1;
  buf[3] = hoy.getDate();
  dv.setInt32(4, rows.length, true);
  dv.setInt16(8, cabecera, true);
  dv.setInt16(10, registro, true);

  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    buf.set(fixed(f.name.slice(0, 10), 11).map((b) => (b === 0x20 ? 0 : b)), o);
    buf[o + 11] = 0x43; // 'C', carácter
    buf[o + 16] = f.width;
    buf[o + 17] = 0;
  });
  buf[cabecera - 1] = 0x0d;

  let o = cabecera;
  for (const row of rows) {
    buf[o] = 0x20; // no borrado
    let c = o + 1;
    for (const f of fields) {
      buf.set(fixed(row[f.name], f.width), c);
      c += f.width;
    }
    o += registro;
  }
  buf[total - 1] = 0x1a;
  return buf;
}

/* ================================================================= zip === */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * ZIP sin comprimir.
 *
 * Sin comprimir a propósito: un shapefile de un perfil son unos pocos KB, el
 * ahorro sería irrelevante y meter deflate obligaría a traer una librería o a
 * escribir un compresor, que es mucho código para nada. El método 0 («stored»)
 * es parte del formato y lo abre cualquier cosa.
 *
 * @param {Array<{name: string, data: Uint8Array}>} files
 */
export function zip(files) {
  const locales = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nombre = enc.encode(f.name);
    const crc = crc32(f.data);

    const local = new Uint8Array(30 + nombre.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // versión necesaria
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // método 0: almacenado
    lv.setUint16(10, 0, true); // hora
    lv.setUint16(12, 0x21, true); // fecha: 1 de enero de 1980, la mínima válida
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, nombre.length, true);
    lv.setUint16(28, 0, true);
    local.set(nombre, 30);
    locales.push(local, f.data);

    const dir = new Uint8Array(46 + nombre.length);
    const dvv = new DataView(dir.buffer);
    dvv.setUint32(0, 0x02014b50, true);
    dvv.setUint16(4, 20, true);
    dvv.setUint16(6, 20, true);
    dvv.setUint16(8, 0, true);
    dvv.setUint16(10, 0, true);
    dvv.setUint16(12, 0, true);
    dvv.setUint16(14, 0x21, true);
    dvv.setUint32(16, crc, true);
    dvv.setUint32(20, f.data.length, true);
    dvv.setUint32(24, f.data.length, true);
    dvv.setUint16(28, nombre.length, true);
    dvv.setUint32(42, offset, true);
    dir.set(nombre, 46);
    central.push(dir);

    offset += local.length + f.data.length;
  }

  const centralBytes = central.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const fv = new DataView(fin.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, files.length, true);
  fv.setUint16(10, files.length, true);
  fv.setUint32(12, centralBytes, true);
  fv.setUint32(16, offset, true);

  const partes = [...locales, ...central, fin];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** WKT de WGS84, que es el sistema en el que la app guarda todo. */
export const WGS84_WKT =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';

/**
 * Un shapefile completo, listo para descargar.
 *
 * @param {object} opts
 * @param {string} opts.name          nombre base, sin extensión
 * @param {Array} opts.geometries
 * @param {number} opts.shapeType
 * @param {Array} opts.fields         [{name, width}]
 * @param {Array} opts.rows
 * @param {string} [opts.prj]
 * @returns {Uint8Array} el ZIP
 */
export function shapefileZip({ name, geometries, shapeType, fields, rows, prj = WGS84_WKT }) {
  const { shp, shx } = writeShp(geometries, shapeType);
  return zip([
    { name: `${name}.shp`, data: shp },
    { name: `${name}.shx`, data: shx },
    { name: `${name}.dbf`, data: writeDbf(fields, rows) },
    { name: `${name}.prj`, data: enc.encode(prj) },
  ]);
}
