/**
 * Sacar el perfil estructural de FieldDraw hacia las dos herramientas donde se
 * termina de interpretar.
 *
 * FieldDraw levanta el dato en terreno; el corte se interpreta después, en
 * gabinete, y para eso ya existen dos herramientas propias. Este módulo escribe
 * lo que cada una sabe leer, con su contrato real y no con uno inventado:
 *
 * - **Structural Modeller** (plugin de QGIS) importa un shapefile de LÍNEAS 3D:
 *   cada horizonte o falla como una `PolylineZ` cuyos vértices llevan X, Y y Z,
 *   y un campo de texto del que deduce la clase — si contiene «fault» o
 *   «falla» es una falla, si no es un horizonte. Ajusta la traza del corte por
 *   mínimos cuadrados a todos los vértices, así que la topografía exportada
 *   basta para que la sección nazca en su sitio.
 *
 * - **StructuralSketcher** (la app HTML) abre un documento JSON
 *   `{app, version, section}` donde las líneas viven ya en coordenadas de
 *   sección `[s, z]` y los manteos son `{s, z, dip}` con el manteo APARENTE en
 *   su convención de edición: magnitud de 0 a 180 medida en sentido horario
 *   desde la horizontal, y signo negativo para marcar una capa invertida.
 *
 * Las dos salidas nacen del mismo perfil, así que no pueden discrepar.
 */

import { SHAPE_POINT_Z, SHAPE_POLYLINE_Z, shapefileZip, zip } from './shapefile.js';
import { LINE_TYPE_BY_ID } from './symbology.js';
import { elevationAt } from './section.js';

/**
 * Cuánto baja el tramo vertical con que se marca una intersección, en metros.
 *
 * No es una interpretación: es una semilla. La falla corta el perfil en ese
 * kilómetro y a esa cota, y lo que hay debajo lo decide quien interprete. Un
 * tramo corto lo dice; uno largo estaría afirmando una geometría en
 * profundidad que nadie midió.
 */
export const INTERSECTION_SEED_M = 250;

/** La clase que Structural Modeller deducirá de un tipo de FieldDraw. */
export function sectionKindOf(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('fault')) return 'fault';
  if (t === 'antiform' || t === 'synform') return 'fold-axis';
  return 'horizon';
}

/**
 * Las líneas 3D del perfil, en coordenadas del mapa y con la cota como Z.
 *
 * Van la topografía y una semilla vertical por cada intersección marcada. Los
 * manteos NO caben aquí: son puntos y el importador de secciones solo lee
 * líneas, así que viajan en su propio shapefile dentro del mismo ZIP.
 */
export function sectionLines3D(section) {
  const out = [];

  const topo = [];
  for (const m of section.samples) {
    if (!Number.isFinite(m.elevation)) continue;
    topo.push([m.lngLat[0], m.lngLat[1], m.elevation]);
  }
  if (topo.length >= 2) {
    out.push({
      vertices: topo,
      attrs: { Type: 'topography', Name: 'Topographic profile', Certainty: '', Unit: '' },
    });
  }

  for (const x of section.intersections) {
    if (x.enabled === false) continue;
    const z = elevationAt(section.samples, x.s);
    if (!Number.isFinite(z)) continue;
    const tipo = LINE_TYPE_BY_ID.get(x.type);
    out.push({
      vertices: [
        [x.lngLat[0], x.lngLat[1], z],
        [x.lngLat[0], x.lngLat[1], z - INTERSECTION_SEED_M],
      ],
      attrs: {
        // El tipo de FieldDraw se manda tal cual —«thrust-fault» ya contiene
        // «fault»— y así el plugin deduce la clase sin que haya que traducir
        // dos veces la misma cosa.
        Type: x.type || 'contact',
        Name: tipo ? tipo.label : x.type || 'Intersection',
        Certainty: x.certainty || '',
        Unit: x.unit || '',
      },
    });
  }
  return out;
}

/** Los manteos proyectados, como puntos 3D con su orientación. */
export function sectionDips3D(section) {
  return section.dips
    .filter((d) => Number.isFinite(d.z) && Array.isArray(d.lngLat))
    .map((d) => ({
      vertex: [d.lngLat[0], d.lngLat[1], d.z],
      attrs: {
        Type: d.type || 'bedding',
        Strike: String(Math.round(d.strike)),
        Dip: String(Math.round(d.dip)),
        AppDip: String(Math.round(d.apparent)),
        SectAz: String(Math.round(d.sectionAzimuth)),
        Offset: String(Math.round(d.offset)),
      },
    }));
}

/**
 * El ZIP con los dos shapefiles que se abren en Structural Modeller.
 *
 * @param {object} section
 * @param {string} [name]
 * @returns {Uint8Array}
 */
export function structuralModellerZip(section, name = 'fielddraw-section') {
  const lineas = sectionLines3D(section);
  const dips = sectionDips3D(section);
  const partes = [];

  if (lineas.length) {
    const lineasZip = shapefileZip({
      name: `${name}_lines`,
      geometries: lineas.map((l) => l.vertices),
      shapeType: SHAPE_POLYLINE_Z,
      fields: [
        { name: 'Type', width: 24 },
        { name: 'Name', width: 48 },
        { name: 'Certainty', width: 12 },
        { name: 'Unit', width: 48 },
      ],
      rows: lineas.map((l) => l.attrs),
    });
    partes.push({ zipBytes: lineasZip });
  }
  if (dips.length) {
    const dipsZip = shapefileZip({
      name: `${name}_dips`,
      geometries: dips.map((d) => d.vertex),
      shapeType: SHAPE_POINT_Z,
      fields: [
        { name: 'Type', width: 16 },
        { name: 'Strike', width: 8 },
        { name: 'Dip', width: 8 },
        { name: 'AppDip', width: 8 },
        { name: 'SectAz', width: 8 },
        { name: 'Offset', width: 10 },
      ],
      rows: dips.map((d) => d.attrs),
    });
    partes.push({ zipBytes: dipsZip });
  }
  if (partes.length === 0) return null;
  if (partes.length === 1) return partes[0].zipBytes;

  /*
   * Dos shapefiles en un solo ZIP. Se rearma en vez de anidar ZIPs porque un
   * ZIP dentro de otro obliga a descomprimir dos veces antes de poder abrir
   * nada, y eso en el flujo de trabajo real se traduce en que nadie lo usa.
   */
  return zip([
    ...unzipEntries(partes[0].zipBytes),
    ...unzipEntries(partes[1].zipBytes),
  ]);
}

/**
 * Lee las entradas de un ZIP sin comprimir escrito por `shapefile.js`.
 *
 * Solo entiende el método 0 («almacenado»), que es el único que produce este
 * módulo: no pretende ser un lector de ZIP general, sino la vuelta atrás justa
 * para poder juntar dos paquetes en uno.
 */
export function unzipEntries(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let o = 0;
  const dec = new TextDecoder();
  while (o + 30 <= bytes.length && dv.getUint32(o, true) === 0x04034b50) {
    const nameLen = dv.getUint16(o + 26, true);
    const extraLen = dv.getUint16(o + 28, true);
    const size = dv.getUint32(o + 18, true);
    const name = dec.decode(bytes.subarray(o + 30, o + 30 + nameLen));
    const inicio = o + 30 + nameLen + extraLen;
    out.push({ name, data: bytes.subarray(inicio, inicio + size) });
    o = inicio + size;
  }
  return out;
}

/**
 * Convierte un manteo aparente con signo a la convención de edición del
 * Sketcher.
 *
 * Allí un manteo es una magnitud de 0 a 180 medida en sentido horario desde la
 * horizontal —0 mantea a la derecha, 90 vertical, 180 mantea a la izquierda— y
 * el signo negativo NO es una dirección: marca la capa como invertida. Es la
 * inversa exacta de `dip_input_to_apparent` del plugin, y sin ella una capa que
 * mantea hacia el oeste llegaría dibujada hacia el este.
 */
export function apparentToSketcherDip(apparentDeg, overturned = false) {
  const theta = apparentDeg >= 0 ? apparentDeg : apparentDeg + 180;
  return overturned ? -theta : theta;
}

/** Color de un tipo, en el `[r, g, b]` que usa el Sketcher. */
function rgbOf(hex) {
  const h = String(hex || '#808080').replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

let seq = 0;
const genId = () => `fd${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Documento de StructuralSketcher.
 *
 * Se emite ya normalizado a lo que su `normalize()` espera: cualquier campo de
 * más que se le mande lo borra al abrir —está preparado para recibir el sidecar
 * del plugin de QGIS— así que no se le manda ninguno, para que lo que se guarda
 * sea exactamente lo que se abre.
 */
export function sketcherDocument(section, { name = 'FieldDraw section', exaggeration = 1 } = {}) {
  const lines = [];

  const topo = section.samples
    .filter((m) => Number.isFinite(m.elevation))
    .map((m) => [m.distance, m.elevation]);
  if (topo.length >= 2) {
    lines.push({
      id: genId(),
      kind: 'topography',
      name: 'Topography',
      vertices: topo,
      visible: true,
      locked: false,
      unit_id: null,
      origin: 'imported',
      style: { color: [230, 237, 243], width: 2, dash: false },
      fault_style: { sense: 'none', flip: false },
    });
  }

  for (const x of section.intersections) {
    if (x.enabled === false) continue;
    const z = elevationAt(section.samples, x.s);
    if (!Number.isFinite(z)) continue;
    const tipo = LINE_TYPE_BY_ID.get(x.type);
    const clase = sectionKindOf(x.type);
    lines.push({
      id: genId(),
      kind: clase === 'fault' ? 'fault' : 'horizon',
      name: tipo ? tipo.label : x.type || 'Intersection',
      // Semilla vertical: dónde corta, no cómo sigue en profundidad.
      vertices: [[x.s, z], [x.s, z - INTERSECTION_SEED_M]],
      visible: true,
      locked: false,
      unit_id: null,
      origin: 'imported',
      style: {
        color: rgbOf(tipo ? tipo.color : '#808080'),
        width: 2,
        dash: x.certainty !== 'observed',
      },
      fault_style: { sense: 'none', flip: false },
    });
  }

  const dips = section.dips
    .filter((d) => Number.isFinite(d.z))
    .map((d) => ({
      id: genId(),
      s: d.s,
      z: d.z,
      dip: apparentToSketcherDip(d.apparent, d.overturned),
      unit_id: null,
      head_radius: 3,
      label: `${Math.round(d.strike)}/${Math.round(d.dip)}`,
    }));

  return {
    app: 'StructuralSketcher',
    version: 1,
    section: {
      id: genId(),
      name,
      length: Math.round(section.length),
      z_min: section.zMin,
      z_max: section.zMax,
      vertical_exaggeration: exaggeration,
      label_left: section.labelLeft || 'W',
      label_right: section.labelRight || 'E',
      display_units: { h: 'km', v: 'm' },
      lines,
      dips,
      horizons: [],
      images: [],
      scalebars: [],
      calibration: { h: null, v: null },
      notes:
        `Projected from FieldDraw. Section azimuth ${Math.round(section.azimuth)}°, ` +
        `length ${Math.round(section.length)} m. Dips carry APPARENT dip on this section; ` +
        `their labels keep the true strike/dip.`,
    },
  };
}
