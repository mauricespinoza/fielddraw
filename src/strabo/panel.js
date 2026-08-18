import * as store from '../store.js';
import * as api from './api.js';
import { distinctValues, STRABO_FILTER_FIELD } from './layers.js';
import {
  buildEstructuras,
  buildLineasPoligonos,
  buildObservacion,
  flattenPointFeatures,
  rowsToGeoJSON,
} from './spots.js';
import { featuresToSpots, uploadableCount } from './upload.js';

/**
 * Panel de StraboSpot: sesión, elegir proyecto y dataset, bajar spots y subir
 * el dibujo como un dataset nuevo.
 *
 * Sobre las credenciales: se piden en el propio formulario y viven en memoria
 * mientras dura la pestaña (ver `api.js`). No se guardan en localStorage ni se
 * ofrece "recordarme", porque la API usa HTTP Basic y eso obligaría a dejar la
 * contraseña escrita en el disco de una tablet que va a terreno.
 */

const $ = (id) => document.getElementById(id);

let onMessage = () => {};
let onBusy = () => {};
let projects = [];
let datasets = [];

export function initStraboPanel({ message, busy }) {
  onMessage = message;
  onBusy = busy;

  $('strabo-signin').addEventListener('click', doSignIn);
  $('strabo-signout').addEventListener('click', doSignOut);
  $('strabo-project').addEventListener('change', onProjectChange);
  // Elegir un dataset no dispara nada por sí solo: hay que reevaluar el
  // botón de descarga explícitamente, o se queda deshabilitado para siempre
  // aunque ya haya un dataset seleccionado.
  $('strabo-dataset').addEventListener('change', render);
  $('strabo-download').addEventListener('click', doDownload);
  $('strabo-upload').addEventListener('click', doUpload);
  $('strabo-clear').addEventListener('click', () => {
    store.clearStraboData();
    onMessage('StraboSpot layers removed.', 'info');
    render();
  });
  // Enter en la contraseña inicia sesión, que es lo que uno espera.
  $('strabo-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSignIn();
  });

  wireSizeSlider('strabo-size-structures', 'structureSize');
  wireSizeSlider('strabo-size-observations', 'observationSize');
  $('strabo-size-reset').addEventListener('click', () => store.resetStraboStyle());

  $('btn-close-strabo-attrs').addEventListener('click', closeStraboAttrs);

  store.subscribe(() => {
    if (store.changed('features') || store.changed('strabo')) render();
    if (store.changed('strabo')) renderFilters();
    if (store.changed('straboStyle')) syncSizeSliders();
  });

  syncSizeSliders();
  render();
}

/** Refleja el estado de sesión y de datos en todo el panel. */
export function render() {
  const signedIn = api.isAuthenticated();
  const data = store.getState().strabo;

  $('strabo-auth').classList.toggle('hidden', signedIn);
  $('strabo-session').classList.toggle('hidden', !signedIn);
  $('strabo-user').textContent = api.currentUser() || '';

  const projectSel = $('strabo-project');
  const datasetSel = $('strabo-dataset');
  $('strabo-download').disabled = !signedIn || !datasetSel.value;

  const n = uploadableCount(store.getState().features);
  $('strabo-upload').disabled = !signedIn || n === 0 || !projectSel.value;
  $('strabo-upload').textContent = n ? `Upload ${n} feature(s) as new dataset` : 'Nothing to upload';

  $('strabo-loaded').classList.toggle('hidden', !data);
  if (data) {
    const e = data.estructuras.features.length;
    const o = data.observacion.features.length;
    const l = data.lineas.features.length;
    $('strabo-loaded-text').textContent =
      `${data.datasetName}: ${e} structure(s), ${o} observation(s), ${l} line/polygon(s).`;
  }
}

/* ---------- tamaño del símbolo ---------- */

function wireSizeSlider(id, key) {
  const el = $(id);
  const num = $(`${id}-num`);
  el.addEventListener('input', () => {
    const v = Number(el.value);
    num.textContent = `${v.toFixed(1)}×`;
    store.setStraboStyle({ [key]: v });
  });
}

/** Refleja el store en los deslizadores, sin pisar uno que se está arrastrando. */
function syncSizeSlider(id, key) {
  const el = $(id);
  if (document.activeElement === el) return;
  const v = store.getState().straboStyle[key];
  el.value = String(v);
  $(`${id}-num`).textContent = `${v.toFixed(1)}×`;
}

function syncSizeSliders() {
  syncSizeSlider('strabo-size-structures', 'structureSize');
  syncSizeSlider('strabo-size-observations', 'observationSize');
}

/* ---------- filtros por tipo ---------- */

/**
 * Qué colección alimenta cada categoría de filtro y cómo se llama en la UI.
 * El campo por el que se filtra ya lo sabe `layers.js`
 * (`STRABO_FILTER_FIELD`); aquí solo se decide de qué colección salen los
 * valores distintos.
 */
const FILTER_CATEGORIES = [
  { id: 'structures', title: 'Structures', data: (d) => d.estructuras },
  { id: 'observations', title: 'Observations', data: (d) => d.observacion },
  { id: 'lines', title: 'Lines / Polygons', data: (d) => d.lineas },
];

/** Cuenta cuántas features de la colección tienen cada valor del campo. */
function countByValue(fc, field) {
  const counts = new Map();
  for (const f of (fc && fc.features) || []) {
    const v = f.properties && f.properties[field];
    if (v === undefined || v === null || v === '') continue;
    const k = String(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function renderFilterGroup(container, cat, data) {
  const fc = cat.data(data);
  const field = STRABO_FILTER_FIELD[cat.id];
  const counts = countByValue(fc, field);
  const values = distinctValues(fc, field);
  if (values.length === 0) return; // nada que filtrar en esta categoría

  const current = store.getState().straboFilters[cat.id];
  // Sin filtro explícito, todo cuenta como "marcado" — es el estado inicial.
  const checked = new Set(current === null ? values : current);

  const group = document.createElement('div');
  group.className = 'strabo-filter-group';

  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('span');
  title.className = 'palette-label';
  title.textContent = `${cat.title} (${field})`;
  const buttons = document.createElement('span');
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => store.setStraboFilter(cat.id, null));
  const noneBtn = document.createElement('button');
  noneBtn.type = 'button';
  noneBtn.textContent = 'None';
  noneBtn.addEventListener('click', () => store.setStraboFilter(cat.id, []));
  buttons.append(allBtn, noneBtn);
  head.append(title, buttons);
  group.appendChild(head);

  const list = document.createElement('div');
  list.className = 'strabo-filter-list';
  for (const v of values) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked.has(v);
    cb.addEventListener('change', () => {
      const now = new Set(store.getState().straboFilters[cat.id] ?? values);
      if (cb.checked) now.add(v);
      else now.delete(v);
      // Si quedan todos marcados, se vuelve a "sin filtro": así un dataset
      // nuevo con valores distintos no hereda una lista que ya no aplica.
      store.setStraboFilter(cat.id, now.size === values.length ? null : [...now]);
    });
    const text = document.createElement('span');
    text.textContent = v;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(counts.get(v) || 0);
    label.append(cb, text, count);
    list.appendChild(label);
  }
  group.appendChild(list);
  container.appendChild(group);
}

function renderFilters() {
  const container = $('strabo-filters');
  container.replaceChildren();
  const data = store.getState().strabo;
  if (!data) return;
  for (const cat of FILTER_CATEGORIES) renderFilterGroup(container, cat, data);
}

/* ---------- atributos de un spot ---------- */

/** Claves internas que no le sirven de nada al usuario. */
const HIDDEN_ATTR_KEYS = new Set(['id']);

function attrTitle(hit) {
  const p = hit.properties;
  if (hit.layer.id === 'strabo-structures') return p.Type || 'Structure';
  if (hit.layer.id === 'strabo-observations') return p.Name || 'Observation';
  return p.Name || (hit.geometry.type === 'Polygon' ? 'Polygon' : 'Line');
}

function fmtAttrValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

export function openStraboAttrs(hit, screen) {
  const menu = $('strabo-attrs');
  const body = $('strabo-attrs-body');
  body.replaceChildren();

  $('strabo-attrs-title').textContent = attrTitle(hit);

  const entries = Object.entries(hit.properties || {}).filter(([k]) => !HIDDEN_ATTR_KEYS.has(k));
  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'This spot has no attributes.';
    body.appendChild(p);
  }
  for (const [k, v] of entries) {
    const row = document.createElement('div');
    row.className = 'strabo-attrs-row';
    const kEl = document.createElement('span');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('span');
    vEl.className = 'v';
    vEl.textContent = fmtAttrValue(v);
    row.append(kEl, vEl);
    body.appendChild(row);
  }

  menu.classList.remove('hidden');
  // Mismo encaje en pantalla que el menú de propiedades: cerca del toque, sin
  // salirse del viewport.
  const rect = menu.getBoundingClientRect();
  const x = Math.min(Math.max(12, screen[0] - rect.width / 2), window.innerWidth - rect.width - 12);
  const y = Math.min(screen[1] + 18, window.innerHeight - rect.height - 12);
  menu.style.left = `${x}px`;
  menu.style.top = `${Math.max(12, y)}px`;
}

export function closeStraboAttrs() {
  $('strabo-attrs').classList.add('hidden');
}

async function doSignIn() {
  const email = $('strabo-email').value.trim();
  const password = $('strabo-password').value;
  if (!email || !password) {
    onMessage('Enter your StraboSpot email and password.', 'warn');
    return;
  }
  onBusy('Signing in to StraboSpot…');
  try {
    await api.signIn(email, password);
    // La contraseña no se conserva en el campo una vez usada.
    $('strabo-password').value = '';
    await loadProjects();
    onMessage(`Signed in to StraboSpot as ${email}.`, 'info');
  } catch (err) {
    onMessage(err.message, 'warn');
  } finally {
    onBusy(null);
    render();
  }
}

function doSignOut() {
  api.signOut();
  projects = [];
  datasets = [];
  fillSelect($('strabo-project'), [], 'Select a project…');
  fillSelect($('strabo-dataset'), [], 'Select a dataset…');
  onMessage('Signed out of StraboSpot.', 'info');
  render();
}

function fillSelect(select, items, placeholder) {
  select.replaceChildren();
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placeholder;
  select.appendChild(first);
  for (const it of items) {
    const opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = it.name;
    select.appendChild(opt);
  }
}

async function loadProjects() {
  onBusy('Loading projects…');
  try {
    projects = await api.listProjects();
    fillSelect($('strabo-project'), projects, 'Select a project…');
    fillSelect($('strabo-dataset'), [], 'Select a dataset…');
    if (projects.length === 0) onMessage('This account has no StraboSpot projects.', 'warn');
  } finally {
    onBusy(null);
  }
}

async function onProjectChange() {
  const pid = $('strabo-project').value;
  datasets = [];
  fillSelect($('strabo-dataset'), [], 'Select a dataset…');
  render();
  if (!pid) return;
  onBusy('Loading datasets…');
  try {
    datasets = await api.listDatasets(pid);
    fillSelect($('strabo-dataset'), datasets, 'Select a dataset…');
    if (datasets.length === 0) onMessage('This project has no datasets.', 'warn');
  } catch (err) {
    onMessage(err.message, 'warn');
  } finally {
    onBusy(null);
    render();
  }
}

async function doDownload() {
  const datasetId = $('strabo-dataset').value;
  if (!datasetId) return;
  const dataset = datasets.find((d) => String(d.id) === String(datasetId));
  const field = $('strabo-field').value.trim();
  const geologist = $('strabo-geologist').value.trim();

  onBusy('Downloading spots…');
  try {
    const spots = await api.getAllDatasetSpots(datasetId);

    // Los tags del proyecto son de donde sale la columna Unit, igual que en
    // el plugin de QGIS.
    let spotTags = {};
    try {
      spotTags = await getProjectTags($('strabo-project').value);
    } catch {
      /* sin tags se sigue igual: Unit queda vacío */
    }

    const rows = flattenPointFeatures(spots.point, spotTags);
    const estructuras = rowsToGeoJSON(buildEstructuras(rows, { field, geologist }));
    const observacion = rowsToGeoJSON(buildObservacion(rows, { field, geologist }));
    const lineas = {
      type: 'FeatureCollection',
      features: buildLineasPoligonos([...spots.line, ...spots.polygon], { field, geologist }),
    };

    store.setStraboData({
      datasetId,
      datasetName: dataset ? dataset.name : String(datasetId),
      estructuras,
      observacion,
      lineas,
    });

    const total =
      estructuras.features.length + observacion.features.length + lineas.features.length;
    if (total === 0) {
      onMessage('That dataset has no spots with usable geometry.', 'warn');
    } else {
      onMessage(
        `Loaded ${estructuras.features.length} structure(s), ${observacion.features.length} ` +
          `observation(s) and ${lineas.features.length} line/polygon(s) from StraboSpot.`,
        'info',
      );
    }
  } catch (err) {
    onMessage(`Could not download: ${err.message}`, 'warn');
  } finally {
    onBusy(null);
    render();
  }
}

/** `/db/project/{id}` trae los tags con la lista de spots de cada uno. */
async function getProjectTags(projectId) {
  if (!projectId) return {};
  const res = await api.getProject(projectId);
  const out = {};
  for (const tag of (res && res.tags) || []) {
    for (const spotId of tag.spots || []) {
      if (!out[spotId]) out[spotId] = [];
      out[spotId].push(tag.name);
    }
  }
  return out;
}

async function doUpload() {
  const projectId = $('strabo-project').value;
  if (!projectId) {
    onMessage('Pick the project the new dataset should belong to.', 'warn');
    return;
  }

  const features = store.getState().features;
  const { collection, count } = featuresToSpots(features, {
    field: $('strabo-field').value.trim(),
    geologist: $('strabo-geologist').value.trim(),
  });
  if (count === 0) {
    onMessage('There are no lines or polygons to upload.', 'warn');
    return;
  }

  const suggested = `FieldDraw ${new Date().toISOString().slice(0, 10)}`;
  const name = prompt(
    `Name for the new StraboSpot dataset.\n\n${count} feature(s) will be uploaded into a NEW ` +
      `dataset. Existing datasets are never touched.`,
    suggested,
  );
  if (name === null) return;
  const datasetName = name.trim() || suggested;

  onBusy('Creating dataset…');
  try {
    const dataset = await api.createDataset(datasetName);
    await api.addDatasetToProject(projectId, dataset.id);
    onBusy(`Uploading ${count} spot(s)…`);
    await api.uploadSpots(dataset.id, collection);

    onMessage(
      `Uploaded ${count} feature(s) to StraboSpot as dataset “${datasetName}”. ` +
        `Refresh the project in StraboSpot to see it.`,
      'info',
    );
    // El dataset nuevo pasa a estar disponible en el desplegable.
    await onProjectChange.call(null);
  } catch (err) {
    onMessage(`Upload failed: ${err.message}`, 'warn');
  } finally {
    onBusy(null);
    render();
  }
}
