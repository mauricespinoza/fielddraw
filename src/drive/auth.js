/**
 * Inicio de sesión con Google para guardar en Drive, sin servidor propio.
 *
 * POR QUÉ OAUTH «A MANO» Y NO LA LIBRERÍA DE GOOGLE (GIS)
 *
 * Google Identity Services abre una ventana emergente y espera que le
 * conteste por `postMessage`. En el iPad, con FieldDraw instalado en la
 * pantalla de inicio —que es como se usa en terreno—, esa ventana se abre en
 * un navegador aparte y la respuesta no vuelve nunca. El flujo implícito de
 * OAuth 2.0 que hay debajo de GIS es estándar y admite las dos formas:
 *
 * - **ventana emergente** (PC, Android, Safari normal): la app no se recarga;
 * - **redirección** (iPad/iPhone instalados): la app va a Google y vuelve.
 *   Lo dibujado ya está autoguardado, así que volver es como reabrirla.
 *
 * Las dos terminan en `oauth.html`, que deja la respuesta en localStorage
 * (mismo origen) y avisa por `BroadcastChannel`. No se usa `window.opener`:
 * las páginas de Google llevan Cross-Origin-Opener-Policy y lo cortan.
 *
 * El permiso pedido es `drive.file`: la app ve SOLO los archivos que ella
 * misma creó o que se abrieron con ella, nunca el resto del Drive. El token
 * dura una hora y en este flujo no hay renovación silenciosa: al caducar, el
 * respaldo queda pendiente hasta que se toque «Reconnect».
 *
 * La credencial del cliente (Client ID) no es secreta: va en el código de
 * cualquier app web con Google. Lo que la protege es la lista de orígenes
 * autorizados en la consola de Google Cloud.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/**
 * Client ID por omisión de la versión publicada. Vacío mientras no exista el
 * proyecto en Google Cloud: entonces el panel pide pegar uno (ver README,
 * «Google Drive»).
 */
export const DEFAULT_CLIENT_ID = '';

const CLIENT_KEY = 'fielddraw.drive.client-id.v1';
const TOKEN_KEY = 'fielddraw.drive.token.v1';
const EMAIL_KEY = 'fielddraw.drive.email.v1';
const STATE_KEY = 'fielddraw.drive.oauth-state.v1';
/** Donde `oauth.html` deja la respuesta. El nombre se repite allí. */
export const RETURN_KEY = 'fielddraw.drive.oauth-return.v1';
export const RETURN_CHANNEL = 'fielddraw-oauth';

/** Margen antes de que caduque el token: no se empieza una subida con 30 s de vida. */
const MARGEN_MS = 120e3;

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
      if (v === null || v === undefined || v === '') localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* sin storage */
    }
  },
};

/* ------------------------------------------------------------ puras */

/** URL de la página de retorno, junto a index.html (sin query ni hash). */
export function redirectUriFor(loc) {
  const base = `${loc.origin}${loc.pathname.replace(/[^/]*$/, '')}`;
  return `${base}oauth.html`;
}

export function buildAuthUrl({ clientId, redirectUri, state, loginHint = '', prompt = '' }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: DRIVE_SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) p.set('login_hint', loginHint);
  if (prompt) p.set('prompt', prompt);
  return `${AUTH_ENDPOINT}?${p}`;
}

/**
 * Lee el fragmento que Google pone en la URL de retorno
 * (`#access_token=…&expires_in=3599&state=…`, o `#error=…`).
 */
export function parseAuthResponse(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return {
    accessToken: p.get('access_token') || '',
    expiresIn: Number(p.get('expires_in')) || 0,
    scope: p.get('scope') || '',
    state: p.get('state') || '',
    error: p.get('error') || '',
  };
}

/** ¿iPhone/iPad? (iPadOS se presenta como Mac, pero con pantalla táctil.) */
export function isIOS(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = nav.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
}

/** ¿Hay que ir por redirección? En iOS instalado como app, sí. */
export function prefersRedirect(win = globalThis) {
  const nav = win.navigator;
  if (!isIOS(nav)) return false;
  const standalone =
    nav.standalone === true ||
    (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches);
  return standalone;
}

/** ¿Tiene pinta de Client ID web de Google? */
export function looksLikeClientId(id) {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(String(id || '').trim());
}

/* ------------------------------------------------------------ estado */

export function getClientId() {
  return ls.get(CLIENT_KEY) || DEFAULT_CLIENT_ID;
}

export function setClientId(id) {
  ls.set(CLIENT_KEY, String(id || '').trim());
}

export function getEmail() {
  return ls.get(EMAIL_KEY) || '';
}

export function setEmail(email) {
  ls.set(EMAIL_KEY, email || '');
}

/** El token si sigue vivo (con margen), o `''`. */
export function getToken(now = Date.now()) {
  try {
    const t = JSON.parse(ls.get(TOKEN_KEY) || 'null');
    if (t && t.accessToken && t.expiresAt - MARGEN_MS > now) return t.accessToken;
  } catch {
    /* corrupto: como si no hubiera */
  }
  return '';
}

/** ¿Hubo sesión alguna vez en este dispositivo (aunque el token caducara)? */
export function wasConnected() {
  return !!ls.get(TOKEN_KEY) || !!getEmail();
}

/** Lo llama la API ante un 401: el token ya no sirve aunque no haya caducado. */
export function dropToken() {
  ls.set(TOKEN_KEY, null);
}

function guardarRespuesta(res, now = Date.now()) {
  if (res.error) {
    throw new Error(res.error === 'access_denied' ? 'Google sign-in was cancelled' : `Google said: ${res.error}`);
  }
  if (!res.accessToken) throw new Error('Google returned no access token');
  // Con el consentimiento granular se puede desmarcar el permiso de Drive.
  if (res.scope && !res.scope.split(/\s+/).includes(DRIVE_SCOPE)) {
    throw new Error('access to Google Drive was not granted (tick the Drive box on the consent screen)');
  }
  ls.set(
    TOKEN_KEY,
    JSON.stringify({ accessToken: res.accessToken, expiresAt: now + (res.expiresIn || 3600) * 1000 }),
  );
  return res.accessToken;
}

/* ------------------------------------------------------------ flujo */

/** Lee y borra la respuesta que dejó `oauth.html`, si corresponde al pedido en curso. */
function tomarRespuesta() {
  const raw = ls.get(RETURN_KEY);
  if (!raw) return null;
  let hash = '';
  try {
    hash = JSON.parse(raw).hash || '';
  } catch {
    hash = '';
  }
  const res = parseAuthResponse(hash);
  const esperado = ls.get(STATE_KEY);
  if (!esperado || res.state !== esperado) return null; // de otro intento: se ignora
  ls.set(RETURN_KEY, null);
  ls.set(STATE_KEY, null);
  return res;
}

/**
 * Al arrancar: si la app vuelve de Google por redirección, guarda el token.
 *
 * @returns {{ok: true} | {ok: false, error: string} | null} null si no venía de Google
 */
export function consumeRedirectResult() {
  const res = tomarRespuesta();
  if (!res) return null;
  try {
    guardarRespuesta(res);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Pide (o renueva) el acceso. Tiene que llamarse desde un toque: es lo único
 * que deja abrir la ventana de Google sin que el navegador la bloquee.
 *
 * En modo redirección la página se va a Google y esta promesa no se resuelve:
 * el resultado lo recoge `consumeRedirectResult()` al volver.
 *
 * @param {{beforeRedirect?: () => void}} [opts] para dejar guardado lo pendiente
 * @returns {Promise<string>} el token
 */
export function signIn({ beforeRedirect } = {}) {
  const clientId = getClientId();
  if (!looksLikeClientId(clientId)) {
    return Promise.reject(new Error('no Google OAuth Client ID is set (see Project → Google Drive)'));
  }
  const email = getEmail();
  const redirect = prefersRedirect();
  const state = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}.${redirect ? 'r' : 'p'}`;
  ls.set(STATE_KEY, state);
  ls.set(RETURN_KEY, null);
  const url = buildAuthUrl({
    clientId,
    redirectUri: redirectUriFor(location),
    state,
    loginHint: email,
    // Sin cuenta recordada, que se pueda elegir; con ella, que no pregunte de más.
    prompt: email ? '' : 'select_account',
  });

  const irPorRedireccion = () => {
    if (beforeRedirect) beforeRedirect();
    location.assign(url);
    return new Promise(() => {});
  };
  if (redirect) return irPorRedireccion();

  const w = Math.min(520, screen.availWidth || 520);
  const h = Math.min(680, screen.availHeight || 680);
  const left = Math.max(0, ((screen.availWidth || w) - w) / 2);
  const top = Math.max(0, ((screen.availHeight || h) - h) / 2);
  const popup = window.open(url, 'fielddraw-google', `popup,width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) {
    // Ventana bloqueada: la redirección siempre funciona.
    ls.set(STATE_KEY, state.replace(/\.p$/, '.r'));
    return irPorRedireccion();
  }
  return esperarRespuesta();
}

/** Espera a que `oauth.html` conteste (storage, BroadcastChannel o, por si acaso, sondeo). */
function esperarRespuesta(plazoMs = 5 * 60e3) {
  return new Promise((resolve, reject) => {
    let canal = null;
    let sondeo = null;
    let plazo = null;
    const fin = () => {
      removeEventListener('storage', onStorage);
      if (canal) canal.close();
      clearInterval(sondeo);
      clearTimeout(plazo);
    };
    const revisar = () => {
      const res = tomarRespuesta();
      if (!res) return;
      fin();
      try {
        resolve(guardarRespuesta(res));
      } catch (err) {
        reject(err);
      }
    };
    const onStorage = (e) => {
      if (e.key === RETURN_KEY) revisar();
    };
    addEventListener('storage', onStorage);
    try {
      canal = new BroadcastChannel(RETURN_CHANNEL);
      canal.onmessage = revisar;
    } catch {
      canal = null;
    }
    // `popup.closed` no sirve para saber si se canceló: tras pasar por Google
    // (COOP) se ve cerrada aunque siga abierta. Por eso solo hay plazo.
    sondeo = setInterval(revisar, 700);
    plazo = setTimeout(() => {
      fin();
      reject(new Error('Google sign-in did not finish'));
    }, plazoMs);
  });
}

/** Cierra la sesión: revoca el token (si hay red) y lo olvida. */
export async function signOut() {
  let token = '';
  try {
    token = (JSON.parse(ls.get(TOKEN_KEY) || 'null') || {}).accessToken || '';
  } catch {
    token = '';
  }
  ls.set(TOKEN_KEY, null);
  setEmail('');
  if (token) {
    try {
      await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      /* sin red: el token caduca solo en una hora */
    }
  }
}
