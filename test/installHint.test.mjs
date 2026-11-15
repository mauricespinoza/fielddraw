/** Aviso de añadir a Inicio: plataforma, pasos y cuándo mostrarlo solo. */
import { installPlatform, installSteps, isStandalone, shouldAutoShow } from '../src/installHint.js';

let fails = 0;
let total = 0;
const ok = (name, cond, extra = '') => {
  total++;
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0',
  androidWebView: 'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36',
};

console.log('== plataforma ==');
ok('iPhone Safari', installPlatform({ userAgent: UA.iphoneSafari }) === 'ios-safari');
ok('iPad (se presenta como Mac táctil)', installPlatform({ userAgent: UA.ipadSafari, maxTouchPoints: 5 }) === 'ios-safari');
ok('Mac de verdad: escritorio', installPlatform({ userAgent: UA.macSafari, maxTouchPoints: 0 }) === 'desktop');
ok('iPhone Chrome', installPlatform({ userAgent: UA.iphoneChrome }) === 'ios-chrome');
ok('iPhone Firefox', installPlatform({ userAgent: UA.iphoneFirefox }) === 'ios-other');
ok('iPhone dentro de Instagram', installPlatform({ userAgent: UA.iphoneInstagram }) === 'ios-inapp');
ok('Android Chrome', installPlatform({ userAgent: UA.androidChrome }) === 'android-chrome');
ok('Samsung Internet (aunque diga Chrome)', installPlatform({ userAgent: UA.androidSamsung }) === 'android-samsung');
ok('Android Firefox', installPlatform({ userAgent: UA.androidFirefox }) === 'android-firefox');
ok('WebView de otra app', installPlatform({ userAgent: UA.androidWebView }) === 'android-other');
ok('Windows Chrome', installPlatform({ userAgent: UA.winChrome }) === 'desktop');
ok('sin navigator', installPlatform({}) === 'desktop');

console.log('== pasos ==');
for (const p of ['ios-safari', 'ios-chrome', 'ios-other', 'ios-inapp', 'android-chrome', 'android-samsung', 'android-firefox', 'android-other', 'desktop']) {
  const s = installSteps(p);
  ok(`${p}: hay pasos`, Array.isArray(s) && s.length >= 2 && s.every((t) => typeof t === 'string' && t.length > 10));
}
ok('Safari menciona Add to Home Screen', installSteps('ios-safari').some((t) => t.includes('Add to Home Screen')));
ok('Safari menciona el menú ••• de iOS 26', installSteps('ios-safari').some((t) => t.includes('iOS 26')));
ok('in-app manda a Safari', installSteps('ios-inapp').some((t) => t.includes('Open in Safari')));
ok('Samsung: Add page to', installSteps('android-samsung').some((t) => t.includes('Add page to')));

console.log('== cuándo mostrarlo solo ==');
const now = 1_800_000_000_000;
ok('primera vez en el teléfono: sí', shouldAutoShow({ platform: 'ios-safari', standalone: false, saved: null, now }));
ok('ya instalada: no', !shouldAutoShow({ platform: 'ios-safari', standalone: true, saved: null, now }));
ok('escritorio: no', !shouldAutoShow({ platform: 'desktop', standalone: false, saved: null, now }));
ok('«Got it»: nunca más', !shouldAutoShow({ platform: 'android-chrome', standalone: false, saved: { dismissed: true }, now }));
ok('«más tarde» hace 2 días: no', !shouldAutoShow({ platform: 'android-chrome', standalone: false, saved: { later: now - 2 * 86400e3 }, now }));
ok('«más tarde» hace 8 días: sí', shouldAutoShow({ platform: 'android-chrome', standalone: false, saved: { later: now - 8 * 86400e3 }, now }));

console.log('== app instalada ==');
ok('navigator.standalone (iOS)', isStandalone({ navigator: { standalone: true } }));
ok('display-mode standalone', isStandalone({ navigator: {}, matchMedia: (q) => ({ matches: q.includes('standalone') }) }));
ok('en el navegador', !isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) }));
ok('sin matchMedia', !isStandalone({ navigator: {} }));

console.log(fails ? `\n${fails} FALLO(S) de ${total}` : `\n${total} comprobaciones, TODO OK`);
process.exit(fails ? 1 : 0);
