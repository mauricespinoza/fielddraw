/**
 * Ajustes de imagen de las capas raster: brillo, contraste, saturación, tono
 * e invertir.
 *
 * Sirven para lo que pasa en terreno con un basemap o un mapa offline: una
 * imagen satelital lavada por el sol de la pantalla, una carta escaneada que
 * compite en color con las unidades que se están dibujando encima, o una
 * imagen demasiado clara para trabajar de noche.
 *
 * TODO ES NATIVO DE MAPLIBRE. Cada ajuste se traduce a propiedades de
 * pintura `raster-*`, que son uniforms de la GPU: mover un deslizador no
 * vuelve a pedir ni a decodificar una sola tesela, y lo que se ve es lo que
 * sale en el PNG, el PDF y el GeoTIFF, que copian el lienzo. Por eso tampoco
 * hay gamma: MapLibre no la tiene, y conseguirla obligaría a reprocesar cada
 * tesela en el cliente.
 *
 * LOS AJUSTES SON DEL DISPOSITIVO, no del proyecto: dependen de la pantalla y
 * de la luz en que se mira, no del mapa que se hace. Viven aparte del estado
 * de las capas, indexados por id, para que un mapa offline que se reabre más
 * tarde los recupere aunque su fila aparezca después del arranque.
 *
 * Este módulo no sabe nada de MapLibre ni del DOM, así que se prueba en Node.
 */

/** Sin ajuste: la imagen tal como llega. */
export const NEUTRAL = Object.freeze({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  invert: false,
});

/** Rango y paso de cada deslizador, también lo que acepta `sanitizeAdjust`. */
export const RANGES = Object.freeze({
  brightness: { min: -1, max: 1, step: 0.05 },
  contrast: { min: -1, max: 1, step: 0.05 },
  saturation: { min: -1, max: 1, step: 0.05 },
  hue: { min: -180, max: 180, step: 5 },
});

/**
 * Los preajustes pensados para terreno.
 *
 * - **Base**: gris y clara, para que los colores de las unidades y las
 *   trazas resalten sobre la imagen satelital.
 * - **High contrast**: para una imagen lavada o la pantalla al sol.
 * - **Faded**: atenuada y desaturada, que se lea sin mandar.
 * - **Inverted**: para trabajar de noche. Invertir y girar el tono 180°
 *   oscurece la imagen conservando los colores aproximados: el agua sigue
 *   azul y la vegetación verde, solo cambia la luminosidad.
 */
export const PRESETS = Object.freeze([
  {
    id: 'mapping-base',
    label: 'Mapping base',
    title: 'Grey and light, so the units and traces you draw stand out',
    adjust: { brightness: 0.15, contrast: -0.2, saturation: -1, hue: 0, invert: false },
  },
  {
    id: 'high-contrast',
    label: 'High contrast',
    title: 'For washed-out imagery or a screen in direct sun',
    adjust: { brightness: 0, contrast: 0.4, saturation: 0.1, hue: 0, invert: false },
  },
  {
    id: 'faded',
    label: 'Faded',
    title: 'Darker and less saturated, so it reads without taking over',
    adjust: { brightness: -0.3, contrast: 0, saturation: -0.5, hue: 0, invert: false },
  },
  {
    id: 'inverted',
    label: 'Inverted',
    title: 'Dark imagery for night work; colours keep roughly their hue',
    adjust: { brightness: 0, contrast: 0, saturation: 0, hue: 180, invert: true },
  },
]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Un ajuste válido a partir de cualquier cosa.
 *
 * Lo que falte o no sea número vuelve al neutro y lo que se salga del rango se
 * recorta: un valor corrupto en localStorage no puede dejar la imagen negra
 * ni romper el estilo del mapa.
 */
export function sanitizeAdjust(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...NEUTRAL };
  for (const [k, r] of Object.entries(RANGES)) {
    const v = Number(src[k]);
    if (Number.isFinite(v)) out[k] = clamp(v, r.min, r.max);
  }
  out.invert = src.invert === true;
  return out;
}

/** ¿Deja la imagen tal cual? */
export function isNeutral(adjust) {
  const a = sanitizeAdjust(adjust);
  return Object.keys(NEUTRAL).every((k) => a[k] === NEUTRAL[k]);
}

/** ¿El ajuste es exactamente un preajuste? Devuelve su id o `null`. */
export function matchPreset(adjust) {
  const a = sanitizeAdjust(adjust);
  const p = PRESETS.find((pr) => Object.keys(NEUTRAL).every((k) => pr.adjust[k] === a[k]));
  return p ? p.id : null;
}

/**
 * Las propiedades de pintura de MapLibre para un ajuste.
 *
 * El brillo desplaza la ventana de salida [min, max] que MapLibre usa para
 * repartir la luminosidad: subirlo levanta el negro, bajarlo apaga el blanco.
 * Invertir es intercambiar los dos extremos —MapLibre interpola de min a max
 * y no exige que min sea el menor—, lo que da el negativo sin más código.
 */
export function rasterPaint(adjust) {
  const a = sanitizeAdjust(adjust);
  let lo = Math.max(0, a.brightness);
  let hi = Math.min(1, 1 + a.brightness);
  if (a.invert) [lo, hi] = [hi, lo];
  return {
    'raster-brightness-min': lo,
    'raster-brightness-max': hi,
    'raster-contrast': a.contrast,
    'raster-saturation': a.saturation,
    'raster-hue-rotate': a.hue,
  };
}

/**
 * El mapa id → ajuste guardado, limpio.
 *
 * Se descartan los neutros (no hace falta recordarlos) y lo que no sea un id
 * de texto.
 */
export function sanitizeAdjustMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!id) continue;
    const a = sanitizeAdjust(v);
    if (!isNeutral(a)) out[id] = a;
  }
  return out;
}
