import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

/*
 * EL ICONO DE FIELDDRAW, DE UNA SOLA FUENTE.
 *
 * Un lápiz traza una falla inversa —línea con dientes llenos sobre el bloque
 * colgante— en un mapa geológico simplificado: la falla trunca el contacto
 * entre dos unidades del colgante, y por delante de la punta queda el resto
 * del contacto en trazos, todavía sin repasar. Los colores son los de la
 * carta cronoestratigráfica internacional (Jurásico, Triásico, Cretácico y
 * Neógeno): es la propuesta «A2» de icons/proposals/carta/.
 *
 * Este script escribe TODO lo que lleva el icono:
 *
 *   icons/favicon.svg             la pestaña, la franja de la app (index.html,
 *                                 `img.brand-logo`), el panel About y la
 *                                 pantalla de carga: los cuatro la referencian
 *   icons/icon-180/192/512.png    apple-touch-icon y el manifest
 *
 * Antes el dibujo estaba copiado a mano en tres sitios —el SVG de la franja,
 * favicon.svg y las coordenadas de este rasterizador—, y cambiarlo obligaba a
 * tocar los tres sin equivocarse. Ahora la geometría se describe una vez
 * (`escena()`), y de ella salen el SVG y los PNG.
 *
 * No hay dependencias ni rasterizador disponible (el proyecto vive en Google
 * Drive, donde npm no funciona): los PNG se pintan aquí con un relleno por
 * líneas de barrido supermuestreado y se empaquetan con el zlib de Node.
 *
 *     node tools/make-icons.mjs
 */

/* ------------------------------------------------------------ geometría */

/**
 * Trayecto que guarda sus órdenes para escribirlas como `d` de SVG y que
 * sabe aplanarse a polígonos para el rasterizador. Solo M, L, C y Z: los
 * arcos de las esquinas del lápiz van como cúbicas.
 */
class Trayecto {
  constructor(tx = (p) => p) {
    this.cmds = [];
    this.tx = tx;
  }
  M(x, y) { this.cmds.push(['M', this.tx([x, y])]); return this; }
  L(x, y) { this.cmds.push(['L', this.tx([x, y])]); return this; }
  C(x1, y1, x2, y2, x, y) { this.cmds.push(['C', this.tx([x1, y1]), this.tx([x2, y2]), this.tx([x, y])]); return this; }
  Z() { this.cmds.push(['Z']); return this; }

  d() {
    const n = (v) => String(+v.toFixed(2));
    return this.cmds.map(([c, ...ps]) => c + ps.map((p) => `${n(p[0])} ${n(p[1])}`).join(' ')).join('');
  }

  /** Subtrayectos como listas de puntos; `cerrado` dice si acababan en Z. */
  aplanar(pasos = 48) {
    const subs = [];
    let actual = null;
    for (const [c, ...ps] of this.cmds) {
      if (c === 'M') { actual = { pts: [ps[0]], cerrado: false }; subs.push(actual); }
      else if (c === 'L') actual.pts.push(ps[0]);
      else if (c === 'C') {
        const p0 = actual.pts[actual.pts.length - 1];
        const [p1, p2, p3] = ps;
        for (let i = 1; i <= pasos; i++) {
          const t = i / pasos, u = 1 - t;
          actual.pts.push([
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
          ]);
        }
      } else if (c === 'Z') actual.cerrado = true;
    }
    return subs;
  }
}

/** Punto y tangente unitaria de una cúbica. */
function bezier(P, t) {
  const u = 1 - t;
  const x = u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0];
  const y = u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1];
  const dx = 3 * u * u * (P[1][0] - P[0][0]) + 6 * u * t * (P[2][0] - P[1][0]) + 3 * t * t * (P[3][0] - P[2][0]);
  const dy = 3 * u * u * (P[1][1] - P[0][1]) + 6 * u * t * (P[2][1] - P[1][1]) + 3 * t * t * (P[3][1] - P[2][1]);
  const l = Math.hypot(dx, dy);
  return { x, y, tx: dx / l, ty: dy / l };
}

/** Rectángulo de esquinas redondeadas (cúbicas de cuarto de círculo). */
function rectRedondo(x, y, w, h, r, tx) {
  const k = 0.5523 * r;
  return new Trayecto(tx)
    .M(x + r, y).L(x + w - r, y).C(x + w - r + k, y, x + w, y + r - k, x + w, y + r)
    .L(x + w, y + h - r).C(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h)
    .L(x + r, y + h).C(x + r - k, y + h, x, y + h - r + k, x, y + h - r)
    .L(x, y + r).C(x, y + r - k, x + r - k, y, x + r, y).Z();
}

const COLOR = {
  jurasico: '#34b2c9',  // unidad vieja del colgante, truncada por la falla
  triasico: '#9a5ea8',  // el resto del colgante
  cretacico: '#8fd16a', // el yacente
  neogeno: '#ffe619',   // la unidad joven del yacente
  tinta: '#111827',     // la falla, sus dientes y el contorno del lápiz
  contacto: '#1f2937',
  lapiz: '#ef4444',
  lapizSombra: '#c81e1e',
  madera: '#f1d6ac',
  mina: '#1f2937',
  virola: '#cbd5e1',
  goma: '#fda4af',
};

/**
 * La escena, en la rejilla de 24 × 24. Cada pieza es un relleno o un trazo;
 * `recorte: true` la limita al azulejo redondeado (el mapa), y el lápiz queda
 * fuera del recorte para poder asomar por la esquina.
 */
function escena() {
  const piezas = [];
  const relleno = (t, color, recorte = true) => piezas.push({ tipo: 'relleno', t, color, recorte });
  const trazo = (t, color, ancho, extra = {}) => piezas.push({ tipo: 'trazo', t, color, ancho, recorte: true, ...extra });

  const PUNTA = [14.3, 10.7];
  const FALLA = [[-1, 19.6], [4.6, 18.6], [9.2, 14.6], PUNTA];
  const falla = () => new Trayecto().M(...FALLA[0]).C(...FALLA[1], ...FALLA[2], ...FALLA[3]);
  // Lo que queda del contacto por delante de la punta, aún sin repasar.
  const porDelante = (t) => t.C(17.2, 8.4, 20.5, 7.2, 25, 6.6);

  relleno(new Trayecto().M(-1, -1).L(25, -1).L(25, 25).L(-1, 25).Z(), COLOR.triasico);
  relleno(new Trayecto().M(-1, -1).L(15.2, -1).C(12.6, 3.6, 8.6, 8, 6.4, 16.4).L(-1, 20).Z(), COLOR.jurasico);
  relleno(porDelante(falla()).L(25, 25).L(-1, 25).Z(), COLOR.cretacico);
  relleno(new Trayecto().M(25, 13.2).C(20.6, 13.6, 16.4, 16.6, 13.6, 25).L(25, 25).Z(), COLOR.neogeno);

  const fino = { opacidad: 0.5 };
  trazo(new Trayecto().M(15.2, -1).C(12.6, 3.6, 8.6, 8, 6.2, 15.9), COLOR.contacto, 0.5, fino);
  trazo(new Trayecto().M(25, 13.2).C(20.6, 13.6, 16.4, 16.6, 13.6, 25), COLOR.contacto, 0.5, fino);
  trazo(porDelante(new Trayecto().M(...PUNTA)), COLOR.contacto, 0.5, { ...fino, guiones: [1.1, 0.9] });

  // La falla inversa: dientes llenos hacia el bloque colgante (arriba).
  trazo(falla(), COLOR.tinta, 1.5, { redondo: true });
  const dientes = new Trayecto();
  for (const t of [0.2, 0.47, 0.74]) {
    const p = bezier(FALLA, t);
    const b = 1.25, h = 2.1;
    dientes.M(p.x - p.tx * b, p.y - p.ty * b).L(p.x + p.ty * h, p.y - p.tx * h).L(p.x + p.tx * b, p.y + p.ty * b).Z();
  }
  relleno(dientes, COLOR.tinta);

  // El lápiz, inclinado 35°, con la mina en la punta de la falla.
  const a = (35 * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  const tx = ([x, y]) => [PUNTA[0] + x * co - y * si, PUNTA[1] + x * si + y * co];
  const w = 1.4, len = 11.4, r = 0.6, k = 0.5523 * r;
  const silueta = new Trayecto(tx)
    .M(0, 0).L(w, -3).L(w, -len + r).C(w, -len + r - k, w - r + k, -len, w - r, -len)
    .L(-w + r, -len).C(-w + r - k, -len, -w, -len + r - k, -w, -len + r).L(-w, -3).Z();
  piezas.push({ tipo: 'trazo', t: silueta, color: COLOR.tinta, ancho: 0.9, recorte: false, redondo: true });
  relleno(silueta, COLOR.tinta, false);
  relleno(new Trayecto(tx).M(0, 0).L(w, -3).L(-w, -3).Z(), COLOR.madera, false);
  relleno(new Trayecto(tx).M(0, 0).L(0.52, -1.12).L(-0.52, -1.12).Z(), COLOR.mina, false);
  const caja = (x0, y0, x1, y1, color) => relleno(new Trayecto(tx).M(x0, y0).L(x1, y0).L(x1, y1).L(x0, y1).Z(), color, false);
  caja(-w, -len + 2.6, w, -3, COLOR.lapiz);
  caja(0, -len + 2.6, w, -3, COLOR.lapizSombra);
  caja(-w, -len + 1.7, w, -len + 2.6, COLOR.virola);
  relleno(new Trayecto(tx)
    .M(-w, -len + 1.7).L(-w, -len + r).C(-w, -len + r - k, -w + r - k, -len, -w + r, -len)
    .L(w - r, -len).C(w - r + k, -len, w, -len + r - k, w, -len + r).L(w, -len + 1.7).Z(), COLOR.goma, false);

  return piezas;
}

const RADIO = 5.5; // el del azulejo

/* ------------------------------------------------------------------ SVG */

function svg(piezas) {
  const linea = (p) => {
    if (p.tipo === 'relleno') return `<path d="${p.t.d()}" fill="${p.color}" />`;
    const extra = [
      p.opacidad != null ? ` stroke-opacity="${p.opacidad}"` : '',
      p.redondo ? ' stroke-linecap="round" stroke-linejoin="round"' : '',
      p.guiones ? ` stroke-dasharray="${p.guiones.join(' ')}"` : '',
    ].join('');
    return `<path d="${p.t.d()}" fill="none" stroke="${p.color}" stroke-width="${p.ancho}"${extra} />`;
  };
  const dentro = piezas.filter((p) => p.recorte).map((p) => `    ${linea(p)}`).join('\n');
  const fuera = piezas.filter((p) => !p.recorte).map((p) => `  ${linea(p)}`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <!--
    GENERADO POR tools/make-icons.mjs — no se edita a mano.

    El icono de FieldDraw: un lápiz que traza una falla inversa en un mapa
    geológico simplificado, con los colores de la carta cronoestratigráfica.
    Este archivo es la pestaña del navegador y, por referencia, el logo de la
    franja de la app, el del panel About y el de la pantalla de carga. Los PNG
    de icons/ salen de la misma geometría.
  -->
  <title>FieldDraw</title>
  <defs><clipPath id="azulejo"><path d="${rectRedondo(0, 0, 24, 24, RADIO).d()}" /></clipPath></defs>
  <g clip-path="url(#azulejo)">
${dentro}
  </g>
${fuera}
</svg>
`;
}

/* ---------------------------------------------------------- rasterizado */

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Polígonos de un trazo: un cuadrilátero por segmento y un disco por vértice. */
function poligonosDeTrazo(pts, ancho, redondo) {
  const h = ancho / 2;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l < 1e-9) continue;
    const nx = (-(y1 - y0) / l) * h, ny = ((x1 - x0) / l) * h;
    out.push([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
  }
  // Discos en las uniones (siempre: tapan las grietas entre segmentos) y en
  // los extremos solo si el remate es redondo.
  const desde = redondo ? 0 : 1, hasta = redondo ? pts.length : pts.length - 1;
  for (let i = desde; i < hasta; i++) {
    const [cx, cy] = pts[i];
    const disco = [];
    for (let j = 0; j < 16; j++) disco.push([cx + h * Math.cos((j / 16) * 2 * Math.PI), cy + h * Math.sin((j / 16) * 2 * Math.PI)]);
    out.push(disco);
  }
  return out;
}

/** Corta una polilínea en guiones según su longitud de arco. */
function guionear(pts, [on, off]) {
  const trozos = [];
  let actual = [pts[0]], dentro = true, resta = on;
  for (let i = 0; i < pts.length - 1; i++) {
    let [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    let l = Math.hypot(x1 - x0, y1 - y0);
    while (l > resta) {
      const f = resta / l;
      const xm = x0 + (x1 - x0) * f, ym = y0 + (y1 - y0) * f;
      if (dentro) { actual.push([xm, ym]); trozos.push(actual); }
      else actual = [[xm, ym]];
      dentro = !dentro;
      l -= resta;
      [x0, y0] = [xm, ym];
      resta = dentro ? on : off;
    }
    resta -= l;
    if (dentro) actual.push([x1, y1]);
  }
  if (dentro && actual.length > 1) trozos.push(actual);
  return trozos;
}

/**
 * Máscara de cobertura (0/1 por submuestra) de un conjunto de polígonos, con
 * la regla de no-cero, por líneas de barrido. `N` es el lado en submuestras.
 *
 * Con `union`, cada polígono se rellena por su cuenta y se suman como
 * conjuntos. Es lo que necesita un trazo: sus cuadriláteros y sus discos
 * giran en sentidos distintos, y tratados como un único trayecto el no-cero
 * los anulaba donde se solapan y dejaba el trazo agujereado.
 */
function mascara(poligonos, N, escala, union = false) {
  const m = new Uint8Array(N * N);
  const grupos = union ? poligonos.map((p) => [p]) : [poligonos];
  const cortes = [];
  for (const grupo of grupos) {
    const aristas = [];
    let ymin = Infinity, ymax = -Infinity;
    for (const poly of grupo)
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        ymin = Math.min(ymin, a[1] * escala); ymax = Math.max(ymax, a[1] * escala);
        if (a[1] === b[1]) continue;
        aristas.push([a[0] * escala, a[1] * escala, b[0] * escala, b[1] * escala]);
      }
    const y0f = Math.max(0, Math.floor(ymin)), y1f = Math.min(N - 1, Math.ceil(ymax));
    for (let y = y0f; y <= y1f; y++) {
      const yc = y + 0.5;
      cortes.length = 0;
      for (const [x0, y0, x1, y1] of aristas) {
        if ((yc >= y0 && yc < y1) || (yc >= y1 && yc < y0)) cortes.push([x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
      }
      if (!cortes.length) continue;
      cortes.sort((p, q) => p[0] - q[0]);
      let giro = 0;
      for (let i = 0; i < cortes.length - 1; i++) {
        giro += cortes[i][1];
        if (giro === 0) continue;
        const xa = Math.max(0, Math.ceil(cortes[i][0] - 0.5)), xb = Math.min(N - 1, Math.floor(cortes[i + 1][0] - 0.5));
        for (let x = xa; x <= xb; x++) m[y * N + x] = 1;
      }
    }
  }
  return m;
}

function rasterizar(piezas, size) {
  const SS = size <= 256 ? 6 : 4; // submuestras por lado de píxel
  const N = size * SS;
  const escala = N / 24;
  const color = new Float32Array(N * N * 3);
  const alfa = new Float32Array(N * N);
  const recorte = mascara(rectRedondo(0, 0, 24, 24, RADIO).aplanar(12).map((s) => s.pts), N, escala);

  for (const p of piezas) {
    const subs = p.t.aplanar();
    let polys;
    if (p.tipo === 'relleno') polys = subs.map((s) => s.pts);
    else {
      polys = [];
      for (const s of subs) {
        const pts = s.cerrado ? [...s.pts, s.pts[0]] : s.pts;
        const tramos = p.guiones ? guionear(pts, p.guiones) : [pts];
        for (const t of tramos) polys.push(...poligonosDeTrazo(t, p.ancho, p.redondo || s.cerrado));
      }
    }
    const m = mascara(polys, N, escala, p.tipo === 'trazo');
    const [r, g, b] = hex(p.color);
    const a = p.opacidad ?? 1;
    for (let i = 0; i < N * N; i++) {
      if (!m[i] || (p.recorte && !recorte[i])) continue;
      color[i * 3] = r * a + color[i * 3] * (1 - a);
      color[i * 3 + 1] = g * a + color[i * 3 + 1] * (1 - a);
      color[i * 3 + 2] = b * a + color[i * 3 + 2] * (1 - a);
      alfa[i] = a + alfa[i] * (1 - a);
    }
  }

  // Promedio de cada bloque SS × SS, con el color premultiplicado por su alfa.
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const i = (y * SS + sy) * N + x * SS + sx;
          const al = alfa[i];
          r += color[i * 3] * al; g += color[i * 3 + 1] * al; b += color[i * 3 + 2] * al; a += al;
        }
      const o = (y * size + x) * 4;
      if (a > 0) { buf[o] = Math.round(r / a); buf[o + 1] = Math.round(g / a); buf[o + 2] = Math.round(b / a); }
      buf[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  return buf;
}

/* ------------------------------------------------------------------ PNG */

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

/* -------------------------------------------------------------- salida */

const outDir = new URL('../icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const piezas = escena();
writeFileSync(new URL('favicon.svg', outDir), svg(piezas));
console.log('icons/favicon.svg');
for (const size of [180, 192, 512]) {
  const out = png(size, size, rasterizar(piezas, size));
  writeFileSync(new URL(`icon-${size}.png`, outDir), out);
  console.log(`icons/icon-${size}.png  ${out.length} B`);
}
