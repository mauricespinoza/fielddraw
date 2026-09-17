/**
 * Equivalencias entre el modelo de FieldDraw y el modelo de datos NATIVO de
 * StraboSpot.
 *
 * Esto es lo que separa «el spot llegó» de «el spot se entiende». StraboSpot no
 * lee atributos sueltos: categoriza cada spot por tres objetos concretos que
 * viven dentro de `properties`, y lo que no esté ahí no existe para la app ni
 * para el plugin de QGIS:
 *
 * - **Punto** → `orientation_data[]`, una lista de mediciones. El símbolo sale
 *   de `feature_type` + el manteo (horizontal/inclinado/vertical) y la rotación
 *   de `strike`.
 * - **Línea** → `trace{}`. El color sale de `trace_type` y el patrón de línea
 *   (continua/segmentada/punteada) de `trace_quality`.
 * - **Polígono** → `surface_feature{}` para QUÉ es, y un **tag de proyecto** de
 *   tipo `geologic_unit` para QUÉ unidad es y de qué color se pinta. El nombre
 *   de la unidad no se guarda en el polígono: si no hay tag, no hay unidad.
 *
 * Las tablas se comprobaron contra el código de la app oficial (StraboField,
 * `src/assets/forms/*.json` y `src/modules/maps/symbology/`), no de memoria:
 * los valores son los `name` de las listas de opciones del formulario, que es
 * lo que se guarda, y no sus etiquetas, que es lo que se ve.
 *
 * Decisiones que no las decide el dato y que se tomaron explícitamente:
 *
 * - **`quality` de una medición NO se escribe nunca.** Es una escala 1–5 de
 *   cómo estaba expuesto y se midió el plano, y eso la app no lo sabe: la
 *   incertidumbre del ajuste sobre el DEM mide otra cosa. La trazabilidad
 *   completa (método, σ, RMS, base, fuente del DEM) viaja igual, en `notes` de
 *   la medición y en el bloque `fielddraw` del spot.
 * - **Los ejes de pliegue se suben como `anticline` / `syncline`**, no como
 *   antiforme/sinforme, que es lo que espera una carta publicada.
 * - **«Structural contact» se sube como contacto**, no como estructura: sigue
 *   siendo un contacto, y `other_contact_type` guarda el término exacto.
 */

/**
 * Certeza de FieldDraw -> calidad de la traza (lista `wb5nf41`). Es una
 * correspondencia exacta, y es la que decide el patrón de línea en StraboSpot:
 * `known` continua, `inferred` segmentada, `concealed` punteada.
 */
export const TRACE_QUALITY_BY_CERTAINTY = {
  observed: 'known',
  inferred: 'inferred',
  covered: 'concealed',
};

/**
 * Superficie medida -> `feature_type` de la medición planar (lista `yy6na02`),
 * con el subtipo que corresponda.
 *
 * Un `joint` se sube como `fracture` con `fracture_type: 'joint'` y no con el
 * valor `option_13` que la lista actual usa para la etiqueta "joint": ese valor
 * es un accidente del formulario, no tiene símbolo propio, y el plugin de QGIS
 * categoriza por `fracture`. El tipo específico se conserva igual.
 */
export const PLANAR_BY_STRUCTURE_TYPE = {
  bedding: { feature_type: 'bedding' },
  foliation: { feature_type: 'foliation' },
  joint: { feature_type: 'fracture', fracture_type: 'joint' },
  'fault-plane': { feature_type: 'fault' },
};

/**
 * Tipo de línea -> objeto `trace`.
 *
 * Los contactos van bajo `contact` y las fallas y pliegues bajo
 * `geologic_struc`, que es la división que hace StraboSpot y la que decide el
 * color: negro los contactos, rojo las estructuras. Un dique NO es una
 * estructura: es un contacto intrusivo, y así lo dibuja la app (más grueso).
 */
export const TRACE_BY_LINE_TYPE = {
  'stratigraphic-contact': {
    trace_type: 'contact',
    contact_type: 'depositional',
    depositional_contact_type: 'stratigraphic',
  },
  // Sin `intrusive_contact_type`: dique, sill y plutón son cosas distintas y el
  // dibujo no dice cuál. Inventarlo sería afirmar lo que no se cartografió.
  'intrusive-contact': { trace_type: 'contact', contact_type: 'intrusive' },
  'structural-contact': {
    trace_type: 'contact',
    contact_type: 'other',
    other_contact_type: 'structural contact',
  },
  'thrust-fault': {
    trace_type: 'geologic_struc',
    geologic_structure_type: 'fault',
    shear_sense: 'thrust',
  },
  'normal-fault': {
    trace_type: 'geologic_struc',
    geologic_structure_type: 'fault',
    shear_sense: 'normal',
  },
  'dextral-fault': {
    trace_type: 'geologic_struc',
    geologic_structure_type: 'fault',
    shear_sense: 'dextral',
  },
  'sinistral-fault': {
    trace_type: 'geologic_struc',
    geologic_structure_type: 'fault',
    shear_sense: 'sinistral',
  },
  // Indiferenciada: es falla y no se dice más. `shear_sense` vacío es
  // exactamente eso, y es un dato, no un olvido.
  'undefined-fault': { trace_type: 'geologic_struc', geologic_structure_type: 'fault' },
  antiform: {
    trace_type: 'geologic_struc',
    geologic_structure_type: 'fold_axial_tra',
    fold_type: 'anticline',
  },
  synform: {
    trace_type: 'geologic_struc',
    geologic_structure_type: 'fold_axial_tra',
    fold_type: 'syncline',
  },
  dike: {
    trace_type: 'contact',
    contact_type: 'intrusive',
    intrusive_contact_type: 'dike',
  },
};

/**
 * Unidad del catálogo por omisión -> campos del tag `geologic_unit`.
 *
 * Solo cubre las seis unidades que trae FieldDraw de fábrica: una unidad creada
 * por el usuario lleva un id propio y de ella no se puede deducir la litología,
 * así que el tag va sin `rock_type` — con su nombre, su código y su color, que
 * es lo que el usuario sí escribió.
 */
export const ROCK_UNIT_BY_UNIT_TYPE = {
  'intrusive-unit': { rock_type: 'igneous', igneous_rock_class: 'plutonic' },
  'volcanic-unit': { rock_type: 'igneous', igneous_rock_class: 'volcanic' },
  'sedimentary-unit': { rock_type: 'sedimentary' },
  'metamorphic-unit': { rock_type: 'metamorphic' },
  // Cobertura cuaternaria: sedimento sin litificar, que en StraboSpot es un
  // `rock_type` propio y no un tipo de roca sedimentaria.
  'quaternary-cover': { rock_type: 'sediment' },
  'alteration-zone': {},
};

/**
 * Tipo de superficie del polígono (lista `qn1ps78`).
 *
 * Casi todo polígono de una carta es una unidad de roca. La zona de alteración
 * no lo es —es un dominio impuesto sobre las unidades, no una de ellas— y por
 * eso sale como `other` con el término escrito al lado, que es más honesto que
 * declararla unidad de roca.
 */
export const SURFACE_FEATURE_BY_UNIT_TYPE = {
  'alteration-zone': { surface_feature_type: 'other', other_surface_feature_type: 'alteration zone' },
};

const DEFAULT_SURFACE_FEATURE = { surface_feature_type: 'rock_unit' };

/** El tipo de tag con el que StraboSpot pinta y nombra las unidades. */
export const GEOLOGIC_UNIT_TAG = 'geologic_unit';

/**
 * Los formularios de StraboSpot declaran rumbo, manteo y azimut como enteros, y
 * así los escribe su propia brújula. Un ajuste sobre el DEM da decimales; el
 * número exacto se conserva en el bloque `fielddraw`, y aquí se redondea para
 * no entregar un tipo que el formulario no admite.
 */
const deg = (v) => (Number.isFinite(v) ? Math.round(v) : undefined);

/** Quita las claves sin valor: un campo ausente y uno vacío no son lo mismo. */
export function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Medición planar de un punto de FieldDraw.
 *
 * `facing: 'overturned'` es lo que hace que una estratificación invertida salga
 * con su símbolo propio en StraboSpot, igual que el tic doble la dibuja aquí.
 *
 * @param {object} props propiedades de la medida
 * @param {number} id    id de la medición (14 dígitos, como los de StraboSpot)
 */
export function planarOrientation(props, id) {
  const base = PLANAR_BY_STRUCTURE_TYPE[props.type] || PLANAR_BY_STRUCTURE_TYPE.bedding;
  return pruneEmpty({
    id,
    type: 'planar_orientation',
    ...base,
    strike: deg(props.strike),
    dip: deg(props.dip),
    dip_direction: deg(props.dipAzimuth),
    // Solo tiene sentido declarar el volcamiento cuando lo hay: `upright` sería
    // una afirmación que nadie hizo.
    facing: props.overturned ? 'overturned' : undefined,
    notes: measurementProvenance(props),
  });
}

/**
 * Cómo se obtuvo la medida, en una línea legible.
 *
 * Va en `notes` de la medición —y no solo en el bloque propio de FieldDraw—
 * porque es lo único de esto que se ve al abrir el spot en StraboSpot, y un
 * manteo de DEM sin su incertidumbre al lado es un número del que nadie sabe
 * si puede fiarse.
 */
export function measurementProvenance(props) {
  const partes = [];
  const metodo = {
    manual: 'compass',
    'three-point': 'three-point solution on DEM',
    'plane-fit': 'least-squares fit to trace on DEM',
    edited: 'hand-edited',
    // Bajada de StraboSpot y adoptada en el dibujo: si vuelve a subir, que
    // conste que el dato es de allá y no una medida nueva.
    strabospot: 'compass, imported from StraboSpot',
  }[props.method] || props.method;
  if (metodo) partes.push(`Method: ${metodo}`);
  if (Number.isFinite(props.strikeSd) && Number.isFinite(props.dipSd)) {
    partes.push(`±${props.strikeSd.toFixed(1)}° strike / ±${props.dipSd.toFixed(1)}° dip (1σ)`);
  }
  if (Number.isFinite(props.rms)) partes.push(`RMS ${props.rms.toFixed(1)} m`);
  if (Number.isFinite(props.baseline)) partes.push(`baseline ${Math.round(props.baseline)} m`);
  if (Number.isFinite(props.n)) partes.push(`${props.n} points`);
  if (props.demSource) partes.push(`DEM: ${props.demSource}`);
  const nota = (props.note || props.notes || '').trim();
  const cola = partes.length ? `[FieldDraw] ${partes.join(', ')}` : '';
  return [nota, cola].filter(Boolean).join(' — ');
}

/** Objeto `trace` de una línea. */
export function traceFor(props) {
  const base = TRACE_BY_LINE_TYPE[props.type];
  return pruneEmpty({
    // El interruptor «esto es una traza» del formulario. Sin él la app no
    // considera que el spot tenga traza aunque traiga el resto de los campos.
    trace_feature: true,
    ...(base || { trace_type: 'other_feature' }),
    ...(base ? {} : { other_feature: 'other', other_other_feature: props.type || 'line' }),
    trace_quality: TRACE_QUALITY_BY_CERTAINTY[props.certainty],
    tace_notes: (props.notes || props.note || '').trim() || undefined,
  });
}

/** Objeto `surface_feature` de un polígono. */
export function surfaceFeatureFor(props) {
  return pruneEmpty({
    ...(SURFACE_FEATURE_BY_UNIT_TYPE[props.type] || DEFAULT_SURFACE_FEATURE),
    surface_feature_quality: TRACE_QUALITY_BY_CERTAINTY[props.certainty],
    surface_feature_notes: (props.notes || props.note || '').trim() || undefined,
  });
}

/**
 * Tag `geologic_unit` de una unidad, con los ids de los spots que le tocan.
 *
 * `unit_label_abbreviation` es la sigla de la carta (Kcm, PzTr, …) y es el
 * campo por el que StraboSpot rotula la unidad; el color es el mismo hex que
 * usa el dibujo, así que el mapa se ve igual a los dos lados.
 */
export function geologicUnitTag(unit, spotIds, id) {
  return pruneEmpty({
    id,
    type: GEOLOGIC_UNIT_TAG,
    name: unit.name,
    unit_label_abbreviation: unit.code,
    color: unit.color,
    ...(ROCK_UNIT_BY_UNIT_TYPE[unit.id] || {}),
    spots: spotIds,
  });
}

const tagKey = (name) => String(name || '').trim().toLowerCase();

/**
 * Mezcla los tags de unidades nuevos con los que ya tiene el proyecto.
 *
 * `POST /db/project` reenvía el proyecto ENTERO, así que hay que construirlo
 * sobre el que devuelve el servidor y no sobre uno inventado: lo que no se
 * mande se pierde.
 *
 * Una unidad que ya existe en el proyecto —mismo nombre— NO se reescribe: solo
 * se le añaden los spots nuevos. El color, la litología y la edad que el
 * geólogo haya afinado en StraboSpot valen más que los del catálogo local, y
 * pisarlos en cada subida sería destruir trabajo ajeno sin avisar.
 *
 * @returns {{project: object, added: string[], updated: string[]}}
 */
export function mergeGeologicUnitTags(project, tags) {
  const base = project && typeof project === 'object' ? project : {};
  const existentes = Array.isArray(base.tags) ? [...base.tags] : [];
  const porNombre = new Map();
  existentes.forEach((t, i) => {
    if (t && t.type === GEOLOGIC_UNIT_TAG && t.name) porNombre.set(tagKey(t.name), i);
  });

  const added = [];
  const updated = [];

  for (const tag of tags) {
    const i = porNombre.get(tagKey(tag.name));
    if (i === undefined) {
      existentes.push(tag);
      porNombre.set(tagKey(tag.name), existentes.length - 1);
      added.push(tag.name);
      continue;
    }
    const previo = existentes[i];
    const spots = [...new Set([...(previo.spots || []), ...(tag.spots || [])])];
    existentes[i] = { ...previo, spots };
    updated.push(previo.name);
  }

  return {
    project: { ...base, tags: existentes, modified_timestamp: Date.now() },
    added,
    updated,
  };
}
