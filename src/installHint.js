/**
 * «Añade FieldDraw a la pantalla de inicio»: el aviso de la primera visita.
 *
 * Abierta desde el navegador, FieldDraw funciona, pero a medias para terreno:
 * pierde pantalla con la barra del navegador y, en iOS, Safari puede BORRAR lo
 * guardado por un sitio —el autoguardado, el historial de versiones, los mapas
 * offline— tras 7 días sin visitarlo. Una app añadida a Inicio queda exenta,
 * abre a pantalla completa y es como mejor funciona sin señal.
 *
 * iOS no deja instalar desde código: solo se puede explicar dónde tocar, y eso
 * cambia según el navegador (Safari, Chrome, un navegador dentro de otra app…).
 * Android, en Chrome y afines, sí: el navegador entrega `beforeinstallprompt`
 * y con eso se ofrece un botón «Install» de verdad; si no llega, los pasos.
 *
 * Se muestra una vez, en la primera apertura desde el navegador de un teléfono
 * o tablet. «Remind me later» lo repite a la semana; «Got it», nunca más. Desde
 * About se puede volver a abrir cuando se quiera.
 */

const KEY = 'fielddraw.install-hint.v1';
const LATER_MS = 7 * 86400e3;

/* ------------------------------------------------------------ puras */

/** ¿Abierta como app instalada (desde Inicio)? */
export function isStandalone(win = globalThis) {
  const nav = win.navigator || {};
  if (nav.standalone === true) return true;
  try {
    return (
      typeof win.matchMedia === 'function' &&
      (win.matchMedia('(display-mode: standalone)').matches ||
        win.matchMedia('(display-mode: fullscreen)').matches ||
        win.matchMedia('(display-mode: minimal-ui)').matches)
    );
  } catch {
    return false;
  }
}

/**
 * Dónde se está abriendo, en lo que importa para instalar.
 *
 * @returns {'ios-safari'|'ios-chrome'|'ios-other'|'ios-inapp'|'android-chrome'|'android-samsung'|'android-firefox'|'android-other'|'desktop'}
 */
export function installPlatform(nav = globalThis.navigator || {}) {
  const ua = nav.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
  // Navegadores metidos dentro de otra app (enlace abierto desde WhatsApp,
  // Instagram, Gmail…): no tienen «Añadir a Inicio».
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|GSA\/|LinkedInApp|Snapchat|Twitter|MicroMessenger/i.test(ua);
  if (ios) {
    if (inApp) return 'ios-inapp';
    if (/CriOS|EdgiOS/.test(ua)) return 'ios-chrome';
    if (/FxiOS|OPiOS|DuckDuckGo|Brave/.test(ua)) return 'ios-other';
    return 'ios-safari';
  }
  if (/Android/i.test(ua)) {
    if (inApp || /; wv\)/.test(ua)) return 'android-other';
    if (/SamsungBrowser/i.test(ua)) return 'android-samsung';
    if (/Firefox/i.test(ua)) return 'android-firefox';
    if (/Chrome/i.test(ua)) return 'android-chrome';
    return 'android-other';
  }
  return 'desktop';
}

/** Los pasos para cada plataforma, en el orden en que se tocan. */
export function installSteps(platform) {
  switch (platform) {
    case 'ios-safari':
      return [
        'Tap the Share button (a square with an arrow). On iOS 26 it is inside the ••• menu next to the address bar.',
        'Scroll down and tap Add to Home Screen.',
        'Leave Open as Web App on and tap Add.',
        'Open FieldDraw from its icon on the Home Screen from now on.',
      ];
    case 'ios-chrome':
      return [
        'Tap the Share button (a square with an arrow) in the address bar.',
        'Tap Add to Home Screen (scroll down if you do not see it).',
        'Tap Add, then open FieldDraw from its icon on the Home Screen.',
      ];
    case 'ios-other':
      return [
        'Open the browser menu and tap Share.',
        'Tap Add to Home Screen, then Add.',
        'If it is not there, open this page in Safari and add it from there.',
      ];
    case 'ios-inapp':
    case 'android-other':
      return [
        'This page is open inside another app, which cannot install it.',
        platform === 'ios-inapp'
          ? 'Open the ••• or Share menu and choose Open in Safari (or Open in browser).'
          : 'Open the ⋮ menu and choose Open in Chrome (or Open in browser).',
        'Then add it to the Home Screen from there.',
      ];
    case 'android-samsung':
      return [
        'Tap the ≡ menu at the bottom.',
        'Tap Add page to, then Home screen.',
        'Open FieldDraw from its icon on the Home screen from now on.',
      ];
    case 'android-firefox':
      return [
        'Tap the ⋮ menu.',
        'Tap Install (or Add to Home screen), then Add.',
        'Open FieldDraw from its icon on the Home screen from now on.',
      ];
    case 'android-chrome':
      return [
        'Tap the ⋮ menu at the top right.',
        'Tap Install app (or Add to Home screen), then Install.',
        'Open FieldDraw from its icon on the Home screen from now on.',
      ];
    default:
      return [
        'In Chrome or Edge, click the install icon at the right end of the address bar (a screen with an arrow), or open the ⋮ menu → Cast, save and share → Install page as app.',
        'In Safari on a Mac, choose File → Add to Dock.',
      ];
  }
}

/**
 * ¿Toca mostrarlo solo, al abrir? Solo en teléfono o tablet, fuera de la app
 * instalada, y si no se descartó (o el «más tarde» ya venció).
 */
export function shouldAutoShow({ platform, standalone, saved, now = Date.now() }) {
  if (standalone || platform === 'desktop') return false;
  if (!saved) return true;
  if (saved.dismissed) return false;
  if (saved.later) return now - saved.later >= LATER_MS;
  return true;
}

/* ------------------------------------------------------------ estado */

function leer() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

function escribir(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* sin storage: volverá a salir, que es lo menos malo */
  }
}

/* ------------------------------------------------------------ interfaz */

/*
 * El evento llega pronto, a veces antes de que exista la interfaz: se
 * escucha desde que se importa el módulo. `preventDefault` evita la barrita
 * propia de Chrome, que saldría encima del mapa sin explicar por qué.
 */
let promptDiferido = null;
if (typeof addEventListener === 'function') {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptDiferido = e;
    const btn = typeof document !== 'undefined' && document.getElementById('install-hint-install');
    if (btn) btn.hidden = false;
  });
  addEventListener('appinstalled', () => {
    promptDiferido = null;
    escribir({ dismissed: true, installed: Date.now() });
    cerrar();
  });
}

const $ = (id) => document.getElementById(id);

function cerrar() {
  const dlg = typeof document !== 'undefined' && $('install-hint');
  if (dlg && dlg.open) dlg.close();
}

/** Abre el aviso con los pasos de esta plataforma. */
export function openInstallHint() {
  const dlg = $('install-hint');
  if (!dlg) return;
  const platform = installPlatform();
  const ul = $('install-hint-steps');
  ul.replaceChildren(
    ...installSteps(platform).map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
  const ios = platform.startsWith('ios');
  $('install-hint-why').textContent = ios
    ? 'As an app on the Home Screen it opens full screen, works best without signal, and iOS keeps your work: Safari can erase what a website saved — autosave, version history, offline maps — after 7 days without opening it. Apps on the Home Screen are exempt.'
    : 'As an app it opens full screen with its own icon, starts faster and works best without signal in the field.';
  const btnInstall = $('install-hint-install');
  btnInstall.hidden = !promptDiferido;
  if (!dlg.open) dlg.showModal();
}

/**
 * Se llama una vez al arrancar, cuando ya se fue la pantalla de carga.
 * Engancha los botones y, si toca, abre el aviso al rato.
 */
let iniciado = false;
export function initInstallHint() {
  const dlg = typeof document !== 'undefined' && $('install-hint');
  if (!dlg || iniciado) return;
  iniciado = true;
  $('install-hint-ok').addEventListener('click', () => {
    escribir({ dismissed: true });
    cerrar();
  });
  $('install-hint-later').addEventListener('click', () => {
    escribir({ later: Date.now() });
    cerrar();
  });
  // Escape o tocar fuera: como «más tarde», nunca como «no volver a mostrar».
  dlg.addEventListener('cancel', () => {
    if (!(leer() || {}).dismissed) escribir({ later: Date.now() });
  });
  $('install-hint-install').addEventListener('click', async () => {
    const e = promptDiferido;
    if (!e) return;
    promptDiferido = null;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      escribir(outcome === 'accepted' ? { dismissed: true, installed: Date.now() } : { later: Date.now() });
    } catch {
      /* el navegador ya no lo permite: quedan los pasos a mano */
    }
    cerrar();
  });

  const about = $('btn-install-hint');
  if (about) {
    about.hidden = isStandalone();
    about.addEventListener('click', openInstallHint);
  }

  const platform = installPlatform();
  if (shouldAutoShow({ platform, standalone: isStandalone(), saved: leer() })) {
    // Un respiro para que se vea el mapa antes de taparlo con un diálogo.
    setTimeout(() => {
      if (!document.querySelector('dialog[open]')) openInstallHint();
    }, 1500);
  }
}
