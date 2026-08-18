import { LINE_TYPE_BY_ID, STRUCTURE_TYPE_BY_ID } from '../symbology.js';
import { formatStrikeDip } from '../structure.js';
import { newStraboId } from './api.js';

/**
 * Superficie medida -> valor de `Type` en StraboSpot.
 *
 * Se usan los mismos literales que reconoce la expresión de iconos de
 * `layers.js`, que a su vez replica el QML del plugin de QGIS: así una medida
 * tomada aquí y bajada después con el plugin sale con su símbolo, y no con el
 * genérico de "indeterminada".
 */
const STRABO_TYPE = {
  bedding: 'bedding',
  foliation: 'foliation',
  joint: 'fracture',
  'fault-plane': 'fault',
};

const esMedida = (f) => f.geometry.type === 'Point' && f.properties.geomKind === 'measurement';

/**
 * Convierte el dibujo de FieldDraw en spots de StraboSpot.
 *
 * Cada línea o polígono pasa a ser un spot con geometría propia. Las
 * propiedades usan los mismos nombres que el plugin de QGIS da a sus capas de
 * líneas y polígonos (`Name`, `Date`, `Unit`, `Notes`, `Type`, `Field`,
 * `Geologist`), para que el viaje de ida y vuelta sea reconocible: lo que se
 * sube desde aquí se lee igual al bajarlo con el plugin.
 *
 * Los campos que StraboSpot necesita sí o sí en cada spot son `id`, `name`,
 * `date` y `modified_timestamp`; el resto viaja como atributos libres.
 */

/** Nombre legible del tipo, que es lo que se lee en StraboSpot. */
function typeLabel(feature) {
  const t = feature.properties.type;
  if (esMedida(feature)) return STRABO_TYPE[t] || 'bedding';
  if (feature.geometry.type === 'Polygon') return feature.properties.unit || t || 'unit';
  const meta = LINE_TYPE_BY_ID.get(t);
  return meta ? meta.label : t || 'line';
}

function spotName(feature, index) {
  const p = feature.properties;
  // Una medida se nombra por lo que es: `Bedding 045/32` se reconoce de un
  // vistazo en la lista de spots, `bedding 7` no.
  if (esMedida(feature)) {
    const meta = STRUCTURE_TYPE_BY_ID.get(p.type);
    return `${meta ? meta.label : p.type} ${formatStrikeDip(p.strike, p.dip)}`;
  }
  if (p.unit && feature.geometry.type === 'Polygon') {
    return p.code ? `${p.unit} (${p.code})` : p.unit;
  }
  return `${typeLabel(feature)} ${index + 1}`;
}

/** Atributos propios de una medida estructural, con su calidad. */
function measurementProps(feature) {
  const p = feature.properties;
  return {
    // Los nombres que espera el plugin de QGIS y que ya lee `layers.js`.
    Strike: p.strike,
    Dip: p.dip,
    'Dip Direction': p.dipAzimuth,
    // Trazabilidad de cómo se obtuvo, que es lo que decide si el dato sirve.
    method: p.method || 'manual',
    overturned: !!p.overturned,
    strike_sd: p.strikeSd ?? null,
    dip_sd: p.dipSd ?? null,
    fit_rms_m: p.rms ?? null,
    fit_points: p.n ?? null,
    base_m: p.baseline ?? null,
    dem_source: p.demSource || null,
  };
}

/**
 * @param {Array} features features de FieldDraw
 * @param {{field?: string, geologist?: string, dataset?: string}} meta
 * @returns {{collection: object, count: number}}
 */
export function featuresToSpots(features, meta = {}) {
  const now = Date.now();
  const iso = new Date(now).toISOString();

  const spots = features.filter(subible).map((f, i) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      id: newStraboId(),
      name: spotName(f, i),
      date: iso,
      time: iso,
      modified_timestamp: now,
      // `spotType` distingue la geometría en la app móvil de StraboSpot.
      spotType: SPOT_TYPE[f.geometry.type],
      notes: f.properties.notes || '',

      // Atributos con los nombres del plugin de QGIS.
      Name: spotName(f, i),
      Date: iso,
      Unit: f.properties.unit || '',
      Notes: f.properties.notes || '',
      Type: typeLabel(f),
      Field: meta.field || '',
      Geologist: meta.geologist || '',

      // Trazabilidad: de dónde salió y con qué certeza se dibujó.
      source: 'FieldDraw',
      certainty: f.properties.certainty || '',
      unit_code: f.properties.code || '',

      ...(esMedida(f) ? measurementProps(f) : {}),
    },
  }));

  return {
    collection: { type: 'FeatureCollection', features: spots },
    count: spots.length,
  };
}

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
