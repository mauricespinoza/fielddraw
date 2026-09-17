/**
 * Adoptar lo bajado de StraboSpot: pasarlo de capa de consulta a dibujo
 * editable, interpretando su simbología por el camino.
 *
 * Es el gemelo de `adopt.js` —el de las capas de GeoPackage— y existe por la
 * misma razón: un dataset de StraboSpot que solo se puede mirar sirve para
 * comprobar, no para seguir cartografiando. Lo que cambia es de dónde sale el
 * tipo de cada elemento.
 *
 * **CÓMO SE LEE LA SIMBOLOGÍA AJENA.** Un spot no tiene un atributo «tipo»:
 * tiene un objeto `trace` con su `geologic_structure_type` y su `shear_sense`,
 * o un `surface_feature`, o una lista de `orientation_data`. `spots.js` ya los
 * aplana en la columna `Type` con la que categoriza el plugin de QGIS —«geologic
 * structure fault thrust», «contact depositional stratigraphic»— y es esa
 * columna la que aquí se traduce a los tipos de FieldDraw. Así una falla que en
 * StraboSpot es `shear_sense: thrust` entra como cabalgamiento, con sus dientes
 * dibujados, y no como una línea gris sin clasificar.
 *
 * Lo que NO se hace es inventar: una traza que no diga qué es entra como
 * contacto estratigráfico —el tipo más neutro que existe en el catálogo— y se
 * cuenta aparte, para poder decir cuántas hay que revisar. Es la misma regla
 * que con una carta ajena: adivinar en silencio produce un mapa que parece
 * clasificado y no lo está.
 *
 * Todo lo adoptado se marca con `source: 'strabospot'`, que es lo que le da su
 * color único en el mapa (ver `symbology.js`). La marca viaja con el elemento
 * al proyecto y al GeoPackage: seis meses después sigue constando qué se
 * caminó y qué se heredó.
 */

import {
  certaintyOf,
  lineTypeFor,
  normalizeText,
  polygonTypeFor,
} from '../adopt.js';
import {
  POLYGON_TYPE_BY_ID,
  STRABO_SOURCE,
  certaintyFor,
} from '../symbology.js';

/**
 * Calidad de la traza de StraboSpot -> certeza de FieldDraw. Es la inversa
 * exacta de `TRACE_QUALITY_BY_CERTAINTY` en `mapping.js`, y la que decide el
 * patrón de línea a los dos lados: continua, segmentada, punteada.
 */
export const CERTAINTY_BY_TRACE_QUALITY = {
  known: 'observed',
  inferred: 'inferred',
  concealed: 'covered',
  approximate: 'inferred',
  questionable: 'inferred',
};

/**
 * Reglas de la columna `Type` de una línea o un polígono de StraboSpot.
 *
 * Se prueban EN ORDEN y gana la primera que case, así que lo específico va
 * antes que lo general: «fault thrust» tiene que caer en cabalgamiento y no en
 * falla indiferenciada, y para eso `fault` a secas va la última de su familia.
 * Cada regla exige TODAS sus palabras, que es lo que permite distinguir
 * «contact intrusive dike» de «contact intrusive» sin escribir una expresión.
 */
export const STRABO_LINE_RULES = [
  [['fault', 'thrust'], 'thrust-fault'],
  [['fault', 'reverse'], 'thrust-fault'],
  [['fault', 'normal'], 'normal-fault'],
  [['fault', 'dextral'], 'dextral-fault'],
  [['fault', 'right'], 'dextral-fault'],
  [['fault', 'sinistral'], 'sinistral-fault'],
  [['fault', 'left'], 'sinistral-fault'],
  [['anticline'], 'antiform'],
  [['antiform'], 'antiform'],
  [['syncline'], 'synform'],
  [['synform'], 'synform'],
  // Un dique es un contacto intrusivo con nombre propio, y así lo dibuja la
  // app de StraboSpot: más grueso y en rojo.
  [['dike'], 'dike'],
  [['dyke'], 'dike'],
  [['contact', 'intrusive'], 'intrusive-contact'],
  [['intrusive', 'contact'], 'intrusive-contact'],
  [['structural', 'contact'], 'structural-contact'],
  [['shear', 'zone'], 'structural-contact'],
  [['deformation', 'zone'], 'structural-contact'],
  // Cualquier otra estructura con falla de por medio: falla y no se dice más.
  [['fault'], 'undefined-fault'],
  [['contact', 'depositional'], 'stratigraphic-contact'],
  [['contact'], 'stratigraphic-contact'],
];

/** Superficie medida de StraboSpot -> tipo de medida de FieldDraw. */
export const STRUCTURE_BY_STRABO_TYPE = [
  [['bedding'], 'bedding'],
  [['foliation'], 'foliation'],
  [['cleavage'], 'foliation'],
  [['fault'], 'fault-plane'],
  [['shear'], 'fault-plane'],
  [['fracture'], 'joint'],
  [['joint'], 'joint'],
  [['vein'], 'joint'],
];

const matches = (texto, palabras) => palabras.every((p) => texto.includes(p));

/**
 * Tipo de línea de FieldDraw para una traza de StraboSpot.
 *
 * `exact` dice si lo decidió una regla o si es el tipo de reserva. No es un
 * detalle: es lo que la interfaz repite después como «revisa estas antes de
 * seguir cartografiando sobre ellas».
 */
export function straboLineType(label, fallback = 'stratigraphic-contact') {
  const t = normalizeText(label);
  if (t) {
    for (const [palabras, id] of STRABO_LINE_RULES) {
      if (matches(t, palabras)) return { type: id, exact: true };
    }
    // Lo que no case con el vocabulario de StraboSpot todavía puede ser un
    // nombre escrito a mano —«falla inversa», «contacto»—, y para eso ya está
    // el lector de cartas ajenas.
    const r = lineTypeFor({ type: label }, fallback);
    if (r.exact) return { type: r.type, exact: true };
    if (r.type !== fallback) return { type: r.type, exact: false };
  }
  return { type: fallback, exact: false };
}

/** Tipo de medida para la columna `Type` de la tabla de estructuras. */
export function straboStructureType(label) {
  const t = normalizeText(label);
  for (const [palabras, id] of STRUCTURE_BY_STRABO_TYPE) {
    if (matches(t, palabras)) return { type: id, exact: true };
  }
  // Sin tipo declarado se asume estratificación, que es lo que se mide en una
  // jornada normal, pero se cuenta como adivinado.
  return { type: 'bedding', exact: false };
}

/** Certeza de una traza a partir de su calidad declarada. */
export function straboCertainty(quality) {
  const q = normalizeText(quality);
  if (!q) return 'observed';
  for (const [clave, certeza] of Object.entries(CERTAINTY_BY_TRACE_QUALITY)) {
    if (q.includes(clave)) return certeza;
  }
  // Una carta ajena puede traerlo escrito de otra forma («inferido»).
  return certaintyOf({ certainty: quality });
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Texto no vacío, ya recortado. */
const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * Notas de un elemento adoptado, con su procedencia delante.
 *
 * El nombre del spot es cómo lo tiene anotado el geólogo en su libreta; sin él
 * no hay forma de volver al dato original en StraboSpot, y perderlo al adoptar
 * sería romper la trazabilidad justo cuando más falta hace.
 */
function provenance(props, datasetName) {
  const partes = [];
  const nombre = texto(props.Name);
  if (nombre) partes.push(nombre);
  if (datasetName) partes.push(`StraboSpot · ${datasetName}`);
  const notas = texto(props.Notes);
  return [notas, partes.length ? `[${partes.join(' · ')}]` : ''].filter(Boolean).join(' — ');
}

/** Atributos que se conservan tal cual, por si hacen falta después. */
function extras(props, keys) {
  const out = {};
  for (const k of keys) {
    const v = props[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

const LINE_KEEP = ['Date', 'Field', 'Geologist'];
const STRUCTURE_KEEP = [
  'Date',
  'Field',
  'Geologist',
  'Trend',
  'Plunge',
  'Indicators',
  'Sense of slip',
  'Quality',
];

/**
 * Traduce un dataset de StraboSpot a elementos del dibujo.
 *
 * Las OBSERVACIONES quedan fuera a propósito: son muestras y anotaciones de
 * terreno, no geometría cartográfica, y el dibujo no tiene dónde ponerlas sin
 * convertirlas en medidas que nadie tomó. Siguen en su capa de StraboSpot, que
 * es donde se consultan.
 *
 * @param {object} data   lo que guarda el store en `strabo`
 * @param {object} opts
 * @param {Array} [opts.units]        unidades que ya existen en el proyecto
 * @param {() => string} [opts.newId] generador de identificadores
 * @returns {{features: Array, units: Array, warnings: string[], stats: object}}
 */
export function adoptStrabo(data, { units = [], newId } = {}) {
  const genId = newId || (() => `sp-${Math.random().toString(36).slice(2, 10)}`);
  const unidades = units.map((u) => ({ ...u }));
  const porNombre = new Map(unidades.map((u) => [normalizeText(u.name), u]));
  const features = [];
  const warnings = [];
  const stats = { lines: 0, polygons: 0, points: 0, skipped: 0, guessed: 0, newUnits: 0 };
  const datasetName = (data && data.datasetName) || '';

  /* ---------- medidas de rumbo y manteo ---------- */

  for (const f of (data && data.estructuras && data.estructuras.features) || []) {
    const p = f.properties || {};
    const strike = num(p.Strike);
    const dip = num(p.Dip);
    /*
     * Sin rumbo y manteo no es una medida: es un punto de paso. Dibujarle el
     * símbolo de estratificación afirmaría una orientación que nadie tomó.
     */
    if (strike === null || dip === null || !f.geometry) {
      stats.skipped++;
      continue;
    }
    const r = straboStructureType(p.Type);
    if (!r.exact) stats.guessed++;
    const id = genId();
    features.push({
      type: 'Feature',
      id,
      properties: {
        ...extras(p, STRUCTURE_KEEP),
        id,
        kind: 'point',
        geomKind: 'measurement',
        source: STRABO_SOURCE,
        type: r.type,
        strike,
        dip,
        dipAzimuth: num(p.Azimuth) ?? (strike + 90) % 360,
        certainty: 'observed',
        // Se midió con brújula en el terreno, por otra persona y con otra app:
        // ni «manual» de aquí ni ajustado sobre el DEM. Su propio método.
        method: 'strabospot',
        unit: texto(p.Unit),
        note: provenance(p, datasetName),
      },
      geometry: f.geometry,
    });
    stats.points++;
  }

  /* ---------- líneas y polígonos ---------- */

  for (const f of (data && data.lineas && data.lineas.features) || []) {
    const p = f.properties || {};
    const g = f.geometry;
    if (!g || (g.type !== 'LineString' && g.type !== 'Polygon')) {
      stats.skipped++;
      continue;
    }
    const id = genId();
    const comun = {
      ...extras(p, LINE_KEEP),
      id,
      source: STRABO_SOURCE,
      createdAt: Date.now(),
      note: provenance(p, datasetName),
    };

    if (g.type === 'Polygon') {
      // El nombre de la unidad entra en la decisión: «rock unit» no dice de
      // qué está hecha, y «Granodiorita Cerro Negro» sí.
      const r = polygonTypeFor({ type: p.Type, name: p.Unit });
      if (!r.exact) stats.guessed++;
      /*
       * La unidad de un polígono de StraboSpot es un tag del proyecto, y ese
       * tag es justamente lo que aquí es una unidad geológica: si no existe,
       * se crea. Sin esto, veinte formaciones distintas entrarían todas como
       * «unidad sedimentaria» y el mapa perdería lo que lo hacía un mapa.
       */
      const nombre = texto(p.Unit);
      let unidad = nombre ? porNombre.get(normalizeText(nombre)) : null;
      if (!unidad && nombre) {
        const base = POLYGON_TYPE_BY_ID.get(r.type);
        unidad = {
          id: genId(),
          name: nombre,
          code: '',
          color: (base && base.color) || '#9e9e9e',
        };
        unidades.push(unidad);
        porNombre.set(normalizeText(nombre), unidad);
        stats.newUnits++;
      }
      const base = POLYGON_TYPE_BY_ID.get(r.type);
      features.push({
        type: 'Feature',
        id,
        properties: {
          ...comun,
          kind: 'polygon',
          type: unidad ? unidad.id : r.type,
          unit: unidad ? unidad.name : base ? base.label : '',
          code: unidad ? unidad.code : '',
          certainty: straboCertainty(p.Quality),
        },
        geometry: g,
      });
      stats.polygons++;
      continue;
    }

    const r = straboLineType(p.Type);
    if (!r.exact) stats.guessed++;
    features.push({
      type: 'Feature',
      id,
      properties: {
        ...comun,
        kind: 'line',
        type: r.type,
        certainty: certaintyFor(r.type, straboCertainty(p.Quality)),
      },
      geometry: g,
    });
    stats.lines++;
  }

  if (stats.skipped) {
    warnings.push(
      `${stats.skipped} spot(s) skipped: no usable geometry, or a point with no strike and dip.`,
    );
  }
  if (stats.guessed) {
    warnings.push(
      `${stats.guessed} spot(s) carried no type StraboSpot symbolises; they came in as the ` +
        'nearest neutral type — check them before mapping on.',
    );
  }
  if (stats.newUnits) {
    warnings.push(
      `${stats.newUnits} geological unit(s) created from the project's geologic-unit tags; ` +
        'their colours are editable in Units.',
    );
  }

  return { features, units: unidades, warnings, stats };
}
