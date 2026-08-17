import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

/*
 * Generador de iconos PNG sin dependencias: no hay rasterizador disponible, así
 * que se pinta el buffer RGBA a mano y se empaqueta el PNG con zlib, que sí
 * viene en Node. El dibujo es el de la app: fondo oscuro, un contacto en
 * turquesa y una falla inversa en rojo con sus dientes.
 */

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size / 100; // el diseño se define sobre una rejilla de 100×100
  const px = (x, y, [r, g, b], a = 1) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return;
    const i = (yi * size + xi) * 4;
    const na = a + (buf[i + 3] / 255) * (1 - a);
    buf[i] = Math.round(r * a + buf[i] * (1 - a));
    buf[i + 1] = Math.round(g * a + buf[i + 1] * (1 - a));
    buf[i + 2] = Math.round(b * a + buf[i + 2] * (1 - a));
    buf[i + 3] = Math.round(na * 255);
  };

  // Fondo con esquinas redondeadas (radio 22 en la rejilla).
  const bg = hex('#0d1117');
  const R = 22 * S;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.min(Math.max(x, R), size - R);
      const cy = Math.min(Math.max(y, R), size - R);
      const d = Math.hypot(x - cx, y - cy);
      if (d <= R) px(x, y, bg, 1);
      else if (d <= R + 1) px(x, y, bg, R + 1 - d);
    }
  }

  // Trazo grueso entre dos puntos de la rejilla.
  const stroke = (x0, y0, x1, y1, color, w) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * S * 3);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = (x0 + (x1 - x0) * t) * S;
      const cy = (y0 + (y1 - y0) * t) * S;
      const rad = (w * S) / 2;
      for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) {
        for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
          const d = Math.hypot(dx, dy);
          if (d <= rad) px(cx + dx, cy + dy, color, 1);
          else if (d <= rad + 1) px(cx + dx, cy + dy, color, rad + 1 - d);
        }
      }
    }
  };

  // Triángulo relleno (diente de cabalgamiento).
  const tri = (ax, ay, bx, by, cx2, cy2, color) => {
    const minX = Math.min(ax, bx, cx2) * S;
    const maxX = Math.max(ax, bx, cx2) * S;
    const minY = Math.min(ay, by, cy2) * S;
    const maxY = Math.max(ay, by, cy2) * S;
    const sign = (px1, py1, px2, py2, px3, py3) =>
      (px1 - px3) * (py2 - py3) - (px2 - px3) * (py1 - py3);
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        const d1 = sign(x, y, ax * S, ay * S, bx * S, by * S);
        const d2 = sign(x, y, bx * S, by * S, cx2 * S, cy2 * S);
        const d3 = sign(x, y, cx2 * S, cy2 * S, ax * S, ay * S);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) px(x, y, color, 1);
      }
    }
  };

  // Contacto estratigráfico, en turquesa.
  stroke(16, 70, 44, 52, hex('#2dd4bf'), 7);
  stroke(44, 52, 84, 62, hex('#2dd4bf'), 7);

  // Falla inversa con dientes, en rojo.
  const rojo = hex('#D32F2F');
  stroke(16, 34, 84, 26, rojo, 7);
  tri(28, 33, 42, 31.4, 34.5, 20, rojo);
  tri(50, 30.4, 64, 28.8, 56.5, 17.5, rojo);

  return buf;
}

// Se regenera con `node tools/make-icons.mjs` cuando cambie el diseño.
const outDir = new URL('../icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  const out = png(size, size, draw(size));
  writeFileSync(new URL(`icon-${size}.png`, outDir), out);
  console.log(`icons/icon-${size}.png  ${out.length} B`);
}
