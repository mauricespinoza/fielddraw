import { LINE_TYPE_BY_ID } from '../symbology.js';
import { newStraboId } from './api.js';

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
  if (feature.geometry.type === 'Polygon') return feature.properties.unit || t || 'unit';
  const meta = LINE_TYPE_BY_ID.get(t);
  return meta ? meta.label : t || 'line';
}

function spotName(feature, index) {
  const p = feature.properties;
  if (p.unit && feature.geometry.type === 'Polygon') {
    return p.code ? `${p.unit} (${p.code})` : p.unit;
  }
  return `${typeLabel(feature)} ${index + 1}`;
}

/**
 * @param {Array} features features de FieldDraw
 * @param {{field?: string, geologist?: string, dataset?: string}} meta
 * @returns {{collection: object, count: number}}
 */
export function featuresToSpots(features, meta = {}) {
  const now = Date.now();
  const iso = new Date(now).toISOString();

  const spots = features
    .filter((f) => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'Polygon'))
    .map((f, i) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: newStraboId(),
        name: spotName(f, i),
        date: iso,
        time: iso,
        modified_timestamp: now,
        // `spotType` distingue la geometría en la app móvil de StraboSpot.
        spotType: f.geometry.type === 'Polygon' ? 'polygon' : 'line',
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
      },
    }));

  return {
    collection: { type: 'FeatureCollection', features: spots },
    count: spots.length,
  };
}

/** Cuántos elementos del dibujo son subibles, para avisar antes de empezar. */
export function uploadableCount(features) {
  return features.filter(
    (f) => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'Polygon'),
  ).length;
}
