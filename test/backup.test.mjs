/**
 * Respaldo: el reloj del autoguardado, la huella, la poda del historial, el
 * retorno de Google y las piezas puras de la API de Drive.
 */

// localStorage de mentira antes de importar nada que lo lea.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { createScheduler, contentHash, WAIT } = await import('../src/autosave.js');
const { planPrune, snapshotFilename } = await import('../src/snapshots.js');
const auth = await import('../src/drive/auth.js');
const api = await import('../src/drive/api.js');
const { driveDataName } = await import('../src/backup.js');

let fails = 0;
let total = 0;
const ok = (name, cond, extra = '') => {
  total++;
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

/* Temporizadores falsos: el tiempo avanza solo cuando el test lo dice. */
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++seq;
        timers.set(id, { at: t + ms, fn });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    async advance(ms) {
      const fin = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= fin).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        // deja correr las promesas del `run`
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      t = fin;
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
    get count() {
      return timers.size;
    },
  };
}

console.log('== reloj del autoguardado ==');
{
  const c = fakeClock();
  let runs = 0;
  const s = createScheduler({ run: async () => { runs++; return true; }, idleMs: 1000, maxWaitMs: 5000, now: c.now, timers: c.timers });
  s.mark();
  await c.advance(500);
  s.mark();
  await c.advance(900);
  ok('no guarda mientras se sigue editando', runs === 0);
  await c.advance(200);
  ok('guarda tras la pausa', runs === 1);
  ok('ya no queda pendiente', !s.pending);

  // edición continua: el tope manda
  for (let i = 0; i < 12; i++) {
    s.mark();
    await c.advance(500);
  }
  ok('con edición continua guarda al llegar al tope', runs === 2, `runs=${runs}`);
}
{
  const c = fakeClock();
  let runs = 0;
  let resultado = false;
  const s = createScheduler({
    run: async () => { runs++; return resultado; },
    idleMs: 100, maxWaitMs: 1000, retryMs: [1000, 5000], now: c.now, timers: c.timers,
  });
  s.mark();
  await c.advance(100);
  ok('primer intento', runs === 1);
  ok('el fallo deja pendiente', s.pending);
  s.mark();
  await c.advance(500);
  ok('un cambio nuevo no adelanta el reintento', runs === 1);
  await c.advance(600);
  ok('reintenta tras la primera espera', runs === 2);
  resultado = true;
  await c.advance(4000);
  ok('la segunda espera es más larga', runs === 2);
  await c.advance(1000);
  ok('y luego guarda', runs === 3 && !s.pending);
}
{
  const c = fakeClock();
  let runs = 0;
  let r = WAIT;
  const s = createScheduler({ run: async () => { runs++; return r; }, idleMs: 100, maxWaitMs: 1000, now: c.now, timers: c.timers });
  s.mark();
  await c.advance(100);
  ok('«wait» deja pendiente', runs === 1 && s.pending);
  ok('«wait» no deja reloj', c.count === 0);
  await c.advance(60000);
  ok('y no reintenta solo', runs === 1);
  r = true;
  await s.flush();
  ok('flush lo despierta', runs === 2 && !s.pending);
  await s.flush();
  ok('flush sin nada pendiente no guarda', runs === 2);
}
{
  const c = fakeClock();
  let runs = 0;
  let soltar;
  const s = createScheduler({
    run: () => { runs++; return new Promise((res) => { soltar = res; }); },
    idleMs: 100, maxWaitMs: 1000, now: c.now, timers: c.timers,
  });
  s.mark();
  await c.advance(100);
  s.mark(); // cambia mientras guarda
  ok('no lanza dos a la vez', runs === 1);
  soltar(true);
  await c.advance(0);
  await c.advance(100);
  ok('lo cambiado durante el guardado se guarda después', runs === 2);
  soltar(true);
  await c.advance(0);
  s.mark();
  s.cancel();
  await c.advance(5000);
  ok('cancel olvida lo pendiente', runs === 2 && !s.pending);
}
{
  const c = fakeClock();
  const s = createScheduler({ run: async () => { throw new Error('x'); }, idleMs: 10, maxWaitMs: 100, retryMs: [50], now: c.now, timers: c.timers });
  const warn = console.warn;
  console.warn = () => {};
  s.mark();
  await c.advance(10);
  console.warn = warn;
  ok('una excepción cuenta como fallo', s.pending && c.count === 1);
  s.cancel();
}

console.log('== huella ==');
{
  const a = contentHash('{"a":1}');
  ok('estable', a === contentHash('{"a":1}'));
  ok('distingue un carácter', a !== contentHash('{"a":2}'));
  ok('14 hex', /^[0-9a-f]{14}$/.test(a), a);
  const big = 'x'.repeat(2e6);
  const t0 = Date.now();
  contentHash(big);
  ok('rápida (2 MB en < 300 ms)', Date.now() - t0 < 300);
}

console.log('== poda del historial ==');
{
  const now = new Date(2026, 10, 15, 18, 0).getTime();
  const min = 60e3;
  const list = [];
  // 40 de hoy, cada 5 min
  for (let i = 0; i < 40; i++) list.push({ id: `hoy${i}`, savedAt: now - i * 5 * min });
  // 3 por día durante 20 días anteriores
  for (let d = 1; d <= 20; d++) {
    for (let k = 0; k < 3; k++) list.push({ id: `d${d}-${k}`, savedAt: now - d * 86400e3 - k * 60 * min });
  }
  const borrar = new Set(planPrune(list, now, { keepRecent: 30, keepDays: 14 }));
  const quedan = list.filter((s) => !borrar.has(s.id)).map((s) => s.id);
  ok('quedan las 30 más recientes', list.slice(0, 30).every((s) => !borrar.has(s.id)));
  ok('de hoy, solo esas 30', quedan.filter((id) => id.startsWith('hoy')).length === 30);
  ok('una por día de los últimos 14', [...Array(13)].every((_, i) => quedan.includes(`d${i + 1}-0`)));
  ok('la que queda es la última del día', !quedan.includes('d3-1') && !quedan.includes('d3-2'));
  ok('lo de hace más de 14 días se va', !quedan.some((id) => /^d(1[5-9]|20)-/.test(id)));
  ok('lista corta: no borra nada', planPrune(list.slice(0, 5), now).length === 0);
  ok('no depende del orden', planPrune([...list].reverse(), now).length === borrar.size);
}
{
  const s = { name: 'Cerro Ñuble', savedAt: new Date(2026, 0, 5, 9, 7).getTime(), blob: { type: 'application/gzip' } };
  ok('nombre de archivo de una versión', snapshotFilename(s) === 'cerro-nuble-2026-01-05-0907.fdproj.json.gz', snapshotFilename(s));
}

console.log('== OAuth: URL y respuesta ==');
{
  const loc = { origin: 'https://user.github.io', pathname: '/fielddraw/index.html' };
  ok('redirect junto a index.html', auth.redirectUriFor(loc) === 'https://user.github.io/fielddraw/oauth.html');
  ok('redirect desde la raíz del sitio', auth.redirectUriFor({ origin: 'http://localhost:5174', pathname: '/' }) === 'http://localhost:5174/oauth.html');
  const u = new URL(auth.buildAuthUrl({ clientId: '1-a.apps.googleusercontent.com', redirectUri: 'https://x/oauth.html', state: 's1.p', loginHint: 'a@b.c' }));
  ok('pide token implícito', u.searchParams.get('response_type') === 'token');
  ok('solo drive.file', u.searchParams.get('scope') === auth.DRIVE_SCOPE);
  ok('lleva state y login_hint', u.searchParams.get('state') === 's1.p' && u.searchParams.get('login_hint') === 'a@b.c');
  ok('sin prompt si no se pide', !u.searchParams.has('prompt'));
  const r = auth.parseAuthResponse('#access_token=ya29.x&token_type=Bearer&expires_in=3599&scope=' + encodeURIComponent(auth.DRIVE_SCOPE) + '&state=abc.r');
  ok('lee el token', r.accessToken === 'ya29.x' && r.expiresIn === 3599 && r.state === 'abc.r');
  ok('lee el error', auth.parseAuthResponse('error=access_denied&state=z').error === 'access_denied');
  ok('Client ID válido', auth.looksLikeClientId('123456-abcdef123.apps.googleusercontent.com'));
  ok('Client ID inválido', !auth.looksLikeClientId('hola') && !auth.looksLikeClientId(''));
}
{
  ok('iPad (se presenta como Mac táctil)', auth.isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }));
  ok('Mac de verdad no', !auth.isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }));
  const win = (standalone) => ({ navigator: { userAgent: 'iPhone', standalone }, matchMedia: () => ({ matches: false }) });
  ok('iPhone instalado: redirección', auth.prefersRedirect(win(true)));
  ok('iPhone en Safari: ventana', !auth.prefersRedirect(win(false)));
  ok('Android instalado: ventana', !auth.prefersRedirect({ navigator: { userAgent: 'Android' }, matchMedia: () => ({ matches: true }) }));
}

console.log('== OAuth: vuelta por redirección ==');
{
  const vuelta = (hash) => mem.set(auth.RETURN_KEY, JSON.stringify({ hash, at: 1 }));
  const scope = encodeURIComponent(auth.DRIVE_SCOPE);
  ok('sin vuelta pendiente: null', auth.consumeRedirectResult() === null);

  mem.set('fielddraw.drive.oauth-state.v1', 'bueno.r');
  vuelta(`access_token=T1&expires_in=3600&scope=${scope}&state=otro.r`);
  ok('state ajeno: se ignora', auth.consumeRedirectResult() === null && auth.getToken() === '');

  vuelta(`access_token=T1&expires_in=3600&scope=${scope}&state=bueno.r`);
  const r = auth.consumeRedirectResult();
  ok('state correcto: guarda el token', r && r.ok && auth.getToken() === 'T1');
  ok('consume la vuelta (no se repite)', !mem.has(auth.RETURN_KEY) && auth.consumeRedirectResult() === null);
  ok('el token caduca con margen', auth.getToken(Date.now() + 3500e3) === '');
  auth.dropToken();
  ok('dropToken lo olvida', auth.getToken() === '');

  mem.set('fielddraw.drive.oauth-state.v1', 'b2.r');
  vuelta('access_token=T2&expires_in=3600&scope=email&state=b2.r');
  const sinDrive = auth.consumeRedirectResult();
  ok('permiso de Drive desmarcado: error', sinDrive && !sinDrive.ok && /not granted/.test(sinDrive.error) && auth.getToken() === '');

  mem.set('fielddraw.drive.oauth-state.v1', 'b3.r');
  vuelta('error=access_denied&state=b3.r');
  const cancel = auth.consumeRedirectResult();
  ok('cancelado: error legible', cancel && !cancel.ok && /cancelled/.test(cancel.error));
}

console.log('== Drive: piezas puras ==');
{
  ok('literal con comilla', api.qLiteral("O'Higgins") === "'O\\'Higgins'");
  ok('Range de un 308', api.receivedFromRange('bytes=0-8388607') === 8388608);
  ok('sin Range: 0', api.receivedFromRange(null) === 0);
  ok('nombre libre', api.freeName('a.fdproj.json.gz', []) === 'a.fdproj.json.gz');
  ok('nombre ocupado', api.freeName('a.fdproj.json.gz', ['a.fdproj.json.gz']) === 'a (2).fdproj.json.gz');
  ok('nombre ocupado dos veces', api.freeName('a.fdproj.zip', ['a.fdproj.zip', 'a (2).fdproj.zip']) === 'a (3).fdproj.zip');
  ok('trozo múltiplo de 256 KiB', api.CHUNK_BYTES % (256 * 1024) === 0);
  const body = api.multipartBody({ name: 'x.gz' }, new Blob(['DATA'], { type: 'application/gzip' }), 'BND');
  const txt = await body.text();
  ok('multipart: metadatos y contenido', txt.startsWith('--BND\r\nContent-Type: application/json') && txt.includes('{"name":"x.gz"}') && txt.includes('Content-Type: application/gzip\r\n\r\nDATA') && txt.endsWith('\r\n--BND--'));
  ok('multipart: tipo con boundary', body.type === 'multipart/related; boundary=bnd' || body.type === 'multipart/related; boundary=BND');
  ok('nombre del archivo de datos', driveDataName('Cerro Colorado, 2026') === 'cerro-colorado-2026.fdproj.json.gz');
  ok('sin nombre', driveDataName('') === 'fielddraw.fdproj.json.gz');
  ok('sin gzip', driveDataName('a', false) === 'a.fdproj.json');
}

console.log(fails ? `\n${fails} FALLO(S) de ${total}` : `\n${total} comprobaciones, TODO OK`);
process.exit(fails ? 1 : 0);
