/**
 * Pestaña «Faults» del estereograma: la solución de plano de falla de las
 * fallas con dato completo (plano + estría + sentido), con una casilla por
 * falla para sacarla del análisis y ver cómo se mueven el régimen, R, los
 * ejes medios y los σ — la columna «On» del plugin Fault-plane Solver v1.7.
 *
 * `stereogramPanel.js` decide cuándo está abierta y le pide que se dibuje.
 */

import * as store from './store.js';
import { FAULT_SENSE_BY_ID } from './symbology.js';
import { formatStrikeDip, formatTrendPlunge } from './structure.js';
import { MICHAEL_MIN_FAULTS, REGIME_STYLE, faultPlaneSolution, faultSlipData } from './faultKin.js';
import { FK_COLORS, FK_LAYERS, defaultLayers, renderFaultSolution, tp } from './faultKinView.js';

const $ = (id) => document.getElementById(id);

const PREFS_KEY = 'fielddraw.faultSolution.v1';

/**
 * Fallas apagadas con su casilla. Siguen al id de la medida, así que
 * sobreviven a un cambio de selección o a reabrir la red; se olvidan al
 * cerrar la app (igual que el filtro por tipo de la pestaña Plot).
 */
const disabled = new Set();
let layers = defaultLayers();
let dc = true;
let wired = false;

function loadPrefs() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p && typeof p.layers === 'object') {
      for (const k of Object.keys(layers)) if (typeof p.layers[k] === 'boolean') layers[k] = p.layers[k];
    }
    if (typeof p.dc === 'boolean') dc = p.dc;
  } catch {
    /* sin almacenamiento: valores de fábrica */
  }
}

function savePrefs() {
  try {
    globalThis.localStorage && globalThis.localStorage.setItem(PREFS_KEY, JSON.stringify({ layers, dc }));
  } catch {
    /* modo privado o cuota llena: no es grave */
  }
}

/** Arma las casillas de capas una vez. */
function wire() {
  if (wired) return;
  wired = true;
  loadPrefs();

  const box = $('fk-layers');
  for (const g of FK_LAYERS) {
    const h = document.createElement('p');
    h.className = 'fk-group';
    h.textContent = g.group;
    box.appendChild(h);
    for (const it of g.items) {
      const lab = document.createElement('label');
      lab.className = `sv-check${it.sub ? ' fk-sub' : ''}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.layer = it.key;
      cb.checked = layers[it.key];
      cb.addEventListener('change', () => {
        layers[it.key] = cb.checked;
        savePrefs();
        renderFaultTab();
      });
      lab.append(cb, document.createTextNode(` ${it.label}`));
      box.appendChild(lab);
    }
  }
  const syncLayerBoxes = () => {
    for (const cb of box.querySelectorAll('input[data-layer]')) cb.checked = layers[cb.dataset.layer];
  };
  $('fk-layers-all').addEventListener('click', () => {
    for (const k of Object.keys(layers)) layers[k] = true;
    syncLayerBoxes();
    savePrefs();
    renderFaultTab();
  });
  $('fk-layers-none').addEventListener('click', () => {
    for (const k of Object.keys(layers)) layers[k] = false;
    syncLayerBoxes();
    savePrefs();
    renderFaultTab();
  });
  $('fk-layers-reset').addEventListener('click', () => {
    layers = defaultLayers();
    dc = true;
    $('fk-dc').checked = dc;
    syncLayerBoxes();
    savePrefs();
    renderFaultTab();
  });

  $('fk-dc').checked = dc;
  $('fk-dc').addEventListener('change', (e) => {
    dc = e.target.checked;
    savePrefs();
    renderFaultTab();
  });

  $('fk-all-on').addEventListener('click', () => {
    for (const f of lastFaults) disabled.delete(f.id);
    renderFaultTab();
  });
  $('fk-all-off').addEventListener('click', () => {
    for (const f of lastFaults) disabled.add(f.id);
    renderFaultTab();
  });
  $('fk-invert').addEventListener('click', () => {
    for (const f of lastFaults) {
      if (disabled.has(f.id)) disabled.delete(f.id);
      else disabled.add(f.id);
    }
    renderFaultTab();
  });
}

/** Fallas de la última pasada, para los botones All on / All off. */
let lastFaults = [];

/** Resalta una falla en la red (y apaga las demás) mientras se apunta su fila. */
function focusFault(id) {
  const svg = $('fault-chart');
  svg.classList.toggle('fk-focus', Boolean(id));
  for (const n of svg.querySelectorAll('[data-fid]')) n.classList.toggle('fk-hot', n.dataset.fid === id);
}

export function renderFaultTab() {
  wire();
  const st = store.getState();
  const data = faultSlipData(st.features, st.selection);
  lastFaults = data.faults;
  const sol = faultPlaneSolution(data.faults, disabled);
  renderFaultSolution($('fault-chart'), data.faults, sol, { layers, dc });

  /* --- de dónde salen los datos --- */
  const partes = [
    data.usingSelection
      ? `${data.faults.length} fault(s) with full datum in the map selection.`
      : `${data.faults.length} fault(s) with full datum in the drawing — select some on the map to analyse only those.`,
  ];
  if (data.incomplete > 0) {
    partes.push(`${data.incomplete} fault plane(s) left out: they lack striae or a sense of slip (undetermined).`);
  }
  if (sol.nInvalid > 0) partes.push(`${sol.nInvalid} rejected (see ⚠ in the list).`);
  $('fk-source-note').textContent = partes.join(' ');

  /* --- resumen numérico --- */
  const sum = $('fk-summary');
  sum.replaceChildren();
  const fila = (k, v, title = '') => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    if (title) dd.title = title;
    sum.append(dt, dd);
  };
  if (!sol.bingham) {
    fila('Solution', 'Switch on at least one valid fault.');
  } else {
    const rs = REGIME_STYLE[sol.regime] || REGIME_STYLE.oblique;
    fila(
      'Regime',
      `${rs.label}${sol.regimeSource === 'kinematic' ? ' (from P̄/B̄/T̄)' : ''}`,
      'World Stress Map plunge thresholds (Zoback 1992)',
    );
    fila('n', `${sol.nOn} of ${data.faults.length}`);
    const b = sol.bingham;
    fila('P̄', tp(b.P), 'Mean shortening axis, trend/plunge (Bingham, Marrett & Allmendinger 1990)');
    fila('T̄', tp(b.T), 'Mean extension axis, trend/plunge');
    fila('B̄', tp(b.B), 'Mean null axis, trend/plunge');
    fila('K', Number.isFinite(b.K) ? b.K.toFixed(2) : '—', 'K = (λ2−λ3)/(λ1−λ3): 0 uniaxial shortening, 0.5 plane strain, 1 uniaxial extension');
    if (Number.isFinite(b.clvd)) fila('CLVD', `${Math.round(b.clvd * 100)}%`, 'Departure of the mean tensor from a pure double-couple');
    if (sol.stress) {
      const s = sol.stress;
      fila('σ1', tp(s.sigma1), 'Most compressive principal stress (Michael 1984)');
      fila('σ2', tp(s.sigma2));
      fila('σ3', tp(s.sigma3), 'Least compressive principal stress');
      fila('R', s.R.toFixed(3), 'R = (σ2−σ3)/(σ1−σ3)');
      if (Number.isFinite(sol.RPrime)) fila("R′", sol.RPrime.toFixed(3), "Delvaux et al. (1997): 0 radial extension · 1.5 pure strike-slip · 3 radial compression");
      fila('β', `mean ${s.meanMisfit.toFixed(1)}° · max ${s.maxMisfit.toFixed(1)}°`, 'Angle between each striae and the shear predicted by the stress tensor');
    } else {
      fila('Stress', `Inversion needs ≥ ${MICHAEL_MIN_FAULTS} faults switched on.`);
    }
  }

  /* --- lista de fallas con su casilla --- */
  const list = $('fk-list');
  list.replaceChildren();
  data.faults.forEach((f, i) => {
    const row = document.createElement('label');
    const on = f.valid && !disabled.has(f.id);
    row.className = `sv-row sv-filter fk-row${on ? '' : ' off'}`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = on;
    cb.disabled = !f.valid;
    cb.addEventListener('change', () => {
      if (cb.checked) disabled.delete(f.id);
      else disabled.add(f.id);
      renderFaultTab();
    });
    const idx = document.createElement('span');
    idx.className = 'sv-num';
    idx.textContent = String(i + 1);
    const what = document.createElement('span');
    what.className = 'sv-what';
    const sense = FAULT_SENSE_BY_ID.get(f.faultSense);
    what.textContent = `${formatStrikeDip(f.strike, f.dip)} · ${formatTrendPlunge(f.trend, f.plunge)} · ${sense ? sense.short : f.sense}`;
    const extra = document.createElement('span');
    extra.className = 'sv-num';
    const tips = [];
    if (!f.valid) {
      extra.textContent = '⚠';
      tips.push(...f.errors);
    } else {
      const beta = sol.misfitById.get(f.id);
      extra.textContent = on && Number.isFinite(beta) ? `β ${Math.round(beta)}°` : on ? '' : 'off';
      if (f.warnings.length) {
        extra.textContent = `⚠ ${extra.textContent}`.trim();
        tips.push(...f.warnings);
      }
    }
    if (f.note) tips.push(f.note);
    row.title = tips.join('\n') || (on ? 'Untick to leave this fault out of the solution' : 'Tick to bring it back');
    row.append(cb, idx, what, extra);
    row.addEventListener('pointerenter', () => focusFault(f.id));
    row.addEventListener('pointerleave', () => focusFault(null));
    list.appendChild(row);
  });
  $('fk-count').textContent = data.faults.length ? `${sol.nOn} / ${data.faults.length}` : '';
  $('fk-all-on').disabled = data.faults.length === 0;
  $('fk-all-off').disabled = data.faults.length === 0;
  $('fk-invert').disabled = data.faults.length === 0;

  /* --- leyenda de símbolos --- */
  const legend = $('fk-legend');
  legend.replaceChildren();
  const item = (html, label) => {
    const s = document.createElement('span');
    s.className = 'fk-leg';
    s.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${html}</svg>`;
    s.append(document.createTextNode(label));
    legend.appendChild(s);
  };
  item(`<circle cx="8" cy="8" r="4.5" fill="${FK_COLORS.p}"/>`, 'P');
  item(`<rect x="3.5" y="3.5" width="9" height="9" fill="${FK_COLORS.t}"/>`, 'T');
  item(`<circle cx="8" cy="8" r="6" fill="${FK_COLORS.meanP}" stroke="#000"/>`, 'P̄');
  item(`<rect x="2" y="2" width="12" height="12" fill="${FK_COLORS.meanT}" stroke="#000"/>`, 'T̄');
  item(`<polygon points="8,1.5 1.5,13 14.5,13" fill="${FK_COLORS.meanB}" stroke="#000"/>`, 'B̄');
  item('<circle cx="8" cy="8" r="5.5" fill="#000" stroke="#000"/>', 'σ1');
  item('<circle cx="8" cy="8" r="5.5" fill="#888" stroke="#000"/>', 'σ2');
  item('<circle cx="8" cy="8" r="5.5" fill="#fff" stroke="#000"/>', 'σ3');
  if (sol.bingham) {
    const rs = REGIME_STYLE[sol.regime] || REGIME_STYLE.oblique;
    item(`<rect x="1" y="1" width="14" height="14" fill="${rs.color}" opacity="0.5" stroke="#1b2430"/>`, `${rs.label} quadrants`);
  }
}
