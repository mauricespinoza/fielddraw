import {
  crossings,
  reshapeGeometry,
  reshapeLine,
  reshapeRing,
  segmentIntersection,
} from '../src/reshape.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

/** Cuadrado unidad, anillo abierto y en sentido antihorario. */
const cuadrado = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

const area = (ring) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(s) / 2;
};

const cerca = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const tienePunto = (ring, p, tol = 1e-9) =>
  ring.some((q) => Math.abs(q[0] - p[0]) < tol && Math.abs(q[1] - p[1]) < tol);

console.log('== segmentIntersection ==');
{
  const x = segmentIntersection([0, 0], [10, 0], [5, -5], [5, 5]);
  ok('cruce en el punto correcto', x && cerca(x.point[0], 5) && cerca(x.point[1], 0), JSON.stringify(x));
  ok('t y u a mitad de cada segmento', x && cerca(x.t, 0.5) && cerca(x.u, 0.5));

  ok('paralelos => null', segmentIntersection([0, 0], [10, 0], [0, 1], [10, 1]) === null);
  ok('sin solape => null', segmentIntersection([0, 0], [1, 0], [5, -5], [5, 5]) === null);
  ok('degenerado => null', segmentIntersection([0, 0], [0, 0], [5, -5], [5, 5]) === null);
}

console.log('== crossings ==');
{
  // Línea horizontal que atraviesa el cuadrado de lado a lado.
  const cortes = crossings(cuadrado, [[-5, 5], [15, 5]], true);
  ok('dos cruces', cortes.length === 2, `-> ${cortes.length}`);
  ok('ordenados por avance de la línea', cortes[0].onLine < cortes[1].onLine);
  ok('entra por el borde izquierdo', cerca(cortes[0].point[0], 0) && cerca(cortes[0].point[1], 5), JSON.stringify(cortes[0].point));
  ok('sale por el derecho', cerca(cortes[1].point[0], 10) && cerca(cortes[1].point[1], 5), JSON.stringify(cortes[1].point));

  const ninguno = crossings(cuadrado, [[20, 20], [30, 30]], true);
  ok('línea lejana => sin cruces', ninguno.length === 0);
}

console.log('== reshapeRing: la línea sale y vuelve => el polígono CRECE ==');
{
  // Sale por el borde derecho, hace una panza hacia fuera y vuelve a entrar.
  const linea = [[10, 2], [16, 2], [16, 8], [10, 8]];
  const out = reshapeRing(cuadrado, linea);
  ok('devuelve un anillo', Array.isArray(out) && out.length >= 3, JSON.stringify(out));
  ok('el área crece', area(out) > area(cuadrado), `${area(out)} vs ${area(cuadrado)}`);
  ok('incorpora la panza', tienePunto(out, [16, 2]) && tienePunto(out, [16, 8]));
  ok('conserva las esquinas del lado opuesto', tienePunto(out, [0, 0]) && tienePunto(out, [0, 10]));
  // 100 originales + 6x6 de panza = 136.
  ok('el área es exactamente la esperada', cerca(area(out), 136, 1e-6), String(area(out)));
}

console.log('== reshapeRing: la línea atraviesa => se RECORTA el trozo menor ==');
{
  // Corte vertical en x=8: deja un trozo de 80 y otro de 20.
  const out = reshapeRing(cuadrado, [[8, -5], [8, 15]]);
  ok('devuelve un anillo', Array.isArray(out) && out.length >= 3);
  ok('se queda con el trozo grande', cerca(area(out), 80, 1e-6), String(area(out)));
  ok('conserva el lado izquierdo', tienePunto(out, [0, 0]) && tienePunto(out, [0, 10]));
  ok('ya no llega a x=10', !out.some((p) => p[0] > 8 + 1e-9), JSON.stringify(out));
}

console.log('== reshapeRing: casos que no se pueden resolver ==');
{
  ok('un solo cruce => null', reshapeRing(cuadrado, [[5, 5], [5, 15]]) === null);
  ok('sin cruces => null', reshapeRing(cuadrado, [[20, 20], [25, 25]]) === null);
  ok('línea de un punto => null', reshapeRing(cuadrado, [[5, 5]]) === null);
}

console.log('== reshapeRing es simétrico respecto del sentido del trazo ==');
{
  const ida = reshapeRing(cuadrado, [[10, 2], [16, 2], [16, 8], [10, 8]]);
  const vuelta = reshapeRing(cuadrado, [[10, 8], [16, 8], [16, 2], [10, 2]]);
  ok('misma área trazando al revés', cerca(area(ida), area(vuelta), 1e-6), `${area(ida)} vs ${area(vuelta)}`);
}

console.log('== reshapeLine ==');
{
  const linea = [[0, 0], [10, 0], [20, 0]];
  // Un arco que se apoya en la línea en x=5 y x=15 y se va por arriba.
  const out = reshapeLine(linea, [[5, -3], [5, 4], [15, 4], [15, -3]]);
  ok('devuelve una polilínea', Array.isArray(out) && out.length >= 2, JSON.stringify(out));
  ok('conserva el arranque', cerca(out[0][0], 0) && cerca(out[0][1], 0));
  ok('conserva el final', cerca(out.at(-1)[0], 20) && cerca(out.at(-1)[1], 0));
  ok('adopta el desvío dibujado', tienePunto(out, [5, 4]) && tienePunto(out, [15, 4]));
  ok('el vértice intermedio original desaparece', !tienePunto(out, [10, 0]));

  ok('sin cruces => null', reshapeLine(linea, [[0, 5], [20, 5]]) === null);
}

console.log('== reshapeGeometry sobre GeoJSON ==');
{
  const poly = {
    type: 'Polygon',
    coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
  };
  const out = reshapeGeometry(poly, [[8, -5], [8, 15]]);
  ok('sigue siendo un polígono', out && out.type === 'Polygon');
  ok('el anillo vuelve a cerrar', out && JSON.stringify(out.coordinates[0][0]) === JSON.stringify(out.coordinates[0].at(-1)));
  ok('con el área recortada', out && cerca(area(out.coordinates[0].slice(0, -1)), 80, 1e-6));

  const conHueco = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };
  const conHuecoOut = reshapeGeometry(conHueco, [[8, -5], [8, 15]]);
  ok('el hueco se conserva intacto', conHuecoOut && conHuecoOut.coordinates.length === 2);
  ok('y sin tocar sus vértices', conHuecoOut && JSON.stringify(conHuecoOut.coordinates[1]) === JSON.stringify(conHueco.coordinates[1]));

  const ls = { type: 'LineString', coordinates: [[0, 0], [10, 0], [20, 0]] };
  ok('acepta LineString', reshapeGeometry(ls, [[5, -3], [5, 4], [15, 4], [15, -3]]) !== null);

  ok('punto => null', reshapeGeometry({ type: 'Point', coordinates: [0, 0] }, [[0, 0], [1, 1]]) === null);
  ok('geometría ausente => null', reshapeGeometry(null, [[0, 0], [1, 1]]) === null);
  ok('línea ausente => null', reshapeGeometry(ls, null) === null);
  ok('no muta la geometría original', ls.coordinates.length === 3);
}

console.log('== no deja vértices duplicados consecutivos ==');
{
  // La línea corta justo sobre un vértice del cuadrado.
  const out = reshapeRing(cuadrado, [[10, -5], [10, 15]]);
  if (out) {
    let dup = 0;
    for (let i = 1; i < out.length; i++) {
      if (cerca(out[i][0], out[i - 1][0]) && cerca(out[i][1], out[i - 1][1])) dup++;
    }
    ok('sin repetidos consecutivos', dup === 0, `-> ${dup}`);
  } else {
    ok('cruce tangente al borde: se declina en vez de inventar', true);
  }
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
