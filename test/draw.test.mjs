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
    onHover: (p, tipo) => log.push(['hover', p, tipo]),
    onLongPressArm: (p) => log.push([p ? 'arm' : 'disarm']),
    onCameraDrag: (mode, dx, dy) => log.push(['camera', mode, dx, dy]),
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
  // El clic secundario, cuando quien monta el controlador quiere decidir él
  // qué significa (es lo que hace mapView). Sin esto se mantiene el reparto
  // antiguo, que es lo que comprueban las pruebas de más arriba.
  if (opts.secondary) cb.onSecondary = (p) => log.push(['secondary', p]);
  // La "ventana" donde el controlador escucha el fin de un gesto. Se reproduce
  // aquí porque en el navegador `pointerup` NO llega por el host: llega por la
  // ventana, y esa diferencia es justo la que evita que un gesto terminado
  // fuera del mapa deje la app tragándose todos los eventos.
  const root = new EventTarget();
  const c = new DrawController(host, container, cb, root);
  const ev = (type, props) => {
    const destino = type === 'pointerup' || type === 'pointercancel' ? root : host;
    return destino.dispatchEvent(new PE(type, {
      pointerId: 1, pointerType: 'pen', buttons: 1, pressure: 0.5, tiltX: 0, tiltY: 0,
      getCoalescedEvents: () => [], ...props,
    }));
  };
  return { host, root, log, controller: c, ev, kinds: () => log.map((l) => l[0]) };
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

console.log('== espesor: sostener el toque no debe robarlo como trazo libre ==');
{
  // mapView le dice a freehandMode() que devuelva 'none' en la herramienta de
  // espesor, igual que en Elegir: es un solo toque sobre la otra superficie,
  // y con el 'hold' de por defecto sostenerlo un instante de más lo convertía
  // en el arranque de un trazo libre. Como ese trazo nunca llegaba a los dos
  // puntos que pide `onStrokeEnd`, el toque se perdía entero: nunca llegaba
  // el `onVertex` que cierra la medida, la herramienta se quedaba pegada en
  // «thickness» y el punteado del ancla no se volvía a quitar.
  const h = harness({ mode: 'none' });
  h.ev('pointerdown', { clientX: 50, clientY: 50 });
  await sleep(400); // de sobra para el hold de 320 ms, que aquí no debe dispararse
  ok('no activa trazo libre', !h.kinds().includes('strokeStart'));
  ok('no arma el anillo de long-press', !h.kinds().includes('arm'));
  h.ev('pointerup', { clientX: 50, clientY: 50 });
  await sleep(10);
  ok('el toque cierra como vértice', h.kinds().includes('vertex'));
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

console.log('== herramienta inactiva => no dibuja, pero el toque se reporta ==');
{
  // En Navegar y en Elegir el lápiz y el dedo no dibujan, pero su toque tiene
  // que llegar igual: es lo que selecciona un elemento y lo que deselecciona
  // al caer afuera. No puede depender del `click` que sintetiza el navegador,
  // que con tres píxeles de deriva ya no se emite.
  const h = harness({ drawing: false });
  h.ev('pointerdown', { clientX: 100, clientY: 100 });
  h.ev('pointerup', { clientX: 100, clientY: 100 });
  await sleep(400);
  ok('no dibuja nada', !h.kinds().some((k) => ['vertex', 'strokeStart', 'strokeEnd'].includes(k)), JSON.stringify(h.kinds()));
  const tap = h.log.find((l) => l[0] === 'fingerTap');
  ok('reporta el toque', !!tap, JSON.stringify(h.kinds()));
  ok('con sus coordenadas locales', !!tap && tap[1][0] === 100 && tap[1][1] === 100);
}

console.log('== herramienta inactiva: un toque corrido sigue siendo toque ==');
{
  // El umbral es el del dedo (14 px) y no el de MapLibre (3): un lápiz sobre
  // vidrio se corre varios píxeles solo con apoyarlo.
  const h = harness({ drawing: false });
  h.ev('pointerdown', { clientX: 100, clientY: 100 });
  h.ev('pointermove', { clientX: 108, clientY: 100, buttons: 1 });
  h.ev('pointerup', { clientX: 108, clientY: 100 });
  await sleep(50);
  ok('ocho píxeles no lo invalidan', h.kinds().includes('fingerTap'), JSON.stringify(h.kinds()));
}

console.log('== herramienta inactiva: un arrastre NO es un toque ==');
{
  const h = harness({ drawing: false });
  h.ev('pointerdown', { clientX: 100, clientY: 100 });
  h.ev('pointermove', { clientX: 160, clientY: 140, buttons: 1 });
  h.ev('pointerup', { clientX: 160, clientY: 140 });
  await sleep(50);
  ok('desplazar la vista no selecciona', !h.kinds().includes('fingerTap'), JSON.stringify(h.kinds()));
}

console.log('== herramienta inactiva: el ratón sigue por el click del navegador ==');
{
  // El ratón no entra por aquí a propósito: en escritorio el `click` llega
  // siempre y ese camino está probado. Duplicarlo abriría dos veces lo mismo.
  const h = harness({ drawing: false });
  h.ev('pointerdown', { pointerType: 'mouse', clientX: 100, clientY: 100 });
  h.ev('pointerup', { pointerType: 'mouse', clientX: 100, clientY: 100 });
  await sleep(50);
  ok('el ratón no emite toque', !h.kinds().includes('fingerTap'), JSON.stringify(h.kinds()));
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

console.log('== clic derecho navegando (PC) => abre el menú de propiedades ==');
{
  const h = harness({ drawing: false });
  h.ev('contextmenu', { clientX: 40, clientY: 55 });
  ok('no cierra nada, no había nada dibujándose', !h.kinds().includes('finish'));
  ok('abre el menú de propiedades', h.kinds().includes('longPress'));
  const call = h.log.find((l) => l[0] === 'longPress');
  ok('con las coordenadas locales del clic', call[1][0] === 40 && call[1][1] === 55);
}

console.log('== girar con el botón derecho no abre el menú ==');
{
  /*
   * En Navegar el arrastre con el botón derecho lo gira y lo bascula el propio
   * MapLibre. Medido en Chrome 141, el orden real del gesto es
   *
   *     pointerdown → contextmenu → pointermove ×N → pointerup
   *
   * o sea que el `contextmenu` llega ANTES del primer movimiento: ahí todavía
   * no se puede saber si esto va a ser un clic o un giro. Por eso se decide al
   * soltar, que es lo que esta prueba reproduce.
   */
  const h = harness({ drawing: false });
  h.ev('pointerdown', { pointerType: 'mouse', button: 2, buttons: 2, clientX: 100, clientY: 100 });
  h.ev('contextmenu', { clientX: 100, clientY: 100 });
  ok('el contextmenu de Chrome no abre nada por sí solo', !h.kinds().includes('longPress'));
  h.ev('pointermove', { pointerType: 'mouse', buttons: 2, clientX: 200, clientY: 140 });
  h.ev('pointerup', { pointerType: 'mouse', button: 2, buttons: 0, clientX: 200, clientY: 140 });
  ok('no abre nada tras arrastrar', !h.kinds().includes('longPress'), JSON.stringify(h.kinds()));

  // Y el clic limpio sigue abriéndolo.
  h.ev('pointerdown', { pointerType: 'mouse', button: 2, buttons: 2, clientX: 300, clientY: 300 });
  h.ev('contextmenu', { clientX: 300, clientY: 300 });
  h.ev('pointerup', { pointerType: 'mouse', button: 2, buttons: 0, clientX: 300, clientY: 300 });
  ok('un clic derecho limpio sí', h.kinds().includes('longPress'), JSON.stringify(h.kinds()));
  const call = h.log.find((l) => l[0] === 'longPress');
  ok('con las coordenadas del clic', call[1][0] === 300 && call[1][1] === 300);
}

console.log('== un temblor de la mano no se traga el menú ==');
{
  /*
   * El umbral del botón derecho es mucho más holgado que los 10 px del
   * arrastre normal: un ratón sensible en una pantalla 4K recorre más de diez
   * píxeles mientras se aprieta el botón, y con el listón bajo el menú se
   * perdía sin decir nada. Girar la vista, en cambio, es un gesto largo.
   */
  const h = harness({ drawing: false });
  h.ev('pointerdown', { pointerType: 'mouse', button: 2, buttons: 2, clientX: 400, clientY: 400 });
  h.ev('pointermove', { pointerType: 'mouse', buttons: 2, clientX: 411, clientY: 410 }); // ~15 px
  h.ev('pointerup', { pointerType: 'mouse', button: 2, buttons: 0, clientX: 411, clientY: 410 });
  ok('15 px siguen siendo un clic', h.kinds().includes('longPress'), JSON.stringify(h.kinds()));
}

console.log('== el clic derecho con una herramienta activa NO pone un vértice ==');
{
  /*
   * Era el fallo de fondo de "en PC el menú no sale": con una herramienta en
   * la mano, el `pointerdown` del botón derecho caía en el reparto normal, se
   * anulaba —lo que en Chrome impide que se emita el `contextmenu`— y al
   * soltar el gesto terminaba en `onVertex`. O sea que el clic derecho ponía
   * un vértice y no abría nada.
   */
  const h = harness({ secondary: true });
  h.ev('pointerdown', { pointerType: 'mouse', button: 2, buttons: 2, clientX: 120, clientY: 90 });
  h.ev('pointerup', { pointerType: 'mouse', button: 2, buttons: 0, clientX: 120, clientY: 90 });
  await sleep(10);
  ok('no pone un vértice', !h.kinds().includes('vertex'), JSON.stringify(h.kinds()));
  ok('avisa del clic secundario', h.kinds().includes('secondary'), JSON.stringify(h.kinds()));
  const call = h.log.find((l) => l[0] === 'secondary');
  ok('con las coordenadas del clic', call[1][0] === 120 && call[1][1] === 90);
}

console.log('== el clic derecho se resuelve UNA vez, llegue como llegue ==');
{
  // Chrome emite el `contextmenu` con el `mousedown` y Firefox al soltar. Se
  // atienden los dos órdenes, y en ninguno se dispara dos veces.
  const chrome = harness({ secondary: true });
  chrome.ev('pointerdown', { pointerType: 'mouse', button: 2, buttons: 2, clientX: 10, clientY: 10 });
  chrome.ev('contextmenu', { clientX: 10, clientY: 10 });
  ok('el contextmenu por sí solo no dispara', !chrome.kinds().includes('secondary'));
  chrome.ev('pointerup', { pointerType: 'mouse', button: 2, buttons: 0, clientX: 10, clientY: 10 });
  ok(
    'contextmenu antes del pointerup: una sola vez',
    chrome.kinds().filter((k) => k === 'secondary').length === 1,
    JSON.stringify(chrome.kinds()),
  );

  const firefox = harness({ secondary: true });
  firefox.ev('pointerdown', { pointerType: 'mouse', button: 2, buttons: 2, clientX: 10, clientY: 10 });
  firefox.ev('pointerup', { pointerType: 'mouse', button: 2, buttons: 0, clientX: 10, clientY: 10 });
  firefox.ev('contextmenu', { clientX: 10, clientY: 10 });
  ok(
    'contextmenu después del pointerup: una sola vez',
    firefox.kinds().filter((k) => k === 'secondary').length === 1,
    JSON.stringify(firefox.kinds()),
  );

  // Y si el navegador no llega a emitir el `contextmenu`, el `pointerup` solo
  // basta: es lo que hace que el menú salga siempre y no unas veces sí y
  // otras no.
  const sinMenu = harness({ secondary: true });
  sinMenu.ev('pointerdown', { pointerType: 'mouse', button: 2, buttons: 2, clientX: 33, clientY: 44 });
  sinMenu.ev('pointerup', { pointerType: 'mouse', button: 2, buttons: 0, clientX: 33, clientY: 44 });
  ok('sin contextmenu también se atiende', sinMenu.kinds().includes('secondary'));
}

console.log('== girar con el botón derecho sigue sin abrir el menú ==');
{
  // El orden completo de Chrome, arrastre incluido, y el `contextmenu`
  // rezagado de los navegadores que lo emiten al soltar.
  const h = harness({ secondary: true });
  h.ev('pointerdown', { pointerType: 'mouse', button: 2, buttons: 2, clientX: 100, clientY: 100 });
  h.ev('contextmenu', { clientX: 100, clientY: 100 });
  h.ev('pointermove', { pointerType: 'mouse', buttons: 2, clientX: 220, clientY: 160 });
  h.ev('pointerup', { pointerType: 'mouse', button: 2, buttons: 0, clientX: 220, clientY: 160 });
  h.ev('contextmenu', { clientX: 220, clientY: 160 });
  ok('el arrastre no abre nada', !h.kinds().includes('secondary'), JSON.stringify(h.kinds()));
}

console.log('== mantener el botón PRIMARIO un segundo abre el menú ==');
{
  /*
   * Redundancia del clic derecho: si un navegador, un trackpad o una
   * configuración rara se comen el botón secundario, queda este camino, que
   * no depende de ningún evento del sistema.
   */
  const h = harness({ drawing: false });
  h.ev('pointerdown', { pointerType: 'mouse', button: 0, buttons: 1, clientX: 200, clientY: 150 });
  await sleep(300);
  ok('no salta antes de tiempo', !h.kinds().includes('longPress'));
  await sleep(900);
  ok('al segundo abre el menú', h.kinds().includes('longPress'), JSON.stringify(h.kinds()));
  const call = h.log.find((l) => l[0] === 'longPress');
  ok('con las coordenadas de donde se apoyó', call[1][0] === 200 && call[1][1] === 150);
}

console.log('== arrastrar o soltar antes del segundo NO abre el menú ==');
{
  const arrastra = harness({ drawing: false });
  arrastra.ev('pointerdown', { pointerType: 'mouse', button: 0, buttons: 1, clientX: 200, clientY: 150 });
  await sleep(200);
  arrastra.ev('pointermove', { pointerType: 'mouse', buttons: 1, clientX: 260, clientY: 150 });
  await sleep(1000);
  ok('arrastrar el mapa no abre el menú', !arrastra.kinds().includes('longPress'));

  const suelta = harness({ drawing: false });
  suelta.ev('pointerdown', { pointerType: 'mouse', button: 0, buttons: 1, clientX: 200, clientY: 150 });
  await sleep(200);
  suelta.ev('pointerup', { pointerType: 'mouse', button: 0, buttons: 0, clientX: 200, clientY: 150 });
  await sleep(1000);
  ok('un clic normal tampoco', !suelta.kinds().includes('longPress'));
}

console.log('== el trazo libre manda sobre el sostenido ==');
{
  // Con `hold`, a los 320 ms arranca el trazo libre; a partir de ahí se está
  // dibujando y el menú no debe aparecer a mitad del trazo.
  const h = harness({ mode: 'hold' });
  h.ev('pointerdown', { pointerType: 'mouse', button: 0, buttons: 1, clientX: 50, clientY: 50 });
  await sleep(1200);
  ok('arranca el trazo libre', h.kinds().includes('strokeStart'));
  ok('y no abre el menú', !h.kinds().includes('longPress'), JSON.stringify(h.kinds()));
}

console.log('== sostener con una herramienta que no dibuja a mano alzada ==');
{
  // Espesor y rumbo/manteo devuelven `none`: ahí no hay trazo libre que se
  // adelante, así que el sostenido es lo único que pasa.
  const h = harness({ mode: 'none' });
  h.ev('pointerdown', { pointerType: 'mouse', button: 0, buttons: 1, clientX: 80, clientY: 90 });
  await sleep(1200);
  ok('abre el menú', h.kinds().includes('longPress'), JSON.stringify(h.kinds()));
  h.ev('pointerup', { pointerType: 'mouse', button: 0, buttons: 0, clientX: 80, clientY: 90 });
  await sleep(20);
  ok('y al soltar NO pone un vértice', !h.kinds().includes('vertex'), JSON.stringify(h.kinds()));
}

console.log('== en Navegar el ratón es del mapa ==');
{
  // Shift+clic AÑADE a la selección: si el controlador se quedara el evento,
  // se perdería la selección múltiple desde un PC.
  const h = harness({ drawing: false });
  h.ev('pointerdown', { pointerType: 'mouse', button: 0, shiftKey: true, clientX: 100, clientY: 100 });
  h.ev('pointermove', { pointerType: 'mouse', button: 0, shiftKey: true, clientX: 160, clientY: 100 });
  h.ev('pointerup', { pointerType: 'mouse', button: 0, shiftKey: true, clientX: 160, clientY: 100 });
  ok('no secuestra Shift+arrastrar', !h.kinds().includes('camera'), JSON.stringify(h.kinds()));
}

console.log('== Shift ya no mueve la cámara: es el modificador de selección ==');
{
  /*
   * Shift+arrastrar giraba y basculaba. Dejó de hacerlo cuando Shift pasó a
   * ser el modificador de selección múltiple: un modificador no puede
   * significar dos cosas, y de las dos la selección se usa cien veces por
   * sesión. Girar sin soltar la herramienta sigue estando en `Shift`+flechas.
   */
  const h = harness();
  h.ev('pointerdown', { pointerType: 'mouse', button: 0, shiftKey: true, clientX: 100, clientY: 100 });
  h.ev('pointermove', { pointerType: 'mouse', button: 0, shiftKey: true, clientX: 140, clientY: 80 });
  h.ev('pointerup', { pointerType: 'mouse', button: 0, shiftKey: true, clientX: 140, clientY: 80 });
  ok('no emite arrastre de cámara', !h.kinds().includes('camera'), JSON.stringify(h.kinds()));
}

console.log('== botón central: desplaza como en QGIS ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerType: 'mouse', button: 1, buttons: 4, clientX: 200, clientY: 200 });
  h.ev('pointermove', { pointerType: 'mouse', button: 1, buttons: 4, clientX: 190, clientY: 230 });
  h.ev('pointerup', { pointerType: 'mouse', button: 1, buttons: 4, clientX: 190, clientY: 230 });
  const cam = h.log.filter((l) => l[0] === 'camera');
  ok('emite el arrastre', cam.length === 1, JSON.stringify(h.kinds()));
  ok('como desplazamiento', cam[0][1] === 'pan');
  ok('con su delta', cam[0][2] === -10 && cam[0][3] === 30);
  ok('sin poner vértices', !h.kinds().includes('vertex'));
}

console.log('== sin Shift, el ratón sigue dibujando ==');
{
  const h = harness();
  h.ev('pointerdown', { pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
  h.ev('pointerup', { pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
  ok('pone el vértice de siempre', h.kinds().includes('vertex'), JSON.stringify(h.kinds()));
  ok('y no toca la cámara', !h.kinds().includes('camera'));
}

console.log('== a mitad de un trazo, la vista no se mueve ==');
{
  const h = harness({ mode: 'drag' });
  h.ev('pointerdown', { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
  h.ev('pointermove', { pointerType: 'mouse', button: 0, clientX: 60, clientY: 60 });
  ok('está trazando', h.kinds().includes('strokeStart'));
  h.ev('pointerdown', { pointerType: 'mouse', button: 1, buttons: 4, clientX: 60, clientY: 60 });
  ok('el botón central no secuestra el gesto', !h.kinds().includes('camera'), JSON.stringify(h.kinds()));
}

console.log('== el dedo no entra en los gestos de cámara ==');
{
  // En tablet la navegación con los dedos la resuelve el propio mapa: si el
  // controlador se los quedara, dejaría de haber paneo y zoom mientras se
  // dibuja con el lápiz, que es justo lo que hace usable la app en terreno.
  const h = harness();
  h.ev('pointerdown', { pointerType: 'touch', button: 0, shiftKey: true, clientX: 100, clientY: 100 });
  h.ev('pointermove', { pointerType: 'touch', button: 0, shiftKey: true, clientX: 150, clientY: 100 });
  h.ev('pointerup', { pointerType: 'touch', button: 0, shiftKey: true, clientX: 150, clientY: 100 });
  ok('no emite cámara', !h.kinds().includes('camera'), JSON.stringify(h.kinds()));
}

console.log('== hover: previsualización con lápiz y con ratón ==');
{
  // El Pencil flota sobre la pantalla: `buttons: 0` es el lápiz sin apoyar.
  const h = harness();
  h.ev('pointermove', { pointerType: 'pen', buttons: 0, clientX: 120, clientY: 90 });
  const hov = h.log.find((l) => l[0] === 'hover' && l[1]);
  ok('el lápiz en el aire previsualiza', !!hov, JSON.stringify(h.kinds()));
  ok('con sus coordenadas locales', hov[1][0] === 120 && hov[1][1] === 90);
  ok('y dice que es un lápiz', hov[2] === 'pen');
}
{
  /*
   * El ratón está SIEMPRE en hover: sin esto, desde un PC no había ninguna
   * previsualización de enganche y el snapping era un salto a ciegas que solo
   * se descubría después de hacer clic.
   */
  const h = harness();
  h.ev('pointermove', { pointerType: 'mouse', buttons: 0, clientX: 200, clientY: 150 });
  const hov = h.log.find((l) => l[0] === 'hover' && l[1]);
  ok('el ratón también previsualiza', !!hov, JSON.stringify(h.kinds()));
  ok('y se identifica como ratón', hov && hov[2] === 'mouse');
}
{
  // Con un lápiz ya visto, el ratón deja de mandar: el cursor puede haberse
  // quedado quieto en una esquina y no debe seguir pintando un enganche.
  const h = harness();
  h.ev('pointerdown', { pointerType: 'pen', clientX: 10, clientY: 10 });
  h.ev('pointerup', { pointerType: 'pen', clientX: 10, clientY: 10 });
  await sleep(10);
  const antes = h.log.filter((l) => l[0] === 'hover' && l[1]).length;
  h.ev('pointermove', { pointerId: 9, pointerType: 'mouse', buttons: 0, clientX: 400, clientY: 400 });
  const despues = h.log.filter((l) => l[0] === 'hover' && l[1]).length;
  ok('con lápiz presente el ratón no previsualiza', antes === despues);
}
{
  // Un dedo que no toca la pantalla no existe: nada que previsualizar.
  const h = harness();
  h.ev('pointermove', { pointerId: 5, pointerType: 'touch', buttons: 0, clientX: 200, clientY: 150 });
  ok('el dedo no genera hover', !h.log.some((l) => l[0] === 'hover' && l[1]));
}
{
  // Con el botón apretado ya no es hover, es un arrastre.
  const h = harness();
  h.ev('pointermove', { pointerId: 7, pointerType: 'mouse', buttons: 1, clientX: 200, clientY: 150 });
  ok('con el botón pulsado no hay hover', !h.log.some((l) => l[0] === 'hover' && l[1]));
}

console.log('== el gesto que termina fuera del mapa no deja la app sorda ==');
{
  // Reproduce el cuelgue: se dibuja, y el `pointerup` ocurre sobre otra cosa
  // —un panel recién abierto encima— en vez de sobre el mapa. Antes de colgar
  // los listeners de la ventana, `consuming` se quedaba puesta, y a partir de
  // ahí el mapa no respondía ni al dedo ni al ratón hasta recargar.
  const h = harness();
  h.ev('pointerdown', { clientX: 100, clientY: 100 });
  ok('mientras dibuja traga los eventos del mapa', h.controller.consuming === true);
  h.ev('pointerup', { clientX: 100, clientY: 100 });
  await sleep(10);
  ok('al soltar deja de tragarlos', h.controller.consuming === false);
}

console.log('== un pointerup perdido no inutiliza el dedo ==');
{
  /*
   * El toque cuyo `pointerup` nunca llega deja un puntero fantasma. Con él,
   * `touchCount()` no vuelve a bajar de uno y CADA toque siguiente se toma por
   * el segundo dedo de un gesto de navegación: el dedo deja de seleccionar sin
   * que nada lo diga. El primer contacto de un gesto nuevo tiene que limpiarlo.
   */
  const h = harness({ drawing: true, finger: false });
  h.ev('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 10 });
  ok('el dedo queda registrado', h.controller.touchCount() === 1);

  // No se manda su pointerup: se pierde, igual que en el fallo real.
  h.ev('pointerdown', {
    pointerId: 8, pointerType: 'touch', clientX: 300, clientY: 300, isPrimary: true,
  });
  ok('el primer contacto nuevo purga el fantasma', h.controller.touchCount() === 1);
  h.ev('pointerup', { pointerId: 8, pointerType: 'touch', clientX: 300, clientY: 300 });
  await sleep(10);
  ok('y ese toque sí selecciona', h.kinds().includes('fingerTap'), JSON.stringify(h.kinds()));
}

console.log('== resetPointers deja el controlador utilizable ==');
{
  const h = harness();
  h.ev('pointerdown', { clientX: 50, clientY: 50 });
  h.controller.resetPointers();
  ok('suelta la bandera de consumo', h.controller.consuming === false);
  ok('no deja gesto en curso', h.controller.gesture === null);
  ok('no deja punteros', h.controller.touchCount() === 0);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
