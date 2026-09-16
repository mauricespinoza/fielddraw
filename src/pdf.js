/**
 * Un escritor de PDF de una sola página, sin dependencias.
 *
 * FieldDraw no tiene empaquetador ni `node_modules`: se sirve tal cual y se
 * abre desde el iPad. Traer una librería de PDF —la más chica anda por el
 * megabyte— para poner un marco y cuatro textos alrededor de una imagen sería
 * multiplicar por diez lo que pesa la aplicación entera. Un PDF es, en el
 * fondo, un puñado de objetos numerados y una tabla que dice en qué byte
 * empieza cada uno; lo que hace falta aquí cabe en este archivo.
 *
 *
 * QUÉ SE ESCRIBE Y QUÉ NO
 *
 * Se escribe VECTORIAL todo lo que la lámina dibuja por su cuenta: el marco de
 * cebra, las líneas, la escala gráfica, la flecha del norte y los rótulos. Eso
 * sale nítido a cualquier ampliación e imprime como lo que es, texto y trazo.
 *
 * La imagen del mapa no: el mapa lo rasteriza la GPU y no hay vectores que
 * sacar de ahí. Va como una imagen incrustada, y es la única parte de la
 * lámina que tiene resolución finita.
 *
 *
 * LAS FUENTES
 *
 * Helvetica y Helvetica-Bold, que son dos de las catorce fuentes que todo
 * lector de PDF trae y por tanto no hay que incrustar. A cambio hay que saber
 * cuánto mide cada letra para poder centrar un rótulo, y por eso están abajo
 * las tablas de anchos. Codificación `WinAnsiEncoding`, que es la que tiene el
 * grado (°) donde hace falta.
 */

/** Puntos por píxel de la lámina. Se compone a 96 ppp y el PDF mide en 1/72". */
export const PT_PER_PX = 72 / 96;

/* Anchos de glifo en milésimas de em. Índice 0 = carácter 32 (espacio). */
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/**
 * Anchos de lo que no es ASCII y la lámina sí escribe: el grado del marco, el
 * punto medio y la raya del crédito, y la puntuación que un título traído del
 * nombre del proyecto puede arrastrar.
 */
const W_EXTRA = {
  0x00a0: 278, // espacio duro
  0x00b0: 400, // grado
  0x00b7: 278, // punto medio
  0x00a1: 333,
  0x00bf: 611,
  0x2009: 278, // espacio fino, el separador de millar de `formatScale`
  0x2013: 556, // raya corta
  0x2014: 1000, // raya
  0x2018: 222,
  0x2019: 222,
  0x201c: 333,
  0x201d: 333,
  0x2022: 350,
  0x2026: 1000,
};

/**
 * La letra base de una acentuada: «á» → «a».
 *
 * Sirve para lo mismo en los dos sitios donde hace falta —medir y escribir— y
 * se apoya en que en Helvetica una vocal acentuada mide exactamente lo que su
 * vocal, que es cierto por construcción de la fuente: el acento se compone
 * encima sin ensanchar el glifo.
 */
function baseLetter(ch) {
  const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return base && base !== ch ? base[0] : '';
}

/** Ancho de un texto, en píxeles de la lámina. */
export function textWidth(text, size, bold = false) {
  const tabla = bold ? W_BOLD : W_REGULAR;
  let mil = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) {
      mil += tabla[cp - 32];
      continue;
    }
    if (W_EXTRA[cp] !== undefined) {
      mil += W_EXTRA[cp];
      continue;
    }
    const base = baseLetter(ch);
    const bcp = base ? base.codePointAt(0) : 0;
    mil += bcp >= 32 && bcp <= 126 ? tabla[bcp - 32] : tabla['n'.codePointAt(0) - 32];
  }
  return (mil / 1000) * size;
}

/**
 * Los caracteres de CP1252 que no están en Latin-1.
 *
 * `WinAnsiEncoding` es CP1252, que mete en la franja 0x80-0x9F —vacía en
 * Latin-1— la puntuación tipográfica. Sin esta tabla, la raya de un título
 * como «Cerro Colorado — mapa geológico» salía impresa como un interrogante,
 * que es justo el sitio donde más se nota.
 */
const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

/**
 * Texto tal como lo come un PDF: entre paréntesis, con los paréntesis y la
 * barra escapados, y lo que no es ASCII en octal sobre WinAnsi.
 */
function pdfString(text) {
  const octal = (b) => `\\${b.toString(8).padStart(3, '0')}`;
  let out = '';
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') {
      out += `\\${ch}`;
    } else if (cp >= 32 && cp <= 126) {
      out += ch;
    } else if (cp === 0x2009 || cp === 0x00a0) {
      // El espacio fino y el duro se escriben como un espacio normal: ninguno
      // de los dos existe en la fuente y lo que importa es que separe.
      out += ' ';
    } else if (cp >= 0x00a0 && cp <= 0x00ff) {
      out += octal(cp); // Latin-1 y WinAnsi coinciden en esta franja
    } else if (CP1252.has(cp)) {
      out += octal(CP1252.get(cp));
    } else {
      const base = baseLetter(ch);
      out += base && base.codePointAt(0) <= 126 ? base : '?';
    }
  }
  return `(${out})`;
}

const hex = (v) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(v || ''));
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
};

const n = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * El flujo de contenido de la página, a partir de las primitivas de la lámina.
 *
 * La lámina mide desde arriba y el PDF desde abajo, así que aquí se invierte
 * la `y` una sola vez, en `Y()`. Es el único sitio del programa donde importa
 * de qué lado está el origen.
 */
function contentStream(ops, layoutHeight) {
  const k = PT_PER_PX;
  const X = (v) => n(v * k);
  const Y = (v) => n((layoutHeight - v) * k);
  const S = (v) => n(v * k);
  const out = [];

  for (const op of ops) {
    if (op.kind === 'image') {
      // La imagen se coloca con una matriz: PDF dibuja el XObject en el
      // cuadrado unidad, así que la matriz ES el rectángulo de destino.
      out.push('q');
      out.push(`${S(op.w)} 0 0 ${S(op.h)} ${X(op.x)} ${Y(op.y + op.h)} cm`);
      out.push('/Im0 Do');
      out.push('Q');
      continue;
    }

    if (op.kind === 'text') {
      const [r, g, b] = hex(op.fill || '#000000');
      const size = op.size || 10;
      const w = textWidth(op.text, size, !!op.bold);
      // El anclaje se resuelve aquí porque el PDF no lo tiene: solo sabe
      // empezar a escribir en un punto.
      const dx = op.anchor === 'middle' ? -w / 2 : op.anchor === 'end' ? -w : 0;
      out.push('BT');
      out.push(`/${op.bold ? 'F2' : 'F1'} ${n(size * k)} Tf`);
      out.push(`${n(r)} ${n(g)} ${n(b)} rg`);
      if (op.rotate) {
        const rad = (op.rotate * Math.PI) / 180;
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        // El desplazamiento del anclaje va GIRADO con el texto; si no, un
        // rótulo vertical centrado se centraría en horizontal.
        const px = op.x + dx * c;
        const py = op.y + dx * s;
        out.push(`${n(c)} ${n(-s)} ${n(s)} ${n(c)} ${X(px)} ${Y(py)} Tm`);
      } else {
        out.push(`1 0 0 1 ${X(op.x + dx)} ${Y(op.y)} Tm`);
      }
      out.push(`${pdfString(op.text)} Tj`);
      out.push('ET');
      continue;
    }

    const pintar = () => {
      const hayRelleno = !!op.fill;
      const hayTrazo = !!op.stroke;
      if (hayRelleno) {
        const [r, g, b] = hex(op.fill);
        out.push(`${n(r)} ${n(g)} ${n(b)} rg`);
      }
      if (hayTrazo) {
        const [r, g, b] = hex(op.stroke);
        out.push(`${n(r)} ${n(g)} ${n(b)} RG`);
        out.push(`${n((op.lineWidth || 1) * k)} w`);
      }
      if (hayRelleno && hayTrazo) out.push('B');
      else if (hayRelleno) out.push('f');
      else if (hayTrazo) out.push('S');
      else out.push('n');
    };

    if (op.kind === 'rect') {
      out.push(`${X(op.x)} ${Y(op.y + op.h)} ${S(op.w)} ${S(op.h)} re`);
      pintar();
      continue;
    }

    if (op.kind === 'line') {
      out.push(`${X(op.x1)} ${Y(op.y1)} m ${X(op.x2)} ${Y(op.y2)} l`);
      pintar();
      continue;
    }

    if (op.kind === 'path' && Array.isArray(op.points) && op.points.length) {
      const [p0, ...resto] = op.points;
      out.push(`${X(p0[0])} ${Y(p0[1])} m`);
      for (const p of resto) out.push(`${X(p[0])} ${Y(p[1])} l`);
      if (op.close !== false) out.push('h');
      pintar();
    }
  }

  return out.join('\n');
}

/**
 * Arma el archivo.
 *
 * Un PDF es una lista de objetos y, al final, la tabla de referencias cruzadas
 * que dice en qué byte empieza cada uno. Como los bytes solo se saben al
 * escribir, se va montando el archivo en trozos y anotando el desplazamiento
 * de cada objeto según se añade.
 *
 * @param {object} layout la lámina: `{width, height, ops}`
 * @param {object} imagen `{bytes, width, height, filter}` con la imagen del
 *   mapa ya comprimida; `filter` es `DCTDecode` (JPEG) o `FlateDecode` (RGB
 *   crudo desinflado). Puede faltar: se escribe la lámina sin mapa.
 * @param {object} meta `{title}`
 * @returns {Blob}
 */
export function buildPdf(layout, imagen, meta = {}) {
  const wPt = layout.width * PT_PER_PX;
  const hPt = layout.height * PT_PER_PX;
  const contenido = contentStream(layout.ops, layout.height);

  const objetos = [];
  const add = (cuerpo) => {
    objetos.push(cuerpo);
    return objetos.length; // los números de objeto empiezan en 1
  };

  const catalogo = add(null); // 1, se rellena al final
  const paginas = add(null); // 2
  const pagina = add(null); // 3
  const contenidoObj = add({ dict: `<< /Length ${byteLength(contenido)} >>`, data: contenido });
  const fuente1 = add({
    dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  });
  const fuente2 = add({
    dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  });

  let imagenObj = 0;
  if (imagen && imagen.bytes && imagen.bytes.length) {
    imagenObj = add({
      dict:
        `<< /Type /XObject /Subtype /Image /Width ${imagen.width} /Height ${imagen.height}` +
        ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${imagen.filter}` +
        ` /Length ${imagen.bytes.length} >>`,
      data: imagen.bytes,
    });
  }

  const recursos =
    `<< /Font << /F1 ${fuente1} 0 R /F2 ${fuente2} 0 R >>` +
    (imagenObj ? ` /XObject << /Im0 ${imagenObj} 0 R >>` : '') +
    ' >>';

  objetos[catalogo - 1] = { dict: `<< /Type /Catalog /Pages ${paginas} 0 R >>` };
  objetos[paginas - 1] = {
    dict: `<< /Type /Pages /Kids [${pagina} 0 R] /Count 1 >>`,
  };
  objetos[pagina - 1] = {
    dict:
      `<< /Type /Page /Parent ${paginas} 0 R /MediaBox [0 0 ${n(wPt)} ${n(hPt)}]` +
      ` /Resources ${recursos} /Contents ${contenidoObj} 0 R >>`,
  };

  const info = add({
    dict:
      '<< /Producer (FieldDraw) /Creator (FieldDraw)' +
      (meta.title ? ` /Title ${pdfString(meta.title)}` : '') +
      ` /CreationDate ${pdfString(pdfDate(new Date()))} >>`,
  });

  /* ---------- a bytes ---------- */

  const partes = [];
  let offset = 0;
  const empujar = (chunk) => {
    partes.push(chunk);
    offset += chunk.length;
  };
  const texto = (s) => empujar(new TextEncoder().encode(s));

  texto('%PDF-1.4\n');
  // Un comentario con cuatro bytes altos: le dice a cualquier herramienta que
  // trate el archivo como binario y no lo convierta de saltos de línea.
  empujar(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const posiciones = new Array(objetos.length + 1).fill(0);
  for (let i = 0; i < objetos.length; i++) {
    const obj = objetos[i];
    posiciones[i + 1] = offset;
    texto(`${i + 1} 0 obj\n${obj.dict}\n`);
    if (obj.data !== undefined) {
      texto('stream\n');
      empujar(typeof obj.data === 'string' ? new TextEncoder().encode(obj.data) : obj.data);
      texto('\nendstream\n');
    }
    texto('endobj\n');
  }

  const xref = offset;
  let tabla = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objetos.length; i++) {
    tabla += `${String(posiciones[i]).padStart(10, '0')} 00000 n \n`;
  }
  tabla +=
    `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R /Info ${info} 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`;
  texto(tabla);

  return new Blob(partes, { type: 'application/pdf' });
}

function byteLength(s) {
  return new TextEncoder().encode(s).length;
}

function pdfDate(d) {
  const p = (v) => String(v).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
