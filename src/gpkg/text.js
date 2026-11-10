/**
 * Valores de texto de un GeoPackage ajeno, leídos como lo que son.
 *
 * El caso que obligó a escribir esto es el GeoPackage que se descarga de
 * StraboSpot: el campo Notes —la descripción del afloramiento, lo más valioso
 * de la libreta— llegaba vacío o roto a la app. Hay tres maneras en que un
 * texto se estropea entre el SQLite de otra herramienta y la pantalla, y aquí
 * se deshacen las tres sin tocar un texto que ya venía bien:
 *
 * - **Texto guardado como BLOB.** SQLite deja guardar cualquier valor en
 *   cualquier columna, y quien escribe con un enlace binario (PDO, algunos
 *   ORM) deja las notas como bytes UTF-8 en una columna TEXT. sql.js las
 *   devuelve como `Uint8Array`, y el importador las tiraba por ser «binario».
 *   Un BLOB que es UTF-8 válido y no es una geometría (cabecera `GP`) es
 *   texto.
 * - **UTF-8 leído como Latin-1** («granodiorita de biotita, Plutón» sale
 *   «PlutÃ³n»). Se detecta por la huella inconfundible —una `Ã` o una `Â`
 *   seguida de un carácter del bloque Latin-1 alto— y se recodifica solo si
 *   el resultado es UTF-8 válido.
 * - **Notas con marcado HTML.** El editor web de StraboSpot guarda saltos de
 *   párrafo como `<p>`/`<br>` y los acentos a veces como entidades
 *   (`&oacute;`). Se convierten a saltos de línea y caracteres: el visor y los
 *   puntos de control enseñan texto plano, y `<p>` en medio de una
 *   descripción de roca no la hace más legible.
 *
 * Además: fin de línea de Windows a `\n` y sin el NUL final que dejan algunos
 * escritores en C.
 */

const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;

/** ¿Empieza como un GeoPackageBinary? Entonces es geometría y no texto. */
const esGeometria = (b) => b.length >= 8 && b[0] === 0x47 && b[1] === 0x50;

/** UTF-8 estricto, o null si los bytes no lo son. */
function utf8(bytes) {
  if (!decoder) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Un BLOB de atributo como texto, si lo es.
 *
 * Se exige que no traiga caracteres de control fuera de tabulador y saltos de
 * línea: una imagen pequeña o un WKB suelto podrían ser UTF-8 válido por
 * casualidad, pero nunca sin bytes de control.
 *
 * @returns {string|null}
 */
export function blobAsText(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || esGeometria(bytes)) return null;
  let fin = bytes.length;
  while (fin > 0 && bytes[fin - 1] === 0) fin--;
  const s = utf8(bytes.subarray(0, fin));
  if (s === null) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s)) return null;
  return s;
}

/** La huella de UTF-8 leído como Latin-1 / Windows-1252. */
const MOJIBAKE = /[ÃÂ][\u0080-¿]/;

/** Deshace «PlutÃ³n» → «Plutón». Devuelve el texto tal cual si no aplica. */
export function fixMojibake(s) {
  if (!MOJIBAKE.test(s)) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return s; // ya hay caracteres que Latin-1 no tiene: no es el caso
    bytes[i] = c;
  }
  const r = utf8(bytes);
  return r === null ? s : r;
}

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', deg: '°', plusmn: '±',
  ordm: 'º', ordf: 'ª', iexcl: '¡', iquest: '¿', middot: '·', ndash: '–', mdash: '—',
  micro: 'µ', sup2: '²', sup3: '³', times: '×',
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d?);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTIDADES, e) ? ENTIDADES[e] : m;
  });
}

/** Etiquetas de texto enriquecido: solo estas delatan HTML y no un «<5 cm». */
const HTML_TAG = /<\/?(p|br|div|span|b|i|u|em|strong|ul|ol|li|font|h[1-6])\b[^>]*>/i;

/** HTML de un editor de notas a texto plano con sus saltos de párrafo. */
export function htmlToText(s) {
  if (!HTML_TAG.test(s)) return /&(#x?[0-9a-f]+|[a-z]+);/i.test(s) ? decodeEntities(s) : s;
  const plano = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(plano)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Un texto de atributo, limpio. */
export function cleanText(s) {
  if (typeof s !== 'string' || s === '') return s;
  let t = s.replace(/\u0000+$/, '');
  t = fixMojibake(t);
  t = t.replace(/\r\n?/g, '\n');
  return htmlToText(t);
}

/**
 * Un valor de columna de atributos tal como debe entrar a la capa: texto
 * limpio, BLOB de texto como texto, y cualquier otro binario como `null`.
 */
export function attributeValue(v) {
  if (v instanceof Uint8Array) {
    const s = blobAsText(v);
    return s === null ? null : cleanText(s);
  }
  return typeof v === 'string' ? cleanText(v) : v;
}
