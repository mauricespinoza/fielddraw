import { STORE_DRAWING, get, put } from './idb.js';

const KEY = 'fielddraw.features.v1';
const UNITS_KEY = 'fielddraw.units.v1';
const ORNAMENTS_KEY = 'fielddraw.ornaments.v1';
const STRUCTURE_STYLE_KEY = 'fielddraw.structure-style.v1';
const CONTROL_POINT_STYLE_KEY = 'fielddraw.control-point-style.v1';
const STRABO_STYLE_KEY = 'fielddraw.strabo-style.v1';
const STRABO_DATASETS_KEY = 'fielddraw.strabo-datasets.v1';
const SECTIONS_KEY = 'fielddraw.sections.v1';
const IMPORT_STYLE_KEY = 'fielddraw.import-style.v1';

/**
 * Clave de OpenTopography.
 *
 * Vive en localStorage y NO dentro del proyecto, a diferencia del resto de los
 * ajustes: un `.fdproj.json` se manda por correo o se sube a un repositorio
 * como cualquier archivo del trabajo, y una credencial personal no tiene por
 * qué viajar ahí. Es del dispositivo, no del mapa.
 */
const OPENTOPO_KEY = 'fielddraw.opentopo-key.v1';

/** Cuándo se escribió la copia del dibujo que hay en localStorage (ms). */
const FEATURES_SAVED_AT_KEY = 'fielddraw.features.saved-at.v1';

/** Id del registro del dibujo en IndexedDB (`STORE_DRAWING`). */
const FEATURES_IDB_ID = 'features';

/**
 * Guarda el dibujo en localStorage y, además, en IndexedDB.
 *
 * localStorage es síncrono —lo único que alcanza a escribirse al cerrar la
 * app de golpe— pero tiene unos 5 MB. Antes, al llenarse, el error se tragaba
 * en silencio: el dibujo dejaba de guardarse y al recargar volvía una versión
 * vieja sin que nadie lo supiera. Ahora la copia de IndexedDB (con mucho más
 * cupo) lleva la hora de guardado y al abrir gana la más reciente; si
 * localStorage se llena, su copia vieja se borra para que no se cuele.
 *
 * Devuelve una promesa: `true` si al menos una de las dos copias quedó al día.
 */
export function saveFeatures(features) {
  const savedAt = Date.now();
  const json = JSON.stringify(features);
  let local = false;
  try {
    localStorage.setItem(KEY, json);
    localStorage.setItem(FEATURES_SAVED_AT_KEY, String(savedAt));
    local = true;
  } catch {
    // Cuota llena (o modo privado): fuera la copia vieja, que ya no es la buena.
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(FEATURES_SAVED_AT_KEY);
    } catch {
      /* ignorar */
    }
  }
  return put(STORE_DRAWING, { id: FEATURES_IDB_ID, savedAt, json }).then(
    () => true,
    () => local,
  );
}

/** Hora de la copia del dibujo en localStorage (0 si no hay o es anterior a guardarla). */
export function savedFeaturesTime() {
  try {
    return Number(localStorage.getItem(FEATURES_SAVED_AT_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * La copia del dibujo en IndexedDB si es MÁS RECIENTE que la de localStorage
 * (hora `than`); si no, `null`. Nunca falla: sin IndexedDB, `null`.
 */
export async function loadNewerFeatures(than) {
  try {
    const rec = await get(STORE_DRAWING, FEATURES_IDB_ID);
    if (!rec || !(rec.savedAt > than)) return null;
    const parsed = JSON.parse(rec.json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadSavedFeatures() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveUnits(units) {
  try {
    localStorage.setItem(UNITS_KEY, JSON.stringify(units));
  } catch {
    /* ignorar */
  }
}

export function loadSavedUnits() {
  try {
    const raw = localStorage.getItem(UNITS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

export function saveOrnaments(ornaments) {
  try {
    localStorage.setItem(ORNAMENTS_KEY, JSON.stringify(ornaments));
  } catch {
    /* ignorar */
  }
}

export function loadSavedOrnaments() {
  try {
    const raw = localStorage.getItem(ORNAMENTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStructureStyle(style) {
  try {
    localStorage.setItem(STRUCTURE_STYLE_KEY, JSON.stringify(style));
  } catch {
    /* ignorar */
  }
}

export function loadSavedStructureStyle() {
  try {
    const raw = localStorage.getItem(STRUCTURE_STYLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveControlPointStyle(style) {
  try {
    localStorage.setItem(CONTROL_POINT_STYLE_KEY, JSON.stringify(style));
  } catch {
    /* ignorar */
  }
}

export function loadSavedControlPointStyle() {
  try {
    const raw = localStorage.getItem(CONTROL_POINT_STYLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Datasets de StraboSpot cargados, con su candado y su ojo.
 *
 * Se guardan para que el trabajo de los demás siga a la vista al volver a
 * abrir la app en terreno, sin señal para bajarlo otra vez. Si no caben —un
 * proyecto enorme con la cuota llena— se pierde solo la capa de consulta: los
 * elementos ya abiertos viven en el dibujo y su fila se rehace sola, cerrada.
 */
export function saveStraboDatasets(list) {
  try {
    localStorage.setItem(STRABO_DATASETS_KEY, JSON.stringify(list));
  } catch {
    /* ignorar */
  }
}

export function loadSavedStraboDatasets() {
  try {
    const raw = localStorage.getItem(STRABO_DATASETS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStraboStyle(style) {
  try {
    localStorage.setItem(STRABO_STYLE_KEY, JSON.stringify(style));
  } catch {
    /* ignorar */
  }
}

export function loadSavedStraboStyle() {
  try {
    const raw = localStorage.getItem(STRABO_STYLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveImportStyle(style) {
  try {
    localStorage.setItem(IMPORT_STYLE_KEY, JSON.stringify(style));
  } catch {
    /* ignorar */
  }
}

export function loadSavedImportStyle() {
  try {
    const raw = localStorage.getItem(IMPORT_STYLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveOpenTopoKey(key) {
  try {
    if (key) localStorage.setItem(OPENTOPO_KEY, key);
    else localStorage.removeItem(OPENTOPO_KEY);
  } catch {
    /* ignorar */
  }
}

export function loadSavedOpenTopoKey() {
  try {
    return localStorage.getItem(OPENTOPO_KEY) || '';
  } catch {
    return '';
  }
}

/** Texto plano listo para descargar; lo usa la exportación del perfil a CSV. */
export function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type }), filename);
}

export function downloadGeoJSON(features, filename = 'fielddraw.geojson') {
  downloadBlob(
    new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], {
      type: 'application/geo+json',
    }),
    filename,
  );
}

/** En iPadOS esto guarda en la app Archivos. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Perfiles estructurales guardados (con sus dibujos). */
export function saveSections(list) {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(list));
  } catch {
    /* cuota llena: no vale la pena romper nada por esto */
  }
}

export function loadSavedSections() {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
