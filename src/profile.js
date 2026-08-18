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
  svg.appendChild(el('path', { d: profilePath(result.samples, s), class: 'pf-line' }));

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
