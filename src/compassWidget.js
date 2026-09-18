/**
 * Brújula en vivo, dibujada en SVG.
 *
 * La comparte el método Device de crear medida y la pestaña Compass del
 * Stereograma: en las dos hace falta leer lo mismo —el rumbo como un trazo
 * girado desde el norte, el manteo como un tic a un lado, y su error como
 * texto y no como adorno—, así que la forma de dibujarlo vive en un solo
 * sitio y no se copia dos veces.
 *
 * Notación strike: el trazo largo marca el rumbo (regla de la mano derecha,
 * igual que el símbolo que se dibuja en el mapa en `structureSymbols.js`), y
 * el tic corto hacia la derecha del trazo marca el manteo.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

const DEG_TICKS = [0, 45, 90, 135, 180, 225, 270, 315];
const CARDINAL = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

/**
 * Construye la rosa de la brújula dentro de un `<svg>` ya existente, vacío o
 * no —se limpia primero—. Devuelve funciones para refrescar la lectura sin
 * reconstruir el marco cada vez que llega una muestra nueva.
 *
 * @param {SVGElement} svg
 * @param {{size?: number}} opts
 */
export function buildCompass(svg, { size = 220 } = {}) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 22;

  const g = el('g', { class: 'compass-frame' });
  g.append(
    el('circle', { cx, cy, r: R, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, opacity: 0.5 }),
    el('circle', { cx, cy, r: R * 0.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1, opacity: 0.25 }),
  );
  for (const deg of DEG_TICKS) {
    const rad = (deg * Math.PI) / 180;
    const inner = deg % 90 === 0 ? R - 10 : R - 6;
    const x1 = cx + Math.sin(rad) * R;
    const y1 = cy - Math.cos(rad) * R;
    const x2 = cx + Math.sin(rad) * inner;
    const y2 = cy - Math.cos(rad) * inner;
    g.appendChild(
      el('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': deg % 90 === 0 ? 1.6 : 1, opacity: 0.6 }),
    );
    if (CARDINAL[deg]) {
      const lx = cx + Math.sin(rad) * (R - 20);
      const ly = cy - Math.cos(rad) * (R - 20);
      const t = el('text', {
        x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': 12, 'font-weight': 700, fill: 'currentColor',
      });
      t.textContent = CARDINAL[deg];
      g.appendChild(t);
    }
  }
  svg.appendChild(g);

  const needle = el('g', { class: 'compass-needle', visibility: 'hidden' });
  const strikeLine = el('line', {
    x1: cx, y1: cy - R + 12, x2: cx, y2: cy + R - 12,
    stroke: '#4fc3f7', 'stroke-width': 3, 'stroke-linecap': 'round',
  });
  const dipTick = el('line', {
    x1: cx, y1: cy, x2: cx + 16, y2: cy,
    stroke: '#ff8a65', 'stroke-width': 3, 'stroke-linecap': 'round',
  });
  const hub = el('circle', { cx, cy, r: 3.5, fill: '#e6edf3' });
  needle.append(strikeLine, dipTick, hub);
  svg.appendChild(needle);

  const label = el('text', {
    x: cx, y: cy + R + 24, 'text-anchor': 'middle', 'font-size': 15,
    'font-weight': 600, fill: 'currentColor',
  });
  svg.appendChild(label);

  const sub = el('text', {
    x: cx, y: cy + R + 40, 'text-anchor': 'middle', 'font-size': 11,
    fill: 'currentColor', opacity: 0.7,
  });
  svg.appendChild(sub);

  /**
   * Refresca la aguja y el texto con una lectura `{strike, dip, strikeSd,
   * dipSd, ready, n}`. `null`/`undefined` la deja apagada, sin inventar un
   * cero que no se midió.
   */
  function update(reading) {
    if (!reading || !Number.isFinite(reading.strike) || !Number.isFinite(reading.dip)) {
      needle.setAttribute('visibility', 'hidden');
      label.textContent = '';
      sub.textContent = '';
      return;
    }
    needle.setAttribute('visibility', 'visible');
    // La aguja gira con el rumbo: `g` ya está fijo, así que basta rotar el
    // grupo entero alrededor del centro.
    needle.setAttribute('transform', `rotate(${reading.strike} ${cx} ${cy})`);
    const strike = String(Math.round(reading.strike)).padStart(3, '0');
    const dip = Math.round(reading.dip);
    label.textContent = `${strike}/${dip}`;
    if (Number.isFinite(reading.strikeSd) && Number.isFinite(reading.dipSd)) {
      sub.textContent = `±${Math.round(reading.strikeSd * 10) / 10}° / ±${Math.round(reading.dipSd * 10) / 10}°`;
    } else {
      sub.textContent = '';
    }
  }

  return { update };
}
