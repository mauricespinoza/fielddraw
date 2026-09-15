import { createStrokeBuffer } from '../src/stroke.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

/**
 * Conversión de mentira que además CUENTA cuántas veces la llaman.
 *
 * Ese número es lo que se está probando: con el relieve 3D puesto cada
 * conversión es una lectura sincrónica de la GPU (`gl.readPixels`), así que
 * "cuántas veces" no es un detalle de eficiencia, es la diferencia entre
 * dibujar y que el navegador dé la página por colgada.
 */
function espia() {
  let n = 0;
  const fn = (p) => {
    n++;
    return [p[0] / 1000, p[1] / 1000];
  };
  return { fn, count: () => n };
}

console.log('== cada punto se convierte UNA vez ==');
{
  const e = espia();
  const buf = createStrokeBuffer(e.fn);
  // El controlador entrega el trazo COMPLETO en cada frame, no lo que es nuevo.
  buf.push([[0, 0], [10, 0]]);
  buf.push([[0, 0], [10, 0], [20, 0]]);
  const out = buf.push([[0, 0], [10, 0], [20, 0], [30, 0]]);
  ok('cuatro puntos, cuatro conversiones', e.count() === 4, `-> ${e.count()}`);
  ok('el trazo sale entero', out.length === 4);
  ok('y convertido', out[3][0] === 0.03);
}

console.log('== cada punto se convierte con el anterior de semilla ==');
{
  /*
   * La semilla es lo que le permite a `toLngLat` resolver el punto con
   * `project` —aritmética sobre el DEM que ya está en memoria— en vez de con
   * `unproject`, que con el relieve puesto lee el framebuffer de la GPU.
   * Medido en el navegador: 4,7 s por `unproject` contra 0,5 ms por
   * `project`, o sea más de cinco minutos para que apareciera un trazo de
   * sesenta puntos. Sin semilla no hay vía barata, así que esto se prueba.
   */
  const semillas = [];
  const buf = createStrokeBuffer((p, seed) => {
    semillas.push(seed);
    return [p[0] / 1000, p[1] / 1000];
  });
  buf.push([[0, 0], [10, 0], [20, 0]]);
  ok('el primero no tiene de dónde partir', semillas[0] === undefined, JSON.stringify(semillas[0]));
  ok('el segundo parte del primero', JSON.stringify(semillas[1]) === '[0,0]', JSON.stringify(semillas[1]));
  ok('el tercero parte del segundo', JSON.stringify(semillas[2]) === '[0.01,0]', JSON.stringify(semillas[2]));
}

console.log('== el trazo largo no crece en trabajo por frame ==');
{
  // Antes esto costaba 1+2+3+...+60 = 1830 conversiones; ahora cuesta 60.
  const e = espia();
  const buf = createStrokeBuffer(e.fn);
  const pts = [];
  for (let i = 0; i < 60; i++) {
    pts.push([i * 10, 0]);
    buf.push(pts.slice());
  }
  ok('una conversión por punto', e.count() === 60, `-> ${e.count()}`);
}

console.log('== con el relieve puesto se descartan los puntos pegados ==');
{
  const e = espia();
  const buf = createStrokeBuffer(e.fn);
  // Diez puntos separados 1 px: con un paso de 4 px solo valen tres.
  const pts = [];
  for (let i = 0; i < 10; i++) pts.push([i, 0]);
  const out = buf.push(pts, 4);
  ok('convierte solo los que separan', e.count() === 3, `-> ${e.count()}`);
  ok('y devuelve esos mismos', out.length === 3);
  ok('el primero siempre entra', out[0][0] === 0);
}
{
  const e = espia();
  const buf = createStrokeBuffer(e.fn);
  const pts = [];
  for (let i = 0; i < 10; i++) pts.push([i, 0]);
  buf.push(pts, 0);
  ok('en planta no se descarta ninguno', e.count() === 10, `-> ${e.count()}`);
}

console.log('== el vaciado del final NO borra la caché ==');
{
  /*
   * El controlador anuncia el fin del trazo con `onStrokeProgress([])` y
   * enseguida llama a `onStrokeEnd`, que todavía necesita lo convertido. Si el
   * vaciado borrara la caché, cerrar el trazo volvería a convertirlo entero:
   * justo el gasto que se estaba evitando.
   */
  const e = espia();
  const buf = createStrokeBuffer(e.fn);
  buf.push([[0, 0], [10, 0], [20, 0]]);
  const out = buf.push([]);
  ok('no convierte nada de más', e.count() === 3, `-> ${e.count()}`);
  ok('la caché sigue en pie', buf.screen.length === 3 && out.length === 3);
}

console.log('== un trazo más corto es otro trazo ==');
{
  const e = espia();
  const buf = createStrokeBuffer(e.fn);
  buf.push([[0, 0], [10, 0], [20, 0]]);
  const out = buf.push([[100, 100]]);
  ok('empieza de cero', out.length === 1 && out[0][0] === 0.1, JSON.stringify(out));
  ok('convirtiendo solo el nuevo', e.count() === 4, `-> ${e.count()}`);
}

console.log('== cerrar el trazo reutiliza lo convertido ==');
{
  const e = espia();
  const buf = createStrokeBuffer(e.fn);
  const pts = [[0, 0], [10, 0], [20, 0], [30, 0]];
  buf.push(pts);
  const antes = e.count();
  // Simplificar deja un subconjunto de los mismos puntos: no hay que volver.
  const coords = buf.coordsFor([pts[0], pts[3]]);
  ok('no convierte de nuevo', e.count() === antes, `-> ${e.count() - antes} de más`);
  ok('devuelve lo que corresponde', coords[0][0] === 0 && coords[1][0] === 0.03);
}
{
  const e = espia();
  const buf = createStrokeBuffer(e.fn);
  buf.push([[0, 0], [10, 0]]);
  const antes = e.count();
  // El enganche mueve los extremos: esos sí hay que convertirlos.
  const coords = buf.coordsFor([[7, 7], [10, 0]]);
  ok('el extremo enganchado se convierte', e.count() === antes + 1, `-> ${e.count() - antes}`);
  ok('y sale bien', coords[0][0] === 0.007);
}
{
  // Y ese extremo tampoco tiene por qué pagar la GPU: el enganche lo mueve
  // unos píxeles, así que el punto ya convertido de al lado le sirve.
  const semillas = [];
  const buf = createStrokeBuffer((p, seed) => {
    semillas.push(seed);
    return [p[0] / 1000, p[1] / 1000];
  });
  buf.push([[0, 0], [10, 0]]);
  semillas.length = 0;
  buf.coordsFor([[7, 7], [10, 0]]);
  ok(
    'el extremo enganchado también lleva semilla',
    semillas.length === 1 && JSON.stringify(semillas[0]) === '[0,0]',
    JSON.stringify(semillas),
  );
}

console.log('== reset ==');
{
  const buf = createStrokeBuffer((p) => p);
  buf.push([[0, 0], [10, 0]]);
  buf.reset();
  ok('deja el trazo vacío', buf.screen.length === 0 && buf.lngLat.length === 0);
  const out = buf.push([[5, 5]]);
  ok('y admite uno nuevo', out.length === 1);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
