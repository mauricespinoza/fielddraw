import { chainLines, pickFeature, pointInPolygon, pointInRing } from '../src/geom.js';
import * as store from '../src/store.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// En estas pruebas "pantalla" y "mundo" coinciden, para poder razonar en px.
const project = (c) => ({ x: c[0], y: c[1] });

const line = (id, coords) => ({
  type: 'Feature', id,
  properties: { id, kind: 'line', type: 'dike', certainty: 'observed', createdAt: 1 },
  geometry: { type: 'LineString', coordinates: coords },
});
const poly = (id, rings) => ({
  type: 'Feature', id,
  properties: { id, kind: 'polygon', type: 'volcanic-unit', certainty: 'observed', createdAt: 1 },
  geometry: { type: 'Polygon', coordinates: rings },
});

console.log('== punto en polígono ==');
{
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  ok('dentro', pointInRing([5, 5], square));
  ok('fuera', !pointInRing([15, 5], square));
  const hole = [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]];
  ok('dentro del anillo exterior pero en el hueco => fuera', !pointInPolygon([5, 5], [square, hole]));
  ok('entre el borde y el hueco => dentro', pointInPolygon([1, 5], [square, hole]));
  ok('polígono sin anillos => fuera', !pointInPolygon([0, 0], []));
}

console.log('== selección por toque ==');
{
  const features = [
    line('l1', [[0, 0], [100, 0]]),
    line('l2', [[0, 50], [100, 50]]),
    poly('p1', [[[200, 0], [300, 0], [300, 100], [200, 100], [200, 0]]]),
  ];
  ok('elige la línea más cercana', pickFeature(features, [50, 3], project, 16).properties.id === 'l1');
  ok('elige la otra si está más cerca', pickFeature(features, [50, 47], project, 16).properties.id === 'l2');
  ok('lejos de todo => null', pickFeature(features, [50, 25], project, 16) === null);
  ok('polígono por su interior', pickFeature(features, [250, 50], project, 16).properties.id === 'p1');
  ok('polígono por su borde', pickFeature(features, [200, 50], project, 16).properties.id === 'p1');
  ok('fuera del polígono y de la tolerancia => null',
     pickFeature(features, [180, 50], project, 16) === null);
  ok('tolerancia estricta descarta', pickFeature(features, [50, 10], project, 4) === null);
}

console.log('== estado de selección ==');
{
  store.clearFeatures();
  store.loadFeatures([line('a', [[0, 0], [1, 1]]), line('b', [[2, 2], [3, 3]]), poly('c', [[[0, 0], [1, 0], [1, 1], [0, 0]]])]);
  store.clearSelection();
  store.toggleSelection('a');
  store.toggleSelection('b');
  ok('acumula selección', store.getState().selection.length === 2);
  store.toggleSelection('a');
  ok('vuelve a tocar => deselecciona', store.getState().selection.join() === 'b');
  ok('selectedFeatures resuelve los elementos', store.selectedFeatures()[0].properties.id === 'b');

  store.toggleSelection('a');
  store.deleteSelected();
  ok('borra los seleccionados', store.getState().features.length === 1);
  ok('y limpia la selección', store.getState().selection.length === 0);
}

console.log('== reemplazo de elementos ==');
{
  store.loadFeatures([line('x', [[0, 0], [10, 0]]), line('y', [[20, 0], [30, 0]])]);
  const src = store.getState().features[0];
  const piece = store.derivedFeature(src, { type: 'LineString', coordinates: [[0, 0], [5, 0]] });
  ok('la pieza hereda los atributos', piece.properties.type === src.properties.type &&
     piece.properties.certainty === src.properties.certainty);
  ok('pero recibe un id nuevo', piece.properties.id !== src.properties.id && piece.id === piece.properties.id);
  store.replaceFeatures(['x'], [piece]);
  const ids = store.getState().features.map((f) => f.properties.id);
  ok('quita el original y añade la pieza', !ids.includes('x') && ids.includes(piece.properties.id));
  ok('conserva los no afectados', ids.includes('y'));
}

console.log('== flujo de la línea de corte ==');
{
  store.clearFeatures();
  store.loadFeatures([line('m', [[0, 0], [10, 0]])]);
  store.setTool('cut');
  store.addVertex([5, -5]);
  store.addVertex([5, 5]);
  ok('el borrador es de tipo corte', store.getState().draft.kind === 'cut');
  store.finishDraft();
  ok('no crea un elemento nuevo', store.getState().features.length === 1);
  const pc = store.getState().pendingCut;
  ok('publica la línea de corte', pc && pc.type === 'coords' && pc.coords.length === 2,
     JSON.stringify(pc));
  store.clearPendingCut();
  ok('se puede limpiar', store.getState().pendingCut === null);

  // Una línea de corte de un solo punto no debe disparar nada.
  store.addVertex([1, 1]);
  store.finishDraft();
  ok('un corte de 1 vértice no publica nada', store.getState().pendingCut === null);

  // Cambiar de herramienta descarta el corte a medias en vez de aplicarlo.
  store.addVertex([2, 2]);
  store.addVertex([3, 3]);
  store.setTool('line');
  ok('cambiar de herramienta descarta el corte', store.getState().pendingCut === null &&
     store.getState().draft === null);
  ok('y no creó ningún elemento', store.getState().features.length === 1);
}

console.log('== la herramienta Elegir no digitaliza ==');
{
  store.setTool('select');
  store.addVertex([1, 1]);
  ok('addVertex no hace nada en modo selección', store.getState().draft === null);
  store.appendStroke([[1, 1], [2, 2]]);
  ok('appendStroke tampoco', store.getState().draft === null);
  // Con un polígono seleccionado no hay nada que extender, así que se limpia.
  store.loadFeatures([poly('pp', [[[0, 0], [1, 0], [1, 1], [0, 0]]])]);
  store.toggleSelection('pp');
  store.setTool('line');
  ok('salir de Elegir limpia la selección', store.getState().selection.length === 0);
}

console.log('== extender una línea seleccionada ==');
{
  store.clearFeatures();
  store.clearSelection();
  store.loadFeatures([line('base', [[0, 0], [10, 0]])]);
  store.setTool('select');
  store.toggleSelection('base');
  store.setTool('line');
  ok('marca la línea para continuarla', store.getState().extendFrom === 'base');
  ok('la selección se conserva hasta poner el vértice', store.getState().selection.join() === 'base');

  // Primer vértice cerca del extremo (10,0): se continúa por ahí.
  store.addVertex([13, 2]);
  ok('la línea sale del mapa y pasa a ser borrador', store.getState().features.length === 0);
  ok('el borrador arranca con la geometría original',
     eq(store.getState().draft.coords, [[0, 0], [10, 0], [13, 2]]),
     JSON.stringify(store.getState().draft.coords));
  ok('extendFrom se consume', store.getState().extendFrom === null);
  store.finishDraft();
  ok('al cerrar vuelve como un solo elemento', store.getState().features.length === 1);
  ok('con la geometría completa',
     store.getState().features[0].geometry.coordinates.length === 3);
  ok('heredando el tipo original',
     store.getState().features[0].properties.type === 'dike');
}
{
  // Ahora por el otro extremo: la geometría debe invertirse.
  store.clearFeatures();
  store.clearSelection();
  store.loadFeatures([line('base', [[0, 0], [10, 0]])]);
  store.setTool('select');
  store.toggleSelection('base');
  store.setTool('line');
  store.addVertex([-4, 1]);
  ok('se invierte para continuar desde el inicio',
     eq(store.getState().draft.coords, [[10, 0], [0, 0], [-4, 1]]),
     JSON.stringify(store.getState().draft.coords));
}
{
  // Dos líneas seleccionadas: es ambiguo, así que no se extiende nada.
  store.clearFeatures();
  store.clearSelection();
  store.loadFeatures([line('a', [[0, 0], [1, 0]]), line('b', [[5, 0], [6, 0]])]);
  store.setTool('select');
  store.toggleSelection('a');
  store.toggleSelection('b');
  store.setTool('line');
  ok('con dos seleccionadas no extiende', store.getState().extendFrom === null);
  store.addVertex([9, 9]);
  ok('y empieza una línea nueva', store.getState().features.length === 2 &&
     eq(store.getState().draft.coords, [[9, 9]]));
}

console.log('== corte con un elemento existente ==');
{
  store.clearFeatures();
  store.loadFeatures([line('cuchilla', [[5, -5], [5, 5]])]);
  store.requestCutByFeature('cuchilla');
  const pc = store.getState().pendingCut;
  ok('publica el corte por elemento', pc && pc.type === 'feature' && pc.id === 'cuchilla',
     JSON.stringify(pc));
  store.clearPendingCut();
}

console.log('== la selección sobrevive al pasar a Nodos ==');
{
  store.clearFeatures();
  store.loadFeatures([line('n1', [[0, 0], [1, 1]])]);
  store.setTool('select');
  store.toggleSelection('n1');
  store.setTool('vertices');
  ok('se conserva la selección', store.getState().selection.join() === 'n1');
  store.setTool('polygon');
  ok('pero al pasar a Polígono se limpia', store.getState().selection.length === 0);
}

console.log('== encadenar líneas sueltas ==');
{
  // Dos tramos separados: se unen por los extremos más próximos.
  const r = chainLines([[[0, 0], [10, 0]], [[14, 0], [24, 0]]]);
  ok('encadena en orden natural', eq(r, [[0, 0], [10, 0], [14, 0], [24, 0]]), JSON.stringify(r));

  // El segundo viene al revés: hay que invertirlo.
  const r2 = chainLines([[[0, 0], [10, 0]], [[24, 0], [14, 0]]]);
  ok('invierte la pieza si toca', eq(r2, [[0, 0], [10, 0], [14, 0], [24, 0]]), JSON.stringify(r2));

  // El segundo va antes que el primero: se antepone.
  const r3 = chainLines([[[10, 0], [20, 0]], [[0, 0], [6, 0]]]);
  ok('antepone cuando corresponde', eq(r3, [[0, 0], [6, 0], [10, 0], [20, 0]]), JSON.stringify(r3));

  const r4 = chainLines([[[0, 0], [5, 0]], [[40, 0], [45, 0]], [[10, 0], [15, 0]]]);
  ok('encadena tres por cercanía',
     eq(r4, [[0, 0], [5, 0], [10, 0], [15, 0], [40, 0], [45, 0]]), JSON.stringify(r4));

  ok('una sola línea vuelve igual', eq(chainLines([[[1, 1], [2, 2]]]), [[1, 1], [2, 2]]));
  ok('sin líneas => null', chainLines([]) === null);
  ok('descarta piezas degeneradas', eq(chainLines([[[0, 0]], [[1, 1], [2, 2]]]), [[1, 1], [2, 2]]));
}

console.log('== historial ==');
{
  store.loadFeatures([]); // reinicia también el historial
  store.setTool('line');
  ok('al cargar un proyecto no hay nada que deshacer', store.canUndo() === false);

  store.addVertex([0, 0]); store.addVertex([1, 1]); store.finishDraft();
  store.addVertex([5, 5]); store.addVertex([6, 6]); store.finishDraft();
  ok('dos elementos creados', store.getState().features.length === 2);

  ok('deshacer devuelve true', store.undo() === true);
  ok('queda uno', store.getState().features.length === 1);
  ok('rehacer devuelve true', store.redo() === true);
  ok('vuelven a ser dos', store.getState().features.length === 2);

  store.undo(); store.undo();
  ok('deshacer dos veces deja cero', store.getState().features.length === 0);
  ok('ya no queda historial', store.canUndo() === false);
  ok('deshacer de más devuelve false', store.undo() === false);

  store.redo(); store.redo();
  ok('rehacer dos veces restaura', store.getState().features.length === 2);
  ok('rehacer de más devuelve false', store.redo() === false);

  // Una acción nueva invalida la rama de rehacer.
  store.undo();
  store.deleteLastFeature();
  ok('una acción nueva limpia el redo', store.canRedo() === false);

  // Borrar todo también entra al historial.
  store.loadFeatures([line('h1', [[0, 0], [1, 1]]), line('h2', [[2, 2], [3, 3]])]);
  store.clearFeatures();
  ok('borrar todo deja el mapa vacío', store.getState().features.length === 0);
  store.undo();
  ok('deshacer recupera lo borrado', store.getState().features.length === 2,
     String(store.getState().features.length));
}

console.log('== propiedades de la selección ==');
{
  store.clearFeatures();
  store.clearSelection();
  store.loadFeatures([
    line('L', [[0, 0], [1, 1]]),
    poly('P', [[[0, 0], [1, 0], [1, 1], [0, 0]]]),
  ]);
  store.setSelection(['L', 'P']);
  ok('setSelection asigna en bloque', store.getState().selection.length === 2);

  store.updateSelectedProps({ certainty: 'covered', opacity: 0.5 });
  ok('cambia la certeza de todos',
     store.getState().features.every((f) => f.properties.certainty === 'covered'));
  ok('y la opacidad', store.getState().features.every((f) => f.properties.opacity === 0.5));

  const unidad = store.getState().units[1];
  store.setSelection(['L', 'P']);
  store.assignUnitToSelection(unidad.id);
  const p = store.getState().features.find((f) => f.properties.id === 'P');
  const l = store.getState().features.find((f) => f.properties.id === 'L');
  ok('asigna unidad al polígono',
     p.properties.type === unidad.id && p.properties.unit === unidad.name &&
     p.properties.code === unidad.code, JSON.stringify(p.properties));
  ok('no toca las líneas', l.properties.type === 'dike');

  store.setSelection(['L']);
  store.transformSelectedGeometry(() => ({ type: 'LineString', coordinates: [[9, 9], [8, 8]] }));
  ok('transforma la geometría',
     eq(store.getState().features.find((f) => f.properties.id === 'L').geometry.coordinates,
        [[9, 9], [8, 8]]));
}

console.log('== unidades ==');
{
  const n = store.getState().units.length;
  const u = store.addUnit({ name: 'Formación Curanilahue', code: 'Kc', color: '#336699' });
  ok('añade la unidad', store.getState().units.length === n + 1);
  ok('con id propio', !!u.id && u.code === 'Kc');

  store.clearFeatures();
  store.loadFeatures([{ ...poly('X', [[[0, 0], [1, 0], [1, 1], [0, 0]]]),
    properties: { id: 'X', kind: 'polygon', type: u.id, unit: u.name, code: u.code, certainty: 'observed', createdAt: 1 } }]);
  store.updateUnit(u.id, { name: 'Fm. Curanilahue', code: 'Kcu' });
  const px = store.getState().features[0];
  ok('renombrar propaga a los polígonos',
     px.properties.unit === 'Fm. Curanilahue' && px.properties.code === 'Kcu',
     JSON.stringify(px.properties));

  store.removeUnit(u.id);
  ok('elimina la unidad', store.getState().units.length === n);
  ok('no deja quedarse sin ninguna',
     (store.loadUnits([{ id: 'solo', name: 'Única', code: 'U', color: '#fff' }]),
      store.removeUnit('solo'), store.getState().units.length === 1));
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
