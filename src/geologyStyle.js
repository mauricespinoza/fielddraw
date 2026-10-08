import {
  CERTAINTIES,
  LINE_TYPES,
  POLYGON_TYPES,
  effectiveLineColor,
  effectiveLineWeight,
  withImportColor,
} from './symbology.js';

export const GEOLOGY_SOURCE = 'geology-src';
export const DRAFT_SOURCE = 'draft-src';

/**
 * El color de las líneas también cambia en caliente: el módulo de simbología
 * deja reescribir el de los tipos con ornamento, y mapView reaplica esta
 * expresión igual que hace con el relleno de las unidades.
 */
export function lineColorExpr(ornaments, importStyle) {
  return withImportColor(
    [
      'match',
      ['get', 'type'],
      ...LINE_TYPES.flatMap((t) => [t.id, effectiveLineColor(t.id, ornaments)]),
      '#888888',
    ],
    importStyle,
  );
}

const defaultLineColorExpr = lineColorExpr(null);

/**
 * El grosor también es editable, y por el mismo motivo que el color: al
 * preparar una figura, un contacto que se pierde sobre la ortofoto se arregla
 * engordándolo, no exportando a QGIS. `weight` del catálogo es solo el valor
 * de partida.
 */
function lineWeightExpr(ornaments) {
  return [
    'match',
    ['get', 'type'],
    ...LINE_TYPES.flatMap((t) => [t.id, effectiveLineWeight(t.id, ornaments)]),
    1,
  ];
}

/**
 * MapLibre exige que la expresión `zoom` sea entrada directa de un
 * `interpolate` de nivel superior: envolverla en un `*` invalida la propiedad
 * y el ancho cae silenciosamente al valor por defecto. Por eso el factor por
 * tipo se aplica dentro de cada parada, no por fuera.
 */
function zoomWidth(at) {
  return ['interpolate', ['linear'], ['zoom'], 8, at(1.5), 13, at(2.4), 18, at(4.2)];
}

const zoomWidthExpr = zoomWidth((v) => v);

/** Ancho de la traza y de su halo, con los grosores que el usuario haya puesto. */
export function lineWidthExpr(ornaments) {
  const peso = lineWeightExpr(ornaments);
  return zoomWidth((v) => ['*', peso, v]);
}

export function casingWidthExpr(ornaments) {
  const peso = lineWeightExpr(ornaments);
  return zoomWidth((v) => ['+', ['*', peso, v], 2.4]);
}

/** Ancho del halo a cada lado de la traza, en px (la mitad del `+ 2.4`). */
const HALO_PX = 1.2;

/** El ancho de la traza a un zoom entero, igual que `zoomWidth`. */
function widthAt(z, peso) {
  const stops = [
    [8, 1.5],
    [13, 2.4],
    [18, 4.2],
  ];
  let v;
  if (z <= stops[0][0]) v = stops[0][1];
  else if (z >= stops[2][0]) v = stops[2][1];
  else {
    const i = z < stops[1][0] ? 0 : 1;
    const [z0, v0] = stops[i];
    const [z1, v1] = stops[i + 1];
    v = v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
  }
  return peso * v;
}

/**
 * Patrón de guiones del halo de una línea segmentada o punteada.
 *
 * MapLibre mide los guiones en anchos de línea, así que el mismo patrón en
 * el halo —más ancho— no calzaba con el del trazo. Aquí se recalcula en
 * píxeles para cada zoom entero (MapLibre escala los guiones con el ancho del
 * zoom entero inferior) y cada grosor de tipo: cada guion del trazo queda con
 * su propio halo, `HALO_PX` más largo por cada extremo. Con remate redondo el
 * propio remate, más ancho, ya rodea el punto, y basta con el mismo ritmo.
 */
export function casingDashExpr(certainty, ornaments) {
  const c = CERTAINTIES.find((x) => x.id === certainty);
  if (!c || !c.dash) return null;
  const [d, g] = c.dash;
  const patron = (z, peso) => {
    const w = widthAt(z, peso);
    const wc = w + 2 * HALO_PX;
    const r = (v) => Math.max(0, Math.round((v / wc) * 1000) / 1000);
    if (c.cap === 'round') return [r(d * w), r(g * w)];
    const hueco = Math.max(0.05 * wc, g * w - 2 * HALO_PX);
    // Rotado HALO_PX hacia atrás: guion, hueco, el trozo que asoma ANTES del
    // siguiente guion y un hueco nulo que MapLibre funde.
    return [r(d * w + HALO_PX), r(hueco), r(HALO_PX), 0];
  };
  const pesos = LINE_TYPES.map((t) => [t.id, effectiveLineWeight(t.id, ornaments)]);
  const porZoom = (z) => [
    'match',
    ['get', 'type'],
    ...pesos.flatMap(([id, p]) => [id, ['literal', patron(z, p)]]),
    ['literal', patron(z, 1)],
  ];
  const expr = ['step', ['zoom'], porZoom(0)];
  for (let z = 1; z <= 24; z++) expr.push(z, porZoom(z));
  return expr;
}

/**
 * El color de los polígonos sale de las unidades definidas por el usuario, que
 * cambian en caliente: mapView reescribe estas expresiones cada vez que se
 * edita el módulo de unidades.
 */
export function unitFillExpr(units, importStyle) {
  const list = units && units.length ? units : POLYGON_TYPES.map((t) => ({ id: t.id, color: t.color }));
  return withImportColor(
    ['match', ['get', 'type'], ...list.flatMap((u) => [u.id, u.color]), '#999999'],
    importStyle,
  );
}

/**
 * El texto del rótulo: el código de la unidad a la que pertenece el polígono.
 *
 * Se resuelve por el catálogo de unidades y no por el atributo `code` del
 * elemento, por el mismo motivo que el color: renombrar el código de una
 * unidad tiene que verse en el mapa en el acto, sin tocar cada polígono. El
 * atributo del elemento queda de reserva para lo que venga de fuera con un
 * código propio y sin unidad que lo respalde.
 */
export function unitCodeExpr(units) {
  const reserva = ['coalesce', ['get', 'code'], ''];
  const list = (units || []).filter((u) => u && u.id);
  if (!list.length) return reserva;
  return ['match', ['get', 'type'], ...list.flatMap((u) => [u.id, String(u.code || '')]), reserva];
}

/** Luminancia relativa (0–1) de un hex; `null` si no se puede leer. */
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * Rótulo de un contacto, «arriba-abajo», cada código con el color de su
 * unidad. Sale del catálogo, como el color de los polígonos: recolorear o
 * recodificar una unidad se ve en el acto. Sin catálogo se cae al texto que
 * guarda el propio contacto, en negro.
 *
 * El halo se elige por contraste con los colores del par: bajo un amarillo o
 * un rosado pálido un halo blanco los borraba.
 */
export function contactLabelStyle(units) {
  const list = (units || []).filter((u) => u && u.id);
  if (!list.length) {
    return { field: ['get', 'contactLabel'], halo: 'rgba(255,255,255,0.92)' };
  }
  const lado = (prop) => ['coalesce', ['get', prop], ''];
  const code = (prop) => [
    'match',
    lado(prop),
    ...list.flatMap((u) => [u.id, String(u.code || u.name || '')]),
    '',
  ];
  const color = (prop) => ['match', lado(prop), ...list.flatMap((u) => [u.id, u.color || '#12181f']), '#12181f'];
  // Halo que mejor contrasta con las DOS unidades del par (contraste WCAG):
  // claro bajo códigos oscuros, oscuro bajo códigos claros, y en un par
  // mixto el que deja legible al peor de los dos.
  const BLANCO = 'rgba(255,255,255,0.92)';
  const OSCURO = 'rgba(18,24,31,0.88)';
  const lum = new Map(list.map((u) => [u.id, luminance(u.color) ?? 0]));
  const contraste = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const haloPara = (la, lb) => {
    const conBlanco = Math.min(contraste(la, 1), contraste(lb, 1));
    const conOscuro = Math.min(contraste(la, 0.009), contraste(lb, 0.009));
    return conOscuro > conBlanco ? OSCURO : BLANCO;
  };
  const porLado = (l) => [
    'match',
    lado('unitBelowId'),
    ...list.flatMap((u) => [u.id, haloPara(l, lum.get(u.id))]),
    haloPara(l, l),
  ];
  const field = [
    'format',
    code('unitAboveId'),
    { 'text-color': color('unitAboveId') },
    ['case', ['all', ['!=', code('unitAboveId'), ''], ['!=', code('unitBelowId'), '']], '-', ''],
    // Gris medio: se lee sobre el halo claro y sobre el oscuro.
    { 'text-color': '#8a94a0' },
    code('unitBelowId'),
    { 'text-color': color('unitBelowId') },
  ];
  // Sin unidad abajo cuenta solo la de arriba (y viceversa).
  const soloAbajo = ['match', lado('unitBelowId'), ...list.flatMap((u) => [u.id, haloPara(lum.get(u.id), lum.get(u.id))]), BLANCO];
  const halo = [
    'match',
    lado('unitAboveId'),
    ...list.flatMap((u) => [u.id, porLado(lum.get(u.id))]),
    soloAbajo,
  ];
  return { field, halo };
}

export function unitOutlineExpr(units, importStyle) {
  const list = units && units.length ? units : POLYGON_TYPES.map((t) => ({ id: t.id, color: t.color }));
  return withImportColor(
    ['match', ['get', 'type'], ...list.flatMap((u) => [u.id, shade(u.color)]), '#555555'],
    importStyle,
  );
}

const fillColorExpr = unitFillExpr(null);
const outlineColorExpr = unitOutlineExpr(null);

/**
 * Opacidad propia de cada elemento, editable desde el menú de propiedades.
 * Se multiplica por la opacidad de la capa, así que ambas se componen.
 */
export const FEATURE_ALPHA = ['coalesce', ['get', 'opacity'], 1];

/** Combina la opacidad de capa (número) con la del elemento (dato). */
export function withFeatureAlpha(value) {
  return ['*', value, FEATURE_ALPHA];
}

/**
 * Opacidad base de cada capa. El slider del panel multiplica sobre esto, para
 * que el relleno de polígono no tape el basemap ni estando "al 100%".
 */
export const BASE_OPACITY = {};

/**
 * `line-dasharray` no admite expresiones data-driven en MapLibre, así que el
 * grado de certeza se resuelve con una capa por patrón, filtrada por atributo.
 */
export function geologyLayers() {
  const layers = [];

  layers.push({
    id: 'geology-fill',
    type: 'fill',
    source: GEOLOGY_SOURCE,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': fillColorExpr, 'fill-opacity': 0.45 },
  });
  BASE_OPACITY['geology-fill'] = 0.45;

  // Resalte de selección: va debajo del trazo real para leerse como un halo.
  // El filtro lo reescribe mapView cada vez que cambia la selección.
  layers.push({
    id: 'geology-selected',
    type: 'line',
    source: GEOLOGY_SOURCE,
    filter: ['in', ['get', 'id'], ['literal', []]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#00E5FF',
      'line-width': zoomWidth((v) => v + 7),
      'line-opacity': 0.75,
      'line-blur': 1.5,
    },
  });
  BASE_OPACITY['geology-selected'] = 0.75;

  for (const c of CERTAINTIES) {
    const id = `geology-outline-${c.id}`;
    layers.push({
      id,
      type: 'line',
      source: GEOLOGY_SOURCE,
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'certainty'], c.id]],
      layout: { 'line-cap': c.cap, 'line-join': 'round' },
      paint: {
        'line-color': outlineColorExpr,
        'line-width': zoomWidthExpr,
        'line-opacity': 0.95,
        ...(c.dash ? { 'line-dasharray': c.dash } : {}),
      },
    });
    BASE_OPACITY[id] = 0.95;
  }

  for (const c of CERTAINTIES) {
    /*
     * Halo blanco: sin esto las líneas oscuras desaparecen sobre el satélite.
     *
     * En las segmentadas y punteadas el halo lleva su propio patrón de
     * guiones (`casingDashExpr`), calculado para que cada guion del trazo
     * tenga el suyo: el mismo patrón del trazo, en un halo más ancho, no
     * calzaba y emborronaba el ritmo de la certeza.
     */
    {
      const casingId = `geology-line-casing-${c.id}`;
      const dash = casingDashExpr(c.id, null);
      layers.push({
        id: casingId,
        type: 'line',
        source: GEOLOGY_SOURCE,
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'certainty'], c.id]],
        layout: { 'line-cap': c.cap, 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': casingWidthExpr(null),
          'line-opacity': 0.55,
          ...(dash ? { 'line-dasharray': dash } : {}),
        },
      });
      BASE_OPACITY[casingId] = 0.55;
    }

    const id = `geology-line-${c.id}`;
    layers.push({
      id,
      type: 'line',
      source: GEOLOGY_SOURCE,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'certainty'], c.id]],
      layout: { 'line-cap': c.cap, 'line-join': 'round' },
      paint: {
        'line-color': defaultLineColorExpr,
        'line-width': lineWidthExpr(null),
        'line-opacity': 1,
        ...(c.dash ? { 'line-dasharray': c.dash } : {}),
      },
    });
    BASE_OPACITY[id] = 1;
  }

  /*
   * Rótulo de un contacto: los códigos de las dos unidades que se tocan,
   * «arriba-abajo», cada uno con el color de su unidad. Se coloca en el
   * centro de la traza pero se lee HORIZONTAL, como el resto de rótulos de
   * la pantalla: girado a lo largo de un contacto sinuoso costaba leerlo.
   */
  layers.push({
    id: 'geology-contact-label',
    type: 'symbol',
    source: GEOLOGY_SOURCE,
    filter: [
      'all',
      ['==', ['geometry-type'], 'LineString'],
      ['!=', ['coalesce', ['get', 'contactLabel'], ''], ''],
    ],
    layout: {
      'symbol-placement': 'line-center',
      'text-field': contactLabelStyle(null).field,
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-padding': 4,
      'text-allow-overlap': false,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport',
    },
    paint: {
      'text-color': '#12181f',
      'text-halo-color': contactLabelStyle(null).halo,
      'text-halo-width': 1.6,
    },
  });
  BASE_OPACITY['geology-contact-label'] = 1;

  /*
   * EL CÓDIGO DE LA UNIDAD, ROTULADO SOBRE EL POLÍGONO.
   *
   * Va la última —encima de todo lo demás del dibujo— y apagada de fábrica:
   * un mapa de terreno a medio levantar tiene decenas de polígonos pequeños y
   * rotularlos todos lo vuelve ilegible justo cuando hace falta ver la
   * geometría. Se enciende cuando el mapa ya se está leyendo, no mientras se
   * dibuja.
   *
   * QUIÉN LLEVA ETIQUETA NO SE DECIDE AQUÍ. El filtro nace vacío y lo
   * reescribe mapView con la lista de polígonos que en ESTE encuadre son lo
   * bastante grandes para que quepa el rótulo dentro, y solo con los más
   * grandes de ellos: ver `syncUnitLabels`. La razón de hacerlo por lista y no
   * con una expresión es que «lo bastante grande» se mide en píxeles de
   * pantalla, y eso depende del zoom, de la latitud y de la forma del
   * polígono, que ninguna expresión de estilo sabe calcular.
   *
   * `symbol-placement: point` sobre un polígono hace que MapLibre coloque el
   * rótulo en el polo de inaccesibilidad —el punto más adentro—, así que la
   * etiqueta cae DENTRO de la unidad aunque sea cóncava, y no en el centroide,
   * que en una unidad en forma de arco queda fuera.
   */
  layers.push({
    id: 'geology-unit-label',
    type: 'symbol',
    source: GEOLOGY_SOURCE,
    filter: ['in', ['get', 'id'], ['literal', []]],
    layout: {
      'symbol-placement': 'point',
      'text-field': unitCodeExpr(null),
      'text-font': ['Noto Sans Regular'],
      'text-size': 13,
      'text-padding': 6,
      // Sin solape y sin recorte por el borde: una etiqueta a medias miente
      // sobre qué unidad rotula.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      // El rótulo se lee horizontal aunque la vista esté girada: es una
      // etiqueta, no un elemento del terreno.
      'text-rotation-alignment': 'viewport',
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#12181f',
      'text-halo-color': 'rgba(255,255,255,0.92)',
      'text-halo-width': 1.6,
    },
  });
  BASE_OPACITY['geology-unit-label'] = 1;

  return layers;
}

export const GEOLOGY_LAYER_IDS = geologyLayers().map((l) => l.id);

/**
 * El reparto del dibujo en las capas del panel: qué capas de MapLibre son las
 * unidades y cuáles las trazas. Vive aquí, junto a las capas que nombra, para
 * que añadir una no obligue a acordarse de clasificarla en mapView.
 *
 * El halo de selección va con las unidades —las de más abajo— para que quede
 * por debajo de todo lo que pueda señalar. Apagarlas no lo apaga: ver
 * `ALWAYS_VISIBLE` en mapView.
 */
export const GEOLOGY_UNIT_LAYER_IDS = GEOLOGY_LAYER_IDS.filter(
  (id) => id.startsWith('geology-fill') || id.startsWith('geology-outline') ||
    id === 'geology-selected' || id === 'geology-unit-label',
);

export const GEOLOGY_TRACE_LAYER_IDS = GEOLOGY_LAYER_IDS.filter(
  (id) => !GEOLOGY_UNIT_LAYER_IDS.includes(id),
);

/** La capa de rótulos de unidad, que mapView enciende y filtra. */
export const UNIT_LABEL_LAYER_ID = 'geology-unit-label';

/** Capas cuyo `line-color` sale del catálogo de tipos de línea. */
export const GEOLOGY_LINE_LAYER_IDS = CERTAINTIES.map((c) => `geology-line-${c.id}`);

/** Los halos blancos de las trazas, uno por grado de certeza. */
export const GEOLOGY_CASING_LAYER_IDS = CERTAINTIES.map((c) => `geology-line-casing-${c.id}`);

/** Capas del elemento en construcción: siempre por encima de todo. */
export function draftLayers() {
  return [
    {
      id: 'draft-fill',
      type: 'fill',
      source: DRAFT_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#00E5FF', 'fill-opacity': 0.18 },
    },
    {
      id: 'draft-casing',
      type: 'line',
      source: DRAFT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#00131a', 'line-width': 6, 'line-opacity': 0.5 },
    },
    {
      id: 'draft-line',
      type: 'line',
      source: DRAFT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#00E5FF', 'line-width': 2.6 },
    },
    {
      id: 'draft-vertices',
      type: 'circle',
      source: DRAFT_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#00E5FF',
        'circle-stroke-width': 2.5,
      },
    },
  ];
}

export const EDIT_SOURCE = 'edit-src';

/**
 * Manijas de la herramienta de vértices. Los compartidos van en magenta: es la
 * señal de que, con edición topológica activa, moverlos arrastra también al
 * polígono vecino.
 */
export function editLayers() {
  return [
    {
      id: 'edit-midpoints',
      type: 'circle',
      source: EDIT_SOURCE,
      filter: ['==', ['get', 'kind'], 'mid'],
      paint: {
        'circle-radius': 3.5,
        'circle-color': 'rgba(255,255,255,0.55)',
        'circle-stroke-color': '#2dd4bf',
        'circle-stroke-width': 1.2,
      },
    },
    {
      id: 'edit-vertices',
      type: 'circle',
      source: EDIT_SOURCE,
      filter: ['all', ['==', ['get', 'kind'], 'vertex'], ['!=', ['get', 'shared'], true]],
      paint: {
        'circle-radius': 5.5,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#2dd4bf',
        'circle-stroke-width': 2.4,
      },
    },
    {
      id: 'edit-vertices-shared',
      type: 'circle',
      source: EDIT_SOURCE,
      filter: ['all', ['==', ['get', 'kind'], 'vertex'], ['==', ['get', 'shared'], true]],
      paint: {
        'circle-radius': 6,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#ff2fd0',
        'circle-stroke-width': 2.8,
      },
    },
  ];
}

export const EDIT_LAYER_IDS = editLayers().map((l) => l.id);

export const DRAFT_LAYER_IDS = draftLayers().map((l) => l.id);

/** Oscurece un hex para usarlo como borde del relleno del mismo tipo. */
function shade(hex, factor = 0.62) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
