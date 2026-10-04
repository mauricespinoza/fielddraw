import * as store from '../store.js';
import { openAttrs } from '../attrs.js';
import * as api from './api.js';
import { distinctValues, STRABO_FILTER_FIELD, straboBaseId, straboKeyOf } from './layers.js';
import {
  CERTAINTY_BY_ID,
  FAULT_SENSE_BY_ID,
  LINE_TYPE_BY_ID,
  STRUCTURE_TYPE_BY_ID,
} from '../symbology.js';
import { CONTROL_POINT_KIND, purposeLabel } from '../controlPoints.js';
import {
  buildEstructuras,
  buildLineasPoligonos,
  buildObservacion,
  flattenPointFeatures,
  rowsToGeoJSON,
  spotTagsFrom,
} from './spots.js';
import { mergeGeologicUnitTags } from './mapping.js';
import { featuresToSpots, uploadBreakdown, uploadableCount } from './upload.js';
import { baselineOf, planIsEmpty, planUpdate } from './sync.js';
import { assembleCollection, buildPush, spotIdsOf } from './push.js';
import { downloadBlob } from '../persistence.js';

/**
 * Panel de StraboSpot: sesión, elegir proyecto y dataset, bajar spots y subir
 * el dibujo como un dataset nuevo.
 *
 * Sobre las credenciales: se piden en el propio formulario y la contraseña
 * vive en memoria mientras dura la pestaña (ver `api.js`), nunca en
 * localStorage — la API usa HTTP Basic y eso obligaría a dejarla escrita en
 * el disco de una tablet que va a terreno. El correo es distinto: no es
 * secreto, y volver a escribirlo en cada sesión es solo fricción, así que
 * "Remember me" lo guarda en localStorage y el campo se rellena solo con el
 * último usado.
 */

const $ = (id) => document.getElementById(id);

const LAST_EMAIL_KEY = 'fielddraw.strabo.lastEmail';

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
  // Enter en la contraseña inicia sesión, que es lo que uno espera.
  $('strabo-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSignIn();
  });

  wireSizeSlider('strabo-size-structures', 'structureSize');
  wireSizeSlider('strabo-size-observations', 'observationSize');
  $('strabo-size-reset').addEventListener('click', () => store.resetStraboStyle());

  // El correo del último inicio de sesión, si "Remember me" estaba marcado.
  const lastEmail = localStorage.getItem(LAST_EMAIL_KEY);
  if (lastEmail) $('strabo-email').value = lastEmail;

  store.subscribe(() => {
    if (store.changed('features') || store.changed('straboDatasets')) render();
    if (store.changed('straboDatasets') || store.changed('layers')) renderDatasets();
    if (store.changed('straboDatasets')) renderFilters();
    if (store.changed('straboDatasets') && pending) renderReview();
    if (store.changed('straboStyle')) syncSizeSliders();
  });

  syncSizeSliders();
  render();
  renderDatasets();
  renderFilters();
}

/** Refleja el estado de sesión y de datos en todo el panel. */
export function render() {
  const signedIn = api.isAuthenticated();

  $('strabo-auth').classList.toggle('hidden', signedIn);
  // El botón de actualizar depende de la sesión.
  renderDatasets();
  $('strabo-session').classList.toggle('hidden', !signedIn);
  $('strabo-user').textContent = api.currentUser() || '';

  const projectSel = $('strabo-project');
  const datasetSel = $('strabo-dataset');
  $('strabo-download').disabled = !signedIn || !datasetSel.value;

  const n = uploadableCount(uploadSource());
  $('strabo-upload').disabled = !signedIn || n === 0 || !projectSel.value;
  $('strabo-upload').textContent = n ? `Upload ${n} feature(s) as new dataset` : 'Nothing to upload';
  // El desglose dice qué se va a subir COMO QUÉ, que es lo que importa: una
  // medida no llega igual que una traza, y el recuento total lo esconde.
  $('strabo-upload-summary').textContent = n
    ? `${describe(uploadBreakdown(uploadSource()))} will be uploaded.`
    : '';
  // El nombre sugerido se rellena solo, pero no se pisa lo que ya se escribió.
  const nameInput = $('strabo-dataset-name');
  if (!nameInput.value.trim() && document.activeElement !== nameInput) {
    nameInput.placeholder = suggestedDatasetName();
  }
}

/**
 * Lo que se sube: el dibujo, MENOS lo de los datasets con el candado cerrado.
 * Esos son el trabajo de otra persona del mismo proyecto, que ya está en
 * StraboSpot; subirlo otra vez como dataset nuevo lo duplicaría.
 */
function uploadSource() {
  return store.unlockedFeatures();
}

/* ---------- datasets cargados: ojo, candado, quitar ---------- */

/** Cuántos elementos de un dataset hay ya en el dibujo. */
function inDrawing(key) {
  return store.getState().features.filter((f) => f.properties.straboDataset === key).length;
}

function datasetSummary(d) {
  const enDibujo = inDrawing(d.key);
  if (d.adopted) return `${enDibujo} feature(s) in the drawing`;
  const e = d.estructuras.features.length;
  const o = d.observacion.features.length;
  const l = d.lineas.features.length;
  return `${e} structure(s), ${o} observation(s), ${l} line/polygon(s)`;
}

/**
 * Abre o cierra el candado. La primera apertura trae los elementos al dibujo
 * y avisa qué se tradujo y qué hay que revisar, como hacía la adopción.
 */
export function toggleStraboLock(key) {
  const d = store.getState().straboDatasets.find((x) => x.key === key);
  if (!d) return;
  if (!d.locked) {
    store.setStraboLocked(key, true);
    onMessage(`“${d.datasetName}” locked: it can be viewed, not edited.`, 'info');
    return;
  }
  const abierto = store.getState().straboDatasets.find((x) => !x.locked);
  const r = store.setStraboLocked(key, false);
  const cerrado = abierto ? ` “${abierto.datasetName}” was locked.` : '';
  if (!r) {
    onMessage(`“${d.datasetName}” is open for editing.${cerrado}`, 'info');
    return;
  }
  const partes = [];
  if (r.stats.points) partes.push(`${r.stats.points} measurement(s)`);
  if (r.stats.lines) partes.push(`${r.stats.lines} line(s)`);
  if (r.stats.polygons) partes.push(`${r.stats.polygons} polygon(s)`);
  if (r.stats.controlPoints) partes.push(`${r.stats.controlPoints} control point(s)`);
  const resumen = partes.length
    ? `“${d.datasetName}” is open for editing: ${partes.join(', ')} are now in the drawing.`
    : `“${d.datasetName}” is open for editing, but nothing in it could become a drawing feature.`;
  onMessage([resumen + cerrado, ...r.warnings].join(' '), 'info');
}

export function removeStraboDatasetAsk(key) {
  const d = store.getState().straboDatasets.find((x) => x.key === key);
  if (!d) return;
  const n = inDrawing(key);
  if (n > 0 && !confirm(
    `Remove “${d.datasetName}”?\n\nIts ${n} feature(s) in the drawing go with it, edits included. ` +
      'Nothing is deleted in StraboSpot. Undo brings it back.',
  )) return;
  store.removeStraboDataset(key);
  onMessage(`“${d.datasetName}” removed from the map.`, 'info');
}

/** «4 Oct 14:05»: cuándo se comparó por última vez con StraboSpot. */
function shortDate(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function iconButton(text, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function renderDatasets() {
  const st = store.getState();
  const list = $('strabo-datasets');
  list.replaceChildren();
  $('strabo-datasets-block').classList.toggle('hidden', st.straboDatasets.length === 0);
  $('strabo-loaded').classList.toggle('hidden', st.straboDatasets.length === 0);
  const filas = new Map(st.layers.filter((l) => l.kind === 'strabo').map((l) => [l.straboKey, l]));
  for (const d of st.straboDatasets) {
    const fila = filas.get(d.key);
    const visible = !fila || fila.visible;
    const li = document.createElement('li');
    li.className = 'strabo-dataset';
    li.classList.toggle('off', !visible);
    li.classList.toggle('unlocked', !d.locked);

    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = d.color;
    const txt = document.createElement('span');
    txt.className = 'sp-text';
    const main = document.createElement('span');
    main.className = 'sp-main';
    main.textContent = d.datasetName;
    const sub = document.createElement('span');
    sub.className = 'sp-sub';
    sub.textContent = `${d.locked ? 'Locked' : 'Editing'} · ${datasetSummary(d)}${
      d.syncedAt ? ` · synced ${shortDate(d.syncedAt)}` : ''
    }`;
    txt.append(main, sub);

    const eye = iconButton(
      visible ? '👁' : '◌',
      visible ? `Hide ${d.datasetName}` : `Show ${d.datasetName}`,
      () => store.setLayerVisible(store.straboLayerId(d.key), !visible),
    );
    eye.classList.toggle('active', visible);
    const lock = iconButton(
      d.locked ? '🔒' : '🔓',
      d.locked ? `Unlock ${d.datasetName} to edit it` : `Lock ${d.datasetName}`,
      () => toggleStraboLock(d.key),
    );
    lock.classList.toggle('active', !d.locked);
    const del = iconButton('✕', `Remove ${d.datasetName} from the map`, () =>
      removeStraboDatasetAsk(d.key),
    );
    const upd = iconButton(
      '⟳',
      api.isAuthenticated()
        ? `Check ${d.datasetName} for changes made in StraboSpot`
        : 'Sign in to StraboSpot to check for changes',
      () => checkStraboUpdate(d.key),
    );
    upd.disabled = !api.isAuthenticated() || !d.datasetId;
    li.append(sw, txt, upd);
    // Subir solo tiene sentido en el dataset que se está editando.
    if (!d.locked && d.adopted && d.datasetId) {
      const up = iconButton(
        '⬆',
        api.isAuthenticated()
          ? `Upload your edits to ${d.datasetName} in StraboSpot`
          : 'Sign in to StraboSpot to upload',
        () => checkStraboPush(d.key),
      );
      up.disabled = !api.isAuthenticated();
      li.appendChild(up);
    }
    li.append(eye, lock, del);
    list.appendChild(li);
  }
}

/** Nombre por omisión del dataset: lo que se sube y cuándo. */
const suggestedDatasetName = () => `FieldDraw ${new Date().toISOString().slice(0, 10)}`;

/** «3 measurement(s), 2 line(s)», saltándose lo que no hay. */
function describe(breakdown) {
  const partes = [
    [breakdown.measurements, 'measurement'],
    [breakdown.controlPoints, 'control point'],
    [breakdown.lines, 'line'],
    [breakdown.polygons, 'polygon'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`);
  return partes.join(', ') || 'nothing';
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

function renderFilterGroup(container, cat, datasets) {
  // Los valores de todos los datasets juntos: el filtro vale para todos.
  const fc = {
    type: 'FeatureCollection',
    features: datasets.flatMap((d) => (cat.data(d) && cat.data(d).features) || []),
  };
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
  const datasets = store.getState().straboDatasets;
  if (datasets.length === 0) return;
  for (const cat of FILTER_CATEGORIES) renderFilterGroup(container, cat, datasets);
}

/* ---------- atributos de un spot ---------- */

/**
 * Claves internas que no le sirven de nada al usuario. Las que empiezan con
 * doble guion bajo —el id del spot de origen— tampoco se enseñan.
 */
const HIDDEN_ATTR_KEYS = new Set(['id']);
const isHiddenAttr = (k) => HIDDEN_ATTR_KEYS.has(k) || k.startsWith('__');

/** El dataset dueño de una capa de consulta, por la clave de su id. */
function datasetOfLayer(layerId) {
  const key = straboKeyOf(layerId);
  return key ? store.getState().straboDatasets.find((d) => d.key === key) || null : null;
}

/**
 * Campos que se leen como texto corrido y no como un dato: van a ancho
 * completo debajo de su etiqueta, no apretados en la columna derecha. Son las
 * anotaciones de terreno, que es justamente lo que uno viene a leer al tocar
 * un spot.
 */
const LONG_ATTR_KEYS = new Set([
  'Notes',
  'Structure notes',
  'Sample Description',
  'Indicators',
  'Purpose',
]);

function attrTitle(hit) {
  const p = hit.properties;
  const layer = straboBaseId(hit.layer.id);
  // El nombre del spot es como el geólogo lo tiene anotado en la libreta, así
  // que encabeza siempre que exista; el tipo lo acompaña porque un mismo spot
  // puede traer varias mediciones.
  if (layer === 'strabo-structures') {
    return [p.Name, p.Type].filter(Boolean).join(' · ') || 'Structure';
  }
  if (layer === 'strabo-observations') return p.Name || 'Observation';
  return p.Name || (hit.geometry.type === 'Polygon' ? 'Polygon' : 'Line');
}

export function openStraboAttrs(hit, screen) {
  // Lo específico de un spot es el título y qué campos sobran; pintar el
  // recuadro y encajarlo en pantalla es igual para cualquier fuente.
  const d = datasetOfLayer(hit.layer.id);
  openAttrs({
    title: attrTitle(hit),
    entries: Object.entries(hit.properties || {}).filter(([k]) => !isHiddenAttr(k)),
    screen,
    isLong: (k) => LONG_ATTR_KEYS.has(k),
    empty: 'This spot has no attributes.',
    note: d ? `🔒 ${d.datasetName} — read only. Unlock it to edit.` : undefined,
  });
}

/**
 * Atributos de un elemento de un dataset cerrado que ya pasó al dibujo.
 *
 * Son propiedades del dibujo —ids de tipo, rumbo en número— y no las columnas
 * de StraboSpot, así que se traducen a lo que se lee en un mapa: el tipo con
 * su nombre, la certeza, la unidad. Es lo que se vería en el menú de
 * propiedades, sin la posibilidad de cambiarlo.
 */
export function lockedEntries(f, units = []) {
  const p = f.properties || {};
  const out = [];
  const push = (k, v) => {
    if (v !== undefined && v !== null && v !== '') out.push([k, v]);
  };
  if (p.geomKind === 'measurement') {
    const tipo = STRUCTURE_TYPE_BY_ID.get(p.type);
    push('Type', tipo ? tipo.label : p.type);
    if (p.type === 'fault-plane') push('Sense', (FAULT_SENSE_BY_ID.get(p.faultSense) || {}).label);
    push('Strike', p.strike);
    push('Dip', p.dip);
    push('Dip direction', p.dipAzimuth);
    push('Trend', p.lineTrend);
    push('Plunge', p.linePlunge);
    push('Quality', p.quality);
  } else if (p.geomKind === CONTROL_POINT_KIND) {
    push('Name', p.name);
    push('Sample ID', p.sampleId);
    push('Sample Description', p.sampleDescription);
    push('Purpose', p.purpose ? purposeLabel(p.purpose) : '');
  } else if (f.geometry && f.geometry.type === 'Polygon') {
    const unidad = units.find((u) => u.id === p.type);
    push('Unit', (unidad && unidad.name) || p.unit);
    push('Code', (unidad && unidad.code) || p.code);
  } else {
    const tipo = LINE_TYPE_BY_ID.get(p.type);
    push('Type', tipo ? tipo.label : p.type);
  }
  push('Certainty', (CERTAINTY_BY_ID.get(p.certainty) || {}).label);
  if (p.geomKind === 'measurement' || p.geomKind === CONTROL_POINT_KIND) push('Unit', p.unit);
  push('Notes', p.note);
  push('Date', p.Date);
  push('Field', p.Field);
  push('Geologist', p.Geologist);
  return out;
}

export function openLockedAttrs(f, screen) {
  const st = store.getState();
  const d = st.straboDatasets.find((x) => x.key === f.properties.straboDataset);
  const entries = lockedEntries(f, st.units);
  const nombre = entries.find(([k]) => k === 'Name' || k === 'Type' || k === 'Unit');
  openAttrs({
    title: nombre ? String(nombre[1]) : 'Feature',
    entries,
    screen,
    isLong: (k) => k === 'Notes' || k === 'Sample Description',
    empty: 'This feature has no attributes.',
    note: `🔒 ${d ? d.datasetName : 'StraboSpot dataset'} — read only. Unlock it to edit.`,
  });
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
    if ($('strabo-remember').checked) localStorage.setItem(LAST_EMAIL_KEY, email);
    else localStorage.removeItem(LAST_EMAIL_KEY);
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
    const { estructuras, observacion, lineas, baseline } = await fetchDataset(
      datasetId,
      $('strabo-project').value,
      { field, geologist },
    );

    const datasetName = dataset ? dataset.name : String(datasetId);
    /*
     * Se AÑADE a los que ya hubiera, con el candado cerrado: así se puede
     * tener a la vista el trabajo de cada persona del proyecto sin riesgo de
     * tocarlo. Para editar uno se abre su candado.
     */
    const { replaced } = store.addStraboDataset({
      datasetId,
      datasetName,
      projectId: $('strabo-project').value,
      estructuras,
      observacion,
      lineas,
      baseline,
      field,
      geologist,
    });

    const total =
      estructuras.features.length + observacion.features.length + lineas.features.length;
    if (total === 0) {
      onMessage(`“${datasetName}” has no spots with usable geometry.`, 'warn');
    } else {
      onMessage(
        `${replaced ? 'Reloaded' : 'Loaded'} “${datasetName}”: ${estructuras.features.length} ` +
          `structure(s), ${observacion.features.length} observation(s) and ` +
          `${lineas.features.length} line/polygon(s), locked. Open its lock 🔒 to edit it.`,
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

/**
 * Baja un dataset y lo aplana a las tres colecciones de consulta, junto con
 * las huellas de cada spot tal como llegó (ver `sync.js`).
 */
async function fetchDataset(datasetId, projectId, { field = '', geologist = '' } = {}) {
  const spots = await api.getAllDatasetSpots(datasetId);

  // Los tags del proyecto son de donde sale la columna Unit, igual que en
  // el plugin de QGIS.
  let spotTags = {};
  try {
    spotTags = await getProjectTags(projectId);
  } catch {
    /* sin tags se sigue igual: Unit queda vacío */
  }

  const rows = flattenPointFeatures(spots.point, spotTags);
  return {
    estructuras: rowsToGeoJSON(buildEstructuras(rows, { field, geologist })),
    observacion: rowsToGeoJSON(buildObservacion(rows, { field, geologist })),
    lineas: {
      type: 'FeatureCollection',
      features: buildLineasPoligonos([...spots.line, ...spots.polygon], { field, geologist, spotTags }),
    },
    baseline: baselineOf(spots),
  };
}

/* ---------- actualizar: ver lo que cambiaron los demás ---------- */

/**
 * La actualización pendiente de revisar: lo bajado, sus huellas y el plan.
 * Nada se aplica hasta que se confirma, y mientras tanto el dibujo puede
 * seguir cambiando, así que al confirmar el plan se vuelve a calcular.
 */
let pending = null;

const featuresOf = (key) =>
  store.getState().features.filter((f) => f.properties.straboDataset === key);

function makePlan(d, remote) {
  return planUpdate({
    baseline: d.baseline,
    remote: remote.baseline,
    data: remote,
    adopted: d.adopted,
    features: featuresOf(d.key),
  });
}

/** Firma de los conflictos, para saber si cambiaron entre revisar y aplicar. */
const conflictKey = (plan) => plan.conflicts.map((c) => `${c.kind}:${c.spotId}`).sort().join('|');

export async function checkStraboUpdate(key) {
  const d = store.getState().straboDatasets.find((x) => x.key === key);
  if (!d) return;
  if (!api.isAuthenticated()) {
    onMessage('Sign in to StraboSpot to check for updates.', 'warn');
    return;
  }
  if (!d.datasetId) {
    onMessage(`“${d.datasetName}” no longer knows which StraboSpot dataset it came from.`, 'warn');
    return;
  }
  onBusy(`Checking “${d.datasetName}” for changes…`);
  try {
    const remote = await fetchDataset(d.datasetId, d.projectId, { field: d.field, geologist: d.geologist });
    const plan = makePlan(d, remote);
    if (planIsEmpty(plan)) {
      // Nada que cambiar, pero las huellas sí se renuevan: si el dataset se
      // bajó antes de que existieran, desde ahora ya se pueden comparar.
      store.applyStraboUpdate(key, { data: remote, baseline: remote.baseline, plan });
      onMessage(`“${d.datasetName}” is up to date.`, 'info');
      pending = null;
    } else {
      pending = { mode: 'update', key, remote, plan, choices: {} };
    }
  } catch (err) {
    onMessage(`Could not check for updates: ${err.message}`, 'warn');
  } finally {
    onBusy(null);
    renderReview();
  }
}

/** «3 new, 1 changed, 2 removed», saltándose lo que no hay. */
function planSummary(plan, adopted) {
  const partes = [
    [plan.added.length, 'new'],
    [plan.replaced.length, adopted ? 'changed (not edited here)' : 'changed'],
    [plan.removed.length, adopted ? 'removed (not edited here)' : 'removed'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`);
  return partes.join(', ');
}

const CONFLICT_TEXT = {
  changed: 'Changed in StraboSpot and edited here',
  removed: 'Removed in StraboSpot, edited here',
  'deleted-here': 'Changed in StraboSpot, deleted here',
};

function renderReview() {
  const box = $('strabo-review');
  box.replaceChildren();
  const d = pending && store.getState().straboDatasets.find((x) => x.key === pending.key);
  if (!d) {
    pending = null;
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  if (pending.mode === 'push') {
    renderPushReview(box, d);
    return;
  }
  const { plan } = pending;

  const h = document.createElement('h3');
  h.className = 'palette-label';
  h.textContent = `Update “${d.datasetName}”`;
  box.appendChild(h);

  const resumen = planSummary(plan, d.adopted);
  if (resumen) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = `Spots: ${resumen}.${plan.unchanged ? ` ${plan.unchanged} unchanged.` : ''}`;
    box.appendChild(p);
  }
  if (plan.noBaseline) {
    const p = document.createElement('p');
    p.className = 'hint footnote';
    p.textContent = d.adopted
      ? 'This dataset was loaded before changes were tracked: only spots that are not in your ' +
        'drawing can be added this time. From now on, changes will show up here.'
      : 'This dataset was loaded before changes were tracked: its layer is simply reloaded.';
    box.appendChild(p);
  }

  if (plan.conflicts.length) {
    const p = document.createElement('p');
    p.className = 'hint footnote';
    p.textContent =
      `${plan.conflicts.length} spot(s) changed on both sides. Choose for each one; ` +
      'what you keep here is never lost unless you pick “Web” (the StraboSpot version).';
    box.appendChild(p);

    const todos = document.createElement('div');
    todos.className = 'strabo-review-all';
    for (const [label, value] of [['Keep all mine', 'mine'], ['Take all from Web', 'theirs']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        for (const c of plan.conflicts) pending.choices[c.spotId] = value;
        renderReview();
      });
      todos.appendChild(b);
    }
    box.appendChild(todos);

    const ul = document.createElement('ul');
    ul.className = 'strabo-conflicts';
    for (const c of plan.conflicts) {
      const li = document.createElement('li');
      const txt = document.createElement('span');
      txt.className = 'sp-text';
      const main = document.createElement('span');
      main.className = 'sp-main';
      main.textContent = c.name || `Spot ${c.spotId}`;
      const sub = document.createElement('span');
      sub.className = 'sp-sub';
      sub.textContent = CONFLICT_TEXT[c.kind];
      txt.append(main, sub);
      const choice = document.createElement('span');
      choice.className = 'seg';
      const actual = pending.choices[c.spotId] === 'theirs' ? 'theirs' : 'mine';
      for (const [label, value] of [['Mine', 'mine'], ['Web', 'theirs']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.classList.toggle('active', actual === value);
        b.setAttribute('aria-pressed', String(actual === value));
        b.addEventListener('click', () => {
          pending.choices[c.spotId] = value;
          renderReview();
        });
        choice.appendChild(b);
      }
      li.append(txt, choice);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  const acciones = document.createElement('div');
  acciones.className = 'field-row';
  const aplicar = document.createElement('button');
  aplicar.className = 'pill accent';
  aplicar.textContent = 'Apply update';
  aplicar.addEventListener('click', applyPending);
  const cancelar = document.createElement('button');
  cancelar.className = 'pill';
  cancelar.textContent = 'Cancel';
  cancelar.addEventListener('click', () => {
    pending = null;
    renderReview();
  });
  acciones.append(aplicar, cancelar);
  box.appendChild(acciones);
}

function applyPending() {
  if (!pending) return;
  const d = store.getState().straboDatasets.find((x) => x.key === pending.key);
  if (!d) {
    pending = null;
    renderReview();
    return;
  }
  /*
   * Entre revisar y aplicar se pudo seguir editando. El plan se rehace con el
   * dibujo de ahora; si los conflictos ya no son los mismos, se vuelve a
   * enseñar en vez de aplicar decisiones tomadas sobre otra situación.
   */
  const plan = makePlan(d, pending.remote);
  if (conflictKey(plan) !== conflictKey(pending.plan)) {
    pending.plan = plan;
    onMessage('The drawing changed while reviewing: check the list again before applying.', 'warn');
    renderReview();
    return;
  }
  const r = store.applyStraboUpdate(d.key, {
    data: pending.remote,
    baseline: pending.remote.baseline,
    plan,
    choices: pending.choices,
  });
  const partes = [];
  if (d.adopted) {
    if (r.added) partes.push(`${r.added} feature(s) brought in`);
    if (r.removed) partes.push(`${r.removed} removed`);
    const mias = plan.conflicts.filter((c) => pending.choices[c.spotId] !== 'theirs').length;
    if (mias) partes.push(`${mias} conflict(s) kept as yours`);
  } else {
    const s2 = planSummary(plan, false);
    if (s2) partes.push(s2);
  }
  onMessage(
    `“${d.datasetName}” updated${partes.length ? `: ${partes.join(', ')}` : ''}. Undo reverts it.` +
      (r.warnings && r.warnings.length ? ` ${r.warnings.join(' ')}` : ''),
    'info',
  );
  pending = null;
  renderReview();
}

/* ---------- subir los cambios al mismo dataset ---------- */

/**
 * SUBIR A UN DATASET QUE YA EXISTE
 *
 * StraboSpot reemplaza el dataset entero con lo que se le manda, así que cada
 * paso de aquí existe para que lo mandado sea lo de arriba más lo editado, y
 * nada menos:
 *
 * 1. **Al día o nada.** Si arriba cambió algo desde la última sincronización,
 *    no se sube: primero ⟳. Subir encima pisaría el trabajo de otro.
 * 2. **Leer entero.** Se baja el dataset en su forma nativa y sus ids tienen
 *    que ser exactamente los de la lectura de siempre. Si no cuadran, no se
 *    escribe.
 * 3. **Solo lo editado.** Cada spot cambiado parte de su versión nativa y
 *    cambia solo los campos editados aquí (ver `push.js`).
 * 4. **Revisar.** Se enseña qué se cambia, qué no se puede subir y por qué, y
 *    se elige si añadir lo dibujado aquí y si borrar lo que aquí se borró.
 * 5. **Volver a comprobar.** Al confirmar se repite todo; si algo cambió
 *    mientras se revisaba, se vuelve a enseñar.
 * 6. **Respaldo.** Antes de escribir, se descarga una copia del dataset tal
 *    como está arriba.
 * 7. **Verificar.** Después se vuelve a leer: tienen que estar los spots que
 *    se mandaron, ni uno más ni uno menos.
 */

/** Lo dibujado aquí que no es de ningún dataset y se podría subir. */
function ownUploadable() {
  return store
    .unlockedFeatures()
    .filter((f) => !f.properties.straboDataset && uploadableCount([f]) === 1);
}

const sameKeys = (a, b) => {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

async function preparePush(d) {
  if (!d.baseline) {
    throw new Error(`Press ⟳ on “${d.datasetName}” first, so FieldDraw knows exactly what is in StraboSpot.`);
  }
  const remote = await fetchDataset(d.datasetId, d.projectId, { field: d.field, geologist: d.geologist });
  if (!sameKeys(d.baseline, remote.baseline)) {
    throw new Error(
      `“${d.datasetName}” changed in StraboSpot since your last sync. Press ⟳ to bring those ` +
        'changes in first, then upload: uploading now would overwrite them.',
    );
  }
  const native = await api.getNativeDatasetSpots(d.datasetId);
  const esperados = Object.keys(remote.baseline);
  const leidos = spotIdsOf(native);
  if (leidos.size !== esperados.length || !esperados.every((id) => leidos.has(id))) {
    throw new Error(
      `Could not read the whole of “${d.datasetName}” from StraboSpot (${leidos.size} of ` +
        `${esperados.length} spots). Nothing was written.`,
    );
  }
  const push = buildPush({ native, data: remote, dataset: d, features: featuresOf(d.key) });
  return { mode: 'push', key: d.key, remote, native, push, nuevos: ownUploadable() };
}

/** Firma de lo que se va a subir, para saber si cambió al confirmar. */
const pushKey = (p) =>
  JSON.stringify([
    p.push.changed.map((c) => [c.id, c.fields]),
    p.push.skipped.map((c) => c.id),
    p.push.deleted.map((c) => c.id),
    p.nuevos.map((f) => f.properties.id),
  ]);

export async function checkStraboPush(key) {
  const d = store.getState().straboDatasets.find((x) => x.key === key);
  if (!d) return;
  if (!api.isAuthenticated()) {
    onMessage('Sign in to StraboSpot to upload.', 'warn');
    return;
  }
  if (d.locked || !d.adopted || !d.datasetId) {
    onMessage(`Open the lock of “${d.datasetName}” to upload its changes.`, 'warn');
    return;
  }
  onBusy(`Comparing “${d.datasetName}” with StraboSpot…`);
  try {
    pending = { ...(await preparePush(d)), includeNew: false, includeDelete: false };
  } catch (err) {
    pending = null;
    onMessage(err.message, 'warn');
  } finally {
    onBusy(null);
    renderReview();
  }
}

function lista(box, items, render) {
  const ul = document.createElement('ul');
  ul.className = 'strabo-conflicts';
  for (const it of items) {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.className = 'sp-text';
    const main = document.createElement('span');
    main.className = 'sp-main';
    const sub = document.createElement('span');
    sub.className = 'sp-sub';
    const [a, b] = render(it);
    main.textContent = a;
    sub.textContent = b;
    t.append(main, sub);
    li.appendChild(t);
    ul.appendChild(li);
  }
  box.appendChild(ul);
}

function parrafo(box, text, cls = 'hint') {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  box.appendChild(p);
}

function casilla(box, text, checked, onChange) {
  const label = document.createElement('label');
  label.className = 'check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  label.append(cb, document.createTextNode(` ${text}`));
  box.appendChild(label);
}

function renderPushReview(box, d) {
  const { push, nuevos } = pending;
  const h = document.createElement('h3');
  h.className = 'palette-label';
  h.textContent = `Upload to “${d.datasetName}”`;
  box.appendChild(h);

  if (push.changed.length) {
    parrafo(box, `${push.changed.length} spot(s) edited here will be updated in StraboSpot:`);
    lista(box, push.changed, (c) => [c.name, `Changes: ${c.fields.join(', ')}`]);
  } else {
    parrafo(box, 'No spot of this dataset was edited here.');
  }
  if (push.skipped.length) {
    parrafo(box, `${push.skipped.length} edited spot(s) cannot be uploaded and stay as they are in StraboSpot:`, 'hint footnote');
    lista(box, push.skipped, (c) => [c.name, c.reasons.join('; ')]);
  }
  if (nuevos.length) {
    casilla(box, `Also add ${nuevos.length} feature(s) drawn here as new spots`, pending.includeNew, (v) => {
      pending.includeNew = v;
    });
  }
  if (push.deleted.length) {
    casilla(
      box,
      `Delete ${push.deleted.length} spot(s) you deleted here: ${push.deleted.map((x) => x.name).join(', ')}`,
      pending.includeDelete,
      (v) => {
        pending.includeDelete = v;
      },
    );
  }
  parrafo(
    box,
    'Every other spot is sent back exactly as it is in StraboSpot, photos and samples included. ' +
      'A backup of the dataset as it is now is downloaded to this device before anything is written.',
    'hint footnote',
  );

  const acciones = document.createElement('div');
  acciones.className = 'field-row';
  const subir = document.createElement('button');
  subir.className = 'pill accent';
  subir.textContent = 'Upload';
  subir.addEventListener('click', confirmPush);
  const cancelar = document.createElement('button');
  cancelar.className = 'pill';
  cancelar.textContent = 'Cancel';
  cancelar.addEventListener('click', () => {
    pending = null;
    renderReview();
  });
  acciones.append(subir, cancelar);
  box.appendChild(acciones);
}

/** «strabospot-backup-ana-2026-10-04T15-20-03.json» */
function backupName(d) {
  const slug = String(d.datasetName || 'dataset')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'dataset';
  return `strabospot-backup-${slug}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
}

async function confirmPush() {
  if (!pending || pending.mode !== 'push') return;
  const d = store.getState().straboDatasets.find((x) => x.key === pending.key);
  if (!d) return;
  const { includeNew, includeDelete } = pending;
  onBusy('Checking StraboSpot again…');
  let respaldo = null;
  try {
    const fresh = await preparePush(d);
    if (pushKey(fresh) !== pushKey(pending)) {
      pending = { ...fresh, includeNew, includeDelete };
      onMessage('Something changed while reviewing: check the list again before uploading.', 'warn');
      return;
    }

    const st = store.getState();
    const nuevos = includeNew ? fresh.nuevos : [];
    const added = nuevos.length
      ? featuresToSpots(nuevos, { field: d.field, geologist: d.geologist, units: st.units })
      : null;
    const newSpotIds = {};
    if (added) {
      nuevos.forEach((f, i) => {
        newSpotIds[f.properties.id] = String(added.collection.features[i].properties.id);
      });
    }
    const deletedIds = includeDelete ? fresh.push.deleted.map((x) => x.id) : [];
    if (fresh.push.changed.length === 0 && deletedIds.length === 0 && !added) {
      onMessage('There is nothing to upload.', 'info');
      pending = null;
      return;
    }
    const collection = assembleCollection(fresh.native, {
      spots: fresh.push.spots,
      deletedIds,
      added: added ? added.collection.features : [],
    });
    const esperados = spotIdsOf(collection);

    respaldo = backupName(d);
    downloadBlob(
      new Blob([JSON.stringify(fresh.native)], { type: 'application/json' }),
      respaldo,
    );

    onBusy(`Uploading to “${d.datasetName}”…`);
    await api.uploadSpots(d.datasetId, collection);

    onBusy('Verifying…');
    const despues = spotIdsOf(await api.getNativeDatasetSpots(d.datasetId));
    if (despues.size !== esperados.size || ![...esperados].every((id) => despues.has(id))) {
      throw new Error(
        `StraboSpot now shows ${despues.size} spot(s) where ${esperados.size} were sent. ` +
          `The dataset as it was before is in the backup file ${respaldo}.`,
      );
    }

    let notaTags = '';
    if (added && added.tags.length && $('strabo-upload-tags').checked) {
      try {
        await writeUnitTags(d.projectId, added.tags);
      } catch (err) {
        notaTags = ` The new spots are up, but their geologic-unit tags could not be written (${err.message}).`;
      }
    }

    const remote2 = await fetchDataset(d.datasetId, d.projectId, { field: d.field, geologist: d.geologist });
    store.markStraboPushed(d.key, {
      baseline: remote2.baseline,
      newSpotIds,
      deletedSpotIds: deletedIds,
      skippedSpotIds: fresh.push.skipped.map((x) => x.id),
    });

    const partes = [];
    if (fresh.push.changed.length) partes.push(`${fresh.push.changed.length} spot(s) updated`);
    if (added) partes.push(`${added.count} new`);
    if (deletedIds.length) partes.push(`${deletedIds.length} deleted`);
    if (fresh.push.skipped.length) partes.push(`${fresh.push.skipped.length} left as they were`);
    onMessage(
      `Uploaded to “${d.datasetName}”: ${partes.join(', ')}. Backup saved as ${respaldo}.${notaTags}`,
      'info',
    );
    pending = null;
  } catch (err) {
    onMessage(
      `Upload stopped: ${err.message}` +
        (respaldo && !/backup file/.test(err.message) ? ` A backup was saved as ${respaldo}.` : ''),
      'warn',
    );
  } finally {
    onBusy(null);
    renderReview();
  }
}

/** `/db/project/{id}` trae los tags con la lista de spots de cada uno. */
async function getProjectTags(projectId) {
  if (!projectId) return {};
  const res = await api.getProject(projectId);
  return spotTagsFrom(res && res.tags);
}

/**
 * Sube el dibujo como un dataset nuevo del proyecto elegido.
 *
 * Son dos escrituras distintas y se informan por separado a propósito: los
 * spots van al dataset nuevo y no tocan nada de lo que ya había, pero los tags
 * de unidad se escriben en el PROYECTO, que es un objeto compartido. Si lo
 * segundo falla, lo primero ya está subido y hay que decirlo así, no como un
 * fracaso entero.
 */
async function doUpload() {
  const projectId = $('strabo-project').value;
  if (!projectId) {
    onMessage('Pick the project the new dataset should belong to.', 'warn');
    return;
  }

  const st = store.getState();
  const { collection, count, tags, breakdown } = featuresToSpots(uploadSource(), {
    field: $('strabo-field').value.trim(),
    geologist: $('strabo-geologist').value.trim(),
    units: st.units,
  });
  if (count === 0) {
    onMessage('There is nothing to upload: draw a measurement, a line or a polygon first.', 'warn');
    return;
  }

  const datasetName = $('strabo-dataset-name').value.trim() || suggestedDatasetName();
  const conTags = $('strabo-upload-tags').checked && tags.length > 0;

  onBusy('Creating dataset…');
  try {
    const dataset = await api.createDataset(datasetName);
    await api.addDatasetToProject(projectId, dataset.id);
    onBusy(`Uploading ${count} spot(s)…`);
    await api.uploadSpots(dataset.id, collection);

    let notaTags = '';
    if (conTags) {
      onBusy('Writing geologic-unit tags…');
      try {
        const { added, updated } = await writeUnitTags(projectId, tags);
        notaTags =
          ` ${added.length} new geologic unit(s)` +
          (updated.length ? ` and ${updated.length} existing one(s) updated.` : '.');
      } catch (err) {
        // Los spots ya están arriba: esto es una subida incompleta, no fallida.
        notaTags =
          ` The spots are up, but the geologic-unit tags could not be written (${err.message}); ` +
          `the polygons will show without a unit name or colour.`;
      }
    }

    onMessage(
      `Uploaded ${describe(breakdown)} to StraboSpot as dataset “${datasetName}”.${notaTags} ` +
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

/**
 * Añade los tags de unidad al proyecto. Se lee primero porque `POST /db/project`
 * reenvía el proyecto entero y lo que no se mande se pierde.
 */
async function writeUnitTags(projectId, tags) {
  const actual = await api.getProject(projectId);
  const { project, added, updated } = mergeGeologicUnitTags(actual, tags);
  await api.updateProject(project);
  return { added, updated };
}
