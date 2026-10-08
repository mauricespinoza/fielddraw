/**
 * Zoom con dos dedos sobre el perfil estructural.
 *
 * El zoom cambia el tamaño CSS del `<svg>` (que tiene `viewBox`), así que el
 * dibujo se agranda sin perder nitidez y la ventana se desplaza con su scroll
 * de siempre. Los trazos a mano no se ven afectados: se guardan en coordenadas
 * del corte, y `sectionInk` solo divide la posición del dedo por `getZoom()`.
 *
 * El gesto se maneja con eventos táctiles para poder impedir que el navegador
 * lo trate como un zoom de página. Un doble toque con el ratón vuelve a 1×.
 */

const MIN = 1;
const MAX = 8;
let k = 1;

export const getZoom = () => k;

/** Reaplica el zoom tras redibujar: `renderSection` fija el tamaño sin zoom. */
export function applyZoom(svg) {
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  if (!(w > 0 && h > 0)) return;
  svg.style.width = k === 1 ? '' : `${w * k}px`;
  svg.style.height = k === 1 ? '' : `${h * k}px`;
}

/**
 * @param {SVGElement} svg
 * @param {HTMLElement} wrap       el contenedor que hace scroll
 * @param {{onStart?: Function}} hooks   `onStart` cancela un trazo a medias
 */
export function initSectionZoom(svg, wrap, { onStart } = {}) {
  let g = null;

  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

  svg.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      if (onStart) onStart();
      const r = wrap.getBoundingClientRect();
      const c = mid(e.touches);
      g = {
        d0: dist(e.touches) || 1,
        k0: k,
        // El punto del dibujo (sin zoom) que está bajo los dedos.
        px: (wrap.scrollLeft + c.x - r.left) / k,
        py: (wrap.scrollTop + c.y - r.top) / k,
      };
    },
    { passive: false },
  );

  svg.addEventListener(
    'touchmove',
    (e) => {
      if (!g || e.touches.length !== 2) return;
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      const c = mid(e.touches);
      k = Math.min(MAX, Math.max(MIN, g.k0 * (dist(e.touches) / g.d0)));
      applyZoom(svg);
      // Mantiene ese punto bajo los dedos: así el zoom también sigue al
      // arrastre de los dos dedos.
      wrap.scrollLeft = g.px * k - (c.x - r.left);
      wrap.scrollTop = g.py * k - (c.y - r.top);
    },
    { passive: false },
  );

  const fin = (e) => {
    if (e.touches.length < 2) g = null;
  };
  svg.addEventListener('touchend', fin);
  svg.addEventListener('touchcancel', fin);

  svg.addEventListener('dblclick', () => {
    if (k === 1) return;
    k = 1;
    applyZoom(svg);
  });
}
