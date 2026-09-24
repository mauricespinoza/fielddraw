/**
 * Canvas de mentira: los ornamentos se rasterizan en uno y estas pruebas
 * corren en Node, sin DOM. El stub expone SOLO los métodos que el dibujo puede
 * usar, así que si alguno se escribe mal el fallo sale aquí en vez de salir en
 * la tablet con el icono en blanco. Registra además el color con el que se
 * pintó, que es lo que hace falta comprobar del color editable.
 */
const canvasOps = [];

function fakeContext(ops) {
  const ctx = {
    strokeStyle: null,
    fillStyle: null,
    lineWidth: 0,
    lineCap: '',
    getImageData(x, y, w, h) {
      return { data: new Uint8ClampedArray(w * h * 4) };
    },
  };
  for (const m of ['scale', 'translate', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fillRect', 'arc']) {
    ctx[m] = () => {};
  }
  for (const m of ['fill', 'stroke']) {
    ctx[m] = () => ops.push(m === 'fill' ? ctx.fillStyle : ctx.strokeStyle);
  }
  return ctx;
}

globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
    const ops = [];
    canvasOps.push(ops);
    return { width: 0, height: 0, getContext: () => fakeContext(ops) };
  },
};

import {
  HALO_IMAGE_OF,
  IMAGE_OF,
  IMPORTED_IMAGE_OF,
  ORNAMENT_HALO_LAYER_IDS,
  ORNAMENT_HALO_OPACITY,
  ORNAMENT_LAYER_IDS,
  addOrnamentImages,
  ornamentHaloLayerId,
  ornamentHaloLayers,
  applyOrnamentStyle,
  ornamentLayerId,
  ornamentLayers,
} from '../src/ornaments.js';
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

  // La reflexión es SOLO la rotación: MapLibre gira el offset junto con el
  // icono, así que repetir el mismo offset es lo que manda el símbolo al otro
  // lado. Negarlo aquí lo devolvería al lado de partida.
  ok('el volteado conserva el offset', eq(flip.layout['icon-offset'], [0, -4.5]));
  ok('y lo cruza girando 180°', flip.layout['icon-rotate'] === 180);
  ok('el sin voltear no gira', normal.layout['icon-rotate'] === 0);
  ok('sin flip => solo elementos sin la marca', eq(normal.filter[3], ['!=', ['get', 'flip'], true]));
  ok('con flip => solo los marcados', eq(flip.filter[3], ['==', ['get', 'flip'], true]));
  ok('los dos usan el mismo icono',
     JSON.stringify(normal.layout['icon-image']) === JSON.stringify(flip.layout['icon-image']));

  /*
   * Lo adoptado de StraboSpot lleva el ornamento en su color único: sin esto
   * la traza salía morada y sus dientes del color de la falla propia, con el
   * símbolo partido en dos colores.
   */
  ok('el icono elige entre el propio y el de lo importado',
     JSON.stringify(normal.layout['icon-image']) ===
       JSON.stringify(['case', ['==', ['get', 'source'], 'strabospot'],
         IMPORTED_IMAGE_OF['normal-fault'], IMAGE_OF['normal-fault']]),
     JSON.stringify(normal.layout['icon-image']));

  const sinColorUnico = ornamentLayers(defaultOrnaments(), { uniform: false, color: '#7e57c2' })
    .find((l) => l.id === ornamentLayerId('normal-fault', false));
  ok('con el color único apagado, el icono vuelve a ser uno solo',
     sinColorUnico.layout['icon-image'] === IMAGE_OF['normal-fault'],
     JSON.stringify(sinColorUnico.layout['icon-image']));
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
  const updated = [];
  const ids = new Set(ORNAMENT_LAYER_IDS);
  const fakeMap = {
    getLayer: (id) => (ids.has(id) ? { id } : undefined),
    setLayoutProperty: (id, prop, value) => calls.push([id, prop, value]),
    setLayerZoomRange: (id, min, max) => zooms.push([id, min, max]),
    // Los iconos van coloreados desde el canvas, así que un cambio de color
    // obliga a redibujarlos. Sin canvas en Node se comprueba la llamada.
    hasImage: () => true,
    updateImage: (name) => updated.push(name),
  };

  const estilo = sanitizeOrnaments({ 'thrust-fault': { size: 2, spacing: 60, offset: -8, minzoom: 13 } });
  applyOrnamentStyle(fakeMap, estilo);

  const de = (id) => Object.fromEntries(calls.filter((c) => c[0] === id).map((c) => [c[1], c[2]]));
  const normal = de(ornamentLayerId('thrust-fault', false));
  const flip = de(ornamentLayerId('thrust-fault', true));
  ok('aplica el espaciado nuevo', normal['symbol-spacing'] === 60);
  ok('aplica el offset nuevo', eq(normal['icon-offset'], [0, -8]));
  ok('y el mismo en la capa volteada, que lo cruza girando', eq(flip['icon-offset'], [0, -8]));
  ok('aplica el tamaño nuevo', normal['icon-size'][4] === 1.4);
  ok('mueve el minzoom', zooms.some(([id, min]) => id === ornamentLayerId('thrust-fault', false) && min === 13));
  ok('toca las dos capas de cada tipo', new Set(calls.map((c) => c[0])).size === ORNAMENT_TYPES.length * 2);
  ok('los tipos no tocados conservan su valor', de(ornamentLayerId('normal-fault', false))['symbol-spacing'] === 30);
}

console.log('== color editable ==');
{
  const updated = [];
  const fakeMap = {
    getLayer: () => undefined,
    setLayoutProperty: () => {},
    setLayerZoomRange: () => {},
    hasImage: () => true,
    updateImage: (name) => updated.push(name),
  };

  // La primera pasada fija el color de referencia de cada tipo; sin cambios
  // no debe volver a rasterizar nada.
  applyOrnamentStyle(fakeMap, defaultOrnaments());
  const primera = updated.length;
  applyOrnamentStyle(fakeMap, defaultOrnaments());
  ok('sin cambios de color no redibuja iconos', updated.length === primera, `-> ${updated.length} vs ${primera}`);

  const otro = defaultOrnaments();
  otro.antiform.color = '#00ff00';
  const antesDeRedibujar = canvasOps.length;
  applyOrnamentStyle(fakeMap, otro);
  ok('cambiar un color redibuja solo ese icono',
     updated.length === primera + 1 && updated[updated.length - 1] === IMAGE_OF.antiform,
     JSON.stringify(updated.slice(primera)));
  const pintado = canvasOps.slice(antesDeRedibujar).flat();
  // El icono de color ya no lleva halo: el halo es otra imagen, en otra capa
  // por debajo de la traza, para no pintar blanco encima de la línea.
  ok('y lo pinta solo con el color nuevo, sin halo encima',
     pintado.length > 0 && pintado.every((c) => c === '#00ff00'),
     JSON.stringify(pintado));

  // La separación de las medias flechas rehace solo el icono de ese tipo.
  const conGap = defaultOrnaments();
  conGap.antiform.color = '#00ff00';
  conGap['dextral-fault'].gap = 8;
  const antesGap = updated.length;
  applyOrnamentStyle(fakeMap, conGap);
  ok('cambiar la separación de una de rumbo redibuja solo ese icono y su halo',
     JSON.stringify(updated.slice(antesGap).sort()) ===
       JSON.stringify([IMAGE_OF['dextral-fault'], HALO_IMAGE_OF['dextral-fault']].sort()),
     JSON.stringify(updated.slice(antesGap)));
}

console.log('== halo fusionado con el de la traza ==');
{
  const halos = ornamentHaloLayers(defaultOrnaments());
  const simbolos = ornamentLayers(defaultOrnaments());
  ok('una capa de halo por cada capa de símbolo', halos.length === simbolos.length &&
     ORNAMENT_HALO_LAYER_IDS.length === halos.length);
  const h = halos.find((l) => l.id === ornamentHaloLayerId('thrust-fault', false));
  const s = simbolos.find((l) => l.id === ornamentLayerId('thrust-fault', false));
  ok('el halo usa su imagen blanca', h.layout['icon-image'] === HALO_IMAGE_OF['thrust-fault']);
  ok('y cae exactamente detrás del símbolo: mismo espaciado, offset, giro y filtro',
     eq(h.layout['icon-offset'], s.layout['icon-offset']) &&
       h.layout['symbol-spacing'] === s.layout['symbol-spacing'] &&
       eq(h.layout['icon-size'], s.layout['icon-size']) && eq(h.filter, s.filter));
  ok('con la opacidad del casing de la línea', h.paint['icon-opacity'] === ORNAMENT_HALO_OPACITY);

  const ops = [];
  canvasOps.length = 0;
  const imgs = new Map();
  addOrnamentImages({ hasImage: (n) => imgs.has(n), addImage: (n, d) => imgs.set(n, d) });
  ok('se registran los halos', ORNAMENT_TYPES.every((t) => imgs.has(HALO_IMAGE_OF[t])));
  ok('y se pintan en blanco puro', canvasOps.flat().includes('#ffffff'), JSON.stringify(ops));
}

console.log('== pliegues ==');
{
  const layers = ornamentLayers(defaultOrnaments());
  const anti = layers.find((l) => l.id === ornamentLayerId('antiform', false));
  const syn = layers.find((l) => l.id === ornamentLayerId('synform', false));
  ok('hay capa de antiforme y de sinforme', !!anti && !!syn);
  const iconoBase = (l) => {
    const img = l.layout['icon-image'];
    return Array.isArray(img) ? img[3] : img;
  };
  ok('cada uno con su icono',
     iconoBase(anti) === IMAGE_OF.antiform && iconoBase(syn) === IMAGE_OF.synform);
  ok('a caballo del eje: sin offset', eq(anti.layout['icon-offset'], [0, 0]) && eq(syn.layout['icon-offset'], [0, 0]));
  ok('el antiforme filtra por su tipo', eq(anti.filter[1], ['==', ['get', 'type'], 'antiform']));
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

console.log('== ajuste por grupo ==');
{
  const St = await import('../src/store.js');
  St.resetOrnaments();
  const fallas = ['thrust-fault', 'normal-fault', 'dextral-fault', 'sinistral-fault', 'undefined-fault'];
  St.setOrnamentGroup(fallas, { color: '#123456', width: 2 });
  const o = St.getState().ornaments;
  ok('un color y un grosor para todas las fallas', fallas.every((t) => o[t].color === '#123456' && o[t].width === 2));
  ok('sin tocar los contactos', o['stratigraphic-contact'].color === '#000000');
  St.setOrnamentGroup(['antiform', 'stratigraphic-contact'], { spacing: 90 });
  const o2 = St.getState().ornaments;
  ok('cada tipo recibe solo los campos que tiene',
     o2.antiform.spacing === 90 && !('spacing' in o2['stratigraphic-contact']));
  St.resetOrnaments();
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
