/**
 * Dibujo de la red estereográfica, y su exportación.
 *
 * SVG por el mismo motivo que el corte estructural (`sectionView.js`): esta
 * figura termina pegada en una memoria o un paper, y un SVG se retoca en
 * Illustrator o Inkscape. El PNG y la copia al portapapeles salen del MISMO
 * SVG, así que ninguna de las tres versiones puede desalinearse de las otras.
 *
 * **Sobre papel, no sobre pizarra.** La red se dibuja en claro aunque la
 * aplicación sea oscura, por las dos razones que mandan aquí: en terreno, al
 * sol, una malla de líneas finas claras sobre fondo oscuro no se ve; y el
 * destino de esta figura es una memoria o un paper, donde va sobre blanco.
 * Exportarla con el fondo del panel obligaba a rehacerla entera fuera.
 *
 * La GEOMETRÍA no está aquí: la red y los ciclogramas los calcula
 * `stereogram.js`, que es lo que se puede probar sin un navegador. Este módulo
 * solo los pinta.
 */

import { greatCirclePath, lineVector, schmidtNet, smallCircleSegments } from './stereogram.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Los mismos tonos de terreno que la brújula: papel claro y tinta oscura. */
const PAPEL = '#ffffff';
const TINTA = '#1b2430';
const MALLA = '#aab6c2';
const TENUE = '#5b6876';
/* Magenta, a propósito: ningún tipo de superficie del catálogo usa ese tono
   (negro, verde, azul, rojo), así que el vector medio nunca se confunde con
   el polo de una medida real. */
const MEDIA = '#c026d3';
/* Verde azulado, el acento de toda la app (`--accent` en app.css): un tercer
   tono que tampoco usa ningún tipo del catálogo, para que el eje beta no se
   confunda ni con una medida real ni con el vector medio. */
const BETA = '#0d9488';

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/**
 * La red de Schmidt, cada 10°: círculos máximos y círculos menores tal como se
 * imprime en papel milimetrado desde hace un siglo.
 *
 * Los dos únicos diámetros rectos son el N-S y el E-W, y salen de la propia
 * familia (el plano vertical N-S y el cono de 90°). Cualquier otra recta al
 * centro que se viera antes era de una rosa polar, no de una red: sobre una
 * rosa no se puede rotar un dato, ni leer la intersección de dos planos, ni
 * sacar un eje de pliegue.
 */
function net(cx, cy, R) {
  const g = el('g', { class: 'stereo-grid', fill: 'none', 'stroke-linecap': 'round' });
  const { great, small } = schmidtNet({ step: 10, R: 1, steps: 240 });
  const dibuja = (segmentos, ancho) => {
    for (const seg of segmentos) {
      g.appendChild(
        el('polyline', {
          points: seg.map((p) => `${cx + p.x * R},${cy + p.y * R}`).join(' '),
          stroke: MALLA,
          'stroke-width': ancho,
        }),
      );
    }
  };
  dibuja(small, 0.6);
  dibuja(great, 0.6);

  // Graduación del primitivo cada 10°, marcada cada 30°: es como se mide un
  // acimut sobre la red a ojo, y sin ella el borde es una circunferencia muda.
  for (let az = 0; az < 360; az += 10) {
    const rad = (az * Math.PI) / 180;
    const largo = az % 30 === 0 ? 8 : 4;
    g.appendChild(
      el('line', {
        x1: cx + Math.sin(rad) * R,
        y1: cy - Math.cos(rad) * R,
        x2: cx + Math.sin(rad) * (R + largo),
        y2: cy - Math.cos(rad) * (R + largo),
        stroke: az % 90 === 0 ? TINTA : TENUE,
        'stroke-width': az % 30 === 0 ? 1.1 : 0.7,
      }),
    );
  }

  g.appendChild(el('circle', { cx, cy, r: R, stroke: TINTA, 'stroke-width': 1.6 }));
  // El centro, que es la vertical: sin él no hay desde dónde medir un plunge.
  g.appendChild(el('circle', { cx, cy, r: 1.8, fill: TINTA, stroke: 'none' }));
  return g;
}

/**
 * Dibuja la red, los ciclogramas y los polos dentro de un `<svg>` existente.
 *
 * **Planos Y polos, y cada familia se apaga por su cuenta.** Los polos se
 * agrupan solos donde el afloramiento tiene una fábrica, y son lo que se mira
 * con cien medidas encima; el ciclograma es lo que se mira con cinco, cuando
 * lo que interesa es dónde se cortan dos planos o qué cinturón describen. Son
 * dos lecturas distintas del mismo dato y ninguna de las dos sustituye a la
 * otra: por eso se dibujan las dos y se deja apagar la que estorbe, en vez de
 * elegir por quien mira.
 *
 * @param {SVGElement} svg
 * @param {Array<{x:number,y:number,color:string,id:string,strike:number,dip:number}>} points
 *   — posición del POLO ya en coordenadas relativas al centro y radio 1.
 * @param {{width?, height?, radius?, highlighted?: Set<string>,
 *          showPoles?: boolean, showPlanes?: boolean, showMean?: boolean,
 *          meanVector?: object|null, showBeta?: boolean, betaVector?: object|null}} opts
 */
export function renderStereogram(svg, points, opts = {}) {
  const {
    width = 520,
    height = 520,
    radius = 220,
    highlighted = null,
    showPoles = true,
    showPlanes = true,
    // El vector medio (`S.meanPole`) es un punto aparte, no uno más de
    // `points`: no tiene tipo ni color propio, y se apaga con su propia
    // casilla en vez de la de Polos, que sigue gobernando los polos reales.
    showMean = false,
    meanVector = null,
    // El eje beta (`S.betaAxis`), otro punto aparte: es el eje de un
    // pliegue, no un polo ni un promedio de polos.
    showBeta = false,
    betaVector = null,
    // Las líneas de las medidas plano + línea (estría, L₁) y la flecha del
    // bloque colgante: encendidas de salida, porque son parte del dato.
    showLines = true,
  } = opts;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.replaceChildren();

  const cx = width / 2;
  const cy = height / 2;

  // Papel propio: el SVG viaja al portapapeles y a un .svg suelto, donde no
  // hay ningún panel detrás que le ponga fondo.
  svg.appendChild(el('rect', { x: 0, y: 0, width, height, fill: PAPEL }));
  svg.appendChild(net(cx, cy, radius));

  const labels = el('g', { class: 'stereo-labels', 'font-size': 13, 'font-weight': 700, fill: TINTA });
  labels.append(
    Object.assign(el('text', { x: cx, y: cy - radius - 14, 'text-anchor': 'middle' }), { textContent: 'N' }),
    Object.assign(el('text', { x: cx + radius + 16, y: cy + 5, 'text-anchor': 'start' }), { textContent: 'E' }),
    Object.assign(el('text', { x: cx, y: cy + radius + 24, 'text-anchor': 'middle' }), { textContent: 'S' }),
    Object.assign(el('text', { x: cx - radius - 16, y: cy + 5, 'text-anchor': 'end' }), { textContent: 'W' }),
  );
  svg.appendChild(labels);

  const atenuado = (p) => !(!highlighted || highlighted.size === 0 || highlighted.has(p.id));

  /*
   * Los ciclogramas van DEBAJO de los polos: son trazos largos y, encima de
   * ellos, un polo de 7 px se pierde. Al revés se lee todo.
   */
  if (showPlanes) {
    const planos = el('g', { class: 'stereo-planes', fill: 'none', 'stroke-linecap': 'round' });
    for (const p of points) {
      if (!Number.isFinite(p.strike) || !Number.isFinite(p.dip)) continue;
      // 120 muestras por ciclograma en vez de las 240 de la red: aquí puede
      // haber cientos de curvas y a este radio la diferencia no se ve.
      for (const seg of greatCirclePath(p.strike, p.dip, { R: 1, steps: 120 })) {
        planos.appendChild(
          el('polyline', {
            points: seg.map((q) => `${cx + q.x * radius},${cy + q.y * radius}`).join(' '),
            stroke: p.color,
            'stroke-width': 1.3,
            'data-id': p.id,
            opacity: atenuado(p) ? 0.1 : 0.7,
          }),
        );
      }
    }
    svg.appendChild(planos);
  }

  const dots = el('g', { class: 'stereo-points' });
  const placed = [];
  for (const p of points) {
    const px = cx + p.x * radius;
    const py = cy + p.y * radius;
    if (showPoles) {
      dots.appendChild(
        el('circle', {
          cx: px,
          cy: py,
          // 7 px y no 4,2: con el dedo sobre una tablet, y sobre una malla de
          // líneas cada 10°, el punto anterior se confundía con un cruce de la
          // propia red.
          r: 7,
          fill: p.color,
          stroke: TINTA,
          'stroke-width': 1.2,
          'data-id': p.id,
          opacity: atenuado(p) ? 0.18 : 1,
        }),
      );
    }
    placed.push({ id: p.id, x: px, y: py });
  }
  svg.appendChild(dots);

  /*
   * LÍNEAS: un cuadrado, no un círculo, para que nunca se confundan con un
   * polo, en el color de su superficie. Encima, en la estría de una falla con
   * sentido de movimiento, la FLECHA del bloque colgante (ver `lineOf` en
   * `stereogram.js`: afuera en una normal, hacia el centro en una inversa,
   * casi tangente al primitivo en una de rumbo).
   */
  if (showLines) {
    const lineas = el('g', { class: 'stereo-lines' });
    for (const p of points) {
      if (!p.line) continue;
      const lx = cx + p.line.x * radius;
      const ly = cy + p.line.y * radius;
      const op = atenuado(p) ? 0.18 : 1;
      const S = 5.5;
      lineas.appendChild(
        el('rect', {
          x: lx - S, y: ly - S, width: 2 * S, height: 2 * S,
          fill: p.color, stroke: TINTA, 'stroke-width': 1.2, 'data-id': p.id, opacity: op,
        }),
      );
      if (p.line.arrow) {
        const { dx, dy } = p.line.arrow;
        const L = 30; // largo de la flecha, desde el borde del cuadrado
        const x0 = lx + dx * (S + 2);
        const y0 = ly + dy * (S + 2);
        const x1 = lx + dx * (S + L);
        const y1 = ly + dy * (S + L);
        // Punta: dos alas a ±28° de la dirección, hacia atrás.
        const ala = (ang) => {
          const c = Math.cos(ang);
          const sn = Math.sin(ang);
          const bx = -(dx * c - dy * sn);
          const by = -(dx * sn + dy * c);
          return `${x1 + bx * 9},${y1 + by * 9}`;
        };
        const flecha = el('g', { class: 'stereo-slip', opacity: op });
        flecha.append(
          el('line', {
            x1: x0, y1: y0, x2: x1, y2: y1,
            stroke: '#ffffff', 'stroke-width': 4.5, 'stroke-linecap': 'round',
          }),
          el('line', {
            x1: x0, y1: y0, x2: x1, y2: y1,
            stroke: TINTA, 'stroke-width': 2, 'stroke-linecap': 'round',
          }),
          el('polygon', {
            points: `${x1 + dx * 2},${y1 + dy * 2} ${ala(0.49)} ${ala(-0.49)}`,
            fill: TINTA, stroke: '#ffffff', 'stroke-width': 1, 'stroke-linejoin': 'round',
          }),
        );
        lineas.appendChild(flecha);
      }
    }
    svg.appendChild(lineas);
  }

  /*
   * VECTOR MEDIO: una mira, no un polo más.
   *
   * Encima de todo lo demás —de los ciclogramas y de los propios polos—
   * porque es la lectura que se viene a buscar cuando hay un cúmulo entero
   * plagado de puntos: tiene que verse aunque haya cien polos debajo. La cruz
   * blanca sobre el círculo magenta es deliberadamente distinta de cualquier
   * polo (un círculo liso, en el color del tipo): nunca hay que dudar cuál de
   * los puntos es el promedio y cuál una medida de verdad.
   *
   * El CONO DE 95% DE CONFIANZA (`meanVector.alpha95`, de `fisherConfidence`
   * en `stereogram.js`) va DEBAJO de esa mira, como un óvalo punteado: es la
   * misma familia de curva que un ciclograma —un círculo menor alrededor del
   * vector medio, en vez de alrededor del polo de un plano— así que sale de
   * la misma `smallCircleSegments`. Con menos de 3 polos, o un cúmulo tan
   * concentrado que el cono se cierra a 0°, no hay nada que dibujar.
   */
  if (showMean && meanVector) {
    if (Number.isFinite(meanVector.alpha95) && meanVector.alpha95 > 0.05) {
      const eje = lineVector(meanVector.trend, meanVector.plunge);
      const cono = el('g', { class: 'stereo-mean-cone', fill: 'none', 'stroke-linecap': 'round' });
      for (const seg of smallCircleSegments(eje, meanVector.alpha95, { R: 1, steps: 120 })) {
        cono.appendChild(
          el('polyline', {
            points: seg.map((q) => `${cx + q.x * radius},${cy + q.y * radius}`).join(' '),
            stroke: MEDIA,
            'stroke-width': 1.5,
            'stroke-dasharray': '6 4',
            opacity: 0.75,
          }),
        );
      }
      svg.appendChild(cono);
    }

    const mx = cx + meanVector.x * radius;
    const my = cy + meanVector.y * radius;
    const media = el('g', { class: 'stereo-mean' });
    media.append(
      el('circle', { cx: mx, cy: my, r: 11, fill: MEDIA, stroke: TINTA, 'stroke-width': 1.6 }),
      el('line', {
        x1: mx - 6, y1: my, x2: mx + 6, y2: my,
        stroke: '#ffffff', 'stroke-width': 2, 'stroke-linecap': 'round',
      }),
      el('line', {
        x1: mx, y1: my - 6, x2: mx, y2: my + 6,
        stroke: '#ffffff', 'stroke-width': 2, 'stroke-linecap': 'round',
      }),
    );
    svg.appendChild(media);
  }

  /*
   * EJE BETA: el mismo trato que el vector medio —encima de todo—, pero con
   * su propio color y su propia forma (un rombo, ni el círculo del vector
   * medio ni el redondel de un polo) para que los tres nunca se confundan
   * entre sí. Debajo va su CINTURÓN —el círculo máximo del que el eje es la
   * normal—, la misma curva que mostraría el diagrama beta clásico si se
   * trazaran los ciclogramas de cada plano y se leyera dónde se cruzan.
   */
  if (showBeta && betaVector) {
    const eje = lineVector(betaVector.trend, betaVector.plunge);
    const cinturon = el('g', { class: 'stereo-beta-girdle', fill: 'none', 'stroke-linecap': 'round' });
    for (const seg of smallCircleSegments(eje, 90, { R: 1, steps: 120 })) {
      cinturon.appendChild(
        el('polyline', {
          points: seg.map((q) => `${cx + q.x * radius},${cy + q.y * radius}`).join(' '),
          stroke: BETA,
          'stroke-width': 1.6,
          'stroke-dasharray': '2 5',
          opacity: 0.85,
        }),
      );
    }
    svg.appendChild(cinturon);

    const bx = cx + betaVector.x * radius;
    const by = cy + betaVector.y * radius;
    const S = 10; // medio lado del rombo
    svg.appendChild(
      el('polygon', {
        class: 'stereo-beta',
        points: `${bx},${by - S} ${bx + S},${by} ${bx},${by + S} ${bx - S},${by}`,
        fill: BETA,
        stroke: TINTA,
        'stroke-width': 1.6,
        'stroke-linejoin': 'round',
      }),
    );
  }

  // Las coordenadas de cada punto ya en el sistema del `viewBox`, para que
  // quien haga hit-testing del lazo (`stereogramPanel.js`) no tenga que
  // rehacer la proyección: son EXACTAMENTE donde se dibujó cada círculo. Se
  // devuelven aunque los polos estén apagados, porque el lazo sigue siendo la
  // forma de elegir medidas y el polo es su asa natural.
  return { cx, cy, radius, placed };
}

/* ---------- exportación ---------- */

export function stereogramSVG(svg) {
  const copia = svg.cloneNode(true);
  copia.setAttribute('xmlns', SVG_NS);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copia)}`;
}

/**
 * PNG a partir del mismo SVG en pantalla, a `scale` veces su tamaño — igual
 * que `sectionPNG`, para que la versión exportada nunca se separe de lo que
 * se está viendo.
 */
export function stereogramPNG(svg, { scale = 2, background = PAPEL } = {}) {
  return new Promise((resolve, reject) => {
    const texto = stereogramSVG(svg);
    const w = Number(svg.getAttribute('width')) || 520;
    const h = Number(svg.getAttribute('height')) || 520;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([texto], { type: 'image/svg+xml' }));
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        // Fondo sólido: un SVG con partes sin pintar da un PNG con alfa, y
        // pegado en un documento claro el círculo se ve recortado en negro.
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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
