/**
 * Cliente de la API REST de StraboSpot (https://strabospot.org).
 *
 * Los endpoints son los mismos que usa el plugin de QGIS `Strabo_to_Spots`,
 * más los de escritura que ese plugin no implementa. Documentación oficial:
 * https://strabospot.org/api
 *
 * Que esto funcione desde el navegador no era evidente y se comprobó antes de
 * escribirlo: StraboSpot responde `Access-Control-Allow-Origin: *` y admite la
 * cabecera `authorization`, así que una app servida desde otro dominio puede
 * llamarla directamente. Sin eso habría hecho falta un proxy propio y la app
 * dejaría de ser estática.
 *
 * Autenticación: HTTP Basic con el correo como usuario. Las credenciales se
 * guardan SOLO en memoria, nunca en localStorage: Basic obliga a reenviar la
 * contraseña en cada petición, y dejarla escrita en el disco de una tablet que
 * va a terreno es un riesgo que no compensa el ahorro de volver a escribirla.
 */

const BASE = 'https://strabospot.org';
const DB = `${BASE}/db`;

/** Credenciales de la sesión. Se pierden al recargar, a propósito. */
let auth = null;

export function isAuthenticated() {
  return auth !== null;
}

export function currentUser() {
  return auth ? auth.email : null;
}

export function signOut() {
  auth = null;
}

function authHeader() {
  if (!auth) throw new Error('Not signed in to StraboSpot.');
  return `Basic ${auth.token}`;
}

/**
 * `btoa` no admite caracteres fuera de latin1 y una contraseña puede traerlos.
 * Se codifica a UTF-8 primero, que es lo que espera el servidor.
 */
function basicToken(email, password) {
  const bytes = new TextEncoder().encode(`${email}:${password}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function request(method, url, { body, auth: needsAuth = true, timeout = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      // Deliberadamente SIN `Accept`. StraboSpot responde 406 "Not
      // Acceptable" si se manda `Accept: application/json` — comprobado
      // contra el servidor con curl antes de escribir esto, aislando la
      // cabecera exacta: `Accept: */*` y la ausencia total de `Accept`
      // funcionan los dos, solo el valor `application/json` falla. El plugin
      // de QGIS tampoco la manda. (`Accept-Charset`, que el plugin sí manda,
      // ni se intenta aquí: es una cabecera prohibida para `fetch()` y el
      // navegador la descarta en silencio.)
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(needsAuth ? { Authorization: authHeader() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 401) throw new Error('StraboSpot rejected the credentials (HTTP 401).');
    if (!res.ok) throw new Error(`StraboSpot returned HTTP ${res.status} for ${method} ${url}`);

    const text = await res.text();
    if (!text || text.trim() === '' || text.trim() === 'null') return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`StraboSpot returned a non-JSON response for ${method} ${url}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('StraboSpot did not respond in time.');
    // Un fallo de red aquí casi siempre es falta de señal, no un error de la API.
    if (err instanceof TypeError) {
      throw new Error('Could not reach StraboSpot. Is there an internet connection?');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- sesión */

/**
 * Valida las credenciales y las deja en memoria para las siguientes llamadas.
 * `/userAuthenticate` responde `{valid: "true"}` cuando son correctas.
 */
export async function signIn(email, password) {
  const res = await request('POST', `${BASE}/userAuthenticate`, {
    body: { email, password },
    auth: false,
  });
  const valid = res && (res.valid === true || res.valid === 'true');
  if (!valid) throw new Error('Wrong email or password.');
  auth = { email, token: basicToken(email, password) };
  return { email };
}

/* ---------------------------------------------------------------- lectura */

export async function listProjects() {
  const res = await request('GET', `${DB}/myProjects`);
  return ((res && res.projects) || []).map((p) => ({ id: p.id, name: p.name || '(unnamed)' }));
}

/** Info completa del proyecto; de aquí salen los tags que dan la columna Unit. */
export async function getProject(projectId) {
  return request('GET', `${DB}/project/${projectId}`);
}

export async function listDatasets(projectId) {
  const res = await request('GET', `${DB}/projectDatasets/${projectId}`);
  return ((res && res.datasets) || []).map((d) => ({ id: d.id, name: d.name || '(unnamed)' }));
}

/**
 * Spots de un dataset para un tipo de geometría. Un dataset sin geometrías de
 * ese tipo devuelve cuerpo vacío, que no es un error: son cero features.
 */
export async function getDatasetSpots(datasetId, geotype) {
  const res = await request('GET', `${DB}/datasetspotsarc/${datasetId}/${geotype}`);
  const features = (res && res.features) || [];
  for (const f of features) f.__geotype__ = geotype;
  return features;
}

export async function getAllDatasetSpots(datasetId) {
  const [point, line, polygon] = await Promise.all([
    getDatasetSpots(datasetId, 'point'),
    getDatasetSpots(datasetId, 'line'),
    getDatasetSpots(datasetId, 'polygon'),
  ]);
  return { point, line, polygon };
}

/* --------------------------------------------------------------- escritura */

export async function createDataset(name) {
  // El id lo genera el cliente, como hace la app móvil de StraboSpot: es un
  // entero grande derivado del reloj, único de sobra para este uso.
  const id = newStraboId();
  await request('POST', `${DB}/dataset`, {
    body: { id, name, modified_timestamp: Date.now(), date: new Date().toISOString() },
  });
  return { id, name };
}

export async function addDatasetToProject(projectId, datasetId) {
  await request('POST', `${DB}/projectDatasets/${projectId}`, { body: { id: datasetId } });
}

export async function createProject(name) {
  const id = newStraboId();
  await request('POST', `${DB}/project`, {
    body: {
      id,
      description: { project_name: name, start_date: new Date().toISOString() },
      modified_timestamp: Date.now(),
    },
  });
  return { id, name };
}

/**
 * Sube una FeatureCollection completa a un dataset.
 *
 * OJO, y está en mayúsculas en la documentación oficial: esto **reemplaza
 * todos los spots del dataset**. No hay forma de añadir sin reenviar todo. Por
 * eso la app solo sube a datasets que acaba de crear, nunca a uno existente.
 */
export async function uploadSpots(datasetId, featureCollection) {
  await request('POST', `${DB}/datasetspots/${datasetId}`, { body: featureCollection });
}

/** Ids al estilo StraboSpot: milisegundos + 4 dígitos aleatorios. */
export function newStraboId() {
  return Number(`${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`);
}
