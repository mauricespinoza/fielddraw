/**
 * Puntos de control: el punto de terreno que NO es una medida de orientación.
 *
 * Es la otra mitad de una libreta de campo. Hasta aquí el dibujo solo sabía de
 * geometría cartográfica —contactos, unidades— y de rumbos y manteos; lo que se
 * anota al llegar a un afloramiento —de qué unidad es, qué muestra se sacó, para
 * qué análisis, y la descripción de la roca— no tenía dónde ir, y por eso lo que
 * bajaba de StraboSpot como observación o muestra se quedaba en una capa de solo
 * lectura (ver la nota de cabecera de `strabo/adopt.js`).
 *
 * Los campos son los de StraboSpot y no unos propios, porque estos puntos suben
 * allá como muestras y tienen que entrar en sus casillas sin traducción:
 *
 * - **Name**             -> `name` del spot (cómo se llama EL PUNTO, no la
 *   muestra: la estación, el afloramiento — lo que StraboSpot enseña en la
 *   lista de spots)
 * - **Sample ID**        -> `sample_id_name`         (Sample Specific ID/Name)
 * - **Sample Description** -> `sample_description`
 * - **Purpose**          -> `main_sampling_purpose`  (lista controlada)
 * - **Unit**             -> tag de proyecto `geologic_unit`
 * - **Notes**            -> `notes` del spot y `sample_notes` de la muestra
 *
 * Name y Sample ID contestan preguntas distintas: un mismo afloramiento
 * («DCR02») puede dar varias muestras con código propio, o ninguna. Sin Name,
 * un punto sin muestra no tenía cómo llamarse y salía subiendo como «Control
 * point 3» — un número que no significa nada ni en la libreta ni de vuelta en
 * StraboSpot.
 *
 * La LITOLOGÍA no es un campo: se escribe en las notas. Un campo aparte obligaría
 * a inventar un destino en StraboSpot que su modelo de muestra no tiene, y la
 * descripción de la roca ya es prosa —«granodiorita de bt, grano medio,
 * equigranular»— que ningún desplegable captura mejor que el texto.
 *
 * La FECHA Y HORA tampoco se piden: se estampan solas al colocar el punto
 * (`createdAt`, como en todo el resto del modelo) y se formatean al exportar.
 * Preguntarle la fecha a alguien que está de pie en el afloramiento es pedirle
 * que copie lo que el reloj ya sabe.
 */

/**
 * Propósito del muestreo: los valores de `main_sampling_purpose` de StraboSpot.
 *
 * Es lista cerrada y no texto libre a propósito: el valor viaja tal cual al
 * formulario de StraboSpot, y uno escrito a mano —«geocronologia», «U-Pb»— cae
 * fuera de su lista de opciones y el campo aparece vacío al abrir la muestra
 * allá.
 *
 * `geochronology` y `petrology` están verificados contra un export real de
 * StraboSpot (columna «Sample Main Sampling Purpose»); el resto sigue la misma
 * convención de nombres. Añadir o quitar uno se hace AQUÍ y solo aquí: el
 * desplegable, la validación del store y la subida leen esta misma lista.
 */
export const SAMPLING_PURPOSES = [
  { id: 'petrology', label: 'Petrology' },
  { id: 'geochronology', label: 'Geochronology' },
  { id: 'thermochronology', label: 'Thermochronology' },
  { id: 'geochemistry', label: 'Geochemistry' },
  { id: 'paleontology', label: 'Paleontology' },
  { id: 'structural', label: 'Structural analysis' },
  { id: 'other', label: 'Other' },
];

export const PURPOSE_BY_ID = new Map(SAMPLING_PURPOSES.map((p) => [p.id, p]));

/** Etiqueta legible de un propósito, o el valor crudo si viene de fuera. */
export const purposeLabel = (id) => (PURPOSE_BY_ID.get(id) || {}).label || id || '';

/**
 * Por qué campo se rotula el punto en el mapa.
 *
 * Se elige en la interfaz y no está fijado a Sample ID porque lo que hay que
 * leer de un vistazo cambia con la jornada: recorriendo un contacto interesa la
 * unidad, y preparando el envío de muestras al laboratorio interesa el código de
 * cada una.
 */
export const CONTROL_POINT_LABEL_FIELDS = [
  { id: 'name', label: 'Name', prop: 'name', column: 'name' },
  { id: 'sampleId', label: 'Sample ID', prop: 'sampleId', column: 'sample_id' },
  { id: 'unit', label: 'Unit', prop: 'unit', column: 'unit' },
  { id: 'code', label: 'Unit code', prop: 'code', column: 'code' },
  { id: 'purpose', label: 'Purpose', prop: 'purpose', column: 'purpose' },
  { id: 'note', label: 'Notes', prop: 'note', column: 'note' },
  { id: 'none', label: 'No label', prop: null, column: null },
];

export const LABEL_FIELD_BY_ID = new Map(CONTROL_POINT_LABEL_FIELDS.map((f) => [f.id, f]));

/**
 * Columna de la tabla exportada por la que rotula QGIS, o `null` para no
 * rotular. En el mapa el rótulo sale de una propiedad del elemento y en QGIS de
 * una columna; son dos nombres de la misma cosa y por eso viajan juntos.
 */
export function labelColumnFor(labelField) {
  const campo = LABEL_FIELD_BY_ID.get(labelField) || LABEL_FIELD_BY_ID.get('sampleId');
  return campo ? campo.column : null;
}

/** Color de un punto sin unidad asignada. Gris: no afirma ninguna unidad. */
export const CONTROL_POINT_NO_UNIT_COLOR = '#b0bec5';

export const CONTROL_POINT_SIZE_LIMITS = { min: 0.5, max: 2.5, step: 0.1 };

export function defaultControlPointStyle() {
  return { size: 1, labelField: 'sampleId', minzoom: 10 };
}

export function sanitizeControlPointStyle(raw) {
  const out = defaultControlPointStyle();
  if (!raw || typeof raw !== 'object') return out;
  const size = Number(raw.size);
  if (Number.isFinite(size)) {
    out.size = Math.min(CONTROL_POINT_SIZE_LIMITS.max, Math.max(CONTROL_POINT_SIZE_LIMITS.min, size));
  }
  const minzoom = Number(raw.minzoom);
  if (Number.isFinite(minzoom)) out.minzoom = Math.min(18, Math.max(0, Math.round(minzoom)));
  if (LABEL_FIELD_BY_ID.has(raw.labelField)) out.labelField = raw.labelField;
  return out;
}

/** El filtro que distingue un punto de control de cualquier otro punto. */
export const CONTROL_POINT_KIND = 'control-point';

/** La herramienta que los coloca. Mismo nombre, para no tener dos vocabularios. */
export const CONTROL_POINT_TOOL = 'control-point';

export const isControlPoint = (f) =>
  !!f && !!f.properties && f.properties.geomKind === CONTROL_POINT_KIND;

const pad = (n) => String(n).padStart(2, '0');

/**
 * Fecha y hora de toma del dato, en la hora local del equipo con el que se
 * tomó — `YYYY-MM-DD HH:MM:SS`.
 *
 * Local y no UTC porque es lo que se escribiría en la libreta: la hora a la que
 * uno estaba en ese afloramiento. La ISO en UTC viaja igual en la columna
 * `created_at` del GeoPackage y en la subida a StraboSpot, que es donde una
 * fecha tiene que ser comparable entre husos.
 */
export function formatCaptureDate(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Columnas de la tabla, en el orden en que se leen: primero qué muestra es,
 * después cuándo y de qué unidad, y al final la descripción y las notas, que son
 * las largas. `csv` es el encabezado que se escribe y `gpkg` el nombre de la
 * columna SQL; se declaran juntos para que los dos formatos no se separen.
 */
export const CONTROL_POINT_COLUMNS = [
  { csv: 'Name', gpkg: 'name', of: (p) => p.name || '' },
  { csv: 'Sample ID', gpkg: 'sample_id', of: (p) => p.sampleId || '' },
  { csv: 'Date', gpkg: 'date', of: (p) => formatCaptureDate(p.createdAt) },
  { csv: 'Unit', gpkg: 'unit', of: (p) => p.unit || '' },
  { csv: 'Code', gpkg: 'code', of: (p) => p.code || '' },
  { csv: 'Purpose', gpkg: 'purpose', of: (p) => p.purpose || '' },
  { csv: 'Sample Description', gpkg: 'sample_description', of: (p) => p.sampleDescription || '' },
  { csv: 'Notes', gpkg: 'note', of: (p) => p.note || '' },
  {
    csv: 'Altitude',
    gpkg: 'altitude',
    of: (p) => (Number.isFinite(p.altitude) ? p.altitude : ''),
  },
  { csv: 'Source', gpkg: 'source', of: (p) => p.source || '' },
];

/** Los valores de un punto, en el orden de `CONTROL_POINT_COLUMNS`. */
export const controlPointValues = (props) => CONTROL_POINT_COLUMNS.map((c) => c.of(props || {}));

const csvCell = (v) => {
  const texto = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
};

/**
 * CSV de los puntos de control, con latitud y longitud al final.
 *
 * Las coordenadas van en columnas y no en una geometría porque un CSV no tiene
 * dónde ponerlas: es el formato para abrir en una planilla y para «añadir capa
 * de texto delimitado» en QGIS, que pide justamente dos columnas de números.
 *
 * Se escribe con BOM: sin él, Excel en Windows lee el UTF-8 como Latin-1 y
 * «Plutón» sale «PlutÃ³n» en la primera columna que alguien mira.
 */
export function controlPointsCSV(features) {
  const cabecera = [...CONTROL_POINT_COLUMNS.map((c) => c.csv), 'Longitude', 'Latitude'];
  const filas = features.filter(isControlPoint).map((f) => {
    const [lng, lat] = (f.geometry && f.geometry.coordinates) || [];
    return [...controlPointValues(f.properties), lng ?? '', lat ?? ''].map(csvCell).join(',');
  });
  return `﻿${[cabecera.map(csvCell).join(','), ...filas].join('\r\n')}\r\n`;
}
