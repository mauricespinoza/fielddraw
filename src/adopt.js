/**
 * Adoptar una capa importada: pasarla de «solo lectura» a dibujo editable.
 *
 * Una capa de GeoPackage entra como referencia —se ve, se consulta, no se
 * toca— y eso está bien para un mapa de fondo. Pero el trabajo real casi
 * siempre es continuar un mapa que ya existe: corregir un contacto mal
 * trazado, cerrar un polígono, añadir un dique. Para eso hay que llevar sus
 * elementos AL DIBUJO, que es donde viven todas las herramientas.
 *
 * Es lo mismo que hace QGIS al poner una capa en modo edición, con una
 * diferencia que conviene decir en voz alta: aquí el dibujo tiene UNA
 * simbología —el tipo en color, la certeza en el trazo—, así que al adoptar
 * una capa se pierde su estilo QML y pasa a pintarse con el de FieldDraw. A
 * cambio gana todo lo demás: nodos, cortar, unir, reshape, huecos, deshacer, y
 * salir en el GeoPackage y en el proyecto junto al resto del dibujo.
 *
 * Este módulo es solo la traducción de atributos, sin DOM ni store, para poder
 * probar contra cartas reales lo único que puede salir mal de verdad: qué tipo
 * y qué unidad le toca a cada elemento.
 */

import {
  LINE_TYPES,
  LINE_TYPE_BY_ID,
  POLYGON_TYPES,
  POLYGON_TYPE_BY_ID,
  FAULT_SENSES,
  certaintyFor,
  faultLineTypeFrom,
} from './symbology.js';
import { LINE_KIND_BY_STRUCTURE, lineOnPlane, sanitizeQuality } from './structure.js';
import {
  CONTROL_POINT_KIND,
  PURPOSE_BY_ID,
  SAMPLE_SEPARATOR,
  SAMPLING_PURPOSES,
  withSamples,
} from './controlPoints.js';

/** Certezas admitidas. Cualquier otra cosa cae a «observado». */
const CERTAINTY_IDS = new Set(['observed', 'inferred', 'covered']);

/**
 * Palabras que delatan un tipo de línea en una carta ajena.
 *
 * El orden importa: se prueban en secuencia y gana la primera que aparezca en
 * el texto, así que lo específico va antes que lo general — «falla inversa»
 * tiene que caer en cabalgamiento y no en falla indiferenciada, y para eso
 * `falla` a secas va la última de su familia.
 *
 * Están en castellano y en inglés porque una carta del Sernageomin y una capa
 * de un paper no coinciden en nada, y sin acentos porque tampoco coinciden en
 * eso: el texto se normaliza antes de buscar.
 */
const LINE_KEYWORDS = [
  [['cabalgamiento', 'inversa', 'thrust', 'reverse'], 'thrust-fault'],
  [['normal'], 'normal-fault'],
  [['dextral', 'dextra'], 'dextral-fault'],
  [['sinestral', 'siniestral', 'sinistral'], 'sinistral-fault'],
  [['anticlinal', 'antiforme', 'anticline', 'antiform'], 'antiform'],
  [['sinclinal', 'sinforme', 'syncline', 'synform'], 'synform'],
  [['dique', 'dyke', 'dike'], 'dike'],
  [['intrusivo', 'intrusive'], 'intrusive-contact'],
  [['estructural', 'structural'], 'structural-contact'],
  [['falla', 'fault'], 'undefined-fault'],
  [['contacto', 'contact'], 'stratigraphic-contact'],
];

const POLYGON_KEYWORDS = [
  [['intrusiv', 'pluton', 'granit', 'diorit', 'tonalit'], 'intrusive-unit'],
  [['volcanic', 'lava', 'toba', 'tobas', 'ignimbrit', 'andesit', 'basalt'], 'volcanic-unit'],
  [['metamorfic', 'metamorphic', 'esquisto', 'schist', 'gneis', 'gneiss'], 'metamorphic-unit'],
  [['cuaternari', 'quaternary', 'aluvi', 'coluvi', 'morren', 'deposito', 'fluvial'], 'quaternary-cover'],
  [['alteracion', 'alteration'], 'alteration-zone'],
  [['sediment', 'arenisc', 'lutit', 'caliza', 'conglomerad'], 'sedimentary-unit'],
];

/** Minúsculas y sin acentos, que es como se compara todo aquí. */
export function normalizeText(v) {
  return String(v === null || v === undefined ? '' : v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

/** Los campos donde una carta suele decir de qué es cada trazo. */
const TYPE_FIELDS = [
  'type',
  'tipo',
  'clase',
  'class',
  'categoria',
  'category',
  'simbologia',
  'symbol',
  'descripcion',
  'description',
  'label',
  'etiqueta',
  'nombre',
  'name',
];

/** Lee un campo del elemento sin importar cómo esté escrito su nombre. */
function field(props, nombre) {
  const objetivo = normalizeText(nombre);
  const clave = Object.keys(props).find((k) => normalizeText(k) === objetivo);
  return clave === undefined ? undefined : props[clave];
}

/**
 * El tipo de línea que le corresponde a un elemento ajeno.
 *
 * Primero se prueba la coincidencia EXACTA con un id o una etiqueta de
 * FieldDraw: un GeoPackage exportado por la propia app vuelve a entrar
 * idéntico, que es el caso que más se repite y el único donde acertar del todo
 * es obligatorio. Solo si eso falla se busca por palabras, y entonces se
 * marca como adivinado para que la interfaz lo diga.
 */
export function lineTypeFor(props, fallback = 'stratigraphic-contact') {
  for (const f of TYPE_FIELDS) {
    const t = normalizeText(field(props, f));
    if (!t) continue;
    if (LINE_TYPE_BY_ID.has(t)) return { type: t, exact: true };
    const porEtiqueta = LINE_TYPES.find(
      (x) => normalizeText(x.label) === t || normalizeText(x.short) === t,
    );
    if (porEtiqueta) return { type: porEtiqueta.id, exact: true };
  }
  for (const f of TYPE_FIELDS) {
    const t = normalizeText(field(props, f));
    if (!t) continue;
    for (const [palabras, id] of LINE_KEYWORDS) {
      if (palabras.some((p) => t.includes(p))) return { type: id, exact: false };
    }
  }
  return { type: fallback, exact: false };
}

/** El tipo de polígono, con la misma escalera que las líneas. */
export function polygonTypeFor(props, fallback = 'sedimentary-unit') {
  for (const f of TYPE_FIELDS) {
    const t = normalizeText(field(props, f));
    if (!t) continue;
    if (POLYGON_TYPE_BY_ID.has(t)) return { type: t, exact: true };
    const porEtiqueta = POLYGON_TYPES.find((x) => normalizeText(x.label) === t);
    if (porEtiqueta) return { type: porEtiqueta.id, exact: true };
  }
  for (const f of TYPE_FIELDS) {
    const t = normalizeText(field(props, f));
    if (!t) continue;
    for (const [palabras, id] of POLYGON_KEYWORDS) {
      if (palabras.some((p) => t.includes(p))) return { type: id, exact: false };
    }
  }
  return { type: fallback, exact: false };
}

/** Certeza declarada por el elemento, si es una de las tres que existen. */
export function certaintyOf(props) {
  const v = normalizeText(field(props, 'certainty') || field(props, 'certeza'));
  if (CERTAINTY_IDS.has(v)) return v;
  // «inferido» / «cubierto» de una carta escrita en castellano.
  if (v.startsWith('infer')) return 'inferred';
  if (v.startsWith('cubiert') || v.startsWith('conceal') || v.startsWith('cover')) return 'covered';
  return 'observed';
}

/**
 * Parte una geometría multiparte en geometrías simples.
 *
 * El modelo de datos del dibujo son líneas y polígonos SIMPLES —así los guarda
 * el GeoPackage y así los editan los nodos—, mientras que una carta viene casi
 * siempre multiparte. Explotar es la única traducción honesta: la alternativa
 * sería quedarse con la primera parte y perder el resto sin decirlo.
 */
export function explode(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;
  if (type === 'LineString' || type === 'Polygon' || type === 'Point') return [geometry];
  if (type === 'MultiLineString') {
    return coordinates.map((c) => ({ type: 'LineString', coordinates: c }));
  }
  if (type === 'MultiPolygon') {
    return coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
  }
  if (type === 'MultiPoint') {
    return coordinates.map((c) => ({ type: 'Point', coordinates: c }));
  }
  return [];
}

/** Nombre de unidad declarado por el elemento, si trae alguno. */
function unitNameOf(props) {
  for (const f of ['unit', 'unidad', 'formacion', 'formation', 'nombre', 'name', 'label', 'etiqueta']) {
    const v = field(props, f);
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * Atributos que son de FieldDraw y por tanto se reescriben. Todo lo demás que
 * traiga la carta se conserva tal cual: son datos del autor original y
 * perderlos al adoptar sería peor que no poder editar.
 */
const OWN_KEYS = new Set([
  'id', 'fid', 'kind', 'geomkind', 'type', 'certainty', 'unit', 'code',
  'createdat', 'created_at', 'opacity', 'flip',
  'strike', 'dip', 'dipazimuth', 'method', 'quality', 'overturned',
  'fault_sense', 'faultsense', 'fault_type', 'faulttype',
  'line_type', 'linetype', 'line_trend', 'linetrend', 'line_plunge', 'lineplunge',
  'rake', 'linemisfit', 'line_misfit', 'line_input', 'lineinput', 'linerake',
]);

/**
 * La línea (estría o lineación) y la calidad 1–5 de una medida, desde las
 * columnas que escribe la propia exportación a GeoPackage.
 */
function lineAndQualityOf(props, tipo, strike, dip) {
  const out = {};
  const t = Number(field(props, 'line_trend') ?? field(props, 'lineTrend'));
  const pl = Number(field(props, 'line_plunge') ?? field(props, 'linePlunge'));
  if (LINE_KIND_BY_STRUCTURE[tipo] && Number.isFinite(t) && Number.isFinite(pl)) {
    out.lineTrend = ((t % 360) + 360) % 360;
    out.linePlunge = Math.min(90, Math.max(0, pl));
    const r = lineOnPlane(strike, dip, out.lineTrend, out.linePlunge);
    if (r) {
      out.rake = Math.round(r.rake * 10) / 10;
      out.lineMisfit = Math.round(r.misfit * 10) / 10;
    }
  }
  // Medida como rake: el rake es el dato y se conserva tal cual.
  const rk = Number(field(props, 'rake'));
  if (out.lineTrend !== undefined && normalizeText(field(props, 'line_input')) === 'rake' && Number.isFinite(rk)) {
    out.lineInput = 'rake';
    out.lineRake = Math.min(180, Math.max(0, rk));
    out.rake = out.lineRake;
  } else if (out.lineTrend !== undefined) {
    out.lineInput = normalizeText(field(props, 'line_input')) === 'edge' ? 'edge' : 'trend';
  }
  const q = sanitizeQuality(field(props, 'quality'));
  if (q !== null) out.quality = q;
  return out;
}

/** Sentido de un plano de falla desde su columna `fault_sense` (id o etiqueta). */
function faultSenseOf(props) {
  const t = normalizeText(field(props, 'fault_sense') ?? field(props, 'faultSense'));
  if (!t) return '';
  const s = FAULT_SENSES.find((f) => f.id === t || normalizeText(f.label) === t);
  return s ? s.id : '';
}

/**
 * Dónde trae las notas un elemento ajeno, en orden de preferencia.
 *
 * `Notes` es la columna del GeoPackage de StraboSpot y la de su planilla, y es
 * ahí donde va la descripción del afloramiento; `note` es la que escribe la
 * propia exportación de FieldDraw. Las otras son las de una carta o una
 * libreta en castellano.
 */
const NOTE_FIELDS = [
  'notes', 'note', 'spot_notes', 'spot notes', 'notas', 'nota',
  'observaciones', 'observacion', 'comments', 'comment', 'comentarios',
];

/** Campos de notas que, en un PUNTO, también son la descripción. */
const POINT_NOTE_FALLBACK = ['description', 'descripcion'];

const textoDe = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** Primer campo con texto, y cómo se llamaba de verdad en la tabla. */
function firstText(props, nombres) {
  for (const n of nombres) {
    const objetivo = normalizeText(n);
    const clave = Object.keys(props).find((k) => normalizeText(k) === objetivo);
    if (clave === undefined) continue;
    const v = textoDe(props[clave]);
    if (v) return { value: v, key: clave };
  }
  return { value: '', key: null };
}

/**
 * Las notas del elemento, y las claves consumidas para no duplicarlas en los
 * extras: si `Notes` pasa a ser la nota del punto, dejarla además como
 * atributo suelto haría que editar la nota en la app no cambiara lo que se lee
 * en el visor.
 */
function notesOf(props, nombres = NOTE_FIELDS) {
  const r = firstText(props, nombres);
  return { note: r.value, used: r.key ? [r.key] : [] };
}

function extras(props, consumidas = []) {
  const out = {};
  const fuera = new Set(consumidas);
  for (const [k, v] of Object.entries(props)) {
    if (fuera.has(k)) continue;
    if (OWN_KEYS.has(normalizeText(k))) continue;
    if (v instanceof Uint8Array) continue;
    out[k] = v;
  }
  return out;
}

/** Propósito de muestreo: id o etiqueta de la lista cerrada, o nada. */
function purposeOf(v) {
  const t = normalizeText(v);
  if (!t) return '';
  if (PURPOSE_BY_ID.has(t)) return t;
  const p = SAMPLING_PURPOSES.find((x) => normalizeText(x.label) === t);
  return p ? p.id : '';
}

/** Claves de un punto de StraboSpot / FieldDraw que pasan a campos propios. */
const CP_NAME_FIELDS = ['name', 'nombre', 'spot_name', 'estacion', 'station'];
const CP_SAMPLE_FIELDS = ['sample_id', 'sample code', 'sample_code', 'sample_id_name', 'sample sample id name', 'codigo_muestra', 'muestra'];
const CP_SAMPLE_DESC_FIELDS = ['sample_description', 'sample description', 'sample sample description'];
const CP_PURPOSE_FIELDS = ['purpose', 'main_sampling_purpose', 'sample main sampling purpose', 'proposito'];
const CP_UNIT_FIELDS = ['unit', 'unidad', 'geologic_unit', 'formacion', 'formation'];
const CP_ALT_FIELDS = ['altitude', 'altitud', 'altitude(m)', 'elevation', 'elevacion', 'z'];
const CP_DATE_FIELDS = ['date', 'fecha', 'time', 'created_at', 'createdat'];

/**
 * Un punto sin rumbo ni manteo, como punto de control.
 *
 * Es lo que es casi todo un GeoPackage de StraboSpot: estaciones y muestras con
 * su descripción en Notes. Descartarlas —lo que se hacía antes, para no dibujar
 * un símbolo de rumbo que nadie midió— perdía justamente las descripciones; un
 * punto de control no afirma ninguna orientación, así que es su sitio.
 *
 * @returns {object|null} las propiedades, o null si el punto no trae nada
 */
function controlPointProps(props, geometry, buscarUnidad) {
  const usadas = [];
  const tomar = (nombres) => {
    const r = firstText(props, nombres);
    if (r.key) usadas.push(r.key);
    return r.value;
  };
  const name = tomar(CP_NAME_FIELDS);
  let { note, used } = notesOf(props);
  if (!note) ({ note, used } = notesOf(props, POINT_NOTE_FALLBACK));
  usadas.push(...used);
  const sampleId = tomar(CP_SAMPLE_FIELDS);
  const sampleDescription = tomar(CP_SAMPLE_DESC_FIELDS);
  const purpose = purposeOf(tomar(CP_PURPOSE_FIELDS));
  const unitName = tomar(CP_UNIT_FIELDS);
  if (!name && !note && !sampleId && !sampleDescription && !unitName) return null;

  const altCampo = Number(textoDe(firstText(props, CP_ALT_FIELDS).value) || NaN);
  const z = geometry.coordinates && geometry.coordinates[2];
  const altitude = Number.isFinite(altCampo) ? altCampo : Number.isFinite(z) ? z : undefined;
  const fecha = Date.parse(firstText(props, CP_DATE_FIELDS).value);

  const unidad = unitName ? buscarUnidad(unitName, props) : null;
  const base = {
    ...extras(props, usadas),
    kind: 'point',
    geomKind: CONTROL_POINT_KIND,
    name,
    note,
    certainty: 'observed',
    opacity: 1,
    ...(unidad ? { unitId: unidad.id, unit: unidad.name, code: unidad.code } : {}),
    ...(Number.isFinite(altitude) ? { altitude } : {}),
    ...(Number.isFinite(fecha) ? { createdAt: fecha } : {}),
  };
  return withSamples(base, splitSamples(sampleId, sampleDescription, tomarCrudo(props, CP_PURPOSE_FIELDS), purpose));
}

const tomarCrudo = (props, nombres) => firstText(props, nombres).value;

/**
 * Las muestras de un punto. La exportación de FieldDraw junta las de un mismo
 * punto con «; » en cada columna; si los códigos vienen así y las otras
 * columnas cuadran, se vuelven a separar. Si no cuadran, va una sola muestra
 * con el texto entero: partirlo mal sería peor que no partirlo.
 */
function splitSamples(sampleId, sampleDescription, purposeRaw, purpose) {
  if (!sampleId && !sampleDescription && !purpose) return [];
  const ids = sampleId.split(SAMPLE_SEPARATOR.trim()).map((x) => x.trim());
  if (ids.length > 1) {
    const descs = sampleDescription ? sampleDescription.split(SAMPLE_SEPARATOR.trim()).map((x) => x.trim()) : [];
    const props = purposeRaw ? purposeRaw.split(SAMPLE_SEPARATOR.trim()).map((x) => purposeOf(x)) : [];
    if ((descs.length === 0 || descs.length === ids.length) && (props.length === 0 || props.length <= ids.length)) {
      return ids.map((id, i) => ({
        sampleId: id,
        sampleDescription: descs[i] || '',
        purpose: props.length === ids.length ? props[i] : i === 0 ? purpose : '',
      }));
    }
  }
  return [{ sampleId, sampleDescription, purpose }];
}

/**
 * Traduce una capa importada a elementos del dibujo.
 *
 * @param {object} layer   la capa tal como la guarda el store
 * @param {object} opts
 * @param {Array} [opts.units]        unidades que ya existen en el proyecto
 * @param {() => string} [opts.newId] generador de identificadores
 * @returns {{features: Array, units: Array, warnings: string[], stats: object}}
 */
export function adoptLayer(layer, { units = [], newId } = {}) {
  const genId = newId || (() => `adopt-${Math.random().toString(36).slice(2, 10)}`);
  const origen = (layer && layer.geojson && layer.geojson.features) || [];

  const unidades = units.map((u) => ({ ...u }));
  const porNombre = new Map(unidades.map((u) => [normalizeText(u.name), u]));
  /** Unidad de un punto de control: la existente con ese nombre, o una nueva. */
  const unidadDePunto = (nombre, props) => {
    let u = porNombre.get(normalizeText(nombre));
    if (u) return u;
    u = {
      id: genId(),
      name: nombre,
      code: String(field(props, 'code') || field(props, 'codigo') || '').trim(),
      color: '#9e9e9e',
    };
    unidades.push(u);
    porNombre.set(normalizeText(nombre), u);
    stats.newUnits++;
    return u;
  };
  const features = [];
  const warnings = [];
  const stats = {
    lines: 0,
    polygons: 0,
    points: 0,
    controlPoints: 0,
    skipped: 0,
    exploded: 0,
    newUnits: 0,
    guessed: 0,
  };

  for (const f of origen) {
    const props = (f && f.properties) || {};
    const partes = explode(f && f.geometry);
    if (partes.length === 0) {
      stats.skipped++;
      continue;
    }
    if (partes.length > 1) stats.exploded += partes.length - 1;

    for (const geometry of partes) {
      const id = genId();
      // Notes (StraboSpot) / note (FieldDraw) pasa a la nota propia, la que
      // se edita en la app y sale en la columna `note` del GeoPackage.
      const notaComun = notesOf(props);
      const comun = {
        ...extras(props, notaComun.used),
        id,
        createdAt: Date.now(),
        ...(notaComun.note ? { note: notaComun.note } : {}),
      };

      if (geometry.type === 'Point') {
        /*
         * Un punto solo es una medida si trae orientación. Sin ella, dibujarle
         * el símbolo de estratificación afirmaría un rumbo que nadie midió, y
         * eso es peor que descartarlo.
         */
        const sNum = field(props, 'strike');
        const dNum = field(props, 'dip');
        const strike = textoDe(sNum) === '' ? NaN : Number(sNum);
        const dip = textoDe(dNum) === '' ? NaN : Number(dNum);
        if (!Number.isFinite(strike) || !Number.isFinite(dip)) {
          const cp = controlPointProps(props, geometry, unidadDePunto);
          if (!cp) {
            stats.skipped++;
            continue;
          }
          features.push({
            type: 'Feature',
            id,
            properties: { createdAt: Date.now(), ...cp, id },
            geometry: { type: 'Point', coordinates: [geometry.coordinates[0], geometry.coordinates[1]] },
          });
          stats.controlPoints++;
          continue;
        }
        const notaMedida = notesOf(props);
        const tipoMedida = normalizeText(field(props, 'type')) || 'bedding';
        const sentido = tipoMedida === 'fault-plane' ? faultSenseOf(props) : '';
        features.push({
          type: 'Feature',
          id,
          properties: {
            ...extras(props, notaMedida.used),
            id,
            createdAt: Date.now(),
            kind: 'point',
            geomKind: 'measurement',
            note: notaMedida.note,
            type: tipoMedida,
            ...(sentido ? { faultSense: sentido } : {}),
            strike,
            dip,
            dipAzimuth: (strike + 90) % 360,
            certainty: 'observed',
            method: 'manual',
            ...lineAndQualityOf(props, tipoMedida, strike, dip),
          },
          geometry,
        });
        stats.points++;
        continue;
      }

      if (geometry.type === 'Polygon') {
        const r = polygonTypeFor(props);
        if (!r.exact) stats.guessed++;
        const nombre = unitNameOf(props);
        /*
         * Una unidad nombrada por la carta y que aquí no existe se CREA. Es lo
         * que convierte una carta ajena en un proyecto propio: cada formación
         * mapeada pasa a ser una unidad de FieldDraw, con su color y editable
         * en el panel de unidades. Sin esto, veinte formaciones distintas
         * entrarían todas como «unidad sedimentaria» y el mapa perdería
         * justamente aquello que lo hacía un mapa.
         */
        let unidad = nombre ? porNombre.get(normalizeText(nombre)) : null;
        if (!unidad && nombre) {
          const base = POLYGON_TYPE_BY_ID.get(r.type);
          unidad = {
            id: genId(),
            name: nombre,
            code: String(field(props, 'code') || field(props, 'codigo') || '').trim(),
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
            unit: unidad ? unidad.name : (base ? base.label : ''),
            code: unidad ? unidad.code : '',
            certainty: certaintyOf(props),
          },
          geometry,
        });
        stats.polygons++;
        continue;
      }

      /*
       * Una columna `fault_type` —la que escribe el propio GeoPackage de
       * FieldDraw— manda sobre lo que se adivine del resto: es el tipo de
       * falla declarado, y sin ella una traza de otra herramienta con
       * type = «falla» entraría como indiferenciada aunque dijera Thrust.
       */
      const declarado = faultLineTypeFrom(field(props, 'fault_type') ?? field(props, 'faultType'));
      const r = declarado ? { type: declarado, exact: true } : lineTypeFor(props);
      if (!r.exact) stats.guessed++;
      features.push({
        type: 'Feature',
        id,
        properties: {
          ...comun,
          kind: 'line',
          type: r.type,
          certainty: certaintyFor(r.type, certaintyOf(props)),
        },
        geometry,
      });
      stats.lines++;
    }
  }

  if (stats.skipped) {
    warnings.push(
      `${stats.skipped} feature(s) skipped: no usable geometry, or a point with no strike and dip and nothing else to keep (no name, notes, sample or unit).`,
    );
  }
  if (stats.exploded) {
    warnings.push(
      `${stats.exploded} multipart feature(s) split into single parts: the drawing holds simple lines and polygons.`,
    );
  }
  if (stats.guessed) {
    warnings.push(
      `${stats.guessed} feature(s) had no recognisable type and were guessed from their text; check them before mapping on.`,
    );
  }
  if (stats.newUnits) {
    warnings.push(
      `${stats.newUnits} new geological unit(s) created from the layer; their colours are editable in Units.`,
    );
  }

  return { features, units: unidades, warnings, stats };
}
