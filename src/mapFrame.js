/**
 * EL MARCO DE UN MAPA: lo que convierte una captura de pantalla en una lámina.
 *
 * Una imagen del mapa, sola, no es un mapa: no dice dónde está, ni a qué
 * escala, ni hacia dónde. Este módulo pone las cuatro cosas que faltan y que
 * cualquier lámina de una memoria o de una carta lleva desde hace un siglo:
 *
 * - el **marco de cebra** con los cortes del graticulado, que es como se lee
 *   una coordenada sobre el papel sin más instrumento que una regla;
 * - las **coordenadas rotuladas** en los cuatro bordes;
 * - la **escala gráfica**, que sobrevive a la fotocopia y al PDF reescalado,
 *   cosa que «1:25 000» no hace;
 * - el **norte**, porque la vista puede estar girada.
 *
 *
 * POR QUÉ ESTO NO SABE NADA DE MAPLIBRE
 *
 * Todo lo de aquí es aritmética sobre números que le entregan: la geometría
 * del encuadre llega ya muestreada (ver `edgeSamples` en mapView) y lo que
 * sale es una lista de primitivas de dibujo —rectángulos, líneas, textos y una
 * imagen— que no menciona ningún formato de salida.
 *
 * Esa separación es la que permite que el SVG, el PNG y el PDF sean LA MISMA
 * lámina y no tres dibujos parecidos: los tres consumen esta misma lista. Y es
 * lo que la hace comprobable sin navegador.
 *
 *
 * EL SISTEMA DE COORDENADAS
 *
 * Origen arriba a la izquierda, `y` hacia abajo, en píxeles de la lámina. Es
 * el del SVG y el del lienzo; el PDF, que mide desde abajo, lo invierte en su
 * propio escritor y no aquí.
 */

/**
 * Escalones de graticulado, en grados, de mayor a menor.
 *
 * Son los de cualquier carta: grados, y después medios, tercios y cuartos de
 * grado expresados en minutos y segundos enteros. No hay escalones decimales
 * —0,1°— a propósito: un borde rotulado en grados decimales no se puede leer
 * con la misma regla que una libreta de terreno escrita en grados y minutos.
 */
export const GRATICULE_STEPS = [
  10, 5, 2, 1,
  30 / 60, 20 / 60, 15 / 60, 10 / 60, 5 / 60, 2 / 60, 1 / 60,
  30 / 3600, 20 / 3600, 15 / 3600, 10 / 3600, 5 / 3600, 2 / 3600, 1 / 3600,
];

/**
 * El escalón más grande que aún parte el encuadre en `minDivisiones` tramos.
 *
 * Se busca de grande a chico y se para en el primero que sirve, que es el que
 * deja el marco más limpio: cuatro cortes se leen de un vistazo y treinta son
 * una cremallera.
 */
export function chooseGraticuleStep(span, minDivisiones = 3) {
  if (!Number.isFinite(span) || span <= 0) return GRATICULE_STEPS[GRATICULE_STEPS.length - 1];
  for (const step of GRATICULE_STEPS) {
    if (span / step >= minDivisiones) return step;
  }
  return GRATICULE_STEPS[GRATICULE_STEPS.length - 1];
}

/**
 * Dónde corta el borde cada línea del graticulado.
 *
 * `samples` son pares `{t, v}`: `t` es la posición a lo largo del borde, en
 * píxeles, y `v` la longitud o la latitud en ese punto. Entre dos muestras
 * consecutivas se interpola linealmente, que con muestras cada pocos píxeles
 * es exacto a menos de un píxel.
 *
 * Se resuelve así, y no con la fórmula inversa de la proyección, porque el
 * borde de la pantalla no es una línea de latitud constante en cuanto la vista
 * está girada: muestrear y buscar el cruce funciona igual con el mapa al norte
 * y con el mapa torcido, sin dos caminos que puedan discrepar.
 */
export function crossingsAlong(samples, step) {
  const out = [];
  if (!Array.isArray(samples) || samples.length < 2 || !(step > 0)) return out;

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!Number.isFinite(a.v) || !Number.isFinite(b.v) || a.v === b.v) continue;
    const lo = Math.min(a.v, b.v);
    const hi = Math.max(a.v, b.v);
    // Las dos puntas se tratan como semiabierto [lo, hi) para que un cruce que
    // cae justo sobre una muestra no se cuente dos veces.
    for (let k = Math.ceil(lo / step - 1e-9); k * step < hi; k++) {
      const value = k * step;
      if (value < lo) continue;
      const f = (value - a.v) / (b.v - a.v);
      if (!(f >= 0 && f <= 1)) continue;
      out.push({ t: a.t + f * (b.t - a.t), value, index: k });
    }
  }

  out.sort((x, y) => x.t - y.t);
  return out.filter((c, i) => i === 0 || Math.abs(c.t - out[i - 1].t) > 0.5);
}

/** Interpolador del valor a lo largo del borde, para el relleno de la cebra. */
function valueAtFactory(samples) {
  return (t) => {
    if (!samples.length) return NaN;
    if (t <= samples[0].t) return samples[0].v;
    const last = samples[samples.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].t >= t) {
        const a = samples[i - 1];
        const b = samples[i];
        const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
        return a.v + f * (b.v - a.v);
      }
    }
    return last.v;
  };
}

/**
 * Los tramos blancos y negros de un borde.
 *
 * Cuál va oscuro NO se decide alternando desde el principio, sino por la
 * paridad del propio intervalo del graticulado: el tramo que contiene un valor
 * cuyo múltiplo es par va oscuro. Así el damero CONTINÚA al doblar una
 * esquina, que es lo que hace que el marco se lea como un solo objeto y no
 * como cuatro tiras independientes que casualmente se tocan.
 */
export function zebraSegments(samples, crossings, step, t0, t1) {
  const valueAt = valueAtFactory(samples);
  const cortes = [t0, ...crossings.map((c) => c.t).filter((t) => t > t0 && t < t1), t1];
  const segs = [];
  for (let i = 1; i < cortes.length; i++) {
    const a = cortes[i - 1];
    const b = cortes[i];
    if (b - a < 0.01) continue;
    const v = valueAt((a + b) / 2);
    const k = Math.floor(v / step);
    segs.push({ a, b, dark: ((k % 2) + 2) % 2 === 0 });
  }
  return segs;
}

/**
 * Una coordenada escrita como se escribe en un mapa.
 *
 * El detalle se ajusta al escalón: con cortes cada grado sobra escribir los
 * minutos, y con cortes cada diez segundos hacen falta los tres campos. Se
 * usan el grado, la comilla simple y la doble —y no los primos tipográficos—
 * porque son las que existen en las fuentes base de un PDF, y la lámina tiene
 * que decir lo mismo en los tres formatos.
 */
export function formatDegrees(value, kind, step) {
  if (!Number.isFinite(value)) return '';
  let v = value;
  if (kind === 'lng') {
    // Normalizado a [-180, 180]: un mapa que cruza el antimeridiano no puede
    // rotular «185° E».
    v = ((((v + 180) % 360) + 360) % 360) - 180;
  }
  const hemi = kind === 'lat' ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E');
  const abs = Math.abs(v);

  // Se redondea al segundo entero antes de repartir en campos: si no, un valor
  // que vale 59,9999" por error de coma flotante sale como 59" en vez de subir
  // al minuto siguiente, y el rótulo se queda a un segundo de su propia línea.
  const totalSeg = Math.round(abs * 3600);
  const g = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg - g * 3600) / 60);
  const seg = totalSeg - g * 3600 - m * 60;

  if (step >= 1) return `${g}° ${hemi}`;
  if (step >= 1 / 60) return `${g}°${String(m).padStart(2, '0')}' ${hemi}`;
  return `${g}°${String(m).padStart(2, '0')}'${String(seg).padStart(2, '0')}" ${hemi}`;
}

/**
 * Distancia en la unidad que se lee sin contar ceros.
 *
 * Dos decimales y no uno: la marca media de una barra de 2,5 km vale 1,25 km,
 * y redondeada a «1,3 km» la escala gráfica pasa a mentir un dos por ciento
 * justo en el punto que más se usa para medir.
 */
export function formatDistance(metres) {
  if (!Number.isFinite(metres) || metres <= 0) return '';
  if (metres >= 1000) {
    const km = metres / 1000;
    return `${trim(km.toFixed(2))} km`;
  }
  return `${trim(metres.toFixed(2))} m`;
}

/** Quita los ceros que sobran a la derecha: «1.50» → «1.5», «250.00» → «250». */
function trim(s) {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/**
 * La escala gráfica: un largo redondo que además mide algo parecido a
 * `targetPx` en la lámina.
 *
 * Manda el número redondo y no el largo: una barra de 147 px que dice
 * «1 km» sirve, y una de 150 px que dice «1,02 km» no sirve para nada, porque
 * lo que se hace con una escala gráfica es medir con una regla y multiplicar.
 */
export function scaleBar(metresPerPixel, targetPx = 150) {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return null;
  const crudo = metresPerPixel * targetPx;
  const exp = Math.floor(Math.log10(crudo));
  const base = Math.pow(10, exp);
  let metres = base;
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (mult * base <= crudo) metres = mult * base;
  }
  return { metres, px: metres / metresPerPixel, label: formatDistance(metres) };
}

/* ======================================================= la lámina === */

/** Medidas de la lámina, en píxeles. Todas juntas para poder mirarlas a la vez. */
export const LAYOUT = {
  /** Ancho de la banda de cebra. */
  frame: 20,
  /** Aire por fuera del marco, donde van los rótulos de coordenadas. */
  pad: 20,
  /** Alto de la banda del pie (norte, escala gráfica, crédito). */
  footer: 62,
  /** Alto de la banda del título, cuando hay título. */
  header: 30,
  /** Cuerpo de los rótulos de coordenadas. */
  coordSize: 9.5,
  /** Cuerpo del texto del pie. */
  footSize: 10,
  /** Cuerpo del título. */
  titleSize: 15,
};

const INK = '#111111';
const PAPER = '#ffffff';
const HAIR = 0.8;

/**
 * Cuántos rótulos caben sin pisarse, y cada cuántos cortes hay que poner uno.
 *
 * Un marco con quince cortes no lleva quince rótulos: llevaría quince números
 * solapados. Se salta de uno en uno hasta que la separación entre rótulos
 * supera el ancho estimado del texto.
 */
function labelStride(crossings, anchoTexto) {
  if (crossings.length < 2) return 1;
  for (let paso = 1; paso <= crossings.length; paso++) {
    let ok = true;
    for (let i = paso; i < crossings.length; i += paso) {
      if (crossings[i].t - crossings[i - paso].t < anchoTexto) {
        ok = false;
        break;
      }
    }
    if (ok) return paso;
  }
  return crossings.length;
}

/**
 * Compone la lámina entera.
 *
 * @param {object} view lo que mapView midió del encuadre:
 *   `{width, height, bearing, metresPerPixel, denominator, edges}` donde
 *   `edges` trae, para cada borde, las muestras `{t, v}` de la coordenada que
 *   ese borde corta (longitud arriba y abajo, latitud a los lados).
 * @param {object} opts `{title, credit, scaleText}`
 * @returns {{width:number, height:number, map:object, ops:object[]}}
 */
export function buildFrame(view, opts = {}) {
  const { frame, pad, footer, header, coordSize, footSize, titleSize } = LAYOUT;
  const title = (opts.title || '').trim();
  const alto = title ? header : 0;

  const mapW = Math.max(1, Math.round(view.width));
  const mapH = Math.max(1, Math.round(view.height));
  const x0 = pad + frame;
  const y0 = pad + frame + alto;
  const width = mapW + 2 * (pad + frame);
  const height = mapH + 2 * (pad + frame) + alto + footer;

  const ops = [];
  const rect = (x, y, w, h, extra) => ops.push({ kind: 'rect', x, y, w, h, ...extra });
  const text = (x, y, t, extra) =>
    ops.push({ kind: 'text', x, y, text: t, size: footSize, fill: INK, anchor: 'start', ...extra });

  // El papel. Va primero: todo lo demás se dibuja encima.
  rect(0, 0, width, height, { fill: PAPER });

  if (title) {
    text(width / 2, pad + titleSize, title, {
      size: titleSize,
      bold: true,
      anchor: 'middle',
    });
  }

  // La imagen del mapa, y su línea de contorno (la «neat line»), que es la que
  // de verdad delimita el mapa: la cebra va por fuera de ella.
  ops.push({ kind: 'image', x: x0, y: y0, w: mapW, h: mapH });
  rect(x0, y0, mapW, mapH, { stroke: INK, lineWidth: HAIR });

  /* ---------- la cebra ---------- */

  const pasoLng = chooseGraticuleStep(spanOf(view.edges.top));
  const pasoLat = chooseGraticuleStep(spanOf(view.edges.left));

  const bordes = [
    { id: 'top', kind: 'lng', step: pasoLng, samples: view.edges.top },
    { id: 'bottom', kind: 'lng', step: pasoLng, samples: view.edges.bottom },
    { id: 'left', kind: 'lat', step: pasoLat, samples: view.edges.left },
    { id: 'right', kind: 'lat', step: pasoLat, samples: view.edges.right },
  ];

  for (const b of bordes) {
    const horizontal = b.id === 'top' || b.id === 'bottom';
    const largo = horizontal ? mapW : mapH;
    const cortes = crossingsAlong(b.samples, b.step);
    const tramos = zebraSegments(b.samples, cortes, b.step, 0, largo);

    // La banda: arriba y abajo por fuera de la neat line, a los lados igual.
    const banda = {
      top: { x: x0, y: y0 - frame, w: mapW, h: frame },
      bottom: { x: x0, y: y0 + mapH, w: mapW, h: frame },
      left: { x: x0 - frame, y: y0, w: frame, h: mapH },
      right: { x: x0 + mapW, y: y0, w: frame, h: mapH },
    }[b.id];

    rect(banda.x, banda.y, banda.w, banda.h, { fill: PAPER });
    for (const t of tramos) {
      if (!t.dark) continue;
      if (horizontal) rect(x0 + t.a, banda.y, t.b - t.a, frame, { fill: INK });
      else rect(banda.x, y0 + t.a, frame, t.b - t.a, { fill: INK });
    }
    rect(banda.x, banda.y, banda.w, banda.h, { stroke: INK, lineWidth: HAIR });

    /* ---------- los rótulos ---------- */


    // Ancho estimado del rótulo: sirve para decidir cada cuántos cortes se
    // pone uno, y no hace falta que sea exacto porque lo que se evita es el
    // solape, no cuadrar una caja.
    const muestra = cortes.length ? formatDegrees(cortes[0].value, b.kind, b.step) : '';
    const anchoTexto = horizontal ? muestra.length * coordSize * 0.62 + 10 : coordSize + 8;
    const paso = labelStride(cortes, anchoTexto);

    for (let i = 0; i < cortes.length; i += paso) {
      const c = cortes[i];
      // Pegado a una esquina el rótulo se sale de la lámina o pisa al del
      // borde vecino; ahí no se pone.
      if (c.t < anchoTexto / 2 || c.t > largo - anchoTexto / 2) continue;
      const etiqueta = formatDegrees(c.value, b.kind, b.step);

      if (b.id === 'top') {
        text(x0 + c.t, y0 - frame - 5, etiqueta, { size: coordSize, anchor: 'middle' });
      } else if (b.id === 'bottom') {
        text(x0 + c.t, y0 + mapH + frame + coordSize + 3, etiqueta, {
          size: coordSize,
          anchor: 'middle',
        });
      } else if (b.id === 'left') {
        // Girados para que quepan en veinte píxeles de aire: es lo que hace
        // cualquier carta con el eje vertical.
        text(x0 - frame - 5, y0 + c.t, etiqueta, {
          size: coordSize,
          anchor: 'middle',
          rotate: -90,
        });
      } else {
        text(x0 + mapW + frame + coordSize + 3, y0 + c.t, etiqueta, {
          size: coordSize,
          anchor: 'middle',
          rotate: -90,
        });
      }
    }
  }

  /*
   * Y la línea de fuera, que CIERRA el marco.
   *
   * Sin ella las cuatro bandas son cuatro tiras que se tocan en las esquinas
   * sin encontrarse, y el marco se lee roto justo en los vértices, que es
   * donde uno apoya la regla para leer una coordenada.
   */
  rect(x0 - frame, y0 - frame, mapW + 2 * frame, mapH + 2 * frame, {
    stroke: INK,
    lineWidth: HAIR,
  });

  /* ---------- el pie: norte, escala gráfica y crédito ---------- */

  const pieY = y0 + mapH + frame + pad;
  const centroPie = pieY + footer / 2;

  ops.push(...northArrow(x0 + 18, centroPie, 16, view.bearing || 0));

  const barra = scaleBar(view.metresPerPixel, Math.min(190, Math.max(110, mapW * 0.22)));
  if (barra) {
    const bx = x0 + 60;
    const by = centroPie + 2;
    const alturaBarra = 7;
    const trozos = 4;
    const anchoTrozo = barra.px / trozos;
    for (let i = 0; i < trozos; i++) {
      rect(bx + i * anchoTrozo, by, anchoTrozo, alturaBarra, {
        fill: i % 2 === 0 ? INK : PAPER,
      });
    }
    rect(bx, by, barra.px, alturaBarra, { stroke: INK, lineWidth: HAIR });
    // Solo los dos extremos y el medio: una escala gráfica con cinco números
    // se lee peor que con tres.
    text(bx, by - 4, '0', { size: footSize - 1, anchor: 'middle' });
    text(bx + barra.px / 2, by - 4, formatDistance(barra.metres / 2), {
      size: footSize - 1,
      anchor: 'middle',
    });
    text(bx + barra.px, by - 4, barra.label, { size: footSize - 1, anchor: 'middle' });
    if (opts.scaleText) {
      text(bx, by + alturaBarra + footSize + 1, opts.scaleText, { size: footSize, bold: true });
    }
  }

  if (opts.credit) {
    text(width - pad, centroPie + 3, opts.credit, { size: footSize - 1, anchor: 'end' });
  }

  return { width, height, map: { x: x0, y: y0, w: mapW, h: mapH }, ops };
}

/** Recorrido total de la coordenada a lo largo de un borde. */
function spanOf(samples) {
  if (!Array.isArray(samples) || !samples.length) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    if (!Number.isFinite(s.v)) continue;
    if (s.v < lo) lo = s.v;
    if (s.v > hi) hi = s.v;
  }
  return hi > lo ? hi - lo : 0;
}

/**
 * La flecha del norte, girada al revés que la cámara.
 *
 * Con la vista girada `bearing` grados, el norte del terreno aparece en
 * pantalla a `-bearing`. La flecha es media punta rellena y media hueca: es la
 * forma clásica, y de un vistazo dice hacia dónde apunta aunque salga impresa
 * en blanco y negro y pequeña.
 */
export function northArrow(cx, cy, r, bearing) {
  const rad = (-bearing * Math.PI) / 180;
  const rot = (dx, dy) => [
    cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  ];
  const punta = rot(0, -r);
  const base = rot(0, r * 0.55);
  const izq = rot(-r * 0.52, r * 0.78);
  const der = rot(r * 0.52, r * 0.78);
  const etiqueta = rot(0, -r - 4);

  return [
    { kind: 'path', points: [punta, izq, base], close: true, fill: INK },
    { kind: 'path', points: [punta, der, base], close: true, fill: PAPER, stroke: INK, lineWidth: HAIR },
    {
      kind: 'text',
      x: etiqueta[0],
      y: etiqueta[1],
      text: 'N',
      size: 10,
      bold: true,
      fill: INK,
      anchor: 'middle',
    },
  ];
}
