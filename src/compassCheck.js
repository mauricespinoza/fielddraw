/**
 * Diálogo «Check compass»: corre la prueba de `startCompassCheck` (una vuelta
 * completa con el teléfono a nivel) y dice si la brújula está calibrada, con
 * las instrucciones para calibrarla si no lo está.
 *
 * Lo abren dos sitios —el panel Device y la pestaña Compass—, así que se
 * construye solo, sobre `document.body`, en vez de vivir en el HTML de uno de
 * los dos: se dibuja por encima de cualquiera de ellos.
 */

import {
  CHECK_FAIR_DEG,
  CHECK_GOOD_DEG,
  CHECK_MIN_SECTORS,
  CHECK_SECTORS,
  deviceOrientationSupported,
  needsOrientationPermission,
  recordCompassCheck,
  requestOrientationPermission,
  startCompassCheck,
} from './deviceOrientation.js';

const CALIBRATE_HTML = `
  <p class="hint"><b>To calibrate:</b> move away from vehicles, hammers, rebar and magnetic phone
  cases, then wave the phone slowly in a figure-8 in the air for about 15 s, turning it on all
  three axes. Then run the check again.</p>
  <p class="hint footnote">Android: Google Maps → tap the blue dot → <i>Calibrate</i> also works.
  iOS: keep <i>Settings → Privacy → Location Services → System Services → Compass Calibration</i>
  on, and iOS will prompt by itself.</p>`;

let root = null;
let stop = null;
let resultado = null;
let alCerrar = null;

function ring(covered) {
  const r = 38;
  const segs = [];
  for (let i = 0; i < CHECK_SECTORS; i++) {
    const a0 = ((i * 360) / CHECK_SECTORS - 90 + 2) * (Math.PI / 180);
    const a1 = (((i + 1) * 360) / CHECK_SECTORS - 90 - 2) * (Math.PI / 180);
    const p = (a) => `${50 + r * Math.cos(a)} ${50 + r * Math.sin(a)}`;
    segs.push(
      `<path d="M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}" class="${covered[i] ? 'on' : 'off'}"/>`,
    );
  }
  return `<svg viewBox="0 0 100 100" class="cc-ring" aria-hidden="true">${segs.join('')}
    <text x="50" y="20" class="cc-n">N</text></svg>`;
}

function render(p, error) {
  const body = root.querySelector('.cc-body');
  if (error) {
    body.innerHTML = `<p class="hint">${error}</p>${CALIBRATE_HTML}`;
    return;
  }
  if (!p) {
    body.innerHTML = '<p class="hint">Reading the sensors…</p>';
    return;
  }
  const partes = [ring(p.covered)];
  if (p.verdict === 'incomplete') {
    partes.push(
      `<p class="hint"><b>Lay the phone flat</b> (screen up, on a table or your palm) and turn it
      <b>slowly through one full circle</b>, pausing a moment every eighth of a turn.
      ${p.sectors}/${CHECK_SECTORS} directions done.</p>`,
    );
    if (!p.level) partes.push('<p class="hint warn-text">Keep it level — it is tilted too much to count.</p>');
    else if (p.tooFast) partes.push('<p class="hint warn-text">Slower — turning too fast to count.</p>');
    if (Number.isFinite(p.errorDeg) && p.sectors >= 3) {
      partes.push(`<p class="hint footnote">So far: ±${Math.round(p.errorDeg * 10) / 10}°</p>`);
    }
  } else {
    const e = Math.round(p.errorDeg * 10) / 10;
    const txt = {
      good: `<p class="cc-verdict good">Compass OK — heading error ±${e}°</p>`,
      fair: `<p class="cc-verdict fair">Usable but not great — heading error ±${e}°. Calibrating is recommended before measuring.</p>`,
      poor: `<p class="cc-verdict poor">Compass out of calibration — heading error up to ±${e}°. Strikes and dip directions can be off by that much.</p>`,
    }[p.verdict];
    partes.push(txt);
    if (p.verdict !== 'good') partes.push(CALIBRATE_HTML);
  }
  if (Number.isFinite(p.compassAccuracy)) {
    partes.push(`<p class="hint footnote">iOS reports a compass accuracy of ±${Math.round(p.compassAccuracy)}°.</p>`);
  }
  partes.push(
    `<p class="hint footnote">The check compares the compass against the gyroscope through a full turn
    (≤ ${CHECK_GOOD_DEG}° good, ≤ ${CHECK_FAIR_DEG}° usable). It cannot see a uniform offset such as
    magnetic declination or a large magnetic body nearby — those shift every reading alike.</p>`,
  );
  body.innerHTML = partes.join('');
}

function build() {
  root = document.createElement('div');
  root.className = 'cc-overlay hidden';
  root.innerHTML = `
    <div class="cc-dialog" role="dialog" aria-modal="true" aria-labelledby="cc-title">
      <header>
        <h2 id="cc-title">Check compass</h2>
        <button class="icon-btn close-x" data-cc="close" aria-label="Close">✕</button>
      </header>
      <div class="cc-body"></div>
      <div class="cc-actions">
        <button class="pill" data-cc="restart">Start over</button>
        <button class="pill accent" data-cc="close">Done</button>
      </div>
    </div>`;
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-cc]');
    if (e.target === root || (a && a.dataset.cc === 'close')) closeCompassCheck();
    else if (a && a.dataset.cc === 'restart') run();
  });
  document.body.appendChild(root);
}

function run() {
  if (stop) stop();
  stop = null;
  resultado = null;
  render(null);
  stop = startCompassCheck({
    onProgress: (p) => {
      render(p);
      if (p.verdict !== 'incomplete' && p.sectors >= CHECK_MIN_SECTORS) {
        resultado = p;
        recordCompassCheck(p);
        // Con el veredicto dado se para: seguir girando solo movería la cifra.
        if (p.sectors === CHECK_SECTORS) {
          stop?.();
          stop = null;
        }
      }
    },
    onError: (msg) => render(null, msg),
  });
}

/**
 * Abre el diálogo y arranca la prueba. `onClose(resultado)` se llama al
 * cerrarlo, con el último veredicto (o `null` si no se completó).
 */
export function openCompassCheck({ onClose } = {}) {
  if (!root) build();
  alCerrar = onClose || null;
  root.classList.remove('hidden');
  if (!deviceOrientationSupported()) {
    render(null, 'This device or browser has no orientation sensor available.');
    return;
  }
  if (needsOrientationPermission()) {
    // Tiene que pedirse dentro del gesto (el toque que abrió el diálogo).
    requestOrientationPermission().then((ok) => {
      if (ok) run();
      else render(null, 'Motion & orientation access was not granted.');
    });
  } else {
    run();
  }
}

export function closeCompassCheck() {
  if (stop) stop();
  stop = null;
  if (root) root.classList.add('hidden');
  const cb = alCerrar;
  alCerrar = null;
  cb?.(resultado);
}
