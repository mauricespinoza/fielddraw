/**
 * La pestaña Stereogram: construirla, dibujarla, el lazo propio y la
 * exportación. Vive en su módulo por el mismo motivo que el corte
 * estructural — es una vista entera con ciclo propio— y para no acoplar la
 * lectura de sensores del teléfono (pestaña Compass) al resto de `ui.js`.
 */

import * as store from './store.js';
import { STRUCTURE_TYPES } from './symbology.js';
import { countsByType, stereogramData } from './stereogram.js';
import { renderStereogram, stereogramPNG, stereogramSVG } from './stereogramView.js';
import { buildCompass } from './compassWidget.js';
import {
  deviceOrientationSupported,
  needsOrientationPermission,
  requestOrientationPermission,
  startOrientationCapture,
} from './deviceOrientation.js';
import { downloadBlob } from './persistence.js';

const $ = (id) => document.getElementById(id);

let onMessage = () => {};
let panelOpen = false;
let activeTab = 'plot';
/** Última tanda dibujada, para el hit-test del lazo. */
let lastPlot = null;
/** Ids resaltados por el lazo, o vacío si no hay ninguno. */
let highlighted = new Set();

export function initStereogramPanel({ message } = {}) {
  onMessage = message || onMessage;

  $('btn-stereogram').addEventListener('click', () => (panelOpen ? closeStereogram() : openStereogram()));
  $('btn-close-stereo').addEventListener('click', closeStereogram);

  $('stereo-tab-plot').addEventListener('click', () => showTab('plot'));
  $('stereo-tab-compass').addEventListener('click', () => showTab('compass'));

  $('btn-stereo-svg').addEventListener('click', exportSVG);
  $('btn-stereo-png').addEventListener('click', exportPNG);
  $('btn-stereo-copy').addEventListener('click', copyToClipboard);

  $('btn-stereo-select-map').addEventListener('click', () => {
    store.setSelection([...highlighted]);
    onMessage(`${highlighted.size} measurement(s) selected on the map.`, 'info');
  });
  $('btn-stereo-clear-lasso').addEventListener('click', clearHighlight);

  wireLasso();

  store.subscribe(() => {
    if (!panelOpen) return;
    if (store.changed('features') || store.changed('selection') || store.changed('ornaments')) {
      renderPlot();
    }
  });
}

/* ---------- abrir / cerrar / pestañas ---------- */

function openStereogram() {
  panelOpen = true;
  $('stereo-view').classList.remove('hidden');
  showTab('plot');
}

export function closeStereogram() {
  panelOpen = false;
  $('stereo-view').classList.add('hidden');
  stopCompass();
  clearHighlight();
}

/** Para el Escape en cascada de `ui.js`: la red tapa la pantalla entera. */
export function isStereogramOpen() {
  return panelOpen;
}

function showTab(tab) {
  activeTab = tab;
  $('stereo-tab-plot').classList.toggle('active', tab === 'plot');
  $('stereo-tab-compass').classList.toggle('active', tab === 'compass');
  $('stereo-panel-plot').classList.toggle('hidden', tab !== 'plot');
  $('stereo-panel-compass').classList.toggle('hidden', tab !== 'compass');
  if (tab === 'compass') startCompass();
  else stopCompass();
  if (tab === 'plot') renderPlot();
}

/* ---------- pestaña Plot ---------- */

function renderPlot() {
  const st = store.getState();
  const data = stereogramData(st.features, st.selection);
  lastPlot = renderStereogram($('stereo-chart'), data.points, { highlighted });

  $('stereo-source-note').textContent = data.usingSelection
    ? `Plotting ${data.points.length} of ${data.total} measurement(s) — the current map selection.`
    : `Plotting all ${data.total} measurement(s) — select some on the map to plot only those.`;

  const counts = countsByType(data.points);
  const legend = $('stereo-legend');
  legend.replaceChildren();
  for (const t of STRUCTURE_TYPES) {
    const n = counts.get(t.id) || 0;
    if (n === 0) continue;
    const row = document.createElement('div');
    row.className = 'sv-row';
    const sw = document.createElement('span');
    sw.className = 'sv-swatch';
    sw.style.background = t.color;
    const what = document.createElement('span');
    what.className = 'sv-what';
    what.textContent = t.label;
    const num = document.createElement('span');
    num.className = 'sv-num';
    num.textContent = String(n);
    row.append(sw, what, num);
    legend.appendChild(row);
  }
  $('stereo-legend-count').textContent = `${data.points.length}`;

  $('btn-stereo-select-map').disabled = highlighted.size === 0;
  $('btn-stereo-clear-lasso').disabled = highlighted.size === 0;
}

function clearHighlight() {
  if (highlighted.size === 0) return;
  highlighted = new Set();
  renderPlot();
}

/* ---------- lazo sobre la red ---------- */

/** Convierte un punto del cliente a coordenadas del `viewBox` del SVG. */
function toSvgPoint(svg, clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return [
    ((clientX - rect.left) / rect.width) * vb.width + vb.x,
    ((clientY - rect.top) / rect.height) * vb.height + vb.y,
  ];
}

/** Punto en polígono, rayo hacia +x — el de siempre, sin dependencias. */
function pointInPolygon(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cruza = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (cruza) inside = !inside;
  }
  return inside;
}

function wireLasso() {
  const svg = $('stereo-lasso');
  const shape = svg.querySelector('polygon');
  let path = null;

  svg.addEventListener('pointerdown', (e) => {
    if (!lastPlot) return;
    svg.setPointerCapture(e.pointerId);
    path = [toSvgPoint(svg, e.clientX, e.clientY)];
    shape.setAttribute('points', '');
  });

  svg.addEventListener('pointermove', (e) => {
    if (!path) return;
    const p = toSvgPoint(svg, e.clientX, e.clientY);
    const last = path[path.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return; // ralo, como el lazo del mapa
    path.push(p);
    shape.setAttribute('points', path.map((q) => `${q[0]},${q[1]}`).join(' '));
  });

  const finish = () => {
    if (!path) return;
    if (path.length >= 3 && lastPlot) {
      highlighted = new Set(lastPlot.placed.filter((d) => pointInPolygon([d.x, d.y], path)).map((d) => d.id));
      renderPlot();
    }
    path = null;
    shape.setAttribute('points', '');
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
}

/* ---------- pestaña Compass ---------- */

let stopCompassCapture = null;
let compassWidget = null;

function startCompass() {
  if (stopCompassCapture) return;
  if (!compassWidget) compassWidget = buildCompass($('stereo-compass'));

  const note = $('stereo-compass-note');
  const begin = () => {
    if (activeTab !== 'compass' || !panelOpen) return;
    note.textContent = 'Hold the phone flat against a surface to read it.';
    stopCompassCapture = startOrientationCapture({
      onReading: (r) => {
        compassWidget.update(r);
        if (r && r.ready) {
          note.textContent = `${r.n} sample(s) · ±${Math.round(r.strikeSd * 10) / 10}° strike, ±${Math.round(r.dipSd * 10) / 10}° dip`;
        }
      },
      onError: (msg) => {
        note.textContent = msg;
      },
    });
  };

  if (!deviceOrientationSupported()) {
    note.textContent = 'This device or browser has no orientation sensor available.';
    return;
  }
  if (needsOrientationPermission()) {
    note.textContent = 'Requesting sensor access…';
    requestOrientationPermission().then((granted) => {
      if (granted) begin();
      else note.textContent = 'Motion & orientation access was not granted.';
    });
  } else {
    begin();
  }
}

function stopCompass() {
  if (stopCompassCapture) {
    stopCompassCapture();
    stopCompassCapture = null;
  }
  if (compassWidget) compassWidget.update(null);
}

/* ---------- exportación ---------- */

const fileBase = () => `fielddraw-stereogram-${new Date().toISOString().slice(0, 10)}`;

function exportSVG() {
  downloadBlob(new Blob([stereogramSVG($('stereo-chart'))], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  onMessage('Stereogram exported as SVG — editable in Illustrator or Inkscape.', 'info');
}

async function exportPNG() {
  try {
    const blob = await stereogramPNG($('stereo-chart'), { scale: 2 });
    downloadBlob(blob, `${fileBase()}.png`);
    onMessage('Stereogram exported as PNG at twice the on-screen size.', 'info');
  } catch (err) {
    onMessage(`Could not render the image: ${err.message}`);
  }
}

async function copyToClipboard() {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    onMessage('This browser cannot copy images to the clipboard — use PNG or SVG instead.', 'warn');
    return;
  }
  try {
    const blob = await stereogramPNG($('stereo-chart'), { scale: 2 });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    onMessage('Stereogram copied to the clipboard.', 'info');
  } catch (err) {
    onMessage(`Could not copy the image: ${err.message}`, 'warn');
  }
}
