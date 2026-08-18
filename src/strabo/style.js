/**
 * Parámetros puros de la simbología de StraboSpot: sin DOM, sin `Image()`, sin
 * MapLibre. Vive aparte de `layers.js` para que `store.js` pueda validar lo
 * que viene de localStorage sin arrastrar el rasterizado de SVG a un módulo
 * que no toca el DOM.
 */

export function defaultStraboStyle() {
  return { structureSize: 1, observationSize: 1 };
}

export const STRABO_SIZE_LIMITS = { min: 0.4, max: 3, step: 0.1 };

export function sanitizeStraboStyle(raw) {
  const out = defaultStraboStyle();
  if (!raw || typeof raw !== 'object') return out;
  for (const key of ['structureSize', 'observationSize']) {
    const v = Number(raw[key]);
    if (Number.isFinite(v)) {
      out[key] = Math.min(STRABO_SIZE_LIMITS.max, Math.max(STRABO_SIZE_LIMITS.min, v));
    }
  }
  return out;
}
