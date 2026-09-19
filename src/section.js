/**
 * Perfil estructural: proyectar el mapa sobre un corte vertical.
 *
 * Un perfil topográfico dice por dónde va el terreno. Un perfil ESTRUCTURAL
 * añade lo único que permite interpretarlo: dónde corta cada contacto y con qué
 * inclinación entra cada capa en el plano del corte. Eso último no es el manteo
 * medido —salvo que el corte vaya justo en la dirección de manteo— sino el
 * MANTEO APARENTE, que es siempre menor y que a 90° del manteo se hace cero.
 * Dibujar el manteo real sobre un corte oblicuo es el error clásico, y produce
 * secciones que no cierran.
 *
 *     tan(δ_ap) = tan(δ) · cos(az_sección − dirección_de_manteo)
 *
 * Se usa el coseno CON SIGNO y se mete directo en `atan`: así salen de una vez
 * la magnitud y hacia qué lado del corte cae la capa. Es la misma fórmula, la
 * misma convención y el mismo signo que `core/apparent_dip.py` del plugin
 * Structural Modeller, para que una sección hecha aquí y otra hecha allá sobre
 * los mismos datos den lo mismo y se puedan comparar.
 *
 * Sin DOM ni store: aquí solo hay geometría, para poder probarla contra casos
 * conocidos —corte paralelo al manteo, corte paralelo al rumbo— donde la
 * respuesta correcta se sabe de antemano.
 */

import { haversine } from './dem.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Metros por grado, para el marco local. Los mismos que usa structure.js. */
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320;

/**
 * Marco métrico local de una traza.
 *
 * Un rumbo en grados de longitud no significa nada y una distancia menos, así
 * que todo el módulo trabaja en metros sobre un plano tangente centrado en la
 * traza. A la escala de un perfil —decenas de kilómetros— la diferencia con una
 * proyección de verdad es muy inferior al error del DEM.
 */
export function localFrame(coords) {
  const n = coords.length;
  const lng0 = coords.reduce((s, c) => s + c[0], 0) / n;
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / n;
  const cos = Math.cos(lat0 * RAD);
  return {
    origin: [lng0, lat0],
    toXY: (c) => [(c[0] - lng0) * M_PER_DEG_LNG * cos, (c[1] - lat0) * M_PER_DEG_LAT],
    toLngLat: (x, y) => [lng0 + x / (M_PER_DEG_LNG * cos), lat0 + y / M_PER_DEG_LAT],
  };
}

/**
 * La traza del corte, con lo necesario para proyectar sobre ella.
 *
 * La traza puede ser quebrada —un perfil rara vez es una recta— así que el
 * azimut NO es uno solo: cada tramo tiene el suyo, y el manteo aparente de una
 * medida se calcula con el azimut del tramo donde cae. Usar el azimut medio
 * daría un aparente equivocado justo en las esquinas, que es donde el corte
 * suele quebrarse porque cambia la estructura.
 */
export class SectionTrace {
  constructor(coords) {
    if (!Array.isArray(coords) || coords.length < 2) {
      throw new Error('A section trace needs at least two points');
    }
    this.coords = coords;
    this.frame = localFrame(coords);
    this.xy = coords.map((c) => this.frame.toXY(c));

    /** Longitud acumulada hasta cada vértice, en metros. */
    this.cum = [0];
    for (let i = 1; i < coords.length; i++) {
      this.cum.push(this.cum[i - 1] + haversine(coords[i - 1], coords[i]));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  /**
   * Proyecta un punto sobre la traza.
   *
   * @returns {{s: number, offset: number, side: number, segment: number}}
   *   `s` distancia a lo largo del corte, `offset` distancia perpendicular
   *   (siempre positiva) y `side` su signo: +1 a la izquierda del sentido de
   *   avance, −1 a la derecha. El offset es el dato honesto de la proyección:
   *   una medida a cinco kilómetros del corte, dibujada sobre él, es una
   *   ficción, y quien la mire tiene derecho a saberlo.
   */
  project(lngLat) {
    const [px, py] = this.frame.toXY(lngLat);
    let mejor = null;
    for (let i = 1; i < this.xy.length; i++) {
      const [ax, ay] = this.xy[i - 1];
      const [bx, by] = this.xy[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const off = Math.hypot(px - cx, py - cy);
      if (!mejor || off < mejor.offset) {
        // Producto cruz: el signo dice de qué lado del corte cayó.
        const cruz = dx * (py - ay) - dy * (px - ax);
        mejor = {
          s: this.cum[i - 1] + t * (this.cum[i] - this.cum[i - 1]),
          offset: off,
          side: cruz >= 0 ? 1 : -1,
          segment: i - 1,
        };
      }
    }
    return mejor;
  }

  /** Azimut del tramo `i`, en grados desde el Norte. */
  azimuthOfSegment(i) {
    const a = this.xy[Math.max(0, Math.min(i, this.xy.length - 2))];
    const b = this.xy[Math.max(1, Math.min(i + 1, this.xy.length - 1))];
    return (Math.atan2(b[0] - a[0], b[1] - a[1]) * DEG + 360) % 360;
  }

  /** Azimut del corte en la posición `s`. */
  azimuthAt(s) {
    for (let i = 1; i < this.cum.length; i++) {
      if (s <= this.cum[i] || i === this.cum.length - 1) return this.azimuthOfSegment(i - 1);
    }
    return this.azimuthOfSegment(0);
  }

  /** El punto del terreno que corresponde a una posición `s`. */
  lngLatAt(s) {
    const d = Math.max(0, Math.min(s, this.length));
    for (let i = 1; i < this.cum.length; i++) {
      if (d <= this.cum[i]) {
        const t = (d - this.cum[i - 1]) / Math.max(1e-9, this.cum[i] - this.cum[i - 1]);
        const a = this.coords[i - 1];
        const b = this.coords[i];
        return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      }
    }
    return this.coords[this.coords.length - 1];
  }
}

/**
 * Manteo aparente CON SIGNO, en grados.
 *
 * Positivo = la capa baja hacia el sentido de avance del corte (+s). Con el
 * corte paralelo a la dirección de manteo el coseno vale ±1 y el aparente es el
 * manteo real; con el corte paralelo al rumbo vale 0 y la capa sale horizontal,
 * que es exactamente lo que se ve al cortar una capa a lo largo de su rumbo.
 */
export function apparentDip(strikeDeg, dipDeg, sectionAzimuthDeg) {
  const dipDir = (strikeDeg + 90) % 360;
  const beta = (sectionAzimuthDeg - dipDir) * RAD;
  return Math.atan(Math.tan(dipDeg * RAD) * Math.cos(beta)) * DEG;
}

/**
 * Manteo aparente de una LINEACIÓN, en grados con signo.
 *
 * Al revés que un plano: la inclinación aparente de una línea AUMENTA al
 * apartarse el corte de su rumbo, porque la componente horizontal se acorta
 * mientras la vertical no cambia, hasta hacerse vertical a 90°. Se calcula con
 * `atan2` para que ese límite sea exacto y no una división por cero.
 */
export function apparentPlunge(trendDeg, plungeDeg, sectionAzimuthDeg) {
  const beta = (sectionAzimuthDeg - trendDeg) * RAD;
  const p = plungeDeg * RAD;
  const horiz = Math.cos(p) * Math.abs(Math.cos(beta));
  const app = Math.atan2(Math.sin(p), horiz) * DEG;
  return Math.cos(beta) >= 0 ? app : -app;
}

/**
 * Proyección a lo largo de una tendencia/inclinación (down-plunge), en vez de
 * la perpendicular de siempre.
 *
 * Se usa para estructuras con un eje conocido —un pliegue, una lineación—
 * donde deslizar el dato PERPENDICULAR al corte lo saca de la superficie que
 * en realidad ocupa. Aquí en cambio se desliza el punto en 3D siguiendo la
 * dirección `trend`/`plunge` hasta topar con el plano vertical que contiene
 * el tramo del corte: la posición a lo largo del perfil y la cota cambian las
 * dos, porque es un desplazamiento en el espacio y no solo en el mapa.
 *
 * Sin cota no hay tercera dimensión que seguir, así que sin ella no se puede
 * proyectar por esta vía: se descarta en vez de fingir un desplazamiento solo
 * horizontal que no es lo que este modo promete.
 *
 * @returns {{s: number, z: number, offset: number, side: number}|null}
 */
function projectAlongPlunge(trace, lngLat, elevation, trendDeg, plungeDeg) {
  if (!Number.isFinite(elevation)) return null;
  const [px, py] = trace.frame.toXY(lngLat);
  const trendRad = trendDeg * RAD;
  // Vector horizontal unitario de la tendencia (x = este, y = norte, como el
  // resto del marco métrico de `localFrame`).
  const hx = Math.sin(trendRad);
  const hy = Math.cos(trendRad);
  const tanPlunge = Math.tan(plungeDeg * RAD);

  let mejor = null;
  for (let i = 1; i < trace.xy.length; i++) {
    const [ax, ay] = trace.xy[i - 1];
    const [bx, by] = trace.xy[i];
    const rx = bx - ax;
    const ry = by - ay;
    const dx = px - ax;
    const dy = py - ay;
    // Corte de la recta de tendencia (desde el punto) con la recta del tramo,
    // resuelto de una vez para sus dos parámetros: `t` a lo largo del tramo,
    // `k` a lo largo de la tendencia (con signo: + hacia donde apunta `trend`).
    const det = hx * ry - hy * rx;
    if (Math.abs(det) < 1e-9) continue; // el tramo va paralelo a la tendencia: no se cruzan
    const t = (-dx * hy + hx * dy) / det;
    const k = (rx * dy - ry * dx) / det;
    if (t < 0 || t > 1) continue; // el cruce cae fuera de este tramo del corte
    const dist = Math.abs(k);
    if (!mejor || dist < mejor.dist) {
      mejor = {
        s: trace.cum[i - 1] + t * (trace.cum[i] - trace.cum[i - 1]),
        // Avanzar en el sentido de `trend` desciende `tan(plunge)` por metro
        // horizontal; retroceder (k negativo) asciende, por la misma cuenta.
        z: elevation - k * tanPlunge,
        offset: dist,
        side: k >= 0 ? 1 : -1,
        dist,
      };
    }
  }
  return mejor;
}

/**
 * Proyecta medidas de rumbo y manteo sobre la traza.
 *
 * @param {Array} measurements  features de punto con strike/dip y `elevation`
 * @param {SectionTrace} trace
 * @param {object} [opts]
 * @param {number} [opts.maxOffset]  descarta lo que esté más lejos del corte
 * @param {'orthogonal'|'plunge'} [opts.method]  cómo se desliza el dato hasta
 *   el corte: perpendicular (de siempre) o a lo largo de un trend/plunge.
 * @param {number} [opts.trend]   solo con `method: 'plunge'`
 * @param {number} [opts.plunge]  solo con `method: 'plunge'`
 * @returns {Array} una entrada por medida proyectada, ordenada por `s`
 */
export function projectMeasurements(
  measurements,
  trace,
  { maxOffset = Infinity, method = 'orthogonal', trend = 0, plunge = 0 } = {},
) {
  const out = [];
  for (const m of measurements) {
    const lngLat = m.lngLat || (m.geometry && m.geometry.coordinates);
    if (!lngLat) continue;

    const props = m.properties || m;
    const strike = Number(props.strike);
    const dip = Number(props.dip);
    if (!Number.isFinite(strike) || !Number.isFinite(dip)) continue;

    const p =
      method === 'plunge'
        ? projectAlongPlunge(trace, lngLat, m.elevation, trend, plunge)
        : trace.project(lngLat);
    if (!p || p.offset > maxOffset) continue;

    const az = trace.azimuthAt(p.s);
    out.push({
      id: props.id,
      lngLat,
      s: p.s,
      z: Number.isFinite(p.z) ? p.z : Number.isFinite(m.elevation) ? m.elevation : null,
      offset: p.offset,
      side: p.side,
      strike,
      dip,
      type: props.type || 'bedding',
      overturned: !!props.overturned,
      sectionAzimuth: az,
      apparent: apparentDip(strike, dip, az),
      /*
       * Cuánto se ha achatado el manteo al proyectarlo. Cerca de cero el corte
       * va casi paralelo al rumbo y el aparente no dice casi nada de la
       * estructura: es el aviso que evita interpretar una capa horizontal
       * donde lo que hay es una capa vista de canto.
       */
      foreshortening: dip > 0 ? Math.abs(apparentDip(strike, dip, az)) / dip : 1,
    });
  }
  return out.sort((a, b) => a.s - b.s);
}

/**
 * Dónde corta el perfil a cada línea del mapa.
 *
 * Es la otra mitad de un perfil interpretable: sin saber en qué kilómetro entra
 * la falla, los manteos proyectados flotan sin referencia. Se resuelve
 * segmento contra segmento en el marco métrico —una intersección en grados de
 * longitud está deformada por el coseno de la latitud— y se devuelve cada corte
 * con su posición a lo largo del perfil.
 *
 * Una misma línea puede cortar varias veces: un contacto plegado cruza el
 * perfil en cada charnela, y esas repeticiones son el dato, no un problema.
 */
export function intersections(trace, features) {
  const out = [];
  const { toXY } = trace.frame;

  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const partes =
      g.type === 'LineString'
        ? [g.coordinates]
        : g.type === 'MultiLineString'
          ? g.coordinates
          : g.type === 'Polygon'
            ? g.coordinates
            : g.type === 'MultiPolygon'
              ? g.coordinates.flat()
              : [];

    for (const parte of partes) {
      for (let i = 1; i < parte.length; i++) {
        const p1 = toXY(parte[i - 1]);
        const p2 = toXY(parte[i]);
        for (let j = 1; j < trace.xy.length; j++) {
          const q1 = trace.xy[j - 1];
          const q2 = trace.xy[j];
          const cruce = segmentIntersection(p1, p2, q1, q2);
          if (!cruce) continue;
          const s = trace.cum[j - 1] + cruce.u * (trace.cum[j] - trace.cum[j - 1]);
          out.push({
            id: f.properties && f.properties.id,
            type: (f.properties && f.properties.type) || '',
            kind: (f.properties && f.properties.kind) || 'line',
            certainty: (f.properties && f.properties.certainty) || 'observed',
            unit: (f.properties && f.properties.unit) || '',
            s,
            lngLat: trace.lngLatAt(s),
            /* Marcadas por omisión: quien hace el perfil quiere verlas, y
             * apagar las que estorban es más rápido que encender veinte. */
            enabled: true,
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

/**
 * Corte de dos segmentos. Devuelve los parámetros de cada uno o null.
 *
 * Se descartan los paralelos por el determinante y no por comparar ángulos: es
 * una sola resta y no tiene el problema de qué tolerancia usar en grados.
 */
export function segmentIntersection(a1, a2, b1, b2) {
  const rx = a2[0] - a1[0];
  const ry = a2[1] - a1[1];
  const sx = b2[0] - b1[0];
  const sy = b2[1] - b1[1];
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const t = ((b1[0] - a1[0]) * sy - (b1[1] - a1[1]) * sx) / den;
  const u = ((b1[0] - a1[0]) * ry - (b1[1] - a1[1]) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, point: [a1[0] + t * rx, a1[1] + t * ry] };
}

/**
 * La cota del terreno en una posición del perfil.
 *
 * Vive aquí y no en el dibujo porque la necesitan las dos exportaciones tanto
 * como la vista: una intersección sin su cota es media coordenada.
 */
export function elevationAt(samples, s) {
  if (!samples || samples.length === 0) return NaN;
  let mejor = null;
  for (const m of samples) {
    const d = Math.abs(m.distance - s);
    if (!mejor || d < mejor.d) mejor = { d, z: m.elevation };
  }
  return mejor ? mejor.z : NaN;
}

/**
 * Rango vertical del corte, redondeado a números que se puedan rotular.
 *
 * Se deja margen arriba y abajo del terreno: el perfil se dibuja para
 * interpretar debajo de la topografía, así que empezar el eje justo en la cota
 * mínima no deja sitio donde poner nada.
 */
export function verticalRange(samples, { below = 0.5, above = 0.15 } = {}) {
  const cotas = samples.map((m) => m.elevation).filter((v) => Number.isFinite(v));
  if (cotas.length === 0) return { zMin: 0, zMax: 1000 };
  const min = Math.min(...cotas);
  const max = Math.max(...cotas);
  const rango = Math.max(1, max - min);
  return {
    zMin: Math.floor((min - rango * below) / 100) * 100,
    zMax: Math.ceil((max + rango * above) / 100) * 100,
  };
}

/**
 * Todo lo que necesita el perfil estructural, en una estructura.
 *
 * @param {object} opts
 * @param {Array} opts.coords         la traza del perfil, en lng/lat
 * @param {object} opts.profile       el resultado del muestreo topográfico
 * @param {Array} opts.measurements   medidas con su cota ya resuelta
 * @param {Array} opts.features       el dibujo, para las intersecciones
 * @param {number} [opts.maxOffset]
 * @param {object} [opts.projection]  `{method, trend, plunge}`, ver `projectMeasurements`
 */
export function buildSection({ coords, profile, measurements = [], features = [], maxOffset, projection }) {
  const trace = new SectionTrace(coords);
  const dips = projectMeasurements(measurements, trace, { maxOffset, ...projection });
  const cruces = intersections(trace, features);
  const { zMin, zMax } = verticalRange(profile ? profile.samples : []);
  return {
    trace,
    coords,
    length: trace.length,
    azimuth: trace.azimuthAt(trace.length / 2),
    samples: profile ? profile.samples : [],
    dips,
    intersections: cruces,
    zMin,
    zMax,
    source: profile ? profile.label : '',
  };
}
