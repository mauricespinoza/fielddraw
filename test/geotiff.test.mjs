/**
 * El GeoTIFF de la vista del mapa, releído byte a byte: encabezado, etiquetas,
 * franjas Deflate con predictor, píxeles, georreferencia y GeoKeys.
 */
import { inflateSync } from 'node:zlib';
import { affineFromCorners, encodeGeoTiff, lonLatToMercator } from '../src/geotiff.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

/** Lector mínimo de TIFF clásico little-endian: {tags, pixels(spp)} */
function readTiff(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const off = dv.getUint32(4, true);
  const n = dv.getUint16(off, true);
  const SIZE = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const tags = {};
  for (let i = 0; i < n; i++) {
    const o = off + 2 + i * 12;
    const tag = dv.getUint16(o, true);
    const type = dv.getUint16(o + 2, true);
    const count = dv.getUint32(o + 4, true);
    const pos = count * SIZE[type] > 4 ? dv.getUint32(o + 8, true) : o + 8;
    if (type === 2) {
      tags[tag] = String.fromCharCode(...bytes.subarray(pos, pos + count - 1));
      continue;
    }
    const v = [];
    for (let k = 0; k < count; k++) {
      if (type === 3) v.push(dv.getUint16(pos + k * 2, true));
      else if (type === 4) v.push(dv.getUint32(pos + k * 4, true));
      else v.push(dv.getFloat64(pos + k * 8, true));
    }
    tags[tag] = v;
  }
  return { tags, order: Object.keys(tags).map(Number) };
}

function decode(bytes, t) {
  const w = t[256][0];
  const h = t[257][0];
  const spp = t[277][0];
  const out = new Uint8Array(w * h * spp);
  let o = 0;
  t[273].forEach((so, i) => {
    let raw = bytes.subarray(so, so + t[279][i]);
    if (t[259][0] === 8) raw = new Uint8Array(inflateSync(raw));
    const rows = raw.length / (w * spp);
    if (t[317] && t[317][0] === 2) {
      for (let r = 0; r < rows; r++)
        for (let k = spp; k < w * spp; k++)
          raw[r * w * spp + k] = (raw[r * w * spp + k] + raw[r * w * spp + k - spp]) & 255;
    }
    out.set(raw, o);
    o += raw.length;
  });
  return out;
}

function image(w, h, alphaAt = null) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x * 7) & 255;
      px[i + 1] = (y * 5) & 255;
      px[i + 2] = (x * y) & 255;
      px[i + 3] = alphaAt && alphaAt(x, y) ? 0 : 255;
    }
  return px;
}

console.log('== Web Mercator ==');
{
  const [x, y] = lonLatToMercator(0, 0);
  ok('el origen es (0, 0)', Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9);
  const [x2, y2] = lonLatToMercator(-73.05, -36.83);
  // la misma latitud por la otra fórmula del Mercator esférico: R·asinh(tan φ)
  const yAlt = 6378137 * Math.asinh(Math.tan((-36.83 * Math.PI) / 180));
  ok('Concepción en metros', Math.abs(x2 + 8131888.8) < 0.1 && Math.abs(y2 - yAlt) < 1e-6, `${x2} ${y2}`);
}

console.log('== al norte: tiepoint y tamaño de píxel ==');
{
  const w = 70;
  const h = 45; // dos franjas, la última incompleta
  const corners = [[1000, 5000], [1000 + w * 2, 5000], [1000, 5000 - h * 2]];
  const T = affineFromCorners(corners, w, h);
  ok('la afín sale bien', T.a === 2 && T.e === -2 && T.b === 0 && T.d === 0 && T.c === 1000 && T.f === 5000);
  const px = image(w, h);
  const bytes = await encodeGeoTiff({ rgba: px, width: w, height: h, transform: T });
  ok('encabezado II*', bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42);
  const { tags, order } = readTiff(bytes);
  ok('etiquetas en orden creciente', order.every((t, i) => !i || t > order[i - 1]));
  ok('RGB sin alfa cuando todo es opaco', tags[277][0] === 3 && !tags[338]);
  ok('Deflate con predictor 2', tags[259][0] === 8 && tags[317][0] === 2);
  ok('dos franjas', tags[273].length === 2);
  const dec = decode(bytes, tags);
  let bad = 0;
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) if (dec[i * 3 + k] !== px[i * 4 + k]) bad++;
  ok('los píxeles vuelven idénticos', bad === 0, `${bad} distintos`);
  ok('tamaño de píxel', tags[33550][0] === 2 && tags[33550][1] === 2);
  ok('tiepoint en la esquina', tags[33922][3] === 1000 && tags[33922][4] === 5000);
  ok('sin ModelTransformation', !tags[34264]);
  const gk = tags[34735];
  const key = (id) => {
    for (let i = 4; i < gk.length; i += 4) if (gk[i] === id) return gk.slice(i, i + 4);
    return null;
  };
  ok('GeoKeys: proyectado, PixelIsArea, EPSG:3857, metros',
    key(1024)[3] === 1 && key(1025)[3] === 1 && key(3072)[3] === 3857 && key(3076)[3] === 9001);
  const c = key(1026);
  ok('la cita apunta al texto', c[1] === 34737 && tags[34737].substr(c[3], c[2]) === 'WGS 84 / Pseudo-Mercator|');
}

console.log('== girado: ModelTransformation; con alfa: RGBA ==');
{
  const w = 40;
  const h = 30;
  const ang = (30 * Math.PI) / 180;
  const p0 = [500, 800];
  const p1 = [p0[0] + w * Math.cos(ang), p0[1] + w * Math.sin(ang)];
  const p2 = [p0[0] + h * Math.sin(ang), p0[1] - h * Math.cos(ang)];
  const T = affineFromCorners([p0, p1, p2], w, h);
  const px = image(w, h, (x, y) => x < 3 && y < 3);
  const bytes = await encodeGeoTiff({ rgba: px, width: w, height: h, transform: T });
  const { tags } = readTiff(bytes);
  ok('RGBA con alfa no premultiplicado', tags[277][0] === 4 && tags[338][0] === 2);
  const m = tags[34264];
  ok('matriz 4×4', m && m.length === 16 && !tags[33550] && !tags[33922]);
  const at = (col, row) => [m[0] * col + m[1] * row + m[3], m[4] * col + m[5] * row + m[7]];
  const q = at(w, h);
  const esperado = [p0[0] + (p1[0] - p0[0]) + (p2[0] - p0[0]), p0[1] + (p1[1] - p0[1]) + (p2[1] - p0[1])];
  ok('la esquina opuesta cae donde debe', Math.hypot(q[0] - esperado[0], q[1] - esperado[1]) < 1e-9);
  const dec = decode(bytes, tags);
  ok('el alfa se conserva', dec[3] === 0 && dec[(5 * w + 5) * 4 + 3] === 255);
}

console.log('== sin compresión ==');
{
  const px = image(9, 9);
  const T = affineFromCorners([[0, 9], [9, 9], [0, 0]], 9, 9);
  const bytes = await encodeGeoTiff({ rgba: px, width: 9, height: 9, transform: T, compress: false });
  const { tags } = readTiff(bytes);
  ok('compresión 1 y sin predictor', tags[259][0] === 1 && !tags[317]);
  const dec = decode(bytes, tags);
  ok('píxeles crudos', dec[3 * 10] === px[4 * 10] && dec.length === 9 * 9 * 3);
}

console.log('== tamaño que no cuadra ==');
{
  let threw = false;
  try {
    await encodeGeoTiff({ rgba: new Uint8Array(10), width: 5, height: 5, transform: {} });
  } catch {
    threw = true;
  }
  ok('se rechaza', threw);
}

if (fails) {
  console.log(`\n${fails} FALLOS`);
  process.exit(1);
}
console.log('\ntodo ok');
