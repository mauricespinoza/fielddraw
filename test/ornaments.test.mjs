import { ORNAMENT_LAYER_IDS, applyOrnamentStyle, ornamentLayerId, ornamentLayers } from '../src/ornaments.js';
import { ORNAMENT_TYPES, defaultOrnaments, sanitizeOrnaments } from '../src/symbology.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('== capas de ornamento ==');
{
  const layers = ornamentLayers(defaultOrnaments());
  ok('una capa normal y una volteada por tipo', layers.length === ORNAMENT_TYPES.length * 2, `-> ${layers.length}`);
  ok('los ids no se repiten', new Set(layers.map((l) => l.id)).size === layers.length);
  ok('ORNAMENT_LAYER_IDS los cubre todos', ORNAMENT_LAYER_IDS.length === layers.length);

  const thrust = layers.find((l) => l.id === ornamentLayerId('thrust-fault', false));
  ok('toma el espaciado del estilo', thrust.layout['symbol-spacing'] === 26);
  ok('el icono va al lado que dice el offset', eq(thrust.layout['icon-offset'], [0, -4.5]));
  ok('no rota si no está volteado', thrust.layout['icon-rotate'] === 0);
  ok('respeta el minzoom', thrust.minzoom === 11);
  ok(
    'una falla cubierta no lleva ornamento',
    eq(thrust.filter[2], ['!=', ['get', 'certainty'], 'covered']),
    JSON.stringify(thrust.filter),
  );
}

console.log('== flip ==');
{
  const layers = ornamentLayers(defaultOrnaments());
  const normal = layers.find((l) => l.id === ornamentLayerId('normal-fault', false));
  const flip = layers.find((l) => l.id === ornamentLayerId('normal-fault', true));

  ok('el volteado cruza al otro lado', eq(flip.layout['icon-offset'], [0, 4.5]));
  ok('y gira 180° para reflejarse', flip.layout['icon-rotate'] === 180);
  ok('sin flip => solo elementos sin la marca', eq(normal.filter[3], ['!=', ['get', 'flip'], true]));
  ok('con flip => solo los marcados', eq(flip.filter[3], ['==', ['get', 'flip'], true]));
  ok('los dos usan el mismo icono', normal.layout['icon-image'] === flip.layout['icon-image']);
}

console.log('== el tamaño escala la rampa de zoom ==');
{
  const [chico] = ornamentLayers({ ...defaultOrnaments(), 'thrust-fault': { size: 0.5, spacing: 26, offset: -4, minzoom: 11 } });
  const size = chico.layout['icon-size'];
  ok('sigue siendo un interpolate por zoom', size[0] === 'interpolate' && eq(size[2], ['zoom']));
  ok('con las paradas escaladas', size[4] === 0.35 && size[6] === 0.5, JSON.stringify(size));
}

console.log('== applyOrnamentStyle ==');
{
  // Mapa de mentira: solo registra las llamadas, que es lo que interesa
  // comprobar — que reconfigura en caliente en vez de recrear capas.
  const calls = [];
  const zooms = [];
  const ids = new Set(ORNAMENT_LAYER_IDS);
  const fakeMap = {
    getLayer: (id) => (ids.has(id) ? { id } : undefined),
    setLayoutProperty: (id, prop, value) => calls.push([id, prop, value]),
    setLayerZoomRange: (id, min, max) => zooms.push([id, min, max]),
  };

  const estilo = sanitizeOrnaments({ 'thrust-fault': { size: 2, spacing: 60, offset: -8, minzoom: 13 } });
  applyOrnamentStyle(fakeMap, estilo);

  const de = (id) => Object.fromEntries(calls.filter((c) => c[0] === id).map((c) => [c[1], c[2]]));
  const normal = de(ornamentLayerId('thrust-fault', false));
  const flip = de(ornamentLayerId('thrust-fault', true));
  ok('aplica el espaciado nuevo', normal['symbol-spacing'] === 60);
  ok('aplica el offset nuevo', eq(normal['icon-offset'], [0, -8]));
  ok('y el opuesto en la capa volteada', eq(flip['icon-offset'], [0, 8]));
  ok('aplica el tamaño nuevo', normal['icon-size'][4] === 1.4);
  ok('mueve el minzoom', zooms.some(([id, min]) => id === ornamentLayerId('thrust-fault', false) && min === 13));
  ok('toca las 8 capas', new Set(calls.map((c) => c[0])).size === 8);
  ok('los tipos no tocados conservan su valor', de(ornamentLayerId('normal-fault', false))['symbol-spacing'] === 30);
}

console.log('== sanitizeOrnaments ==');
{
  const d = defaultOrnaments();
  ok('sin datos devuelve los valores por defecto', eq(sanitizeOrnaments(null), d));
  ok('ignora basura', eq(sanitizeOrnaments({ 'thrust-fault': 'nope' }), d));
  ok('ignora tipos desconocidos', eq(sanitizeOrnaments({ 'no-existe': { size: 3 } }), d));

  const acotado = sanitizeOrnaments({ 'thrust-fault': { size: 99, spacing: -5, offset: 1000, minzoom: 3 } });
  ok('acota el tamaño al máximo', acotado['thrust-fault'].size === 2.5);
  ok('acota el espaciado al mínimo', acotado['thrust-fault'].spacing === 10);
  ok('acota el offset', acotado['thrust-fault'].offset === 14);
  ok('deja pasar lo que está en rango', acotado['thrust-fault'].minzoom === 3);
  ok('no pisa los demás tipos', eq(acotado['normal-fault'], d['normal-fault']));

  const texto = sanitizeOrnaments({ 'normal-fault': { spacing: '45' } });
  ok('convierte números en texto (vienen así de un JSON viejo)', texto['normal-fault'].spacing === 45);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
