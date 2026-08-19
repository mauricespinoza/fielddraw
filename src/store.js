import { BASEMAPS } from './basemaps.js';
import { DEFAULT_SCALES, clampScale, sanitizeScales } from './scale.js';
import {
  FLIPPABLE_ORNAMENT_TYPES,
  POLYGON_TYPES,
  certaintyFor,
  defaultOrnaments,
  defaultStructureStyle,
  sanitizeOrnaments,
  sanitizeStructureStyle,
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
    // Sombreado calculado del mismo DEM que las curvas. Apagado por omisión:
    // sobre imagen satelital compite con el relieve que ya se ve, y encendido
    // sin querer haría descargar teselas DEM que en terreno no hacen falta.
    { id: 'hillshade', kind: 'hillshade', label: 'Hillshade (DEM)', visible: false, opacity: 0.5 },
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

  /*
   * Escala de trabajo.
   *
   * `scaleLock` es el denominador al que el mapa queda fijado, o null para
   * navegar libre. Fijarla es lo que hace que un levantamiento salga con un
   * detalle homogéneo: sin ella se digitaliza un tramo muy de cerca y el
   * siguiente muy de lejos, y el mapa resultante no está a ninguna escala.
   */
  scaleLock: null,
  /** Escalas ofrecidas en el desplegable. El usuario puede añadir las suyas. */
  scalePresets: [...DEFAULT_SCALES],
  /** Tamaño supuesto del píxel de pantalla, en mm. Ver scale.js. */
  scalePixelMm: 0.28,

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
  /** Línea de reshape recién terminada, a la espera de que se aplique. */
  pendingReshape: null,
  /** Área dibujada para restarla a un polígono; la consume la interfaz. */
  pendingHole: null,
  /** Traza recién terminada de la que hay que calcular el perfil. */
  pendingProfile: null,
  /** Puntos recién marcados de los que hay que resolver rumbo y manteo. */
  pendingPlane: null,

  /* ---------- medidas estructurales ---------- */

  /** 'manual' | 'three-point' | 'plane-fit' (ver structure.js). */
  measureMethod: 'three-point',
  /** Superficie que se está midiendo: estratificación, foliación, diaclasa… */
  measureType: 'bedding',
  /** Estratos invertidos: cambia el símbolo, no el número. */
  measureOverturned: false,
  /** Valores de partida del método manual, que se editan tras colocarlo. */
  manualStrike: 0,
  manualDip: 30,
  /** Tamaño y etiquetas de los símbolos de rumbo/manteo. */
  structureStyle: defaultStructureStyle(),

  /* ---------- perfil topográfico ---------- */

  /**
   * De dónde salen las cotas: 'terrarium' son las mismas teselas que ya
   * alimentan las curvas de nivel —funciona sin señal sobre lo cacheado— y
   * 'opentopo' es Copernicus vía OpenTopography, que da mejor resolución pero
   * exige clave y red, así que en terreno no sirve.
   */
  profileSource: 'terrarium',
  /** Modelo pedido a OpenTopography cuando esa es la fuente. */
  opentopoDem: 'COP30',
  /** Clave de OpenTopography. Vive en el dispositivo, nunca en el proyecto. */
  opentopoKey: '',
  /** Puntos muestreados a lo largo de la traza. */
  profileSamples: 200,
  /** Perfil ya calculado que muestra el panel, o null si no hay ninguno. */
  profile: null,
  /** Índice de la muestra señalada en el gráfico, para marcarla en el mapa. */
  profileCursor: null,
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

  /* ---------- relieve 3D ---------- */

  /**
   * Terreno real, no solo inclinación de cámara. Es modo de VISUALIZACIÓN: con
   * el relieve puesto, el punto que se toca y el punto del terreno dejan de
   * coincidir como en planta, así que digitalizar en 3D produce geometría
   * desplazada sin que se note. Por eso activarlo devuelve a navegación y
   * bloquea las herramientas de dibujo (ver `drawingBlocked`).
   */
  terrain3d: false,
  /** Exageración vertical. 1 es el relieve real; más de 2 caricaturiza. */
  terrainExaggeration: 1.4,
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

const GEOM_KIND_FOR_TOOL = {
  polygon: 'polygon',
  hole: 'hole',
  cut: 'cut',
  reshape: 'reshape',
  profile: 'profile',
  // Los puntos que definen el plano; el método decide cuántos hacen falta.
  measure: 'plane',
};

const geomKindForTool = (tool) => GEOM_KIND_FOR_TOOL[tool] || 'line';

/**
 * Borradores que NO llegan a ser elementos del mapa: son una instrucción
 * (cortar, redibujar, perfilar) que se consume y desaparece. Cambiar de
 * herramienta con uno a medias lo descarta, porque aplicarlo sin querer sería
 * destructivo en los dos primeros casos y desconcertante en el tercero.
 */
const TRANSIENT_KINDS = new Set(['cut', 'reshape', 'profile', 'plane', 'hole']);

/**
 * Herramientas que crean o mueven geometría, y que por eso no se ofrecen con
 * el relieve 3D puesto: sobre terreno inclinado el punto tocado y el punto del
 * terreno no coinciden como en planta, así que lo dibujado saldría corrido.
 */
export const DRAWING_TOOLS = [
  'line',
  'polygon',
  'hole',
  'vertices',
  'cut',
  'reshape',
  'profile',
  'measure',
];

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

/** ¿Estamos dentro del recorrido de suscriptores de un `set`? */
let notifying = false;
/** Claves cambiadas por un `set` disparado DESDE un suscriptor. */
let queued = null;

/**
 * Corta un ciclo entre suscriptores. Dos que se contesten el uno al otro
 * colgarían el hilo principal —la app entera congelada, sin ningún error— así
 * que se para y se deja dicho dónde mirar, en vez de repartir el bloqueo entre
 * las funciones que después parecen no responder.
 */
const MAX_ROUNDS = 24;

function set(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  if (!next) return;
  const keys = Object.keys(next);
  const dirty = keys.filter((k) => next[k] !== state[k]);
  if (dirty.length === 0) return;
  state = { ...state, ...next };

  /*
   * Cambio disparado desde dentro de un suscriptor.
   *
   * NO se puede pisar `lastChanged` a mitad del recorrido: los suscriptores
   * que todavía no han corrido preguntarían por el cambio equivocado y se
   * saltarían el suyo. Era la vía por la que un aviso nacido en el mapa
   * —revertir el relieve 3D al fallar, por ejemplo— dejaba a la barra de
   * herramientas y al panel mostrando un estado que ya no era el vigente.
   *
   * Se encola y se emite en una ronda aparte, cuando la actual termine.
   */
  if (notifying) {
    if (!queued) queued = new Set();
    for (const k of dirty) queued.add(k);
    return;
  }

  let ronda = new Set(dirty);
  notifying = true;
  try {
    for (let i = 0; ronda; i++) {
      if (i >= MAX_ROUNDS) {
        console.warn('[store] ciclo entre suscriptores; se corta en:', [...ronda].join(', '));
        break;
      }
      lastChanged = ronda;
      // Copia: un suscriptor puede darse de baja mientras se recorre.
      for (const fn of [...listeners]) fn(state);
      ronda = queued;
      queued = null;
    }
  } finally {
    notifying = false;
    queued = null;
  }
}

/* ---------- herramientas ---------- */

export function setTool(tool) {
  // Con el relieve puesto no se digitaliza: se avisa y no se cambia nada. El
  // aviso lo da la interfaz, que es quien puede explicarlo.
  if (state.terrain3d && DRAWING_TOOLS.includes(tool)) return false;

  // Con una sola línea seleccionada, pasar a Línea la continúa en vez de
  // empezar una nueva. Se resuelve al poner el primer vértice, que es cuando
  // se sabe por qué extremo seguir.
  const extendFrom = tool === 'line' ? extendCandidate(state.selection) : null;

  if (state.draft) {
    // Cambiar de herramienta cierra lo abierto, como en QGIS; los borradores
    // que son una instrucción y no un elemento se descartan.
    if (TRANSIENT_KINDS.has(state.draft.kind)) cancelDraft();
    else finishDraft();
  }
  // La selección sobrevive al pasar a Vértices, Cortar, Reshape o a extender
  // una línea: en todos ellos define sobre qué se va a operar.
  if (!['select', 'vertices', 'cut', 'reshape'].includes(tool) && !extendFrom) {
    set({ selection: [] });
  }
  set({ tool, extendFrom });
  return true;
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

  if (state.tool === 'measure') {
    // Con brújula no hay nada que muestrear: el toque solo dice dónde va la
    // medida, y los números se escriben después en el menú de propiedades.
    if (state.measureMethod === 'manual') {
      createMeasurement({
        lngLat: p,
        strike: state.manualStrike,
        dip: state.manualDip,
        method: 'manual',
      });
      return;
    }

    const draft = state.draft && state.draft.kind === 'plane' ? state.draft : { kind: 'plane', coords: [] };
    const coords = [...draft.coords, p];
    // El problema de tres puntos se cierra solo al tercero: pedir además que
    // se confirme sería un paso de más en el gesto más frecuente.
    if (state.measureMethod === 'three-point' && coords.length >= 3) {
      set({ draft: null, pendingPlane: { coords, method: 'three-point' } });
      return;
    }
    set({ draft: { ...draft, coords } });
    return;
  }

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

  /*
   * El contorno del hueco tampoco es un elemento del mapa: es un área que se
   * le RESTA a un polígono y desaparece. Se piden tres vértices, los mismos
   * que un polígono, porque con dos no se encierra nada que restar.
   */
  if (d.kind === 'hole') {
    set({
      draft: null,
      pendingHole: d.coords.length >= 3 ? { coords: d.coords } : null,
    });
    return;
  }

  // La línea de reshape tampoco es un elemento del mapa: redibuja el contorno
  // de lo que esté seleccionado y desaparece.
  if (d.kind === 'reshape') {
    set({
      draft: null,
      pendingReshape: d.coords.length >= 2 ? { coords: d.coords } : null,
    });
    return;
  }

  // La traza del perfil tampoco se guarda como elemento: es una pregunta sobre
  // el terreno, no algo cartografiado. El muestreo del DEM es asíncrono, así
  // que se publica y la capa de aplicación la resuelve.
  if (d.kind === 'profile') {
    set({
      draft: null,
      pendingProfile: d.coords.length >= 2 ? { coords: d.coords } : null,
    });
    return;
  }

  // Los puntos de una medida estructural tampoco se guardan tal cual: lo que
  // queda en el mapa es el símbolo de rumbo/manteo que sale de ellos.
  if (d.kind === 'plane') {
    set({
      draft: null,
      pendingPlane:
        d.coords.length >= 3 ? { coords: d.coords, method: state.measureMethod } : null,
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

/**
 * Línea que una selección deja lista para continuarse: exactamente una, y de
 * tipo LineString. Con dos es ambiguo por qué extremo seguir, y un polígono no
 * tiene extremos.
 */
function extendCandidate(selection) {
  if (selection.length !== 1) return null;
  const sel = state.features.find((f) => f.properties.id === selection[0]);
  return sel && sel.geometry.type === 'LineString' ? sel.properties.id : null;
}

/**
 * Rearma la continuación al cambiar la selección.
 *
 * Sin esto, continuar una línea solo funcionaba entrando a la herramienta
 * **Línea** DESPUÉS de haberla seleccionado. Si ya se estaba en Línea —que es
 * lo normal cuando se está cartografiando— seleccionar otra no marcaba nada y
 * el siguiente clic empezaba una línea nueva: exactamente el síntoma de "la
 * extensión no funciona".
 *
 * Con un borrador abierto no se toca: la selección no debe secuestrar un trazo
 * que ya está en curso.
 */
function extendPatch(selection) {
  if (state.tool !== 'line' || state.draft) return {};
  return { extendFrom: extendCandidate(selection) };
}

export function toggleSelection(id) {
  const selection = state.selection.includes(id)
    ? state.selection.filter((x) => x !== id)
    : [...state.selection, id];
  set({ selection, ...extendPatch(selection) });
}

export function clearSelection() {
  set({ selection: [], extendFrom: null });
}

export function setSelection(ids) {
  const selection = Array.from(new Set(ids));
  set({ selection, ...extendPatch(selection) });
}

export function selectedFeatures() {
  const ids = new Set(state.selection);
  return state.features.filter((f) => ids.has(f.properties.id));
}

export function clearPendingReshape() {
  set({ pendingReshape: null });
}

export function clearPendingHole() {
  set({ pendingHole: null });
}

export function clearPendingCut() {
  set({ pendingCut: null });
}

/* ---------- medidas estructurales ---------- */

export const setMeasureMethod = (measureMethod) => set({ measureMethod, draft: null });
export const setMeasureType = (measureType) => set({ measureType });
export const setMeasureOverturned = (measureOverturned) => set({ measureOverturned });
export const setManualStrike = (manualStrike) => set({ manualStrike: norm360(manualStrike) });
export const setManualDip = (manualDip) => set({ manualDip: clampDip(manualDip) });

export function clearPendingPlane() {
  set({ pendingPlane: null });
}

export function setStructureStyle(patch) {
  set({ structureStyle: sanitizeStructureStyle({ ...state.structureStyle, ...patch }) });
}

const norm360 = (deg) => {
  const v = Number(deg);
  return Number.isFinite(v) ? ((v % 360) + 360) % 360 : 0;
};

/** El manteo de un plano vive en [0, 90]: 91° no es un plano, es otro rumbo. */
const clampDip = (deg) => {
  const v = Number(deg);
  return Number.isFinite(v) ? Math.min(90, Math.max(0, v)) : 0;
};

/**
 * Crea un punto de medida estructural.
 *
 * Es la primera geometría de PUNTO del modelo: hasta aquí solo había líneas y
 * polígonos. `geomKind: 'measurement'` la distingue de cualquier otro punto que
 * pudiera entrar por un GeoPackage ajeno, y es lo que filtran tanto las capas
 * del símbolo como la exportación.
 *
 * Los campos de calidad (`strikeSd`, `dipSd`, `rms`, `baseline`…) viajan con el
 * dato y no solo en pantalla: un manteo calculado sobre el DEM sin su
 * incertidumbre al lado es un número que después nadie sabe si puede usar.
 */
export function createMeasurement({
  lngLat,
  strike,
  dip,
  dipAzimuth,
  type,
  overturned,
  method = 'manual',
  quality = {},
  note = '',
}) {
  const id = newId();
  const rumbo = norm360(strike);
  const manteo = clampDip(dip);
  const feature = {
    type: 'Feature',
    id,
    properties: {
      id,
      kind: 'point',
      geomKind: 'measurement',
      type: type ?? state.measureType,
      strike: rumbo,
      dip: manteo,
      dipAzimuth: Number.isFinite(dipAzimuth) ? norm360(dipAzimuth) : norm360(rumbo + 90),
      overturned: overturned ?? state.measureOverturned,
      method,
      // Una medida es siempre observada: no existe un rumbo "inferido".
      certainty: 'observed',
      opacity: 1,
      note,
      ...quality,
      createdAt: Date.now(),
    },
    geometry: { type: 'Point', coordinates: [lngLat[0], lngLat[1]] },
  };
  pushHistory();
  set({ features: [...state.features, feature], draft: null, selection: [id], pendingPlane: null });
  return feature;
}

/**
 * Cambia rumbo o manteo de las medidas seleccionadas. Va aparte de
 * `updateSelectedProps` porque los dos números tienen dominio propio y porque
 * editarlos a mano invalida la incertidumbre calculada del DEM: el resultado
 * ya no es el del ajuste, es el que decidió quien lo corrigió.
 */
export function updateMeasurement(patch) {
  const ids = new Set(state.selection);
  if (ids.size === 0) return;
  pushHistory();
  set({
    features: state.features.map((f) => {
      if (!ids.has(f.properties.id) || f.properties.geomKind !== 'measurement') return f;
      const props = { ...f.properties };
      if (patch.strike !== undefined) props.strike = norm360(patch.strike);
      if (patch.dip !== undefined) props.dip = clampDip(patch.dip);
      if (patch.type !== undefined) props.type = patch.type;
      if (patch.overturned !== undefined) props.overturned = !!patch.overturned;
      if (patch.strike !== undefined || patch.dip !== undefined) {
        props.dipAzimuth = norm360(props.strike + 90);
        if (props.method !== 'manual') {
          props.method = 'edited';
          // Las barras de error eran del ajuste, no de este número escrito a
          // mano: dejarlas puestas afirmaría una precisión que ya no aplica.
          for (const k of ['strikeSd', 'dipSd', 'rms', 'baseline', 'minorSpread', 'n']) {
            delete props[k];
          }
        }
      }
      return { ...f, properties: props };
    }),
  });
}

/* ---------- perfil topográfico ---------- */

export const setProfileSource = (profileSource) => set({ profileSource });
export const setOpenTopoDem = (opentopoDem) => set({ opentopoDem });
export const setOpenTopoKey = (opentopoKey) => set({ opentopoKey });
export const setProfileSamples = (profileSamples) =>
  set({ profileSamples: Math.min(1000, Math.max(20, Math.round(profileSamples))) });

export function clearPendingProfile() {
  set({ pendingProfile: null });
}

/** Publica el perfil ya calculado. El cursor arranca sin señalar nada. */
export function setProfile(profile) {
  set({ profile, profileCursor: null, pendingProfile: null });
}

export function clearProfile() {
  set({ profile: null, profileCursor: null, pendingProfile: null });
}

export function setProfileCursor(profileCursor) {
  set({ profileCursor });
}

/**
 * Perfila una línea que ya está dibujada, sin volver a trazarla. Es el camino
 * natural cuando el corte que interesa es justo un contacto o una falla que ya
 * se cartografió.
 */
export function requestProfileFor(id) {
  const f = state.features.find((x) => x.properties.id === id);
  if (!f || f.geometry.type !== 'LineString') return false;
  set({ pendingProfile: { coords: f.geometry.coordinates, fromFeature: id } });
  return true;
}

/* ---------- relieve 3D ---------- */

/**
 * Activar el relieve saca de cualquier herramienta de dibujo: es lo que evita
 * que se sigan poniendo vértices sobre un terreno inclinado, donde no caen
 * donde parece.
 */
/* ---------- escala ---------- */

/**
 * Fija el mapa a una escala, o lo suelta con null.
 *
 * El store solo guarda la intención; llevar el mapa a ese zoom y mantenerlo
 * ahí es cosa de la vista, que es la única que sabe cuántos metros mide un
 * píxel en la latitud en la que se está.
 */
export function setScaleLock(denominator) {
  set({ scaleLock: denominator === null ? null : clampScale(denominator) });
}

/** Añade una escala a la lista del desplegable. Devuelve la ya normalizada. */
export function addScalePreset(denominator) {
  const n = clampScale(denominator);
  if (state.scalePresets.includes(n)) return n;
  set({ scalePresets: sanitizeScales([...state.scalePresets, n]) });
  return n;
}

export function removeScalePreset(denominator) {
  const resto = state.scalePresets.filter((d) => d !== denominator);
  // Vaciar la lista dejaría el desplegable sin nada a lo que fijarse; se
  // vuelve a la de fábrica antes que quedarse sin ninguna.
  set({ scalePresets: sanitizeScales(resto) });
}

export function resetScalePresets() {
  set({ scalePresets: [...DEFAULT_SCALES] });
}

export function setScalePixelMm(mm) {
  const v = Number(mm);
  if (!Number.isFinite(v) || v <= 0) return;
  // Fuera de este rango no hay pantalla: es un dedo gordo en el teclado.
  set({ scalePixelMm: Math.min(1, Math.max(0.05, Math.round(v * 1000) / 1000)) });
}

export function setTerrain3d(terrain3d) {
  if (terrain3d && DRAWING_TOOLS.includes(state.tool)) {
    if (state.draft) cancelDraft();
    set({ tool: 'navigate', terrain3d, selection: [] });
    return;
  }
  set({ terrain3d });
}

export const setTerrainExaggeration = (terrainExaggeration) =>
  set({ terrainExaggeration: Math.min(3, Math.max(0.5, terrainExaggeration)) });

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
  set({
    features: state.features.filter((f) => !ids.has(f.properties.id)),
    selection: [],
    extendFrom: null,
  });
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
  set({ features, selection: [], draft: null, extendFrom: null });
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
  'measureMethod',
  'measureType',
  'measureOverturned',
  'profileSource',
  'opentopoDem',
  'profileSamples',
  'terrainExaggeration',
  'scaleLock',
  'scalePresets',
  'scalePixelMm',
];

/*
 * `opentopoKey` queda deliberadamente FUERA de los ajustes del proyecto: es una
 * credencial personal, y un `.fdproj.json` se manda por correo o se sube a un
 * repositorio como cualquier otro archivo del trabajo. Vive solo en el
 * dispositivo, en localStorage.
 *
 * `terrain3d` tampoco viaja: es un modo de visualización que además bloquea el
 * dibujo, y abrir un proyecto ajeno sin poder digitalizar no se entendería.
 */

export function currentSettings() {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = state[k];
  return out;
}

/** Visibilidad y opacidad de las capas propias, sin lo importado en la sesión. */
export function currentLayerState() {
  const propias = new Set(['geology', 'contours', 'hillshade', 'basemap']);
  return state.layers
    .filter((l) => propias.has(l.kind))
    .map((l) => ({ id: l.id, visible: l.visible, opacity: l.opacity }));
}

/**
 * Carga un proyecto completo en un solo `set`, para que la UI y el mapa se
 * repinten una vez. El historial se corta: deshacer no debe llevar de vuelta al
 * proyecto anterior.
 */
export function loadProject({ features, units, ornaments, structureStyle, settings, layers } = {}) {
  resetHistory();
  const patch = {
    features: Array.isArray(features) ? features : [],
    draft: null,
    selection: [],
    extendFrom: null,
    pendingCut: null,
    pendingReshape: null,
    pendingHole: null,
  };
  if (Array.isArray(units) && units.length) patch.units = units;
  if (ornaments) patch.ornaments = sanitizeOrnaments(ornaments);
  if (structureStyle) patch.structureStyle = sanitizeStructureStyle(structureStyle);
  if (settings) {
    for (const k of SETTING_KEYS) {
      if (settings[k] !== undefined) patch[k] = settings[k];
    }
    // La lista de escalas viene de un archivo que se puede editar a mano; si
    // llega rota, el desplegable se quedaría vacío o con basura.
    patch.scalePresets = sanitizeScales(settings.scalePresets);
    patch.scaleLock =
      Number.isFinite(Number(settings.scaleLock)) && Number(settings.scaleLock) > 0
        ? clampScale(Number(settings.scaleLock))
        : null;
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
