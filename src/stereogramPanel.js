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
import { buildCompass, compassHealthNote } from './compassWidget.js';
import { openCompassCheck } from './compassCheck.js';
import {
  WMM_NAME,
  activeDeclination,
  formatDeclination,
  geomagneticField,
  declinationHere,
  getTrueNorth,
  noteDeclinationPosition,
  setTrueNorth,
} from './geomag.js';
import { formatStrikeDip, quadrant } from './structure.js';
import {
  deviceOrientationSupported,
  needsOrientationPermission,
  requestOrientationPermission,
  startHeadingCapture,
} from './deviceOrientation.js';
import { downloadBlob } from './persistence.js';
import { averageMeasurements } from './average.js';
import { formatLat, formatLon, formatUTM, toUTM } from './utm.js';

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
/**
 * Tipos de estructura que la leyenda tiene apagados. Se recuerdan mientras
 * dura la sesión —cerrar y reabrir la red no los vuelve a encender—: quien
 * filtra para ver solo la estratificación lo hace para varias vueltas.
 */
const hiddenTypes = new Set();

/** Lo que se grafica ahora mismo: selección del mapa, y filtro por tipo. */
const currentData = () => {
  const st = store.getState();
  return stereogramData(st.features, st.selection, { hiddenTypes });
};

export function initStereogramPanel({ message } = {}) {
  onMessage = message || onMessage;

  $('btn-stereogram').addEventListener('click', () => (panelOpen ? closeStereogram() : openStereogram()));
  $('btn-close-stereo').addEventListener('click', closeStereogram);

  $('stereo-tab-plot').addEventListener('click', () => showTab('plot'));
  $('stereo-tab-compass').addEventListener('click', () => showTab('compass'));
  $('stereo-tab-position').addEventListener('click', () => showTab('position'));
  $('btn-stereo-check-compass').addEventListener('click', () => openCompassCheck());
  /*
   * Norte verdadero o magnético: una sola preferencia, con su casilla aquí y
   * en el panel Device. Cambiarla en una refresca las dos (evento
   * `fielddraw:truenorth`, que también escucha ui.js).
   */
  $('pos-true-north').checked = getTrueNorth();
  $('pos-true-north').addEventListener('change', (e) => {
    setTrueNorth(e.target.checked);
    window.dispatchEvent(new Event('fielddraw:truenorth'));
  });
  window.addEventListener('fielddraw:truenorth', () => {
    $('pos-true-north').checked = getTrueNorth();
    renderDeclinationNote();
  });
  for (const b of document.querySelectorAll('.pos-copy')) {
    b.addEventListener('click', () => {
      const text = posRaw[b.dataset.copy];
      if (!text) return;
      navigator.clipboard?.writeText(text).then(
        () => onMessage(`Copied ${text}`, 'info'),
        () => onMessage('Could not copy — select the value and copy it by hand.', 'warn'),
      );
    });
  }

  $('btn-stereo-svg').addEventListener('click', exportSVG);
  $('btn-stereo-png').addEventListener('click', exportPNG);
  $('btn-stereo-copy').addEventListener('click', copyToClipboard);

  $('btn-stereo-select-map').addEventListener('click', () => {
    store.setSelection([...highlighted]);
    onMessage(`${highlighted.size} measurement(s) selected on the map.`, 'info');
  });
  $('btn-stereo-clear-lasso').addEventListener('click', clearHighlight);
  $('btn-stereo-average').addEventListener('click', createAverage);

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
  stopPosition();
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
  $('stereo-tab-position').classList.toggle('active', tab === 'position');
  $('stereo-panel-position').classList.toggle('hidden', tab !== 'position');
  if (tab === 'compass') startCompass();
  else stopCompass();
  if (tab === 'position') startPosition();
  else stopPosition();
  if (tab === 'plot') renderPlot();
}

/* ---------- pestaña Plot ---------- */

function renderPlot() {
  const data = currentData();
  // Lo lassado que el filtro acaba de esconder deja de contar: no se puede
  // promediar ni mandar al mapa algo que no se ve en la red.
  if (highlighted.size > 0) {
    const visibles = new Set(data.points.map((p) => p.id));
    const quedan = [...highlighted].filter((id) => visibles.has(id));
    if (quedan.length !== highlighted.size) highlighted = new Set(quedan);
  }
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

  const filtrados = data.available.length - data.points.length;
  const partes = [
    data.usingSelection
      ? `Plotting ${data.points.length} of ${data.total} measurement(s) — the structural data in the current map selection.`
      : `Plotting ${data.points.length} of ${data.total} measurement(s) — select some on the map to plot only those.`,
  ];
  if (data.selectedOther > 0) {
    partes.push(`${data.selectedOther} other selected feature(s) left out — only dip measurements have a pole to plot.`);
  }
  if (filtrados > 0) partes.push(`${filtrados} hidden by the type filter.`);
  $('stereo-source-note').textContent = partes.join(' ');

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

  // La leyenda es también el filtro: una casilla por tipo presente en lo que
  // se está mirando, contada ANTES de filtrar para que un tipo apagado siga
  // ahí y se pueda volver a encender.
  const counts = countsByType(data.available);
  const legend = $('stereo-legend');
  legend.replaceChildren();
  const tipos = [...STRUCTURE_TYPES];
  for (const id of counts.keys()) {
    if (!tipos.some((t) => t.id === id)) {
      const p = data.available.find((q) => q.type === id);
      tipos.push({ id, label: p ? p.typeLabel : String(id), color: p ? p.color : '#9aa4b2' });
    }
  }
  for (const t of tipos) {
    const n = counts.get(t.id) || 0;
    if (n === 0) continue;
    const on = !hiddenTypes.has(t.id);
    const row = document.createElement('label');
    row.className = `sv-row sv-filter${on ? '' : ' off'}`;
    row.title = on ? `Hide ${t.label} from the net` : `Show ${t.label} on the net`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = on;
    cb.addEventListener('change', () => {
      if (cb.checked) hiddenTypes.delete(t.id);
      else hiddenTypes.add(t.id);
      renderPlot();
    });
    const sw = document.createElement('span');
    sw.className = 'sv-swatch';
    sw.style.background = t.color;
    const what = document.createElement('span');
    what.className = 'sv-what';
    what.textContent = t.label;
    const num = document.createElement('span');
    num.className = 'sv-num';
    num.textContent = String(n);
    row.append(cb, sw, what, num);
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
  $('stereo-legend-count').textContent =
    data.points.length === data.available.length
      ? `${data.points.length}`
      : `${data.points.length} / ${data.available.length}`;

  $('btn-stereo-average').disabled = (usandoLazo ? statSource.length : data.points.length) < 2;
  $('btn-stereo-select-map').disabled = highlighted.size === 0;
  $('btn-stereo-clear-lasso').disabled = highlighted.size === 0;
}

/**
 * Crea el plano promedio de lo que se está mirando —lo lassado si hay algo,
 * si no lo graficado— y pregunta si los datos originales se quitan. Todo en
 * un solo paso de historial: deshacer devuelve los originales y quita el
 * promedio juntos.
 */
function createAverage() {
  const st = store.getState();
  const data = currentData();
  const ids = new Set(
    highlighted.size > 0 ? [...highlighted] : data.points.map((p) => p.id),
  );
  const fuente = st.features.filter((f) => ids.has(f.properties.id));
  const avg = averageMeasurements(fuente);
  if (!avg || avg.n < 2) {
    onMessage(
      avg ? 'Select at least two planes to average.' : 'The poles are too scattered to average.',
      'warn',
    );
    return;
  }
  const quitar = confirm(
    `Average of ${avg.n} planes: ${formatStrikeDip(avg.strike, avg.dip)}` +
      ` (SD strike ±${avg.strikeSd}°, dip ±${avg.dipSd}°).\n\n` +
      'Delete the original measurements?\n\nOK = replace them with the average · Cancel = keep them and add the average.',
  );
  const f = store.createMeasurement({
    lngLat: avg.lngLat,
    strike: avg.strike,
    dip: avg.dip,
    type: avg.type,
    overturned: avg.overturned,
    faultSense: avg.faultSense,
    unitId: avg.unitId,
    line: null,
    method: 'average',
    note: avg.notes,
    quality: { avgN: avg.n, avgStrikeSd: avg.strikeSd, avgDipSd: avg.dipSd },
    removeIds: quitar ? avg.sourceIds : [],
  });
  highlighted = new Set();
  onMessage(
    `Average plane ${formatStrikeDip(f.properties.strike, f.properties.dip)} created from ${avg.n} measurements` +
      `${quitar ? ' (originals deleted — undo restores them)' : ''}.`,
    'info',
  );
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
/** Id de `watchPosition` mientras la pestaña está abierta. */
let gpsWatchId = null;
/** Texto plano de cada campo de posición, para el botón Copy. */
const posRaw = { 'pos-lat-raw': '', 'pos-lon-raw': '', 'pos-utm-raw': '', 'pos-decl-raw': '' };

function clearPosition() {
  for (const id of ['pos-lat', 'pos-lon', 'pos-utm', 'pos-acc', 'pos-alt', 'pos-decl']) $(id).textContent = '—';
  for (const k of Object.keys(posRaw)) posRaw[k] = '';
}

function showPosition(coords) {
  const { latitude: lat, longitude: lon, accuracy, altitude } = coords;
  const u = toUTM(lat, lon);
  $('pos-lat').textContent = formatLat(lat);
  $('pos-lon').textContent = formatLon(lon);
  $('pos-utm').textContent = u ? formatUTM(u) : 'outside UTM range';
  $('pos-acc').textContent = Number.isFinite(accuracy) ? `± ${Math.round(accuracy)} m` : '—';
  $('pos-alt').textContent = Number.isFinite(altitude) ? `${Math.round(altitude)} m a.s.l.` : '—';
  posRaw['pos-lat-raw'] = lat.toFixed(6);
  posRaw['pos-lon-raw'] = lon.toFixed(6);
  posRaw['pos-utm-raw'] = u ? formatUTM(u) : '';
  // Declinación del WMM en este punto, a la altura del GPS si la hay.
  const altKm = Number.isFinite(altitude) ? altitude / 1000 : 0;
  const campo = geomagneticField(lat, lon, altKm, new Date());
  ultimaDecl = campo;
  $('pos-decl').textContent = formatDeclination(campo.declination);
  posRaw['pos-decl-raw'] = campo.declination.toFixed(2);
  noteDeclinationPosition(lat, lon);
  renderDeclinationNote();
}

/** Último campo calculado en la pestaña Position, para la nota. */
let ultimaDecl = null;

/** A qué norte va referida una lectura de la brújula, en una frase. */
export function northLabel(declination) {
  if (declination) return `True north (declination ${formatDeclination(declination)}).`;
  if (getTrueNorth() && !Number.isFinite(declinationHere())) {
    return 'Magnetic north — true north needs one GPS position to compute the declination.';
  }
  return 'Magnetic north.';
}

function renderDeclinationNote() {
  const note = $('pos-decl-note');
  if (!note) return;
  if (!ultimaDecl) {
    note.textContent = `Magnetic declination from the ${WMM_NAME} model, computed on the device once there is a position.`;
    return;
  }
  const d = formatDeclination(ultimaDecl.declination);
  const partes = [
    `${WMM_NAME}: true north = magnetic + declination (${d}, inclination ${Math.round(ultimaDecl.inclination)}°).`,
    getTrueNorth()
      ? 'Device and Compass readings are corrected to true north.'
      : 'Device and Compass readings stay referred to magnetic north.',
  ];
  if (!ultimaDecl.valid) partes.push(`Outside the ${WMM_NAME} validity period — the value is less accurate.`);
  note.textContent = partes.join(' ');
}

function startPosition() {
  if (gpsWatchId !== null) return;
  const note = $('stereo-position-note');
  if (!('geolocation' in navigator)) {
    note.textContent = 'This device or browser has no geolocation available.';
    return;
  }
  if (!window.isSecureContext) {
    note.textContent = 'Location needs HTTPS. It works on the published site, not over a local IP address.';
    return;
  }
  note.textContent = 'Waiting for a GPS fix…';
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      showPosition(pos.coords);
      note.textContent = 'Live GPS position. Hold still for a steadier reading.';
    },
    (err) => {
      note.textContent =
        err && err.code === 1
          ? 'Location permission denied. Allow it in the browser settings to read your position.'
          : 'Could not get a GPS fix. WiFi-only iPads have no GPS receiver.';
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
  );
}

function stopPosition() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  clearPosition();
}

function startCompass() {
  if (stopCompassCapture) return;
  if (!compassWidget) compassWidget = buildCompass($('stereo-compass'));

  const note = $('stereo-compass-note');
  const begin = () => {
    if (activeTab !== 'compass' || !panelOpen) return;
    // Esta pestaña es una brújula de referencia, no una medida: solo el
    // ángulo desde el norte al que apunta el teléfono, sostenido como
    // cualquier brújula — a ras, no contra una roca.
    const instr = 'Hold the phone flat, screen up, pointing the way you want to read.';
    note.textContent = instr;
    stopCompassCapture = startHeadingCapture({
      getDeclination: activeDeclination,
      onReading: (r) => {
        const base = `${instr} ${northLabel(r.declination)}`;
        compassWidget.update(r);
        // Si la brújula está descalibrada se dice aquí también, con la misma
        // frase que en el panel Device (ver `compassHealthNote`).
        const aviso = compassHealthNote(r);
        const texto = aviso ? `${base} ⚠ ${aviso}` : base;
        if (note.textContent !== texto) note.textContent = texto;
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
