/**
 * Brújula en vivo, dibujada en SVG.
 *
 * La comparte el método Device de crear medida y la pestaña Compass del
 * Stereograma: en las dos hace falta leer lo mismo —el rumbo como un trazo
 * girado desde el norte, el manteo como un error medido en grados, y ese
 * error como texto y no como adorno—, así que el marco graduado y el texto
 * viven en un solo sitio y no se copian dos veces. Lo que gira en el centro sí
 * difiere a propósito entre los dos: Device dibuja el símbolo de rumbo/manteo
 * del mapa (`style: 'symbol'`), para reconocer en terreno la misma medida que
 * se va a ver después; Compass dibuja una aguja de brújula (`style: 'needle'`,
 * el valor por omisión), porque ahí se está orientando el propio teléfono y
 * no anotando un dato.
 *
 * **EN TONOS CLAROS, Y NO POR GUSTO.** El resto de la aplicación es oscura
 * porque de noche o bajo techo cansa menos, pero esto se mira a mediodía, al
 * sol, con la pantalla al mínimo de brillo para que dure la batería: ahí una
 * aguja fina y clara sobre fondo oscuro desaparece, y lo que se lee es el
 * reflejo de la cara de uno. Tinta oscura sobre disco claro es lo que se ve
 * con el sol de frente, que es la única condición en la que esta pantalla
 * tiene que funcionar de verdad.
 *
 * **Notación**: `rumbo/manteo` con el rumbo por la REGLA DE LA MANO DERECHA
 * —la misma del símbolo que se dibuja en el mapa (`structureSymbols.js`) y la
 * misma que exporta el GeoPackage—, rotulada como tal debajo del número. Un
 * `120/45` no dice por sí solo si los 120 son rumbo RHR o dirección de manteo,
 * y las dos lecturas difieren en 90°: el rótulo no es decoración.
 */

import { READY_SPREAD_DEG } from './deviceOrientation.js';
import { structureVariant } from './symbology.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/* Paleta de terreno: papel claro, tinta oscura, y dos acentos que se
   distinguen entre sí incluso en escala de grises impresa. */
const PAPEL = '#f2f5f8';
const TINTA = '#1b2430';
const TENUE = '#5b6876';
const MANTEO = '#c2410c';

/** Cuadrante del acimut, que es como se dicta en terreno. */
const RUMBOS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const cuadrante = (az) => (Number.isFinite(az) ? RUMBOS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16] : '');

const CARDINAL = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

/**
 * Construye la rosa de la brújula dentro de un `<svg>` ya existente, vacío o
 * no —se limpia primero—. Devuelve funciones para refrescar la lectura sin
 * reconstruir el marco cada vez que llega una muestra nueva.
 *
 * El lienzo es más ALTO que ancho a propósito: la rosa ocupa la parte de
 * arriba y el número vive debajo, dentro del mismo `viewBox`. Estaba escrito
 * en coordenadas que caían fuera del cuadrado del `viewBox` —un SVG recorta
 * lo que se sale— así que el rumbo y el manteo, que son LO ÚNICO que hay que
 * leer aquí, no se veían en ninguna parte.
 *
 * @param {SVGElement} svg
 * @param {{size?: number, style?: 'needle'|'symbol'}} opts — `size` es el
 *   diámetro del lienzo de la rosa. `style` decide qué se dibuja girando: la
 *   AGUJA DE BRÚJULA de siempre (`'needle'`, el valor por omisión, para la
 *   pestaña Compass del Stereograma) o el SÍMBOLO DE RUMBO/MANTEO del mapa
 *   (`'symbol'`, para el panel Device al tomar una medida) — ver la nota bajo
 *   `needle`/`dipSymbol` más abajo sobre por qué son dos dibujos distintos y
 *   no uno reetiquetado.
 */
export function buildCompass(svg, { size = 240, style = 'needle' } = {}) {
  const alto = size + 88; // la rosa, y debajo el número con sus dos rótulos
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${size} ${alto}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', alto);

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 18;

  // Fondo claro propio: el panel que lo contiene es oscuro, y el disco tiene
  // que traerse su propio papel o la tinta oscura no se vería sobre él.
  svg.appendChild(el('rect', { x: 0, y: 0, width: size, height: alto, rx: 12, fill: PAPEL }));

  const g = el('g', { class: 'compass-frame' });
  g.append(
    el('circle', { cx, cy, r: R, fill: '#ffffff', stroke: TINTA, 'stroke-width': 1.6 }),
    el('circle', { cx, cy, r: R * 0.55, fill: 'none', stroke: TENUE, 'stroke-width': 0.9, opacity: 0.5 }),
  );
  // Graduación cada 10°, marcada cada 30° y rotulada en los cuatro cardinales:
  // con menos no se estima un rumbo a ojo, con más se emborrona a esta escala.
  for (let deg = 0; deg < 360; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const mayor = deg % 90 === 0;
    const media = deg % 30 === 0;
    const inner = mayor ? R - 14 : media ? R - 10 : R - 5;
    g.appendChild(
      el('line', {
        x1: cx + Math.sin(rad) * R,
        y1: cy - Math.cos(rad) * R,
        x2: cx + Math.sin(rad) * inner,
        y2: cy - Math.cos(rad) * inner,
        stroke: mayor ? TINTA : TENUE,
        'stroke-width': mayor ? 2 : media ? 1.2 : 0.8,
      }),
    );
    if (CARDINAL[deg]) {
      const t = el('text', {
        x: cx + Math.sin(rad) * (R - 26),
        y: cy - Math.cos(rad) * (R - 26),
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-size': 13,
        'font-weight': 700,
        fill: deg === 0 ? MANTEO : TINTA,
      });
      t.textContent = CARDINAL[deg];
      g.appendChild(t);
    }
  }
  svg.appendChild(g);

  /*
   * UNA AGUJA DE BRÚJULA, NO EL SÍMBOLO DE RUMBO Y MANTEO DEL MAPA.
   *
   * La versión anterior dibujaba literalmente ese símbolo —un trazo largo de
   * rumbo con un tic corto de manteo a un lado— porque es el mismo dato, pero
   * sobre un disco graduado con los cuatro cardinales eso se lee como un
   * error: parece un compás mal calibrado, no una brújula. Esto en cambio es
   * un rombo alargado partido en dos mitades de color —la punta clara
   * apuntando a favor del manteo, la cola oscura al lado contrario—, que es
   * literalmente cómo se ve la aguja de cualquier brújula de geólogo. Gira
   * por `dipAzimuth` y no por el rumbo: es la única de las dos direcciones
   * que apunta a un lado sin ambigüedad —el rumbo por sí solo es una recta,
   * no una flecha— y es la que de verdad se quiere leer de un vistazo.
   */
  let needle = null;
  let dipSymbol = null;
  const L = R - 14; // qué tan larga es la aguja, o el trazo de rumbo

  if (style === 'needle') {
    needle = el('g', { class: 'compass-needle', visibility: 'hidden' });
    const W = 9; // medio ancho en el centro, donde el rombo es más ancho
    const cola = el('polygon', {
      points: `${cx},${cy + L} ${cx + W},${cy} ${cx - W},${cy}`,
      fill: TINTA, stroke: TINTA, 'stroke-width': 1, 'stroke-linejoin': 'round',
    });
    const punta = el('polygon', {
      points: `${cx},${cy - L} ${cx + W},${cy} ${cx - W},${cy}`,
      fill: MANTEO, stroke: TINTA, 'stroke-width': 1, 'stroke-linejoin': 'round',
    });
    const hub = el('circle', { cx, cy, r: 4, fill: PAPEL, stroke: TINTA, 'stroke-width': 1.4 });
    needle.append(cola, punta, hub);
    svg.appendChild(needle);
  } else {
    /*
     * EL SÍMBOLO DE RUMBO Y MANTEO DEL MAPA, NO UNA AGUJA DE BRÚJULA.
     *
     * Aquí se lee la medida que se está a punto de guardar, con el mismo
     * trazo y el mismo tic que `structureSymbols.js` dibuja luego sobre el
     * mapa: quien toma el dato con el teléfono tiene que reconocer la misma
     * convención con la que lo va a ver después, no una aguja que ese símbolo
     * nunca tuvo. Gira por el RUMBO (regla de la mano derecha), con el tic
     * siempre hacia el lado del manteo que la propia convención ya fija.
     */
    dipSymbol = el('g', { class: 'dip-symbol', visibility: 'hidden' });
    const TICK = L * 0.55;
    const strikeLine = el('line', {
      x1: cx, y1: cy - L, x2: cx, y2: cy + L,
      stroke: TINTA, 'stroke-width': 3, 'stroke-linecap': 'round',
    });
    const tickRight = el('line', {
      x1: cx, y1: cy, x2: cx + TICK, y2: cy,
      stroke: MANTEO, 'stroke-width': 3, 'stroke-linecap': 'round',
    });
    const tickLeft = el('line', {
      x1: cx, y1: cy, x2: cx - TICK, y2: cy,
      stroke: MANTEO, 'stroke-width': 3, 'stroke-linecap': 'round', visibility: 'hidden',
    });
    const ring = el('circle', {
      cx, cy, r: TICK * 0.85, fill: 'none', stroke: TINTA, 'stroke-width': 2.4, visibility: 'hidden',
    });
    const hub = el('circle', { cx, cy, r: 3, fill: TINTA });
    dipSymbol.append(strikeLine, tickRight, tickLeft, ring, hub);
    svg.appendChild(dipSymbol);
  }

  const label = el('text', {
    x: cx, y: size + 26, 'text-anchor': 'middle', 'font-size': 30,
    'font-weight': 700, fill: TINTA, 'font-variant-numeric': 'tabular-nums',
  });
  svg.appendChild(label);

  const notacion = el('text', {
    x: cx, y: size + 46, 'text-anchor': 'middle', 'font-size': 11.5,
    'font-weight': 600, fill: TENUE, 'letter-spacing': 0.4,
  });
  notacion.textContent = 'Strike (RHR) / Dip';
  svg.appendChild(notacion);

  const sub = el('text', {
    x: cx, y: size + 68, 'text-anchor': 'middle', 'font-size': 12, fill: TENUE,
  });
  svg.appendChild(sub);

  /**
   * Refresca la aguja y el texto con una lectura `{strike, dip, dipAzimuth,
   * strikeSd, dipSd, spread, ready, n}`. `null`/`undefined` la deja apagada,
   * sin inventar un cero que no se midió.
   */
  function update(reading) {
    const graphic = needle || dipSymbol;
    if (!reading || !Number.isFinite(reading.strike) || !Number.isFinite(reading.dip)) {
      graphic.setAttribute('visibility', 'hidden');
      label.textContent = '—';
      sub.textContent = '';
      return;
    }
    graphic.setAttribute('visibility', 'visible');
    const az = Number.isFinite(reading.dipAzimuth) ? reading.dipAzimuth : reading.strike + 90;
    if (needle) {
      // La aguja gira con la dirección de manteo, no con el rumbo: es la única
      // de las dos que apunta a un lado sin ambigüedad, así que es lo que
      // tiene que leerse de un vistazo como en cualquier brújula real. Sin
      // manteo medido (`dipAzimuth` ausente) se usa el rumbo + 90° por
      // defecto, la misma convención que usa el resto de la app.
      needle.setAttribute('transform', `rotate(${az} ${cx} ${cy})`);
    } else {
      // El símbolo, en cambio, gira por el RUMBO —como en el mapa—, y elige
      // variante igual que `structureVariant()`: horizontal, vertical o
      // inclinado con el tic ya fijo hacia el lado del manteo bajo la RHR.
      dipSymbol.setAttribute('transform', `rotate(${reading.strike} ${cx} ${cy})`);
      const variante = structureVariant(reading.dip, false);
      const [strikeLine, tickRight, tickLeft, ring] = dipSymbol.children;
      strikeLine.setAttribute('visibility', variante === 'horizontal' ? 'hidden' : 'visible');
      tickRight.setAttribute('visibility', variante === 'horizontal' ? 'hidden' : 'visible');
      tickLeft.setAttribute('visibility', variante === 'vertical' ? 'visible' : 'hidden');
      ring.setAttribute('visibility', variante === 'horizontal' ? 'visible' : 'hidden');
    }
    const strike = String(Math.round(reading.strike) % 360).padStart(3, '0');
    label.textContent = `${strike}/${Math.round(reading.dip)}`;

    const trozos = [];
    if (Number.isFinite(reading.strikeSd) && Number.isFinite(reading.dipSd)) {
      trozos.push(`±${Math.round(reading.strikeSd * 10) / 10}° / ±${Math.round(reading.dipSd * 10) / 10}°`);
    }
    // Hacia dónde cae el manteo: es lo primero que se comprueba de una medida
    // en la libreta, y con la sola cifra de rumbo RHR hay que deducirlo. Es
    // el mismo `az` que ya orientó la aguja, arriba.
    if (reading.dip > 0.5) trozos.push(`dips ${cuadrante(az)}`);
    sub.textContent = trozos.join(' · ');
  }

  return { update };
}

/**
 * Qué decirle a quien sostiene el teléfono, a partir de la lectura.
 *
 * Vive aquí y no en cada panel porque los dos sitios que enseñan la brújula
 * —el método Device y la pestaña Compass— tienen que dar exactamente el mismo
 * consejo: si uno dice "sostén más quieto" y el otro se calla, el que se calla
 * parece estar dando por buena una lectura que el otro rechaza.
 *
 * El caso que importa de verdad es `needsHeading`, que solo aparece en iOS:
 * apoyar el teléfono en vertical contra una pared deja al magnetómetro sin
 * poder decir dónde está el norte (ver `alphaFromHeading`). No es un fallo que
 * se pueda resolver por dentro — hay que NIVELARLO un momento para fijar el
 * norte y volver a apoyarlo. Decirlo es la única salida.
 */
export function compassHint(reading) {
  if (!reading || !(reading.n >= 2)) return 'Reading the sensors…';
  if (reading.needsHeading) {
    return 'Hold the phone level, screen up, for a moment so the compass can find north — then press it flat against the surface.';
  }
  const disp = Number.isFinite(reading.spread) ? Math.round(reading.spread * 10) / 10 : null;
  if (!reading.ready) {
    if (disp !== null && disp > READY_SPREAD_DEG) return `Hold it steadier — the reading is wandering ±${disp}°.`;
    return `Reading… (${reading.n} sample${reading.n === 1 ? '' : 's'})`;
  }
  const partes = [`${reading.n} samples`];
  if (disp !== null) partes.push(`steady to ±${disp}°`);
  if (reading.headingStale) {
    partes.push(`north locked ${Math.round(reading.headingAge / 1000)} s ago — level the phone again if the strike looks off`);
  } else if (reading.headingHeld) {
    partes.push('north held from the last level reading');
  }
  return partes.join(' · ');
}
