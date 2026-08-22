/**
 * Visor de atributos: el recuadro que dice qué hay debajo del dedo.
 *
 * Nació dentro del panel de StraboSpot y ahí se quedó atado a los spots. Lo
 * usan dos fuentes distintas —los spots descargados y las capas importadas de
 * un GeoPackage— y son la misma pregunta: «esto que estoy tocando, ¿qué es?».
 * Un segundo recuadro habría significado dos maquetados, dos hojas de estilo y
 * dos maneras de colocarse en pantalla que se irían separando con el tiempo.
 *
 * Lo que cambia entre una fuente y otra es el TÍTULO y qué campos se enseñan;
 * eso lo decide quien llama. Aquí solo se pinta.
 */

const $ = (id) => document.getElementById(id);

const EMPTY = '—';

/**
 * Un valor vacío se escribe como raya y no como celda en blanco: en un
 * GeoPackage la diferencia entre «el campo existe y está vacío» y «el campo no
 * existe» es información, y una celda en blanco las confunde.
 */
export function formatValue(v) {
  if (v === null || v === undefined || v === '') return EMPTY;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    // Un GeoPackage no trae objetos anidados, pero un GeoJSON ajeno sí puede.
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** Un valor corto cabe en su fila; uno largo necesita la fila entera. */
const esLargo = (texto, forzar) => forzar || texto.length > 28;

/**
 * @param {object} opts
 * @param {string} opts.title       encabezado del recuadro
 * @param {Array<[string, *]>} opts.entries  pares campo/valor, ya filtrados
 * @param {[number, number]} opts.screen     dónde se tocó, en píxeles
 * @param {(k: string, texto: string) => boolean} [opts.isLong]
 * @param {string} [opts.empty]     qué decir si no hay ni un campo
 * @param {string} [opts.note]      línea de contexto bajo el título
 */
export function openAttrs({ title, entries, screen, isLong, empty, note }) {
  const menu = $('attrs');
  const body = $('attrs-body');
  body.replaceChildren();
  $('attrs-title').textContent = title;

  if (note) {
    const p = document.createElement('p');
    p.className = 'hint attrs-note';
    p.textContent = note;
    body.appendChild(p);
  }

  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = empty || 'This feature has no attributes.';
    body.appendChild(p);
  }

  for (const [k, v] of entries) {
    const texto = formatValue(v);
    const row = document.createElement('div');
    row.className = 'attrs-row';
    const kEl = document.createElement('span');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('span');
    vEl.className = 'v';
    vEl.textContent = texto;
    if (texto !== EMPTY && esLargo(texto, isLong ? isLong(k, texto) : false)) {
      row.classList.add('long');
    }
    row.append(kEl, vEl);
    body.appendChild(row);
  }

  menu.classList.remove('hidden');
  /*
   * Se coloca cerca del toque pero sin salirse de la pantalla. Se mide DESPUÉS
   * de rellenarlo: la altura depende de cuántos campos traiga, y con una tabla
   * de veinte columnas colocarlo a ciegas lo deja medio fuera por abajo.
   */
  const rect = menu.getBoundingClientRect();
  const x = Math.min(Math.max(12, screen[0] - rect.width / 2), window.innerWidth - rect.width - 12);
  const y = Math.min(screen[1] + 18, window.innerHeight - rect.height - 12);
  menu.style.left = `${x}px`;
  menu.style.top = `${Math.max(12, y)}px`;
}

export function closeAttrs() {
  $('attrs').classList.add('hidden');
}

export const attrsOpen = () => !$('attrs').classList.contains('hidden');

/* ---------- capas importadas de un GeoPackage ---------- */

/**
 * Columnas que no son un atributo del elemento, sino fontanería de la tabla.
 *
 * La geometría se guarda en una columna del GeoPackage como cualquier otra, y
 * enseñarla dejaría una fila con un blob ilegible. `fid` NO está aquí a
 * propósito: es la clave de la fila, y es lo que permite volver a encontrar
 * ese mismo elemento en QGIS.
 */
export const GEOM_COLUMN_NAMES = new Set([
  'geom',
  'geometry',
  'the_geom',
  'shape',
  'wkb_geometry',
]);

/**
 * Campos que NOMBRAN al elemento, en orden de preferencia.
 *
 * En una carta geológica lo que identifica a un polígono es su unidad, no que
 * pertenezca a la tabla "unidades_geologicas". Se buscan en castellano y en
 * inglés porque una capa del Sernageomin y una de un paper no coinciden en
 * nada, y con acento y sin él porque tampoco coinciden en eso.
 */
export const NAME_FIELDS = [
  'name',
  'nombre',
  'unidad',
  'unit',
  'label',
  'etiqueta',
  'descripcion',
  'descripción',
  'description',
  'tipo',
  'type',
  'simbolo',
  'símbolo',
  'codigo',
  'código',
  'code',
];

/** Los campos que se enseñan de un elemento importado, en el orden de la tabla. */
export function importedEntries(feature) {
  const props = (feature && feature.properties) || {};
  return Object.entries(props).filter(
    ([k, v]) => !GEOM_COLUMN_NAMES.has(k.toLowerCase()) && !(v instanceof Uint8Array),
  );
}

/**
 * Título del recuadro para un elemento importado.
 *
 * El nombre de la capa acompaña siempre: con dos GeoPackage abiertos hay que
 * saber de cuál se está leyendo, y "Kcm" a secas no lo dice.
 */
export function importedTitle(layerLabel, feature) {
  const props = (feature && feature.properties) || {};
  // Se compara en minúsculas: los nombres de columna vienen como los dejó
  // quien hizo la capa, y NOMBRE y Nombre son el mismo campo.
  const porNombre = new Map(Object.keys(props).map((k) => [k.toLowerCase(), k]));
  for (const candidato of NAME_FIELDS) {
    const real = porNombre.get(candidato);
    const v = real === undefined ? null : props[real];
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      return `${String(v).trim()} · ${layerLabel}`;
    }
  }
  return layerLabel;
}

