/**
 * Dibujo de la solución de plano de falla sobre la red de Schmidt.
 *
 * Misma idea que el dibujo del plugin «Fault-plane Solver»
 * (`stereogram_svg.py`): los cuadrantes extensionales sombreados con el color
 * del régimen, los planos nodales del doble par, los ejes P/T de cada falla
 * (P = círculo, T = cuadrado, convención FaultKin), los ejes medios P̄/T̄/B̄
 * (círculo, cuadrado, triángulo) y los σ1/σ2/σ3 de la inversión de Michael.
 * Cada elemento se enciende y apaga por separado (`FK_LAYERS`), y lo que se
 * exporta a SVG/PNG es exactamente lo que se ve.
 *
 * La geometría la ponen `faultKin.js` (cuentas) y `stereogram.js`
 * (proyección, ciclogramas); aquí solo se pinta.
 */

import { greatCirclePath, projectVector, smallCircleSegments } from './stereogram.js';
import { net } from './stereogramView.js';
import { formatTrendPlunge } from './structure.js';
import { REGIME_STYLE, orthogonalizePT, radiationSign, schmidtInverse, vectorTrendPlunge } from './faultKin.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAPEL = '#ffffff';
const TINTA = '#1b2430';

/* Colores de fábrica del plugin (`style_prefs.py`). */
export const FK_COLORS = {
  plane: '#8c8c8c',
  pole: '#1a1a1a',
  striae: '#d95f02',
  p: '#fa006a',
  t: '#3d00ff',
  meanP: '#fa006a',
  meanT: '#3d00ff',
  meanB: '#2e8b57',
  nodal: '#000000',
};

/**
 * Las capas que se pueden encender, agrupadas como en el panel «Stereogram
 * layers» del plugin. `on` es el valor de fábrica (el mismo del plugin).
 */
export const FK_LAYERS = [
  {
    group: 'Fault-slip data',
    items: [
      { key: 'planes', label: 'Fault planes (great circles)', on: true },
      { key: 'poles', label: 'Poles to fault planes', on: false },
      { key: 'striae', label: 'Striae (slip lineations)', on: false },
      { key: 'striaeArrows', label: 'Hanging-wall arrow on the striae', on: true, sub: true },
      { key: 'pAxes', label: 'Per-fault P axes (shortening)', on: true },
      { key: 'tAxes', label: 'Per-fault T axes (extension)', on: true },
    ],
  },
  {
    group: 'Fault-plane solution',
    items: [
      { key: 'meanAxes', label: 'Mean axes P̄ / T̄ / B̄ (Bingham)', on: true },
      { key: 'nodalPlanes', label: 'Nodal planes (double-couple)', on: true },
      { key: 'radiation', label: 'Beachball shading (regime colour)', on: true },
    ],
  },
  {
    group: 'Stress inversion',
    items: [{ key: 'stressAxes', label: 'Stress axes σ1 / σ2 / σ3 (Michael)', on: true }],
  },
  {
    group: 'Annotation',
    items: [{ key: 'header', label: 'Header (regime, R, R′, β)', on: true }],
  },
];

export function defaultLayers() {
  const out = {};
  for (const g of FK_LAYERS) for (const it of g.items) out[it.key] = it.on;
  return out;
}

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const txt = (attrs, text) => Object.assign(el('text', attrs), { textContent: text });
const V = (a) => ({ x: a[0], y: a[1], z: a[2] });

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

/**
 * Encabezado, como el del plugin pero repartido en líneas cortas para que
 * quepa sobre la red también en un teléfono: régimen y R; misfit; n y modo.
 */
export function headerLines(sol, { dc = true } = {}) {
  if (!sol.bingham) return [];
  const style = REGIME_STYLE[sol.regime] || REGIME_STYLE.oblique;
  const l1 = [`${style.label} regime${sol.regimeSource === 'kinematic' ? ' (kinematic)' : ''}`];
  const l2 = [];
  if (sol.stress) {
    l1.push(`R = ${fmt(sol.stress.R, 3)}`);
    if (Number.isFinite(sol.RPrime)) l1.push(`R′ = ${fmt(sol.RPrime, 3)}`);
    l2.push(`mean β = ${fmt(sol.stress.meanMisfit, 1)}°`, `max β = ${fmt(sol.stress.maxMisfit, 1)}°`);
  }
  const l3 = [`n = ${sol.nOn}`];
  if (dc) l3.push('best-fit double-couple');
  if (Number.isFinite(sol.bingham.clvd)) l3.push(`CLVD ${Math.round(sol.bingham.clvd * 100)}%`);
  return [l1.join('  ·  '), l2.join('  ·  '), l3.join('  ·  ')].filter(Boolean);
}

/**
 * Dibuja la solución en un `<svg>`.
 *
 * @param {SVGElement} svg
 * @param {Array} faults todas las fallas (encendidas o no), de `faultSlipData`
 * @param {object} sol de `faultPlaneSolution`
 * @param {{layers?: object, dc?: boolean, lassoed?: Set<string>}} opts
 *   `lassoed`: ids de las fallas que el lazo tiene agarradas; sus ejes P/T y
 *   su plano se marcan y los del resto se atenúan.
 * @returns {{cx, cy, radius, placed: Array<{id, axis: 'P'|'T', x, y, drawn: boolean}>}}
 *   `placed` son los ejes P y T de cada falla encendida en coordenadas del
 *   `viewBox`, para el hit-test del lazo (`drawn`: si su capa está a la vista).
 */
export function renderFaultSolution(svg, faults, sol, { layers = defaultLayers(), dc = true, lassoed = null } = {}) {
  const width = 520;
  const height = 540;
  const radius = 205;
  const cx = width / 2;
  const cy = 300;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.replaceChildren();

  const px = (q) => `${cx + q.x * radius},${cy + q.y * radius}`;
  const proj = (v) => projectVector(V(v), 1);

  svg.appendChild(el('rect', { x: 0, y: 0, width, height, fill: PAPEL }));

  const defs = el('defs');
  const clip = el('clipPath', { id: 'fk-primitive' });
  clip.appendChild(el('circle', { cx, cy, r: radius }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  const b = sol.bingham;
  // Terna para el doble par: ortogonalizada en modo DC, cruda si no.
  let frame = null;
  if (b) frame = dc ? orthogonalizePT(b.P, b.T) : { P: b.P, T: b.T, B: b.B };
  const regime = REGIME_STYLE[sol.regime] || REGIME_STYLE.oblique;

  /* --- sombreado del beachball, debajo de todo --- */
  if (b && layers.radiation) {
    const N = 130;
    const cell = (2 * radius) / N;
    let d = '';
    const opts = dc ? { P: frame.P, T: frame.T } : { P: b.P, T: b.T, tensor: b.meanTensor };
    for (let j = 0; j < N; j++) {
      const y = -1 + (j + 0.5) * (2 / N);
      let start = -1;
      for (let i = 0; i <= N; i++) {
        let ext = false;
        if (i < N) {
          const x = -1 + (i + 0.5) * (2 / N);
          const r = Math.hypot(x, y);
          // Las celdas del borde se evalúan sobre el primitivo mismo; el
          // `clip-path` recorta lo que sobresale.
          if (r <= 1.03) {
            const k = r > 1 ? 1 / r : 1;
            ext = radiationSign(schmidtInverse(x * k, y * k), opts) > 0;
          }
        }
        if (ext && start < 0) start = i;
        if (!ext && start >= 0) {
          const x0 = cx - radius + start * cell;
          const y0 = cy - radius + j * cell;
          // Medio píxel de solape para que no queden costuras entre filas.
          d += `M${x0.toFixed(2)} ${y0.toFixed(2)}h${((i - start) * cell + 0.4).toFixed(2)}v${(cell + 0.4).toFixed(2)}h${(-((i - start) * cell + 0.4)).toFixed(2)}z`;
          start = -1;
        }
      }
    }
    const g = el('g', { class: 'fk-radiation', 'clip-path': 'url(#fk-primitive)' });
    g.appendChild(el('path', { d, fill: regime.color, opacity: 0.32, stroke: 'none' }));
    svg.appendChild(g);
  }

  svg.appendChild(net(cx, cy, radius));

  const labels = el('g', { 'font-size': 13, 'font-weight': 700, fill: TINTA });
  labels.append(
    txt({ x: cx, y: cy - radius - 14, 'text-anchor': 'middle' }, 'N'),
    txt({ x: cx + radius + 16, y: cy + 5, 'text-anchor': 'start' }, 'E'),
    txt({ x: cx, y: cy + radius + 24, 'text-anchor': 'middle' }, 'S'),
    txt({ x: cx - radius - 16, y: cy + 5, 'text-anchor': 'end' }, 'W'),
  );
  svg.appendChild(labels);

  const onSet = new Set(sol.on.map((f) => f.id));
  const visibles = faults.filter((f) => onSet.has(f.id));
  const hayLazo = !!lassoed && lassoed.size > 0;
  const enLazo = (f) => hayLazo && lassoed.has(f.id);

  /* --- planos de falla --- */
  if (layers.planes) {
    const g = el('g', { class: 'fk-planes', fill: 'none', 'stroke-linecap': 'round' });
    for (const f of visibles) {
      for (const seg of greatCirclePath(f.strike, f.dip, { R: 1, steps: 120 })) {
        g.appendChild(
          el('polyline', {
            points: seg.map(px).join(' '),
            stroke: enLazo(f) ? TINTA : FK_COLORS.plane,
            'stroke-width': enLazo(f) ? 1.8 : 1.1,
            opacity: hayLazo && !enLazo(f) ? 0.35 : 0.8,
            'data-fid': f.id,
          }),
        );
      }
    }
    svg.appendChild(g);
  }

  /* --- planos nodales del doble par (solo en modo DC, como el plugin) --- */
  if (b && dc && layers.nodalPlanes) {
    const g = el('g', { class: 'fk-nodal', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const { P, T } = frame;
    for (const pole of [
      [T[0] + P[0], T[1] + P[1], T[2] + P[2]],
      [T[0] - P[0], T[1] - P[1], T[2] - P[2]],
    ]) {
      for (const seg of smallCircleSegments(V(pole), 90, { R: 1, steps: 240 })) {
        g.appendChild(el('polyline', { points: seg.map(px).join(' '), stroke: FK_COLORS.nodal, 'stroke-width': 2 }));
      }
    }
    svg.appendChild(g);
  }

  /* --- polos --- */
  if (layers.poles) {
    const g = el('g', { class: 'fk-poles', stroke: FK_COLORS.pole, 'stroke-width': 1.4, fill: 'none' });
    for (const f of visibles) {
      const q = proj(f.normal);
      const x = cx + q.x * radius;
      const y = cy + q.y * radius;
      const r = 5;
      g.appendChild(el('path', { d: `M${x - r} ${y}H${x + r}M${x} ${y - r}V${y + r}`, 'data-fid': f.id }));
    }
    svg.appendChild(g);
  }

  /* --- estrías con la flecha del colgante (lógica de `_striae_geometry`) --- */
  if (layers.striae) {
    const g = el('g', { class: 'fk-striae', 'clip-path': 'url(#fk-primitive)' });
    const L = 0.085 * 1.6;
    for (const f of visibles) {
      const q = proj(f.slip);
      const h = Math.hypot(f.slip[0], f.slip[1]);
      const x0 = q.x;
      const y0 = q.y;
      if (h < 1e-9) {
        g.appendChild(el('circle', { cx: cx + x0 * radius, cy: cy + y0 * radius, r: 3, fill: FK_COLORS.striae, 'data-fid': f.id }));
        continue;
      }
      // Dirección EN EL PAPEL (y hacia abajo = sur) del movimiento horizontal.
      const dx = f.slip[0] / h;
      const dy = -f.slip[1] / h;
      const along = x0 * dx + y0 * dy;
      const room = -along + Math.sqrt(Math.max(0, along * along + 1 - (x0 * x0 + y0 * y0)));
      let xt;
      let yt;
      let xh;
      let yh;
      if (room >= L) [xt, yt, xh, yh] = [x0, y0, x0 + dx * L, y0 + dy * L];
      else if (room >= 0.35 * L) [xt, yt, xh, yh] = [x0, y0, x0 + dx * room, y0 + dy * room];
      else [xt, yt, xh, yh] = [x0 - dx * L, y0 - dy * L, x0, y0];
      const T = (v) => cx + v * radius;
      const U = (v) => cy + v * radius;
      const grupo = el('g', { 'data-fid': f.id });
      let hx = T(xh);
      let hy = U(yh);
      if (layers.striaeArrows) {
        const headLen = L * radius * 0.42;
        const half = headLen * 0.42;
        const bx = hx - dx * headLen;
        const by = hy - dy * headLen;
        grupo.appendChild(
          el('polygon', {
            points: `${hx},${hy} ${bx - dy * half},${by + dx * half} ${bx + dy * half},${by - dx * half}`,
            fill: FK_COLORS.striae,
          }),
        );
        hx = bx;
        hy = by;
      }
      grupo.appendChild(
        el('line', { x1: T(xt), y1: U(yt), x2: hx, y2: hy, stroke: FK_COLORS.striae, 'stroke-width': 2, 'stroke-linecap': 'round' }),
      );
      g.appendChild(grupo);
    }
    svg.appendChild(g);
  }

  /* --- ejes P (círculo) y T (cuadrado) de cada falla --- */
  const placed = [];
  for (const f of visibles) {
    for (const [axis, v, drawn] of [
      ['P', f.P, !!layers.pAxes],
      ['T', f.T, !!layers.tAxes],
    ]) {
      if (!v) continue;
      const q = proj(v);
      placed.push({ id: f.id, axis, x: cx + q.x * radius, y: cy + q.y * radius, drawn });
    }
  }
  if (layers.pAxes || layers.tAxes) {
    const g = el('g', { class: 'fk-pt' });
    // Lo lassado va al final, encima de lo atenuado.
    const orden = hayLazo ? [...placed].sort((a, b) => lassoed.has(a.id) - lassoed.has(b.id)) : placed;
    for (const d of orden) {
      if (!d.drawn) continue;
      const marcado = hayLazo && lassoed.has(d.id);
      const r = marcado ? 5.6 : 4.6;
      const estilo = {
        opacity: hayLazo && !marcado ? 0.25 : marcado ? 1 : 0.8,
        'data-fid': d.id,
        ...(marcado ? { stroke: '#000', 'stroke-width': 1.6, class: 'fk-lassoed' } : {}),
      };
      if (d.axis === 'P') g.appendChild(el('circle', { cx: d.x, cy: d.y, r, fill: FK_COLORS.p, ...estilo }));
      else {
        g.appendChild(
          el('rect', { x: d.x - r, y: d.y - r, width: 2 * r, height: 2 * r, fill: FK_COLORS.t, ...estilo }),
        );
      }
    }
    svg.appendChild(g);
  }

  /* --- ejes medios P̄ T̄ B̄ --- */
  if (b && layers.meanAxes) {
    const g = el('g', { class: 'fk-mean', 'font-size': 15, 'font-weight': 700, fill: TINTA });
    const r = 11;
    for (const [label, color, shape, v] of [
      ['P̄', FK_COLORS.meanP, 'circle', frame.P],
      ['T̄', FK_COLORS.meanT, 'square', frame.T],
      ['B̄', FK_COLORS.meanB, 'triangle', frame.B],
    ]) {
      const q = proj(v);
      const x = cx + q.x * radius;
      const y = cy + q.y * radius;
      const st = { fill: color, stroke: '#000', 'stroke-width': 1.6 };
      if (shape === 'circle') g.appendChild(el('circle', { cx: x, cy: y, r, ...st }));
      else if (shape === 'square') g.appendChild(el('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, ...st }));
      else g.appendChild(el('polygon', { points: `${x},${y - r * 1.15} ${x - r},${y + r * 0.6} ${x + r},${y + r * 0.6}`, ...st }));
      g.appendChild(
        txt({ x: x + 14, y: y + 5, stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke' }, label),
      );
    }
    svg.appendChild(g);
  }

  /* --- σ1 σ2 σ3 --- */
  if (sol.stress && layers.stressAxes) {
    const g = el('g', { class: 'fk-stress', 'font-size': 15, 'font-weight': 700, fill: TINTA });
    for (const [label, v, fc] of [
      ['σ1', sol.stress.sigma1, '#000000'],
      ['σ2', sol.stress.sigma2, '#888888'],
      ['σ3', sol.stress.sigma3, '#ffffff'],
    ]) {
      const q = proj(v);
      const x = cx + q.x * radius;
      const y = cy + q.y * radius;
      g.appendChild(el('circle', { cx: x, cy: y, r: 9, fill: fc, stroke: '#000', 'stroke-width': 2 }));
      // A la IZQUIERDA: los ejes medios rotulan a la derecha, y σ1/P̄,
      // σ3/T̄ suelen caer casi en el mismo punto.
      g.appendChild(
        txt({ x: x - 12, y: y - 7, 'text-anchor': 'end', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke' }, label),
      );
    }
    svg.appendChild(g);
  }

  /* --- encabezado --- */
  if (layers.header) {
    const lines = headerLines(sol, { dc });
    const g = el('g', { class: 'fk-header', fill: TINTA, 'text-anchor': 'middle', 'font-family': 'Helvetica, Arial, sans-serif' });
    if (lines.length) {
      lines.forEach((line, i) =>
        g.appendChild(
          txt(
            { x: cx, y: 22 + i * 19, 'font-size': i === 0 ? 15 : 12.5, 'font-weight': i === 0 ? 700 : 400, fill: i === 0 ? TINTA : '#4a5766' },
            line,
          ),
        ),
      );
    } else {
      g.appendChild(txt({ x: cx, y: 30, 'font-size': 13, fill: '#4a5766' }, 'No fault with full datum switched on'));
    }
    svg.appendChild(g);
  }

  return { cx, cy, radius, placed };
}

/** Un eje como en la libreta, `12→245` (plunge→trend), igual que las estrías. */
export function tp(v) {
  const { trend, plunge } = vectorTrendPlunge(v);
  return formatTrendPlunge(trend, plunge);
}
