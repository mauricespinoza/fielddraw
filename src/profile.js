import { DEM_VERTICAL_SIGMA_M } from './dem.js';

/**
 * Gráfico del perfil topográfico.
 *
 * Se dibuja como SVG a mano y no con una librería de gráficos por la misma
 * razón por la que el resto de la app no tiene bundler: una librería de charts
 * son cientos de KB en `vendor/` para pintar una polilínea con dos ejes.
 *
 * La parte de cálculo (escalas, marcas de los ejes, camino) está separada del
 * DOM para poder comprobarla sin navegador.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Márgenes del área de dibujo dentro del lienzo. */
export const MARGIN = { top: 10, right: 14, bottom: 24, left: 52 };

/**
 * Span vertical mínimo del eje, en metros.
 *
 * Sin este suelo, un perfil sobre terreno plano estira el error del DEM hasta
 * llenar el gráfico y se lee como si hubiera relieve. Cuatro sigmas es el
 * punto a partir del cual el desnivel dibujado es señal y no ruido.
 */
export const MIN_SPAN_M = 4 * DEM_VERTICAL_SIGMA_M;

/**
 * Paso "redondo" inmediatamente superior al ideal: 1, 2, 5 o 10 por década.
 * Es lo que hace que las marcas caigan en 250 y no en 237.
 */
export function niceStep(span, target = 5) {
  if (!(span > 0)) return 1;
  const bruto = span / Math.max(1, target);
  const decada = 10 ** Math.floor(Math.log10(bruto));
  const norm = bruto / decada;
  const paso = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return paso * decada;
}

/** Marcas de un eje entre min y max, alineadas a múltiplos del paso. */
export function axisTicks(min, max, target = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const paso = niceStep(max - min, target);
  const out = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + paso * 1e-9; v += paso) {
    out.push(Number(v.toFixed(10)));
  }
  return out;
}

/**
 * Escalas del gráfico. El eje vertical se amplía un 8 % por arriba y por abajo
 * para que la curva no toque los bordes, y nunca por debajo de `MIN_SPAN_M`.
 */
export function profileScales(result, width, height) {
  const { samples, stats } = result;
  const total = samples.length ? samples[samples.length - 1].distance : 0;

  let min = Number.isFinite(stats.min) ? stats.min : 0;
  let max = Number.isFinite(stats.max) ? stats.max : 0;
  const span = max - min;
  if (span < MIN_SPAN_M) {
    const centro = (max + min) / 2;
    min = centro - MIN_SPAN_M / 2;
    max = centro + MIN_SPAN_M / 2;
  } else {
    min -= span * 0.08;
    max += span * 0.08;
  }

  const plotW = Math.max(1, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(1, height - MARGIN.top - MARGIN.bottom);

  return {
    total,
    yMin: min,
    yMax: max,
    plotW,
    plotH,
    x: (d) => MARGIN.left + (total > 0 ? (d / total) * plotW : 0),
    y: (e) => MARGIN.top + plotH - ((e - min) / (max - min)) * plotH,
    /** Distancia que corresponde a una coordenada x del lienzo. */
    distanceAt: (px) => (total * (px - MARGIN.left)) / plotW,
  };
}

/**
 * Alto del SVG para que el perfil salga a una exageración vertical dada
 * (1 = escala 1:1 real). El ancho fija los metros por píxel y el alto sale del
 * rango de cotas, igual que en el corte estructural.
 */
export function profileHeightFor(result, width, exaggeration = 1) {
  const s = profileScales(result, width, 100);
  if (!(s.total > 0)) return 110;
  const plotH = ((s.yMax - s.yMin) * s.plotW * exaggeration) / s.total;
  return Math.max(60, Math.ceil(plotH + MARGIN.top + MARGIN.bottom));
}

/**
 * Camino de la curva. Un tramo sin dato **corta** el camino en vez de saltarlo
 * con una recta: unir los dos extremos de un hueco dibujaría una ladera que
 * nadie midió.
 */
export function profilePath(samples, s) {
  let d = '';
  let abierto = false;
  for (const m of samples) {
    if (!Number.isFinite(m.elevation)) {
      abierto = false;
      continue;
    }
    const px = s.x(m.distance).toFixed(2);
    const py = s.y(m.elevation).toFixed(2);
    d += `${abierto ? 'L' : 'M'}${px} ${py}`;
    abierto = true;
  }
  return d;
}

/**
 * Los mismos tramos, cerrados contra la base para poder rellenarlos. Cada
 * tramo continuo se cierra por separado, así el relleno tampoco cruza un hueco.
 */
export function profileAreaPath(samples, s) {
  const base = (MARGIN.top + s.plotH).toFixed(2);
  let d = '';
  let tramo = [];

  const volcar = () => {
    if (tramo.length >= 2) {
      d += `M${tramo[0][0]} ${base}`;
      for (const [px, py] of tramo) d += `L${px} ${py}`;
      d += `L${tramo[tramo.length - 1][0]} ${base}Z`;
    }
    tramo = [];
  };

  for (const m of samples) {
    if (!Number.isFinite(m.elevation)) {
      volcar();
      continue;
    }
    tramo.push([s.x(m.distance).toFixed(2), s.y(m.elevation).toFixed(2)]);
  }
  volcar();
  return d;
}

/* -------------------------------------------------------------- pendiente */

/**
 * Clases de pendiente local, en grados: límite SUPERIOR de cada clase; la
 * última clase es «más de 40°». Son cortes fijos, y no cuantiles del perfil,
 * a propósito: un mismo color tiene que decir la misma pendiente en dos
 * perfiles distintos, o la paleta no se puede comparar entre trazas.
 */
export const SLOPE_BREAKS = [2, 5, 10, 15, 20, 25, 30, 40];

/** Paleta fría → cálida, una entrada por clase (`SLOPE_BREAKS.length + 1`). */
export const SLOPE_COLORS = [
  '#2b50c8', '#2f86d6', '#25b0c9', '#3cbf86', '#9ccf3a',
  '#f2c12e', '#f08a24', '#e34a20', '#b5121b',
];

/** Clase de una pendiente en grados (0 … `SLOPE_BREAKS.length`). */
export function slopeClass(deg) {
  let c = 0;
  while (c < SLOPE_BREAKS.length && deg >= SLOPE_BREAKS[c]) c++;
  return c;
}

const DEG = 180 / Math.PI;

/**
 * Pendiente local de cada tramo entre dos muestras consecutivas, en grados
 * (siempre positiva: aquí importa cuán empinado es, no hacia dónde). Un tramo
 * que toca un hueco del DEM, o sin avance horizontal, queda en `NaN`.
 *
 * Una sola pasada y un `Float32Array`: con 600 muestras son 600 restas, que es
 * todo el costo de colorear la curva.
 */
export function segmentSlopes(samples) {
  const n = Math.max(0, samples.length - 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const dd = b.distance - a.distance;
    out[i] = Number.isFinite(a.elevation) && Number.isFinite(b.elevation) && dd > 0
      ? Math.atan(Math.abs(b.elevation - a.elevation) / dd) * DEG
      : NaN;
  }
  return out;
}

/**
 * Pendiente media de la ruta: el desnivel ACUMULADO (subidas más bajadas,
 * tramo a tramo) sobre la distancia horizontal con dato. Es la media de las
 * pendientes locales ponderada por el largo de cada tramo, en %, y su ángulo.
 * No es la pendiente entre los extremos: un perfil que sube y vuelve a bajar
 * a la misma cota tiene pendiente media, aunque su desnivel neto sea cero.
 *
 * @returns {{percent: number, degrees: number}|null}
 */
export function meanSlope(samples) {
  let dz = 0;
  let dd = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const paso = b.distance - a.distance;
    if (!Number.isFinite(a.elevation) || !Number.isFinite(b.elevation) || !(paso > 0)) continue;
    dz += Math.abs(b.elevation - a.elevation);
    dd += paso;
  }
  if (!(dd > 0)) return null;
  const g = dz / dd;
  return { percent: g * 100, degrees: Math.atan(g) * DEG };
}

/** Pendiente legible: grados y porcentaje. */
export function formatSlope(sl) {
  if (!sl || !Number.isFinite(sl.degrees)) return '—';
  return `${sl.degrees.toFixed(1)}° (${Math.round(sl.percent)} %)`;
}

/**
 * La curva partida por clase de pendiente: un `d` por color.
 *
 * Un `<path>` por tramo serían cientos de nodos SVG que el navegador tiene que
 * mantener y repintar; aquí son a lo sumo nueve, y cada tramo se agrega al de
 * su clase continuando el trazo cuando el anterior era de la misma clase. Una
 * sola pasada sobre las muestras.
 *
 * @returns {string[]} un camino por clase (vacío si no hay tramos de ella)
 */
export function profileSlopePaths(samples, s, slopes = segmentSlopes(samples)) {
  const d = SLOPE_COLORS.map(() => '');
  let prev = -1; // clase del tramo anterior, si quedó abierto
  for (let i = 0; i < slopes.length; i++) {
    const g = slopes[i];
    if (!Number.isFinite(g)) {
      prev = -1;
      continue;
    }
    const c = slopeClass(g);
    const b = samples[i + 1];
    if (c !== prev) {
      const a = samples[i];
      d[c] += `M${s.x(a.distance).toFixed(2)} ${s.y(a.elevation).toFixed(2)}`;
    }
    d[c] += `L${s.x(b.distance).toFixed(2)} ${s.y(b.elevation).toFixed(2)}`;
    prev = c;
  }
  return d;
}

/** Rótulos de la leyenda: «<2», «2–5», … «>40». */
export function slopeLegend() {
  return SLOPE_COLORS.map((color, i) => ({
    color,
    label: i === 0
      ? `<${SLOPE_BREAKS[0]}`
      : i === SLOPE_BREAKS.length
        ? `>${SLOPE_BREAKS[i - 1]}`
        : `${SLOPE_BREAKS[i - 1]}–${SLOPE_BREAKS[i]}`,
  }));
}

/** Distancia legible: metros por debajo de 1 km, kilómetros por encima. */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function formatElevation(m) {
  return Number.isFinite(m) ? `${Math.round(m)} m` : '—';
}

/** El perfil como CSV, para llevárselo a una hoja de cálculo o a Python. */
export function profileCSV(result) {
  const filas = ['distance_m,longitude,latitude,elevation_m'];
  for (const m of result.samples) {
    filas.push(
      [
        m.distance.toFixed(2),
        m.lngLat[0].toFixed(7),
        m.lngLat[1].toFixed(7),
        Number.isFinite(m.elevation) ? m.elevation.toFixed(2) : '',
      ].join(','),
    );
  }
  return filas.join('\n');
}

/** Muestra más cercana a una distancia dada; devuelve su índice. */
export function indexAtDistance(samples, distance) {
  if (samples.length === 0) return -1;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].distance < distance) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(samples[lo - 1].distance - distance) < Math.abs(samples[lo].distance - distance)) {
    return lo - 1;
  }
  return lo;
}

/* ---------------------------------------------------------------- dibujo */

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/**
 * Pinta el perfil dentro de un `<svg>` ya existente y devuelve un puñado de
 * manejadores para mover el cursor sin volver a dibujar todo.
 *
 * @returns {{scales: object, width: number, setCursor: (i: number) => void}}
 */
export function renderProfileChart(svg, result, { width, height }) {
  const s = profileScales(result, width, height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const plotTop = MARGIN.top;
  const plotBottom = MARGIN.top + s.plotH;
  const plotRight = MARGIN.left + s.plotW;

  /* --- rejilla y eje de cotas --- */
  for (const v of axisTicks(s.yMin, s.yMax, 4)) {
    const y = s.y(v);
    if (y < plotTop - 0.5 || y > plotBottom + 0.5) continue;
    svg.appendChild(
      el('line', { x1: MARGIN.left, y1: y, x2: plotRight, y2: y, class: 'pf-grid' }),
    );
    const t = el('text', { x: MARGIN.left - 6, y: y + 3.5, class: 'pf-axis pf-axis-y' });
    t.textContent = String(Math.round(v));
    svg.appendChild(t);
  }

  /* --- eje de distancias --- */
  for (const v of axisTicks(0, s.total, 5)) {
    if (v < 0 || v > s.total) continue;
    const x = s.x(v);
    svg.appendChild(
      el('line', { x1: x, y1: plotTop, x2: x, y2: plotBottom, class: 'pf-grid pf-grid-v' }),
    );
    const t = el('text', { x, y: plotBottom + 15, class: 'pf-axis pf-axis-x' });
    t.textContent = formatDistance(v);
    svg.appendChild(t);
  }

  /* --- la curva --- */
  svg.appendChild(el('path', { d: profileAreaPath(result.samples, s), class: 'pf-area' }));
  // La línea va coloreada por la pendiente local de cada tramo (ver
  // `profileSlopePaths`): a lo sumo un trazo por clase, no uno por tramo.
  const slopes = segmentSlopes(result.samples);
  profileSlopePaths(result.samples, s, slopes).forEach((d, c) => {
    if (d) svg.appendChild(el('path', { d, class: 'pf-line', style: `stroke:${SLOPE_COLORS[c]}` }));
  });

  /* --- cursor --- */
  const cursor = el('g', { class: 'pf-cursor', visibility: 'hidden' });
  const vline = el('line', { y1: plotTop, y2: plotBottom, class: 'pf-cursor-line' });
  const dot = el('circle', { r: 4, class: 'pf-cursor-dot' });
  cursor.append(vline, dot);
  svg.appendChild(cursor);

  return {
    scales: s,
    /** Ancho del viewBox, para convertir píxeles de pantalla a coordenadas. */
    width,
    /** Pendiente local (°) del tramo que llega a la muestra `i`, o el que sale de ella. */
    slopeAt(i) {
      const g = i > 0 ? slopes[i - 1] : slopes[0];
      return Number.isFinite(g) ? g : Number.isFinite(slopes[i]) ? slopes[i] : NaN;
    },
    setCursor(i) {
      const m = result.samples[i];
      if (!m || !Number.isFinite(m.elevation)) {
        cursor.setAttribute('visibility', 'hidden');
        return;
      }
      const x = s.x(m.distance);
      const y = s.y(m.elevation);
      vline.setAttribute('x1', String(x));
      vline.setAttribute('x2', String(x));
      dot.setAttribute('cx', String(x));
      dot.setAttribute('cy', String(y));
      cursor.setAttribute('visibility', 'visible');
    },
  };
}

/* ==================================== guardar la traza como figura === */

/**
 * Rótulo del extremo de una traza: la letra del cuadrante hacia el que mira.
 *
 * Un perfil se cita por sus extremos —«perfil W-E»— y ponerlos es lo que
 * permite orientar la figura sin volver al mapa. Vive aquí, y no en el corte
 * estructural, porque los dos dibujan la misma traza y el rótulo tiene que
 * decir lo mismo en las dos figuras.
 */
export function endLabel(azimuth) {
  const a = ((azimuth % 360) + 360) % 360;
  const nombres = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return nombres[Math.round(a / 45) % 8];
}

/** Azimut del extremo final de la traza respecto del inicial, en grados. */
export function traceAzimuth(samples) {
  const a = samples.find((m) => Array.isArray(m.lngLat));
  const b = [...samples].reverse().find((m) => Array.isArray(m.lngLat));
  if (!a || !b || a === b) return 90;
  const lat1 = (a.lngLat[1] * Math.PI) / 180;
  const lat2 = (b.lngLat[1] * Math.PI) / 180;
  const dLon = ((b.lngLat[0] - a.lngLat[0]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Exageración vertical REAL de la figura, que es el dato que la vuelve
 * publicable.
 *
 * Un perfil topográfico dibujado para que quepa en un recuadro casi nunca está
 * a escala 1:1: unos kilómetros a lo largo contra unos cientos de metros de
 * desnivel dan, en un gráfico apaisado, factores de diez o de veinte. Mientras
 * se mira en pantalla da igual —se lee la curva, no la pendiente—, pero en
 * cuanto la figura sale a un informe alguien va a medir un ángulo sobre ella.
 * Rotularla es la diferencia entre una figura y una figura engañosa.
 */
export function verticalExaggeration(s) {
  if (!(s.total > 0) || !(s.yMax > s.yMin)) return NaN;
  const mppX = s.total / s.plotW;
  const mppY = (s.yMax - s.yMin) / s.plotH;
  return mppX / mppY;
}

/**
 * Márgenes de la figura exportada.
 *
 * Bastante más aire que en pantalla, y la razón está en los cuatro rótulos que
 * la figura lleva y el panel no: arriba, el título y las letras de los extremos
 * de la traza, que van en renglones distintos; abajo, el título del eje, el
 * resumen de cotas y la procedencia del dato. Con los márgenes de pantalla se
 * pisaban unos a otros.
 */
const FIG_MARGIN = { top: 58, right: 26, bottom: 96, left: 72 };

const FIG_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";

/**
 * La figura del perfil como un `<svg>` suelto y autocontenido.
 *
 * NO se exporta el SVG que está en pantalla, y el motivo es doble. Ese va con
 * `preserveAspectRatio="none"` —se estira al alto que tenga la hoja, así que
 * fuera de su caja saldría deformado— y se pinta con clases de `app.css`, que
 * en un archivo suelto no existen: el resultado sería un gráfico sin color ni
 * ejes. Aquí se vuelve a dibujar a un tamaño fijo y con los estilos escritos
 * en cada elemento, así que el archivo se abre igual en Illustrator, en un
 * navegador o dentro de un Word.
 *
 * Lo que se añade respecto de la pantalla es lo que una figura necesita y un
 * panel no: rótulos de los extremos, el resumen de cotas, la exageración
 * vertical y la procedencia del dato.
 *
 * @param {object} result            lo que hay en `store.getState().profile`
 * @param {object} [opts]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {'dark'|'light'} [opts.theme]
 * @param {string} [opts.title]
 * @returns {SVGElement} desligado del documento; no hace falta insertarlo
 */
export function profileFigure(result, opts = {}) {
  const { width = 1200, height = 560, theme = 'light', title = 'Topographic profile' } = opts;

  const c =
    theme === 'dark'
      ? { bg: '#0d1117', fg: '#e6edf3', muted: '#93a1b0', grid: '#243044' }
      : { bg: '#ffffff', fg: '#111827', muted: '#6b7280', grid: '#e5e7eb' };
  const relleno = theme === 'dark' ? 'rgba(255,179,0,0.18)' : 'rgba(224,135,0,0.16)';

  const svg = el('svg', {
    xmlns: SVG_NS,
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    'font-family': FIG_FONT,
  });
  svg.appendChild(el('rect', { x: 0, y: 0, width, height, fill: c.bg }));

  /*
   * Las escalas se calculan con los márgenes de PANTALLA sobre un lienzo
   * encogido, y luego el grupo entero se desplaza. Así `profileScales`,
   * `profilePath` y `profileAreaPath` —que son las funciones probadas— siguen
   * valiendo tal cual, en vez de tener una segunda versión de la geometría que
   * pueda separarse de la primera.
   */
  const s = profileScales(
    result,
    width - (FIG_MARGIN.left - MARGIN.left) - (FIG_MARGIN.right - MARGIN.right),
    height - (FIG_MARGIN.top - MARGIN.top) - (FIG_MARGIN.bottom - MARGIN.bottom),
  );
  const dx = FIG_MARGIN.left - MARGIN.left;
  const dy = FIG_MARGIN.top - MARGIN.top;

  const plot = el('g', { transform: `translate(${dx} ${dy})` });

  const plotTop = MARGIN.top;
  const plotBottom = MARGIN.top + s.plotH;
  const plotRight = MARGIN.left + s.plotW;

  /* --- rejilla y cotas --- */
  for (const v of axisTicks(s.yMin, s.yMax, 5)) {
    const y = s.y(v);
    if (y < plotTop - 0.5 || y > plotBottom + 0.5) continue;
    plot.appendChild(
      el('line', {
        x1: MARGIN.left, y1: y, x2: plotRight, y2: y, stroke: c.grid, 'stroke-width': 1,
      }),
    );
    const t = el('text', {
      x: MARGIN.left - 8, y: y + 4, fill: c.muted, 'font-size': 12, 'text-anchor': 'end',
    });
    t.textContent = String(Math.round(v));
    plot.appendChild(t);
  }

  /* --- rejilla y distancias --- */
  for (const v of axisTicks(0, s.total, 6)) {
    if (v < 0 || v > s.total) continue;
    const x = s.x(v);
    plot.appendChild(
      el('line', {
        x1: x, y1: plotTop, x2: x, y2: plotBottom, stroke: c.grid, 'stroke-width': 1,
      }),
    );
    const t = el('text', {
      x, y: plotBottom + 20, fill: c.muted, 'font-size': 12, 'text-anchor': 'middle',
    });
    t.textContent = formatDistance(v);
    plot.appendChild(t);
  }

  /* --- la curva --- */
  plot.appendChild(el('path', { d: profileAreaPath(result.samples, s), fill: relleno }));
  profileSlopePaths(result.samples, s).forEach((d, ci) => {
    if (!d) return;
    plot.appendChild(
      el('path', {
        d,
        fill: 'none',
        stroke: SLOPE_COLORS[ci],
        'stroke-width': 2.4,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
    );
  });

  /* --- marco del área de dibujo --- */
  plot.appendChild(
    el('rect', {
      x: MARGIN.left, y: plotTop, width: s.plotW, height: s.plotH,
      fill: 'none', stroke: c.muted, 'stroke-width': 1, opacity: 0.6,
    }),
  );

  /* --- títulos de los ejes --- */
  const ejeY = el('text', {
    x: -(plotTop + s.plotH / 2), y: MARGIN.left - 48, fill: c.muted, 'font-size': 12,
    'text-anchor': 'middle', transform: 'rotate(-90)',
  });
  ejeY.textContent = 'Elevation (m)';
  plot.appendChild(ejeY);

  const ejeX = el('text', {
    x: MARGIN.left + s.plotW / 2, y: plotBottom + 42, fill: c.muted, 'font-size': 12,
    'text-anchor': 'middle',
  });
  // El título del eje va centrado y el resumen del pie empieza a la izquierda:
  // si se acercan, el primero se mete dentro del segundo sin que nada avise.
  ejeX.textContent = 'Distance along the trace';
  plot.appendChild(ejeX);

  /* --- extremos de la traza --- */
  const az = traceAzimuth(result.samples);
  const izq = el('text', {
    x: MARGIN.left, y: plotTop - 10, fill: c.fg, 'font-size': 15, 'font-weight': 700,
  });
  izq.textContent = endLabel(az + 180);
  const der = el('text', {
    x: plotRight, y: plotTop - 10, fill: c.fg, 'font-size': 15, 'font-weight': 700,
    'text-anchor': 'end',
  });
  der.textContent = endLabel(az);
  plot.append(izq, der);

  /* --- leyenda de la pendiente local, a la derecha bajo el eje --- */
  const leyenda = slopeLegend();
  const sw = 34;
  const lx0 = plotRight - sw * leyenda.length;
  const ly = plotBottom + 28;
  const lt = el('text', {
    x: lx0 - 8, y: ly + 8, fill: c.muted, 'font-size': 11, 'text-anchor': 'end',
  });
  lt.textContent = 'Local slope (°)';
  plot.appendChild(lt);
  leyenda.forEach((k, i) => {
    plot.appendChild(el('rect', { x: lx0 + i * sw, y: ly, width: sw - 2, height: 6, fill: k.color }));
    const t = el('text', {
      x: lx0 + i * sw + (sw - 2) / 2, y: ly + 16, fill: c.muted, 'font-size': 9.5, 'text-anchor': 'middle',
    });
    t.textContent = k.label;
    plot.appendChild(t);
  });

  svg.appendChild(plot);

  /* --- título --- */
  const h = el('text', {
    x: FIG_MARGIN.left, y: 24, fill: c.fg, 'font-size': 17, 'font-weight': 700,
  });
  h.textContent = title;
  svg.appendChild(h);

  /* --- resumen y procedencia, al pie --- */
  const { stats } = result;
  const ve = verticalExaggeration(s);
  const resumen = [
    `Length ${formatDistance(stats.length)}`,
    `Min ${formatElevation(stats.min)}`,
    `Max ${formatElevation(stats.max)}`,
    `Relief ${formatElevation(stats.max - stats.min)}`,
    `Ascent ${formatElevation(stats.gain)}`,
    `Descent ${formatElevation(stats.loss)}`,
    `Mean slope ${formatSlope(meanSlope(result.samples))}`,
  ];
  if (Number.isFinite(ve)) {
    resumen.push(`Vertical exaggeration x${ve < 10 ? ve.toFixed(1) : Math.round(ve)}`);
  }
  const linea1 = el('text', { x: FIG_MARGIN.left, y: height - 34, fill: c.fg, 'font-size': 12.5 });
  linea1.textContent = resumen.join('   ·   ');
  svg.appendChild(linea1);

  const linea2 = el('text', { x: FIG_MARGIN.left, y: height - 14, fill: c.muted, 'font-size': 11 });
  linea2.textContent =
    `${result.label} · nominal resolution ≈ ${Math.round(result.nominal)} m · ` +
    `${stats.samples} samples. Detail finer than the DEM's resolution is interpolation, not data.`;
  svg.appendChild(linea2);

  return svg;
}

/** El preámbulo que necesita un SVG para ser un archivo y no un fragmento. */
function serialise(svg) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

/** La figura como texto SVG, lista para guardar. */
export function profileSVG(result, opts = {}) {
  return serialise(profileFigure(result, opts));
}

/**
 * PNG a partir de la misma figura, rasterizada a `scale` veces su tamaño.
 *
 * Sale del SVG y no de un canvas propio para que las dos salidas no puedan
 * separarse: lo que se ve en el PNG es, píxel a píxel, el vector.
 */
export function profilePNG(result, { scale = 2, ...opts } = {}) {
  return new Promise((resolve, reject) => {
    const svg = profileFigure(result, opts);
    const w = Number(svg.getAttribute('width'));
    const h = Number(svg.getAttribute('height'));
    const url = URL.createObjectURL(new Blob([serialise(svg)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('The canvas produced no image'));
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The SVG could not be rasterised'));
    };
    img.src = url;
  });
}
