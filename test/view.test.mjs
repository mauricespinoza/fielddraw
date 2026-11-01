/** La vista guardada en el dispositivo: solo se acepta lo usable. */
import { sanitizeView } from '../src/persistence.js';
import * as store from '../src/store.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

console.log('== sanitizeView ==');
const v = sanitizeView({ center: [-71.2, -37.5], zoom: 13.4, bearing: 30 });
ok('una vista buena pasa', v && v.center[0] === -71.2 && v.zoom === 13.4 && v.bearing === 30);
ok('el rumbo se normaliza a ±180', sanitizeView({ center: [0, 0], zoom: 5, bearing: 270 }).bearing === -90);
ok('sin rumbo, norte arriba', sanitizeView({ center: [0, 0], zoom: 5 }).bearing === 0);
ok('null', sanitizeView(null) === null);
ok('texto', sanitizeView('x') === null);
ok('centro NaN', sanitizeView({ center: [NaN, 0], zoom: 5 }) === null);
ok('centro como texto', sanitizeView({ center: ['a', 'b'], zoom: 5 }) === null);
ok('latitud fuera de Mercator', sanitizeView({ center: [0, 89], zoom: 5 }) === null);
ok('longitud fuera de rango', sanitizeView({ center: [200, 0], zoom: 5 }) === null);
ok('zoom ausente', sanitizeView({ center: [0, 0] }) === null);
ok('zoom absurdo', sanitizeView({ center: [0, 0], zoom: 99 }) === null);

console.log('== capas recordadas ==');
{
  const antes = store.getState().layers.find((l) => l.id === 'esri-imagery');
  ok('por omisión, satélite de Esri', antes.visible === true);
  store.applyLayerState([
    { id: 'esri-imagery', visible: false, opacity: 1 },
    { id: 'carto-voyager', visible: true, opacity: 0.6 },
    { id: 'ya-no-existe', visible: true, opacity: 1 },
  ]);
  const L = (id) => store.getState().layers.find((l) => l.id === id);
  ok('apaga el que estaba apagado', L('esri-imagery').visible === false);
  ok('enciende el otro con su opacidad', L('carto-voyager').visible === true && L('carto-voyager').opacity === 0.6);
  ok('ignora capas que no existen', !L('ya-no-existe'));
  store.applyLayerState(null);
  store.applyLayerState([{ id: 'osm', visible: 'si', opacity: 'x' }]);
  ok('valores raros no rompen nada', typeof L('osm').visible === 'boolean' && Number.isFinite(L('osm').opacity));
  ok('el estado guardado es el mismo formato', store.currentLayerState().some((l) => l.id === 'carto-voyager' && l.visible));
}

console.log(fails ? `\n${fails} FALLOS` : '\ntodo bien');
process.exit(fails ? 1 : 0);
