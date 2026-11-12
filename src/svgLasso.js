/**
 * Lazo sobre una figura SVG (la red del estereograma y la solución de falla).
 *
 * El mapa tiene su propio lazo dentro del controlador de dibujo; aquí no hay
 * controlador, así que el gesto lo atiende directamente un `<svg>`
 * transparente puesto encima de la figura, con el mismo `viewBox`. Las dos
 * formas son las del Elegir del mapa: a mano alzada ('lasso') o rectángulo
 * ('rect'), y la que esté puesta la decide quien llama.
 *
 * Lo geométrico (punto en anillo, rectángulo → anillo, qué cae dentro) va
 * aparte y sin DOM, para probarlo con node.
 */

/** Punto en polígono, rayo hacia +x — el de siempre, sin dependencias. */
export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cruza = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (cruza) inside = !inside;
  }
  return inside;
}

/** Las cuatro esquinas del rectángulo que abren dos puntos opuestos. */
export function rectRing(a, b) {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/**
 * Los elementos `{x, y, ...}` que caen dentro del anillo. Un anillo de menos
 * de tres puntos, o sin área (un toque), no encierra nada.
 */
export function lassoHits(items, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  if (Math.abs(area) < 1e-9) return [];
  return items.filter((d) => pointInRing([d.x, d.y], ring));
}

/** Convierte un punto del cliente a coordenadas del `viewBox` del SVG. */
function toSvgPoint(svg, clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return [
    ((clientX - rect.left) / rect.width) * vb.width + vb.x,
    ((clientY - rect.top) / rect.height) * vb.height + vb.y,
  ];
}

/**
 * Engancha el gesto a `svg`, que debe contener un `<polygon>` para la goma.
 *
 * @param {SVGSVGElement} svg
 * @param {{
 *   mode: () => 'lasso'|'rect',
 *   enabled?: () => boolean,
 *   onLasso: (ring: number[][], opts: {additive: boolean}) => void,
 *   onTap?: () => void,
 * }} opts `onLasso` recibe el anillo en coordenadas del `viewBox`; `onTap`,
 *   un toque sin arrastre (suelta el lazo, como tocar afuera en el mapa).
 *   Con Mayúsculas o ⌘/Ctrl apretado el lazo suma a lo ya lassado.
 */
export function wireSvgLasso(svg, { mode, enabled = () => true, onLasso, onTap = () => {} }) {
  const shape = svg.querySelector('polygon');
  let start = null;
  let path = null;
  let additive = false;
  let moved = false;

  const draw = (ring) => shape.setAttribute('points', ring.map((q) => `${q[0]},${q[1]}`).join(' '));

  svg.addEventListener('pointerdown', (e) => {
    if (!enabled()) return;
    if (e.button !== undefined && e.button > 0) return;
    svg.setPointerCapture(e.pointerId);
    start = toSvgPoint(svg, e.clientX, e.clientY);
    path = [start];
    moved = false;
    additive = e.shiftKey || e.metaKey || e.ctrlKey;
    shape.setAttribute('points', '');
  });

  svg.addEventListener('pointermove', (e) => {
    if (!path) return;
    const p = toSvgPoint(svg, e.clientX, e.clientY);
    if (mode() === 'rect') {
      if (Math.hypot(p[0] - start[0], p[1] - start[1]) < 3 && !moved) return;
      moved = true;
      path = rectRing(start, p);
      draw(path);
      return;
    }
    const last = path[path.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return; // ralo, como el lazo del mapa
    moved = true;
    path.push(p);
    draw(path);
  });

  const finish = () => {
    if (!path) return;
    const ring = path;
    path = null;
    start = null;
    shape.setAttribute('points', '');
    if (moved && ring.length >= 3) onLasso(ring, { additive });
    else onTap();
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
}
