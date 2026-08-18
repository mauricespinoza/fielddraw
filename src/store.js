import { BASEMAPS } from './basemaps.js';
import {
  FLIPPABLE_ORNAMENT_TYPES,
  POLYGON_TYPES,
  certaintyFor,
  defaultOrnaments,
  sanitizeOrnaments,
} from './symbology.js';
import { defaultStraboStyle, sanitizeStraboStyle } from './strabo/style.js';

/** Unidades sembradas para que la paleta no arranque vacía. */
const DEFAULT_CODES = {
  'intrusive-unit': 'INT',
  'volcanic-unit': 'VOL',
  'sedimentary-unit': 'SED',
  'metamorphic-unit': 'MET',
  'quaternary-cover': 'Q',
  'alteration-zone': 'ALT',
};

function defaultUnits() {
  return POLYGON_TYPES.map((t) => ({
    id: t.id,
    name: t.label,
    code: DEFAULT_CODES[t.id] || '',
    color: t.color,
  }));
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * El array va de arriba hacia abajo tal como se ve en el panel: el índice 0 se
 * dibuja encima de todo. MapLibre pinta al revés, así que mapView lo invierte.
 */
function defaultLayers() {
  return [
    { id: 'geology', kind: 'geology', label: 'Geology (drawing)', visible: true, opacity: 1 },
    { id: 'contours', kind: 'contours', label: 'Contour lines', visible: true, opacity: 0.85 },
    ...BASEMAPS.map((b) => ({
      id: b.id,
      kind: 'basemap',
      label: b.label,
      visible: b.id === 'esri-imagery',
      opacity: 1,
    })),
  ];
}

const listeners = new Set();

/** Qué cambió en el último `set`, para que la UI actualice solo lo necesario. */
let lastChanged = new Set();

let state = {
  tool: 'navigate',
  lineType: 'stratigraphic-contact',
  polygonType: 'sedimentary-unit',
  certainty: 'observed',

  freehandMode: 'hold',
  fingerDraw: true,
  smoothing: true,
  tolerance: 2,

  snapEnabled: true,
  snapTolerance: 14,
  traceEnabled: false,
  /**
   * Radio propio del trace, en px. Va suelto del snapping porque son dos cosas
   * distintas: enganchar un vértice quiere precisión, y agarrar el borde por el
   * que se va a trazar quiere holgura.
   */
  traceTolerance: 22,
  /** Al mover un vértice compartido, arrastra también el del vecino. */
  topoEdit: true,
  /** Tolerancia de la confirmación topológica, en metros de terreno. */
  topoTolerance: 5,
  /** Herramienta Nodos: 'move' | 'add' | 'delete'. */
  vertexMode: 'move',
  /** Cortar dibujando una línea, o usando un elemento que ya existe. */
  cutSource: 'draw',
  /** Parámetros de los ornamentos de falla (tamaño, espaciado, posición). */
  ornaments: defaultOrnaments(),

  features: [],
  draft: null,
  layers: defaultLayers(),
  /** Capas traídas de un GeoPackage: {id, table, label, kind, geojson, style} */
  imported: [],
  /** Mapas offline MBTiles/PMTiles: descriptores de ./tiles.js */
  tileSets: [],
  /** Ids de elementos seleccionados, para cortar y unir. */
  selection: [],
  /** Línea de corte recién terminada, a la espera de que se aplique. */
  pendingCut: null,
  /** Unidades geológicas definidas por el usuario. */
  units: defaultUnits(),
  /** Línea que se va a continuar en cuanto se ponga el primer vértice. */
  extendFrom: null,

  /**
   * Datos traídos de StraboSpot: {datasetId, datasetName, estructuras,
   * observacion, lineas} con las tres colecciones ya en GeoJSON.
   */
  strabo: null,
  /**
   * Escala del icono de las capas de StraboSpot. Independiente de los
   * ornamentos de falla propios: son símbolos ajenos, importados, y quien los
   * mira quiere poder agrandarlos sin tocar la simbología del dibujo propio.
   */
  straboStyle: defaultStraboStyle(),
  /**
   * Valores visibles por campo categórico, uno por capa de StraboSpot. `null`
   * significa "todos visibles" — es el estado por omisión y el que se recupera
   * al vaciar la selección, para no dejar al usuario con un filtro vacío que
   * parece que la capa desapareció.
   */
  straboFilters: { structures: null, observations: null, lines: null },
};

/* ---------- historial ---------- */

const HISTORY_LIMIT = 60;
let past = [];
let future = [];

/**
 * El historial guarda referencias al array de features, no copias: como cada
 * mutación crea un array nuevo, un snapshot cuesta lo que una referencia.
 */
export function pushHistory() {
  pushHistorySnapshot(state.features);
}

/**
 * Guarda un snapshot explícito, que puede no ser el estado actual. Lo usa la
 * edición de vértices: solo al soltar se sabe si el arrastre cambió algo, y
 * para entonces el estado ya se movió, así que hay que archivar el de antes.
 */
export function pushHistorySnapshot(features) {
  past.push(features);
  if (past.length > HISTORY_LIMIT) past.shift();
  future = [];
}

/** Corta el historial: lo que había antes deja de ser alcanzable. */
export function resetHistory() {
  past = [];
  future = [];
}

export function canUndo() {
  return past.length > 0;
}

export function canRedo() {
  return future.length > 0;
}

export function undo() {
  if (past.length === 0) return false;
  future.push(state.features);
  const features = past.pop();
  set({ features, draft: null, selection: [] });
  return true;
}

export function redo() {
  if (future.length === 0) return false;
  past.push(state.features);
  const features = future.pop();
  set({ features, draft: null, selection: [] });
  return true;
}

const geomKindForTool = (tool) =>
  tool === 'polygon' ? 'polygon' : tool === 'cut' ? 'cut' : 'line';

export function getState() {
  return state;
}

export function changed(key) {
  return lastChanged.has(key);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  if (!next) return;
  const keys = Object.keys(next);
  const dirty = keys.filter((k) => next[k] !== state[k]);
  if (dirty.length === 0) return;
  state = { ...state, ...next };
  lastChanged = new Set(dirty);
  for (const fn of listeners) fn(state);
}

/* ---------- herramientas ---------- */

export function setTool(tool) {
  // Con una sola línea seleccionada, pasar a Línea la continúa en vez de
  // empezar una nueva. Se resuelve al poner el primer vértice, que es cuando
  // se sabe por qué extremo seguir.
  let extendFrom = null;
  if (tool === 'line' && state.selection.length === 1) {
    const sel = state.features.find((f) => f.properties.id === state.selection[0]);
    if (sel && sel.geometry.type === 'LineString') extendFrom = sel.properties.id;
  }

  if (state.draft) {
    // Cambiar de herramienta cierra lo abierto, como en QGIS. Una línea de
    // corte a medias se descarta: aplicarla sin querer sería destructivo.
    if (state.draft.kind === 'cut') cancelDraft();
    else finishDraft();
  }
  // La selección sobrevive al pasar a Vértices, Cortar o a extender una
  // línea: en los tres casos define sobre qué se va a operar.
  if (!['select', 'vertices', 'cut'].includes(tool) && !extendFrom) set({ selection: [] });
  set({ tool, extendFrom });
}

/**
 * Elegir un tipo con certeza acotada (los pliegues) baja también la certeza
 * activa a observado, en vez de dejar en la paleta una combinación que después
 * no se va a poder dibujar.
 */
export const setLineType = (lineType) =>
  set({ lineType, certainty: certaintyFor(lineType, state.certainty) });
export const setPolygonType = (polygonType) => set({ polygonType });
export const setCertainty = (certainty) =>
  set({ certainty: certaintyFor(state.lineType, certainty) });
export const setFreehandMode = (freehandMode) => set({ freehandMode });
export const setFingerDraw = (fingerDraw) => set({ fingerDraw });
export const setSmoothing = (smoothing) => set({ smoothing });
export const setTolerance = (tolerance) => set({ tolerance });
export const setSnapEnabled = (snapEnabled) => set({ snapEnabled });
export const setTopoEdit = (topoEdit) => set({ topoEdit });
export const setTopoTolerance = (topoTolerance) => set({ topoTolerance });
export const setCutSource = (cutSource) => set({ cutSource });
export const setSnapTolerance = (snapTolerance) => set({ snapTolerance });
export const setTraceTolerance = (traceTolerance) => set({ traceTolerance });
export const setVertexMode = (vertexMode) => set({ vertexMode });

/* ---------- simbología de ornamentos ---------- */

export function setOrnament(type, patch) {
  const current = state.ornaments[type];
  if (!current) return;
  set({ ornaments: { ...state.ornaments, [type]: { ...current, ...patch } } });
}

export function setOrnaments(ornaments) {
  set({ ornaments: sanitizeOrnaments(ornaments) });
}

export function resetOrnaments() {
  set({ ornaments: defaultOrnaments() });
}

const FLIPPABLE = new Set(FLIPPABLE_ORNAMENT_TYPES);

/**
 * Refleja el ornamento respecto de la traza en los elementos seleccionados.
 *
 * Solo cuenta y toca los tipos que llevan un ornamento asimétrico: un contacto
 * no tiene nada que voltear, y las flechas de un pliegue son simétricas
 * respecto del eje, así que reflejarlas devuelve el mismo dibujo.
 */
export function flipSelectedOrnament() {
  if (state.selection.length === 0) return 0;
  pushHistory();
  const ids = new Set(state.selection);
  let n = 0;
  const features = state.features.map((f) => {
    if (!ids.has(f.properties.id) || !FLIPPABLE.has(f.properties.type)) return f;
    n++;
    return { ...f, properties: { ...f.properties, flip: !f.properties.flip } };
  });
  set({ features });
  return n;
}
/** Trazar exige snapping: sin él no hay geometría a la que engancharse. */
export const setTraceEnabled = (traceEnabled) =>
  set(traceEnabled ? { traceEnabled, snapEnabled: true } : { traceEnabled });

/* ---------- digitalización ---------- */

export function addVertex(p) {
  if (state.tool === 'navigate' || state.tool === 'select') return;

  // Continuación de una línea existente: se saca del mapa, se orienta para
  // que el extremo más cercano al toque quede al final, y pasa a ser el
  // borrador. Así se sigue dibujando donde se dejó.
  if (state.extendFrom && !state.draft) {
    const src = state.features.find((f) => f.properties.id === state.extendFrom);
    if (src && src.geometry.type === 'LineString') {
      pushHistory();
      const coords = src.geometry.coordinates;
      const dStart = Math.hypot(coords[0][0] - p[0], coords[0][1] - p[1]);
      const dEnd = Math.hypot(coords.at(-1)[0] - p[0], coords.at(-1)[1] - p[1]);
      const oriented = dStart < dEnd ? coords.slice().reverse() : coords.slice();
      set({
        features: state.features.filter((f) => f.properties.id !== state.extendFrom),
        draft: { kind: 'line', coords: [...oriented, p], extendedFrom: src.properties },
        extendFrom: null,
        selection: [],
      });
      return;
    }
    set({ extendFrom: null });
  }

  const draft = state.draft || { kind: geomKindForTool(state.tool), coords: [] };
  set({ draft: { ...draft, coords: [...draft.coords, p] } });
}

export function appendStroke(pts) {
  if (state.tool === 'navigate' || state.tool === 'select' || pts.length === 0) return;
  const draft = state.draft || { kind: geomKindForTool(state.tool), coords: [] };
  set({ draft: { ...draft, coords: [...draft.coords, ...pts] } });
}

export function undoVertex() {
  if (!state.draft) return;
  const coords = state.draft.coords.slice(0, -1);
  set({ draft: coords.length ? { ...state.draft, coords } : null });
}

export function cancelDraft() {
  set({ draft: null });
}

export function finishDraft() {
  const d = state.draft;
  if (!d) return;

  // La línea de corte no es un elemento del mapa: se publica como trabajo
  // pendiente para que la capa de aplicación (que sí puede cargar JSTS) la use.
  if (d.kind === 'cut') {
    set({
      draft: null,
      pendingCut: d.coords.length >= 2 ? { type: 'coords', coords: d.coords } : null,
    });
    return;
  }

  const minPts = d.kind === 'polygon' ? 3 : 2;
  if (d.coords.length < minPts) {
    set({ draft: null });
    return;
  }
  const id = newId();
  // Al continuar una línea existente se heredan sus atributos.
  const inherited = d.extendedFrom || {};
  const common = {
    ...inherited,
    id,
    kind: d.kind,
    // Provisional: en una línea el tipo definitivo se resuelve más abajo
    // (heredado o el de la paleta), y con él se reajusta la certeza.
    certainty: inherited.certainty ?? state.certainty,
    opacity: inherited.opacity ?? 1,
    createdAt: Date.now(),
  };

  let feature;
  if (d.kind === 'polygon') {
    const unit = state.units.find((u) => u.id === state.polygonType);
    feature = {
      type: 'Feature',
      id,
      properties: {
        ...common,
        type: state.polygonType,
        unit: unit ? unit.name : '',
        code: unit ? unit.code : '',
      },
      geometry: { type: 'Polygon', coordinates: [[...d.coords, d.coords[0]]] },
    };
  } else {
    const type = inherited.type ?? state.lineType;
    feature = {
      type: 'Feature',
      id,
      properties: { ...common, type, certainty: certaintyFor(type, common.certainty) },
      geometry: { type: 'LineString', coordinates: d.coords },
    };
  }

  pushHistory();
  set({ features: [...state.features, feature], draft: null });
}

export function deleteLastFeature() {
  if (state.features.length === 0) return;
  pushHistory();
  set({ features: state.features.slice(0, -1) });
}

/* ---------- selección, cortar y unir ---------- */

export function toggleSelection(id) {
  const selection = state.selection.includes(id)
    ? state.selection.filter((x) => x !== id)
    : [...state.selection, id];
  set({ selection });
}

export function clearSelection() {
  set({ selection: [] });
}

export function setSelection(ids) {
  set({ selection: Array.from(new Set(ids)) });
}

export function selectedFeatures() {
  const ids = new Set(state.selection);
  return state.features.filter((f) => ids.has(f.properties.id));
}

export function clearPendingCut() {
  set({ pendingCut: null });
}

/** Usar un elemento ya existente como cortador, en vez de dibujar la línea. */
export function requestCutByFeature(id) {
  set({ pendingCut: { type: 'feature', id } });
}

/** Reemplaza la geometría completa; lo usa la edición de vértices. */
export function setFeatures(features) {
  set({ features });
}

export function deleteSelected() {
  if (state.selection.length === 0) return;
  pushHistory();
  const ids = new Set(state.selection);
  set({ features: state.features.filter((f) => !ids.has(f.properties.id)), selection: [] });
}

/** Sustituye un conjunto de elementos por otro, en una sola operación. */
export function replaceFeatures(removedIds, added) {
  pushHistory();
  const ids = new Set(removedIds);
  set({
    features: [...state.features.filter((f) => !ids.has(f.properties.id)), ...added],
    selection: [],
  });
}

/* ---------- atributos de la selección ---------- */

/**
 * Aplica un cambio de propiedades a todos los elementos seleccionados.
 *
 * La certeza se filtra por tipo: en una selección mixta, poner "inferido"
 * afecta a los contactos y deja los ejes de pliegue como estaban, en vez de
 * escribirles un valor que su simbología no admite.
 */
export function updateSelectedProps(patch) {
  if (state.selection.length === 0) return;
  pushHistory();
  const ids = new Set(state.selection);
  set({
    features: state.features.map((f) => {
      if (!ids.has(f.properties.id)) return f;
      const props = { ...f.properties, ...patch };
      if (patch.certainty !== undefined) {
        props.certainty = certaintyFor(props.type, props.certainty);
      }
      return { ...f, properties: props };
    }),
  });
}

/** Asigna una unidad a los polígonos seleccionados (nombre y código). */
export function assignUnitToSelection(unitId) {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit || state.selection.length === 0) return;
  pushHistory();
  const ids = new Set(state.selection);
  set({
    features: state.features.map((f) =>
      ids.has(f.properties.id) && f.geometry.type === 'Polygon'
        ? {
            ...f,
            properties: { ...f.properties, type: unit.id, unit: unit.name, code: unit.code },
          }
        : f,
    ),
  });
}

/** Reemplaza la geometría de los seleccionados aplicando una función. */
export function transformSelectedGeometry(fn) {
  if (state.selection.length === 0) return;
  pushHistory();
  const ids = new Set(state.selection);
  set({
    features: state.features.map((f) => {
      if (!ids.has(f.properties.id)) return f;
      const geometry = fn(f.geometry);
      return geometry ? { ...f, geometry } : f;
    }),
  });
}

/* ---------- unidades ---------- */

export function addUnit({ name, code, color }) {
  const unit = { id: newId(), name: name || 'Unidad sin nombre', code: code || '', color: color || '#9e9e9e' };
  set({ units: [...state.units, unit] });
  return unit;
}

export function updateUnit(id, patch) {
  const units = state.units.map((u) => (u.id === id ? { ...u, ...patch } : u));
  const unit = units.find((u) => u.id === id);
  // Los polígonos guardan nombre y código denormalizados para la exportación,
  // así que hay que propagarles el cambio.
  const features = state.features.map((f) =>
    f.properties.type === id && f.geometry.type === 'Polygon'
      ? { ...f, properties: { ...f.properties, unit: unit.name, code: unit.code } }
      : f,
  );
  set({ units, features });
}

export function removeUnit(id) {
  if (state.units.length <= 1) return;
  const units = state.units.filter((u) => u.id !== id);
  set({ units, polygonType: state.polygonType === id ? units[0].id : state.polygonType });
}

export function loadUnits(units) {
  if (Array.isArray(units) && units.length) set({ units });
}

/** Clona los atributos de un elemento para las piezas derivadas de él. */
export function derivedFeature(source, geometry) {
  const id = newId();
  return {
    type: 'Feature',
    id,
    properties: { ...source.properties, id, createdAt: Date.now() },
    geometry,
  };
}

export function clearFeatures() {
  if (state.features.length) pushHistory();
  set({ features: [], draft: null, selection: [] });
}

export const setExtendFrom = (extendFrom) => set({ extendFrom });

/** Carga un conjunto de elementos como punto de partida: no se deshace más allá. */
export function loadFeatures(features) {
  resetHistory();
  set({ features, selection: [], draft: null });
}

/* ---------- proyectos ---------- */

/** Ajustes que viajan dentro de un proyecto. El resto es estado de sesión. */
export const SETTING_KEYS = [
  'lineType',
  'polygonType',
  'certainty',
  'freehandMode',
  'fingerDraw',
  'smoothing',
  'tolerance',
  'snapEnabled',
  'snapTolerance',
  'traceEnabled',
  'traceTolerance',
  'topoEdit',
  'topoTolerance',
  'cutSource',
];

export function currentSettings() {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = state[k];
  return out;
}

/** Visibilidad y opacidad de las capas propias, sin lo importado en la sesión. */
export function currentLayerState() {
  return state.layers
    .filter((l) => l.kind === 'geology' || l.kind === 'contours' || l.kind === 'basemap')
    .map((l) => ({ id: l.id, visible: l.visible, opacity: l.opacity }));
}

/**
 * Carga un proyecto completo en un solo `set`, para que la UI y el mapa se
 * repinten una vez. El historial se corta: deshacer no debe llevar de vuelta al
 * proyecto anterior.
 */
export function loadProject({ features, units, ornaments, settings, layers } = {}) {
  resetHistory();
  const patch = {
    features: Array.isArray(features) ? features : [],
    draft: null,
    selection: [],
    extendFrom: null,
    pendingCut: null,
  };
  if (Array.isArray(units) && units.length) patch.units = units;
  if (ornaments) patch.ornaments = sanitizeOrnaments(ornaments);
  if (settings) {
    for (const k of SETTING_KEYS) {
      if (settings[k] !== undefined) patch[k] = settings[k];
    }
  }
  if (Array.isArray(layers) && layers.length) {
    const saved = new Map(layers.map((l) => [l.id, l]));
    patch.layers = state.layers.map((l) => {
      const s = saved.get(l.id);
      if (!s) return l;
      return {
        ...l,
        visible: typeof s.visible === 'boolean' ? s.visible : l.visible,
        opacity: Number.isFinite(s.opacity) ? s.opacity : l.opacity,
      };
    });
  }
  set(patch);
}

/* ---------- capas ---------- */

export function setLayerVisible(id, visible) {
  set({ layers: state.layers.map((l) => (l.id === id ? { ...l, visible } : l)) });
}

export function setLayerOpacity(id, opacity) {
  set({ layers: state.layers.map((l) => (l.id === id ? { ...l, opacity } : l)) });
}

/* ---------- StraboSpot ---------- */

/**
 * Publica un dataset descargado y le añade su entrada en el panel de capas,
 * justo debajo del dibujo propio para no taparlo.
 */
export function setStraboData(data) {
  const layers = state.layers.filter((l) => l.kind !== 'strabo');
  if (data) {
    const at = layers.findIndex((l) => l.kind === 'geology') + 1;
    layers.splice(at, 0, {
      id: 'strabo',
      kind: 'strabo',
      label: `StraboSpot · ${data.datasetName}`,
      visible: true,
      opacity: 1,
    });
  }
  // Un dataset nuevo (o ninguno) puede no traer los mismos valores
  // categóricos que el anterior; un filtro heredado dejaría capas en blanco
  // sin explicación. Se resetea con cada cambio de datos, no solo al limpiar.
  set({ strabo: data, layers, straboFilters: { structures: null, observations: null, lines: null } });
}

export function clearStraboData() {
  setStraboData(null);
}

/** Fusiona un cambio parcial (deslizador) o un objeto completo (localStorage). */
export function setStraboStyle(patch) {
  set({ straboStyle: sanitizeStraboStyle({ ...state.straboStyle, ...patch }) });
}

export function resetStraboStyle() {
  set({ straboStyle: defaultStraboStyle() });
}

/** @param {'structures'|'observations'|'lines'} category
 *  @param {string[]|null} values null = sin filtro, todos visibles */
export function setStraboFilter(category, values) {
  set({ straboFilters: { ...state.straboFilters, [category]: values } });
}

/* ---------- capas importadas ---------- */

export function addImportedLayers(list) {
  if (!list.length) return;
  const stamp = Date.now().toString(36);
  const added = list.map((l, i) => ({ ...l, id: `gpkg-${stamp}-${i}` }));
  // Entran justo debajo del dibujo propio, para no taparlo.
  const entries = added.map((l) => ({
    id: l.id,
    kind: 'imported',
    label: l.label,
    visible: true,
    opacity: 1,
  }));
  const at = state.layers.findIndex((l) => l.kind === 'geology') + 1;
  const layers = state.layers.slice();
  layers.splice(at, 0, ...entries);
  set({ imported: [...state.imported, ...added], layers });
}

export function removeImported(id) {
  set({
    imported: state.imported.filter((l) => l.id !== id),
    layers: state.layers.filter((l) => l.id !== id),
  });
}

/* ---------- mapas offline ---------- */

export function addTileSet(descriptor) {
  const entry = {
    id: descriptor.id,
    kind: 'tiles',
    label: descriptor.label,
    visible: true,
    opacity: 1,
  };
  // Encima de los basemaps, debajo del dibujo y de lo importado.
  const at = state.layers.findIndex((l) => l.kind === 'basemap');
  const layers = state.layers.slice();
  layers.splice(at < 0 ? layers.length : at, 0, entry);
  set({ tileSets: [...state.tileSets, descriptor], layers });
}

export function removeTileSet(id) {
  set({
    tileSets: state.tileSets.filter((t) => t.id !== id),
    layers: state.layers.filter((l) => l.id !== id),
  });
}

export function moveLayer(id, dir) {
  const i = state.layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.layers.length) return;
  const layers = state.layers.slice();
  [layers[i], layers[j]] = [layers[j], layers[i]];
  set({ layers });
}
