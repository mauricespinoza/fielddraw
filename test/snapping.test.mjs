import { SnapIndex, buildGraph, tracePath } from '../src/snapping.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('== índice de snapping ==');
{
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [100, 0], [100, 100]]);
  ok('2 segmentos', idx.size === 2);

  const v = idx.query([103, 3], 12);
  ok('snap a vértice', v && v.type === 'vertex', JSON.stringify(v));
  ok('devuelve el vértice exacto', v && eq(v.point, [100, 0]));

  const s = idx.query([50, 6], 12);
  ok('snap a segmento', s && s.type === 'segment', JSON.stringify(s));
  ok('proyecta sobre la línea', s && eq(s.point, [50, 0]));
  ok('t intermedio', s && Math.abs(s.t - 0.5) < 1e-9);

  ok('fuera de tolerancia => null', idx.query([50, 40], 12) === null);

  // Con ambos dentro de la tolerancia debe ganar el vértice.
  const both = idx.query([96, 4], 12);
  ok('el vértice tiene prioridad sobre el segmento', both && both.type === 'vertex', JSON.stringify(both));
}
{
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [10, 0], [10, 10], [0, 10]], true);
  ok('anillo cerrado añade el segmento de cierre', idx.size === 4, `-> ${idx.size}`);
  const s = idx.query([0, 5], 3);
  ok('el segmento de cierre es snapeable', s && eq(s.point, [0, 5]), JSON.stringify(s));
}
{
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [0, 0]]);
  ok('ignora segmentos degenerados', idx.size === 0);
  ok('polilínea de 1 punto no rompe', (idx.addPolyline([[5, 5]]), idx.size === 0));
}
{
  // Los segmentos largos deben indexarse en todas las celdas que cruzan.
  const idx = new SnapIndex(64);
  idx.addPolyline([[0, 0], [1000, 0]]);
  ok('snap en medio de un segmento muy largo', idx.query([700, 2], 5) !== null);
}

console.log('== grafo ==');
{
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [10, 0], [20, 0]]);
  const g = buildGraph(idx);
  ok('3 nodos', g.size === 3, `-> ${g.size}`);
  const mid = g.get('10.00,0.00');
  ok('el nodo intermedio tiene 2 aristas', mid && mid.edges.length === 2);
}
{
  // Dos features que comparten un vértice deben quedar conectadas.
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [10, 0]]);
  idx.addPolyline([[10, 0], [10, 10]]);
  const g = buildGraph(idx);
  ok('vértices coincidentes se fusionan', g.size === 3, `-> ${g.size}`);
  ok('el nodo compartido une ambas features', g.get('10.00,0.00').edges.length === 2);
}

console.log('== trace ==');
{
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const g = buildGraph(idx);
  const a = idx.query([20, 1], 6);
  const b = idx.query([100, 60], 6);
  const path = tracePath(idx, g, a, b);
  ok('encuentra camino', !!path, 'null');
  ok('empieza y termina en los puntos snapeados',
     path && eq(path[0], [20, 0]) && eq(path[path.length - 1], [100, 60]), JSON.stringify(path));
  ok('pasa por los vértices intermedios',
     path && eq(path, [[20, 0], [100, 0], [100, 60]]), JSON.stringify(path));
}
{
  // En un anillo cerrado debe tomar el lado corto, no el largo.
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [100, 0], [100, 100], [0, 100]], true);
  const g = buildGraph(idx);
  const a = idx.query([10, 0], 4);
  const b = idx.query([0, 10], 4);
  const path = tracePath(idx, g, a, b);
  ok('elige el lado corto del anillo', path && eq(path, [[10, 0], [0, 0], [0, 10]]), JSON.stringify(path));
}
{
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [10, 0]]);
  idx.addPolyline([[500, 500], [510, 500]]);
  const g = buildGraph(idx);
  const a = idx.query([5, 0], 4);
  const b = idx.query([505, 500], 4);
  ok('features desconectadas => null', tracePath(idx, g, a, b) === null);
}
{
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [50, 0], [100, 0]]);
  const g = buildGraph(idx);
  const a = idx.query([0, 0], 4);
  const b = idx.query([100, 0], 4);
  ok('trace entre dos vértices existentes',
     eq(tracePath(idx, g, a, b), [[0, 0], [50, 0], [100, 0]]),
     JSON.stringify(tracePath(idx, g, a, b)));
}
{
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [100, 0]]);
  const g = buildGraph(idx);
  const a = idx.query([30, 0], 4);
  ok('mismo punto de inicio y fin => null', tracePath(idx, g, a, a) === null);
  ok('snap nulo => null', tracePath(idx, g, a, null) === null);
}
{
  // Dos puntos en el mismo segmento: el camino pasa por un extremo, porque el
  // grafo solo conoce los nodos del segmento. Es el comportamiento de QGIS.
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [100, 0]]);
  const g = buildGraph(idx);
  const a = idx.query([20, 0], 4);
  const b = idx.query([80, 0], 4);
  const path = tracePath(idx, g, a, b);
  ok('dos puntos del mismo segmento se conectan', !!path, 'null');
  ok('van directo, sin rodear por un extremo', path && eq(path, [[20, 0], [80, 0]]), JSON.stringify(path));
}
{
  // Trace a lo largo del borde de un polígono importado, que es el caso de
  // uso real: continuar un contacto siguiendo el límite de una unidad.
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [60, 0], [60, 40], [30, 70], [0, 40]], true);
  const g = buildGraph(idx);
  const a = idx.query([60, 20], 5);
  const b = idx.query([30, 70], 5);
  const path = tracePath(idx, g, a, b);
  ok('sigue el borde del polígono', path && eq(path, [[60, 20], [60, 40], [30, 70]]), JSON.stringify(path));
}

console.log('== el borrador no entra en el grafo del trace ==');
{
  // El elemento en construcción SÍ está en el índice (hay que poder
  // engancharse a él) pero no debe ser transitable: si lo fuera, Dijkstra
  // podría devolverse por el propio trazo en vez de seguir el borde.
  const idx = new SnapIndex();
  idx.addPolyline([[0, 0], [100, 0], [100, 100], [0, 100]], true); // polígono real
  idx.addPolyline([[0, 0], [50, 50], [100, 100]], false, { draft: true }); // atajo del borrador

  const g = buildGraph(idx);
  ok('el nodo del medio del borrador no existe en el grafo', !g.has('50.00,50.00'));

  const a = idx.query([0, 0], 3);
  const b = idx.query([100, 100], 3);
  const path = tracePath(idx, g, a, b);
  ok('el camino rodea por el borde, no cruza por el borrador', path && path.length === 3, JSON.stringify(path));
  ok(
    'y no pasa por el punto medio del borrador',
    path && !path.some((p) => p[0] === 50 && p[1] === 50),
    JSON.stringify(path),
  );
}

console.log('== un snap guardado caduca al reconstruir el índice ==');
{
  // Regresión del trace: el resultado de un snap trae el ÍNDICE del segmento,
  // y ese número apunta a otra cosa en cuanto el índice se reconstruye —lo que
  // ocurre en cada cambio del borrador y en cada paneo—. Por eso el ancla se
  // guarda en lng/lat y se vuelve a enganchar, en vez de reutilizar el snap.
  const first = new SnapIndex();
  first.addPolyline([[0, 0], [100, 0]]);
  first.addPolyline([[0, 50], [100, 50]]);
  const guardado = first.query([50, 0], 5);
  ok('engancha a la línea de arriba', eq(guardado.point, [50, 0]) && guardado.segment === 0);

  // Se reconstruye con las mismas geometrías en otro orden, como pasa cuando
  // cambia el conjunto de fuentes visibles.
  const rebuilt = new SnapIndex();
  rebuilt.addPolyline([[0, 50], [100, 50]]);
  rebuilt.addPolyline([[0, 0], [100, 0]]);

  const caducado = rebuilt.segments[guardado.segment];
  ok(
    'el índice guardado ahora apunta a OTRO segmento',
    !eq(caducado.a, [0, 0]),
    JSON.stringify(caducado),
  );

  // Re-enganchar por posición sí devuelve el segmento correcto.
  const revalidado = rebuilt.query(guardado.point, 5);
  ok('re-enganchar por posición lo recupera', eq(revalidado.point, [50, 0]));
  ok(
    'y apunta al segmento de verdad',
    eq(rebuilt.segments[revalidado.segment].a, [0, 0]),
    JSON.stringify(rebuilt.segments[revalidado.segment]),
  );
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
