const KEY = 'fielddraw.features.v1';
const UNITS_KEY = 'fielddraw.units.v1';
const ORNAMENTS_KEY = 'fielddraw.ornaments.v1';
const STRUCTURE_STYLE_KEY = 'fielddraw.structure-style.v1';
const STRABO_STYLE_KEY = 'fielddraw.strabo-style.v1';

/**
 * Clave de OpenTopography.
 *
 * Vive en localStorage y NO dentro del proyecto, a diferencia del resto de los
 * ajustes: un `.fdproj.json` se manda por correo o se sube a un repositorio
 * como cualquier archivo del trabajo, y una credencial personal no tiene por
 * qué viajar ahí. Es del dispositivo, no del mapa.
 */
const OPENTOPO_KEY = 'fielddraw.opentopo-key.v1';

export function saveFeatures(features) {
  try {
    localStorage.setItem(KEY, JSON.stringify(features));
  } catch {
    // Cuota llena o modo privado: no vale la pena romper el dibujo por esto.
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
