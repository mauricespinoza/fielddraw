import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

/*
 * Generador de iconos PNG sin dependencias: no hay rasterizador disponible, así
 * que se pinta el buffer RGBA a mano y se empaqueta el PNG con zlib, que sí
 * viene en Node. El dibujo es EL MISMO que el de la franja de la app: ver
 * `draw()`.
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

/*
 * EL DIBUJO ES EL DE LA FRANJA DE LA APP, VÉRTICE A VÉRTICE.
 *
 * Antes eran dos dibujos distintos: la pestaña y el icono del sistema traían
 * un contacto turquesa con una falla inversa roja, y dentro de la app, arriba
 * a la izquierda, se veía otra cosa —una tablet con un lápiz—. Quien instalaba
 * la app veía un icono en el lanzador y otro al abrirla.
 *
 * Las coordenadas de abajo son literalmente las del `<svg class="brand-logo">`
 * de index.html, sobre su misma rejilla de 24×24. Si se toca una, hay que
 * tocar la otra — y regenerar con `node tools/make-icons.mjs`.
 */
const TILE = '#0b0f14';   // el fondo del azulejo
const BORDE = '#e6edf3';  // el filo, al 16 %
const TABLET = '#2dd4bf';
const TRAZO = '#ffb300';  // el contacto dibujándose en la pantalla
const LAPIZ = '#f87171';
const MINA = '#e6edf3';

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size / 24; // la rejilla del logo de la app
  const px = (x, y, [r, g, b], a = 1) => {
    if (a <= 0) return;
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

  /*
   * Rectángulo redondeado relleno, en unidades de la rejilla. Es la primitiva
   * que hace todo lo demás: los dos marcos —el filo del azulejo y la tablet—
   * se pintan como un relleno del color del trazo y otro encima del color del
   * fondo, que es exacto porque debajo hay un color plano.
   */
  const roundRect = (x, y, w, h, r, color, alpha = 1) => {
    const x0 = x * S;
    const y0 = y * S;
    const x1 = (x + w) * S;
    const y1 = (y + h) * S;
    const rad = r * S;
    for (let yi = Math.floor(y0) - 1; yi <= Math.ceil(y1) + 1; yi++) {
      for (let xi = Math.floor(x0) - 1; xi <= Math.ceil(x1) + 1; xi++) {
        const cx = Math.min(Math.max(xi, x0 + rad), x1 - rad);
        const cy = Math.min(Math.max(yi, y0 + rad), y1 - rad);
        // Distancia al borde: negativa dentro, positiva fuera.
        const d = Math.hypot(xi - cx, yi - cy) - rad;
        const cobertura = Math.min(1, Math.max(0, 0.5 - d));
        if (cobertura > 0) px(xi, yi, color, cobertura * alpha);
      }
    }
  };

  /*
   * Trazo de extremos redondos entre dos puntos de la rejilla, del mismo ancho
   * que el `stroke-width` del SVG. Encadenando varios se obtienen las uniones
   * redondeadas de la polilínea sin más trabajo.
   */
  const stroke = (x0, y0, x1, y1, color, w) => {
    const ax = x0 * S;
    const ay = y0 * S;
    const bx = x1 * S;
    const by = y1 * S;
    const rad = (w * S) / 2;
    const largo = Math.hypot(bx - ax, by - ay) || 1;
    for (let yi = Math.floor(Math.min(ay, by) - rad - 1); yi <= Math.ceil(Math.max(ay, by) + rad + 1); yi++) {
      for (let xi = Math.floor(Math.min(ax, bx) - rad - 1); xi <= Math.ceil(Math.max(ax, bx) + rad + 1); xi++) {
        // Distancia del píxel al segmento, que es el SDF de una cápsula.
        const t = Math.min(1, Math.max(0, ((xi - ax) * (bx - ax) + (yi - ay) * (by - ay)) / (largo * largo)));
        const d = Math.hypot(xi - (ax + (bx - ax) * t), yi - (ay + (by - ay) * t)) - rad;
        const cobertura = Math.min(1, Math.max(0, 0.5 - d));
        if (cobertura > 0) px(xi, yi, color, cobertura);
      }
    }
  };

  /** Triángulo relleno (la mina del lápiz). */
  const tri = (ax, ay, bx, by, cx2, cy2, color) => {
    const pts = [[ax * S, ay * S], [bx * S, by * S], [cx2 * S, cy2 * S]];
    const minX = Math.min(...pts.map((p) => p[0]));
    const maxX = Math.max(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1]));
    const maxY = Math.max(...pts.map((p) => p[1]));
    const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        const p = [x, y];
        const d1 = sign(p, pts[0], pts[1]);
        const d2 = sign(p, pts[1], pts[2]);
        const d3 = sign(p, pts[2], pts[0]);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) px(x, y, color, 1);
      }
    }
  };

  // 1. El azulejo.
  roundRect(0, 0, 24, 24, 5.5, hex(TILE));

  // 2. Su filo: relleno al 16 % y el interior devuelto al color del azulejo.
  //    El SVG lo dibuja como un `stroke` de 1.2 sobre un rect de 22.8.
  roundRect(0.6, 0.6, 22.8, 22.8, 5, hex(BORDE), 0.16);
  roundRect(1.2, 1.2, 21.6, 21.6, 4.4, hex(TILE));

  // 3. La tablet: rect de 12.6×10.2 en (3.6, 8.8) con trazo de 1.4, que se
  //    reparte 0.7 hacia cada lado del contorno.
  roundRect(2.9, 8.1, 14.0, 11.6, 2.3, hex(TABLET));
  roundRect(4.3, 9.5, 11.2, 8.8, 0.9, hex(TILE));

  // 4. El contacto que se está dibujando en su pantalla.
  const contacto = [[5.6, 15.9], [8.6, 12.7], [10.9, 15], [13.3, 11.6]];
  for (let i = 0; i < contacto.length - 1; i++) {
    stroke(contacto[i][0], contacto[i][1], contacto[i + 1][0], contacto[i + 1][1], hex(TRAZO), 1.3);
  }

  // 5. El lápiz, con la mina tocando el extremo del trazo.
  stroke(20.2, 2.6, 15.1, 10, hex(LAPIZ), 2.3);
  tri(15.1, 10, 13.1, 11.9, 14.3, 9.3, hex(MINA));

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
