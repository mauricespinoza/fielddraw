/**
 * Ventanas flotantes: arrastrar por la cabecera, redimensionar desde la esquina
 * y plegar a la cabecera.
 *
 * El perfil topográfico y el estructural tapan parte del mapa justo donde hay
 * que mirar —la traza, los puntos de manteo por elegir—, así que los dos se
 * pueden mover, achicar y plegar. Los estilos en línea (`left`, `top`, `width`)
 * se quedan puestos mientras el elemento viva, de modo que repintar el
 * contenido no devuelve la ventana a su sitio de origen.
 */

const INTERACTIVE = 'button, a, input, select, label, textarea';

/**
 * @param {object} o
 * @param {HTMLElement} o.panel
 * @param {HTMLElement} o.handle        zona de arrastre (la cabecera)
 * @param {HTMLElement} [o.grip]        esquina de redimensión
 * @param {HTMLElement} [o.collapseBtn] botón que pliega la ventana
 * @param {(dw:number, dh:number, start:object)=>void} [o.onGrip] redimensión extra (alto)
 * @param {()=>void} [o.onLayout]       tras mover o redimensionar
 */
export function makeFloating({ panel, handle, grip, collapseBtn, onGrip, onLayout = () => {} }) {
  const free = (r) => {
    panel.style.left = `${r.left}px`;
    panel.style.top = `${r.top}px`;
    panel.style.width = `${r.width}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  const clamp = () => {
    const r = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 300), vw - 8);
    const left = Math.min(Math.max(r.left, 8 - width + 140), vw - 140);
    const top = Math.min(Math.max(r.top, 0), vh - 44);
    free({ left, top, width });
  };

  const drag = (el, onMove) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest(INTERACTIVE) && el === handle) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const r = panel.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, width: r.width, height: r.height };
      free(start);
      const move = (ev) => {
        onMove(start, ev.clientX - start.x, ev.clientY - start.y);
        clamp();
        onLayout();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };

  drag(handle, (st, dx, dy) => free({ left: st.left + dx, top: st.top + dy, width: st.width }));
  if (grip) {
    drag(grip, (st, dx, dy) => {
      free({ left: st.left, top: st.top, width: Math.max(300, st.width + dx) });
      if (onGrip) onGrip(dx, dy, st);
    });
  }
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      const plegada = panel.classList.toggle('collapsed');
      collapseBtn.textContent = plegada ? '▢' : '—';
      collapseBtn.title = plegada ? 'Expand' : 'Collapse to the title bar';
      onLayout();
    });
  }
  window.addEventListener('resize', () => {
    if (panel.style.left) clamp();
  });
}
