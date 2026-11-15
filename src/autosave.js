/**
 * Piezas puras del autoguardado de respaldo: el reloj que decide CUÁNDO
 * guardar y la huella que dice SI hace falta.
 *
 * El autoguardado de siempre (`persistence.saveFeatures`) escribe el dibujo
 * medio segundo después de cada cambio: es barato porque va al propio
 * navegador. El historial de versiones y la copia en Google Drive son otra
 * cosa —serializar todo el proyecto, comprimirlo y, en el caso de Drive,
 * subirlo por la red— y hacerlo a ese ritmo trabaría el lápiz y gastaría
 * datos móviles en terreno. De ahí este reloj:
 *
 * - espera a que la edición pare (`idleMs`), para no guardar a mitad de trazo;
 * - pero no más de `maxWaitMs` desde el primer cambio sin guardar, porque una
 *   sesión larga sin pausas también tiene que quedar respaldada;
 * - si el guardado falla, reintenta cada vez más espaciado;
 * - si el guardado dice que no PUEDE ahora (sin señal, sin sesión), queda
 *   pendiente sin reloj: lo despierta quien sepa que cambió eso (`flush`).
 *
 * Todo sin DOM, con temporizadores y reloj inyectables, para probarlo en Node.
 */

/**
 * Lo que puede devolver `run`:
 * - `true` (o `undefined`): guardado.
 * - `false` o una excepción: falló; se reintenta con espera creciente.
 * - `'wait'`: no se puede ahora; queda pendiente hasta un `flush()` o un
 *   `mark()` nuevo.
 */
export const WAIT = 'wait';

/**
 * @param {object} opts
 * @param {() => Promise<boolean|'wait'|void>} opts.run
 * @param {number} opts.idleMs
 * @param {number} opts.maxWaitMs
 * @param {number[]} [opts.retryMs] esperas tras cada fallo seguido
 * @param {() => number} [opts.now]
 * @param {{setTimeout: Function, clearTimeout: Function}} [opts.timers]
 */
export function createScheduler({
  run,
  idleMs,
  maxWaitMs,
  retryMs = [30e3, 60e3, 120e3, 300e3],
  now = () => Date.now(),
  timers = globalThis,
}) {
  let dirty = false;
  let firstDirtyAt = null;
  let timer = null;
  let running = null;
  let failures = 0;

  const clear = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const at = (ms) => {
    clear();
    timer = timers.setTimeout(() => {
      timer = null;
      fire();
    }, Math.max(0, ms));
  };

  function schedule() {
    if (!dirty || running) return;
    const t = now();
    const idle = t + idleMs;
    const tope = (firstDirtyAt ?? t) + maxWaitMs;
    at(Math.min(idle, tope) - t);
  }

  function fire() {
    if (running) return running;
    if (!dirty) return Promise.resolve(true);
    clear();
    dirty = false;
    const desde = firstDirtyAt;
    firstDirtyAt = null;
    running = (async () => {
      let r;
      try {
        r = await run();
      } catch (err) {
        console.warn('[autosave]', err);
        r = false;
      }
      running = null;
      if (r === WAIT) {
        // Lo pendiente sigue pendiente, sin reloj.
        dirty = true;
        firstDirtyAt = firstDirtyAt ?? desde;
        failures = 0;
        return r;
      }
      if (r === false) {
        dirty = true;
        firstDirtyAt = firstDirtyAt ?? desde;
        at(retryMs[Math.min(failures, retryMs.length - 1)]);
        failures++;
        return r;
      }
      failures = 0;
      // Lo que cambió mientras se guardaba: a su propio ritmo.
      schedule();
      return true;
    })();
    return running;
  }

  return {
    /** Hubo un cambio que habrá que guardar. */
    mark() {
      if (!dirty) firstDirtyAt = now();
      dirty = true;
      // Tras un fallo, el reintento ya tiene su reloj: un cambio nuevo no lo adelanta.
      if (failures === 0) schedule();
    },
    /** Guarda ya lo pendiente (si hay). Devuelve la promesa del guardado. */
    flush() {
      if (running) return running.then(() => (dirty ? fire() : true));
      return fire();
    },
    /** Olvida lo pendiente (p. ej. al cambiar de proyecto ya respaldado). */
    cancel() {
      clear();
      dirty = false;
      firstDirtyAt = null;
      failures = 0;
    },
    get pending() {
      return dirty;
    },
    get busy() {
      return !!running;
    },
  };
}

/**
 * Huella de 53 bits de un texto (cyrb53), en hexadecimal.
 *
 * No es criptográfica ni hace falta: solo responde «¿cambió algo desde la
 * última copia?», para no guardar ni subir dos veces lo mismo. Es síncrona y
 * recorre unos 7 MB en pocas decenas de ms, a diferencia de `crypto.subtle`,
 * que además exige contexto seguro.
 */
export function contentHash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
