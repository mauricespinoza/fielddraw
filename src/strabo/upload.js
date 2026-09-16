import { LINE_TYPE_BY_ID, STRUCTURE_TYPE_BY_ID } from '../symbology.js';
import { formatStrikeDip } from '../structure.js';
import { newStraboId } from './api.js';
import {
  geologicUnitTag,
  measurementProvenance,
  planarOrientation,
  pruneEmpty,
  surfaceFeatureFor,
  traceFor,
} from './mapping.js';

/**
 * Convierte el dibujo de FieldDraw en spots de StraboSpot.
 *
 * Lo que decide si un dato «se entiende» al otro lado no son sus atributos
 * sueltos sino los objetos nativos del modelo —`orientation_data`, `trace`,
 * `surface_feature` y los tags de unidad—, que es lo que arma `mapping.js`.
 * Aquí se construye el spot que los envuelve.
 *
 * Los campos que StraboSpot necesita sí o sí en cada spot son `id`, `name`,
 * `date`, `time` y `modified_timestamp`. Lo demás viaja como atributos libres:
 * el servidor los guarda tal cual y vuelven a bajar intactos, que es lo que
 * permite conservar la trazabilidad del ajuste sin ensuciar el modelo.
 */

const esMedida = (f) => f.geometry.type === 'Point' && f.properties.geomKind === 'measurement';

const SPOT_TYPE = { Polygon: 'polygon', LineString: 'line', Point: 'point' };

/**
 * Qué se puede subir. Un punto solo cuenta si es una medida: StraboSpot lo
 * recibiría igual, pero un punto sin rumbo ni manteo llegaría como un spot
 * vacío que nadie sabría interpretar.
 */
const subible = (f) => !!f.geometry && !!SPOT_TYPE[f.geometry.type] && (f.geometry.type !== 'Point' || esMedida(f));

/** Cuántos elementos del dibujo son subibles, para avisar antes de empezar. */
export function uploadableCount(features) {
  return features.filter(subible).length;
}

/** Desglose por tipo, que es lo que se le enseña a quien va a subir. */
export function uploadBreakdown(features) {
  const out = { measurements: 0, lines: 0, polygons: 0 };
  for (const f of features.filter(subible)) {
    if (esMedida(f)) out.measurements++;
    else if (f.geometry.type === 'Polygon') out.polygons++;
    else out.lines++;
  }
  return out;
}

/** Nombre legible del tipo, que es lo que se lee en la lista de spots. */
function typeLabel(feature) {
  const p = feature.properties;
  if (esMedida(feature)) {
    const meta = STRUCTURE_TYPE_BY_ID.get(p.type);
    return meta ? meta.label : p.type || 'measurement';
  }
  if (feature.geometry.type === 'Polygon') return p.unit || p.type || 'unit';
  const meta = LINE_TYPE_BY_ID.get(p.type);
  return meta ? meta.label : p.type || 'line';
}

/**
 * Nombre del spot. Numera por tipo y no sobre el total: «Normal fault 3» dice
 * algo, «Normal fault 47» de un dibujo con 47 elementos de diez clases no.
 */
function spotName(feature, counters) {
  const p = feature.properties;
  // Una medida se nombra por lo que es: `Bedding 045/32` se reconoce de un
  // vistazo en la lista de spots, `Bedding 7` no.
  if (esMedida(feature)) return `${typeLabel(feature)} ${formatStrikeDip(p.strike, p.dip)}`;
  if (p.unit && feature.geometry.type === 'Polygon') {
    const n = (counters.get(p.unit) || 0) + 1;
    counters.set(p.unit, n);
    return p.code ? `${p.unit} (${p.code}) ${n}` : `${p.unit} ${n}`;
  }
  const label = typeLabel(feature);
  const n = (counters.get(label) || 0) + 1;
  counters.set(label, n);
  return `${label} ${n}`;
}

/**
 * Trazabilidad del dato, agrupada y no desparramada por `properties`.
 *
 * Va aparte a propósito: son campos de FieldDraw, no del modelo de StraboSpot,
 * y mezclarlos con los suyos haría creer que la app los interpreta. Aquí se
 * conservan los valores EXACTOS —el rumbo y el manteo del spot van redondeados
 * a entero, porque el formulario los declara enteros—, que es lo que permite
 * recalcular después sin haber perdido precisión.
 */
function fielddrawBlock(feature) {
  const p = feature.properties;
  return pruneEmpty({
    source: 'FieldDraw',
    feature_id: p.id,
    type: p.type,
    certainty: p.certainty,
    unit: p.unit,
    unit_code: p.code,
    ...(esMedida(feature)
      ? {
          method: p.method || 'manual',
          strike: p.strike,
          dip: p.dip,
          dip_azimuth: p.dipAzimuth,
          overturned: !!p.overturned,
          strike_sd: p.strikeSd,
          dip_sd: p.dipSd,
          fit_rms_m: p.rms,
          fit_points: p.n,
          baseline_m: p.baseline,
          dem_source: p.demSource,
        }
      : {}),
  });
}

/** La fecha como la escribe StraboSpot: ISO con los milisegundos a cero. */
function isoNow() {
  const d = new Date();
  d.setMilliseconds(0);
  return d.toISOString();
}

/**
 * Unidad de un elemento, sea polígono o medida.
 *
 * En un polígono la unidad ES su `type` —así lo modela el store—; en una
 * medida es una etiqueta aparte, `unitId`, porque `type` ya lo ocupa la
 * superficie medida (bedding, foliation…). Las dos formas denormalizan
 * nombre y código en `unit`/`code`, que es lo que permite reconstruir la
 * unidad aunque ya no esté en el catálogo vigente (`units` puede venir de un
 * proyecto viejo que cambió sus unidades desde entonces).
 */
function unitFor(f, units) {
  const p = f.properties;
  if (f.geometry.type === 'Polygon') {
    return units.find((u) => u.id === p.type) || (p.unit ? { id: p.type, name: p.unit, code: p.code } : null);
  }
  if (esMedida(f) && p.unitId) {
    return units.find((u) => u.id === p.unitId) || (p.unit ? { id: p.unitId, name: p.unit, code: p.code } : null);
  }
  return null;
}

/**
 * @param {Array} features features de FieldDraw
 * @param {{field?: string, geologist?: string, units?: Array}} meta
 * @returns {{collection: object, count: number, tags: Array, breakdown: object}}
 *   `tags` son los tags `geologic_unit` que hay que escribir en el proyecto
 *   para que los polígonos y las medidas salgan con su unidad y su color; sin
 *   ellos un polígono llega anónimo y una medida sin decir en qué unidad se
 *   tomó.
 */
export function featuresToSpots(features, meta = {}) {
  const now = Date.now();
  const iso = isoNow();
  const counters = new Map();
  const units = Array.isArray(meta.units) ? meta.units : [];
  /** unidad -> ids de los spots (de polígono o de medida) que le pertenecen. */
  const porUnidad = new Map();

  const spots = features.filter(subible).map((f) => {
    const p = f.properties;
    const id = newStraboId();
    const name = spotName(f, counters);
    /*
     * En una medida, las notas del SPOT llevan también el error del ajuste
     * (σ de rumbo y manteo, RMS, base, fuente del DEM): es lo primero que se
     * ve al abrir el spot en StraboSpot, y sin eso ahí un manteo calculado
     * sobre un DEM se lee igual que uno de brújula. El mismo texto se repite
     * en la orientación (ver `planarOrientation`), que es lo único visible al
     * editar la medición desde el formulario.
     */
    const notas = esMedida(f) ? measurementProvenance(p) : (p.notes || p.note || '').trim();

    const propiedades = {
      id,
      name,
      date: iso,
      time: iso,
      modified_timestamp: now,
      notes: notas,

      // Lo que hace que StraboSpot lo entienda, según la geometría.
      ...(esMedida(f) ? { orientation_data: [planarOrientation(p, newStraboId())] } : {}),
      ...(f.geometry.type === 'LineString' ? { trace: traceFor(p) } : {}),
      ...(f.geometry.type === 'Polygon' ? { surface_feature: surfaceFeatureFor(p) } : {}),

      // Metadatos de la campaña. No son del modelo de StraboSpot, pero son los
      // nombres de columna que el plugin de QGIS enseña, y es lo que el usuario
      // acaba de escribir en el panel.
      Field: meta.field || '',
      Geologist: meta.geologist || '',

      fielddraw: fielddrawBlock(f),
    };

    const unidad = unitFor(f, units);
    if (unidad && unidad.name) {
      if (!porUnidad.has(unidad.name)) porUnidad.set(unidad.name, { unit: unidad, spots: [] });
      porUnidad.get(unidad.name).spots.push(id);
    }

    return { type: 'Feature', geometry: f.geometry, properties: propiedades };
  });

  const tags = [...porUnidad.values()].map(({ unit, spots: ids }) =>
    geologicUnitTag(unit, ids, newStraboId()),
  );

  return {
    collection: { type: 'FeatureCollection', features: spots },
    count: spots.length,
    tags,
    breakdown: uploadBreakdown(features),
  };
}
