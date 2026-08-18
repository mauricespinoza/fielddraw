const KEY = 'fielddraw.features.v1';
const UNITS_KEY = 'fielddraw.units.v1';
const ORNAMENTS_KEY = 'fielddraw.ornaments.v1';
const STRABO_STYLE_KEY = 'fielddraw.strabo-style.v1';

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
