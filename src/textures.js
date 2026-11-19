/**
 * Texturas de roca para el relleno de las unidades.
 *
 * Una textura es un patrón translúcido que se pinta ENCIMA del color de la
 * unidad: el color sigue diciendo de qué unidad es el polígono y la textura
 * dice cómo es la roca. Por eso el fondo de cada tesela es transparente y solo
 * lleva los cristales.
 *
 * Las teselas se generan por código y no se leen de un archivo: no hay imagen
 * que mantener ni que precachear en el service worker, y funcionan sin red. El
 * generador es determinista (misma semilla, mismos píxeles), así que la
 * textura se ve igual en cada dispositivo y se puede probar sin DOM.
 */

/**
 * Catálogo. `auto` son los trozos de nombre (sin acentos, en minúscula) que
 * hacen que una unidad lleve la textura por omisión: una unidad que se llama
 * «Andesita de Abanico» no tiene que acordarse de pedirla.
 */
export const TEXTURES = [
  {
    id: 'porphyry-plag',
    label: 'Porphyritic (plagioclase phenocrysts)',
    auto: ['andesit'],
  },
];

export const TEXTURE_BY_ID = new Map(TEXTURES.map((t) => [t.id, t]));

/** Valor explícito de «esta unidad no lleva textura», aunque el nombre la pida. */
export const TEXTURE_NONE = 'none';

/** Valor por omisión: la que corresponda al nombre, si alguna. */
export const TEXTURE_AUTO = 'auto';

const sinAcentos = (v) =>
  String(v === null || v === undefined ? '' : v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** La textura que le toca a un nombre de unidad por sí solo, o `null`. */
export function autoTextureFor(name) {
  const n = sinAcentos(name);
  if (!n) return null;
  for (const t of TEXTURES) {
    if (t.auto.some((k) => n.includes(k))) return t.id;
  }
  return null;
}

/**
 * La textura efectiva de una unidad: la que eligió el usuario, o la que sale
 * del nombre si no eligió nada (`texture` ausente o `auto`).
 */
export function textureOf(unit) {
  if (!unit) return null;
  const t = unit.texture;
  if (t === TEXTURE_NONE) return null;
  if (TEXTURE_BY_ID.has(t)) return t;
  return autoTextureFor(unit.name);
}

const PREFIX = 'texture-';

export const textureImageName = (id) => `${PREFIX}${id}`;

/** El id de textura que nombra una imagen, o `null` si no es de las nuestras. */
export function textureIdOfImage(name) {
  if (typeof name !== 'string' || !name.startsWith(PREFIX)) return null;
  const id = name.slice(PREFIX.length);
  return TEXTURE_BY_ID.has(id) ? id : null;
}

/** Píxeles de la tesela y su escala: 288 px a ×2 son 144 px de pantalla. */
export const TEXTURE_SIZE = 288;
export const TEXTURE_PIXEL_RATIO = 2;

/** PRNG de 32 bits (mulberry32): lo bastante bueno para esparcir cristales. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pinta `color` sobre el píxel con cobertura `cov` (composición «over»). */
function over(data, i, color, cov) {
  const a = cov * color[3];
  if (a <= 0) return;
  const da = data[i + 3] / 255;
  const oa = a + da * (1 - a);
  for (let k = 0; k < 3; k++) {
    const c = (color[k] * a + data[i + k] * da * (1 - a)) / oa;
    data[i + k] = Math.round(c);
  }
  data[i + 3] = Math.round(oa * 255);
}

/**
 * Rectángulo girado con borde: el cristal tabular de plagioclasa. `size` es la
 * tesela; se dibuja también desplazado ±size para que el patrón empalme sin
 * costuras al repetirse.
 */
function lath(data, size, { cx, cy, half, wide, ang, fill, edge, twin }) {
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const reach = Math.hypot(half, wide) + 2;
  for (let oy = -size; oy <= size; oy += size) {
    for (let ox = -size; ox <= size; ox += size) {
      const x0 = Math.max(0, Math.floor(cx + ox - reach));
      const x1 = Math.min(size - 1, Math.ceil(cx + ox + reach));
      const y0 = Math.max(0, Math.floor(cy + oy - reach));
      const y1 = Math.min(size - 1, Math.ceil(cy + oy + reach));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - (cx + ox);
          const dy = y + 0.5 - (cy + oy);
          // Coordenadas en el eje del cristal: u a lo largo, v a lo ancho.
          const u = dx * cos + dy * sin;
          const v = -dx * sin + dy * cos;
          // Distancia al borde del rectángulo (negativa dentro).
          const d = Math.max(Math.abs(u) - half, Math.abs(v) - wide);
          const cov = Math.min(1, Math.max(0, 0.5 - d));
          if (cov <= 0) continue;
          const i = (y * size + x) * 4;
          over(data, i, fill, cov);
          // Borde oscuro de ~1,2 px: separa el cristal de la matriz.
          const ring = Math.min(1, Math.max(0, 1.2 + d)) * cov;
          if (ring > 0) over(data, i, edge, ring);
          // Macla polisintética: una raya fina paralela al eje largo.
          if (twin && Math.abs(v - wide * 0.25) < 0.6 && Math.abs(u) < half - 1.5) {
            over(data, i, twin, 0.7 * cov);
          }
        }
      }
    }
  }
}

/** Mota oscura (máficos y opacos de la masa fundamental): disco suave. */
function speck(data, size, { cx, cy, r, color }) {
  const reach = r + 2;
  for (let oy = -size; oy <= size; oy += size) {
    for (let ox = -size; ox <= size; ox += size) {
      const x0 = Math.max(0, Math.floor(cx + ox - reach));
      const x1 = Math.min(size - 1, Math.ceil(cx + ox + reach));
      const y0 = Math.max(0, Math.floor(cy + oy - reach));
      const y1 = Math.min(size - 1, Math.ceil(cy + oy + reach));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - (cx + ox), y + 0.5 - (cy + oy)) - r;
          const cov = Math.min(1, Math.max(0, 0.5 - d));
          if (cov > 0) over(data, (y * size + x) * 4, color, cov);
        }
      }
    }
  }
}

/** Distancia entre dos puntos de una tesela que se repite. */
function wrapDist(size, ax, ay, bx, by) {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > size / 2) dx = size - dx;
  if (dy > size / 2) dy = size - dy;
  return Math.hypot(dx, dy);
}

/**
 * Andesita porfídica: fenocristales tabulares de plagioclasa, subparalelos
 * (textura de flujo), sobre una masa fundamental que se deja transparente
 * —el color de la unidad—, con cristalitos menores y motas oscuras.
 */
function porphyry(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  const rand = rng(0x5eed1e);
  const placed = [];
  const free = (x, y, r) => placed.every((p) => wrapDist(size, x, y, p.x, p.y) > r + p.r);

  const flow = (-22 * Math.PI) / 180; // dirección dominante de los fenocristales
  const fill = [212, 218, 196, 0.86];
  const edge = [96, 104, 88, 0.55];
  const twin = [150, 158, 138, 0.8];

  // Fenocristales grandes (unos 11 por tesela). Cada uno son 1–3 segmentos
  // casi alineados y de ancho distinto: así el contorno sale escalonado, como
  // en la roca, y no como un rectángulo de dibujo técnico.
  let tries = 0;
  while (placed.filter((p) => p.big).length < 11 && tries++ < 600) {
    const half = 16 + rand() * 12;
    const wide = 5.5 + rand() * 3.5;
    const x = rand() * size;
    const y = rand() * size;
    const r = half * 0.95 + wide;
    if (!free(x, y, r)) continue;
    placed.push({ x, y, r, big: true });
    const ang = flow + (rand() - 0.5) * 0.35;
    const tone = (rand() - 0.5) * 18;
    const col = [fill[0] + tone, fill[1] + tone, fill[2] + tone * 0.8, fill[3]];
    const segs = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < segs; k++) {
      const t = segs === 1 ? 0 : (k / (segs - 1) - 0.5) * 2;
      const sh = half / segs + rand() * 4;
      const along = t * (half - sh) ;
      const across = (rand() - 0.5) * wide * 0.5;
      lath(data, size, {
        cx: x + Math.cos(ang) * along - Math.sin(ang) * across,
        cy: y + Math.sin(ang) * along + Math.cos(ang) * across,
        half: sh,
        wide: wide * (0.75 + rand() * 0.35),
        ang: ang + (rand() - 0.5) * 0.08,
        fill: col, edge, twin: k === 0 ? twin : null,
      });
    }
  }
  // Cristales menores, con más dispersión de orientación.
  tries = 0;
  let small = 0;
  while (small < 22 && tries++ < 600) {
    const half = 4 + rand() * 5;
    const wide = 2 + rand() * 1.6;
    const x = rand() * size;
    const y = rand() * size;
    const r = half * 0.8 + wide;
    if (!free(x, y, r)) continue;
    placed.push({ x, y, r, big: false });
    small++;
    lath(data, size, {
      cx: x, cy: y, half, wide,
      ang: flow + (rand() - 0.5) * 1.4,
      fill, edge, twin: null,
    });
  }
  // Motas oscuras, agrupadas: máficos alterados y opacos.
  const dark = [34, 38, 42, 0.8];
  for (let g = 0; g < 16; g++) {
    const gx = rand() * size;
    const gy = rand() * size;
    const n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const x = gx + (rand() - 0.5) * 16;
      const y = gy + (rand() - 0.5) * 16;
      if (!free(x, y, 1.5)) continue;
      speck(data, size, { cx: (x + size) % size, cy: (y + size) % size, r: 1 + rand() * 1.8, color: dark });
    }
  }
  return { width: size, height: size, data };
}

const GENERATORS = { 'porphyry-plag': porphyry };

const cache = new Map();

/** La tesela RGBA de una textura (`{width, height, data}`), o `null` si no existe. */
export function textureImage(id) {
  if (!GENERATORS[id]) return null;
  if (!cache.has(id)) cache.set(id, GENERATORS[id](TEXTURE_SIZE));
  return cache.get(id);
}

/** Mapas que ya generan sus texturas a pedido. */
const aPedido = new WeakSet();

/**
 * Hace que el mapa pida cada textura cuando la necesita: MapLibre avisa con
 * `styleimagemissing` justo antes de pintar un patrón cuya imagen falta, y una
 * imagen añadida en ese momento se usa en el mismo cuadro. Sin unidades con
 * textura no se genera nada.
 */
export function addTextureImages(map) {
  if (aPedido.has(map)) return;
  aPedido.add(map);
  map.on('styleimagemissing', (e) => {
    const id = textureIdOfImage(e && e.id);
    if (!id || map.hasImage(e.id)) return;
    map.addImage(e.id, textureImage(id), { pixelRatio: TEXTURE_PIXEL_RATIO });
  });
}
