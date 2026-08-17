/**
 * Aplanado de spots de StraboSpot a las dos tablas que usa el flujo de trabajo
 * del plugin de QGIS `Strabo_to_Spots`: **Estructuras** y **Observación**.
 *
 * Es un port de `core/api_client.py` (flatten_point_features, pair_orientations)
 * y `core/conversion.py` (process_type, build_spots_estructuras,
 * build_spots_muestras) de ese plugin, con las mismas columnas y en el mismo
 * orden, para que lo que se ve aquí sea lo mismo que se ve en QGIS.
 *
 * Se replican dos comportamientos que parecen bugs y no lo son:
 *
 * - `processType` compara `planar === 'fault'` sin normalizar mayúsculas.
 *   StraboSpot ya entrega esos valores en minúsculas, así que la comparación
 *   literal es intencional; "corregirla" cambiaría las categorías de la
 *   simbología.
 * - La estría de una falla NO es un elemento suelto de `orientation_data`:
 *   viene anidada en `associated_orientation` dentro de la medición planar.
 *   Leer solo el primer nivel deja Trend/Plunge vacíos siempre.
 */

const ASSOCIATED_KEYS = ['associated_orientation', 'associated_orientations'];

const isMissing = (v) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || Number.isNaN(v);

function isLinear(o) {
  if (!o || typeof o !== 'object') return false;
  if (o.type === 'linear_orientation') return true;
  return o.type === undefined && o.trend !== undefined && o.trend !== null;
}

function isPlanar(o) {
  if (!o || typeof o !== 'object') return false;
  if (o.type === 'planar_orientation') return true;
  return o.type === undefined && o.strike !== undefined && o.strike !== null;
}

/** Primera orientación anidada que cumpla el predicado. */
function associated(orientation, predicate) {
  for (const key of ASSOCIATED_KEYS) {
    let nested = orientation && orientation[key];
    if (!nested) continue;
    if (!Array.isArray(nested)) nested = [nested];
    for (const cand of nested) if (predicate(cand)) return cand;
  }
  return {};
}

/**
 * Empareja cada plano con su estría. Primero busca la anidada; si no la hay,
 * cae al emparejamiento posicional con las lineales de primer nivel. Las
 * lineales que quedan sueltas también son estructuras y salen como fila propia.
 */
export function pairOrientations(orientationData) {
  const data = Array.isArray(orientationData) ? orientationData : [];
  const planares = data.filter(isPlanar);
  const lineales = data.filter(isLinear);

  const pares = [];
  const usadas = new Set();

  planares.forEach((planar, i) => {
    let linear = associated(planar, isLinear);
    if ((!linear || Object.keys(linear).length === 0) && i < lineales.length) {
      linear = lineales[i];
      usadas.add(i);
    }
    pares.push([planar, linear || {}]);
  });

  lineales.forEach((linear, i) => {
    if (usadas.has(i)) return;
    pares.push([associated(linear, isPlanar), linear]);
  });

  if (pares.length === 0) pares.push([{}, {}]);
  return pares;
}

/** Filas crudas, una por medición (y una por muestra si el spot trae muestras). */
export function flattenPointFeatures(features, spotTags = {}) {
  const rows = [];

  for (const feature of features || []) {
    const props = feature.properties || {};
    const coords = (feature.geometry && feature.geometry.coordinates) || [];
    const base = {
      Name: props.name,
      Date: props.date || props.time,
      Notes: props.notes || '',
      Latitude: coords.length > 1 ? coords[1] : null,
      Longitude: coords.length > 0 ? coords[0] : null,
      'Altitude(m)': coords.length > 2 ? coords[2] : props.altitude,
      __tags__: spotTags[props.id] || [],
      __spot_id__: props.id,
    };

    const samples = props.samples || [];

    for (const [planar, linear] of pairOrientations(props.orientation_data)) {
      const row = {
        ...base,
        'Planar Orientation Planar Feature Type': planar.feature_type,
        'Planar Orientation Fault Or Sz Type': planar.fault_or_sz_type,
        'Planar Orientation Other Feature': planar.other_feature,
        'Planar Orientation Strike': planar.strike,
        'Planar Orientation Dip': planar.dip,
        'Planar Orientation Quality': planar.quality,
        // Los indicadores cinemáticos se registran a veces en el plano y a
        // veces en la estría; vale el que venga.
        'Planar Orientation Directional Indicators':
          planar.directional_indicators || linear.directional_indicators,
        'Planar Orientation Notes': planar.notes,
        'Linear Orientation Trend': linear.trend,
        'Linear Orientation Plunge': linear.plunge,
      };

      if (samples.length) {
        for (const s of samples) {
          rows.push({
            ...row,
            'Sample Sample Id Name': s.sample_id_name,
            'Sample Label': s.label,
            'Sample Sample Description': s.sample_description,
            'Sample Sample Notes': s.sample_notes,
            'Sample Main Sampling Purpose': s.main_sampling_purpose,
          });
        }
      } else {
        rows.push(row);
      }
    }
  }

  return rows;
}

/**
 * Columna `Type`, que es por la que categoriza la simbología estructural.
 * Comparación literal a propósito: ver la nota de cabecera.
 */
export function processType(row) {
  const planar = row['Planar Orientation Planar Feature Type'] || '';
  const fault = row['Planar Orientation Fault Or Sz Type'] || '';
  const other = row['Planar Orientation Other Feature'] || '';

  if (planar === 'fault' && !isMissing(fault) && fault !== 'other') return `${planar} ${fault}`;
  if (planar === 'other' && !isMissing(other)) return other;
  if (!isMissing(planar)) return planar;
  return '';
}

const toNumber = (v) => {
  if (isMissing(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** El azimut del buzamiento: perpendicular al rumbo, regla de la mano derecha. */
const azimuth = (strike) => {
  const s = toNumber(strike);
  return s === null ? null : (s + 90) % 360;
};

/** Sentido de movimiento, solo si hay estría medida. */
export function senseOfSlip(row) {
  if (isMissing(row.Trend)) return '';
  const tipo = String(row.Type || '').toLowerCase();
  if (tipo.includes('fault normal')) return 'N';
  if (tipo.includes('fault thrust') || tipo.includes('fault reverse')) return 'T';
  if (tipo.includes('fault sinistral')) return 'L';
  if (tipo.includes('fault dextral')) return 'R';
  return '';
}

const isEstructuraRow = (row) =>
  !isMissing(row['Planar Orientation Planar Feature Type']) ||
  !isMissing(row['Linear Orientation Trend']) ||
  !isMissing(row['Planar Orientation Strike']);

/** La unidad sale de los tags del proyecto asignados al spot. */
const extractUnit = (row) => {
  const tags = row.__tags__;
  if (Array.isArray(tags)) return tags.length ? tags[0] : '';
  return tags ? String(tags) : '';
};

const sampleCode = (row) => {
  const code = row['Sample Sample Id Name'];
  return isMissing(code) ? row['Sample Label'] || '' : code;
};

export const ESTRUCTURAS_COLUMNS = [
  'Name', 'Date', 'Unit', 'Notes', 'Latitude', 'Longitude', 'Altitude',
  'Type', 'Strike', 'Azimuth', 'Dip', 'Quality', 'Trend', 'Plunge',
  'Indicators', 'Structure notes', 'Field', 'Geologist', 'Sense of slip',
];

export const OBSERVACION_COLUMNS = [
  'Name', 'Date', 'Unit', 'Notes', 'Latitude', 'Longitude', 'Altitude',
  'Sample Code', 'Sample Description', 'Purpose', 'Process', 'Field', 'Geologist',
];

export function buildEstructuras(rows, { field = '', geologist = '' } = {}) {
  const out = [];
  for (const raw of rows) {
    if (!isEstructuraRow(raw)) continue;
    const strike = raw['Planar Orientation Strike'];
    const record = {
      Name: raw.Name,
      Date: raw.Date,
      Unit: extractUnit(raw),
      Notes: raw.Notes || '',
      Latitude: toNumber(raw.Latitude),
      Longitude: toNumber(raw.Longitude),
      Altitude: toNumber(raw['Altitude(m)']),
      Type: processType(raw),
      Strike: toNumber(strike),
      Azimuth: azimuth(strike),
      Dip: toNumber(raw['Planar Orientation Dip']),
      Quality: raw['Planar Orientation Quality'] || '',
      Trend: toNumber(raw['Linear Orientation Trend']),
      Plunge: toNumber(raw['Linear Orientation Plunge']),
      Indicators: raw['Planar Orientation Directional Indicators'] || '',
      'Structure notes': raw['Planar Orientation Notes'] || '',
      Field: field,
      Geologist: geologist,
    };
    record['Sense of slip'] = senseOfSlip(record);
    out.push(record);
  }
  return out;
}

/**
 * Observación descarta los puntos de paso: una fila sin notas, sin código de
 * muestra y sin unidad no aporta nada al mapa. Es el mismo filtro del plugin.
 */
export function buildObservacion(rows, { field = '', geologist = '' } = {}) {
  const out = [];
  const vistos = new Set();

  for (const raw of rows) {
    const code = sampleCode(raw);
    const unit = extractUnit(raw);
    const notes = raw.Notes || '';
    if (isMissing(notes) && isMissing(code) && isMissing(unit)) continue;

    const record = {
      Name: raw.Name,
      Date: raw.Date,
      Unit: unit,
      Notes: notes,
      Latitude: toNumber(raw.Latitude),
      Longitude: toNumber(raw.Longitude),
      Altitude: toNumber(raw['Altitude(m)']),
      'Sample Code': code || '',
      'Sample Description': raw['Sample Sample Description'] || '',
      Purpose: raw['Sample Main Sampling Purpose'] || '',
      Process: raw.Process || '',
      Field: field,
      Geologist: geologist,
    };

    // Un spot con varias mediciones estructurales genera varias filas crudas
    // con los mismos datos de observación; aquí interesa el punto, no la
    // medición, así que se deduplica.
    const key = `${record.Name}|${record.Latitude}|${record.Longitude}|${record['Sample Code']}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    out.push(record);
  }
  return out;
}

/** Convierte las filas en GeoJSON de puntos, listo para MapLibre. */
export function rowsToGeoJSON(rows) {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter((r) => Number.isFinite(r.Longitude) && Number.isFinite(r.Latitude))
      .map((r, i) => ({
        type: 'Feature',
        id: i,
        properties: r,
        geometry: { type: 'Point', coordinates: [r.Longitude, r.Latitude] },
      })),
  };
}

/**
 * Líneas y polígonos de un dataset, con las columnas que usa el plugin para
 * esas capas. Se devuelven como GeoJSON tal cual: la geometría ya viene bien.
 */
export const LINEAS_POLIGONOS_COLUMNS = ['Name', 'Date', 'Unit', 'Notes', 'Type', 'Field', 'Geologist'];

export function buildLineasPoligonos(features, { field = '', geologist = '' } = {}) {
  return (features || [])
    .filter((f) => f.geometry && f.geometry.coordinates)
    .map((f, i) => {
      const p = f.properties || {};
      return {
        type: 'Feature',
        id: `sp-${i}`,
        properties: {
          Name: p.name || '',
          Date: p.date || p.time || '',
          Unit: '',
          Notes: p.notes || '',
          Type: p.type || '',
          Field: field,
          Geologist: geologist,
        },
        geometry: f.geometry,
      };
    });
}
