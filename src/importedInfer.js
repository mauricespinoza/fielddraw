/**
 * Simbología de una capa de líneas ajena, leída de sus campos.
 *
 * Una capa de GeoPackage sin estilo QML entraba toda en un gris liso, aunque
 * trajera un campo «tipo» que distingue contactos de fallas. Aquí se hace lo
 * mismo que con los spots de StraboSpot: el campo dice de qué es cada trazo —
 * con la misma escalera de `adopt.js`, coincidencia exacta con un tipo de
 * FieldDraw y después palabras— y de ahí salen el color y la certeza (trazo
 * continuo, a rayas o punteado). Devuelve reglas en el mismo formato que el
 * QML, así que `importedStyle.js` las dibuja sin saber de dónde vienen.
 *
 * Puro: sin DOM ni store.
 */

import { CERTAINTY_BY_ID, LINE_TYPE_BY_ID } from './symbology.js';
import { certaintyOf, lineTypeFor, normalizeText } from './adopt.js';

/** Los campos donde una carta suele decir el tipo, en orden de preferencia. */
const TYPE_FIELDS = [
  'type', 'tipo', 'clase', 'class', 'categoria', 'category', 'simbologia', 'symbol',
  'descripcion', 'description', 'label', 'etiqueta', 'nombre', 'name',
];
const CERTAINTY_FIELDS = ['certainty', 'certeza'];

/** Más reglas que esto y MapLibre se arrastra; se prefiere dejar el gris. */
const MAX_RULES = 40;

const realKey = (props, nombre) =>
  Object.keys(props).find((k) => normalizeText(k) === normalizeText(nombre));

/**
 * @param {object[]} features GeoJSON de una capa de líneas
 * @returns {null|{rules: object[], field: string, certaintyField: string|null, guessed: boolean}}
 *   null si ningún campo da pistas del tipo (se queda la simbología por omisión).
 */
export function inferLineStyle(features) {
  if (!features || features.length === 0) return null;
  const props0 = features[0].properties || {};
  const field = TYPE_FIELDS.map((f) => realKey(props0, f)).find(Boolean);
  if (!field) return null;
  const certField = CERTAINTY_FIELDS.map((f) => realKey(props0, f)).find(Boolean) || null;

  const groups = new Map();
  let reconocidos = 0;
  let adivinados = false;
  for (const f of features) {
    const p = f.properties || {};
    // El tipo se busca SOLO en el campo elegido: si no, un «name» suelto
    // cambiaría de qué es el trazo según el elemento.
    const sub = { [field]: p[field] };
    const r = lineTypeFor(sub, null);
    const raw = p[field];
    const rawCert = certField ? p[certField] : null;
    const key = JSON.stringify([raw ?? null, rawCert ?? null]);
    if (groups.has(key)) continue;
    if (r.type) reconocidos++;
    else continue;
    if (!r.exact) adivinados = true;
    groups.set(key, {
      raw,
      rawCert,
      type: r.type,
      certainty: certField ? certaintyOf({ certainty: rawCert }) : 'observed',
    });
  }
  if (reconocidos === 0 || groups.size > MAX_RULES) return null;

  const rules = [];
  for (const g of groups.values()) {
    const tipo = LINE_TYPE_BY_ID.get(g.type);
    if (!tipo) continue;
    const cert = CERTAINTY_BY_ID.get(g.certainty);
    const parts = [['==', ['get', field], g.raw ?? '']];
    if (certField) parts.push(['==', ['get', certField], g.rawCert ?? null]);
    const width = 1.5 * (tipo.weight || 1);
    rules.push({
      label: tipo.label,
      filter: parts.length === 1 ? parts[0] : ['all', ...parts],
      symbol: {
        kind: 'line',
        color: tipo.color,
        opacity: 1,
        width,
        // El guion de FieldDraw va en múltiplos del ancho, como lo lee MapLibre.
        dash: cert && cert.dash ? cert.dash : null,
      },
    });
  }
  if (rules.length === 0) return null;
  return { rules, warnings: [], inferred: true, field, certaintyField: certField, guessed: adivinados };
}
