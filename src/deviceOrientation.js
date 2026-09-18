/**
 * Rumbo y manteo leídos de los sensores del teléfono: giroscopio y
 * acelerómetro para la inclinación, magnetómetro para la referencia al
 * norte. El navegador ya los fusiona en el trío `alpha`/`beta`/`gamma` del
 * evento de orientación — aquí no se lee ningún sensor por separado, se
 * interpreta ese trío como el plano contra el que se apoya el teléfono.
 *
 * **Postura de la medida**: el DORSO del teléfono apoyado a ras sobre la
 * superficie, con la pantalla mirando hacia el cielo/el observador. En esa
 * postura el eje +Z del teléfono —el que sale de la pantalla, tal como lo
 * define el estándar— apunta exactamente hacia afuera de la roca, así que ES
 * la normal de la superficie. Rumbo y manteo salen de esa normal con la misma
 * fórmula que ya usa `strikeDipFromGradient` sobre la normal de un plano
 * ajustado por mínimos cuadrados: no son dos convenciones, son la misma.
 *
 * **El error no se inventa, se mide**: en vez de declarar una cifra fija de
 * catálogo, se toman varias lecturas mientras el teléfono está apoyado y se
 * reporta cuánto varían entre sí — la misma lógica de "no afirmar más
 * precisión de la que el dato sostiene" que rige el resto de `structure.js`.
 */

import { circularMeanDeg, circularStdDeg, norm360 } from './structure.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function deviceOrientationSupported() {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/**
 * iOS 13+ exige pedir permiso explícito, y solo lo concede si se pide desde
 * dentro del gesto del usuario (un `click`). Android no tiene este paso: el
 * permiso de sensores va con el de geolocalización, o no existe.
 */
export function needsOrientationPermission() {
  return deviceOrientationSupported() && typeof DeviceOrientationEvent.requestPermission === 'function';
}

export async function requestOrientationPermission() {
  if (!needsOrientationPermission()) return true;
  try {
    return (await DeviceOrientationEvent.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Rumbo, manteo y acimut de manteo del plano apoyado contra el dorso del
 * teléfono, a partir del trío `alpha`/`beta`/`gamma`.
 *
 * `alpha`, `beta` y `gamma` son los tres ángulos de Euler intrínsecos
 * Z-X'-Y'' del estándar W3C de orientación de dispositivo. La matriz de
 * rotación que definen manda la base del teléfono al marco terrestre
 * (Este, Norte, Arriba); su tercera columna es el eje +Z del teléfono —el
 * que sale de la pantalla— ya expresado en ese marco, y ese eje es la
 * normal de la superficie en la postura de esta medida.
 *
 * Con esa normal (nx, ny, nz) el manteo es el ángulo con la vertical y el
 * acimut de manteo sale de su componente horizontal exactamente como en
 * `strikeDipFromGradient`: ahí la normal ascendente de un plano ajustado es
 * proporcional a (−a, −b, 1), y su parte horizontal ya apunta en la
 * dirección de manteo, sin necesidad de invertirla.
 */
export function strikeDipFromOrientation(alpha, beta, gamma) {
  const a = alpha * RAD;
  const b = beta * RAD;
  const g = gamma * RAD;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);

  const nx = ca * sg + cg * sa * sb; // Este
  const ny = sa * sg - ca * cg * sb; // Norte
  const nz = cb * cg; // Arriba

  const dip = Math.acos(Math.min(1, Math.max(-1, nz))) * DEG;
  const horiz = Math.hypot(nx, ny);
  const dipAzimuth = horiz < 1e-9 ? 0 : norm360(Math.atan2(nx, ny) * DEG);
  return { strike: norm360(dipAzimuth - 90), dip, dipAzimuth };
}

/** Cuánto se guarda de la ventana móvil de muestras, en milisegundos. */
const SAMPLE_WINDOW_MS = 1500;
/** Bajo esta cantidad de muestras la lectura se enseña pero no se ofrece para anotar. */
const MIN_SAMPLES = 8;

/**
 * Arranca la escucha de los sensores y llama a `onReading` con la lectura
 * acumulada en la ventana móvil cada vez que llega una muestra nueva.
 * Devuelve una función que corta la escucha.
 *
 * @param {{onReading: (r: object) => void, onError?: (msg: string) => void}} handlers
 */
export function startOrientationCapture({ onReading, onError }) {
  if (!deviceOrientationSupported()) {
    onError?.('This device or browser has no orientation sensor available.');
    return () => {};
  }

  let samples = [];
  let referenced = false;

  function report() {
    if (samples.length < 2) {
      onReading({ ready: false, n: samples.length });
      return;
    }
    const strikes = samples.map((s) => s.strike);
    const dips = samples.map((s) => s.dip);
    const azimuths = samples.map((s) => s.dipAzimuth);
    const dipMean = dips.reduce((sum, d) => sum + d, 0) / dips.length;
    const dipSd = Math.sqrt(
      dips.reduce((sum, d) => sum + (d - dipMean) ** 2, 0) / Math.max(1, dips.length - 1),
    );
    onReading({
      ready: samples.length >= MIN_SAMPLES,
      n: samples.length,
      strike: circularMeanDeg(strikes),
      dip: dipMean,
      dipAzimuth: circularMeanDeg(azimuths),
      strikeSd: circularStdDeg(strikes),
      dipSd,
    });
  }

  function ingest(alpha, beta, gamma) {
    if (![alpha, beta, gamma].every(Number.isFinite)) return;
    const now = performance.now();
    samples.push({ t: now, ...strikeDipFromOrientation(alpha, beta, gamma) });
    samples = samples.filter((s) => now - s.t <= SAMPLE_WINDOW_MS);
    report();
  }

  /*
   * Android/Chrome entrega un `alpha` referenciado al norte en el evento
   * `deviceorientationabsolute`. Safari de iOS nunca dispara ese evento; en
   * su lugar entrega su propio rumbo de brújula, `webkitCompassHeading`, en
   * el `deviceorientation` de siempre — y ese rumbo gira al REVÉS que
   * `alpha` (crece en sentido horario en vez de antihorario), así que hay
   * que devolverlo a la convención de `alpha` antes de pasarlo por la misma
   * matriz que usa todo el mundo.
   */
  function onEvent(e) {
    const compass = e.webkitCompassHeading;
    if (compass !== undefined) {
      // -1 es el valor que da iOS cuando el compás todavía no calibró.
      if (compass < 0 || (e.webkitCompassAccuracy ?? 0) < 0) return;
      referenced = true;
      ingest(norm360(360 - compass), e.beta, e.gamma);
      return;
    }
    if (e.absolute !== true || !Number.isFinite(e.alpha)) return;
    referenced = true;
    ingest(e.alpha, e.beta, e.gamma);
  }

  window.addEventListener('deviceorientationabsolute', onEvent);
  window.addEventListener('deviceorientation', onEvent);

  // Si nada referenciado al norte llegó en un par de segundos, este teléfono
  // o este navegador no expone magnetómetro, y conviene decirlo en vez de
  // dejar la lectura pegada en "leyendo…" para siempre.
  const fallbackTimer = setTimeout(() => {
    if (!referenced) {
      onError?.(
        'No compass-referenced orientation arrived — this device may lack a magnetometer, or the browser is blocking it.',
      );
    }
  }, 2500);

  return function stop() {
    window.removeEventListener('deviceorientationabsolute', onEvent);
    window.removeEventListener('deviceorientation', onEvent);
    clearTimeout(fallbackTimer);
  };
}
