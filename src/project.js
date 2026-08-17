import * as store from './store.js';
import { downloadBlob } from './persistence.js';

/**
 * Proyectos de FieldDraw: un único JSON con el dibujo, las unidades, la
 * simbología y los ajustes.
 *
 * Deliberadamente NO guarda las capas importadas ni los mapas offline: son
 * archivos de cientos de MB que viven en Archivos/Drive, y meterlos dentro
 * convertiría un proyecto de 40 KB en uno de 2 GB. Se vuelven a abrir con
 * Importar, que es el mismo gesto de siempre.
 *
 * El formato es GeoJSON válido por dentro (`features` es una lista de features),
 * así que un proyecto se puede inspeccionar con cualquier herramienta.
 */

export const PROJECT_FORMAT = 'fielddraw-project';
export const PROJECT_VERSION = 1;

export function serializeProject(name = '') {
  const st = store.getState();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: name || 'FieldDraw project',
    savedAt: new Date().toISOString(),
    features: st.features,
    units: st.units,
    ornaments: st.ornaments,
    settings: store.currentSettings(),
    layers: store.currentLayerState(),
  };
}

/** Nombre de archivo estable y ordenable: nombre + fecha. */
export function projectFilename(name = '') {
  const slug =
    (name || 'fielddraw')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'fielddraw';
  return `${slug}-${new Date().toISOString().slice(0, 10)}.fdproj.json`;
}

export function saveProject(name = '') {
  const data = serializeProject(name);
  downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), projectFilename(name));
  return data;
}

/**
 * Valida un proyecto leído de disco. Se acepta también un GeoJSON pelado: es
 * cómodo poder abrir lo que exportó otra herramienta sin convertirlo antes.
 *
 * @returns {{project: object, warnings: string[]}}
 */
export function parseProject(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`The file is not valid JSON (${err.message}).`);
  }
  if (!raw || typeof raw !== 'object') throw new Error('The file does not contain a project.');

  const warnings = [];

  // FeatureCollection suelto: se toma como el dibujo, sin ajustes.
  if (raw.type === 'FeatureCollection' && Array.isArray(raw.features)) {
    return {
      project: { features: sanitizeFeatures(raw.features, warnings) },
      warnings: [...warnings, 'That was a GeoJSON, not a project: only the geometry was loaded.'],
    };
  }

  if (raw.format !== PROJECT_FORMAT) {
    throw new Error('This file is not a FieldDraw project.');
  }
  if (Number(raw.version) > PROJECT_VERSION) {
    warnings.push(
      `This project comes from a newer version (v${raw.version}); something may not load.`,
    );
  }
  if (!Array.isArray(raw.features)) throw new Error('The project has no features.');

  return {
    project: {
      name: typeof raw.name === 'string' ? raw.name : '',
      features: sanitizeFeatures(raw.features, warnings),
      units: Array.isArray(raw.units) ? raw.units : null,
      ornaments: raw.ornaments || null,
      settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : null,
      layers: Array.isArray(raw.layers) ? raw.layers : null,
    },
    warnings,
  };
}

/**
 * Descarta lo que no sepamos dibujar y garantiza que cada elemento tenga id:
 * sin id, la selección y la edición de vértices no tienen a qué agarrarse.
 */
function sanitizeFeatures(list, warnings) {
  const out = [];
  let descartados = 0;
  let sinId = 0;
  for (const f of list) {
    const g = f && f.geometry;
    if (!g || (g.type !== 'LineString' && g.type !== 'Polygon') || !Array.isArray(g.coordinates)) {
      descartados++;
      continue;
    }
    const props = { ...(f.properties || {}) };
    if (!props.id) {
      props.id = `imp-${out.length}-${Math.random().toString(36).slice(2, 8)}`;
      sinId++;
    }
    if (!props.kind) props.kind = g.type === 'Polygon' ? 'polygon' : 'line';
    if (!props.certainty) props.certainty = 'observed';
    out.push({ type: 'Feature', id: props.id, properties: props, geometry: g });
  }
  if (descartados) warnings.push(`${descartados} feature(s) with unsupported geometry were skipped.`);
  if (sinId) warnings.push(`${sinId} feature(s) had no id: a new one was assigned.`);
  return out;
}

/** Carga un proyecto ya validado en el store. */
export function openProject(project) {
  store.loadProject(project);
  return project.features.length;
}
