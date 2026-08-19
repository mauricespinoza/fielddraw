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
