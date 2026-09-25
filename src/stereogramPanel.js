/**
 * La pestaña Stereogram: construirla, dibujarla, el lazo propio y la
 * exportación. Vive en su módulo por el mismo motivo que el corte
 * estructural — es una vista entera con ciclo propio— y para no acoplar la
 * lectura de sensores del teléfono (pestaña Compass) al resto de `ui.js`.
 */

import * as store from './store.js';
import { STRUCTURE_TYPES } from './symbology.js';
import { betaAxis, countsByType, meanPole, stereogramData } from './stereogram.js';
import { renderStereogram, stereogramPNG, stereogramSVG } from './stereogramView.js';
import { buildCompass } from './compassWidget.js';
import { formatStrikeDip, quadrant } from './structure.js';
import {
  deviceOrientationSupported,
  needsOrientationPermission,
  requestOrientationPermission,
  startHeadingCapture,
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
/** Qué familias se dibujan. Las dos encendidas de salida: ver `renderStereogram`. */
let showPoles = true;
let showPlanes = true;
/** El vector medio se pide, no se da de fábrica: no todo cúmulo tiene uno que
 * signifique algo, y encenderlo de entrada lo pondría a competir con el
 * cúmulo mismo apenas se abre la pestaña. */
let showMean = false;
/** El eje beta, lo mismo: apagado de salida por la misma razón. */
let showBeta = false;
/** Líneas (estría, L₁) y flechas del colgante: parte del dato, encendidas. */
let showLines = true;

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

  $('stereo-show-poles').addEventListener('change', (e) => {
    showPoles = e.target.checked;
    renderPlot();
  });
  $('stereo-show-planes').addEventListener('change', (e) => {
    showPlanes = e.target.checked;
    renderPlot();
  });
  $('stereo-show-lines').addEventListener('change', (e) => {
    showLines = e.target.checked;
    renderPlot();
  });
  $('stereo-show-mean').addEventListener('change', (e) => {
    showMean = e.target.checked;
    renderPlot();
  });
  $('stereo-show-beta').addEventListener('change', (e) => {
    showBeta = e.target.checked;
    renderPlot();
  });

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
  // El vector medio y el eje beta se calculan del cúmulo que el lazo tiene
  // marcado, si hay algo lassado — es la forma directa de promediar solo un
  // subconjunto sin pasar por «Select these on the map» y reabrir la
  // pestaña—, y si no del mismo cúmulo que se está mirando: la selección del
  // mapa, o todo si no hay ninguna. Nunca de los tipos que la leyenda deja
  // fuera: mezclar estratificación y diaclasas en un solo promedio daría un
  // rumbo y manteo que no describe ninguna de las dos fábricas.
  const usandoLazo = highlighted.size > 0;
  const statSource = usandoLazo ? data.points.filter((p) => highlighted.has(p.id)) : data.points;
  const media = meanPole(statSource);
  const beta = betaAxis(statSource);
  lastPlot = renderStereogram($('stereo-chart'), data.points, {
    highlighted,
    showPoles,
    showPlanes,
    showMean,
    meanVector: media,
    showBeta,
    betaVector: beta,
    showLines,
  });

  $('stereo-source-note').textContent = data.usingSelection
    ? `Plotting ${data.points.length} of ${data.total} measurement(s) — the current map selection.`
    : `Plotting all ${data.total} measurement(s) — select some on the map to plot only those.`;

  const deQue = usandoLazo ? ` of the ${statSource.length} lassoed` : '';
  const meanValue = $('stereo-mean-value');
  if (showMean && media) {
    const cono = Number.isFinite(media.alpha95) ? ` · α95 = ${media.alpha95.toFixed(1)}°` : '';
    meanValue.textContent =
      `Mean vector${deQue}: ${formatStrikeDip(media.strike, media.dip)} · dips ${quadrant(media.dipAzimuth)} · R = ${media.r.toFixed(2)}${cono} (n = ${media.n})`;
    meanValue.classList.remove('hidden');
  } else if (showMean) {
    // Casilla encendida pero nada que promediar: sin puntos, o con un cúmulo
    // tan disperso que el vector medio se cancela — se dice por qué en vez
    // de dejar el hueco en blanco.
    meanValue.textContent =
      statSource.length === 0
        ? 'Mean vector: no measurements plotted.'
        : 'Mean vector: the poles are too scattered to average.';
    meanValue.classList.remove('hidden');
  } else {
    meanValue.classList.add('hidden');
  }

  const betaValue = $('stereo-beta-value');
  if (showBeta && beta) {
    betaValue.textContent =
      `Beta axis${deQue}: trend/plunge ${Math.round(beta.trend)}/${Math.round(beta.plunge)} · girdle fit ${Math.round(beta.girdle * 100)}% (n = ${beta.n})`;
    betaValue.classList.remove('hidden');
  } else if (showBeta) {
    betaValue.textContent = 'Beta axis: needs at least 2 planes to intersect.';
    betaValue.classList.remove('hidden');
  } else {
    betaValue.classList.add('hidden');
  }

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
  const nLineas = data.points.filter((p) => p.line).length;
  if (nLineas > 0) {
    const row = document.createElement('div');
    row.className = 'sv-row';
    const sw = document.createElement('span');
    sw.className = 'sv-swatch sv-swatch-square';
    const what = document.createElement('span');
    what.className = 'sv-what';
    const flechas = data.points.filter((p) => p.line && p.line.arrow).length;
    what.textContent = flechas
      ? 'Lines · arrow = hanging-wall slip'
      : 'Lines (striae, L₁)';
    const num = document.createElement('span');
    num.className = 'sv-num';
    num.textContent = String(nLineas);
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
    // Esta pestaña es una brújula de referencia, no una medida: solo el
    // ángulo desde el norte al que apunta el teléfono, sostenido como
    // cualquier brújula — a ras, no contra una roca.
    note.textContent = 'Hold the phone flat, screen up, pointing the way you want to read.';
    stopCompassCapture = startHeadingCapture({
      onReading: (r) => compassWidget.update(r),
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
