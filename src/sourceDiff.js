/**
 * Qué cambió entre dos listas de elementos, para mandarle al mapa solo eso.
 *
 * `setData` le entrega a MapLibre la colección ENTERA: la serializa en el hilo
 * principal, la manda al worker y este la vuelve a indexar completa. Con un
 * dibujo chico no se nota. Medido con 3000 elementos y ~250 000 vértices: cada
 * `setData` bloquea el hilo principal entre 150 y 370 ms y tarda medio segundo
 * en verse, y eso pasaba con CADA cambio —un vértice arrastrado, una nota, un
 * contacto nuevo—. El mismo cambio por `updateData` tarda unos 45 ms y no
 * bloquea nada, porque solo viaja el elemento tocado.
 *
 * El store no muta: un elemento que cambió es un objeto NUEVO, y uno que no
 * cambió es el mismo objeto de antes. Por eso basta comparar por identidad.
 *
 * Devuelve `null` cuando no se puede (o no conviene) mandar la diferencia, y
 * entonces quien llama hace el `setData` de siempre:
 *
 * - algún elemento sin `properties.id`, o dos con el mismo: el worker los
 *   guarda por id y se pisarían;
 * - el ORDEN no saldría igual. El worker conserva el lugar de lo que se
 *   reemplaza y pone lo nuevo al final; el orden decide qué se pinta encima,
 *   así que si la lista nueva no es exactamente «lo que quedó, en su orden, y
 *   lo nuevo detrás» —un deshacer que devuelve algo al medio, por ejemplo— se
 *   manda entera;
 * - cambió más de la mitad: ahí la diferencia ya no ahorra nada.
 *
 * @param {Map<string|number, {f: object, i: number}>|null} prev índice de lo
 *   último que se mandó (ver `indexFeatures`), o `null` si no se sabe
 * @param {object[]} next la lista que tiene que quedar
 * @returns {{remove: Array<string|number>, add: object[]}|null} `remove` y
 *   `add` vacíos significan que no hay nada que mandar
 */
export function featureDiff(prev, next) {
  if (!prev) return null;

  const add = [];
  const nuevos = [];
  let quedan = 0;
  let ultimo = -1;
  const vistos = new Set();

  for (const f of next) {
    const id = f && f.properties ? f.properties.id : null;
    if (id === null || id === undefined || vistos.has(id)) return null;
    vistos.add(id);

    const antes = prev.get(id);
    if (!antes) {
      nuevos.push(f);
      continue;
    }
    // Uno que ya estaba, después de uno nuevo: el worker lo dejaría antes.
    if (nuevos.length) return null;
    // Los que quedan tienen que seguir en el orden en que estaban.
    if (antes.i < ultimo) return null;
    ultimo = antes.i;
    quedan++;
    if (antes.f !== f) add.push(f);
  }

  const remove = [];
  if (quedan < prev.size) {
    for (const id of prev.keys()) if (!vistos.has(id)) remove.push(id);
  }

  for (const f of nuevos) add.push(f);
  if ((remove.length + add.length) * 2 > Math.max(next.length, prev.size)) return null;
  return { remove, add };
}

/**
 * Índice por id de una lista ya mandada, para el siguiente `featureDiff`.
 * `null` si la lista no sirve como base: ids ausentes o repetidos.
 */
export function indexFeatures(list) {
  const out = new Map();
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const id = f && f.properties ? f.properties.id : null;
    if (id === null || id === undefined || out.has(id)) return null;
    out.set(id, { f, i });
  }
  return out;
}
