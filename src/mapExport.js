/**
 * Sacar la vista del mapa como lámina: SVG, PNG o PDF.
 *
 * Lo que se entrega no es una captura de pantalla. Una captura no dice dónde
 * está el mapa, ni a qué escala, ni hacia dónde mira, y esas tres cosas son la
 * diferencia entre una figura de una memoria y una imagen pegada en un
 * documento. Aquí la vista sale con marco de cebra y coordenadas en los cuatro
 * bordes, escala gráfica y norte — ver `mapFrame.js`, que es quien compone.
 *
 * Este módulo se ocupa solo de escribir esa composición en cada formato:
 *
 * - **SVG**: el marco, los rótulos, la escala y el norte como vectores, y el
 *   mapa como imagen incrustada. Se abre en Illustrator o Inkscape y se puede
 *   retocar la rotulación sin volver a exportar.
 * - **PNG**: el mismo SVG rasterizado, para pegar sin más.
 * - **PDF**: lo mismo, pero con el texto como texto y el trazo como trazo, que
 *   es lo que se manda a imprimir.
 *
 * Los tres nacen de la misma lista de primitivas, así que no pueden discrepar.
 */

import { buildFrame } from './mapFrame.js';
import { PT_PER_PX, buildPdf } from './pdf.js';
import { formatScale } from './scale.js';

/* ---------- SVG ---------- */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * La fuente del SVG y del PNG.
 *
 * Helvetica primero, que es la métrica con la que el PDF centra sus rótulos:
 * así los tres formatos colocan el texto en el mismo sitio. Detrás, las
 * sustitutas habituales para que un Linux sin Helvetica no caiga en una
 * serifa.
 */
const FONT = "Helvetica, 'Helvetica Neue', Arial, sans-serif";

function opToSvg(op, imageHref) {
  if (op.kind === 'rect') {
    const pintura =
      `${op.fill ? ` fill="${esc(op.fill)}"` : ' fill="none"'}` +
      `${op.stroke ? ` stroke="${esc(op.stroke)}" stroke-width="${num(op.lineWidth || 1)}"` : ''}`;
    return `<rect x="${num(op.x)}" y="${num(op.y)}" width="${num(op.w)}" height="${num(op.h)}"${pintura}/>`;
  }

  if (op.kind === 'line') {
    return (
      `<line x1="${num(op.x1)}" y1="${num(op.y1)}" x2="${num(op.x2)}" y2="${num(op.y2)}"` +
      ` stroke="${esc(op.stroke || '#000')}" stroke-width="${num(op.lineWidth || 1)}"/>`
    );
  }

  if (op.kind === 'path') {
    const d =
      op.points.map((p, i) => `${i ? 'L' : 'M'}${num(p[0])} ${num(p[1])}`).join(' ') +
      (op.close === false ? '' : ' Z');
    const pintura =
      `${op.fill ? ` fill="${esc(op.fill)}"` : ' fill="none"'}` +
      `${op.stroke ? ` stroke="${esc(op.stroke)}" stroke-width="${num(op.lineWidth || 1)}"` : ''}`;
    return `<path d="${d}"${pintura}/>`;
  }

  if (op.kind === 'text') {
    const anchor =
      op.anchor === 'middle' ? 'middle' : op.anchor === 'end' ? 'end' : 'start';
    const giro = op.rotate ? ` transform="rotate(${num(op.rotate)} ${num(op.x)} ${num(op.y)})"` : '';
    return (
      `<text x="${num(op.x)}" y="${num(op.y)}" font-family="${FONT}"` +
      ` font-size="${num(op.size || 10)}"${op.bold ? ' font-weight="700"' : ''}` +
      ` fill="${esc(op.fill || '#000')}" text-anchor="${anchor}"${giro}>${esc(op.text)}</text>`
    );
  }

  if (op.kind === 'image' && imageHref) {
    return (
      `<image x="${num(op.x)}" y="${num(op.y)}" width="${num(op.w)}" height="${num(op.h)}"` +
      ` preserveAspectRatio="none" href="${esc(imageHref)}"/>`
    );
  }

  return '';
}

/** La lámina como texto SVG, lista para guardar. */
export function frameToSvg(layout, imageHref) {
  const cuerpo = layout.ops.map((op) => opToSvg(op, imageHref)).join('\n  ');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${num(layout.width)}" height="${num(layout.height)}"` +
    ` viewBox="0 0 ${num(layout.width)} ${num(layout.height)}">\n  ${cuerpo}\n</svg>\n`
  );
}

/* ---------- rasterizado ---------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the image could not be decoded'));
    img.src = src;
  });
}

/**
 * El SVG, pintado sobre un lienzo a `scale` veces su tamaño.
 *
 * Sale del MISMO SVG y no de un lienzo dibujado aparte, para que el PNG no
 * pueda separarse del vector: lo que se ve en uno es, píxel a píxel, el otro.
 *
 * El SVG viaja como `blob:` y la imagen del mapa dentro de él como `data:`.
 * Es la única combinación que funciona: un SVG cargado como imagen no puede
 * traerse recursos de fuera —el navegador lo aísla—, pero sí resolver lo que
 * lleva incrustado, y por eso el lienzo no queda contaminado y `toBlob` puede
 * leerlo.
 */
async function svgToPng(svg, width, height, scale) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(width * scale));
    lienzo.height = Math.max(1, Math.round(height * scale));
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise((r) => lienzo.toBlob(r, 'image/png'));
    if (!blob) throw new Error('the canvas produced no image');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Por encima de esto, guardar la imagen del mapa sin comprimir es un disparate
 * de memoria en una tablet: doce megapíxeles en RGB son 36 MB de un tirón, más
 * los 48 del `ImageData` del que salen. A partir de ahí se pasa a JPEG, que la
 * hace el navegador sin que nosotros toquemos un solo píxel.
 */
const FLATE_MAX_PIXELS = 12e6;

/** Desinfla en formato zlib, que es lo que un `/FlateDecode` de PDF espera. */
async function deflate(bytes) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * La imagen del mapa, comprimida como el PDF la sabe leer.
 *
 * Sin pérdida mientras se pueda: un contacto es una línea de dos píxeles sobre
 * un fondo oscuro, que es justo el caso donde el JPEG deja halos. Se cae a
 * JPEG solo cuando el navegador no trae `CompressionStream` o cuando la imagen
 * es tan grande que hacerlo a mano costaría más memoria de la que hay.
 */
async function mapImageForPdf(dataUrl, pxW, pxH) {
  const img = await loadImage(dataUrl);
  const lienzo = document.createElement('canvas');
  lienzo.width = pxW;
  lienzo.height = pxH;
  const ctx = lienzo.getContext('2d');
  // Fondo blanco: el lienzo del mapa puede traer alfa y un PDF en DeviceRGB no
  // tiene dónde ponerlo; sin esto, lo transparente saldría negro.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pxW, pxH);
  ctx.drawImage(img, 0, 0, pxW, pxH);

  if (typeof CompressionStream === 'function' && pxW * pxH <= FLATE_MAX_PIXELS) {
    try {
      const rgba = ctx.getImageData(0, 0, pxW, pxH).data;
      const rgb = new Uint8Array(pxW * pxH * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4) {
        rgb[j++] = rgba[i];
        rgb[j++] = rgba[i + 1];
        rgb[j++] = rgba[i + 2];
      }
      return { bytes: await deflate(rgb), width: pxW, height: pxH, filter: 'FlateDecode' };
    } catch {
      /* sin memoria o sin soporte: se sigue por el camino del JPEG */
    }
  }

  const blob = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', 0.95));
  if (!blob) throw new Error('the map image could not be encoded');
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: pxW,
    height: pxH,
    filter: 'DCTDecode',
  };
}

/* ---------- la salida ---------- */

export const FORMATS = ['svg', 'png', 'pdf'];

/** Nombre de archivo estable y ordenable. */
export function exportFilename(title, format) {
  const slug =
    String(title || 'fielddraw-map')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'fielddraw-map';
  return `${slug}-${new Date().toISOString().slice(0, 10)}.${format}`;
}

/**
 * El crédito del pie: la fecha y, si se sabe, el centro del encuadre.
 *
 * El centro va ahí por una razón práctica: es lo que permite volver al mismo
 * sitio meses después, cuando la figura ya está pegada en un documento y el
 * proyecto se ha movido.
 */
export function defaultCredit(view, extra = '') {
  const partes = [];
  if (Array.isArray(view.center)) {
    partes.push(`${view.center[1].toFixed(4)}, ${view.center[0].toFixed(4)}`);
  }
  partes.push(new Date().toISOString().slice(0, 10));
  if (extra) partes.push(extra);
  return `FieldDraw · ${partes.join(' · ')}`;
}

/**
 * Compone y escribe la lámina.
 *
 * @param {object} view lo que devolvió `captureForExport` del mapa
 * @param {object} opts `{format, title, credit, scale}`
 * @returns {Promise<{blob: Blob, filename: string, layout: object}>}
 */
export async function exportMapImage(view, opts = {}) {
  const format = FORMATS.includes(opts.format) ? opts.format : 'png';
  const title = opts.title || '';
  const scaleText = Number.isFinite(view.denominator) ? formatScale(view.denominator) : '';
  const layout = buildFrame(view, {
    title,
    scaleText,
    credit: opts.credit === undefined ? defaultCredit(view) : opts.credit,
  });

  const filename = exportFilename(title || 'fielddraw-map', format);

  if (format === 'svg') {
    const svg = frameToSvg(layout, view.image);
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), filename, layout };
  }

  if (format === 'png') {
    const svg = frameToSvg(layout, view.image);
    const escala = Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 2;
    const blob = await svgToPng(svg, layout.width, layout.height, escala);
    return { blob, filename, layout };
  }

  const imagen = await mapImageForPdf(view.image, view.pixelWidth, view.pixelHeight);
  return { blob: buildPdf(layout, imagen, { title }), filename, layout };
}

/** El tamaño del papel que sale, en milímetros. Sirve para avisar en la UI. */
export function pageSizeMm(layout) {
  const mm = (px) => Math.round(((px * PT_PER_PX) / 72) * 25.4);
  return { width: mm(layout.width), height: mm(layout.height) };
}
