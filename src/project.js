import * as store from './store.js';
import { downloadBlob } from './persistence.js';
import { certaintyFor } from './symbology.js';
import { CONTROL_POINT_KIND, withSamples } from './controlPoints.js';
import { buildZip, readZip } from './zip.js';
import { gzipText, readMaybeGzipText, stringifyCompact } from './compact.js';

/**
 * Proyectos de FieldDraw: un único JSON con el dibujo, las unidades, la
 * simbología y los ajustes.
 *
 * El `.fdproj.json` NO guarda las capas importadas (GeoPackage, con sus
 * puntos de control y datos estructurales) ni los mapas offline: son archivos
 * de cientos de MB, y meterlos dentro convertiría un proyecto de 40 KB en uno
 * de 2 GB. Para llevar todo a otro dispositivo está el PAQUETE
 * (`.fdproj.zip`, ver `buildProjectPackage`): el mismo JSON, cada capa
 * importada en su propio archivo, y los PMTiles/MBTiles y el DEM sin
 * recomprimir.
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
    structureStyle: st.structureStyle,
    controlPointStyle: st.controlPointStyle,
    importStyle: st.importStyle,
    settings: store.currentSettings(),
    layers: store.currentLayerState(),
    // Los datasets de StraboSpot sí viajan, a diferencia de las capas
    // importadas: son el trabajo del resto del proyecto, pesan lo que una
    // libreta y sin señal no hay cómo volver a bajarlos.
    straboDatasets: store.currentStraboDatasets(),
    // Perfiles estructurales guardados, con sus dibujos.
    sections: store.getState().savedSections,
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

/**
 * El proyecto listo para escribir: JSON con las coordenadas a 7 decimales y
 * comprimido con gzip (`.fdproj.json.gz`, ~¼ del tamaño). Si el navegador no
 * sabe comprimir, sale el `.fdproj.json` de siempre.
 *
 * El `.gz` sigue siendo el mismo JSON: cualquier herramienta lo descomprime,
 * y «Open project» abre los dos.
 *
 * @returns {Promise<{data: object, blob: Blob, filename: string, gzip: boolean, plainBytes: number}>}
 */
export async function projectFile(name = '') {
  const data = serializeProject(name);
  const text = stringifyCompact(data);
  const { blob, gzip } = await gzipText(text);
  const filename = projectFilename(name) + (gzip ? '.gz' : '');
  return { data, blob, filename, gzip, plainBytes: text.length };
}

export async function saveProject(name = '') {
  const out = await projectFile(name);
  downloadBlob(out.blob, out.filename);
  return out;
}

/** El texto de un `.fdproj.json`, comprimido o no (se mira la firma, no el nombre). */
export function readProjectText(file) {
  return readMaybeGzipText(file);
}

/** Nombre del JSON dentro del paquete. */
const PACKAGE_PROJECT = 'project.fdproj.json';

export function packageFilename(name = '') {
  return projectFilename(name).replace(/\.json$/, '.zip');
}

/** Nombre de archivo seguro dentro del ZIP. */
const seguro = (txt, vacio) => String(txt || vacio).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || vacio;

/**
 * Paquete de proyecto: el proyecto más TODO lo que el `.fdproj.json` deja
 * fuera — las capas importadas (GeoPackage: puntos de control, datos
 * estructurales, contactos…), los mapas offline y el DEM.
 *
 * Las capas importadas van cada una en su archivo (`layers/…json`) y no dentro
 * del JSON del proyecto: así el proyecto sigue siendo pequeño y legible, y una
 * capa de decenas de MB no obliga a parsear todo de golpe.
 *
 * @param {string} name
 * @param {{role: 'tiles'|'dem', name: string, file: Blob}[]} files
 * @param {(hechos: number, total: number) => void} [onProgress]
 * @param {{imported?: object[]}} [opts] capas importadas; por omisión las del store
 * @returns {Promise<{data: object, blob: Blob}>}
 */
export async function buildProjectPackage(name, files, onProgress, { imported } = {}) {
  const data = serializeProject(name);
  const capas = Array.isArray(imported) ? imported : store.getState().imported;
  const usados = new Set();
  const unico = (carpeta, base) => {
    let path = `${carpeta}/${base}`;
    for (let i = 2; usados.has(path); i++) path = `${carpeta}/${i}-${base}`;
    usados.add(path);
    return path;
  };
  const dentro = files.map((f) => ({
    path: unico('files', seguro(f.name, 'file')),
    role: f.role,
    name: f.name,
    file: f.file,
  }));
  const capasDentro = capas.map((l, i) => ({
    path: unico('layers', `${seguro(l.label || l.table || l.id, `layer-${i}`)}.json`),
    id: l.id,
    label: l.label,
    blob: new Blob([stringifyCompact(l)], { type: 'application/json' }),
  }));
  data.offlineFiles = dentro.map(({ path, role, name: n }) => ({ path, role, name: n }));
  data.importedLayers = capasDentro.map(({ path, id, label }) => ({ path, id, label }));
  const blob = await buildZip(
    [
      {
        name: PACKAGE_PROJECT,
        blob: new Blob([stringifyCompact(data)], { type: 'application/json' }),
        // El texto va comprimido; los mapas y el DEM, tal cual (ver zip.js).
        deflate: true,
      },
      ...capasDentro.map((e) => ({ name: e.path, blob: e.blob, deflate: true })),
      ...dentro.map((e) => ({ name: e.path, blob: e.file })),
    ],
    onProgress,
  );
  return { data, blob };
}

/**
 * Abre un paquete: el texto del proyecto, sus capas importadas y sus archivos
 * (cada uno como un `File` que es un trozo del ZIP: no se copia nada a
 * memoria).
 *
 * @returns {Promise<{text: string, files: {role: string, name: string, file: File}[], importedLayers: object[], warnings: string[]}>}
 */
export async function readProjectPackage(zipFile) {
  const entries = await readZip(zipFile);
  const porNombre = new Map(entries.map((e) => [e.name, e]));
  const proj =
    porNombre.get(PACKAGE_PROJECT) ||
    entries.find((e) => /\.(fdproj\.json|fdproj|json)$/i.test(e.name) && !/^(files|layers)\//.test(e.name));
  if (!proj || !proj.blob) throw new Error('the ZIP holds no FieldDraw project');
  const text = await proj.blob.text();
  let manifest = [];
  let manifestCapas = [];
  try {
    const raw = JSON.parse(text);
    manifest = raw.offlineFiles || [];
    manifestCapas = raw.importedLayers || [];
  } catch {
    manifest = [];
  }
  const warnings = [];
  const files = [];
  for (const m of Array.isArray(manifest) ? manifest : []) {
    const e = m && porNombre.get(m.path);
    if (!e || !e.blob) {
      warnings.push(`${(m && m.name) || 'A file'} is listed but missing or compressed in the package.`);
      continue;
    }
    const role = m.role === 'dem' ? 'dem' : 'tiles';
    const nombre = m.name || e.name.replace(/^files\//, '');
    files.push({ role, name: nombre, file: new File([e.blob], nombre) });
  }
  const importedLayers = [];
  for (const m of Array.isArray(manifestCapas) ? manifestCapas : []) {
    const e = m && porNombre.get(m.path);
    const nombre = (m && (m.label || m.id)) || 'An imported layer';
    if (!e || !e.blob) {
      warnings.push(`${nombre} is listed but missing or compressed in the package.`);
      continue;
    }
    try {
      const capa = JSON.parse(await e.blob.text());
      if (!capa || !capa.id || !capa.geojson || !Array.isArray(capa.geojson.features)) {
        throw new Error('not a layer');
      }
      importedLayers.push(capa);
    } catch {
      warnings.push(`${nombre} could not be read from the package.`);
    }
  }
  return { text, files, importedLayers, warnings };
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
      structureStyle: raw.structureStyle || null,
      controlPointStyle: raw.controlPointStyle || null,
      importStyle: raw.importStyle || null,
      settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : null,
      layers: Array.isArray(raw.layers) ? raw.layers : null,
      straboDatasets: Array.isArray(raw.straboDatasets) ? raw.straboDatasets : null,
      sections: Array.isArray(raw.sections) ? raw.sections : null,
    },
    warnings,
  };
}

/**
 * Descarta lo que no sepamos dibujar y garantiza que cada elemento tenga id:
 * sin id, la selección y la edición de vértices no tienen a qué agarrarse.
 */
const KIND_BY_GEOMETRY = { Polygon: 'polygon', LineString: 'line', Point: 'point' };

function sanitizeFeatures(list, warnings) {
  const out = [];
  let descartados = 0;
  let sinId = 0;
  let sinMedida = 0;
  for (const f of list) {
    const g = f && f.geometry;
    if (!g || !KIND_BY_GEOMETRY[g.type] || !Array.isArray(g.coordinates)) {
      descartados++;
      continue;
    }
    const props = { ...(f.properties || {}) };
    if (!props.id) {
      props.id = `imp-${out.length}-${Math.random().toString(36).slice(2, 8)}`;
      sinId++;
    }
    if (!props.kind) props.kind = KIND_BY_GEOMETRY[g.type];

    /*
     * Un punto sin rumbo ni manteo no es una medida estructural, y dibujarlo
     * con el símbolo de estratificación afirmaría una orientación inventada.
     * Se descarta en vez de admitirlo: es lo único que puede llegar aquí desde
     * un GeoJSON ajeno con geometría de punto.
     */
    if (g.type === 'Point') {
      /*
       * Un punto de control no lleva rumbo ni manteo —es dónde se estuvo, no
       * cómo estaba orientado el plano— así que la exigencia de abajo lo
       * borraría entero al abrir el proyecto. Sus campos se normalizan a texto
       * porque un JSON editado a mano puede traer números o nulos donde la
       * interfaz espera cadenas.
       */
      if (props.geomKind === CONTROL_POINT_KIND) {
        for (const k of ['name', 'sampleId', 'sampleDescription', 'purpose', 'note']) {
          props[k] = props[k] === undefined || props[k] === null ? '' : String(props[k]);
        }
        // La lista de muestras, si la trae, manda: los campos sueltos se
        // recalculan como su resumen para que no puedan contradecirla.
        if (props.samples !== undefined) {
          Object.assign(props, withSamples(props, Array.isArray(props.samples) ? props.samples : []));
        }
        props.certainty = 'observed';
        out.push({ type: 'Feature', id: props.id, properties: props, geometry: g });
        continue;
      }
      if (!Number.isFinite(Number(props.strike)) || !Number.isFinite(Number(props.dip))) {
        sinMedida++;
        continue;
      }
      props.geomKind = 'measurement';
      props.strike = Number(props.strike);
      props.dip = Number(props.dip);
      props.certainty = 'observed';
      out.push({ type: 'Feature', id: props.id, properties: props, geometry: g });
      continue;
    }

    // La certeza se normaliza contra el tipo: un eje de pliegue con "inferido"
    // —de un proyecto viejo o de otra herramienta— no tiene capa donde caer.
    props.certainty = certaintyFor(props.type, props.certainty || 'observed');
    out.push({ type: 'Feature', id: props.id, properties: props, geometry: g });
  }
  if (sinMedida) {
    warnings.push(`${sinMedida} point(s) with no strike/dip were skipped: they are not measurements.`);
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
