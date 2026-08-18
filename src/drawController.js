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
];

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
  constructor(host, mapContainer, callbacks) {
    this.host = host;
    this.mapContainer = mapContainer;
    this.cb = callbacks;

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

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.swallow = this.swallow.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);

    this.attach();
  }

  attach() {
    const opts = { capture: true, passive: false };
    this.host.addEventListener('pointerdown', this.onPointerDown, opts);
    this.host.addEventListener('pointermove', this.onPointerMove, opts);
    this.host.addEventListener('pointerup', this.onPointerUp, opts);
    this.host.addEventListener('pointercancel', this.onPointerCancel, opts);
    this.host.addEventListener('pointerleave', this.onPointerLeave, opts);
    this.host.addEventListener('contextmenu', this.onContextMenu, opts);
    for (const type of SWALLOWED) this.host.addEventListener(type, this.swallow, opts);
  }

  destroy() {
    const opts = { capture: true };
    this.host.removeEventListener('pointerdown', this.onPointerDown, opts);
    this.host.removeEventListener('pointermove', this.onPointerMove, opts);
    this.host.removeEventListener('pointerup', this.onPointerUp, opts);
    this.host.removeEventListener('pointercancel', this.onPointerCancel, opts);
    this.host.removeEventListener('pointerleave', this.onPointerLeave, opts);
    this.host.removeEventListener('contextmenu', this.onContextMenu, opts);
    for (const type of SWALLOWED) this.host.removeEventListener(type, this.swallow, opts);
    this.clearLongPress();
    this.clearObserved();
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

  onContextMenu(e) {
    if (!this.cb.isDrawing()) return;
    e.preventDefault();
    // Clic derecho cierra el elemento, igual que en QGIS.
    this.cb.onFinish();
  }

  swallow(e) {
    if (!this.consuming) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }

  onPointerDown(e) {
    this.pointers.set(e.pointerId, e.pointerType);
    if (e.pointerType === 'pen') this.penSeen = true;

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
      if (this.cb.isDrawing()) this.abort();
      return;
    }

    const drawing = this.cb.isDrawing();

    // Elegir y Nodos no dibujan: arrastran. Ahí el dedo tiene que funcionar
    // aunque haya un Pencil en la mesa, porque seleccionar o agarrar una
    // manija con el dedo es lo natural incluso mientras se dibuja con lápiz.
    // La navegación no se pierde: sigue estando el gesto de dos dedos.
    const dragTool = drawing && !!(this.cb.dragMode && this.cb.dragMode());

    const consume =
      drawing &&
      (e.pointerType === 'pen' ||
        (e.pointerType === 'touch' && dragTool) ||
        (!this.penSeen && (e.pointerType === 'mouse' || this.cb.fingerDrawEnabled())));
    if (!consume) {
      // El dedo no dibuja, pero un toque limpio suyo sí cierra el elemento o
      // selecciona, y sostenido abre el menú de propiedades. No lo consumimos:
      // el mapa debe seguir navegando con normalidad.
      if (e.pointerType === 'touch') {
        this.rect = this.mapContainer.getBoundingClientRect();
        const q = this.toLocal(e);
        // `solo` recuerda si el dedo estuvo acompañado en algún momento. Es
        // más fiable que consultar el conjunto global de punteros al soltar:
        // un puntero huérfano de un gesto cancelado lo dejaría inservible.
        const obs = {
          x: q[0],
          y: q[1],
          t: performance.now(),
          moved: false,
          // Un solo dedo: el lápiz apoyado al lado no invalida el toque.
          solo: touches === 1,
          longPressed: false,
        };
        this.observed.set(e.pointerId, obs);
        this.armFingerLongPress(e.pointerId, obs);
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

    // Modo arrastre (edición de vértices): ni long-press ni trazo libre, solo
    // agarrar y mover.
    if (this.cb.dragMode && this.cb.dragMode()) {
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
      if (clean && this.cb.isDrawing()) this.handleFingerTap(obs);
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
      });
      return;
    }

    if (g.freehand) {
      this.cb.onStrokeProgress([]);
      if (g.points.length >= 2) this.cb.onStrokeEnd(g.points);
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
    this.clearLongPress();
    this.gesture = null;
    this.consuming = false;
    this.cb.onLongPressArm(null);
    this.cb.onStrokeProgress([]);
    this.cb.onPointerInfo(null);
  }

  beginFreehand() {
    const g = this.gesture;
    if (!g) return;
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
