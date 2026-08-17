import { confirmTopology, removeCollinear } from '../src/topology.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

/* Base en el área de trabajo real: la aproximación local depende de la
   latitud, así que probar en el ecuador escondería errores de escala. */
const LNG = -71.35;
const LAT = -37.4;
const at = (dx, dy) => [LNG + dx, LAT + dy];

/** ~1 m en grados de longitud a esta latitud, y en grados de latitud. */
const MX = 1 / (111320 * Math.cos((LAT * Math.PI) / 180));
const MY = 1 / 111320;

const poly = (id, coords, props = {}) => ({
  type: 'Feature',
  properties: { id, kind: 'polygon', ...props },
  geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
});

const line = (id, coords) => ({
  type: 'Feature',
  properties: { id, kind: 'line' },
  geometry: { type: 'LineString', coordinates: coords },
});

const ringOf = (f) => f.geometry.coordinates[0];
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const metersApart = (a, b) => Math.hypot((a[0] - b[0]) / MX, (a[1] - b[1]) / MY);

console.log('== vértices casi coincidentes se funden ==');
{
  // Dos polígonos que comparten el borde x = 0.001, pero digitalizados a ojo:
  // el segundo cae 0,2 m al lado del primero.
  const e = 2 * MX;
  const a = poly('a', [at(0, 0), at(0.001, 0), at(0.001, 0.001), at(0, 0.001)]);
  const b = poly('b', [
    at(0.001 + e, 0),
    at(0.002, 0),
    at(0.002, 0.001),
    at(0.001 + e, 0.001),
  ]);

  const r = confirmTopology([a, b], { toleranceMeters: 5 });
  const [A, B] = r.features;
  ok('reporta vértices fusionados', r.fusionados > 0, `-> ${r.fusionados}`);
  ok('reporta nodos compartidos', r.compartidos === 2, `-> ${r.compartidos}`);
  ok(
    'la esquina inferior del borde común es el mismo punto',
    same(ringOf(A)[1], ringOf(B)[0]),
    `${JSON.stringify(ringOf(A)[1])} vs ${JSON.stringify(ringOf(B)[0])}`,
  );
  ok('la esquina superior también', same(ringOf(A)[2], ringOf(B)[3]));
  ok('el desplazamiento es menor que la tolerancia', metersApart(ringOf(A)[1], at(0.001, 0)) < 5);
  ok('el anillo sigue cerrado', same(ringOf(A)[0], ringOf(A).at(-1)));
  ok('nadie perdió vértices', ringOf(A).length === 5 && ringOf(B).length === 5);
}

console.log('== un vértice sobre el segmento del vecino se noda ==');
{
  // B tiene un vértice a media altura del borde común; A no.
  const a = poly('a', [at(0, 0), at(0.001, 0), at(0.001, 0.001), at(0, 0.001)]);
  const b = poly('b', [
    at(0.001, 0),
    at(0.002, 0),
    at(0.002, 0.001),
    at(0.001, 0.001),
    at(0.001, 0.0005),
  ]);

  const r = confirmTopology([a, b], { toleranceMeters: 5 });
  const [A] = r.features;
  ok('reporta la inserción', r.insertados === 1, `-> ${r.insertados}`);
  ok('A gana un vértice', ringOf(A).length === 6, `-> ${ringOf(A).length}`);
  const insertado = ringOf(A).find((c) => Math.abs(c[1] - at(0, 0.0005)[1]) < 1e-9);
  ok('el vértice nuevo está en el punto medio del borde', !!insertado, JSON.stringify(ringOf(A)));
  ok(
    'y va en orden, entre las dos esquinas',
    ringOf(A)[2][1] < ringOf(A)[3][1] && same(ringOf(A)[2], at(0.001, 0)) === false,
  );
}

console.log('== lo que está lejos no se toca ==');
{
  const a = poly('a', [at(0, 0), at(0.001, 0), at(0.001, 0.001), at(0, 0.001)]);
  const b = poly('b', [at(0.01, 0), at(0.011, 0), at(0.011, 0.001), at(0.01, 0.001)]);
  const r = confirmTopology([a, b], { toleranceMeters: 5 });
  ok('no funde nada', r.fusionados === 0, `-> ${r.fusionados}`);
  ok('no inserta nada', r.insertados === 0, `-> ${r.insertados}`);
  ok('devuelve las mismas features', r.features[0] === a || same(ringOf(r.features[0])[0], ringOf(a)[0]));
}

console.log('== el extremo de una línea se pega al polígono ==');
{
  const p = poly('p', [at(0, 0), at(0.001, 0), at(0.001, 0.001), at(0, 0.001)]);
  const l = line('l', [at(0.001 + 2 * MX, 0.0005), at(0.003, 0.0005)]);
  const r = confirmTopology([p, l], { toleranceMeters: 5 });
  const [P, L] = r.features;
  ok('el polígono recibe el nodo del extremo', P.geometry.coordinates[0].length === 6);
  ok(
    'y comparten exactamente el punto',
    P.geometry.coordinates[0].some((c) => same(c, L.geometry.coordinates[0])),
  );
}

console.log('== una geometría que quedaría degenerada se deja intacta ==');
{
  // Triángulo minúsculo: sus tres vértices caben dentro de la tolerancia.
  const t = poly('t', [at(0, 0), at(MX, 0), at(0, MY)]);
  const r = confirmTopology([t, poly('u', [at(1, 1), at(1.001, 1), at(1.001, 1.001)])], {
    toleranceMeters: 50,
  });
  ok('avisa del caso', r.degenerados >= 1, `-> ${r.degenerados}`);
  ok('el triángulo sobrevive con sus 3 vértices', ringOf(r.features[0]).length === 4);
}

console.log('== confirmTopology es idempotente ==');
{
  const a = poly('a', [at(0, 0), at(0.001, 0), at(0.001, 0.001), at(0, 0.001)]);
  const b = poly('b', [at(0.001 + 2 * MX, 0), at(0.002, 0), at(0.002, 0.001), at(0.001, 0.001)]);
  const first = confirmTopology([a, b], { toleranceMeters: 5 });
  const second = confirmTopology(first.features, { toleranceMeters: 5 });
  ok('la segunda pasada no funde nada', second.fusionados === 0, `-> ${second.fusionados}`);
  ok('la segunda pasada no inserta nada', second.insertados === 0, `-> ${second.insertados}`);
  // Identidad, no equivalencia: es lo que permite detectar "no hubo cambio".
  ok(
    'y devuelve las mismas features, sin copiarlas',
    second.features[0] === first.features[0] && second.features[1] === first.features[1],
  );
  ok('la primera pasada sí devolvió features nuevas', first.features[0] !== a);
}

console.log('== removeCollinear ==');
{
  const recto = [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ];
  const out = removeCollinear(recto, 1e-9);
  ok('quita el punto alineado', out.length === 5, `-> ${out.length}`);
  ok('conserva el cierre', same(out[0], out.at(-1)));
  ok('conserva las esquinas', out.some((c) => same(c, [2, 2])) && out.some((c) => same(c, [0, 2])));

  const abierta = [
    [0, 0],
    [1, 1],
    [2, 2],
  ];
  const oa = removeCollinear(abierta, 1e-9);
  ok('en una línea abierta conserva los extremos', oa.length === 2 && same(oa[1], [2, 2]));

  const pico = [
    [0, 0],
    [1, 0],
    [0.5, 0.5],
    [0, 0],
  ];
  ok('no aplasta un vértice que no es redundante', removeCollinear(pico, 1e-9).length === 4);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
