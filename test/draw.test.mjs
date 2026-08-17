import { DrawController } from '../src/drawController.js';

globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Host extends EventTarget {
  setPointerCapture() {}
  releasePointerCapture() {}
}
class PE extends Event {
  constructor(type, props) {
    super(type, { cancelable: true, bubbles: true });
    Object.assign(this, props);
  }
}
const container = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) };

function harness(opts = {}) {
  const host = new Host();
  const log = [];
  const cb = {
    isDrawing: () => opts.drawing !== false,
    fingerDrawEnabled: () => opts.finger !== false,
    freehandMode: () => opts.mode || 'hold',
    onVertex: (p) => log.push(['vertex', p]),
    onStrokeStart: () => log.push(['strokeStart']),
    onStrokeProgress: () => {},
    onStrokeEnd: (pts) => log.push(['strokeEnd', pts.length]),
    onFinish: () => log.push(['finish']),
    onFingerTap: (p) => log.push(['fingerTap', p]),
    onHover: () => {},
    onLongPressArm: (p) => log.push([p ? 'arm' : 'disarm']),
    onPointerInfo: () => {},
  };
  // Herramientas de arrastre (Elegir, Nodos) y menú de propiedades: opcionales,
  // para no cambiar el comportamiento de las pruebas que no los usan.
  if (opts.drag) {
    cb.dragMode = () => true;
    cb.onDragStart = (p) => log.push(['dragStart', p]);
    cb.onDragMove = (p) => log.push(['dragMove', p]);
    cb.onDragEnd = (p, info) => log.push(['dragEnd', p, info]);
  }
  if (opts.longPress !== false) cb.onLongPress = (p) => log.push(['longPress', p]);
  const c = new DrawController(host, container, cb);
  const ev = (type, props) => host.dispatchEvent(new PE(type, {
    pointerId: 1, pointerType: 'pen', buttons: 1, pressure: 0.5, tiltX: 0, tiltY: 0,
    getCoalescedEvents: () => [], ...props,
  }));
  return { host, log, controller: c, ev, kinds: () => log.map((l) => l[0]) };
}

console.log('== toque simple => vértice ==');
{
  const h = harness();
  h.ev('pointerdown', { clientX: 100, clientY: 200 });
  h.ev('pointerup', { clientX: 100, clientY: 200 });
  await sleep(10);
  ok('emite un vértice', h.kinds().filter((k) => k === 'vertex').length === 1);
  const v = h.log.find((l) => l[0] === 'vertex')[1];
  ok('coordenadas locales correctas', v[0] === 100 && v[1] === 200, JSON.stringify(v));
  ok('no activa trazo libre', !h.kinds().includes('strokeStart'));
}

console.log('== mantener presionado => trazo libre ==');
{
  const h = harness();
  h.ev('pointerdown', { clientX: 50, clientY: 50 });
  ok('arma el anillo de long-press', h.kinds().includes('arm'));
  await sleep(400);
  ok('activa trazo libre tras el hold', h.kinds().includes('strokeStart'));
  for (let i = 1; i <= 30; i++) h.ev('pointermove', { clientX: 50 + i, clientY: 50 + i });
  h.ev('pointerup', { clientX: 80, clientY: 80 });
  await sleep(10);
  const end = h.log.find((l) => l[0] === 'strokeEnd');
  ok('emite el trazo al soltar', !!end && end[1] === 31, end ? `-> ${end[1]} pts` : 'sin strokeEnd');
  ok('no emite vértice suelto', !h.kinds().includes('vertex'));
}

console.log('== arrastrar antes del hold => NO trazo libre ==');
{
  const h = harness();
  h.ev('pointerdown', { clientX: 50, clientY: 50 });
  await sleep(40);
  h.ev('pointermove', { clientX: 90, clientY: 90 }); // supera el umbral antes de los 320 ms
  await sleep(400);
  ok('no activa trazo libre', !h.kinds().includes('strokeStart'));
  ok('desarma el anillo', h.kinds().includes('disarm'));
  h.ev('pointerup', { clientX: 90, clientY: 90 });
  await sleep(10);
  ok('cae de vuelta a vértice', h.kinds().includes('vertex'));
}

console.log('== modo arrastre => trazo libre inmediato ==');
{
  const h = harness({ mode: 'drag' });
  h.ev('pointerdown', { clientX: 10, clientY: 10 });
  ok('no arma anillo en modo arrastre', !h.kinds().includes('arm'));
  h.ev('pointermove', { clientX: 40, clientY: 40 });
  ok('activa trazo libre al arrastrar', h.kinds().includes('strokeStart'));
  h.ev('pointerup', { clientX: 40, clientY: 40 });
  await sleep(10);
  ok('emite el trazo', h.kinds().includes('strokeEnd'));
}

console.log('== doble toque => cerrar elemento ==');
{
  const h = harness();
  h.ev('pointerdown', { clientX: 100, clientY: 100 });
  h.ev('pointerup', { clientX: 100, clientY: 100 });
  await sleep(60);
  h.ev('pointerdown', { clientX: 103, clientY: 102 });
  h.ev('pointerup', { clientX: 103, clientY: 102 });
  await sleep(10);
  ok('un solo vértice, no dos', h.kinds().filter((k) => k === 'vertex').length === 1);
  ok('cierra el elemento', h.kinds().includes('finish'));
}

console.log('== dos toques lejanos => dos vértices ==');
{
  const h = harness();
  h.ev('pointerdown', { clientX: 100, clientY: 100 });
  h.ev('pointerup', { clientX: 100, clientY: 100 });
  await sleep(60);
  h.ev('pointerdown', { clientX: 400, clientY: 300 });
  h.ev('pointerup', { clientX: 400, clientY: 300 });
  await sleep(10);
  ok('dos vértices', h.kinds().filter((k) => k === 'vertex').length === 2);
  ok('no cierra', !h.kinds().includes('finish'));
}

console.log('== rechazo de palma: con Pencil visto, el dedo no dibuja ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);
  const afterPen = h.kinds().filter((k) => k === 'vertex').length;
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  await sleep(10);
  ok('el toque con dedo se ignora', h.kinds().filter((k) => k === 'vertex').length === afterPen);
}

console.log('== dos dedos => gesto de navegación, se aborta el trazo ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  await sleep(400);
  ok('no activa trazo libre', !h.kinds().includes('strokeStart'));
  h.ev('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  await sleep(10);
  ok('no emite ningún vértice', !h.kinds().includes('vertex'));
}

console.log('== herramienta inactiva => no consume nada ==');
{
  const h = harness({ drawing: false });
  h.ev('pointerdown', { clientX: 100, clientY: 100 });
  h.ev('pointerup', { clientX: 100, clientY: 100 });
  await sleep(400);
  ok('sin eventos', h.log.length === 0, JSON.stringify(h.kinds()));
}

console.log('== dedo deshabilitado y sin Pencil => no dibuja ==');
{
  const h = harness({ finger: false });
  h.ev('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 100, clientY: 100 });
  h.ev('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 100, clientY: 100 });
  await sleep(10);
  ok('el dedo no genera vértice', !h.kinds().includes('vertex'));
}

console.log('== eventos coalescidos se expanden ==');
{
  const h = harness();
  h.ev('pointerdown', { clientX: 0, clientY: 0 });
  await sleep(400);
  h.ev('pointermove', {
    clientX: 20, clientY: 20,
    getCoalescedEvents: () => [
      { clientX: 5, clientY: 5 }, { clientX: 10, clientY: 10 },
      { clientX: 15, clientY: 15 }, { clientX: 20, clientY: 20 },
    ],
  });
  h.ev('pointerup', { clientX: 20, clientY: 20 });
  await sleep(10);
  const end = h.log.find((l) => l[0] === 'strokeEnd');
  ok('usa las 4 muestras coalescidas, no 1', end && end[1] === 5, end ? `-> ${end[1]}` : 'sin strokeEnd');
}

console.log('== con Pencil, el toque de dedo se reporta para cerrar ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 400 });
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 400 });
  await sleep(10);
  const tap = h.log.find((l) => l[0] === 'fingerTap');
  ok('emite fingerTap', !!tap, JSON.stringify(h.kinds()));
  ok('con las coordenadas del toque', tap && tap[1][0] === 500 && tap[1][1] === 400);
  ok('el dedo no añade vértice', h.kinds().filter((k) => k === 'vertex').length === 1);
}

console.log('== doble toque de dedo => cierra directamente ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  await sleep(60);
  h.ev('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 310, clientY: 305 });
  h.ev('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 310, clientY: 305 });
  await sleep(10);
  ok('cierra el elemento', h.kinds().includes('finish'));
}

console.log('== arrastrar con el dedo (paneo) NO cierra ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  h.ev('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 380, clientY: 360 });
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 380, clientY: 360 });
  await sleep(10);
  ok('no reporta toque', !h.kinds().includes('fingerTap'));
  ok('no cierra', !h.kinds().includes('finish'));
}

console.log('== pinch a dos dedos NO cierra ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 200 });
  h.ev('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 400, clientY: 400 });
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 200 });
  h.ev('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 400, clientY: 400 });
  await sleep(10);
  ok('no reporta toque', !h.kinds().includes('fingerTap'));
  ok('no cierra', !h.kinds().includes('finish'));
}

console.log('== con Pencil visto, el dedo SÍ arrastra en las herramientas de arrastre ==');
{
  const h = harness({ drag: true });
  // El Pencil pasa por la pantalla: a partir de aquí el dedo no dibuja.
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);

  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  ok('el dedo inicia el arrastre', h.kinds().includes('dragStart'), JSON.stringify(h.kinds()));
  h.ev('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 340, clientY: 320 });
  ok('y lo mueve', h.kinds().includes('dragMove'));
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 340, clientY: 320 });
  await sleep(10);
  // El último: con estas herramientas el propio Pencil también arrastra, así
  // que el primer dragEnd del registro es el suyo.
  const end = h.log.findLast((l) => l[0] === 'dragEnd');
  ok('y lo termina marcando que hubo movimiento', !!end && end[2].moved === true);
}

console.log('== toque de dedo en herramienta de arrastre => selección, no vértice ==');
{
  const h = harness({ drag: true });
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 400 });
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 400 });
  await sleep(10);
  const end = h.log.findLast((l) => l[0] === 'dragEnd');
  ok('llega como toque limpio', !!end && end[2].moved === false);
  ok('en su posición', end && end[1][0] === 500 && end[1][1] === 400);
  // En estas herramientas nadie digitaliza: ni el dedo ni el lápiz.
  ok('no añade vértice', !h.kinds().includes('vertex'));
}

console.log('== con el Pencil APOYADO, el toque del dedo sigue contando ==');
{
  // El lápiz es un puntero más: si se contara para el gesto multitáctil, cada
  // toque del dedo con el Pencil en la pantalla se descartaría por parecer un
  // gesto a dos manos, y el dedo no seleccionaría ni cerraría nada.
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  // El Pencil NO se levanta.
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 600, clientY: 500 });
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 600, clientY: 500 });
  await sleep(10);
  const tap = h.log.find((l) => l[0] === 'fingerTap');
  ok('el toque del dedo se reporta igual', !!tap, JSON.stringify(h.kinds()));
  ok('en su posición', tap && tap[1][0] === 600 && tap[1][1] === 500);
}

console.log('== mantener el dedo pulsado abre el menú ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);

  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 300 });
  await sleep(1150);
  const lp = h.log.find((l) => l[0] === 'longPress');
  ok('dispara la pulsación sostenida', !!lp, JSON.stringify(h.kinds()));
  ok('con las coordenadas del dedo', lp && lp[1][0] === 400 && lp[1][1] === 300);
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 300 });
  await sleep(10);
  ok('el mismo dedo no cierra además el elemento', !h.kinds().includes('fingerTap'));
  ok('ni lo termina', !h.kinds().includes('finish'));
}

console.log('== arrastrar el dedo cancela la pulsación sostenida ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 300 });
  await sleep(200);
  h.ev('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 470, clientY: 360 });
  await sleep(1000);
  ok('no abre el menú al panear', !h.kinds().includes('longPress'), JSON.stringify(h.kinds()));
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 470, clientY: 360 });
}

console.log('== la pulsación sostenida también vale en modo navegación ==');
{
  const h = harness({ drawing: false });
  h.ev('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200 });
  await sleep(1150);
  ok('abre el menú', h.kinds().includes('longPress'), JSON.stringify(h.kinds()));
  h.ev('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200 });
  await sleep(10);
  ok('sin dibujar nada', !h.kinds().includes('vertex') && !h.kinds().includes('fingerTap'));
}

console.log('== un segundo dedo cancela la pulsación sostenida ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);
  h.ev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  await sleep(100);
  h.ev('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 500, clientY: 500 });
  await sleep(1100);
  ok('no abre el menú con dos dedos', !h.kinds().includes('longPress'), JSON.stringify(h.kinds()));
  h.ev('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 });
  h.ev('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 500, clientY: 500 });
}

console.log('== clic derecho => cierra ==');
{
  const h = harness();
  h.ev('contextmenu', { clientX: 100, clientY: 100 });
  ok('cierra el elemento', h.kinds().includes('finish'));
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
