/**
 * Dibujo del perfil estructural, y sus exportaciones.
 *
 * Se dibuja en SVG y no en canvas por una razón práctica: lo que sale de aquí
 * termina en una figura de una memoria o de un paper, y un SVG se abre en
 * Illustrator o en Inkscape y se retoca. Un PNG se genera desde el mismo SVG,
 * así que las dos salidas no pueden desalinearse.
 *
 * La convención que hay que tener presente al mirarlo: los ticks de manteo se
 * dibujan con el ángulo que se VE en pantalla, no con el aparente puro. Con
 * exageración vertical la geometría del corte se deforma, y un tick trazado al
 * ángulo verdadero quedaría descolgado de las capas dibujadas a su lado. El
 * número que se rotula sí es el aparente real, que es el dato.
 */

import { LINE_TYPE_BY_ID } from './symbology.js';
import { axisTicks, formatDistance, formatElevation } from './profile.js';
import { elevationAt } from './section.js';

export const MARGIN = { top: 18, right: 20, bottom: 34, left: 62 };

/** Largo del tick de manteo, en píxeles. */
const TADPOLE_PX = 26;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Escalas del corte. `s` a lo ancho, cota a lo alto, con exageración. */
export function sectionScales(section, width, height, exaggeration = 1) {
  const w = Math.max(1, width - MARGIN.left - MARGIN.right);
  const h = Math.max(1, height - MARGIN.top - MARGIN.bottom);
  const total = Math.max(1, section.length);
  const zMin = section.zMin;
  const zMax = Math.max(section.zMax, zMin + 1);

  /*
   * La exageración estira el eje vertical alrededor del techo del rango, no
   * alrededor del centro: lo que interesa mantener a la vista es la topografía
   * y lo que cuelga de ella, no el fondo vacío del corte.
   */
  const zSpan = (zMax - zMin) / Math.max(0.01, exaggeration);
  const zBase = zMax - zSpan;

  return {
    x: (s) => MARGIN.left + (s / total) * w,
    y: (z) => MARGIN.top + (1 - (z - zBase) / Math.max(1e-9, zSpan)) * h,
    w,
    h,
    total,
    zBase,
    zTop: zMax,
    exaggeration,
  };
}

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/** Camino de la topografía, cortado en los huecos sin dato. */
function topoPath(samples, s) {
  let d = '';
  let abierto = false;
  for (const m of samples) {
    if (!Number.isFinite(m.elevation)) {
      abierto = false;
      continue;
    }
    const p = `${s.x(m.distance).toFixed(2)} ${s.y(m.elevation).toFixed(2)}`;
    d += abierto ? ` L${p}` : ` M${p}`;
    abierto = true;
  }
  return d.trim();
}

/**
 * Dibuja el perfil entero dentro de un `<svg>` ya existente.
 *
 * @param {SVGElement} svg
 * @param {object} section     lo que devuelve `buildSection`
 * @param {object} opts
 * @returns {{scales: object}}
 */
export function renderSection(svg, section, opts = {}) {
  const {
    width = 1200,
    height = 620,
    exaggeration = 1,
    showIntersections = true,
    showLabels = true,
    theme = 'dark',
  } = opts;

  const c =
    theme === 'light'
      ? { fg: '#111827', muted: '#6b7280', grid: '#e5e7eb', ground: '#f3f4f6', bg: '#ffffff' }
      : { fg: '#e6edf3', muted: '#93a1b0', grid: '#243044', ground: '#161c27', bg: '#0d1117' };

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.replaceChildren();

  const s = sectionScales(section, width, height, exaggeration);
  svg.appendChild(el('rect', { x: 0, y: 0, width, height, fill: c.bg }));

  /* --- rejilla y ejes --- */
  const g = el('g');
  for (const z of axisTicks(s.zBase, s.zTop, 6)) {
    const y = s.y(z);
    if (y < MARGIN.top - 1 || y > height - MARGIN.bottom + 1) continue;
    g.appendChild(el('line', {
      x1: MARGIN.left, y1: y, x2: width - MARGIN.right, y2: y,
      stroke: c.grid, 'stroke-width': 1,
    }));
    const t = el('text', {
      x: MARGIN.left - 8, y: y + 4, fill: c.muted, 'font-size': 11, 'text-anchor': 'end',
    });
    t.textContent = formatElevation(z);
    g.appendChild(t);
  }
  for (const d of axisTicks(0, s.total, 6)) {
    const x = s.x(d);
    g.appendChild(el('line', {
      x1: x, y1: MARGIN.top, x2: x, y2: height - MARGIN.bottom,
      stroke: c.grid, 'stroke-width': 1,
    }));
    const t = el('text', {
      x, y: height - MARGIN.bottom + 16, fill: c.muted, 'font-size': 11, 'text-anchor': 'middle',
    });
    t.textContent = formatDistance(d);
    g.appendChild(t);
  }
  svg.appendChild(g);

  /* --- terreno --- */
  const camino = topoPath(section.samples, s);
  if (camino) {
    // Relleno bajo la topografía: sin él no se distingue el aire de la roca, y
    // un corte donde no se ve dónde acaba el terreno no se puede interpretar.
    const bajo = el('path', {
      d: `${camino} L${s.x(s.total).toFixed(2)} ${height - MARGIN.bottom} L${MARGIN.left} ${height - MARGIN.bottom} Z`,
      fill: c.ground, stroke: 'none', opacity: 0.85,
    });
    svg.appendChild(bajo);
    svg.appendChild(el('path', {
      d: camino, fill: 'none', stroke: c.fg, 'stroke-width': 1.8,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
  }

  /* --- intersecciones con el dibujo --- */
  if (showIntersections) {
    const gi = el('g');
    for (const x of section.intersections) {
      if (x.enabled === false) continue;
      const tipo = LINE_TYPE_BY_ID.get(x.type);
      const color = tipo ? tipo.color : c.muted;
      const px = s.x(x.s);
      const zTopo = elevationAt(section.samples, x.s);
      const y0 = Number.isFinite(zTopo) ? s.y(zTopo) : MARGIN.top;
      gi.appendChild(el('line', {
        x1: px, y1: y0 - 10, x2: px, y2: height - MARGIN.bottom,
        stroke: color, 'stroke-width': 1.6, 'stroke-dasharray': '4 3', opacity: 0.75,
      }));
      gi.appendChild(el('circle', { cx: px, cy: y0, r: 3.2, fill: color }));
      if (showLabels && tipo) {
        const t = el('text', {
          x: px, y: y0 - 15, fill: color, 'font-size': 10, 'text-anchor': 'middle',
        });
        t.textContent = tipo.short;
        gi.appendChild(t);
      }
    }
    svg.appendChild(gi);
  }

  /* --- manteos proyectados --- */
  const gd = el('g');
  for (const d of section.dips) {
    if (!Number.isFinite(d.z)) continue;
    const px = s.x(d.s);
    const py = s.y(d.z);

    /*
     * El ángulo que se dibuja es el que se VE: la exageración vertical deforma
     * la geometría del corte, y un tick al ángulo verdadero quedaría
     * descolgado de las capas dibujadas junto a él. El rótulo lleva el
     * aparente real, que es el dato.
     */
    const visual = Math.atan(Math.tan(d.apparent * (Math.PI / 180)) * s.exaggeration);
    const dx = (Math.cos(visual) * TADPOLE_PX) / 2;
    const dy = (Math.sin(visual) * TADPOLE_PX) / 2;

    // Cuanto más achatado el manteo por la proyección, más pálido el tick: a
    // 20° del rumbo el aparente ya no dice nada de la estructura.
    const opacidad = 0.35 + 0.65 * Math.min(1, Math.max(0, d.foreshortening));
    gd.appendChild(el('line', {
      x1: px - dx, y1: py - dy, x2: px + dx, y2: py + dy,
      stroke: '#2dd4bf', 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: opacidad,
    }));
    gd.appendChild(el('circle', {
      cx: px, cy: py, r: 3.4, fill: c.bg, stroke: '#2dd4bf', 'stroke-width': 2,
    }));
    if (showLabels) {
      const t = el('text', {
        x: px + 7, y: py - 7, fill: '#2dd4bf', 'font-size': 10,
      });
      t.textContent = `${Math.round(Math.abs(d.apparent))}°`;
      gd.appendChild(t);
    }
  }
  svg.appendChild(gd);

  /* --- rótulos de los extremos --- */
  const izq = el('text', { x: MARGIN.left, y: MARGIN.top - 5, fill: c.fg, 'font-size': 12, 'font-weight': 600 });
  izq.textContent = endLabel(section.azimuth + 180);
  const der = el('text', {
    x: width - MARGIN.right, y: MARGIN.top - 5, fill: c.fg, 'font-size': 12,
    'font-weight': 600, 'text-anchor': 'end',
  });
  der.textContent = endLabel(section.azimuth);
  svg.append(izq, der);

  return { scales: s };
}

/**
 * Rótulo del extremo del corte: la letra del cuadrante hacia el que mira.
 *
 * Un perfil se cita por sus extremos —«perfil W-E»— y ponerlos es lo que
 * permite orientar la figura sin volver al mapa.
 */
export function endLabel(azimuth) {
  const a = ((azimuth % 360) + 360) % 360;
  const nombres = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return nombres[Math.round(a / 45) % 8];
}

/* ========================================================= exportación === */

/** El SVG como texto, con el preámbulo que necesita un archivo suelto. */
export function sectionSVG(svg) {
  const copia = svg.cloneNode(true);
  copia.setAttribute('xmlns', SVG_NS);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copia)}`;
}

/**
 * PNG a partir del mismo SVG que se está viendo.
 *
 * Se rasteriza a `scale` veces el tamaño en pantalla: una figura de paper a 150
 * píxeles por pulgada necesita más resolución que la que tiene el panel, y
 * generarla desde el SVG evita que la versión exportada y la vista se separen.
 */
export function sectionPNG(svg, { scale = 2 } = {}) {
  return new Promise((resolve, reject) => {
    const texto = sectionSVG(svg);
    const w = Number(svg.getAttribute('width')) || 1200;
    const h = Number(svg.getAttribute('height')) || 620;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([texto], { type: 'image/svg+xml' }));
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          blob ? resolve(blob) : reject(new Error('The canvas produced no image'));
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
