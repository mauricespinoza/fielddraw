/**
 * Respaldo del proyecto: historial de versiones local y copia en Google Drive.
 *
 * Los dos guardan lo mismo —los DATOS del proyecto, el contenido de un
 * `.fdproj.json.gz`— y comparten una sola serialización: si los dos relojes
 * caen juntos, el proyecto se convierte a JSON y se comprime una vez. La
 * huella del contenido (sin la hora de guardado) evita guardar o subir dos
 * veces lo mismo.
 *
 * Ritmos (ver `autosave.js`):
 * - historial local: tras 60 s sin cambios, como mucho cada 5 min;
 * - Drive: tras 20 s sin cambios, como mucho cada 2 min, y solo con señal y
 *   sesión. Sin una de las dos, queda pendiente y sale sola al volver.
 *
 * El paquete completo (`.fdproj.zip`, con mapas y DEM) NO se autoguarda:
 * pesa cientos de MB. Se sube a mano con «Back up everything to Drive».
 *
 * VÍNCULO CON DRIVE. El proyecto abierto queda ligado a UN archivo de Drive
 * (su id se recuerda en el dispositivo). Cada autoguardado actualiza ese
 * archivo y Drive conserva las revisiones anteriores. Abrir otro proyecto o
 * empezar uno nuevo rompe el vínculo: el siguiente autoguardado crea un
 * archivo nuevo en vez de pisar el del proyecto anterior. Abrir desde Drive
 * vincula con el archivo abierto.
 */

import * as store from './store.js';
import { serializeProject } from './project.js';
import { gzipText, stringifyCompact } from './compact.js';
import { WAIT, contentHash, createScheduler } from './autosave.js';
import { takeSnapshot } from './snapshots.js';
import { loadSavedProjectName } from './persistence.js';
import * as auth from './drive/auth.js';
import * as drive from './drive/api.js';

/** Lo que entra en los datos del proyecto (no las capas importadas ni los mapas). */
const DATA_KEYS = [
  'features',
  'units',
  'ornaments',
  'structureStyle',
  'controlPointStyle',
  'importStyle',
  'straboDatasets',
  'savedSections',
];

const AUTOSAVE_KEY = 'fielddraw.drive.autosave.v1';
const BINDING_KEY = 'fielddraw.drive.binding.v1';

const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* sin storage */
    }
  },
};

/* ------------------------------------------------- serialización compartida */

let rev = 0;
let cache = null;

/** ¿Hay algo que valga la pena respaldar? Un proyecto vacío no pisa nada. */
function hayDatos(st) {
  return !!(st.features.length || st.savedSections.length || st.straboDatasets.length);
}

/** Los datos del proyecto listos para guardar, reutilizando la última serialización si nada cambió. */
async function preparar() {
  const name = loadSavedProjectName();
  if (cache && cache.rev === rev && cache.name === name) return cache;
  const r = rev;
  const st = store.getState();
  if (!hayDatos(st)) return null;
  const data = serializeProject(name);
  const text = stringifyCompact(data);
  // `savedAt` es lo primero con fecha del JSON: fuera de la huella, o cada
  // copia parecería distinta aunque no cambiara nada.
  const hash = contentHash(text.replace(data.savedAt, ''));
  const { blob, gzip } = await gzipText(text);
  cache = { rev: r, name, hash, blob, gzip, plainBytes: text.length, features: data.features.length };
  return cache;
}

/* ---------------------------------------------------------- historial */

const snapSched = createScheduler({
  idleMs: 60e3,
  maxWaitMs: 5 * 60e3,
  run: async () => {
    const p = await preparar();
    if (!p) return true;
    const r = await takeSnapshot({ ...p, reason: 'auto' });
    return r !== 'failed';
  },
});

/**
 * Foto inmediata (antes de abrir otro proyecto, de empezar uno nuevo o de
 * restaurar una versión). Nunca falla ni tarda más de lo que cuesta guardar.
 */
export async function snapshotNow(reason = 'manual') {
  try {
    const p = await preparar();
    if (!p) return 'empty';
    const r = await takeSnapshot({ ...p, reason });
    if (r !== 'failed') snapSched.cancel();
    return r;
  } catch (err) {
    console.warn('[historial]', err);
    return 'failed';
  }
}

/* --------------------------------------------------------------- Drive */

let estado = { state: 'off', at: 0, message: '' };
const oyentes = new Set();

function setEstado(state, extra = {}) {
  estado = { ...estado, state, message: '', ...extra };
  for (const fn of oyentes) {
    try {
      fn(estado);
    } catch (err) {
      console.warn(err);
    }
  }
}

/** Estado de Drive para la interfaz. */
export function driveStatus() {
  return { ...estado, pending: driveSched.pending, email: auth.getEmail() };
}

export function onDriveStatus(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

export function driveConfigured() {
  return auth.looksLikeClientId(auth.getClientId());
}

export function driveConnected() {
  return !!auth.getToken();
}

export function driveAutosaveOn() {
  return ls.get(AUTOSAVE_KEY) === '1';
}

function vinculo() {
  try {
    return JSON.parse(ls.get(BINDING_KEY) || 'null') || {};
  } catch {
    return {};
  }
}

let epoca = 0;
function guardarVinculo(v) {
  ls.set(BINDING_KEY, JSON.stringify(v));
}

/** Nombre del archivo de datos en Drive (sin fecha: es siempre el mismo archivo). */
export function driveDataName(projectName, gzip = true) {
  const slug =
    String(projectName || 'fielddraw')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'fielddraw';
  return `${slug}.fdproj.json${gzip ? '.gz' : ''}`;
}

const enLinea = () => typeof navigator === 'undefined' || navigator.onLine !== false;

async function subirDatos() {
  if (!driveAutosaveOn() || !driveConfigured()) return true;
  if (!enLinea()) {
    setEstado('offline');
    return WAIT;
  }
  const token = auth.getToken();
  if (!token) {
    setEstado('needs-auth');
    return WAIT;
  }
  const p = await preparar();
  if (!p) {
    setEstado('idle');
    return true;
  }
  const v = vinculo();
  const base = driveDataName(p.name, p.gzip);
  if (v.fileId && v.hash === p.hash && v.base === base) {
    setEstado('saved', { at: v.at || 0 });
    return true;
  }
  const miEpoca = epoca;
  setEstado('saving');
  try {
    const folderId = await drive.ensureFolder(token);
    let name = v.name || base;
    if (!v.fileId || v.base !== base) {
      const ocupados = (await drive.namesInFolder(token, folderId)).filter((n) => !(v.fileId && n === v.name));
      name = drive.freeName(base, ocupados);
    }
    const f = await drive.uploadSmall(token, {
      fileId: v.fileId,
      folderId,
      name,
      blob: p.blob,
      keepalive: typeof document !== 'undefined' && document.visibilityState === 'hidden',
    });
    const at = Date.now();
    // Si mientras subía se abrió otro proyecto, este resultado ya no manda.
    if (miEpoca === epoca) guardarVinculo({ ...vinculo(), fileId: f.id, name: f.name, base, hash: p.hash, at });
    setEstado('saved', { at, fileName: f.name });
    return true;
  } catch (err) {
    if (err instanceof drive.DriveAuthError) {
      setEstado('needs-auth');
      return WAIT;
    }
    if (err.status === 0) {
      setEstado('offline');
      return WAIT;
    }
    setEstado('error', { message: err.message });
    return false;
  }
}

const driveSched = createScheduler({ idleMs: 20e3, maxWaitMs: 2 * 60e3, run: subirDatos });

/**
 * Conecta con Google (desde un toque). En el iPad instalado la app se va a
 * Google y vuelve: `beforeRedirect` deja guardado lo pendiente antes.
 */
export async function driveConnect({ beforeRedirect } = {}) {
  setEstado('connecting');
  try {
    const token = await auth.signIn({
      beforeRedirect: () => {
        flushBackups();
        if (beforeRedirect) beforeRedirect();
      },
    });
    await despuesDeConectar(token);
  } catch (err) {
    setEstado(auth.getToken() ? 'idle' : 'off', { message: err.message });
    throw err;
  }
}

async function despuesDeConectar(token) {
  try {
    const u = await drive.aboutUser(token);
    if (u.email) auth.setEmail(u.email);
  } catch {
    /* el correo es solo para mostrarlo */
  }
  if (!ls.get(AUTOSAVE_KEY)) ls.set(AUTOSAVE_KEY, '1'); // primera vez: autoguardado encendido
  setEstado('idle');
  driveSched.mark();
  driveSched.flush();
}

export async function driveDisconnect() {
  driveSched.cancel();
  await auth.signOut();
  setEstado('off');
}

export function setDriveAutosave(on) {
  ls.set(AUTOSAVE_KEY, on ? '1' : '0');
  if (on) {
    driveSched.mark();
    driveSched.flush();
  } else {
    driveSched.cancel();
    setEstado(driveConnected() ? 'idle' : 'off');
  }
}

export function setDriveClientId(id) {
  auth.setClientId(id);
  setEstado(driveConnected() ? 'idle' : 'off');
}

export function driveClientId() {
  return auth.getClientId();
}

/** El proyecto abierto ya no es el del archivo vinculado (se abrió otro o se empezó uno nuevo). */
export function driveUnbind() {
  epoca++;
  guardarVinculo({});
  driveSched.cancel();
}

/**
 * Antes de cambiar de proyecto (abrir otro, empezar uno nuevo, restaurar una
 * versión): foto en el historial, lo pendiente a Drive —con un plazo corto,
 * para no dejar a nadie esperando sin señal— y fuera el vínculo.
 */
export async function beforeProjectSwitch(reason) {
  await snapshotNow(reason);
  if (driveSched.pending && driveAutosaveOn() && driveConnected() && enLinea()) {
    await Promise.race([driveSched.flush(), new Promise((r) => setTimeout(r, 8000))]);
  }
  driveUnbind();
}

/** El proyecto abierto ES este archivo de Drive (se abrió desde ahí). */
export function driveBindTo({ id, name }) {
  epoca++;
  // Sin huella: el primer autoguardado lo reescribe una vez con el formato de esta versión.
  guardarVinculo({ fileId: id, name, base: '' });
}

function tokenOError() {
  const t = auth.getToken();
  if (!t) throw new drive.DriveAuthError('connect Google Drive first', 401);
  return t;
}

/** Los archivos de la carpeta FieldDraw del Drive. */
export async function driveList() {
  const token = tokenOError();
  const folderId = await drive.ensureFolder(token);
  return drive.listFolder(token, folderId);
}

export async function driveDownload(id) {
  return drive.downloadFile(tokenOError(), id);
}

/**
 * Sube el paquete completo. Se vincula como el de datos: la próxima vez
 * actualiza el mismo archivo (si el proyecto sigue siendo el mismo).
 */
export async function driveUploadPackage(blob, filename, { onProgress, signal } = {}) {
  const token = tokenOError();
  const folderId = await drive.ensureFolder(token);
  const v = vinculo();
  const base = filename.replace(/-\d{4}-\d{2}-\d{2}(\.fdproj\.zip)$/, '$1');
  let name = v.zipName || base;
  if (!v.zipId || v.zipBase !== base) {
    const ocupados = (await drive.namesInFolder(token, folderId)).filter((n) => !(v.zipId && n === v.zipName));
    name = drive.freeName(base, ocupados);
  }
  const miEpoca = epoca;
  const f = await drive.uploadResumable(token, {
    fileId: v.zipId,
    folderId,
    name,
    blob: new Blob([blob], { type: 'application/zip' }),
    onProgress,
    signal,
  });
  if (miEpoca === epoca) guardarVinculo({ ...vinculo(), zipId: f.id, zipName: f.name, zipBase: base, zipAt: Date.now() });
  return f;
}

/* ------------------------------------------------------------ arranque */

/** Guarda ya lo pendiente de los dos (al pasar a segundo plano, antes de irse). */
export function flushBackups() {
  snapSched.flush();
  driveSched.flush();
}

/** Algo de los datos del proyecto cambió (lo llama también el nombre del proyecto). */
export function markProjectChanged() {
  rev++;
  snapSched.mark();
  if (driveAutosaveOn()) driveSched.mark();
}

/**
 * Se llama una vez al arrancar. Devuelve el resultado de volver de Google por
 * redirección (o `null`), para que la interfaz lo cuente.
 */
export function initBackups() {
  const vuelta = auth.consumeRedirectResult();
  store.subscribe(() => {
    if (DATA_KEYS.some((k) => store.changed(k))) markProjectChanged();
  });
  addEventListener('online', () => driveSched.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBackups();
  });
  addEventListener('pagehide', flushBackups);

  if (!driveConfigured()) setEstado('off');
  else if (driveConnected()) setEstado('idle');
  else if (auth.wasConnected() && driveAutosaveOn()) setEstado('needs-auth');
  else setEstado('off');

  if (vuelta && vuelta.ok) despuesDeConectar(auth.getToken());
  else if (vuelta) setEstado('off', { message: vuelta.error });
  // Lo que quedara sin subir de la sesión anterior: la huella dice si hace falta.
  if (driveAutosaveOn() && driveConnected()) {
    rev++;
    driveSched.mark();
  }
  return vuelta;
}
