import * as store from '../store.js';
import { openAttrs } from '../attrs.js';
import * as api from './api.js';
import { distinctValues, STRABO_FILTER_FIELD } from './layers.js';
import {
  buildEstructuras,
  buildLineasPoligonos,
  buildObservacion,
  flattenPointFeatures,
  rowsToGeoJSON,
} from './spots.js';
import { mergeGeologicUnitTags } from './mapping.js';
import { featuresToSpots, uploadBreakdown, uploadableCount } from './upload.js';

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
  $('strabo-adopt').addEventListener('click', () => {
    const d = store.getState().strabo;
    if (!d) return;
    offerAdopt(d.estructuras.features.length + d.lineas.features.length);
  });
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

  // El correo del último inicio de sesión, si "Remember me" estaba marcado.
  const lastEmail = localStorage.getItem(LAST_EMAIL_KEY);
  if (lastEmail) $('strabo-email').value = lastEmail;

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
  // El desglose dice qué se va a subir COMO QUÉ, que es lo que importa: una
  // medida no llega igual que una traza, y el recuento total lo esconde.
  $('strabo-upload-summary').textContent = n
    ? `${describe(uploadBreakdown(store.getState().features))} will be uploaded.`
    : '';
  // El nombre sugerido se rellena solo, pero no se pisa lo que ya se escribió.
  const nameInput = $('strabo-dataset-name');
  if (!nameInput.value.trim() && document.activeElement !== nameInput) {
    nameInput.placeholder = suggestedDatasetName();
  }

  $('strabo-loaded').classList.toggle('hidden', !data);
  if (data) {
    const e = data.estructuras.features.length;
    const o = data.observacion.features.length;
    const l = data.lineas.features.length;
    $('strabo-loaded-text').textContent =
      `${data.datasetName}: ${e} structure(s), ${o} observation(s), ${l} line/polygon(s).`;
    // Sin geometría cartográfica no hay nada que adoptar: las observaciones
    // solas no son ni trazas ni medidas.
    $('strabo-adopt').disabled = e + l === 0;
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
  // El nombre del spot es como el geólogo lo tiene anotado en la libreta, así
  // que encabeza siempre que exista; el tipo lo acompaña porque un mismo spot
  // puede traer varias mediciones.
  if (hit.layer.id === 'strabo-structures') {
    return [p.Name, p.Type].filter(Boolean).join(' · ') || 'Structure';
  }
  if (hit.layer.id === 'strabo-observations') return p.Name || 'Observation';
  return p.Name || (hit.geometry.type === 'Polygon' ? 'Polygon' : 'Line');
}

export function openStraboAttrs(hit, screen) {
  // Lo específico de un spot es el título y qué campos sobran; pintar el
  // recuadro y encajarlo en pantalla es igual para cualquier fuente.
  openAttrs({
    title: attrTitle(hit),
    entries: Object.entries(hit.properties || {}).filter(([k]) => !HIDDEN_ATTR_KEYS.has(k)),
    screen,
    isLong: (k) => LONG_ATTR_KEYS.has(k),
    empty: 'This spot has no attributes.',
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
      features: buildLineasPoligonos([...spots.line, ...spots.polygon], { field, geologist, spotTags }),
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
      // Preguntar aquí y no dejarlo en un botón escondido: quien acaba de
      // bajar un dataset sabe en ese momento si viene a mirarlo o a seguir
      // trabajando sobre él, y diez minutos después ya no se acuerda de que
      // se podía.
      offerAdopt(estructuras.features.length + lineas.features.length);
    }
  } catch (err) {
    onMessage(`Could not download: ${err.message}`, 'warn');
  } finally {
    onBusy(null);
    render();
  }
}

/**
 * ¿EDITAR LO QUE SE ACABA DE BAJAR?
 *
 * Un dataset bajado entra como capa de consulta: se ve y se toca para leer sus
 * atributos, pero no se puede mover un vértice ni cerrar un contacto. Eso está
 * bien para comprobar, y no sirve para lo que casi siempre se viene a hacer,
 * que es continuar el mapa de otra persona.
 *
 * Adoptarlo traduce su simbología a la de FieldDraw —una falla inversa entra
 * como cabalgamiento, con sus dientes— y lo deja editable con todas las
 * herramientas. Queda marcado con su color propio, así que sigue sabiéndose de
 * un vistazo qué se caminó y qué se heredó.
 */
function offerAdopt(cuantos) {
  if (!cuantos) return;
  const seguir = confirm(
    `Edit these ${cuantos} StraboSpot feature(s)?\n\n` +
      'They come in as a read-only layer. Bringing them into the drawing makes every tool work ' +
      'on them — vertices, split, merge, reshape, holes — and they travel in the project and the ' +
      'GeoPackage.\n\n' +
      'Their StraboSpot symbology is read on the way in: a reverse fault becomes a thrust with ' +
      'its teeth, trace quality becomes the certainty pattern, and geologic-unit tags become map ' +
      'units. Everything adopted is drawn in one colour so it stays apart from what you mapped ' +
      'here. Undo puts it back.\n\n' +
      'Observations and samples come in as control points, keeping their sample ID, ' +
      'description, purpose and the date they were taken; measurements stay measurements. ' +
      'Photos are not imported.',
  );
  if (!seguir) return;

  const r = store.adoptStraboData();
  if (!r || r.features.length === 0) {
    onMessage('Nothing in that dataset could be turned into drawing features.', 'warn');
    return;
  }
  const partes = [];
  if (r.stats.points) partes.push(`${r.stats.points} measurement(s)`);
  if (r.stats.lines) partes.push(`${r.stats.lines} line(s)`);
  if (r.stats.polygons) partes.push(`${r.stats.polygons} polygon(s)`);
  if (r.stats.controlPoints) partes.push(`${r.stats.controlPoints} control point(s)`);
  const resumen = `${partes.join(', ')} from StraboSpot are now editable.`;
  onMessage(r.warnings.length ? `${resumen} ${r.warnings.join(' ')}` : resumen, 'info');
  render();
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
  const { collection, count, tags, breakdown } = featuresToSpots(st.features, {
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
