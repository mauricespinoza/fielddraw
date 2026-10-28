/**
 * La vista del mapa como GeoTIFF: una imagen que SABE dónde está.
 *
 * La lámina (SVG, PNG, PDF) es para leerla una persona; este archivo es para
 * que lo lea otro programa. Por eso no lleva marco, ni escala, ni norte —
 * nada que no sea terreno—, y sí lo que una imagen suelta no tiene: la
 * georreferencia dentro del propio archivo. Se abre colocado en su sitio en
 * QGIS, ArcGIS, Global Mapper y en la vista de mapa de StructuralSketcher,
 * que es para lo que se hizo.
 *
 * EL SISTEMA: Web Mercator (EPSG:3857). No es una elección estética: es el
 * plano en el que MapLibre dibuja, así que cada píxel de la pantalla es un
 * cuadrado de ese sistema y la imagen se escribe TAL CUAL, sin remuestrear ni
 * perder un solo píxel. Con el mapa girado la relación píxel→mundo sigue
 * siendo afín: se escribe entera en `ModelTransformationTag` en vez del par
 * tiepoint + tamaño de píxel, que solo sabe de imágenes al norte.
 *
 * EL FORMATO: TIFF clásico, RGB (o RGBA si hay transparencia), en franjas,
 * con Deflate y predictor horizontal —el par que mejor comprime un mapa y que
 * todo lector de GeoTIFF entiende—. Sin `CompressionStream` se escribe sin
 * comprimir: más grande, igual de válido.
 *
 * Este módulo no sabe nada de MapLibre ni del DOM: recibe píxeles y una
 * transformación y devuelve bytes, así que se prueba en Node.
 */

export const EARTH_RADIUS = 6378137;

/** lon/lat → metros de Web Mercator (EPSG:3857). */
export function lonLatToMercator(lon, lat) {
  const la = Math.max(-85.0511287798, Math.min(85.0511287798, lat));
  return [
    (EARTH_RADIUS * lon * Math.PI) / 180,
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360)),
  ];
}

/**
 * La transformación afín píxel→mundo a partir de tres esquinas.
 *
 * `corners` son las coordenadas (en el sistema de salida) de la esquina
 * superior izquierda, la superior derecha y la inferior izquierda de la
 * imagen —las ESQUINAS de los píxeles, no sus centros—. Devuelve
 * `{a, b, c, d, e, f}` con `x = a·col + b·fila + c`, `y = d·col + e·fila + f`.
 */
export function affineFromCorners(corners, width, height) {
  const [p0, p1, p2] = corners;
  return {
    a: (p1[0] - p0[0]) / width,
    b: (p2[0] - p0[0]) / height,
    c: p0[0],
    d: (p1[1] - p0[1]) / width,
    e: (p2[1] - p0[1]) / height,
    f: p0[1],
  };
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const ROWS_PER_STRIP = 32;

/**
 * Escribe el GeoTIFF.
 *
 * @param {object} p
 * @param {Uint8ClampedArray|Uint8Array} p.rgba  píxeles RGBA, fila a fila
 * @param {number} p.width
 * @param {number} p.height
 * @param {{a,b,c,d,e,f}} p.transform  píxel→mundo (ver `affineFromCorners`)
 * @param {number} [p.epsg=3857]
 * @param {string} [p.citation]
 * @param {boolean} [p.compress=true]
 * @returns {Promise<Uint8Array>}
 */
export async function encodeGeoTiff({
  rgba,
  width,
  height,
  transform,
  epsg = 3857,
  citation = 'WGS 84 / Pseudo-Mercator',
  compress = true,
}) {
  if (!(width > 0 && height > 0) || rgba.length < width * height * 4) {
    throw new Error('encodeGeoTiff: the pixel buffer does not match the size');
  }
  // ¿hace falta el canal alfa? Solo si algún píxel no es opaco.
  let alpha = false;
  for (let i = 3; i < width * height * 4; i += 4) {
    if (rgba[i] !== 255) {
      alpha = true;
      break;
    }
  }
  const spp = alpha ? 4 : 3;
  const deflateOk = compress && typeof CompressionStream === 'function';

  // franjas: muestras intercaladas, predictor 2 (diferencia con el píxel de
  // la izquierda, canal por canal) y Deflate
  const strips = [];
  const rowBytes = width * spp;
  for (let y0 = 0; y0 < height; y0 += ROWS_PER_STRIP) {
    const rows = Math.min(ROWS_PER_STRIP, height - y0);
    const raw = new Uint8Array(rows * rowBytes);
    for (let r = 0; r < rows; r++) {
      const src = (y0 + r) * width * 4;
      const dst = r * rowBytes;
      for (let x = 0; x < width; x++) {
        for (let k = 0; k < spp; k++) raw[dst + x * spp + k] = rgba[src + x * 4 + k];
      }
      if (deflateOk) {
        for (let i = rowBytes - 1; i >= spp; i--) {
          raw[dst + i] = (raw[dst + i] - raw[dst + i - spp]) & 255;
        }
      }
    }
    strips.push(deflateOk ? await deflate(raw) : raw);
  }

  const t = transform;
  const north = Math.abs(t.b) < 1e-9 * Math.abs(t.a) && Math.abs(t.d) < 1e-9 * Math.abs(t.e);
  const geoAscii = `${citation}|`;
  const geoKeys = [
    1, 1, 0, 5,
    1024, 0, 1, 1, // GTModelTypeGeoKey: proyectado
    1025, 0, 1, 1, // GTRasterTypeGeoKey: PixelIsArea
    1026, 34737, geoAscii.length, 0, // GTCitationGeoKey
    3072, 0, 1, epsg, // ProjectedCSTypeGeoKey
    3076, 0, 1, 9001, // ProjLinearUnitsGeoKey: metro
  ];

  // [tag, tipo, valores] — tipos: 2 ASCII, 3 SHORT, 4 LONG, 12 DOUBLE
  const tags = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, new Array(spp).fill(8)],
    [259, 3, [deflateOk ? 8 : 1]],
    [262, 3, [2]],
    [273, 4, strips.map(() => 0)], // se rellena al conocer las posiciones
    [277, 3, [spp]],
    [278, 4, [ROWS_PER_STRIP]],
    [279, 4, strips.map((s) => s.length)],
    [284, 3, [1]],
    [305, 2, 'FieldDraw'],
  ];
  if (deflateOk) tags.push([317, 3, [2]]);
  if (alpha) tags.push([338, 3, [2]]); // alfa no premultiplicado
  tags.push([339, 3, new Array(spp).fill(1)]);
  if (north) {
    tags.push([33550, 12, [t.a, -t.e, 0]]);
    tags.push([33922, 12, [0, 0, 0, t.c, t.f, 0]]);
  } else {
    tags.push([34264, 12, [t.a, t.b, 0, t.c, t.d, t.e, 0, t.f, 0, 0, 0, 0, 0, 0, 0, 1]]);
  }
  tags.push([34735, 3, geoKeys]);
  tags.push([34737, 2, geoAscii]);
  tags.sort((x, y) => x[0] - y[0]);

  const SIZE = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const countOf = (tg) => (tg[1] === 2 ? tg[2].length + 1 : tg[2].length);

  // disposición: encabezado, IFD, valores largos, franjas
  const ifdSize = 2 + tags.length * 12 + 4;
  let off = 8 + ifdSize;
  const where = new Map();
  for (const tg of tags) {
    const n = countOf(tg) * SIZE[tg[1]];
    if (n > 4) {
      off += off & 1;
      where.set(tg[0], off);
      off += n;
    }
  }
  const stripOff = [];
  for (const s of strips) {
    off += off & 1;
    stripOff.push(off);
    off += s.length;
  }
  tags.find((tg) => tg[0] === 273)[2] = stripOff;

  const out = new Uint8Array(off);
  const dv = new DataView(out.buffer);
  out[0] = 0x49;
  out[1] = 0x49; // little-endian
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);

  const writeValues = (tg, pos) => {
    const [, type, vals] = tg;
    if (type === 2) {
      for (let i = 0; i < vals.length; i++) out[pos + i] = vals.charCodeAt(i) & 0x7f;
      out[pos + vals.length] = 0;
      return;
    }
    vals.forEach((v, i) => {
      if (type === 3) dv.setUint16(pos + i * 2, v, true);
      else if (type === 4) dv.setUint32(pos + i * 4, v, true);
      else dv.setFloat64(pos + i * 8, v, true);
    });
  };

  let p = 8;
  dv.setUint16(p, tags.length, true);
  p += 2;
  for (const tg of tags) {
    dv.setUint16(p, tg[0], true);
    dv.setUint16(p + 2, tg[1], true);
    dv.setUint32(p + 4, countOf(tg), true);
    if (where.has(tg[0])) {
      dv.setUint32(p + 8, where.get(tg[0]), true);
      writeValues(tg, where.get(tg[0]));
    } else {
      writeValues(tg, p + 8);
    }
    p += 12;
  }
  dv.setUint32(p, 0, true); // sin más IFD
  strips.forEach((s, i) => out.set(s, stripOff[i]));
  return out;
}
