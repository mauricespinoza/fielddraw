const LONG_PRESS_MS = 320;
const MOVE_THRESHOLD = 10; // px antes de considerar que hubo arrastre
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_DIST = 26; // px

/*
 * Toques del dedo que NO dibujan (porque el Pencil es el que dibuja) pero que
 * seleccionan o cierran el elemento.
 *
 * Los umbrales son generosos a propósito. Con el mapa renderizando, el hilo
 * principal se satura y el `pointerup` puede entregarse cientos de ms después
 * del `pointerdown` aunque el dedo haya estado abajo un instante: medido, un
 * toque "instantáneo" llegó a reportar 690 ms. Un umbral de 400 ms descartaba
 * toques perfectamente válidos.
 */
const FINGER_TAP_MS = 900;
const FINGER_TAP_MOVE = 14; // px
const FINGER_DOUBLE_TAP_MS = 500;
const FINGER_DOUBLE_TAP_DIST = 48; // px

/** Pulsación sostenida sobre la selección: abre el menú de propiedades. */
const LONG_PRESS_HOLD_MS = 1000;

/*
 * Cuánto puede correrse el botón derecho y seguir contando como clic.
 *
 * Mucho más que los 10 px del arrastre normal, y a propósito. Lo que hay al
 * otro lado del umbral es girar la vista con el botón derecho, que es un gesto
 * largo y deliberado: nadie gira un mapa moviendo veinte píxeles. Un clic, en
 * cambio, se corre solo — un ratón sensible en una pantalla 4K recorre más de
 * diez píxeles mientras se aprieta el botón, y con el listón bajo el menú se
 * tragaba sin decir nada y parecía que el clic derecho fallara al azar.
 */
const SECONDARY_MOVE = 26; // px

// Toques con varios dedos (deshacer / rehacer). Mismo motivo que arriba para
// que los márgenes sean amplios.
const MULTI_TAP_MAX_MS = 1000;
const MULTI_TAP_MOVE = 16; // px
const MULTI_DOUBLE_MS = 1200;

const SWALLOWED = [
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'mousedown',
  'mousemove',
  'mouseup',
  'click',
  'dblclick',
  // `mouseover` y `mouseout` no los usa nadie aquí, pero cuestan lo mismo que
  // un `mousemove` con el relieve puesto: ver `swallow`.
  'mouseover',
  'mouseout',
];

/**
 * ¿Este puntero trae pulsado el botón secundario?
 *
 * El dedo nunca: en una tablet el equivalente es la pulsación sostenida. El
 * botón lateral del lápiz sí, que es como se abre el menú sin soltarlo.
 */
function esSecundario(e) {
  if (e.pointerType === 'touch') return false;
  if (e.button === 2) return true;
  return e.button !== 0 && typeof e.buttons === 'number' && (e.buttons & 2) === 2;
}

/** Los que le cuestan a MapLibre una lectura de GPU y a nosotros no dan nada. */
const HOVER_EVENTS = new Set(['mousemove', 'mouseover', 'mouseout']);

/**
 * Traduce eventos de puntero a acciones de digitalización.
 *
 * Dos detalles no obvios que gobiernan todo el diseño:
 *
 * 1. MapLibre NO usa Pointer Events: escucha `touchstart`/`mousedown`. Anular
 *    un `pointerdown` no impide que el mapa haga pan. Por eso hay un segundo
 *    juego de listeners ("swallow") en fase de captura sobre un ancestro, que
 *    detiene la propagación de touch/mouse mientras estamos dibujando.
 *
 * 2. Con Apple Pencil presente, el lápiz SIEMPRE dibuja y los dedos SIEMPRE
 *    navegan. Eso elimina el cambio de modo y da rechazo de palma gratis: la
 *    palma genera eventos `touch`, que en ese caso nunca dibujan.
 */
export class DrawController {
  /**
   * @param {EventTarget} host       elemento sobre el que se dibuja
   * @param {object} mapContainer    contenedor del mapa, para las coordenadas
   * @param {object} callbacks       acciones que emite el controlador
   * @param {Window} [root]          dónde se escucha el fin de un gesto; ver
   *   `attach`. Se inyecta para poder probarlo fuera de un navegador.
   */
  constructor(host, mapContainer, callbacks, root = typeof window === 'undefined' ? null : window) {
    this.host = host;
    this.mapContainer = mapContainer;
    this.cb = callbacks;
    this.root = root;
    this.doc = root && root.document ? root.document : null;

    this.penSeen = false;
    /** pointerId -> pointerType de todo lo que está tocando la pantalla. */
    this.pointers = new Map();
    this.gesture = null;
    this.consuming = false;
    this.longPressTimer = null;
    this.lastTap = null;
    this.lastFingerTap = null;
    /** Toques de dedo que no consumimos, pero que observamos para cerrar. */
    this.observed = new Map();
    /** Gesto multitáctil en curso y último toque multitáctil completado. */
    this.multi = null;
    this.touchStarts = new Map();
    this.lastMultiTap = null;
    /** Temporizadores de pulsación sostenida de los toques observados. */
    this.observedTimers = new Map();
    this.rect = null;
    this.rafPending = false;
    /** Dónde bajó el último puntero y si se movió: clic contra arrastre. */
    this.lastDown = null;
    /** Clic con el botón secundario en curso; ver `onContextMenu`. */
    this.secondary = null;
    /** Temporizador del botón PRIMARIO sostenido; ver `armPrimaryLongPress`. */
    this.primaryHoldTimer = null;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onWindowBlur = this.onWindowBlur.bind(this);
    this.swallow = this.swallow.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);

    this.attach();
  }

  /**
   * `pointerup` y `pointercancel` van en la VENTANA, no en el host.
   *
   * Es la corrección de un cuelgue real, no una precaución. Mientras
   * `consuming` está puesta, `swallow` detiene todos los eventos de
   * touch/mouse del mapa; la bandera solo se levanta al recibir el `pointerup`
   * del gesto. Colgado del host, ese evento se pierde en cuanto el dedo o el
   * lápiz se levantan fuera de él —soltar sobre un panel que acaba de abrirse,
   * salirse por el borde de la pantalla, o que `setPointerCapture` haya sido
   * rechazado— y entonces la bandera se queda puesta PARA SIEMPRE: el mapa deja
   * de responder al tacto y al ratón, y solo recargando vuelve.
   *
   * En la ventana el evento llega siempre, se suelte donde se suelte.
   */
  attach() {
    const opts = { capture: true, passive: false };
    this.host.addEventListener('pointerdown', this.onPointerDown, opts);
    this.host.addEventListener('pointermove', this.onPointerMove, opts);
    this.host.addEventListener('pointerleave', this.onPointerLeave, opts);
    this.host.addEventListener('contextmenu', this.onContextMenu, opts);
    // Sin ventana —en las pruebas— se cae al host, que es lo que había antes.
    const fin = this.root || this.host;
    fin.addEventListener('pointerup', this.onPointerUp, opts);
    fin.addEventListener('pointercancel', this.onPointerCancel, opts);
    // Cambiar de app o de pestaña con el dedo apoyado no genera `pointerup`.
    if (this.root) this.root.addEventListener('blur', this.onWindowBlur);
    if (this.doc) this.doc.addEventListener('visibilitychange', this.onWindowBlur);
    for (const type of SWALLOWED) this.host.addEventListener(type, this.swallow, opts);
  }

  destroy() {
    const opts = { capture: true };
    this.host.removeEventListener('pointerdown', this.onPointerDown, opts);
    this.host.removeEventListener('pointermove', this.onPointerMove, opts);
    this.host.removeEventListener('pointerleave', this.onPointerLeave, opts);
    this.host.removeEventListener('contextmenu', this.onContextMenu, opts);
    const fin = this.root || this.host;
    fin.removeEventListener('pointerup', this.onPointerUp, opts);
    fin.removeEventListener('pointercancel', this.onPointerCancel, opts);
    if (this.root) this.root.removeEventListener('blur', this.onWindowBlur);
    if (this.doc) this.doc.removeEventListener('visibilitychange', this.onWindowBlur);
    for (const type of SWALLOWED) this.host.removeEventListener(type, this.swallow, opts);
    this.clearLongPress();
    this.clearObserved();
  }

  /**
   * Se pierde el foco con dedos apoyados: no habrá `pointerup` para ellos.
   * Se da todo por soltado, que es lo que de verdad ocurrió.
   */
  onWindowBlur() {
    const d = this.doc;
    if (d && d.visibilityState === 'visible' && d.hasFocus && d.hasFocus()) return;
    // Un trazo en curso NO se aborta aquí: perder lo dibujado porque el foco se
    // fue a la barra del navegador sería peor que el problema. Su `pointerup`
    // en la ventana todavía puede llegar, y si no llega, el purgado de
    // `isPrimary` del siguiente toque lo recoge. Lo que se limpia es el rastro
    // de los punteros que ya no están.
    if (this.gesture) return;
    this.resetPointers();
  }

  /**
   * Estado de punteros a cero. Es la red de seguridad de todo lo anterior: sin
   * ella, un puntero fantasma en `this.pointers` hace que `touchCount()` nunca
   * baje de uno, y a partir de ahí CADA toque de un dedo se toma por el segundo
   * de un gesto de navegación — el dedo deja de seleccionar, de cerrar el
   * elemento y de abrir el menú, sin que nada lo anuncie.
   */
  resetPointers() {
    this.pointers.clear();
    this.touchStarts.clear();
    this.secondary = null;
    this.clearPrimaryHold();
    this.multi = null;
    this.clearObserved();
    if (this.gesture) this.abort();
    else this.consuming = false;
  }

  toLocal(e) {
    const r = this.rect || this.mapContainer.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  clearLongPress() {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /**
   * Pulsación sostenida de un dedo que NO estamos consumiendo. Es el gesto que
   * abre el menú de propiedades mientras el Pencil dibuja, y el único camino
   * al menú en las herramientas donde el dedo no arrastra nada.
   */
  armFingerLongPress(pointerId, obs) {
    if (!this.cb.onLongPress) return;
    const timer = setTimeout(() => {
      this.observedTimers.delete(pointerId);
      if (this.observed.get(pointerId) !== obs || obs.moved || !obs.solo) return;
      obs.longPressed = true;
      this.cb.onLongPress([obs.x, obs.y]);
    }, LONG_PRESS_HOLD_MS);
    this.observedTimers.set(pointerId, timer);
  }

  /**
   * MANTENER PULSADO EL BOTÓN PRIMARIO TAMBIÉN ABRE EL MENÚ.
   *
   * Es la misma puerta que la pulsación sostenida del dedo, pero con el ratón
   * o el lápiz, y existe como REDUNDANCIA del clic derecho: si un navegador,
   * un trackpad o una configuración rara se comen el botón secundario, queda
   * este camino, que no depende de ningún evento del sistema —solo de que el
   * puntero siga abajo y quieto un segundo.
   *
   * No se arma en todas partes, para no pisar gestos que ya existen:
   *
   * - En **Nodos** el arrastre ya tiene su propio sostenido, del mismo
   *   segundo, montado sobre el gesto (ver `onPointerDown`).
   * - Con el **trazo libre por sostenido** el hold de 320 ms arranca antes; si
   *   llega a arrancar, `beginFreehand` cancela este temporizador, porque a
   *   partir de ahí lo que se está haciendo es dibujar.
   *
   * El dedo no entra: ya tiene `armFingerLongPress`, con sus propios umbrales.
   */
  armPrimaryLongPress(p) {
    this.clearPrimaryHold();
    if (!this.cb.onLongPress) return;
    this.primaryHoldTimer = setTimeout(() => {
      this.primaryHoldTimer = null;
      // Se movió: era un arrastre —desplazar el mapa, trazar— y no una
      // consulta. `lastDown` lo sabe porque se anota en cada `pointermove`.
      if (!this.lastDown || this.lastDown.moved) return;
      this.lastDown.longPressed = true;
      if (this.gesture) this.gesture.longPressed = true;
      this.cb.onLongPress(p);
    }, LONG_PRESS_HOLD_MS);
  }

  clearPrimaryHold() {
    if (this.primaryHoldTimer !== null) {
      clearTimeout(this.primaryHoldTimer);
      this.primaryHoldTimer = null;
    }
  }

  clearFingerLongPress(pointerId) {
    const timer = this.observedTimers.get(pointerId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.observedTimers.delete(pointerId);
    }
  }

  clearObserved() {
    for (const timer of this.observedTimers.values()) clearTimeout(timer);
    this.observedTimers.clear();
    this.observed.clear();
  }

  /** Dedos en la pantalla, sin contar el lápiz ni el mouse. */
  touchCount() {
    let n = 0;
    for (const type of this.pointers.values()) if (type === 'touch') n++;
    return n;
  }

  /**
   * ¿Este `pointerdown` es para la cámara y no para el dibujo?
   *
   * El botón central desplaza, como en QGIS. El derecho no entra: ya cierra el
   * elemento y abre el menú.
   *
   * **Shift+arrastrar ya no gira ni bascula.** Giraba, con los mismos grados
   * por píxel que MapLibre, hasta que Shift pasó a ser el modificador de
   * selección múltiple: no puede significar dos cosas a la vez, y de las dos
   * la selección es la que se usa cien veces por sesión. Para mover la cámara
   * sin soltar la herramienta quedan `Shift`+flechas —girar y bascular— y las
   * flechas solas para desplazar, que además no dependen del ratón.
   *
   * Solo ratón y lápiz. El dedo no lo necesita: sus gestos de navegación
   * siguen llegando al mapa intactos, que es de donde salen el paneo, el zoom
   * y el basculado en tablet.
   *
   * Vale en CUALQUIER herramienta, incluida Elegir. En Navegar el arrastre
   * con el botón principal ya desplaza el mapa, así que el botón central no
   * añade nada ahí, pero en Elegir ese mismo arrastre dibuja el lazo
   * rectangular: sin esto, el botón central era la única forma de mover la
   * vista sin soltar la herramienta y quedaba deshabilitado justo donde más
   * se echa en falta.
   */
  cameraModeFor(e) {
    if (!this.cb.onCameraDrag || e.pointerType === 'touch') return null;
    if (e.button === 1 || e.buttons === 4) return 'pan';
    return null;
  }

  beginCamera(e, mode) {
    this.rect = this.mapContainer.getBoundingClientRect();
    const p = this.toLocal(e);
    this.gesture = { pointerId: e.pointerId, camera: mode, lastX: p[0], lastY: p[1] };
    this.consuming = true;
    try {
      this.host.setPointerCapture(e.pointerId);
    } catch {
      /* algunos navegadores rechazan la captura; el gesto igual funciona */
    }
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    // El anillo de hover y el marcador de enganche sobran mientras se mueve la
    // vista: no se está apuntando a nada.
    this.cb.onHover(null);
  }

  /**
   * `contextmenu` NO ES DONDE SE DECIDE. SOLO SUPRIME EL MENÚ NATIVO.
   *
   * Medido en Chrome 141, el orden de un arrastre con el botón derecho es:
   *
   *     pointerdown → contextmenu → pointermove ×N → pointerup
   *
   * El `contextmenu` llega pegado al `pointerdown`, ANTES del primer
   * movimiento. Así que en Chrome este evento no puede distinguir un clic de
   * un giro de cámara: cuando llega, todavía no ha pasado nada. Abrir el menú
   * aquí significa abrirlo también cada vez que se empieza a girar la vista.
   *
   * Otros navegadores lo emiten al soltar, y si algún manejador de más arriba
   * anula el `mousedown` puede no emitirse nunca. Depender de él, en
   * cualquiera de sus formas, es lo que hacía que el clic derecho pareciera
   * ir a ratos.
   *
   * Lo que sí es fiable llega siempre y llega tarde, que es justo lo que hace
   * falta: el `pointerup`. Ahí ya se sabe si el puntero se quedó quieto —un
   * clic— o si recorrió media pantalla —un giro—. Ver `onPointerUp`.
   */
  onContextMenu(e) {
    // Sobre el mapa el menú nativo del navegador nunca aparece: el botón
    // derecho es de la aplicación.
    e.preventDefault();

    // Hay un clic en curso: lo resuelve `onPointerUp`, que es el único que
    // puede saber si terminó siendo un clic o un arrastre.
    if (this.secondary) return;

    /*
     * Sin `pointerdown` detrás no hay clic que esperar: es la tecla Menú o
     * Shift+F10, o un navegador que no emparejó el puntero. Eso se atiende en
     * el acto, con las coordenadas del propio evento.
     */
    this.fireSecondary({ x: this.toLocal(e)[0], y: this.toLocal(e)[1], fired: false });
  }

  /**
   * Dispara la acción del botón secundario, una sola vez por clic.
   *
   * Quién decide qué significa es `onSecondary`, porque depende del estado
   * del dibujo y no del puntero: con un elemento a medio trazar lo cierra
   * —como en QGIS— y en cualquier otro caso abre el menú de propiedades. Sin
   * ese callback se mantiene el reparto de antes.
   */
  fireSecondary(sec) {
    if (sec.fired) return;
    sec.fired = true;
    const p = [sec.x, sec.y];
    if (this.cb.onSecondary) {
      this.cb.onSecondary(p);
      return;
    }
    if (this.cb.isDrawing()) this.cb.onFinish();
    else if (this.cb.onLongPress) this.cb.onLongPress(p);
  }

  swallow(e) {
    if (this.consuming) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      return;
    }

    /*
     * EL HOVER NO LE SIRVE A MAPLIBRE, Y CON RELIEVE LE CUESTA UNA ESCENA
     *
     * Con una herramienta de dibujo activa, el `mousemove` sin botón pulsado
     * no tiene nada que hacer en MapLibre: el siguiente `mousedown` lo vamos a
     * consumir nosotros, así que ni desplaza ni selecciona. Dejarlo pasar es
     * gratis en plano y carísimo con el relieve 3D puesto: MapLibre construye
     * un `MapMouseEvent` por cada uno, y ese objeto calcula `lngLat` de
     * inmediato, lo que con terreno significa renderizar la escena entera a un
     * framebuffer auxiliar y leerlo con `readPixels` —una parada sincrónica de
     * la GPU— para averiguar contra qué triángulo choca el píxel.
     *
     * Medido, treinta movimientos del ratón con la herramienta Línea: 14,7 s
     * con relieve contra 0,47 s en plano, con un repintado completo por cada
     * movimiento. Cortándolos aquí, el coste desaparece.
     *
     * VAN TAMBIÉN `mouseover` Y `mouseout`, y no solo `mousemove`. El coste no
     * está en el movimiento: está en que MapLibre construya un
     * `MapMouseEvent`, y lo construye igual para los tres. Medido dibujando un
     * trazo en 3D, entrar y salir del lienzo disparaba tres de esos por gesto
     * a 2,6-8,0 SEGUNDOS cada uno —más que todo el resto del dibujo junto—
     * mientras que `mousemove` ya venía atajado. Ninguno de los tres lo
     * escucha nadie en esta app.
     *
     * Solo con relieve: en plano no hay nada que ahorrar y sí un
     * comportamiento probado que no conviene tocar.
     */
    if (
      HOVER_EVENTS.has(e.type) &&
      this.cb.isDrawing() &&
      this.cb.suppressHover &&
      this.cb.suppressHover()
    ) {
      e.stopPropagation();
    }
  }

  onPointerDown(e) {
    /*
     * `isPrimary` es el PRIMER contacto de su tipo: si llega uno y todavía
     * creemos tener dedos en la pantalla, lo que tenemos es basura de un gesto
     * cuyo `pointerup` no llegó. Se limpia aquí, que es el único momento en que
     * se puede afirmar sin riesgo, y no contando punteros al soltar.
     */
    if (e.isPrimary && this.pointers.size > 0) this.resetPointers();

    this.pointers.set(e.pointerId, e.pointerType);
    if (e.pointerType === 'pen') this.penSeen = true;
    this.rect = this.mapContainer.getBoundingClientRect();
    const abajo = this.toLocal(e);
    this.lastDown = { x: abajo[0], y: abajo[1], moved: false };

    /*
     * EL BOTÓN SECUNDARIO NI DIBUJA NI SE CONSUME.
     *
     * Antes caía en el reparto normal, igual que el izquierdo: con una
     * herramienta activa, un clic derecho arrancaba un gesto y al soltar
     * terminaba en `onVertex`, o sea PONIENDO UN VÉRTICE. El menú, mientras
     * tanto, no se abría, porque `onContextMenu` miraba la herramienta y no
     * el dibujo.
     *
     * Aquí solo se anota dónde bajó; quién decide es `onPointerUp`, que es el
     * único que sabe si esto terminó siendo un clic o un giro de cámara.
     *
     * No se anula el evento: dejarlo pasar es lo que mantiene el giro y el
     * basculado con el botón derecho, que los hace MapLibre.
     */
    if (esSecundario(e)) {
      this.clearPrimaryHold();
      this.secondary = { pointerId: e.pointerId, x: abajo[0], y: abajo[1], moved: false, fired: false };
      return;
    }
    // Un clic normal cierra el clic derecho anterior: su `contextmenu` ya no
    // puede llegar, y guardarlo dejaría el siguiente atendido con las
    // coordenadas viejas.
    this.secondary = null;

    /*
     * Mover la VISTA sin soltar la herramienta. Va lo primero porque no
     * depende de la herramienta activa ni de cuántos dedos haya: es la cámara,
     * no el dibujo.
     *
     * En tablet esto ya estaba resuelto por el reparto de siempre —el Pencil
     * dibuja, los dedos navegan—, pero en un PC hay un solo puntero: el
     * arrastre ES el trazo, y el mapa ni siquiera ve el evento porque lo
     * tragamos para que no haga pan al mismo tiempo. Con el relieve 3D puesto
     * eso deja la vista congelada: no se puede bascular ni girar para mirar la
     * ladera desde otro lado sin salir a Navegar y volver.
     */
    // Con un gesto en curso no se cambia de tercio: pulsar el botón central a
    // mitad de un trazo lo dejaría huérfano, sin cerrarse y sin borrarse.
    const camara = this.gesture ? null : this.cameraModeFor(e);
    if (camara) {
      this.beginCamera(e, camara);
      return;
    }

    const touches = this.touchCount();

    // Los toques con dos o tres dedos se vigilan siempre, incluso en modo
    // navegación: son los atajos de deshacer y rehacer.
    if (e.pointerType === 'touch') {
      this.touchStarts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches >= 2) {
        if (!this.multi) this.multi = { max: 0, t0: performance.now(), moved: false };
        this.multi.max = Math.max(this.multi.max, touches);
      }
    }

    // Segundo DEDO en pantalla => es un gesto de navegación, no un trazo.
    //
    // Se cuentan dedos, no punteros. El Pencil apoyado es un puntero más, así
    // que contarlo hacía que cualquier toque del dedo mientras el lápiz está
    // en la pantalla pareciera un gesto a dos manos y se descartara: ni
    // seleccionaba, ni cerraba el elemento, ni abría el menú. Era el motivo
    // principal de que el dedo "no hiciera nada" justo cuando más falta hace.
    if (touches > 1) {
      this.clearObserved();
      // `isDrawing()` no basta: el lazo de Elegir es un gesto en curso que no
      // es dibujo, y sin abortarlo la goma se quedaba pintada en pantalla
      // mientras los dos dedos mueven el mapa debajo.
      if (this.cb.isDrawing() || this.gesture) this.abort();
      return;
    }

    const drawing = this.cb.isDrawing();

    /*
     * EL LAZO DE ELEGIR ES UN ARRASTRE QUE NO ES DIBUJO.
     *
     * Elegir no construye nada, así que `isDrawing()` dice que no, y sin esto
     * el puntero se le dejaba entero a MapLibre: al arrastrar se desplazaba el
     * mapa y la goma del rectángulo nunca llegaba a existir. Se consume con
     * cualquier puntero —ratón, lápiz o dedo—, y el reparto de más arriba ya
     * garantiza que aquí solo llega UN dedo: con dos, esto ni se ejecuta y el
     * gesto sigue siendo de navegación, que es como se sigue moviendo el mapa
     * sin salir de Elegir.
     *
     * Un toque sin arrastre no se pierde: sale por `onDragEnd` con
     * `moved: false` y ahí se resuelve como selección de siempre.
     */
    const lasso = !drawing && !!(this.cb.lassoMode && this.cb.lassoMode());

    // Elegir y Nodos no dibujan: arrastran. Ahí el dedo tiene que funcionar
    // aunque haya un Pencil en la mesa, porque seleccionar o agarrar una
    // manija con el dedo es lo natural incluso mientras se dibuja con lápiz.
    // La navegación no se pierde: sigue estando el gesto de dos dedos.
    const dragTool = (drawing && !!(this.cb.dragMode && this.cb.dragMode())) || lasso;

    const consume =
      lasso ||
      (drawing &&
        (e.pointerType === 'pen' ||
          (e.pointerType === 'touch' && dragTool) ||
          (!this.penSeen && (e.pointerType === 'mouse' || this.cb.fingerDrawEnabled()))));
    if (!consume) {
      /*
       * El dedo no dibuja, pero un toque limpio suyo sí cierra el elemento o
       * selecciona, y sostenido abre el menú de propiedades. No lo consumimos:
       * el mapa debe seguir navegando con normalidad.
       *
       * EL LÁPIZ ENTRA POR LA MISMA PUERTA QUE EL DEDO, y no por la del ratón.
       * En Navegar y en Elegir el Pencil no dibuja, así que su toque terminaba
       * dependiendo del `click` que sintetiza el navegador, y ese depende a su
       * vez de que MapLibre no haya dado el gesto por arrastre: su umbral son
       * TRES píxeles. Un lápiz sobre vidrio se corre tres píxeles solo con
       * apoyarlo, y entonces no hay clic y no se selecciona nada. Medido aquí,
       * con los umbrales del dedo, la misma puntería sí cuenta como toque.
       *
       * El ratón se queda donde estaba: ahí el `click` del navegador llega
       * siempre y el comportamiento de escritorio está probado.
       */
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        this.rect = this.mapContainer.getBoundingClientRect();
        const q = this.toLocal(e);
        // `solo` recuerda si el puntero estuvo acompañado en algún momento. Es
        // más fiable que consultar el conjunto global de punteros al soltar:
        // un puntero huérfano de un gesto cancelado lo dejaría inservible.
        const obs = {
          x: q[0],
          y: q[1],
          t: performance.now(),
          moved: false,
          // Un solo dedo: el lápiz apoyado al lado no invalida el toque. Y el
          // lápiz, a su vez, solo cuenta si no hay ningún dedo en la pantalla,
          // porque entonces lo que hay es un gesto de cámara.
          solo: e.pointerType === 'touch' ? touches === 1 : touches === 0,
          longPressed: false,
        };
        this.observed.set(e.pointerId, obs);
        this.armFingerLongPress(e.pointerId, obs);
      } else {
        // Ratón en Navegar y en Elegir: el mapa se queda el evento —arrastrar
        // desplaza—, pero sostener sin mover abre el menú.
        this.armPrimaryLongPress(abajo);
      }
      return;
    }

    this.rect = this.mapContainer.getBoundingClientRect();
    const p = this.toLocal(e);
    this.gesture = {
      pointerId: e.pointerId,
      startX: p[0],
      startY: p[1],
      moved: false,
      freehand: false,
      points: [p],
    };
    this.consuming = true;
    try {
      this.host.setPointerCapture(e.pointerId);
    } catch {
      /* algunos navegadores rechazan la captura; el gesto igual funciona */
    }
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();

    this.emitInfo(e, 0);
    this.cb.onHover(null);

    // Modo arrastre (edición de vértices, o el lazo de Elegir): ni trazo
    // libre ni cierre de elemento, solo agarrar y mover.
    if (dragTool) {
      this.gesture.dragging = true;
      this.cb.onDragStart(p);
      // Mantener pulsado sin mover abre el menú de propiedades.
      if (this.cb.onLongPress) {
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          const g = this.gesture;
          if (!g || g.moved || !g.dragging) return;
          g.longPressed = true;
          this.cb.onLongPress(p);
        }, LONG_PRESS_HOLD_MS);
      }
      return;
    }

    // Sostener abre el menú también con una herramienta de dibujo en la mano.
    // En modo `hold` conviven: a los 320 ms arranca el trazo libre y
    // `beginFreehand` cancela esto; si no llega a arrancar —porque el trazo
    // libre está apagado, o porque ya se está dibujando algo— al segundo sale
    // el menú.
    this.armPrimaryLongPress(p);

    if (this.cb.freehandMode() === 'hold') {
      this.cb.onLongPressArm(p);
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        const g = this.gesture;
        if (!g || g.moved || g.freehand) return;
        this.beginFreehand();
      }, LONG_PRESS_MS);
    }
  }

  onPointerMove(e) {
    if (e.pointerType === 'pen') this.penSeen = true;

    const d = this.lastDown;
    if (d && !d.moved) {
      const q = this.toLocal(e);
      if (Math.hypot(q[0] - d.x, q[1] - d.y) > MOVE_THRESHOLD) {
        d.moved = true;
        // Se arrastró: esto es desplazar o trazar, no consultar.
        this.clearPrimaryHold();
      }
    }

    // Con el botón derecho pulsado esto puede ser un giro y no un clic: se
    // anota para que al soltar no salga un menú que nadie pidió. El umbral es
    // el holgado (ver `SECONDARY_MOVE`).
    const sec = this.secondary;
    if (sec && !sec.moved && sec.pointerId === e.pointerId) {
      const q = this.toLocal(e);
      if (Math.hypot(q[0] - sec.x, q[1] - sec.y) > SECONDARY_MOVE) sec.moved = true;
    }

    if (this.multi && !this.multi.moved && e.pointerType === 'touch') {
      const s = this.touchStarts.get(e.pointerId);
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MULTI_TAP_MOVE) {
        this.multi.moved = true;
      }
    }

    const g = this.gesture;

    if (!g || e.pointerId !== g.pointerId) {
      /*
       * Hover: el puntero está sobre el mapa pero sin tocarlo. Es lo que
       * previsualiza a qué se va a enganchar y por dónde iría el trace.
       *
       * Vale para el Pencil —que reporta posición en el aire— y para el ratón,
       * que en un PC está SIEMPRE en hover: sin esto, desde un escritorio no
       * había ninguna previsualización y el snapping era un salto a ciegas que
       * solo se descubría después de hacer clic. El dedo no entra: un dedo que
       * no toca la pantalla no existe.
       */
      if (this.cb.isDrawing() && this.esHover(e)) {
        if (!this.rect) this.rect = this.mapContainer.getBoundingClientRect();
        this.cb.onHover(this.toLocal(e), e.pointerType);
        this.emitInfo(e, 0);
      }
      const obs = this.observed.get(e.pointerId);
      if (obs && !obs.moved) {
        const q = this.toLocal(e);
        if (Math.hypot(q[0] - obs.x, q[1] - obs.y) > FINGER_TAP_MOVE) {
          obs.moved = true;
          // Se movió: ya no es una pulsación sostenida, es un paneo.
          this.clearFingerLongPress(e.pointerId);
        }
      }
      return;
    }

    e.stopPropagation();
    if (e.cancelable) e.preventDefault();

    const p = this.toLocal(e);

    if (g.camera) {
      const dx = p[0] - g.lastX;
      const dy = p[1] - g.lastY;
      g.lastX = p[0];
      g.lastY = p[1];
      if (dx || dy) this.cb.onCameraDrag(g.camera, dx, dy);
      return;
    }

    if (g.dragging) {
      if (!g.moved) {
        const dx = p[0] - g.startX;
        const dy = p[1] - g.startY;
        if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) {
          g.moved = true;
          this.clearLongPress();
        }
      }
      this.cb.onDragMove(p);
      this.emitInfo(e, 0);
      return;
    }

    if (!g.moved) {
      const dx = p[0] - g.startX;
      const dy = p[1] - g.startY;
      if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) {
        g.moved = true;
        if (!g.freehand) {
          if (this.cb.freehandMode() === 'drag') {
            this.beginFreehand();
          } else {
            // Se arrastró antes de completar el hold: ya no es un long-press.
            this.clearLongPress();
            this.cb.onLongPressArm(null);
          }
        }
      }
    }

    if (g.freehand) {
      const coalesced =
        typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      if (coalesced.length > 0) {
        for (const ce of coalesced) g.points.push(this.toLocal(ce));
      } else {
        g.points.push(p);
      }
      this.emitInfo(e, coalesced.length);
      this.schedulePreview();
    } else {
      this.emitInfo(e, 0);
    }
  }

  onPointerUp(e) {
    this.pointers.delete(e.pointerId);
    this.touchStarts.delete(e.pointerId);
    this.clearPrimaryHold();

    /*
     * Botón secundario: AQUÍ se decide, y no en `contextmenu` (ver allí).
     *
     * Es el único momento en que consta si el puntero se quedó quieto —un
     * clic, y entonces el menú— o si recorrió la pantalla —un giro de cámara,
     * y entonces nada—. Llega siempre, se suelte donde se suelte, porque este
     * manejador cuelga de la ventana y no del mapa.
     *
     * `fireSecondary` no repite, así que un `contextmenu` rezagado —los
     * navegadores que lo emiten al soltar lo mandan justo después de esto— no
     * vuelve a abrir el menú.
     */
    const sec = this.secondary;
    if (sec && sec.pointerId === e.pointerId) {
      if (!sec.moved) this.fireSecondary(sec);
      else sec.fired = true; // fue un giro: el `contextmenu` que venga detrás no cuenta
      return;
    }

    // El gesto multitáctil se cierra cuando se han levantado tantos dedos como
    // llegaron a estar abajo, sin depender del conteo global de punteros.
    if (this.multi && e.pointerType === 'touch') {
      this.multi.lifted = (this.multi.lifted || 0) + 1;
      if (this.multi.lifted >= this.multi.max) {
        const m = this.multi;
        this.multi = null;
        if (!m.moved && performance.now() - m.t0 < MULTI_TAP_MAX_MS && m.max >= 2) {
          this.registerMultiTap(Math.min(m.max, 3));
        }
      }
    }

    const obs = this.observed.get(e.pointerId);
    if (obs) {
      this.observed.delete(e.pointerId);
      this.clearFingerLongPress(e.pointerId);
      // Si ya abrió el menú, el mismo dedo no debe además cerrar el elemento.
      const clean =
        obs.solo && !obs.moved && !obs.longPressed && performance.now() - obs.t < FINGER_TAP_MS;
      /*
       * SIN CONDICIONAR A QUE SE ESTÉ DIBUJANDO. Esto llevaba un
       * `&& this.cb.isDrawing()`, y ahí estaba el "en tablet no selecciona".
       *
       * En Navegar y en Elegir —las dos herramientas donde uno SE DEDICA a
       * seleccionar— el toque no llegaba por aquí, sino por el `click` de
       * MapLibre. Ese evento no es del programa: lo sintetiza el navegador a
       * partir del toque, y solo si el dedo se movió menos que SU umbral de
       * toque, que es de unos diez píxeles. Medido en Chromium con un dedo que
       * se corre doce, no se emite `click` NINGUNO: ni MapLibre ni nosotros
       * nos enteramos de que hubo un toque, y el contacto no se selecciona ni
       * se deselecciona. Doce píxeles es un dedo normal en una tablet que se
       * sujeta con la otra mano.
       *
       * Lo de aquí no depende del navegador: se mide sobre los eventos de
       * puntero, con los umbrales que ya estaban pensados para un dedo (14 px
       * y 900 ms, ver arriba). Por eso pasa a atender el toque en TODAS las
       * herramientas y no solo mientras se dibuja.
       */
      if (clean) this.handleFingerTap(obs);
    }

    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;

    e.stopPropagation();
    if (e.cancelable) e.preventDefault();

    this.clearLongPress();
    this.cb.onLongPressArm(null);
    this.cb.onPointerInfo(null);
    this.gesture = null;
    try {
      this.host.releasePointerCapture(e.pointerId);
    } catch {
      /* ignorar */
    }
    // El `touchend`/`mouseup` equivalente llega después de este handler;
    // soltamos la bandera en el siguiente tick para tragárnoslo también.
    setTimeout(() => {
      this.consuming = false;
    }, 0);

    // Mover la vista no dibuja: ni vértice, ni doble toque, ni cierre.
    if (g.camera) return;

    if (g.dragging) {
      const p = this.toLocal(e);
      const now = performance.now();
      const lt = this.lastTap;
      const doubleTap =
        !g.moved &&
        !!lt &&
        now - lt.t < DOUBLE_TAP_MS &&
        Math.hypot(lt.x - g.startX, lt.y - g.startY) < DOUBLE_TAP_DIST;
      this.lastTap = g.moved || doubleTap ? null : { t: now, x: g.startX, y: g.startY };
      this.cb.onDragEnd(p, {
        moved: g.moved,
        doubleTap,
        longPressed: !!g.longPressed,
        // Para que el lazo pueda sumar a lo ya marcado, como cualquier
        // escritorio, y apuntar con la tolerancia del dedo o la del ratón:
        // aquí es donde todavía se tiene el evento.
        shiftKey: !!e.shiftKey,
        pointerType: e.pointerType,
      });
      return;
    }

    if (g.freehand) {
      this.cb.onStrokeProgress([]);
      if (g.points.length >= 2) this.cb.onStrokeEnd(g.points);
      this.lastTap = null;
      return;
    }

    /*
     * El sostenido ya abrió el menú de propiedades: soltar no debe ADEMÁS
     * poner un vértice. Sin esto, consultar los atributos de un contacto sin
     * soltar la herramienta Línea dejaba un vértice suelto donde se consultó.
     */
    if (g.longPressed) {
      this.lastTap = null;
      return;
    }

    const now = performance.now();
    const lt = this.lastTap;
    if (
      lt &&
      now - lt.t < DOUBLE_TAP_MS &&
      Math.hypot(lt.x - g.startX, lt.y - g.startY) < DOUBLE_TAP_DIST
    ) {
      this.lastTap = null;
      this.cb.onFinish();
      return;
    }
    this.lastTap = { t: now, x: g.startX, y: g.startY };
    this.cb.onVertex([g.startX, g.startY]);
  }

  /**
   * Toque limpio del dedo mientras el Pencil dibuja. Doble toque cierra
   * siempre; un toque simple cierra solo si cae lejos del elemento en
   * construcción — el "tap afuera". Quién decide qué es "lejos" es mapView,
   * que es el único que sabe proyectar la geometría a pantalla.
   */
  handleFingerTap(obs) {
    /*
     * El doble toque cierra el elemento en construcción. Solo se arma con una
     * herramienta de dibujo en la mano: en Navegar y en Elegir no hay nada que
     * cerrar, y armarlo ahí convertiría el segundo de dos toques seguidos
     * sobre el mismo contacto —reafirmar la selección, que es un gesto
     * normal— en una llamada que no significa nada.
     */
    if (this.cb.isDrawing()) {
      const now = performance.now();
      const lt = this.lastFingerTap;
      if (
        lt &&
        now - lt.t < FINGER_DOUBLE_TAP_MS &&
        Math.hypot(lt.x - obs.x, lt.y - obs.y) < FINGER_DOUBLE_TAP_DIST
      ) {
        this.lastFingerTap = null;
        this.cb.onFinish();
        return;
      }
      this.lastFingerTap = { t: now, x: obs.x, y: obs.y };
    } else {
      this.lastFingerTap = null;
    }
    this.cb.onFingerTap([obs.x, obs.y]);
  }

  /** Dos toques seguidos con el mismo número de dedos disparan la acción. */
  registerMultiTap(n) {
    const now = performance.now();
    const lt = this.lastMultiTap;
    if (lt && lt.n === n && now - lt.t < MULTI_DOUBLE_MS) {
      this.lastMultiTap = null;
      if (this.cb.onMultiTap) this.cb.onMultiTap(n);
      return;
    }
    this.lastMultiTap = { n, t: now };
  }

  onPointerCancel(e) {
    this.pointers.delete(e.pointerId);
    this.clearPrimaryHold();
    if (this.secondary && this.secondary.pointerId === e.pointerId) this.secondary = null;
    this.observed.delete(e.pointerId);
    this.clearFingerLongPress(e.pointerId);
    this.touchStarts.delete(e.pointerId);
    if (this.multi && this.touchCount() === 0) this.multi = null;
    if (this.gesture && this.gesture.pointerId === e.pointerId) this.abort();
  }

  /**
   * ¿Este movimiento es un hover del que se puede previsualizar?
   *
   * El ratón solo cuenta mientras no se haya visto un Pencil: con lápiz
   * presente él manda, y el cursor del ratón —que en una tablet híbrida puede
   * quedarse quieto en una esquina— no debe seguir pintando un marcador de
   * enganche que no corresponde a nada.
   */
  esHover(e) {
    if (e.buttons !== 0) return false;
    if (e.pointerType === 'pen') return true;
    return e.pointerType === 'mouse' && !this.penSeen;
  }

  onPointerLeave(e) {
    if (!this.gesture && (e.pointerType === 'pen' || e.pointerType === 'mouse')) {
      this.cb.onHover(null);
    }
  }

  abort() {
    const arrastraba = !!(this.gesture && this.gesture.dragging);
    this.clearLongPress();
    this.gesture = null;
    this.consuming = false;
    this.cb.onLongPressArm(null);
    this.cb.onStrokeProgress([]);
    this.cb.onPointerInfo(null);
    // Un arrastre abortado no llega a `onDragEnd`, así que lo que hubiera
    // pintado —la goma del lazo— se quedaría en pantalla para siempre.
    if (arrastraba && this.cb.onDragCancel) this.cb.onDragCancel();
  }

  beginFreehand() {
    const g = this.gesture;
    if (!g) return;
    // A partir de aquí se está DIBUJANDO: el sostenido del botón primario ya
    // no debe abrir el menú a mitad del trazo.
    this.clearPrimaryHold();
    g.freehand = true;
    g.points = [[g.startX, g.startY]];
    this.cb.onLongPressArm(null);
    this.cb.onStrokeStart();
  }

  /** Previsualización a 1 frame: con Pencil llegan hasta 240 muestras/s. */
  schedulePreview() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      const g = this.gesture;
      if (g && g.freehand) this.cb.onStrokeProgress(g.points);
    });
  }

  emitInfo(e, coalesced) {
    this.cb.onPointerInfo({
      pointerType: e.pointerType,
      pressure: e.pressure,
      tiltX: e.tiltX || 0,
      tiltY: e.tiltY || 0,
      altitudeAngle: typeof e.altitudeAngle === 'number' ? e.altitudeAngle : null,
      coalesced,
    });
  }
}
