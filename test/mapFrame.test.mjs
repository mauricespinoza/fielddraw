import {
  chooseGraticuleStep,
  crossingsAlong,
  formatDegrees,
  formatDistance,
  scaleBar,
  zebraSegments,
  buildFrame,
} from '../src/mapFrame.js';
import { textWidth } from '../src/pdf.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

const SEG = 1 / 3600;
const MIN = 1 / 60;

console.log('== el escalón se elige por el tamaño del encuadre ==');
{
  ok('un encuadre de 4° se parte en grados', chooseGraticuleStep(4) === 1);
  ok('uno de 0,5° cae a minutos', Math.abs(chooseGraticuleStep(0.5) - 10 * MIN) < 1e-12,
    String(chooseGraticuleStep(0.5) * 60));
  ok('uno de 0,01° cae a segundos', chooseGraticuleStep(0.01) * 3600 <= 10);
  ok('siempre deja al menos tres tramos', 0.5 / chooseGraticuleStep(0.5) >= 3);
  ok('un encuadre absurdo no rompe', Number.isFinite(chooseGraticuleStep(0)));
}

console.log('== los cortes del graticulado sobre un borde ==');
{
  // Un borde de 400 px que va de -71.42 a -71.02: con paso de 0,1 lo cortan
  // cuatro líneas, y ninguna cae justo en una punta.
  const samples = [];
  for (let t = 0; t <= 400; t += 4) samples.push({ t, v: -71.42 + (t / 400) * 0.4 });
  const cr = crossingsAlong(samples, 0.1);
  ok('encuentra los cruces', cr.length === 4, JSON.stringify(cr.map((c) => c.value.toFixed(2))));
  ok('en orden y dentro del borde', cr.every((c, i) => c.t >= 0 && c.t <= 400 && (i === 0 || c.t > cr[i - 1].t)));
  ok('en la posición correcta', Math.abs(cr[0].t - 20) < 1, String(cr[0].t));
  ok('y el último también', Math.abs(cr[3].t - 320) < 1, String(cr[3].t));
}

console.log('== un borde donde la coordenada DECRECE ==');
{
  // Es el borde derecho de cualquier mapa: la latitud baja al bajar en
  // pantalla. Los cruces tienen que salir igual.
  const samples = [];
  for (let t = 0; t <= 300; t += 3) samples.push({ t, v: -37.02 - (t / 300) * 0.3 });
  const cr = crossingsAlong(samples, 0.1);
  ok('los encuentra igual', cr.length === 3, JSON.stringify(cr.map((c) => c.value.toFixed(2))));
  ok('ordenados por posición y no por valor', cr.every((c, i) => i === 0 || c.t > cr[i - 1].t));
}

console.log('== un borde sin ningún cruce ==');
{
  const samples = [];
  for (let t = 0; t <= 100; t += 5) samples.push({ t, v: -71.0251 + (t / 100) * 0.0002 });
  const cr = crossingsAlong(samples, 0.01);
  ok('no inventa cortes', cr.length === 0);
  const segs = zebraSegments(samples, cr, 0.01, 0, 100);
  ok('la cebra queda de una pieza', segs.length === 1 && segs[0].a === 0 && segs[0].b === 100);
}

console.log('== la cebra alterna y continúa entre tramos ==');
{
  const samples = [];
  for (let t = 0; t <= 400; t += 4) samples.push({ t, v: -71.42 + (t / 400) * 0.4 });
  const cr = crossingsAlong(samples, 0.1);
  const segs = zebraSegments(samples, cr, 0.1, 0, 400);
  ok('un tramo más que cortes', segs.length === cr.length + 1, String(segs.length));
  ok('alternan', segs.every((s, i) => i === 0 || s.dark !== segs[i - 1].dark));
  ok('cubren el borde entero', segs[0].a === 0 && segs[segs.length - 1].b === 400);
}

console.log('== las coordenadas se escriben como en un mapa ==');
{
  ok('grados enteros', formatDegrees(-71, 'lng', 1) === '71° W', formatDegrees(-71, 'lng', 1));
  ok('grados y minutos', formatDegrees(-37.5, 'lat', 10 * MIN) === '37°30\' S',
    formatDegrees(-37.5, 'lat', 10 * MIN));
  ok(
    'grados, minutos y segundos',
    formatDegrees(-37.50833333333, 'lat', 10 * SEG) === '37°30\'30" S',
    formatDegrees(-37.50833333333, 'lat', 10 * SEG),
  );
  ok('el hemisferio norte', formatDegrees(45.25, 'lat', MIN) === '45°15\' N',
    formatDegrees(45.25, 'lat', MIN));
  // El caso que el redondeo mata: 59,9999" tiene que subir al minuto y no
  // quedarse a un segundo de su propia línea.
  ok('sube de minuto sin dejar 60"', !formatDegrees(-37 - 1799.9999 / 3600, 'lat', 30 * SEG).includes('60"'),
    formatDegrees(-37 - 1799.9999 / 3600, 'lat', 30 * SEG));
  ok('la longitud se normaliza', formatDegrees(-181, 'lng', 1) === '179° E',
    formatDegrees(-181, 'lng', 1));
}

console.log('== la escala gráfica es un número redondo ==');
{
  const b = scaleBar(2.5, 150); // 375 m de objetivo
  ok('elige un largo redondo', [100, 200, 250, 500].includes(b.metres), String(b.metres));
  ok('y cerca del objetivo', b.px > 60 && b.px < 200, String(b.px));
  ok('rotulado en su unidad', /m$/.test(b.label), b.label);
  const km = scaleBar(30, 150); // 4500 m
  ok('pasa a km cuando toca', /km$/.test(km.label), km.label);
  ok('sin metros por píxel no hay barra', scaleBar(0, 150) === null);
  ok('distancias en su unidad', formatDistance(1500) === '1.5 km' && formatDistance(250) === '250 m');
}

console.log('== la lámina entera ==');
{
  const largo = (n, a, b) => {
    const out = [];
    for (let t = 0; t <= n; t += 4) out.push({ t, v: a + (t / n) * (b - a) });
    return out;
  };
  const view = {
    width: 800,
    height: 600,
    bearing: 0,
    metresPerPixel: 4,
    denominator: 25000,
    center: [-71.35, -37.4],
    edges: {
      top: largo(800, -71.4, -71.3),
      bottom: largo(800, -71.4, -71.3),
      left: largo(600, -37.36, -37.44),
      right: largo(600, -37.36, -37.44),
    },
  };
  const layout = buildFrame(view, { title: 'Cerro Colorado', scaleText: '1:25 000', credit: 'FieldDraw' });

  ok('la lámina es mayor que el mapa', layout.width > 800 && layout.height > 600);
  ok('el mapa queda dentro', layout.map.x > 0 && layout.map.y > 0 &&
    layout.map.x + layout.map.w < layout.width &&
    layout.map.y + layout.map.h < layout.height);

  const kinds = layout.ops.map((o) => o.kind);
  ok('hay una imagen, y una sola', kinds.filter((k) => k === 'image').length === 1);
  ok('hay marco', kinds.filter((k) => k === 'rect').length > 10);
  ok('hay rótulos', kinds.filter((k) => k === 'text').length > 6);
  ok('y el norte es un trazo', kinds.includes('path'));

  const textos = layout.ops.filter((o) => o.kind === 'text').map((o) => o.text);
  ok('lleva el título', textos.includes('Cerro Colorado'));
  ok('lleva la escala numérica', textos.includes('1:25 000'));
  ok('lleva el norte', textos.includes('N'));
  ok('lleva coordenadas', textos.some((t) => /°/.test(t)), JSON.stringify(textos.slice(0, 8)));
  ok(
    'coordenadas de los dos ejes',
    textos.some((t) => /[WE]$/.test(t)) && textos.some((t) => /[NS]$/.test(t)),
  );

  // Nada se sale de la lámina: es el fallo que solo se ve al abrir el archivo.
  const dentro = layout.ops.every((o) => {
    if (o.kind === 'rect') return o.x >= -0.5 && o.y >= -0.5 && o.x + o.w <= layout.width + 0.5 && o.y + o.h <= layout.height + 0.5;
    if (o.kind === 'text') return o.x >= 0 && o.x <= layout.width && o.y >= 0 && o.y <= layout.height;
    return true;
  });
  ok('nada se sale del papel', dentro);

  // Y los rótulos horizontales caben de verdad, medidos con la métrica del PDF.
  const desborde = layout.ops.filter(
    (o) => o.kind === 'text' && !o.rotate && o.anchor === 'middle' &&
      (o.x - textWidth(o.text, o.size, o.bold) / 2 < 0 ||
        o.x + textWidth(o.text, o.size, o.bold) / 2 > layout.width),
  );
  ok('ningún rótulo centrado se pasa del borde', desborde.length === 0,
    JSON.stringify(desborde.map((o) => o.text)));
}

console.log('== una lámina sin título no reserva la banda ==');
{
  const largo = (n, a, b) => {
    const out = [];
    for (let t = 0; t <= n; t += 8) out.push({ t, v: a + (t / n) * (b - a) });
    return out;
  };
  const view = {
    width: 400, height: 300, bearing: 0, metresPerPixel: 10, denominator: 50000,
    center: [-71, -37],
    edges: {
      top: largo(400, -71.1, -71.0), bottom: largo(400, -71.1, -71.0),
      left: largo(300, -36.95, -37.05), right: largo(300, -36.95, -37.05),
    },
  };
  const conTitulo = buildFrame(view, { title: 'X' });
  const sinTitulo = buildFrame(view, {});
  ok('la lámina sin título es más baja', sinTitulo.height < conTitulo.height);
  ok('el mapa mide lo mismo', sinTitulo.map.w === conTitulo.map.w && sinTitulo.map.h === conTitulo.map.h);
}

console.log('== anchos de glifo del PDF ==');
{
  ok('una cadena vacía no mide', textWidth('', 10) === 0);
  ok('la negrita es más ancha', textWidth('Cerro', 10, true) > textWidth('Cerro', 10, false));
  ok('el grado mide algo', textWidth('71° W', 10) > textWidth('71 W', 10));
  ok('escala con el cuerpo', Math.abs(textWidth('abc', 20) - 2 * textWidth('abc', 10)) < 1e-9);
}

console.log(fails === 0 ? 'TODO OK' : `${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
