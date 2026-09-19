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
 *
 * ---
 *
 * TRES COSAS QUE HACÍAN SALTAR LA LECTURA EN UNA SUPERFICIE SUBVERTICAL, que
 * es justo donde más se usa esto (un plano de falla, una diaclasa, un banco
 * de pie). Las tres están resueltas aquí abajo y cada una tiene su nota:
 *
 * 1. **La normal se iba al hemisferio de abajo.** Si el dorso del teléfono
 *    pasaba un pelo de la vertical —lo que ocurre a cada momento apoyándolo
 *    contra una pared, o midiendo el techo de un volado— la normal apuntaba
 *    hacia abajo, el manteo salía mayor de 90° y se recortaba a 90 dejando la
 *    dirección apuntando al lado contrario. Dos lecturas de la MISMA
 *    superficie daban rumbos separados 180°. Ver `strikeDipFromNormal`.
 *
 * 2. **El promedio se hacía sobre ángulos y no sobre vectores.** Con el punto
 *    1 vivo, promediar rumbos de 0° y 180° da cualquier cosa; y aunque no lo
 *    estuviera, promediar rumbo y manteo por separado no es promediar
 *    orientaciones. Ahora se promedian las NORMALES como ejes, con rechazo de
 *    atípicos. Ver `meanNormal`.
 *
 * 3. **En iOS el rumbo de la brújula se traducía mal justo en esa postura.**
 *    `webkitCompassHeading` es el acimut del eje +Y del teléfono (su lado
 *    superior), y la equivalencia con el `alpha` del estándar CAMBIA DE SIGNO
 *    al pasar el teléfono de tumbado a boca abajo, además de quedar indefinida
 *    cuando ese eje apunta al cielo — que es exactamente cómo queda el
 *    teléfono apoyado en vertical contra una pared. Ver `alphaFromHeading` y
 *    el anclaje de norte en `startOrientationCapture`.
 */

import { norm360 } from './structure.js';

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

/* ---------- la normal, que es el dato físico ---------- */

/**
 * Eje +Z del teléfono —el que sale de la pantalla— expresado en el marco
 * terrestre (Este, Norte, Arriba), a partir del trío `alpha`/`beta`/`gamma`.
 *
 * Son los tres ángulos de Euler intrínsecos Z-X'-Y'' del estándar W3C de
 * orientación de dispositivo. La matriz de rotación que definen manda la base
 * del teléfono al marco terrestre; su tercera columna es ese eje +Z, que en la
 * postura de esta medida es la normal de la superficie.
 *
 * Se devuelve el VECTOR y no ya el rumbo y el manteo porque todo lo que viene
 * después —promediar, rotar por la corrección de norte, medir dispersión— es
 * álgebra de vectores, y pasar por ángulos en medio es justo lo que introduce
 * saltos de 180° y singularidades donde el vector no tiene ninguna.
 */
export function normalFromOrientation(alpha, beta, gamma) {
  const a = alpha * RAD;
  const b = beta * RAD;
  const g = gamma * RAD;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);

  return {
    x: ca * sg + cg * sa * sb, // Este
    y: sa * sg - ca * cg * sb, // Norte
    z: cb * cg, // Arriba
  };
}

/**
 * Rumbo (regla de la mano derecha), manteo y acimut de manteo del plano cuya
 * normal es `n`.
 *
 * **La normal se lleva SIEMPRE al hemisferio de arriba.** Un plano y su
 * reflejo definen la misma superficie: lo que distingue "esta pared mantea 89°
 * al Este" de "mantea 89° al Oeste" es hacia dónde se inclina, no hacia qué
 * lado mira el teléfono. Apoyando el dorso contra una pared subvertical, o
 * contra el techo de un volado, la normal sale apuntando hacia abajo; sin este
 * paso el manteo salía de 91° y se recortaba a 90 conservando la dirección
 * equivocada, y la misma pared medida dos veces daba rumbos separados 180°.
 * Con la normal hacia arriba el manteo cae por construcción en [0°, 90°] y la
 * dirección es única.
 *
 * Con la normal (nx, ny, nz) el manteo es el ángulo con la vertical y el
 * acimut de manteo sale de su componente horizontal exactamente como en
 * `strikeDipFromGradient`: ahí la normal ascendente de un plano ajustado es
 * proporcional a (−a, −b, 1), y su parte horizontal ya apunta en la
 * dirección de manteo, sin necesidad de invertirla.
 */
export function strikeDipFromNormal(n) {
  const largo = Math.hypot(n.x, n.y, n.z);
  if (!(largo > 0)) return { strike: 0, dip: 0, dipAzimuth: 0 };
  // Hacia arriba, y unitaria.
  const s = n.z < 0 ? -1 / largo : 1 / largo;
  const nx = n.x * s;
  const ny = n.y * s;
  const nz = n.z * s;

  const dip = Math.acos(Math.min(1, Math.max(-1, nz))) * DEG;
  const horiz = Math.hypot(nx, ny);
  const dipAzimuth = horiz < 1e-9 ? 0 : norm360(Math.atan2(nx, ny) * DEG);
  return { strike: norm360(dipAzimuth - 90), dip, dipAzimuth };
}

/** Rumbo y manteo directamente del trío del evento. Ver las dos de arriba. */
export function strikeDipFromOrientation(alpha, beta, gamma) {
  return strikeDipFromNormal(normalFromOrientation(alpha, beta, gamma));
}

/**
 * Gira un vector del marco terrestre `grados` alrededor de la vertical.
 *
 * Es la corrección de norte de iOS aplicada donde no puede hacer daño: sumar
 * el desfase a `alpha` y recomponer la matriz falla justo en la postura
 * vertical, donde `alpha` y `gamma` se vuelven indistinguibles (bloqueo de
 * cardán) y cada uno salta por su cuenta aunque la orientación real no se
 * mueva. El vector, en cambio, no tiene ahí ninguna singularidad.
 *
 * `R(alpha + d) = Rz(d) · R(alpha)`, así que rotar la normal por `Rz(d)` es
 * exactamente lo mismo que haber leído `alpha + d`, pero sin pasar por ángulos.
 */
export function rotateYaw(n, grados) {
  const r = grados * RAD;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: n.x * c - n.y * s, y: n.x * s + n.y * c, z: n.z };
}

/**
 * Cuánto tiene que valer |cos β| para fiarse del rumbo de la brújula de iOS.
 * 0.34 son unos 20° de margen respecto de la postura ciega: por debajo, el
 * acimut del eje +Y se apoya en una proyección horizontal tan corta que un
 * grado de ruido del magnetómetro se convierte en varios de rumbo.
 */
const HEADING_MIN_COS_BETA = 0.34;

/**
 * El `alpha` del estándar que corresponde a un rumbo de brújula de iOS.
 *
 * `webkitCompassHeading` es el acimut del eje +Y del teléfono —su lado
 * superior—. En el marco terrestre ese eje es la segunda columna de la matriz
 * Z-X'-Y'': (−sinα·cosβ, cosα·cosβ, sinβ). Su acimut vale entonces:
 *
 * - `−α` mientras `cosβ > 0` (pantalla hacia arriba), de donde sale la
 *   conversión de toda la vida, `α = 360 − rumbo`;
 * - `180 − α` cuando `cosβ < 0` (el teléfono ha pasado de la vertical y mira
 *   hacia abajo), que es OTRA fórmula: usar la primera ahí deja el rumbo
 *   equivocado en 180°.
 *
 * Y cuando `cosβ ≈ 0` el eje +Y apunta al cielo: su acimut no existe, y el
 * rumbo que entrega el sistema es ruido. Esa es, literalmente, la postura de
 * apoyar el teléfono en vertical contra una pared con la parte de arriba
 * mirando al cielo — de ahí el anclaje de norte de `startOrientationCapture`.
 *
 * Devuelve `null` en esa zona ciega en vez de un número inventado.
 */
export function alphaFromHeading(heading, beta) {
  const cb = Math.cos(beta * RAD);
  if (Math.abs(cb) < HEADING_MIN_COS_BETA) return null;
  return cb > 0 ? norm360(360 - heading) : norm360(180 - heading);
}

/* ---------- promedio de orientaciones ---------- */

/**
 * Normal media de una tanda de lecturas, tratadas como EJES y no como flechas.
 *
 * Dos muestras de la misma superficie subvertical pueden salir con la normal
 * apuntando a lados opuestos (ver `strikeDipFromNormal`): sumarlas sin más las
 * cancelaría. Se alinean por signo contra una referencia y se itera un par de
 * veces, que es la versión barata del vector propio principal del tensor de
 * orientación — con la dispersión de segundos que tiene una lectura apoyada,
 * las dos coinciden hasta la centésima de grado.
 *
 * Devuelve la media UNITARIA, o `null` si no hay nada que promediar.
 */
export function meanNormal(normales) {
  if (!normales.length) return null;
  let ref = normales[0];
  for (let pasada = 0; pasada < 3; pasada++) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const n of normales) {
      const signo = n.x * ref.x + n.y * ref.y + n.z * ref.z < 0 ? -1 : 1;
      sx += signo * n.x;
      sy += signo * n.y;
      sz += signo * n.z;
    }
    const largo = Math.hypot(sx, sy, sz);
    if (!(largo > 1e-12)) return null;
    ref = { x: sx / largo, y: sy / largo, z: sz / largo };
  }
  return ref;
}

/** Ángulo en grados entre dos direcciones, tomadas como ejes (0°–90°). */
function angleBetween(a, b) {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z);
  return Math.acos(Math.min(1, d)) * DEG;
}

/**
 * Dispersión de la tanda, repartida en las dos direcciones que se reportan.
 *
 * No se calcula la desviación de los rumbos por un lado y la de los manteos
 * por otro: el rumbo de una superficie casi horizontal está mal definido por
 * geometría, no por ruido, y una desviación de rumbos no sabe distinguir las
 * dos cosas. Lo que se hace es proyectar la desviación de cada normal sobre
 * las dos direcciones en que mover el polo cambia una cosa u otra:
 *
 * - a lo largo del meridiano del polo (∂n/∂θ) cambia el MANTEO, grado por grado;
 * - perpendicular a él (∂n/∂φ) cambia la DIRECCIÓN, y ahí una misma desviación
 *   del polo vale `1/sin(manteo)` grados de rumbo — por eso un plano tumbado
 *   tiene el rumbo mal definido aunque el teléfono no se haya movido, y por
 *   eso conviene que la cifra lo DIGA en vez de esconderlo.
 */
export function orientationSpread(normales, media) {
  const n = normales.length;
  if (n < 2 || !media) return { spread: NaN, strikeSd: NaN, dipSd: NaN };

  const theta = Math.acos(Math.min(1, Math.max(-1, media.z))); // = manteo, en radianes
  const phi = Math.atan2(media.x, media.y);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const uTheta = { x: ct * sp, y: ct * cp, z: -st };
  const uPhi = { x: cp, y: -sp, z: 0 };

  let sumTheta = 0;
  let sumPhi = 0;
  let sumAng = 0;
  for (const raw of normales) {
    const signo = raw.x * media.x + raw.y * media.y + raw.z * media.z < 0 ? -1 : 1;
    const s = { x: signo * raw.x, y: signo * raw.y, z: signo * raw.z };
    const dx = s.x - media.x;
    const dy = s.y - media.y;
    const dz = s.z - media.z;
    const dTheta = dx * uTheta.x + dy * uTheta.y + dz * uTheta.z;
    const dPhi = dx * uPhi.x + dy * uPhi.y + dz * uPhi.z;
    sumTheta += dTheta * dTheta;
    sumPhi += dPhi * dPhi;
    sumAng += angleBetween(s, media) ** 2;
  }
  const dipSd = Math.sqrt(sumTheta / (n - 1)) * DEG;
  // Al dividir por sin(manteo) la cifra crece sin techo hacia el plano
  // horizontal, donde el rumbo de verdad no existe. 180° es el tope con
  // sentido: más allá ya no informa de nada.
  const strikeSd = st < 1e-6 ? 180 : Math.min(180, (Math.sqrt(sumPhi / (n - 1)) * DEG) / st);
  return { spread: Math.sqrt(sumAng / n), strikeSd, dipSd };
}

/* ---------- la captura en vivo ---------- */

/**
 * Cuánto se guarda de la ventana móvil de muestras, en milisegundos.
 *
 * ESTE NÚMERO ES LITERALMENTE CUÁNTO HAY QUE AGUANTAR QUIETO. La dispersión
 * que decide si la lectura está lista (`READY_SPREAD_DEG`) se mide sobre
 * TODA la ventana, así que una sola muestra ruidosa de hace 1,9 s —el
 * teléfono todavía acomodándose contra la roca— mantiene la tanda "no lista"
 * hasta que esa muestra vieja se cae de la ventana, sea cual sea la
 * frecuencia del sensor. Con el teléfono ya quieto, el sensor entrega de
 * sobra las `MIN_SAMPLES` que hacen falta en una fracción de la ventana —a
 * 60 Hz, en menos de 20 ms— así que el número de muestras casi nunca es el
 * cuello de botella real: lo es el LARGO de la ventana.
 *
 * Bajarlo de los 2000 ms de antes a 1000 no afloja el umbral de dispersión
 * —sigue exigiendo los mismos 4°, así que no se acepta como buena una
 * lectura más ruidosa— y a cambio corta a la mitad cuánto hay que sostener el
 * teléfono. El costo real, y conviene decirlo, es que una ventana más corta
 * es algo más fácil de engañar con una pausa breve a media sacudida: con
 * 2 s, una pausa de medio segundo en medio de un ajuste no alcanza a
 * "limpiar" la ventana de las muestras ruidosas de alrededor; con 1 s, sí
 * podría. Sigue siendo mucho más lento de lo que se tarda en asentar
 * físicamente un teléfono contra una roca, así que no debería notarse en la
 * práctica.
 */
const SAMPLE_WINDOW_MS = 1000;
/**
 * Bajo esta cantidad de muestras la lectura se enseña pero no se ofrece para
 * anotar. No es lo que fija cuánto tarda —ver la nota de `SAMPLE_WINDOW_MS`—
 * sino un piso de seguridad para el sensor más lento: un teléfono viejo o con
 * el sistema en ahorro de energía puede entregar bastante menos de 60
 * muestras por segundo, y sin este mínimo una tanda de dos o tres muestras
 * "por casualidad" parecidas podría darse por lista sin serlo de verdad.
 */
const MIN_SAMPLES = 8;
/**
 * Dispersión máxima del polo, en grados, para dar la lectura por buena.
 *
 * Un teléfono apoyado de verdad contra la roca se queda en menos de 1°; entre
 * 1° y 4° suele ser la mano todavía acomodándolo. Por encima no es una medida,
 * es el teléfono en movimiento, y anotarla como dato sería inventarse una
 * precisión que la propia tanda está diciendo que no tiene.
 */
export const READY_SPREAD_DEG = 4;
/** Recorte de atípicos: se descarta lo que se aparte más de esto de la media. */
const TRIM_FACTOR = 2.5;
const TRIM_FLOOR_DEG = 1.5;
/** A partir de aquí el norte anclado ya tiene edad como para avisar. */
export const HEADING_STALE_MS = 45000;

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

  /** Muestras vivas de la ventana: `{t, n}` con `n` la normal ya referenciada. */
  let samples = [];
  let referenced = false;
  /*
   * ANCLAJE DE NORTE (solo iOS).
   *
   * En iOS el `alpha` del evento es relativo a un origen arbitrario, y el
   * norte lo da aparte `webkitCompassHeading` — que deja de existir justo en
   * la postura de medir una pared (ver `alphaFromHeading`). En vez de
   * rendirse ahí, se guarda el DESFASE entre los dos mientras la postura sí
   * lo permite y se sigue aplicando cuando ya no. El giroscopio mantiene la
   * referencia perfectamente durante los segundos que van de nivelar el
   * teléfono a apoyarlo contra la roca; de la edad del anclaje informa la
   * propia lectura, para que la interfaz pueda pedir que se renueve.
   */
  let yawOffset = null;
  let yawOffsetAt = 0;

  function report(extra = {}) {
    if (samples.length < 2) {
      onReading({ ready: false, n: samples.length, ...extra });
      return;
    }
    let normales = samples.map((s) => s.n);
    let media = meanNormal(normales);
    if (media) {
      /*
       * Un pico del magnetómetro —un clavo, la hebilla del cinturón, el imán
       * de la funda— mete una muestra disparatada en medio de una tanda por
       * lo demás quieta. Se recortan las que se apartan de la media mucho más
       * que el resto y se vuelve a promediar, siempre que quede la mayoría:
       * si se cae más de un tercio de la tanda, lo que pasa no es que haya
       * atípicos, es que el teléfono se está moviendo, y eso lo tiene que ver
       * la dispersión, no taparlo el recorte.
       */
      const angulos = normales.map((n) => angleBetween(n, media));
      const rms = Math.sqrt(angulos.reduce((s, a) => s + a * a, 0) / angulos.length);
      const corte = Math.max(TRIM_FACTOR * rms, TRIM_FLOOR_DEG);
      const limpias = normales.filter((_, i) => angulos[i] <= corte);
      if (limpias.length >= Math.max(2, Math.ceil(normales.length * 0.66))) {
        normales = limpias;
        media = meanNormal(normales) || media;
      }
    }
    if (!media) {
      onReading({ ready: false, n: samples.length, ...extra });
      return;
    }

    const { strike, dip, dipAzimuth } = strikeDipFromNormal(media);
    // `strikeDipFromNormal` ya la llevó al hemisferio de arriba; la dispersión
    // tiene que medirse contra ESA, o el signo de cada muestra se alinearía
    // contra una media que apunta al revés que el resultado que se reporta.
    const arriba = media.z < 0 ? { x: -media.x, y: -media.y, z: -media.z } : media;
    const { spread, strikeSd, dipSd } = orientationSpread(normales, arriba);

    onReading({
      ready: samples.length >= MIN_SAMPLES && spread <= READY_SPREAD_DEG,
      n: samples.length,
      strike,
      dip,
      dipAzimuth,
      spread,
      strikeSd,
      dipSd,
      ...extra,
    });
  }

  function ingest(normal, now) {
    samples.push({ t: now, n: normal });
    samples = samples.filter((s) => now - s.t <= SAMPLE_WINDOW_MS);
  }

  /*
   * Android/Chrome entrega un `alpha` ya referenciado al norte en el evento
   * `deviceorientationabsolute`, así que su normal sale directa. iOS nunca
   * dispara ese evento y necesita el anclaje descrito más arriba.
   */
  function onEvent(e) {
    const { beta, gamma } = e;
    if (![beta, gamma].every(Number.isFinite)) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const heading = e.webkitCompassHeading;

    if (heading !== undefined) {
      const alphaRel = Number.isFinite(e.alpha) ? e.alpha : 0;
      // -1 es el valor que da iOS cuando el compás todavía no calibró.
      const valido = heading >= 0 && (e.webkitCompassAccuracy ?? 0) >= 0;
      const alphaAbs = valido ? alphaFromHeading(heading, beta) : null;
      if (alphaAbs !== null) {
        yawOffset = norm360(alphaAbs - alphaRel);
        yawOffsetAt = now;
      }
      if (yawOffset === null) {
        // Nunca hubo una postura desde la que fijar el norte: no se inventa.
        samples = [];
        report({
          needsHeading: true,
          headingHeld: false,
        });
        return;
      }
      referenced = true;
      ingest(rotateYaw(normalFromOrientation(alphaRel, beta, gamma), yawOffset), now);
      report({
        headingHeld: alphaAbs === null,
        headingAge: alphaAbs === null ? now - yawOffsetAt : 0,
        headingStale: alphaAbs === null && now - yawOffsetAt > HEADING_STALE_MS,
      });
      return;
    }

    if (e.absolute !== true || !Number.isFinite(e.alpha)) return;
    referenced = true;
    ingest(normalFromOrientation(e.alpha, beta, gamma), now);
    report();
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

/* ---------- brújula simple, de referencia ---------- */

/**
 * Arranca una lectura de brújula simple: solo `heading`, el ángulo desde el
 * norte al que apunta el teléfono (0°–360°, creciendo hacia el Este), sin el
 * resto del aparato de `startOrientationCapture` de aquí arriba —promedio de
 * normales, dispersión, anclaje de norte en iOS para la postura vertical—,
 * que existe para medir el manteo de una superficie con el teléfono apoyado
 * contra ella. Esto es una brújula de referencia: se sostiene como una
 * brújula de verdad, a ras, y no contra una roca, así que esa postura
 * vertical que motiva todo lo demás no se da aquí.
 *
 * `heading` es el rumbo del lado superior del teléfono —el mismo eje que
 * `alphaFromHeading` usa para iOS, y el que se sigue con la parte delantera
 * del teléfono apuntando hacia donde se quiere leer, como con cualquier
 * brújula de mano—, y en Android sale de la misma fórmula `360 − alpha` con
 * el `alpha` ya referenciado al norte que trae el evento
 * `deviceorientationabsolute`.
 *
 * **Suavizado, para que marque robusta Y rápidamente a la vez.** El
 * magnetómetro solo, sin filtrar, tiembla varios grados de una muestra a la
 * siguiente —un volantazo de la aguja que no es cómo se lee una brújula de
 * verdad—, así que cada lectura se promedia con las anteriores por una media
 * móvil exponencial sobre el CÍRCULO (el seno y el coseno del ángulo, no el
 * ángulo mismo): promediar ángulos sin más rompe justo al cruzar 0°/360°, que
 * es tan buen rumbo como cualquier otro. Con el sensor entregando decenas de
 * muestras por segundo, el peso elegido converge en unas pocas décimas de
 * segundo — se nota firme sin notarse lenta.
 *
 * @param {{onReading: (r: {heading: number}) => void, onError?: (msg: string) => void}} handlers
 */
export function startHeadingCapture({ onReading, onError }) {
  if (!deviceOrientationSupported()) {
    onError?.('This device or browser has no orientation sensor available.');
    return () => {};
  }

  let referenced = false;
  /** Media móvil exponencial del rumbo, como un vector unitario (x=cos, y=sin). */
  let suave = null;
  const PESO = 0.3;

  function suavizar(heading) {
    const rad = (heading * Math.PI) / 180;
    const x = Math.cos(rad);
    const y = Math.sin(rad);
    if (!suave) {
      suave = { x, y };
    } else {
      suave = { x: suave.x + PESO * (x - suave.x), y: suave.y + PESO * (y - suave.y) };
    }
    return norm360((Math.atan2(suave.y, suave.x) * 180) / Math.PI);
  }

  function onEvent(e) {
    const heading = e.webkitCompassHeading;
    if (heading !== undefined) {
      // -1 es el valor que da iOS cuando el compás todavía no calibró.
      if (heading < 0 || (e.webkitCompassAccuracy ?? 0) < 0) return;
      referenced = true;
      onReading({ heading: suavizar(norm360(heading)) });
      return;
    }
    if (e.absolute !== true || !Number.isFinite(e.alpha)) return;
    referenced = true;
    onReading({ heading: suavizar(norm360(360 - e.alpha)) });
  }

  window.addEventListener('deviceorientationabsolute', onEvent);
  window.addEventListener('deviceorientation', onEvent);

  // Igual que en `startOrientationCapture`: si nada referenciado al norte
  // llegó en un par de segundos, este teléfono o este navegador no expone
  // magnetómetro, y conviene decirlo en vez de dejar la lectura pegada en
  // "leyendo…" para siempre.
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
