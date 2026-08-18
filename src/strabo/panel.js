import * as store from '../store.js';
import * as api from './api.js';
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

  store.subscribe(() => {
    if (store.changed('features') || store.changed('strabo')) render();
  });

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
