/**
 * Dibujo a mano sobre el perfil estructural: lápices, colores, grosor y goma.
 *
 * Los trazos se guardan en coordenadas del corte (distancia, cota) y no en
 * píxeles: acompañan al perfil al cambiar la exageración o el tamaño de la
 * ventana, se guardan con el perfil y salen en el SVG/PNG. La goma borra
 * trazos enteros al tocarlos —no píxeles—, que es lo que se espera de un
 * dibujo vectorial y se puede deshacer con "Undo".
 */

import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

export const PENS = {
  pencil: { width: 1.5, alpha: 1 },
  pen: { width: 3, alpha: 1 },
  marker: { width: 7, alpha: 0.9 },
  highlighter: { width: 16, alpha: 0.35 },
};

const COLORS = ['#111827', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#9333ea', '#db2777', '#92400e'];

const ink = { active: false, pen: 'pencil', color: '#111827', width: 2, alpha: 1, erasing: false };
let getScales = () => null;
let live = null;
let livePts = null;

export const isInkActive = () => ink.active;

export function initSectionInk({ scales }) {
  getScales = scales;
  const svg = $('section-chart');

  const box = $('ink-colors');
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'ink-swatch';
    b.style.background = c;
    b.dataset.color = c;
    b.title = c;
    b.addEventListener('click', () => setColor(c));
    box.appendChild(b);
  }
  $('ink-color').addEventListener('input', (e) => setColor(e.target.value));
  $('ink-width').addEventListener('input', (e) => {
    ink.width = Number(e.target.value);
  });
  for (const b of document.querySelectorAll('#ink-pens .ink-pen')) {
    b.addEventListener('click', () => {
      ink.pen = b.dataset.pen;
      ink.erasing = false;
      ink.width = PENS[ink.pen].width;
      ink.alpha = PENS[ink.pen].alpha;
      $('ink-width').value = String(ink.width);
      refresh();
    });
  }
  $('ink-eraser').addEventListener('click', () => {
    ink.erasing = !ink.erasing;
    refresh();
  });
  $('ink-undo').addEventListener('click', () => store.undoInkStroke());
  $('ink-clear').addEventListener('click', () => store.clearInk());
  $('btn-section-draw').addEventListener('click', () => {
    ink.active = !ink.active;
    $('btn-section-draw').classList.toggle('active', ink.active);
    $('section-ink').classList.toggle('hidden', !ink.active);
    refresh();
  });

  svg.addEventListener('pointerdown', (e) => {
    if (!ink.active) return;
    const sc = getScales();
    if (!sc) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    if (ink.erasing) {
      erase(e);
      livePts = 'erase';
      return;
    }
    livePts = [toData(e, sc)];
    live = document.createElementNS(SVGNS, 'path');
    for (const [k, v] of Object.entries({
      fill: 'none', stroke: ink.color, 'stroke-width': ink.width, opacity: ink.alpha,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none',
    })) live.setAttribute(k, v);
    svg.appendChild(live);
    drawLive(sc);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!ink.active || !livePts) return;
    if (livePts === 'erase') {
      erase(e);
      return;
    }
    const sc = getScales();
    const p = toData(e, sc);
    const last = livePts[livePts.length - 1];
    // Se descarta lo que apenas se movió: un lápiz genera cientos de puntos.
    if (Math.hypot(sc.x(p[0]) - sc.x(last[0]), sc.y(p[1]) - sc.y(last[1])) < 1.2) return;
    livePts.push(p);
    drawLive(sc);
  });
  const end = () => {
    if (Array.isArray(livePts) && livePts.length) {
      store.addInkStroke({
        id: `ink-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
        color: ink.color,
        width: ink.width,
        alpha: ink.alpha,
        pts: livePts.map((q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]),
      });
    }
    if (live) live.remove();
    live = null;
    livePts = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  refresh();
}

function setColor(c) {
  ink.color = c;
  ink.erasing = false;
  $('ink-color').value = c;
  refresh();
}

function refresh() {
  for (const b of document.querySelectorAll('#ink-pens .ink-pen')) {
    b.classList.toggle('active', !ink.erasing && b.dataset.pen === ink.pen);
  }
  $('ink-eraser').classList.toggle('active', ink.erasing);
  for (const b of document.querySelectorAll('#ink-colors .ink-swatch')) {
    b.classList.toggle('active', b.dataset.color === ink.color);
  }
  const svg = $('section-chart');
  svg.classList.toggle('inking', ink.active && !ink.erasing);
  svg.classList.toggle('erasing', ink.active && ink.erasing);
}

function toData(e, sc) {
  const r = $('section-chart').getBoundingClientRect();
  return [sc.sAt(e.clientX - r.left), sc.zAt(e.clientY - r.top)];
}

function drawLive(sc) {
  live.setAttribute(
    'd',
    livePts.length === 1
      ? `M${sc.x(livePts[0][0])} ${sc.y(livePts[0][1])} l0.1 0`
      : livePts.map((q, i) => `${i ? 'L' : 'M'}${sc.x(q[0]).toFixed(1)} ${sc.y(q[1]).toFixed(1)}`).join(' '),
  );
}

/** Distancia (px) de un punto a un segmento. */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function erase(e) {
  const sec = store.getState().section;
  const sc = getScales();
  if (!sec || !sc) return;
  const r = $('section-chart').getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  const quitar = [];
  for (const t of sec.ink || []) {
    const reach = 8 + t.width / 2;
    const xy = t.pts.map((q) => [sc.x(q[0]), sc.y(q[1])]);
    let hit = xy.length === 1 && Math.hypot(px - xy[0][0], py - xy[0][1]) <= reach;
    for (let i = 1; i < xy.length && !hit; i++) {
      hit = distSeg(px, py, xy[i - 1][0], xy[i - 1][1], xy[i][0], xy[i][1]) <= reach;
    }
    if (hit) quitar.push(t.id);
  }
  if (quitar.length) store.removeInkStrokes(quitar);
}
