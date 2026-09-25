import { loadVendorScript, vendorUrl } from '../vendorPaths.js';
import {
  HORIZONTAL_DIP_MAX,
  STRABO_SOURCE,
  FAULT_LINE_KIND,
  FAULT_SENSE_BY_ID,
  STRUCTURE_TYPES,
  STRUCTURE_TYPE_BY_ID,
  VERTICAL_DIP_MIN,
} from '../symbology.js';
import { LINE_KIND_BY_STRUCTURE, formatStrikeDip, formatTrendPlunge } from '../structure.js';
import {
  CONTROL_POINT_COLUMNS,
  CONTROL_POINT_ICON_BY_ID,
  CONTROL_POINT_NO_UNIT_COLOR,
  controlPointValues,
  defaultControlPointStyle,
  isControlPoint,
  labelColumnFor,
} from '../controlPoints.js';
import { decodeGeoPackageBinary, encodeGeoPackageBinary, envelopeOf } from './wkb.js';
import {
  buildControlPointQML,
  buildControlPointSLD,
  buildLineQML,
  buildLineSLD,
  buildPointQML,
  buildPointSLD,
  buildPolygonQML,
  buildPolygonSLD,
  comboLabel,
  parseQML,
} from './qml.js';

let sqlPromise = null;
/**
 * sql.js pesa ~1,5 MB de wasm: se carga solo cuando de verdad se usa.
 *
 * Va por <script> contra el build oficial y no por esm.sh: al convertirlo a
 * ESM, esm.sh le inyecta polyfills de Node (unenv) y el runtime de emscripten
 * intenta leer el .wasm con `fs.readFileSync`, que en el navegador revienta.
 *
 * Ahora sale de `vendor/`, no del CDN: sin eso, importar un GeoPackage en
 * terreno —sin señal— fallaría aunque la app hubiera abierto perfectamente.
 */
export function loadSql() {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      if (!globalThis.initSqlJs) await loadVendorScript('sql-wasm.js');
      if (!globalThis.initSqlJs) throw new Error('sql.js no expuso initSqlJs');
      // El .wasm va al lado del .js, así que `locateFile` apunta a vendor/.
      return globalThis.initSqlJs({ locateFile: (f) => vendorUrl(f) });
    })();
  }
  return sqlPromise;
}

let proj4Promise = null;
function loadProj4() {
  if (!proj4Promise) {
    proj4Promise = loadVendorScript('proj4.js').then(() => {
      if (!globalThis.proj4) throw new Error('proj4 no expuso el objeto global');
      return globalThis.proj4;
    });
  }
  return proj4Promise;
}

const WGS84_WKT =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';

/* ============================================================== EXPORTAR */

const SCHEMA = `
PRAGMA application_id = 1196444487;
PRAGMA user_version = 10300;

CREATE TABLE gpkg_spatial_ref_sys (
  srs_name TEXT NOT NULL,
  srs_id INTEGER NOT NULL PRIMARY KEY,
  organization TEXT NOT NULL,
  organization_coordsys_id INTEGER NOT NULL,
  definition TEXT NOT NULL,
  description TEXT
);

CREATE TABLE gpkg_contents (
  table_name TEXT NOT NULL PRIMARY KEY,
  data_type TEXT NOT NULL,
  identifier TEXT UNIQUE,
  description TEXT DEFAULT '',
  last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
  srs_id INTEGER,
  CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
);

CREATE TABLE gpkg_geometry_columns (
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  geometry_type_name TEXT NOT NULL,
  srs_id INTEGER NOT NULL,
  z TINYINT NOT NULL,
  m TINYINT NOT NULL,
  CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
  CONSTRAINT uk_gc_table_name UNIQUE (table_name),
  CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
  CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id)
);

CREATE TABLE layer_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  f_table_catalog TEXT,
  f_table_schema TEXT,
  f_table_name TEXT,
  f_geometry_column TEXT,
  styleName TEXT,
  styleQML TEXT,
  styleSLD TEXT,
  useAsDefault BOOLEAN,
  description TEXT,
  owner TEXT,
  ui TEXT,
  update_time DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE geol_lines (
  fid INTEGER PRIMARY KEY AUTOINCREMENT,
  geom LINESTRING,
  type TEXT,
  certainty TEXT,
  label TEXT,
  note TEXT,
  -- Cómo se obtuvo la línea, y a partir de qué. Una traza proyectada desde un
  -- manteo sobre el DEM (ver planeTrace.js) se dibuja igual que un contacto
  -- caminado, y en la carta acabada son indistinguibles; aquí no. Vacío en
  -- todo lo digitalizado a mano, que es la inmensa mayoría.
  method TEXT,
  source TEXT,
  -- Tipo de falla legible (Thrust, Normal, Dextral, Sinistral,
  -- Undifferentiated), vacío en lo que no es falla. Repite lo que dice
  -- la columna type para quien filtra la tabla en QGIS sin conocer los ids.
  fault_type TEXT,
  created_at TEXT
);

CREATE TABLE geol_polygons (
  fid INTEGER PRIMARY KEY AUTOINCREMENT,
  geom POLYGON,
  type TEXT,
  unit TEXT,
  code TEXT,
  certainty TEXT,
  label TEXT,
  note TEXT,
  created_at TEXT
);

CREATE TABLE geol_control_points (
  fid INTEGER PRIMARY KEY AUTOINCREMENT,
  geom POINT,
  -- El nombre del punto -la estación, el afloramiento- y no el de la muestra:
  -- un punto sin muestra sigue necesitando cómo llamarse. Es el name con el
  -- que StraboSpot lista sus spots.
  name TEXT,
  -- El código de la muestra, que en StraboSpot es su "Sample Specific ID/Name".
  sample_id TEXT,
  -- Fecha y hora de toma, en la hora local del equipo que la tomó. La columna
  -- created_at de más abajo lleva la misma marca en ISO/UTC: esta es para
  -- leerla, aquella para compararla entre husos.
  date TEXT,
  unit TEXT,
  code TEXT,
  purpose TEXT,
  sample_description TEXT,
  note TEXT,
  altitude REAL,
  source TEXT,
  created_at TEXT
);

CREATE TABLE geol_points (
  fid INTEGER PRIMARY KEY AUTOINCREMENT,
  geom POINT,
  type TEXT,
  strike REAL,
  dip REAL,
  dip_dir REAL,
  overturned INTEGER,
  method TEXT,
  strike_sd REAL,
  dip_sd REAL,
  rms_m REAL,
  n_points INTEGER,
  base_m REAL,
  spread_m REAL,
  -- Dispersión angular del polo entre las muestras del método Device, en
  -- grados. Estaba en el INSERT y no en el esquema —el mismo olvido que ya
  -- había pasado con unit/code— y eso rompía la exportación ENTERA: sqlite
  -- rechaza la sentencia al prepararla, aunque no haya ni una medida que
  -- escribir, así que no salía ningún GeoPackage.
  pole_sd REAL,
  dem_source TEXT,
  -- La unidad en la que se tomó la medida, igual que en los polígonos. Estaban
  -- en el INSERT pero no en el esquema, así que exportar un GeoPackage con
  -- cualquier medida fallaba entero con «table geol_points has no column
  -- named unit».
  unit TEXT,
  code TEXT,
  label TEXT,
  note TEXT,
  -- Cinemática de un plano de falla medido (Normal, Inverse, Left-lateral,
  -- Right-lateral); vacío en las demás superficies.
  fault_sense TEXT,
  -- Plano + línea: la estría de una falla o la lineación L1 sobre S1, como
  -- trend/plunge de la línea y su rake (desde el rumbo RHR) dentro del plano.
  line_type TEXT,
  line_trend REAL,
  line_plunge REAL,
  rake REAL,
  -- Cómo se midió la línea: 'rake' (el rake es el dato y trend/plunge se
  -- calcularon de él), 'trend' (al revés) o 'edge' (canto del teléfono).
  -- Trend, plunge y rake se escriben SIEMPRE los tres.
  line_input TEXT,
  -- Calidad del dato 1-5, la misma escala de StraboSpot.
  quality INTEGER,
  created_at TEXT
);
`;

/**
 * Procedencia de una traza proyectada, en una sola frase legible.
 *
 * Va en texto y no en seis columnas más porque quien la lee está en QGIS
 * mirando la tabla de atributos y necesita saber una cosa: esta línea no se
 * caminó, salió de este manteo sobre este modelo y llega hasta aquí. Los
 * números sueltos ya viajan enteros dentro del proyecto `.fdproj.json`.
 */
export function traceProvenance(p) {
  if (!p) return null;
  /*
   * Lo adoptado de StraboSpot tampoco se caminó aquí, y la columna que
   * contesta «de dónde salió esta línea» es justamente esta. En la app se
   * distingue por el color único; abierto en QGIS, el color se pierde y solo
   * queda lo que diga la tabla.
   */
  if (p.source === STRABO_SOURCE) {
    return 'Imported from StraboSpot — mapped by someone else, not walked here';
  }
  if (p.method !== 'dem-trace') return null;
  const rumbo = String(Math.round(Number(p.traceStrike) || 0)).padStart(3, '0');
  const manteo = Math.round(Number(p.traceDip) || 0);
  const dem = p.demSource === 'opentopo' ? 'OpenTopography' : 'AWS Terrain Tiles';
  const km = (Number(p.traceKm) || 0).toFixed(2);
  return `Projected from ${rumbo}/${manteo} over ${km} km on ${dem} — not walked`;
}

function combosPresent(features, units) {
  const seen = new Map();
  for (const f of features) {
    const key = `${f.properties.type}|${f.properties.certainty}`;
    if (seen.has(key)) continue;
    // Para polígonos la leyenda usa el nombre de la unidad del usuario.
    const unit = units && units.find((u) => u.id === f.properties.type);
    const base = unit
      ? `${unit.name}${unit.code ? ` (${unit.code})` : ''}`
      : comboLabel(f.properties.type, f.properties.certainty);
    seen.set(key, { type: f.properties.type, certainty: f.properties.certainty, label: base });
  }
  return [...seen.values()];
}

function bboxOfFeatures(features) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of features) {
    const [a, b, c, d] = envelopeOf(f.geometry); // minX, maxX, minY, maxY
    if (a < minX) minX = a;
    if (b > maxX) maxX = b;
    if (c < minY) minY = c;
    if (d > maxY) maxY = d;
  }
  return features.length ? [minX, minY, maxX, maxY] : [null, null, null, null];
}

/**
 * Las unidades que de verdad aparecen entre los puntos de control, con su
 * color. Se resuelven por NOMBRE porque es lo que va en la tabla, y el color
 * sale del catálogo vigente: si el nombre ya no está en él —el punto viene de
 * un proyecto viejo, o de un tag de StraboSpot que nadie creó aquí— la unidad
 * se conserva igual, en gris, en vez de perderla.
 */
export function controlPointUnits(points, units) {
  const porNombre = new Map((units || []).filter((u) => u && u.name).map((u) => [u.name, u]));
  const vistas = new Map();
  for (const f of points) {
    const nombre = f.properties.unit;
    if (!nombre || vistas.has(nombre)) continue;
    const u = porNombre.get(nombre);
    vistas.set(nombre, {
      value: nombre,
      label: u && u.code ? `${nombre} (${u.code})` : nombre,
      color: (u && u.color) || CONTROL_POINT_NO_UNIT_COLOR,
    });
  }
  return [...vistas.values()];
}

/**
 * Genera un GeoPackage válido con las dos tablas de features y, sobre todo,
 * la tabla `layer_styles`: gracias a ella QGIS abre el archivo con la
 * simbología ya puesta, sin que el geólogo tenga que aplicar nada.
 */
export async function exportGeoPackage(features, units, ornaments, controlPointStyle) {
  const SQL = await loadSql();
  const db = new SQL.Database();
  try {
    db.run(SCHEMA);

    db.run(
      `INSERT INTO gpkg_spatial_ref_sys VALUES
        ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', NULL),
        ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', NULL),
        ('WGS 84 geodetic', 4326, 'EPSG', 4326, ?, NULL)`,
      [WGS84_WKT],
    );

    const lines = features.filter((f) => f.geometry.type === 'LineString');
    const polys = features.filter((f) => f.geometry.type === 'Polygon');
    // Solo los puntos que SON una medida: cualquier otro punto que hubiera
    // llegado por un GeoJSON ajeno no tiene rumbo que exportar.
    const points = features.filter(
      (f) => f.geometry.type === 'Point' && f.properties.geomKind === 'measurement',
    );

    const controlPoints = features.filter((f) => f.geometry.type === 'Point' && isControlPoint(f));
    const cpStyle = controlPointStyle || defaultControlPointStyle();
    // El rótulo de QGIS es una COLUMNA de la tabla, no una propiedad del
    // elemento: es el mismo campo con el otro nombre.
    const cpLabelColumn = labelColumnFor(cpStyle.labelField);
    const cpUnidades = controlPointUnits(controlPoints, units);
    const cpIcon = CONTROL_POINT_ICON_BY_ID.get(cpStyle.icon) || CONTROL_POINT_ICON_BY_ID.get('circle');

    // Tipos de superficie realmente presentes, para que la leyenda de QGIS no
    // traiga categorías vacías.
    const tiposMedidos = STRUCTURE_TYPES.filter((t) => points.some((p) => p.properties.type === t.id));

    const tables = [
      {
        name: 'geol_lines',
        geomType: 'LINESTRING',
        rows: lines,
        columns: ['type', 'certainty', 'label', 'note', 'method', 'source', 'fault_type', 'created_at'],
        valuesOf: (p) => [
          p.type,
          p.certainty,
          comboLabel(p.type, p.certainty),
          p.note || null,
          p.method || null,
          traceProvenance(p),
          FAULT_LINE_KIND[p.type] || null,
        ],
        qml: buildLineQML(combosPresent(lines), ornaments),
        sld: buildLineSLD(combosPresent(lines), ornaments),
        identifier: 'Contactos, fallas, pliegues y diques',
      },
      {
        name: 'geol_polygons',
        geomType: 'POLYGON',
        rows: polys,
        columns: ['type', 'unit', 'code', 'certainty', 'label', 'note', 'created_at'],
        valuesOf: (p) => [
          p.type,
          p.unit || '',
          p.code || '',
          p.certainty,
          [p.unit || '', p.code ? `(${p.code})` : ''].filter(Boolean).join(' ') ||
            comboLabel(p.type, p.certainty),
          p.note || null,
        ],
        qml: buildPolygonQML(combosPresent(polys, units), units),
        sld: buildPolygonSLD(combosPresent(polys, units)),
        identifier: 'Unidades de mapa',
      },
      {
        name: 'geol_points',
        geomType: 'POINT',
        rows: points,
        columns: [
          'type', 'strike', 'dip', 'dip_dir', 'overturned', 'method',
          'strike_sd', 'dip_sd', 'rms_m', 'n_points', 'base_m', 'spread_m',
          'pole_sd', 'dem_source', 'unit', 'code', 'label', 'note', 'fault_sense',
          'line_type', 'line_trend', 'line_plunge', 'rake', 'line_input', 'quality', 'created_at',
        ],
        /*
         * Los campos de calidad se exportan junto al dato y no solo se muestran
         * en la app: un manteo calculado sobre un DEM sin su incertidumbre al
         * lado termina citado como si fuera de brújula, y en QGIS ya no queda
         * forma de saber cuál era cuál.
         */
        valuesOf: (p) => [
          p.type,
          p.strike ?? null,
          p.dip ?? null,
          p.dipAzimuth ?? null,
          p.overturned ? 1 : 0,
          p.method || 'manual',
          p.strikeSd ?? null,
          p.dipSd ?? null,
          p.rms ?? null,
          p.n ?? null,
          p.baseline ?? null,
          p.minorSpread ?? null,
          // Dispersión angular del polo entre las muestras del método Device,
          // en grados. `spread_m` de al lado son METROS y es otra cosa —la
          // geometría de la base de un ajuste sobre el DEM—, de ahí que no
          // compartan columna por mucho que ambas se llamen dispersión.
          p.poleSpread ?? null,
          p.demSource || null,
          p.unit || '',
          p.code || '',
          // El sentido de un plano de falla va también en el rótulo, que es lo
          // que QGIS escribe junto al símbolo; su columna es `fault_sense`.
          `${STRUCTURE_TYPE_BY_ID.get(p.type)?.label || p.type}${
            p.type === 'fault-plane' && FAULT_SENSE_BY_ID.has(p.faultSense)
              ? ` (${FAULT_SENSE_BY_ID.get(p.faultSense).label.toLowerCase()})`
              : ''
          } ${formatStrikeDip(p.strike, p.dip)}${
            Number.isFinite(p.lineTrend)
              ? ` · ${LINE_KIND_BY_STRUCTURE[p.type]?.label || 'line'} ${formatTrendPlunge(p.lineTrend, p.linePlunge)}${
                Number.isFinite(p.rake) ? ` (rake ${Math.round(p.rake)}°)` : ''
              }`
              : ''
          }`,
          p.note || null,
          p.type === 'fault-plane' && FAULT_SENSE_BY_ID.has(p.faultSense)
            ? FAULT_SENSE_BY_ID.get(p.faultSense).label
            : null,
          Number.isFinite(p.lineTrend) ? LINE_KIND_BY_STRUCTURE[p.type]?.id ?? null : null,
          Number.isFinite(p.lineTrend) ? p.lineTrend : null,
          Number.isFinite(p.linePlunge) ? p.linePlunge : null,
          Number.isFinite(p.rake) ? p.rake : null,
          Number.isFinite(p.lineTrend) ? p.lineInput || 'trend' : null,
          Number.isFinite(p.quality) ? p.quality : null,
        ],
        qml: buildPointQML(tiposMedidos, {
          horizontalMax: HORIZONTAL_DIP_MAX,
          verticalMin: VERTICAL_DIP_MIN,
        }),
        sld: buildPointSLD(tiposMedidos),
        identifier: 'Medidas de rumbo y manteo',
      },
      {
        name: 'geol_control_points',
        geomType: 'POINT',
        rows: controlPoints,
        columns: [...CONTROL_POINT_COLUMNS.map((c) => c.gpkg), 'created_at'],
        valuesOf: (p) => controlPointValues(p),
        qml: buildControlPointQML(
          cpUnidades,
          cpLabelColumn,
          CONTROL_POINT_NO_UNIT_COLOR,
          cpIcon.qgis,
        ),
        sld: buildControlPointSLD(cpUnidades, cpIcon.sld),
        identifier: 'Puntos de control y muestras',
      },
    ];

    for (const t of tables) {
      const [minX, minY, maxX, maxY] = bboxOfFeatures(t.rows);
      db.run(
        `INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id)
         VALUES (?, 'features', ?, '', ?, ?, ?, ?, 4326)`,
        [t.name, t.identifier, minX, minY, maxX, maxY],
      );
      db.run(
        `INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', ?, 4326, 0, 0)`,
        [t.name, t.geomType],
      );

      const marcadores = t.columns.map(() => '?').join(', ');
      const stmt = db.prepare(
        `INSERT INTO ${t.name} (geom, ${t.columns.join(', ')}) VALUES (?, ${marcadores})`,
      );
      for (const f of t.rows) {
        const p = f.properties;
        const created = new Date(p.createdAt || Date.now()).toISOString();
        stmt.run([encodeGeoPackageBinary(f.geometry, 4326), ...t.valuesOf(p), created]);
      }
      stmt.free();

      // Una tabla vacía no lleva estilo: un QML sin reglas no describe nada y
      // al releerlo el importador avisaría de que no pudo interpretarlo.
      if (t.rows.length === 0) continue;

      db.run(
        `INSERT INTO layer_styles
           (f_table_catalog, f_table_schema, f_table_name, f_geometry_column,
            styleName, styleQML, styleSLD, useAsDefault, description, owner, ui)
         VALUES ('', '', ?, 'geom', 'FieldDraw', ?, ?, 1, 'Generado por FieldDraw', '', NULL)`,
        [t.name, t.qml, t.sld],
      );
    }

    return db.export();
  } finally {
    db.close();
  }
}

/* ============================================================== IMPORTAR */

function rowsOf(db, sql, params) {
  const out = [];
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function tableExists(db, name) {
  return rowsOf(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]).length > 0;
}

function geomKindOf(typeName) {
  const t = String(typeName || '').toUpperCase();
  if (t.includes('POLYGON')) return 'polygon';
  if (t.includes('LINE')) return 'line';
  if (t.includes('POINT')) return 'point';
  return null;
}

function kindFromGeometry(g) {
  if (!g) return null;
  if (g.type.includes('Polygon')) return 'polygon';
  if (g.type.includes('LineString')) return 'line';
  if (g.type.includes('Point')) return 'point';
  return null;
}

/** Reproyecta in situ; devuelve false si no se pudo construir la transformación. */
async function makeReprojector(db, srsId, warnings) {
  if (srsId === 4326 || srsId === 0 || srsId === -1) return null;
  const rows = rowsOf(db, `SELECT definition, organization, organization_coordsys_id FROM gpkg_spatial_ref_sys WHERE srs_id = ?`, [srsId]);
  const def = rows[0] && rows[0].definition;
  try {
    const proj4 = await loadProj4();
    const source = def && def !== 'undefined' ? def : `EPSG:${srsId}`;
    const fwd = proj4(source, 'EPSG:4326');
    // Prueba de humo: si la transformación no produce números, no sirve.
    const probe = fwd.forward([0, 0]);
    if (!Number.isFinite(probe[0]) || !Number.isFinite(probe[1])) throw new Error('invalid transformation');
    return (c) => {
      const r = fwd.forward([c[0], c[1]]);
      return [r[0], r[1]];
    };
  } catch (err) {
    warnings.push(
      `Could not reproject from EPSG:${srsId} (${err.message}). The layer is loaded with its original coordinates and will probably not line up with the map.`,
    );
    return null;
  }
}

function mapCoords(coords, fn) {
  if (typeof coords[0] === 'number') return fn(coords);
  return coords.map((c) => mapCoords(c, fn));
}

/**
 * Lee un GeoPackage completo: geometrías, atributos y el estilo QGIS de cada
 * tabla. Devuelve una capa por tabla de features, lista para entrar al mapa.
 */
export async function importGeoPackage(arrayBuffer) {
  const SQL = await loadSql();
  const db = new SQL.Database(new Uint8Array(arrayBuffer));
  const layers = [];
  const warnings = [];

  try {
    if (!tableExists(db, 'gpkg_contents')) {
      throw new Error('El archivo no parece un GeoPackage (falta gpkg_contents)');
    }

    const contents = rowsOf(
      db,
      `SELECT table_name, identifier, srs_id FROM gpkg_contents WHERE data_type = 'features'`,
    );
    if (contents.length === 0) warnings.push('El GeoPackage no contiene tablas de features.');

    const hasStyles = tableExists(db, 'layer_styles');

    for (const c of contents) {
      const table = c.table_name;
      const gc = rowsOf(
        db,
        `SELECT column_name, geometry_type_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?`,
        [table],
      )[0];
      if (!gc) {
        warnings.push(`Table "${table}" declares no geometry column; skipped.`);
        continue;
      }

      const geomCol = gc.column_name;
      const srsId = Number(gc.srs_id ?? c.srs_id ?? 4326);
      const reproject = await makeReprojector(db, srsId, warnings);

      const rows = rowsOf(db, `SELECT * FROM "${table}"`);
      const features = [];
      let badGeoms = 0;
      let kind = geomKindOf(gc.geometry_type_name);

      for (const row of rows) {
        const blob = row[geomCol];
        if (!blob) continue;
        let geometry;
        try {
          geometry = decodeGeoPackageBinary(blob);
        } catch {
          badGeoms++;
          continue;
        }
        if (!geometry) continue;
        if (reproject) geometry = { ...geometry, coordinates: mapCoords(geometry.coordinates, reproject) };
        if (!kind) kind = kindFromGeometry(geometry);

        const properties = {};
        for (const [k, v] of Object.entries(row)) {
          if (k === geomCol) continue;
          properties[k] = v instanceof Uint8Array ? null : v;
        }
        features.push({ type: 'Feature', properties, geometry });
      }
      if (badGeoms > 0) warnings.push(`"${table}": ${badGeoms} unreadable geometry/geometries skipped.`);

      let style = null;
      if (hasStyles) {
        const st = rowsOf(
          db,
          `SELECT styleQML, styleSLD FROM layer_styles WHERE f_table_name = ? ORDER BY useAsDefault DESC, id ASC`,
          [table],
        )[0];
        if (st && st.styleQML) {
          try {
            style = parseQML(st.styleQML);
            for (const w of style.warnings) warnings.push(`"${table}": ${w}`);
          } catch (err) {
            warnings.push(`"${table}": could not read the QML (${err.message}); the default style is used instead.`);
          }
        } else if (st && st.styleSLD) {
          warnings.push(`"${table}": the layer only carries SLD, which is not interpreted yet; the default style is used instead.`);
        }
      }

      layers.push({
        table,
        label: c.identifier || table,
        kind: kind || 'line',
        srsId,
        geojson: { type: 'FeatureCollection', features },
        style,
      });
    }
  } finally {
    db.close();
  }

  return { layers, warnings };
}
