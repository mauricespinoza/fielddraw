/**
 * DEVOLVER LOS CAMBIOS A UN DATASET QUE YA EXISTE EN STRABOSPOT
 *
 * La API no tiene una escritura por spot que se haya podido comprobar: la que
 * sí, `POST /db/datasetspots/{id}`, **reemplaza el dataset entero** con lo que
 * se le mande. Así que subir un cambio es mandar el dataset completo, y lo
 * único que lo hace seguro es que lo que se manda sea exactamente lo que hay
 * arriba, con solo lo editado aquí cambiado.
 *
 * Por eso aquí no se regenera ningún spot desde el dibujo. Se parte del spot
 * **nativo** tal como lo devuelve StraboSpot —con sus fotos, sus muestras, sus
 * otras mediciones, sus tags y cualquier campo que FieldDraw no conoce— y se le
 * cambian solo los campos que se editaron. Para saber cuáles, cada elemento se
 * compara con lo que daría adoptar HOY ese mismo spot sin tocar: lo que
 * coincide no se toca, lo que difiere es la edición.
 *
 * Lo que no se puede traducir sin adivinar no se sube: un spot que aquí se
 * partió en dos, una medida que no se sabe a cuál de las orientaciones del
 * spot corresponde, un cambio de unidad (que vive en los tags del proyecto).
 * Se dice cuál y por qué, y se queda como está allá.
 *
 * Todo es puro: recibe lo bajado y el dibujo, devuelve qué mandar.
 */

import { adoptStrabo } from './adopt.js';
import {
  FAULT_OR_SZ_BY_SENSE,
  PLANAR_BY_STRUCTURE_TYPE,
  TRACE_BY_LINE_TYPE,
  TRACE_QUALITY_BY_CERTAINTY,
  planarOrientation,
  traceFor,
} from './mapping.js';
import { isEditedLocally, subsetBySpot } from './sync.js';
import { CONTROL_POINT_KIND } from '../controlPoints.js';

/**
 * Claves de `trace` que dicen QUÉ es la traza. Al cambiar el tipo se quitan
 * todas antes de poner las nuevas: si no, una falla que pasa a contacto
 * conservaría su `shear_sense` y allá seguiría siendo un cabalgamiento.
 */
const TRACE_CLASS_KEYS = new Set([
  'trace_type',
  'trace_quality',
  'other_feature',
  'other_other_feature',
  ...Object.values(TRACE_BY_LINE_TYPE).flatMap((o) => Object.keys(o)),
]);

/** Lo mismo para una medición planar. */
const PLANAR_CLASS_KEYS = new Set([
  'feature_type',
  'fault_or_sz_type',
  'facing',
  ...Object.values(PLANAR_BY_STRUCTURE_TYPE).flatMap((o) => Object.keys(o)),
]);

const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const txt = (v) => (v === null || v === undefined ? '' : String(v)).trim();

/**
 * La nota de un elemento adoptado sin la procedencia que le añade la
 * adopción («[E-1 · StraboSpot · Ana]»): esa coletilla es de aquí, y subirla
 * ensuciaría las notas del spot con cada ida y vuelta.
 */
export function stripProvenance(note) {
  return txt(note).replace(/\s*(—\s*)?\[[^\]]*StraboSpot[^\]]*\]\s*$/, '').trim();
}

/** Grupo de un elemento: los elementos se emparejan dentro de su grupo. */
function grupo(f) {
  const p = f.properties || {};
  if (p.geomKind === 'measurement') return 'measurement';
  if (p.geomKind === CONTROL_POINT_KIND) return 'control';
  return f.geometry ? f.geometry.type : 'other';
}

function porGrupo(list) {
  const out = new Map();
  for (const f of list) {
    const g = grupo(f);
    if (!out.has(g)) out.set(g, []);
    out.get(g).push(f);
  }
  return out;
}

const deg = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : undefined);

/**
 * Aplica sobre el spot nativo `spot` la diferencia entre el elemento local
 * `loc` y el recién adoptado `fr`. Devuelve los campos cambiados y los
 * problemas que impiden subir este spot.
 */
function aplicarPar(spot, loc, fr) {
  const cambios = [];
  const problemas = [];
  const lp = loc.properties || {};
  const fp = fr.properties || {};
  const props = spot.properties;

  if (!sameJSON(loc.geometry, fr.geometry)) {
    if (!spot.geometry || spot.geometry.type !== loc.geometry.type) {
      problemas.push('its geometry type changed');
    } else {
      // Una altitud que traía el punto se conserva: aquí se movió en planta.
      if (loc.geometry.type === 'Point' && Array.isArray(spot.geometry.coordinates) && spot.geometry.coordinates.length > 2) {
        spot.geometry = { ...loc.geometry, coordinates: [...loc.geometry.coordinates.slice(0, 2), spot.geometry.coordinates[2]] };
      } else {
        spot.geometry = loc.geometry;
      }
      cambios.push('location');
    }
  }

  const notaL = stripProvenance(lp.note);
  if (notaL !== stripProvenance(fp.note)) {
    props.notes = notaL;
    cambios.push('notes');
  }

  if (txt(lp.unit) !== txt(fp.unit)) {
    problemas.push('its unit changed — units live in project tags; change it in StraboSpot');
  }

  const g = grupo(loc);
  if (g === 'LineString') {
    if (lp.type !== fp.type || lp.certainty !== fp.certainty) {
      if (!props.trace || typeof props.trace !== 'object') {
        problemas.push('the StraboSpot spot keeps its trace in an old format');
      } else {
        const base = {};
        for (const [k, v] of Object.entries(props.trace)) if (!TRACE_CLASS_KEYS.has(k)) base[k] = v;
        const nuevo = traceFor(lp);
        delete nuevo.tace_notes;
        props.trace = { ...base, ...nuevo };
        cambios.push(lp.type !== fp.type ? 'type' : 'certainty');
      }
    }
  } else if (g === 'Polygon') {
    if (lp.certainty !== fp.certainty) {
      if (!props.surface_feature || typeof props.surface_feature !== 'object') {
        problemas.push('the StraboSpot spot has no surface feature to update');
      } else {
        props.surface_feature = {
          ...props.surface_feature,
          surface_feature_quality: TRACE_QUALITY_BY_CERTAINTY[lp.certainty],
        };
        cambios.push('certainty');
      }
    }
  } else if (g === 'measurement') {
    const r = aplicarMedida(props, lp, fp);
    cambios.push(...r.cambios);
    problemas.push(...r.problemas);
  } else if (g === 'control') {
    const r = aplicarMuestra(props, lp, fp);
    cambios.push(...r.cambios);
    problemas.push(...r.problemas);
  }
  return { cambios, problemas };
}

function aplicarMedida(props, lp, fp) {
  const cambios = [];
  const problemas = [];
  const rumbo = num(lp.strike) !== num(fp.strike) || num(lp.dip) !== num(fp.dip) ||
    num(lp.dipAzimuth) !== num(fp.dipAzimuth);
  const clase = lp.type !== fp.type || (lp.faultSense || '') !== (fp.faultSense || '') ||
    !!lp.overturned !== !!fp.overturned;
  const calidad = (lp.quality ?? null) !== (fp.quality ?? null);
  const linea = num(lp.lineTrend) !== num(fp.lineTrend) || num(lp.linePlunge) !== num(fp.linePlunge);
  if (!rumbo && !clase && !calidad && !linea) return { cambios, problemas };

  if (linea) {
    problemas.push('its striae or lineation changed — not uploaded yet; change it in StraboSpot');
    return { cambios, problemas };
  }
  /*
   * Cuál de las orientaciones del spot es esta medida: la planar con el mismo
   * rumbo y manteo que tenía al entrar. Si no hay exactamente una, no se
   * adivina.
   */
  const planares = (Array.isArray(props.orientation_data) ? props.orientation_data : []).filter(
    (o) => o && Number(o.strike) === Number(fp.strike) && Number(o.dip) === Number(fp.dip),
  );
  if (planares.length !== 1) {
    problemas.push('it is not clear which of the spot’s measurements it is');
    return { cambios, problemas };
  }
  const original = planares[0];
  const gen = planarOrientation(lp, original.id);
  let nueva = { ...original };
  if (rumbo) {
    nueva.strike = deg(lp.strike);
    nueva.dip = deg(lp.dip);
    nueva.dip_direction = deg(lp.dipAzimuth);
    cambios.push('strike/dip');
  }
  if (clase) {
    const base = {};
    for (const [k, v] of Object.entries(nueva)) if (!PLANAR_CLASS_KEYS.has(k)) base[k] = v;
    const claseNueva = {};
    for (const k of PLANAR_CLASS_KEYS) if (gen[k] !== undefined) claseNueva[k] = gen[k];
    // Un plano de falla sin sentido declarado no lleva `fault_or_sz_type`.
    if (lp.type === 'fault-plane' && !FAULT_OR_SZ_BY_SENSE[lp.faultSense]) delete claseNueva.fault_or_sz_type;
    nueva = { ...base, ...claseNueva };
    cambios.push('type');
  }
  if (calidad) {
    if (gen.quality !== undefined) nueva.quality = gen.quality;
    else delete nueva.quality;
    cambios.push('quality');
  }
  props.orientation_data = props.orientation_data.map((o) => (o === original ? nueva : o));
  return { cambios, problemas };
}

function aplicarMuestra(props, lp, fp) {
  const cambios = [];
  const problemas = [];
  if (txt(lp.name) !== txt(fp.name)) {
    props.name = txt(lp.name);
    cambios.push('name');
  }
  const campos = [
    ['sampleId', 'sample_id_name'],
    ['sampleDescription', 'sample_description'],
    ['purpose', 'main_sampling_purpose'],
  ].filter(([k]) => txt(lp[k]) !== txt(fp[k]));
  if (campos.length === 0) return { cambios, problemas };
  const muestras = Array.isArray(props.samples) ? props.samples : [];
  const candidatas = muestras.length === 1
    ? muestras
    : muestras.filter((s) => txt(s.sample_id_name) === txt(fp.sampleId));
  if (candidatas.length !== 1) {
    problemas.push('it is not clear which of the spot’s samples it is');
    return { cambios, problemas };
  }
  const original = candidatas[0];
  const nueva = { ...original };
  for (const [k, campo] of campos) {
    const v = txt(lp[k]);
    if (v) nueva[campo] = v;
    else delete nueva[campo];
  }
  props.samples = muestras.map((s) => (s === original ? nueva : s));
  cambios.push('sample');
  return { cambios, problemas };
}

/** Nombre legible de un spot nativo. */
const spotName = (spot, id) => txt(spot && spot.properties && spot.properties.name) || `Spot ${id}`;

/**
 * Qué mandar.
 *
 * @param {object} args
 * @param {object} args.native     FeatureCollection nativa recién bajada
 * @param {object} args.data       lo mismo, aplanado (para la adopción de referencia)
 * @param {object} args.dataset    el registro del dataset (key, datasetName)
 * @param {Array}  args.features   elementos del dibujo de ESTE dataset
 * @param {number} [args.now]
 * @returns {{
 *   spots: Map<string, object>,                 spot nativo modificado, por id
 *   changed: Array<{id, name, fields: string[]}>,
 *   skipped: Array<{id, name, reasons: string[]}>,
 *   deleted: Array<{id, name}>,                  spots que aquí ya no están
 * }}
 */
export function buildPush({ native, data, dataset, features, now = Date.now() }) {
  const nativos = new Map();
  for (const s of (native && native.features) || []) {
    const id = s && s.properties && s.properties.id;
    if (id !== undefined && id !== null) nativos.set(String(id), s);
  }
  const locales = new Map();
  for (const f of features) {
    const id = f.properties && f.properties.straboSpotId;
    if (!id) continue;
    if (!locales.has(id)) locales.set(id, []);
    locales.get(id).push(f);
  }

  const spots = new Map();
  const changed = [];
  const skipped = [];
  const deleted = [];

  // La referencia: cómo entraría hoy cada spot sin tocar.
  const fresh = adoptStrabo(
    { ...data, key: dataset.key, datasetName: dataset.datasetName },
    { units: [], newId: (() => { let i = 0; return () => `ref-${i++}`; })() },
  ).features;
  const frescos = new Map();
  for (const f of fresh) {
    const id = f.properties.straboSpotId;
    if (!id) continue;
    if (!frescos.has(id)) frescos.set(id, []);
    frescos.get(id).push(f);
  }

  for (const [id, ref] of frescos) {
    const mios = locales.get(id) || [];
    const original = nativos.get(id);
    if (!original) continue; // ya no está arriba: lo resuelve una actualización
    if (mios.length === 0) {
      deleted.push({ id, name: spotName(original, id) });
      continue;
    }
    const tocado = mios.some(isEditedLocally) || mios.length !== ref.length;
    if (!tocado) continue;

    const gl = porGrupo(mios);
    const gr = porGrupo(ref);
    const iguales =
      gl.size === gr.size && [...gr].every(([g, list]) => (gl.get(g) || []).length === list.length);
    if (!iguales) {
      skipped.push({
        id,
        name: spotName(original, id),
        reasons: ['it was split, merged or partly deleted here'],
      });
      continue;
    }

    const spot = structuredClone(original);
    const campos = new Set();
    const problemas = [];
    for (const [g, list] of gr) {
      const mine = gl.get(g);
      list.forEach((fr, i) => {
        const r = aplicarPar(spot, mine[i], fr);
        r.cambios.forEach((c) => campos.add(c));
        problemas.push(...r.problemas);
      });
    }
    if (problemas.length) {
      skipped.push({ id, name: spotName(original, id), reasons: [...new Set(problemas)] });
      continue;
    }
    if (campos.size === 0) continue;
    spot.properties.modified_timestamp = now;
    spots.set(id, spot);
    changed.push({ id, name: spotName(spot, id), fields: [...campos] });
  }

  return { spots, changed, skipped, deleted };
}

/**
 * La colección final: lo de arriba tal cual, con los spots cambiados en su
 * sitio, sin los borrados que se decidió borrar y con los nuevos al final.
 */
export function assembleCollection(native, { spots, deletedIds = [], added = [] }) {
  const borrar = new Set(deletedIds.map(String));
  const features = [];
  for (const s of (native && native.features) || []) {
    const id = String(s.properties && s.properties.id);
    if (borrar.has(id)) continue;
    features.push(spots.get(id) || s);
  }
  return { type: 'FeatureCollection', features: [...features, ...added] };
}

/** Ids de spot de una colección, para comprobar lo que quedó arriba. */
export function spotIdsOf(collection) {
  return new Set(
    ((collection && collection.features) || [])
      .map((s) => s && s.properties && s.properties.id)
      .filter((id) => id !== undefined && id !== null)
      .map(String),
  );
}
