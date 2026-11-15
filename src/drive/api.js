/**
 * Lo mínimo de la API REST de Google Drive v3 que necesita el respaldo.
 *
 * Todo vive en una carpeta «FieldDraw» de la raíz del Drive. Con el permiso
 * `drive.file` la app solo ve lo que creó ella, así que buscar ahí no puede
 * tocar nada ajeno.
 *
 * - Archivos pequeños (los datos, `.fdproj.json.gz`): una sola petición
 *   `multipart` que lleva a la vez el nombre y el contenido; se crea la
 *   primera vez y después se ACTUALIZA el mismo archivo. Drive guarda solo las
 *   revisiones anteriores, que es un historial gratis.
 * - Archivos grandes (el paquete `.fdproj.zip` con mapas y DEM): subida
 *   REANUDABLE por trozos de 8 MB. Si se corta la señal, se pregunta a Drive
 *   cuánto llegó y se sigue desde ahí, en vez de volver a empezar un GB.
 */

import { dropToken } from './auth.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const FOLDER_NAME = 'FieldDraw';
const FOLDER_KEY = 'fielddraw.drive.folder-id.v1';
/** Múltiplo de 256 KiB, como exige Drive. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export class DriveError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

/** El token ya no vale (o no hay): hay que volver a conectar. */
export class DriveAuthError extends DriveError {}

/* ------------------------------------------------------------ puras */

/** Literal para el `q` de Drive: comillas y barras escapadas. */
export function qLiteral(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Cuerpo `multipart/related`: metadatos JSON + contenido. */
export function multipartBody(metadata, blob, boundary) {
  return new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
}

/**
 * Cuántos bytes tiene ya Drive según la cabecera `Range` de un 308
 * (`bytes=0-1048575` → 1048576). Sin cabecera, nada.
 */
export function receivedFromRange(range) {
  const m = /bytes=0-(\d+)/.exec(range || '');
  return m ? Number(m[1]) + 1 : 0;
}

/** Nombre libre en la carpeta: `base`, o `base (2)`, `base (3)`… antes de la extensión. */
export function freeName(base, taken) {
  const usados = new Set(taken);
  if (!usados.has(base)) return base;
  const m = /^(.*?)(\.fdproj\..*)?$/.exec(base);
  const raiz = m[1];
  const ext = m[2] || '';
  for (let i = 2; ; i++) {
    const n = `${raiz} (${i})${ext}`;
    if (!usados.has(n)) return n;
  }
}

/* ------------------------------------------------------------ red */

async function driveFetch(token, url, opts = {}) {
  if (!token) throw new DriveAuthError('not signed in to Google Drive', 401);
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new DriveError(`no connection to Google Drive (${err.message})`, 0);
  }
  if (res.status === 401) {
    dropToken();
    throw new DriveAuthError('the Google sign-in expired', 401);
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = (j.error && j.error.message) || msg;
    } catch {
      /* cuerpo vacío */
    }
    if (res.status === 403 && /insufficient|scope/i.test(msg)) {
      dropToken();
      throw new DriveAuthError(`Google Drive refused: ${msg}`, 403);
    }
    throw new DriveError(`Google Drive: ${msg}`, res.status);
  }
  return res;
}

const json = async (p) => (await p).json();

/** Quién está conectado (para mostrarlo y como `login_hint` la próxima vez). */
export async function aboutUser(token) {
  const j = await json(driveFetch(token, `${API}/about?fields=user(emailAddress,displayName)`));
  return { email: (j.user && j.user.emailAddress) || '', name: (j.user && j.user.displayName) || '' };
}

/** La carpeta FieldDraw: la recordada si sigue viva, la que haya, o una nueva. */
export async function ensureFolder(token) {
  let id = '';
  try {
    id = localStorage.getItem(FOLDER_KEY) || '';
  } catch {
    id = '';
  }
  if (id) {
    try {
      const f = await json(driveFetch(token, `${API}/files/${id}?fields=id,trashed`));
      if (f && f.id && !f.trashed) return f.id;
    } catch (err) {
      if (err instanceof DriveAuthError) throw err;
      if (err.status === 0) throw err; // sin red: no inventar una carpeta nueva
    }
  }
  const q = `mimeType=${qLiteral(FOLDER_MIME)} and name=${qLiteral(FOLDER_NAME)} and trashed=false`;
  const lista = await json(
    driveFetch(token, `${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive&pageSize=1`),
  );
  id = lista.files && lista.files[0] ? lista.files[0].id : '';
  if (!id) {
    const f = await json(
      driveFetch(token, `${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
      }),
    );
    id = f.id;
  }
  try {
    localStorage.setItem(FOLDER_KEY, id);
  } catch {
    /* ignorar */
  }
  return id;
}

/** Los archivos de la carpeta, del más reciente al más antiguo. */
export async function listFolder(token, folderId) {
  const q = `${qLiteral(folderId)} in parents and trashed=false`;
  const j = await json(
    driveFetch(
      token,
      `${API}/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=200&fields=files(id,name,size,modifiedTime,mimeType)`,
    ),
  );
  return j.files || [];
}

/** El contenido de un archivo. */
export async function downloadFile(token, id) {
  const res = await driveFetch(token, `${API}/files/${id}?alt=media`);
  return res.blob();
}

const FIELDS = 'id,name,modifiedTime,size';
const boundary = () => `fd${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/**
 * Sube un archivo pequeño: actualiza `fileId` (contenido y nombre) o crea uno
 * nuevo en la carpeta. Si `fileId` ya no existe (lo borraron en Drive), crea
 * otro. `keepalive` deja que la petición termine aunque la app pase a
 * segundo plano; el navegador solo lo admite hasta 64 KB.
 *
 * @returns {Promise<{id: string, name: string, modifiedTime: string}>}
 */
export async function uploadSmall(token, { fileId, folderId, name, blob, keepalive = false }) {
  const b = boundary();
  const enviar = (url, method, meta) => {
    const body = multipartBody(meta, blob, b);
    return json(
      driveFetch(token, url, {
        method,
        headers: { 'Content-Type': `multipart/related; boundary=${b}` },
        body,
        keepalive: keepalive && body.size < 60000,
      }),
    );
  };
  if (fileId) {
    try {
      return await enviar(`${UPLOAD}/files/${fileId}?uploadType=multipart&fields=${FIELDS}`, 'PATCH', { name });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }
  return enviar(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, 'POST', {
    name,
    parents: [folderId],
    mimeType: blob.type || 'application/octet-stream',
  });
}

/** Nombres que ya hay en la carpeta (para no repetir uno al crear). */
export async function namesInFolder(token, folderId) {
  return (await listFolder(token, folderId)).map((f) => f.name);
}

/** Un PUT de un trozo con XHR: `fetch` no informa del progreso de subida. */
function putChunk(url, blob, start, total, onBytes, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    const end = start + blob.size - 1;
    xhr.setRequestHeader('Content-Range', blob.size ? `bytes ${start}-${end}/${total}` : `bytes */${total}`);
    xhr.upload.onprogress = (e) => onBytes && onBytes(start + e.loaded);
    xhr.onload = () =>
      resolve({ status: xhr.status, range: xhr.getResponseHeader('Range'), text: xhr.responseText });
    xhr.onerror = () => reject(new DriveError('the upload was interrupted', 0));
    xhr.onabort = () => reject(new DriveError('the upload was cancelled', -1));
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob.size ? blob : null);
  });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sube un archivo grande por trozos, reanudando tras un corte.
 *
 * @param {(bytes: number, total: number) => void} [onProgress]
 * @returns {Promise<{id: string, name: string, modifiedTime: string}>}
 */
export async function uploadResumable(token, { fileId, folderId, name, blob, onProgress, signal }) {
  const total = blob.size;
  const mime = blob.type || 'application/octet-stream';
  const iniciar = async (id) => {
    const res = await driveFetch(
      token,
      id ? `${UPLOAD}/files/${id}?uploadType=resumable&fields=${FIELDS}` : `${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`,
      {
        method: id ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mime,
          'X-Upload-Content-Length': String(total),
        },
        body: JSON.stringify(id ? { name } : { name, parents: [folderId], mimeType: mime }),
      },
    );
    const loc = res.headers.get('Location');
    if (!loc) throw new DriveError('Google Drive did not start the upload');
    return loc;
  };
  let url;
  try {
    url = await iniciar(fileId);
  } catch (err) {
    if (!(fileId && err.status === 404)) throw err;
    url = await iniciar('');
  }

  let enviado = 0;
  let fallos = 0;
  while (true) {
    if (signal && signal.aborted) throw new DriveError('the upload was cancelled', -1);
    const trozo = blob.slice(enviado, Math.min(total, enviado + CHUNK_BYTES));
    let r;
    try {
      r = await putChunk(url, trozo, enviado, total, (b) => onProgress && onProgress(b, total), signal);
    } catch (err) {
      if (err.status === -1 || ++fallos > 6) throw err;
      // Corte de red: esperar y preguntar cuánto llegó.
      await espera(Math.min(30e3, 1000 * 2 ** fallos));
      try {
        const q = await putChunk(url, new Blob([]), 0, total, null, signal);
        if (q.status === 200 || q.status === 201) return JSON.parse(q.text);
        if (q.status === 308) enviado = receivedFromRange(q.range);
      } catch {
        /* sigue sin red: el próximo intento lo vuelve a preguntar */
      }
      continue;
    }
    if (r.status === 200 || r.status === 201) {
      if (onProgress) onProgress(total, total);
      return JSON.parse(r.text);
    }
    if (r.status === 308) {
      fallos = 0;
      enviado = r.range ? receivedFromRange(r.range) : enviado + trozo.size;
      if (onProgress) onProgress(enviado, total);
      continue;
    }
    if (r.status === 401) {
      dropToken();
      throw new DriveAuthError('the Google sign-in expired during the upload', 401);
    }
    if (r.status >= 500 && ++fallos <= 6) {
      await espera(Math.min(30e3, 1000 * 2 ** fallos));
      continue;
    }
    throw new DriveError(`Google Drive rejected the upload (${r.status})`, r.status);
  }
}
