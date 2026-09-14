/**
 * Escala cartográfica del mapa: leerla, fijarla y mantenerla.
 *
 * Un mapa web se navega por NIVEL DE ZOOM, que es un número sin significado
 * cartográfico: z14 no es una escala, es una potencia de dos. Al levantar
 * geología eso no sirve. La densidad de lo que se dibuja —cuánto detalle tiene
 * sentido meter en un contacto, qué se generaliza y qué no— depende de la
 * escala de trabajo, y una memoria o una carta se entrega A una escala. Un
 * mapa levantado deslizando el zoom libremente sale con el detalle repartido a
 * capricho: un tramo digitalizado a 1:5.000 junto a otro a 1:60.000, y ninguno
 * de los dos es el mapa que se declaró.
 *
 * De ahí las dos piezas de este módulo: convertir zoom a denominador y al
 * revés, y una lista de escalas de mapeo para fijarse a una de ellas.
 *
 *
 * EL PÍXEL, QUE ES LA PARTE INCÓMODA
 *
 * Una escala relaciona una distancia en el terreno con una distancia FÍSICA en
 * el mapa. En papel eso está definido. En una pantalla no: el navegador no
 * expone el tamaño real de sus píxeles, así que "1:25.000" en un monitor y en
 * un iPad no miden lo mismo con una regla encima.
 *
 * La convención —OGC, y lo que usan QGIS, OpenLayers y ArcGIS -- es suponer un
 * píxel estándar de 0,28 mm (~90,7 ppp). No es el píxel de NINGUNA pantalla
 * concreta, pero es el mismo supuesto que hace el resto del gremio, así que un
 * 1:25.000 de FieldDraw es el mismo 1:25.000 que vería QGIS. Eso es lo que
 * importa para que la escala sea comparable entre herramientas.
 *
 * Quien quiera que además coincida con una regla sobre SU pantalla tiene
 * `pixelMm` configurable: se mide la barra de escala del mapa con una regla y
 * se ajusta hasta que cuadre. Es opcional; el valor de fábrica es el estándar.
 */

/** Píxel estándar de la OGC, en metros. 0,28 mm. */
export const STANDARD_PIXEL_MM = 0.28;

/** Circunferencia ecuatorial del esferoide de Web Mercator, en metros. */
const CIRCUNFERENCIA = 40075016.6855785;

/**
 * Escalas de mapeo que trae la lista de fábrica.
 *
 * Son las de las series topográficas y geológicas de uso corriente: 1:10.000 y
 * 1:25.000 para el levantamiento de terreno, 1:50.000 y 1:100.000 para las
 * cartas del Sernageomin, y las mayores para el detalle de un afloramiento.
 */
export const DEFAULT_SCALES = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

/** Límites de una escala aceptable. Fuera de esto no hay mapa que mirar. */
export const MIN_SCALE = 100;
export const MAX_SCALE = 50000000;

/** Metros de terreno por píxel de pantalla a un zoom y una latitud dados. */
export function metresPerPixel(zoom, lat, tileSize = 512) {
  return (
    (CIRCUNFERENCIA * Math.cos((lat * Math.PI) / 180)) / (tileSize * Math.pow(2, zoom))
  );
}

/**
 * Denominador de la escala a un zoom dado.
 *
 * MapLibre trabaja en píxeles CSS y su nivel de zoom se define sobre teselas de
 * 512 px, no de 256: a igual zoom, medio metro por píxel de diferencia respecto
 * del esquema clásico. Usar el equivocado da una escala con un factor 2 de
 * error, que es peor que no tener escala.
 */
export function denominatorFor(zoom, lat, pixelMm = STANDARD_PIXEL_MM) {
  const mpp = metresPerPixel(zoom, lat);
  return mpp / (pixelMm / 1000);
}

/** El zoom que produce una escala dada. Es la inversa de `denominatorFor`. */
export function zoomFor(denominator, lat, pixelMm = STANDARD_PIXEL_MM, tileSize = 512) {
  const objetivo = (denominator * pixelMm) / 1000;
  const base = (CIRCUNFERENCIA * Math.cos((lat * Math.PI) / 180)) / tileSize;
  return Math.log2(base / objetivo);
}

/**
 * Denominador a partir de una medida real de metros por píxel.
 *
 * Es la vía que usa el mapa. Medir la escala sobre el propio mapa —proyectando
 * dos puntos y viendo cuánto terreno hay entre ellos— en vez de deducirla del
 * nivel de zoom evita atarse a la convención interna de la librería (teselas de
 * 512 px, y no de 256) y sigue siendo correcta con la cámara inclinada, donde
 * la escala ya no es la misma en toda la pantalla y la del centro es la única
 * que se puede declarar.
 */
export function denominatorFromMpp(mpp, pixelMm = STANDARD_PIXEL_MM) {
  if (!Number.isFinite(mpp) || mpp <= 0) return NaN;
  return mpp / (pixelMm / 1000);
}

/**
 * Cuánto hay que mover el zoom para pasar de una escala a otra.
 *
 * A latitud fija los metros por píxel van con 2^-zoom, así que el salto es
 * exacto de una vez y no hace falta iterar.
 */
export function zoomDelta(actual, objetivo) {
  if (!Number.isFinite(actual) || !Number.isFinite(objetivo)) return 0;
  if (actual <= 0 || objetivo <= 0) return 0;
  return Math.log2(actual / objetivo);
}

/**
 * Redondeo a la escala "bonita" más cercana en la progresión 1-2-5.
 *
 * Sirve para proponer una escala de partida a partir de la que ya se está
 * viendo, sin obligar a leer un número como 1:37.412.
 */
export function niceScale(denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return DEFAULT_SCALES[0];
  const exp = Math.floor(Math.log10(denominator));
  const mant = denominator / Math.pow(10, exp);
  /*
   * La cercanía se mide en logaritmo, no en resta. Una escala es una razón:
   * entre 1:25.000 y 1:50.000, un 1:37.400 está a un factor 1,50 de la primera
   * y a 1,34 de la segunda, así que la que se le parece es 1:50.000 aunque en
   * resta pura salga la otra. Restar trataría un salto de 12.400 en el extremo
   * grande igual que el mismo salto en el pequeño, donde son escalas distintas.
   */
  const paso = [1, 2, 2.5, 5, 10].reduce((a, b) =>
    Math.abs(Math.log(b / mant)) < Math.abs(Math.log(a / mant)) ? b : a,
  );
  return clampScale(Math.round(paso * Math.pow(10, exp)));
}

export function clampScale(denominator) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(denominator)));
}

/**
 * "1:25.000" con separador de millar fino.
 *
 * Se usa el espacio estrecho (U+2009) y no el punto: en un mapa chileno el
 * punto es separador de millar, pero el mismo archivo se lee en sitios donde
 * es separador decimal, y "1:25.000" leído como veinticinco es un desastre.
 * El espacio no es ambiguo en ninguna parte y es lo que recomienda el SI.
 */
export function formatScale(denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return '—';
  const n = Math.round(denominator);
  return `1:${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')}`;
}

/**
 * Lee una escala escrita a mano. Acepta "25000", "1:25000", "1:25 000",
 * "25.000" y "25k", que es lo que uno teclea con prisa en terreno.
 */
export function parseScale(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? clampScale(text) : null;
  if (!text) return null;
  let t = String(text).trim().toLowerCase().replace(/^1\s*[:/]\s*/, '');
  const miles = /k$/.test(t);
  if (miles) t = t.slice(0, -1);
  // Se quitan los separadores de millar de cualquier estilo; una escala no
  // tiene decimales que valga la pena conservar.
  t = t.replace(/[\s.,\u2009'`]/g, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t) * (miles ? 1000 : 1);
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampScale(n);
}

/** Lista de escalas normalizada: sin repetidos, ordenada y dentro de rango. */
export function sanitizeScales(list) {
  if (!Array.isArray(list)) return [...DEFAULT_SCALES];
  const out = [];
  for (const v of list) {
    const n = typeof v === 'number' ? v : parseScale(v);
    if (n === null || !Number.isFinite(n)) continue;
    const c = clampScale(n);
    if (!out.includes(c)) out.push(c);
  }
  out.sort((a, b) => a - b);
  return out.length ? out : [...DEFAULT_SCALES];
}

/**
 * ¿Se ha ido la escala de la fijada?
 *
 * Con la escala fijada el zoom se mantiene, pero el denominador NO: depende del
 * coseno de la latitud, así que subir en latitud dentro de la zona de trabajo
 * lo corre solo. En Ñuble-Biobío, moverse un grado cambia la escala cerca de un
 * 1,5 %: invisible en pantalla, pero es la diferencia entre estar a 1:25.000 y
 * decir que se está. El umbral es medio por ciento, por debajo del cual
 * corregir sería un temblor y no una corrección.
 */
export function scaleDrifted(actual, objetivo, tolerancia = 0.005) {
  if (!Number.isFinite(actual) || !Number.isFinite(objetivo) || objetivo <= 0) return false;
  return Math.abs(actual - objetivo) / objetivo > tolerancia;
}


/* ======================================================= la pantalla === */

/**
 * EL TAMAÑO FÍSICO DE LA PANTALLA, QUE EL NAVEGADOR NO CUENTA
 *
 * Todo lo de arriba trabaja con `pixelMm`: cuántos milímetros mide un píxel
 * CSS. Es el único número que convierte un mapa en pantalla en una escala de
 * verdad, y es justo el que no se puede leer.
 *
 * Lo que SÍ se puede leer del dispositivo:
 *
 * - `screen.width` / `screen.height`, la resolución en píxeles CSS;
 * - `devicePixelRatio`, cuántos píxeles del panel hay por píxel CSS.
 *
 * Lo que NO expone ninguna API: cuántos centímetros mide el vidrio. Dos
 * pantallas de 1920×1080 —una de 13" y otra de 27"— son indistinguibles desde
 * JavaScript, y sin embargo su píxel mide menos de la mitad en la primera. Por
 * eso la única vía honesta es preguntar UNA cosa, la diagonal, y calcular el
 * resto; o medir la barra con una regla, que es lo definitivo.
 *
 *
 * POR QUÉ BASTA CON LA DIAGONAL
 *
 * Los píxeles son cuadrados en todas las pantallas que importan, así que la
 * diagonal en píxeles y la diagonal en milímetros son la misma razón que el
 * ancho en píxeles y el ancho en milímetros. Es decir:
 *
 *     mm por píxel = diagonal en mm / diagonal en píxeles
 *
 * y la diagonal en píxeles sale de Pitágoras sobre la resolución, que sí se
 * puede leer. No hace falta preguntar ni el ancho ni la proporción.
 */

/** Milímetros que mide un píxel CSS, a partir de la diagonal en pulgadas. */
export function pixelMmFromDiagonal(diagonalInches, cssWidth, cssHeight) {
  const d = Number(diagonalInches);
  const w = Number(cssWidth);
  const h = Number(cssHeight);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const px = Math.hypot(w, h);
  const mm = (d * 25.4) / px;
  return Number.isFinite(mm) && mm > 0 ? Math.round(mm * 1000) / 1000 : null;
}

/** La inversa: qué diagonal en pulgadas implica un `pixelMm` dado. */
export function diagonalFromPixelMm(pixelMm, cssWidth, cssHeight) {
  const mm = Number(pixelMm);
  const w = Number(cssWidth);
  const h = Number(cssHeight);
  if (!Number.isFinite(mm) || mm <= 0) return null;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return Math.round(((Math.hypot(w, h) * mm) / 25.4) * 10) / 10;
}

/**
 * Tamaños de pantalla de catálogo.
 *
 * Son diagonales, no resoluciones, y eso es deliberado: la resolución se lee
 * del dispositivo y la diagonal no, así que la lista solo tiene que cubrir lo
 * que falta. Un 15,6" es un 15,6" tenga la resolución que tenga, y el cálculo
 * sale bien en los dos casos sin duplicar la entrada.
 *
 * La etiqueta nombra el aparato típico porque nadie sabe de memoria la
 * diagonal de su tablet, pero todos saben cuál tienen.
 */
export const SCREEN_SIZES = [
  { inches: 7.9, label: '7.9″ — iPad mini' },
  { inches: 8.3, label: '8.3″ — iPad mini 6' },
  { inches: 9.7, label: '9.7″ — iPad / iPad Pro 9.7' },
  { inches: 10.2, label: '10.2″ — iPad 9' },
  { inches: 10.5, label: '10.5″ — iPad Air 3' },
  { inches: 10.9, label: '10.9″ — iPad Air 4-5 / iPad 10' },
  { inches: 11, label: '11″ — iPad Pro 11 / Galaxy Tab S9' },
  { inches: 12.4, label: '12.4″ — Galaxy Tab S9+' },
  { inches: 12.9, label: '12.9″ — iPad Pro 12.9' },
  { inches: 13.3, label: '13.3″ — laptop' },
  { inches: 14, label: '14″ — laptop' },
  { inches: 15.6, label: '15.6″ — laptop' },
  { inches: 16, label: '16″ — laptop' },
  { inches: 17.3, label: '17.3″ — laptop' },
  { inches: 21.5, label: '21.5″ — desktop monitor' },
  { inches: 24, label: '24″ — desktop monitor' },
  { inches: 27, label: '27″ — desktop monitor' },
  { inches: 32, label: '32″ — desktop monitor' },
];

/**
 * Largo de la barra de calibración, en milímetros.
 *
 * 100 mm y no 10: el error de leer una regla es de un milímetro se mida lo que
 * se mida, así que sobre un patrón de 10 mm ese milímetro es un 10 % de error
 * —peor que no calibrar— y sobre 100 mm es un 1 %, que ya no mueve la escala.
 * Más largo no cabe en el desplegable de una tablet en vertical.
 */
export const RULER_MM = 100;

/**
 * Corrige `pixelMm` con lo que una regla de verdad mide sobre la barra.
 *
 * La barra se dibuja con `RULER_MM / pixelMm` píxeles, o sea declarando que
 * mide `RULER_MM`. Si la regla dice otra cosa, el píxel real es mayor o menor
 * en esa misma proporción, y ese es todo el cálculo.
 */
export function calibratePixelMm(pixelMm, measuredMm, nominalMm = RULER_MM) {
  const p = Number(pixelMm);
  const m = Number(measuredMm);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (!Number.isFinite(m) || m <= 0) return null;
  const v = (p * m) / nominalMm;
  // Mismo rango que acepta el ajuste a mano: fuera de ahí no hay pantalla, es
  // un dedo gordo en el teclado o una regla leída en pulgadas.
  if (v < 0.05 || v > 1) return null;
  return Math.round(v * 1000) / 1000;
}
