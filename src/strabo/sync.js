/**
 * ACTUALIZAR UN DATASET: QUÉ CAMBIÓ ARRIBA Y QUÉ CAMBIÓ AQUÍ
 *
 * Volver a bajar un dataset de StraboSpot es fácil; lo delicado es no pisar
 * nada al hacerlo. Hay dos lados que pueden haberse movido desde la última
 * vez que se bajó:
 *
 * - **Arriba**: su autor siguió trabajando —añadió spots, corrigió un manteo,
 *   borró una traza—. Para saberlo se guarda, al bajarlo, una **huella** de
 *   cada spot tal como venía (`baseline`): un spot cuya huella cambió se
 *   modificó allá, uno que falta se borró, uno que no estaba es nuevo.
 * - **Aquí**: si el dataset se abrió, sus elementos pueden estar editados. Al
 *   adoptarlos cada uno guarda la huella de cómo quedó (`straboLocalHash`);
 *   si ya no coincide, alguien lo tocó.
 *
 * Con las dos cosas se decide cada spot sin adivinar:
 *
 * | Arriba \ Aquí     | sin tocar               | editado o borrado aquí |
 * | ----------------- | ----------------------- | ---------------------- |
 * | nuevo             | se añade                | —                      |
 * | modificado        | se reemplaza            | **conflicto**          |
 * | borrado           | se quita                | **conflicto**          |
 * | igual             | nada                    | nada (manda lo de aquí) |
 *
 * Un conflicto nunca se resuelve solo: se pregunta, y por omisión se queda
 * lo de aquí, que es lo único que no se puede volver a bajar.
 *
 * Todo lo de este módulo es puro —recibe datos, devuelve datos— para poder
 * probarlo sin red y sin mapa.
 */

/** JSON con las claves ordenadas: la misma cosa da siempre el mismo texto. */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/**
 * Huella corta de un texto: dos FNV-1a de 32 bits con semillas distintas.
 * No es criptográfica ni hace falta: compara un spot consigo mismo en el
 * tiempo, y 64 bits hacen despreciable que dos versiones distintas coincidan.
 */
export function hashText(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Lo que la propia app le cuelga a un spot al bajarlo y no es del spot. */
const SPOT_LOCAL_KEYS = new Set(['__geotype__']);

/** Huella de un spot tal como lo devuelve la API. */
export function spotFingerprint(spot) {
  const props = {};
  for (const [k, v] of Object.entries((spot && spot.properties) || {})) {
    if (!SPOT_LOCAL_KEYS.has(k)) props[k] = v;
  }
  return hashText(stableStringify({ g: (spot && spot.geometry) || null, p: props }));
}

/**
 * `{spotId: huella}` de todo lo bajado. Un spot sin id no se puede seguir y
 * queda fuera: no habría forma de reconocerlo la próxima vez.
 */
export function baselineOf(spots) {
  const out = {};
  for (const list of [spots.point, spots.line, spots.polygon]) {
    for (const s of list || []) {
      const id = s && s.properties && s.properties.id;
      if (id === undefined || id === null || id === '') continue;
      out[String(id)] = spotFingerprint(s);
    }
  }
  return out;
}

/**
 * Propiedades de un elemento del dibujo que no cuentan como edición: el id y
 * la fecha cambian al cortar o al copiar sin que cambie el dato, y la propia
 * huella no puede formar parte de lo que mide.
 */
const FEATURE_VOLATILE_KEYS = new Set(['id', 'createdAt', 'straboLocalHash']);

/** Huella de un elemento del dibujo, para saber después si se editó. */
export function featureFingerprint(f) {
  const props = {};
  for (const [k, v] of Object.entries((f && f.properties) || {})) {
    if (!FEATURE_VOLATILE_KEYS.has(k)) props[k] = v;
  }
  return hashText(stableStringify({ g: (f && f.geometry) || null, p: props }));
}

/** ¿Se editó aquí? Sin huella guardada no se sabe, y se asume que sí. */
export function isEditedLocally(f) {
  const h = f && f.properties && f.properties.straboLocalHash;
  return !h || h !== featureFingerprint(f);
}

/** Las tres colecciones quedándose solo con los spots pedidos. */
export function subsetBySpot(data, spotIds) {
  const ids = new Set([...spotIds].map(String));
  const keep = (fc) => ({
    type: 'FeatureCollection',
    features: ((fc && fc.features) || []).filter((f) => {
      const id = f.properties && f.properties.__spot_id__;
      return id !== undefined && id !== null && ids.has(String(id));
    }),
  });
  return { ...data, estructuras: keep(data.estructuras), observacion: keep(data.observacion), lineas: keep(data.lineas) };
}

/** Nombre legible de un spot en lo bajado, para la lista de conflictos. */
function spotNames(data) {
  const out = new Map();
  for (const fc of [data.estructuras, data.observacion, data.lineas]) {
    for (const f of (fc && fc.features) || []) {
      const p = f.properties || {};
      const id = p.__spot_id__;
      if (id === undefined || id === null) continue;
      if (!out.has(String(id)) && p.Name) out.set(String(id), String(p.Name));
    }
  }
  return out;
}

/**
 * Plan de actualización de un dataset.
 *
 * @param {object} args
 * @param {object|null} args.baseline   huellas de la última bajada; null si el
 *   dataset se bajó antes de que existieran (no se pueden ver modificaciones)
 * @param {object} args.remote          huellas de lo que hay ahora arriba
 * @param {object} args.data            lo bajado, aplanado (para los nombres)
 * @param {boolean} args.adopted        si el dataset ya está en el dibujo
 * @param {Array} args.features         elementos del dibujo de ESTE dataset
 * @returns {{added: string[], replaced: string[], removed: string[],
 *   conflicts: Array<{spotId, kind, name}>, unchanged: number,
 *   noBaseline: boolean}}
 *   `kind` es 'changed' (modificado arriba y editado aquí), 'removed' (borrado
 *   arriba y editado aquí) o 'deleted-here' (modificado arriba y borrado aquí).
 */
export function planUpdate({ baseline, remote, data, adopted, features = [] }) {
  const names = spotNames(data || {});
  const nameOf = (id) => names.get(id) || '';
  const plan = { added: [], replaced: [], removed: [], conflicts: [], unchanged: 0, noBaseline: !baseline };
  const remoteIds = Object.keys(remote || {});

  // Sin abrir no hay nada local que proteger: lo de arriba manda entero.
  if (!adopted) {
    const base = baseline || {};
    for (const id of remoteIds) {
      if (!(id in base)) plan.added.push(id);
      else if (base[id] !== remote[id]) plan.replaced.push(id);
      else plan.unchanged++;
    }
    for (const id of Object.keys(base)) if (!(id in remote)) plan.removed.push(id);
    return plan;
  }

  const locales = new Map();
  for (const f of features) {
    const id = f.properties && f.properties.straboSpotId;
    if (!id) continue;
    if (!locales.has(id)) locales.set(id, []);
    locales.get(id).push(f);
  }
  const editado = (id) => (locales.get(id) || []).some(isEditedLocally);

  /*
   * Sin huellas de la última bajada solo se puede añadir lo que no está aquí.
   * Lo que sí está no se toca: no hay forma de saber si cambió arriba, y
   * reemplazarlo a ciegas podría borrar una edición.
   */
  if (!baseline) {
    for (const id of remoteIds) {
      if (locales.has(id)) plan.unchanged++;
      else plan.added.push(id);
    }
    return plan;
  }

  for (const id of remoteIds) {
    const antes = baseline[id];
    if (antes === undefined) {
      plan.added.push(id);
      continue;
    }
    if (antes === remote[id]) {
      plan.unchanged++;
      continue;
    }
    // Modificado arriba.
    if (!locales.has(id)) plan.conflicts.push({ spotId: id, kind: 'deleted-here', name: nameOf(id) });
    else if (editado(id)) plan.conflicts.push({ spotId: id, kind: 'changed', name: nameOf(id) });
    else plan.replaced.push(id);
  }
  for (const id of Object.keys(baseline)) {
    if (id in remote) continue;
    // Borrado arriba. Si aquí ya no estaba, no hay nada que hacer.
    if (!locales.has(id)) continue;
    if (editado(id)) {
      const f = locales.get(id)[0];
      plan.conflicts.push({ spotId: id, kind: 'removed', name: localName(f) });
    } else plan.removed.push(id);
  }
  return plan;
}

/** Nombre de un elemento del dibujo que ya no está arriba. */
function localName(f) {
  const p = (f && f.properties) || {};
  if (p.name) return String(p.name);
  // La procedencia que deja la adopción empieza por el nombre del spot.
  const m = /\[([^\]·]+)/.exec(String(p.note || ''));
  return m ? m[1].trim() : '';
}

/** ¿Hay algo que hacer? */
export function planIsEmpty(plan) {
  return (
    plan.added.length + plan.replaced.length + plan.removed.length + plan.conflicts.length === 0
  );
}

/**
 * Qué spots salen del dibujo y cuáles entran, dadas las decisiones sobre los
 * conflictos (`choices[spotId]` = 'theirs' | 'mine'; por omisión, 'mine').
 */
export function resolvePlan(plan, choices = {}) {
  const quitar = new Set([...plan.replaced, ...plan.removed]);
  const traer = new Set([...plan.added, ...plan.replaced]);
  for (const c of plan.conflicts) {
    if (choices[c.spotId] !== 'theirs') continue;
    if (c.kind === 'changed') {
      quitar.add(c.spotId);
      traer.add(c.spotId);
    } else if (c.kind === 'removed') quitar.add(c.spotId);
    else if (c.kind === 'deleted-here') traer.add(c.spotId);
  }
  return { remove: [...quitar], add: [...traer] };
}
