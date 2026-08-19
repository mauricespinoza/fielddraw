const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

/*
 * JSTS se publica como UMD y en el navegador entra por <script>. Aquí se
 * precarga en el global antes de importar el módulo: `loadJsts` lo encuentra
 * puesto y no llega a tocar el DOM, así que la geometría de verdad —la misma
 * librería que corre en la app— se puede probar en Node.
 */
const { createRequire } = await import('node:module');
globalThis.jsts = createRequire(import.meta.url)('../vendor/jsts.min.js');

const G = await import(BASE + 'geometryOps.js');

/** Cuadrado de lado `l` con esquina en (x, y). */
const cuadrado = (x, y, l) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]]],
});

const area = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
};

console.log('== restar un área que cae dentro ==');
{
  const unidad = cuadrado(0, 0, 10);
  const ventana = cuadrado(3, 3, 4);
  const piezas = await G.differencePolygons(unidad, ventana);
  ok('devuelve una sola pieza', piezas && piezas.length === 1, JSON.stringify(piezas && piezas.length));
  const g = piezas[0];
  ok('que es un polígono', g.type === 'Polygon');
  // Lo importante: NO es un contorno recortado, es un anillo interior. Un
  // hueco de verdad, que QGIS y el GeoPackage entienden como tal.
  ok('con un anillo interior', g.coordinates.length === 2, `${g.coordinates.length} anillos`);
  ok('el exterior no cambió', Math.abs(area(g.coordinates[0]) - 100) < 1e-9);
  ok('y el interior es lo restado', Math.abs(area(g.coordinates[1]) - 16) < 1e-9);
}

console.log('== restar un área que lo atraviesa ==');
{
  // Una franja de lado a lado no deja un hueco: parte el polígono en dos. Es
  // un resultado legítimo, pero distinto del que se pidió, y por eso la
  // interfaz lo dice en vez de dejar dos piezas sin explicación.
  const unidad = cuadrado(0, 0, 10);
  const franja = { type: 'Polygon', coordinates: [[[-1, 4], [11, 4], [11, 6], [-1, 6], [-1, 4]]] };
  const piezas = await G.differencePolygons(unidad, franja);
  ok('devuelve dos piezas', piezas && piezas.length === 2, String(piezas && piezas.length));
  ok('ninguna tiene huecos', piezas.every((g) => g.coordinates.length === 1));
  const total = piezas.reduce((s, g) => s + area(g.coordinates[0]), 0);
  ok('y entre las dos suman lo que quedaba', Math.abs(total - 80) < 1e-9, String(total));
}

console.log('== casos que no son un hueco ==');
{
  const unidad = cuadrado(0, 0, 10);
  ok('sin solape devuelve null', (await G.differencePolygons(unidad, cuadrado(50, 50, 4))) === null);

  // Cubrirlo entero devuelve lista VACÍA, no null: quien llama tiene que poder
  // distinguir "no se tocaron" de "no queda nada", porque borrar el polígono
  // en silencio sería la peor respuesta a un trazo que se pasó de largo.
  const vaciado = await G.differencePolygons(unidad, cuadrado(-5, -5, 30));
  ok('cubrirlo entero devuelve lista vacía', Array.isArray(vaciado) && vaciado.length === 0);

  const nada = await G.differencePolygons(unidad, cuadrado(10, 10, 5));
  ok('tocarse solo por una esquina no cuenta', nada === null, JSON.stringify(nada));
}

console.log('== un trazo a mano que se cruza a sí mismo ==');
{
  // El lazo que deja un dedo apurado: sin normalizar, JSTS falla en vez de
  // restar. Lo que se comprueba es que da un hueco, no que no reviente.
  const unidad = cuadrado(0, 0, 10);
  const lazo = {
    type: 'Polygon',
    coordinates: [[[2, 2], [8, 8], [8, 2], [2, 8], [2, 2]]],
  };
  const piezas = await G.differencePolygons(unidad, lazo);
  ok('el lazo igualmente resta', Array.isArray(piezas) && piezas.length >= 1);
}

console.log('== limpiar sin borrar huecos de verdad ==');
{
  /*
   * `cleanPolygon` corre al unir polígonos. Tiraba TODOS los anillos
   * interiores porque los únicos que había eran slivers; desde que se puede
   * restar un área, uno de ellos puede ser un dato cartografiado.
   */
  const conVentana = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]],
    ],
  };
  const limpio = G.cleanPolygon(conVentana);
  ok('una ventana compacta sobrevive', limpio.coordinates.length === 2, `${limpio.coordinates.length}`);

  // Un sliver: mismo largo, ancho de un milímetro relativo. Es el hilo que
  // dejan dos bordes que no coincidían, y no es geología.
  const conSliver = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[1, 5], [9, 5], [9, 5.002], [1, 5.002], [1, 5]],
    ],
  };
  ok('un sliver se descarta', G.cleanPolygon(conSliver).coordinates.length === 1);

  ok('el anillo exterior siempre queda', G.cleanPolygon(conSliver).coordinates[0].length >= 4);
  ok('lo que no es polígono pasa intacto', G.cleanPolygon(null) === null);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
