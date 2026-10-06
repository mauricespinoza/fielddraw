/**
 * Tiempo de marcha sobre el perfil topográfico.
 *
 * Se pincha un punto del perfil (el origen) y se arrastra el dedo o el lápiz:
 * el tramo hasta el punto activo se pinta en el gráfico y también en el MAPA
 * —origen, recorrido y llegada—, para ver hasta dónde llega lo que se está
 * midiendo. El cálculo está en `hiking.js`; aquí solo hay interfaz.
 */

import * as store from './store.js';
import { LEVELS, formatDuration, walkingTime } from './hiking.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

const walk = { active: false, level: 'normal', dragging: false };
let getChart = () => null;

const mk = (name, attrs = {}) => {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

export const isWalkActive = () => walk.active;

export function initProfileWalk({ chart }) {
  getChart = chart;
  const svg = $('profile-chart');

  $('btn-profile-walk').addEventListener('click', () => {
    walk.active = !walk.active;
    walk.dragging = false;
    store.setProfileWalk(null);
    $('btn-profile-walk').classList.toggle('active', walk.active);
    $('profile-levels').classList.toggle('hidden', !walk.active);
    $('profile-walk-hint').classList.toggle('hidden', !walk.active);
    svg.classList.toggle('walking', walk.active);
    updateLevels();
    drawWalkOverlay();
  });

  for (const b of document.querySelectorAll('#profile-levels .sv-level')) {
    b.addEventListener('click', () => {
      walk.level = b.dataset.level;
      const w = store.getState().profileWalk;
      if (w) store.setProfileWalk({ ...w, level: walk.level });
      updateLevels();
      drawWalkOverlay();
    });
  }

  const sAt = (e) => {
    const chart = getChart();
    const result = store.getState().profile;
    if (!chart || !result) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    const px = ((e.clientX - rect.left) / rect.width) * chart.width;
    return Math.min(chart.scales.total, Math.max(0, chart.scales.distanceAt(px)));
  };

  svg.addEventListener('pointerdown', (e) => {
    if (!walk.active) return;
    const s = sAt(e);
    if (s === null) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    walk.dragging = true;
    store.setProfileWalk({ from: s, to: s, level: walk.level });
    drawWalkOverlay();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!walk.active || !walk.dragging) return;
    const s = sAt(e);
    const w = store.getState().profileWalk;
    if (s === null || !w) return;
    store.setProfileWalk({ ...w, to: s });
    drawWalkOverlay();
  });
  const end = () => {
    walk.dragging = false;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

function updateLevels() {
  for (const b of document.querySelectorAll('#profile-levels .sv-level')) {
    b.classList.toggle('active', b.dataset.level === walk.level);
  }
}

/** Repinta el tramo y su burbuja sobre el gráfico actual. */
export function drawWalkOverlay() {
  const svg = $('profile-chart');
  const old = svg.querySelector('#walk-overlay');
  if (old) old.remove();
  const hint = $('profile-walk-hint');
  const chart = getChart();
  const result = store.getState().profile;
  const w = store.getState().profileWalk;
  if (!walk.active || !chart || !result) return;
  if (!w) {
    hint.textContent = 'Press a point on the profile, then drag.';
    return;
  }

  const L = LEVELS[w.level] || LEVELS.normal;
  const sc = chart.scales;
  const ida = walkingTime(result.samples, w.from, w.to, w.level);
  const vuelta = walkingTime(result.samples, w.to, w.from, w.level);
  const g = mk('g', { id: 'walk-overlay', 'pointer-events': 'none' });

  const lo = Math.min(w.from, w.to);
  const hi = Math.max(w.from, w.to);
  const cota = (s) => {
    let best = null;
    for (const m of result.samples) {
      if (!best || Math.abs(m.distance - s) < Math.abs(best.distance - s)) best = m;
    }
    return best ? best.elevation : NaN;
  };
  const trazo = [
    { distance: lo, elevation: cota(lo) },
    ...result.samples.filter((m) => m.distance > lo && m.distance < hi),
    { distance: hi, elevation: cota(hi) },
  ];
  let d = '';
  for (const m of trazo) {
    if (!Number.isFinite(m.elevation)) continue;
    d += `${d ? ' L' : 'M'}${sc.x(m.distance).toFixed(1)} ${sc.y(m.elevation).toFixed(1)}`;
  }
  if (d) {
    g.appendChild(mk('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.9 }));
    g.appendChild(mk('path', { d, fill: 'none', stroke: L.color, 'stroke-width': 4.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  const marca = (s, fill, r) => {
    const z = cota(s);
    if (!Number.isFinite(z)) return null;
    g.appendChild(mk('circle', { cx: sc.x(s), cy: sc.y(z), r, fill, stroke: '#fff', 'stroke-width': 2 }));
    return { x: sc.x(s), y: sc.y(z) };
  };
  marca(w.from, '#374151', 5);
  const punta = marca(w.to, L.color, 7);

  if (!ida) {
    hint.textContent = 'Part of that stretch has no elevation data.';
  } else {
    const tiempo = formatDuration(ida.minutes);
    const km = `${(ida.distance / 1000).toFixed(2)} km`;
    hint.textContent =
      `${L.label}: ${tiempo} · ${km} · ↑${Math.round(ida.ascent)} m ↓${Math.round(ida.descent)} m` +
      (vuelta ? ` · return ${formatDuration(vuelta.minutes)}` : '');
    if (punta) {
      const l1 = `⏱ ${tiempo}`;
      const l2 = `${km} · return ${vuelta ? formatDuration(vuelta.minutes) : '—'}`;
      const ancho = Math.max(l2.length * 6.2, 90) + 16;
      const alto = 36;
      const W = chart.width;
      const bx = Math.min(Math.max(punta.x - ancho / 2, 2), Math.max(2, W - ancho - 2));
      let by = punta.y - alto - 14;
      if (by < 2) by = punta.y + 14;
      g.appendChild(mk('rect', { x: bx, y: by, width: ancho, height: alto, rx: 8, fill: '#111827', stroke: L.color, 'stroke-width': 2, opacity: 0.95 }));
      const t = (txt, y, size, weight, fill) => {
        const n = mk('text', { x: bx + 8, y: by + y, 'font-size': size, 'font-weight': weight, fill });
        n.textContent = txt;
        g.appendChild(n);
      };
      t(l1, 16, 13.5, 700, L.color);
      t(l2, 30, 10.5, 400, '#e5e7eb');
    }
  }
  svg.appendChild(g);
}
