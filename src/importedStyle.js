/**
 * Traduce las reglas leídas de un QML a capas de MapLibre.
 *
 * Dos restricciones de MapLibre gobiernan la forma del resultado:
 *
 * 1. `line-dasharray` no admite expresiones data-driven, así que hay que
 *    emitir una capa por patrón de guiones distinto.
 * 2. En QGIS gana la PRIMERA regla que hace match; en MapLibre las capas se
 *    superponen. Por eso a cada regla se le resta explícitamente el filtro de
 *    todas las anteriores, quedando mutuamente excluyentes.
 */

const DEFAULT_LINE = { color: '#4b5563', opacity: 1, width: 1.5, dash: null };
const DEFAULT_FILL = {
  color: '#9ca3af',
  opacity: 0.4,
  outlineColor: '#374151',
  outlineOpacity: 0.9,
  outlineWidth: 1.2,
  outlineDash: null,
};
const DEFAULT_MARKER = {
  color: '#ef4444',
  opacity: 1,
  outlineColor: '#ffffff',
  outlineOpacity: 1,
  outlineWidth: 1.2,
  radius: 5,
};

const dashKey = (dash) => (dash && dash.length ? dash.map((d) => d.toFixed(3)).join(',') : 'solid');

/** Filtros efectivos: cada regla excluye a las que la preceden. */
function effectiveFilters(rules) {
  const out = [];
  const previous = [];
  for (const r of rules) {
    const own = r.filter ?? true;
    const negations = previous.map((f) => ['!', f]);
    out.push(negations.length ? ['all', own, ...negations] : own);
    previous.push(own);
  }
  return out;
}

function caseExpr(pairs, fallback) {
  if (pairs.length === 0) return fallback;
  if (pairs.length === 1 && pairs[0][0] === true) return pairs[0][1];
  const parts = [];
  for (const [cond, value] of pairs) parts.push(cond, value);
  return ['case', ...parts, fallback];
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return map;
}

/**
 * @returns {{layers: object[], ids: string[]}} capas listas para addLayer.
 */
export function buildImportedLayers({ id, sourceId, kind, style }) {
  const rules = style && style.rules && style.rules.length ? style.rules : null;
  const filters = rules ? effectiveFilters(rules) : [true];
  const entries = rules
    ? rules.map((r, i) => ({ symbol: r.symbol, filter: filters[i] }))
    : [{ symbol: null, filter: true }];

  const layers = [];

  if (kind === 'polygon') {
    const fills = entries.filter((e) => !e.symbol || e.symbol.kind === 'fill');
    if (fills.length) {
      layers.push({
        id: `${id}-fill`,
        type: 'fill',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': caseExpr(
            fills.map((e) => [e.filter, (e.symbol || DEFAULT_FILL).color]),
            DEFAULT_FILL.color,
          ),
          'fill-opacity': caseExpr(
            fills.map((e) => [e.filter, (e.symbol || DEFAULT_FILL).opacity]),
            DEFAULT_FILL.opacity,
          ),
        },
      });
    }
    // Contornos: una capa por patrón de guiones.
    const groups = groupBy(fills, (e) => dashKey((e.symbol || DEFAULT_FILL).outlineDash));
    let i = 0;
    for (const [, group] of groups) {
      const dash = (group[0].symbol || DEFAULT_FILL).outlineDash;
      layers.push({
        id: `${id}-outline-${i++}`,
        type: 'line',
        source: sourceId,
        filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['any', ...group.map((e) => e.filter)]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': caseExpr(
            group.map((e) => [e.filter, (e.symbol || DEFAULT_FILL).outlineColor]),
            DEFAULT_FILL.outlineColor,
          ),
          'line-width': caseExpr(
            group.map((e) => [e.filter, (e.symbol || DEFAULT_FILL).outlineWidth]),
            DEFAULT_FILL.outlineWidth,
          ),
          'line-opacity': caseExpr(
            group.map((e) => [e.filter, (e.symbol || DEFAULT_FILL).outlineOpacity]),
            DEFAULT_FILL.outlineOpacity,
          ),
          ...(dash ? { 'line-dasharray': dash } : {}),
        },
      });
    }
  } else if (kind === 'point') {
    layers.push({
      id: `${id}-circle`,
      type: 'circle',
      source: sourceId,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': caseExpr(
          entries.map((e) => [e.filter, (e.symbol || DEFAULT_MARKER).color]),
          DEFAULT_MARKER.color,
        ),
        'circle-radius': caseExpr(
          entries.map((e) => [e.filter, (e.symbol || DEFAULT_MARKER).radius]),
          DEFAULT_MARKER.radius,
        ),
        'circle-opacity': caseExpr(
          entries.map((e) => [e.filter, (e.symbol || DEFAULT_MARKER).opacity]),
          DEFAULT_MARKER.opacity,
        ),
        'circle-stroke-color': caseExpr(
          entries.map((e) => [e.filter, (e.symbol || DEFAULT_MARKER).outlineColor]),
          DEFAULT_MARKER.outlineColor,
        ),
        'circle-stroke-width': caseExpr(
          entries.map((e) => [e.filter, (e.symbol || DEFAULT_MARKER).outlineWidth]),
          DEFAULT_MARKER.outlineWidth,
        ),
      },
    });
  } else {
    const groups = groupBy(entries, (e) => dashKey((e.symbol || DEFAULT_LINE).dash));
    let i = 0;
    for (const [, group] of groups) {
      const dash = (group[0].symbol || DEFAULT_LINE).dash;
      layers.push({
        id: `${id}-line-${i++}`,
        type: 'line',
        source: sourceId,
        filter: ['any', ...group.map((e) => e.filter)],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': caseExpr(
            group.map((e) => [e.filter, (e.symbol || DEFAULT_LINE).color]),
            DEFAULT_LINE.color,
          ),
          'line-width': caseExpr(
            group.map((e) => [e.filter, (e.symbol || DEFAULT_LINE).width]),
            DEFAULT_LINE.width,
          ),
          'line-opacity': caseExpr(
            group.map((e) => [e.filter, (e.symbol || DEFAULT_LINE).opacity]),
            DEFAULT_LINE.opacity,
          ),
          ...(dash ? { 'line-dasharray': dash } : {}),
        },
      });
    }
  }

  return { layers, ids: layers.map((l) => l.id) };
}

/** Opacidad base por capa generada, para que el slider del panel multiplique. */
export function baseOpacityOf(layer) {
  const paint = layer.paint || {};
  const key =
    layer.type === 'fill' ? 'fill-opacity' : layer.type === 'circle' ? 'circle-opacity' : 'line-opacity';
  const v = paint[key];
  return typeof v === 'number' ? v : 1;
}
