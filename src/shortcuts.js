/**
 * Atajos de teclado.
 *
 * La app nació para tablet, donde no hay teclado y todo se resuelve con el
 * dedo o el Pencil. Desde un PC ese mismo diseño se vuelve lento: cambiar de
 * herramienta obliga a ir hasta la barra y volver, y en una sesión de gabinete
 * eso son cientos de viajes del ratón.
 *
 * La tabla es la ÚNICA fuente de verdad: de ella salen el despachador, la
 * ayuda que se abre con `?` y los tooltips de la barra. Así no puede pasar que
 * el panel de ayuda anuncie una tecla que ya no hace nada, que es la forma
 * habitual en que estas listas se pudren.
 *
 * `mod` es Ctrl en Windows/Linux y ⌘ en macOS: se normalizan al mismo combo
 * para no duplicar cada entrada.
 */

/**
 * @typedef {object} Shortcut
 * @property {string} id      acción; la interfaz decide qué hace
 * @property {string[]} keys  combos que la disparan
 * @property {string} label   qué hace, en la ayuda
 * @property {string} group   epígrafe bajo el que se lista
 */

/** @type {Shortcut[]} */
export const SHORTCUTS = [
  /* ---------------- herramientas ---------------- */
  { id: 'tool-navigate', keys: ['h'], label: 'Navigate (pan and zoom)', group: 'Tools' },
  { id: 'tool-select', keys: ['v'], label: 'Select', group: 'Tools' },
  { id: 'tool-line', keys: ['l'], label: 'Line — with one line selected, continues it', group: 'Tools' },
  { id: 'tool-polygon', keys: ['p'], label: 'Polygon', group: 'Tools' },
  { id: 'tool-vertices', keys: ['n'], label: 'Vertices (nodes)', group: 'Tools' },
  { id: 'tool-cut', keys: ['x'], label: 'Split', group: 'Tools' },
  { id: 'tool-reshape', keys: ['r'], label: 'Reshape', group: 'Tools' },
  { id: 'tool-measure', keys: ['d'], label: 'Strike and dip', group: 'Tools' },
  { id: 'tool-profile', keys: ['f'], label: 'Topographic profile', group: 'Tools' },

  /* ---------------- modificadores ---------------- */
  { id: 'toggle-snap', keys: ['s'], label: 'Snapping on/off', group: 'Drawing aids' },
  { id: 'toggle-trace', keys: ['t'], label: 'Trace on/off', group: 'Drawing aids' },
  { id: 'toggle-terrain', keys: ['3'], label: '3D terrain (disables drawing)', group: 'Drawing aids' },
  { id: 'cycle-certainty', keys: ['c'], label: 'Cycle certainty: observed → inferred → concealed', group: 'Drawing aids' },
  { id: 'locate', keys: ['g'], label: 'Centre on my GPS position', group: 'Drawing aids' },

  /* ---------------- edición ---------------- */
  { id: 'finish', keys: ['enter'], label: 'Finish the feature', group: 'Editing' },
  { id: 'undo-vertex', keys: ['backspace'], label: 'Undo the last vertex', group: 'Editing' },
  { id: 'escape', keys: ['escape'], label: 'Close a panel · discard the feature · clear the selection', group: 'Editing' },
  { id: 'delete-selection', keys: ['delete'], label: 'Delete the selected features', group: 'Editing' },
  { id: 'undo', keys: ['mod+z'], label: 'Undo', group: 'Editing' },
  { id: 'redo', keys: ['mod+shift+z', 'mod+y'], label: 'Redo', group: 'Editing' },
  { id: 'select-all', keys: ['mod+a'], label: 'Select every feature', group: 'Editing' },
  { id: 'merge', keys: ['m'], label: 'Merge the selection', group: 'Editing' },
  { id: 'topology', keys: ['y'], label: 'Topology check', group: 'Editing' },

  /* ---------------- paneles y archivos ---------------- */
  { id: 'panel-layers', keys: ['shift+l'], label: 'Layers', group: 'Panels and files' },
  { id: 'panel-units', keys: ['shift+u'], label: 'Geological units', group: 'Panels and files' },
  { id: 'panel-symbology', keys: ['shift+y'], label: 'Symbology', group: 'Panels and files' },
  { id: 'panel-strabo', keys: ['shift+b'], label: 'StraboSpot', group: 'Panels and files' },
  { id: 'panel-settings', keys: ['mod+,'], label: 'Settings', group: 'Panels and files' },
  { id: 'project-save', keys: ['mod+s'], label: 'Save project', group: 'Panels and files' },
  { id: 'project-open', keys: ['mod+o'], label: 'Open project', group: 'Panels and files' },
  { id: 'export-gpkg', keys: ['mod+e'], label: 'Export to GeoPackage', group: 'Panels and files' },
  { id: 'help', keys: ['?', 'f1'], label: 'This list', group: 'Panels and files' },
];

/** Orden en que se agrupan en la ayuda. */
export const SHORTCUT_GROUPS = ['Tools', 'Drawing aids', 'Editing', 'Panels and files'];

/**
 * Combo canónico de un evento de teclado.
 *
 * `shift` solo se incluye con letras y teclas nombradas. Con los símbolos no
 * sirve de nada y además estorba: en un teclado español `?` YA exige Shift, así
 * que registrarlo como `shift+?` lo haría imposible de escribir en un teclado
 * inglés, donde `?` sale de otra combinación. La tecla que llega en `e.key` ya
 * es el símbolo final, sea cual sea la distribución.
 */
export function eventCombo(e) {
  const partes = [];
  if (e.ctrlKey || e.metaKey) partes.push('mod');
  if (e.altKey) partes.push('alt');

  const key = String(e.key || '').toLowerCase();
  const esSimbolo = key.length === 1 && !/[a-z0-9]/.test(key);
  if (e.shiftKey && !esSimbolo) partes.push('shift');

  partes.push(key === ' ' ? 'space' : key);
  return partes.join('+');
}

const POR_COMBO = new Map();
for (const s of SHORTCUTS) {
  for (const k of s.keys) {
    if (POR_COMBO.has(k)) throw new Error(`Atajo duplicado: ${k}`);
    POR_COMBO.set(k, s.id);
  }
}

/** Acción que corresponde a un evento, o null si esa tecla no está asignada. */
export function shortcutFor(e) {
  return POR_COMBO.get(eventCombo(e)) || null;
}

/**
 * Si el foco está escribiendo, el teclado es suyo.
 *
 * Sin esto, escribir el nombre de una unidad en el panel dispararía media
 * docena de herramientas por el camino: la `l` de "Lava" cambiaría a Línea.
 */
export function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Los atajos que la app se queda para sí aunque el navegador tenga los suyos.
 * Solo estos llevan `preventDefault`: robarle al navegador teclas que no
 * usamos —`mod+p`, por ejemplo— sería una grosería.
 */
const CONSUMEN = new Set([
  'undo', 'redo', 'select-all', 'project-save', 'project-open',
  'export-gpkg', 'panel-settings', 'help', 'delete-selection',
]);

export const consumesDefault = (id) => CONSUMEN.has(id);

/** Etiqueta legible de un combo, con los símbolos de la plataforma. */
export function comboLabel(combo, mac = false) {
  return combo
    .split('+')
    .map((p) => {
      if (p === 'mod') return mac ? '⌘' : 'Ctrl';
      if (p === 'shift') return mac ? '⇧' : 'Shift';
      if (p === 'alt') return mac ? '⌥' : 'Alt';
      if (p === 'escape') return 'Esc';
      if (p === 'enter') return '↵';
      if (p === 'backspace') return '⌫';
      if (p === 'delete') return 'Del';
      if (p === 'space') return 'Space';
      if (p === 'f1') return 'F1';
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join(mac ? '' : '+');
}

/** Todos los combos de una acción, ya formateados. Vale para los tooltips. */
export function labelsFor(id, mac = false) {
  const s = SHORTCUTS.find((x) => x.id === id);
  return s ? s.keys.map((k) => comboLabel(k, mac)) : [];
}
