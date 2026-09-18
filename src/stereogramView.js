/**
 * Dibujo de la red estereográfica, y su exportación.
 *
 * SVG por el mismo motivo que el corte estructural (`sectionView.js`): esta
 * figura termina pegada en una memoria o un paper, y un SVG se retoca en
 * Illustrator o Inkscape. El PNG y la copia al portapapeles salen del MISMO
 * SVG, así que ninguna de las tres versiones puede desalinearse de las otras.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/** Círculos de igual manteo (10° en 10°) y diámetros de igual rumbo (cada 30°), en un plano equiareal. */
function grid(cx, cy, R) {
  const g = el('g', { class: 'stereo-grid', stroke: 'currentColor', 'stroke-width': 0.6, opacity: 0.35, fill: 'none' });
  for (let dip = 10; dip <= 80; dip += 10) {
    // Círculo de igual manteo: el lugar de los polos de planos con ese
    // manteo fijo, cualquiera sea el rumbo — es el mismo `schmidtPoint` que
    // usa el resto del módulo, muestreado en rumbo.
    const plunge = 90 - dip;
    const theta = (90 - plunge) * (Math.PI / 180);
    const r = R * Math.SQRT2 * Math.sin(theta / 2);
    g.appendChild(el('circle', { cx, cy, r, 'stroke-width': dip === 90 ? 1 : 0.5 }));
  }
  for (let az = 0; az < 180; az += 30) {
    const rad = (az * Math.PI) / 180;
    g.appendChild(
      el('line', {
        x1: cx - R * Math.sin(rad), y1: cy + R * Math.cos(rad),
        x2: cx + R * Math.sin(rad), y2: cy - R * Math.cos(rad),
      }),
    );
  }
  g.appendChild(el('circle', { cx, cy, r: R, stroke: 'currentColor', 'stroke-width': 1.4, opacity: 0.7 }));
  return g;
}

/**
 * Dibuja la red y los polos dentro de un `<svg>` ya existente.
 *
 * @param {SVGElement} svg
 * @param {Array<{x:number,y:number,color:string,id:string}>} points — ya en
 *   coordenadas RELATIVAS al centro y con el radio que use `schmidtPoint`.
 * @param {{width?, height?, radius?, highlighted?: Set<string>}} opts
 */
export function renderStereogram(svg, points, opts = {}) {
  const { width = 520, height = 520, radius = 220, highlighted = null } = opts;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.replaceChildren();

  const cx = width / 2;
  const cy = height / 2;

  svg.appendChild(grid(cx, cy, radius));

  const labels = el('g', { class: 'stereo-labels', 'font-size': 11, fill: 'currentColor', opacity: 0.55 });
  labels.append(
    Object.assign(el('text', { x: cx, y: cy - radius - 6, 'text-anchor': 'middle' }), { textContent: 'N' }),
    Object.assign(el('text', { x: cx + radius + 8, y: cy + 4, 'text-anchor': 'start' }), { textContent: 'E' }),
    Object.assign(el('text', { x: cx, y: cy + radius + 16, 'text-anchor': 'middle' }), { textContent: 'S' }),
    Object.assign(el('text', { x: cx - radius - 8, y: cy + 4, 'text-anchor': 'end' }), { textContent: 'W' }),
  );
  svg.appendChild(labels);

  const dots = el('g', { class: 'stereo-points' });
  const placed = [];
  for (const p of points) {
    const on = !highlighted || highlighted.size === 0 || highlighted.has(p.id);
    const px = cx + p.x * radius;
    const py = cy + p.y * radius;
    dots.appendChild(
      el('circle', {
        cx: px,
        cy: py,
        r: 4.2,
        fill: p.color,
        stroke: '#0d1117',
        'stroke-width': 1,
        'data-id': p.id,
        opacity: on ? 1 : 0.18,
      }),
    );
    placed.push({ id: p.id, x: px, y: py });
  }
  svg.appendChild(dots);

  // Las coordenadas de cada punto ya en el sistema del `viewBox`, para que
  // quien haga hit-testing del lazo (`stereogramPanel.js`) no tenga que
  // rehacer la proyección: son EXACTAMENTE donde se dibujó cada círculo.
  return { cx, cy, radius, placed };
}

/* ---------- exportación ---------- */

export function stereogramSVG(svg) {
  const copia = svg.cloneNode(true);
  copia.setAttribute('xmlns', SVG_NS);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copia)}`;
}

/**
 * PNG a partir del mismo SVG en pantalla, a `scale` veces su tamaño — igual
 * que `sectionPNG`, para que la versión exportada nunca se separe de lo que
 * se está viendo.
 */
export function stereogramPNG(svg, { scale = 2, background = '#10141a' } = {}) {
  return new Promise((resolve, reject) => {
    const texto = stereogramSVG(svg);
    const w = Number(svg.getAttribute('width')) || 520;
    const h = Number(svg.getAttribute('height')) || 520;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([texto], { type: 'image/svg+xml' }));
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        // Fondo sólido: un SVG con partes sin pintar da un PNG con alfa, y
        // pegado en un documento claro el círculo se ve recortado en negro.
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          blob ? resolve(blob) : reject(new Error('The canvas produced no image'));
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The SVG could not be rasterised'));
    };
    img.src = url;
  });
}
