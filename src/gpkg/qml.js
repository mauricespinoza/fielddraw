import {
  CERTAINTY_BY_ID,
  LINE_TYPE_BY_ID,
  POLYGON_TYPE_BY_ID,
  effectiveLineColor,
} from '../symbology.js';

/**
 * Simbología QGIS: generación (al exportar) y lectura (al importar).
 *
 * QGIS guarda los estilos dentro del propio GeoPackage, en una tabla
 * `layer_styles`, con `styleQML` (nativo, completo) y `styleSLD` (estándar,
 * más pobre). Escribimos ambos: si nuestro QML tuviera algún detalle mal, el
 * SLD sirve de red de seguridad.
 */

/** QGIS mide en milímetros; en pantalla asumimos 96 dpi. */
const MM_TO_PX = 96 / 25.4;

const uuid = () =>
  `{${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2)}}`;

const xmlEscape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function hexToRgba(hex, alpha = 255) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `0,0,0,${alpha}`;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha}`;
}

/** El grado de certeza mapea 1:1 a los estilos de línea nativos de QGIS. */
const QGIS_LINE_STYLE = { observed: 'solid', inferred: 'dash', covered: 'dot' };

/* ============================================================== GENERACIÓN */

function simpleLineLayer(color, widthMm, lineStyle) {
  return `        <layer class="SimpleLine" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="capstyle" type="QString" value="round"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="line_color" type="QString" value="${hexToRgba(color)}"/>
            <Option name="line_style" type="QString" value="${lineStyle}"/>
            <Option name="line_width" type="QString" value="${widthMm}"/>
            <Option name="line_width_unit" type="QString" value="MM"/>
            <Option name="offset" type="QString" value="0"/>
            <Option name="offset_unit" type="QString" value="MM"/>
            <Option name="use_custom_dash" type="QString" value="0"/>
          </Option>
        </layer>`;
}

function simpleFillLayer(color, outlineColor, outlineWidthMm, outlineStyle) {
  return `        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="${hexToRgba(color, 115)}"/>
            <Option name="outline_color" type="QString" value="${hexToRgba(outlineColor)}"/>
            <Option name="outline_style" type="QString" value="${outlineStyle}"/>
            <Option name="outline_width" type="QString" value="${outlineWidthMm}"/>
            <Option name="outline_width_unit" type="QString" value="MM"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>`;
}

function wrapSymbol(name, type, layersXml) {
  return `      <symbol name="${name}" type="${type}" alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10" is_animated="0">
${layersXml}
      </symbol>`;
}

/**
 * Renderer basado en reglas: una regla por combinación tipo × certeza
 * presente en los datos. Así la leyenda que ve el geólogo en QGIS es
 * exactamente la de su mapa, sin categorías vacías.
 */
function buildRuleQML({ combos, geometryType, symbolFor, symbolType }) {
  const rules = [];
  const symbols = [];
  combos.forEach((combo, i) => {
    const filter = `&quot;type&quot; = '${combo.type}' AND &quot;certainty&quot; = '${combo.certainty}'`;
    rules.push(
      `      <rule key="${uuid()}" symbol="${i}" label="${xmlEscape(combo.label)}" filter="${filter}"/>`,
    );
    symbols.push(wrapSymbol(String(i), symbolType, symbolFor(combo)));
  });

  return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology">
  <renderer-v2 type="RuleRenderer" forceraster="0" symbollevels="0" enableorderby="0" referencescale="-1">
    <rules key="${uuid()}">
${rules.join('\n')}
    </rules>
    <symbols>
${symbols.join('\n')}
    </symbols>
  </renderer-v2>
  <layerGeometryType>${geometryType}</layerGeometryType>
</qgis>`;
}

/**
 * `ornaments` es el estilo editable: si el usuario cambió el color de una falla
 * o de un pliegue, el QML tiene que llevar ese, no el del catálogo. Lo que se
 * abre en QGIS debe verse como lo que se dejó en la tablet.
 */
export function buildLineQML(combos, ornaments) {
  return buildRuleQML({
    combos,
    geometryType: 1,
    symbolType: 'line',
    symbolFor: (c) => {
      const t = LINE_TYPE_BY_ID.get(c.type);
      const widthMm = (0.5 * (t ? t.weight : 1)).toFixed(2);
      return simpleLineLayer(
        effectiveLineColor(c.type, ornaments),
        widthMm,
        QGIS_LINE_STYLE[c.certainty] || 'solid',
      );
    },
  });
}

/** `units` son las definidas por el usuario; sin ellas se usa el catálogo base. */
export function buildPolygonQML(combos, units) {
  const colorOf = (id) => {
    const u = units && units.find((x) => x.id === id);
    if (u) return u.color;
    const t = POLYGON_TYPE_BY_ID.get(id);
    return t ? t.color : '#999999';
  };
  return buildRuleQML({
    combos,
    geometryType: 2,
    symbolType: 'fill',
    symbolFor: (c) => {
      const color = colorOf(c.type);
      return simpleFillLayer(color, shade(color), '0.4', QGIS_LINE_STYLE[c.certainty] || 'solid');
    },
  });
}

/**
 * Marcador simple de QGIS con forma de línea. Es la pieza con la que se arma
 * el símbolo de rumbo/manteo: una línea larga para el rumbo y una corta,
 * girada 90° y desplazada, para el tic de manteo.
 */
function lineMarkerLayer({ color, sizeMm, angle, offset, widthMm = '0.4' }) {
  return `        <layer class="SimpleMarker" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="angle" type="QString" value="${angle}"/>
            <Option name="color" type="QString" value="${hexToRgba(color)}"/>
            <Option name="horizontal_anchor_point" type="QString" value="1"/>
            <Option name="joinstyle" type="QString" value="bevel"/>
            <Option name="name" type="QString" value="line"/>
            <Option name="offset" type="QString" value="${offset}"/>
            <Option name="offset_unit" type="QString" value="MM"/>
            <Option name="outline_color" type="QString" value="${hexToRgba(color)}"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="${widthMm}"/>
            <Option name="outline_width_unit" type="QString" value="MM"/>
            <Option name="size" type="QString" value="${sizeMm}"/>
            <Option name="size_unit" type="QString" value="MM"/>
            <Option name="vertical_anchor_point" type="QString" value="1"/>
          </Option>
        </layer>`;
}

/** Círculo hueco: el símbolo de un plano horizontal, que no tiene rumbo. */
function circleMarkerLayer(color, sizeMm) {
  return `        <layer class="SimpleMarker" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="angle" type="QString" value="0"/>
            <Option name="color" type="QString" value="0,0,0,0"/>
            <Option name="name" type="QString" value="circle"/>
            <Option name="offset" type="QString" value="0,0"/>
            <Option name="outline_color" type="QString" value="${hexToRgba(color)}"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.4"/>
            <Option name="outline_width_unit" type="QString" value="MM"/>
            <Option name="size" type="QString" value="${sizeMm}"/>
            <Option name="size_unit" type="QString" value="MM"/>
          </Option>
        </layer>`;
}

/**
 * Rotación por dato aplicada al SÍMBOLO entero y no a cada capa.
 *
 * Es la diferencia que hace que el símbolo funcione: QGIS, al rotar un símbolo
 * de marcador por dato, gira también los desplazamientos de sus capas. Poner la
 * rotación capa a capa giraría cada trazo sobre su propio centro y el tic se
 * quedaría donde estaba, apuntando a cualquier lado.
 */
const ANGLE_FROM_STRIKE = `      <data_defined_properties>
        <Option type="Map">
          <Option name="name" type="QString" value=""/>
          <Option name="properties" type="Map">
            <Option name="angle" type="Map">
              <Option name="active" type="bool" value="true"/>
              <Option name="expression" type="QString" value="&quot;strike&quot;"/>
              <Option name="type" type="int" value="3"/>
            </Option>
          </Option>
          <Option name="type" type="QString" value="collection"/>
        </Option>
      </data_defined_properties>`;

function markerSymbol(name, layersXml, rotate) {
  return `      <symbol name="${name}" type="marker" alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10" is_animated="0">
${rotate ? `${ANGLE_FROM_STRIKE}\n` : ''}${layersXml}
      </symbol>`;
}

/**
 * QML de las medidas estructurales: una regla por tipo de superficie × variante
 * del símbolo, con los mismos umbrales que usa la app.
 *
 * Las variantes se separan en reglas y no en una sola con expresiones porque un
 * plano horizontal no lleva tic —no hay dirección de manteo que dibujar— y uno
 * vertical lo lleva a los dos lados. Son tres símbolos distintos, no uno con
 * parámetros.
 */
export function buildPointQML(types, { horizontalMax = 3, verticalMin = 87 } = {}) {
  const rules = [];
  const symbols = [];
  const push = (filtro, label, layersXml, rotate) => {
    const i = symbols.length;
    rules.push(
      `      <rule key="${uuid()}" symbol="${i}" label="${xmlEscape(label)}" filter="${filtro}"/>`,
    );
    symbols.push(markerSymbol(String(i), layersXml, rotate));
  };

  const campoDip = '&quot;dip&quot;';
  for (const t of types) {
    const color = t.color;
    const tipo = `&quot;type&quot; = '${t.id}'`;

    push(
      `${tipo} AND ${campoDip} <= ${horizontalMax}`,
      `${t.label} — horizontal`,
      [circleMarkerLayer(color, '2.4'), lineMarkerLayer({ color, sizeMm: '3.4', angle: '0', offset: '0,0' }), lineMarkerLayer({ color, sizeMm: '3.4', angle: '90', offset: '0,0' })].join('\n'),
      false,
    );
    push(
      `${tipo} AND ${campoDip} >= ${verticalMin}`,
      `${t.label} — vertical`,
      [
        lineMarkerLayer({ color, sizeMm: '5', angle: '0', offset: '0,0', widthMm: '0.5' }),
        lineMarkerLayer({ color, sizeMm: '1.6', angle: '90', offset: '0.8,0' }),
        lineMarkerLayer({ color, sizeMm: '1.6', angle: '90', offset: '-0.8,0' }),
      ].join('\n'),
      true,
    );
    push(
      `${tipo} AND ${campoDip} > ${horizontalMax} AND ${campoDip} < ${verticalMin}`,
      `${t.label} — inclined`,
      [
        lineMarkerLayer({ color, sizeMm: '5', angle: '0', offset: '0,0' }),
        lineMarkerLayer({ color, sizeMm: '1.8', angle: '90', offset: '0.9,0' }),
      ].join('\n'),
      true,
    );
  }

  return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology|Labeling">
  <renderer-v2 type="RuleRenderer" forceraster="0" symbollevels="0" enableorderby="0" referencescale="-1">
    <rules key="${uuid()}">
${rules.join('\n')}
    </rules>
    <symbols>
${symbols.join('\n')}
    </symbols>
  </renderer-v2>
  <labeling type="simple">
    <settings>
      <text-style fieldName="if(&quot;dip&quot; &lt;= ${horizontalMax}, '', format_number(&quot;dip&quot;, 0))" isExpression="1" fontFamily="Arial" fontSize="8" textColor="0,0,0,255">
        <text-buffer bufferDraw="1" bufferSize="0.8" bufferColor="255,255,255,255"/>
      </text-style>
      <placement placement="1" dist="1.6" quadOffset="3"/>
    </settings>
  </labeling>
  <layerGeometryType>0</layerGeometryType>
</qgis>`;
}

/**
 * SLD de las medidas. Es la red de seguridad del QML y por eso es más pobre:
 * SLD no tiene un marcador con forma de línea, así que se usa una cruz rotada
 * por el rumbo — se pierde el tic de manteo, pero la orientación se conserva.
 */
export function buildPointSLD(types) {
  const reglas = types
    .map(
      (t) => `      <se:Rule>
        <se:Name>${xmlEscape(t.label)}</se:Name>
        <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
          <ogc:PropertyIsEqualTo>
            <ogc:PropertyName>type</ogc:PropertyName>
            <ogc:Literal>${xmlEscape(t.id)}</ogc:Literal>
          </ogc:PropertyIsEqualTo>
        </ogc:Filter>
        <se:PointSymbolizer>
          <se:Graphic>
            <se:Mark>
              <se:WellKnownName>cross</se:WellKnownName>
              <se:Stroke>
                <se:SvgParameter name="stroke">${t.color}</se:SvgParameter>
                <se:SvgParameter name="stroke-width">1.2</se:SvgParameter>
              </se:Stroke>
            </se:Mark>
            <se:Size>14</se:Size>
            <se:Rotation>
              <ogc:PropertyName>strike</ogc:PropertyName>
            </se:Rotation>
          </se:Graphic>
        </se:PointSymbolizer>
      </se:Rule>`,
    )
    .join('\n');
  return sldDocument('geol_points', reglas);
}

const SLD_DASH = { observed: null, inferred: '6 3', covered: '1 3' };

function sldRules(combos, symbolizer) {
  return combos
    .map(
      (c) => `      <se:Rule>
        <se:Name>${xmlEscape(c.label)}</se:Name>
        <se:Description><se:Title>${xmlEscape(c.label)}</se:Title></se:Description>
        <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
          <ogc:And>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>type</ogc:PropertyName>
              <ogc:Literal>${xmlEscape(c.type)}</ogc:Literal>
            </ogc:PropertyIsEqualTo>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>certainty</ogc:PropertyName>
              <ogc:Literal>${xmlEscape(c.certainty)}</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:And>
        </ogc:Filter>
${symbolizer(c)}
      </se:Rule>`,
    )
    .join('\n');
}

function sldDocument(layerName, rulesXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:se="http://www.opengis.net/se" xmlns:ogc="http://www.opengis.net/ogc" version="1.1.0">
  <NamedLayer>
    <se:Name>${xmlEscape(layerName)}</se:Name>
    <UserStyle>
      <se:Name>FieldDraw</se:Name>
      <se:FeatureTypeStyle>
${rulesXml}
      </se:FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`;
}

export function buildLineSLD(combos, ornaments) {
  return sldDocument(
    'geol_lines',
    sldRules(combos, (c) => {
      const t = LINE_TYPE_BY_ID.get(c.type);
      const dash = SLD_DASH[c.certainty];
      return `        <se:LineSymbolizer>
          <se:Stroke>
            <se:SvgParameter name="stroke">${effectiveLineColor(c.type, ornaments)}</se:SvgParameter>
            <se:SvgParameter name="stroke-width">${(2 * (t ? t.weight : 1)).toFixed(2)}</se:SvgParameter>
            <se:SvgParameter name="stroke-linecap">round</se:SvgParameter>${
              dash ? `\n            <se:SvgParameter name="stroke-dasharray">${dash}</se:SvgParameter>` : ''
            }
          </se:Stroke>
        </se:LineSymbolizer>`;
    }),
  );
}

export function buildPolygonSLD(combos) {
  return sldDocument(
    'geol_polygons',
    sldRules(combos, (c) => {
      const t = POLYGON_TYPE_BY_ID.get(c.type);
      const color = t ? t.color : '#999999';
      const dash = SLD_DASH[c.certainty];
      return `        <se:PolygonSymbolizer>
          <se:Fill>
            <se:SvgParameter name="fill">${color}</se:SvgParameter>
            <se:SvgParameter name="fill-opacity">0.45</se:SvgParameter>
          </se:Fill>
          <se:Stroke>
            <se:SvgParameter name="stroke">${shade(color)}</se:SvgParameter>
            <se:SvgParameter name="stroke-width">1.5</se:SvgParameter>${
              dash ? `\n            <se:SvgParameter name="stroke-dasharray">${dash}</se:SvgParameter>` : ''
            }
          </se:Stroke>
        </se:PolygonSymbolizer>`;
    }),
  );
}

/** Etiqueta legible de una combinación tipo × certeza. */
export function comboLabel(type, certainty) {
  const t = LINE_TYPE_BY_ID.get(type) || POLYGON_TYPE_BY_ID.get(type);
  const c = CERTAINTY_BY_ID.get(certainty);
  return `${t ? t.label : type} — ${c ? c.label.toLowerCase() : certainty}`;
}

function shade(hex, factor = 0.62) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/* ================================================================= LECTURA */

/**
 * QGIS escribe el color como "r,g,b,a" y, desde 3.30, a veces añade una cola
 * "rgb:0.82,0.18,..." con más precisión. Nos quedamos con los 4 primeros
 * enteros. También acepta "#rrggbb".
 */
export function parseQgisColor(value) {
  if (!value) return null;
  const v = String(value).trim();
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (hex) {
    return {
      color: `#${hex[1].toLowerCase()}`,
      opacity: hex[2] ? parseInt(hex[2], 16) / 255 : 1,
    };
  }
  const nums = v.split(',').map((s) => Number.parseInt(s, 10));
  if (nums.length < 3 || nums.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  const [r, g, b] = nums;
  const a = Number.isFinite(nums[3]) ? nums[3] : 255;
  const hexOf = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return { color: `#${hexOf(r)}${hexOf(g)}${hexOf(b)}`, opacity: a / 255 };
}

const QGIS_DASH = {
  solid: null,
  no: null,
  dash: [4, 2],
  dot: [1, 2],
  'dash dot': [4, 2, 1, 2],
  'dash dot dot': [4, 2, 1, 2, 1, 2],
};

/** Lee las propiedades de un `<layer>`, en formato `<Option>` o `<prop>`. */
function layerProps(layerEl) {
  const props = {};
  for (const p of layerEl.querySelectorAll(':scope > prop')) {
    props[p.getAttribute('k')] = p.getAttribute('v');
  }
  for (const map of layerEl.querySelectorAll(':scope > Option[type="Map"]')) {
    for (const o of map.querySelectorAll(':scope > Option')) {
      const name = o.getAttribute('name');
      if (name) props[name] = o.getAttribute('value');
    }
  }
  return props;
}

function widthToPx(value, unit) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return 1;
  // Pixel y "RenderMetresInMapUnits" no se convierten; el resto se asume MM.
  if (unit === 'Pixel') return Math.max(0.4, n);
  return Math.max(0.4, n * MM_TO_PX);
}

function parseSymbol(symbolEl) {
  if (!symbolEl) return null;
  const type = symbolEl.getAttribute('type');
  // Nos quedamos con la primera capa de símbolo; las pilas de varias capas
  // (típicas de ornamentos geológicos) se aplanan a su capa base.
  const layers = Array.from(symbolEl.querySelectorAll(':scope > layer'));
  if (layers.length === 0) return null;
  const el = layers[0];
  const cls = el.getAttribute('class');
  const p = layerProps(el);

  if (type === 'line') {
    const stroke = parseQgisColor(p.line_color) || { color: '#333333', opacity: 1 };
    const width = widthToPx(p.line_width, p.line_width_unit);
    let dash = QGIS_DASH[p.line_style] ?? null;
    if (p.use_custom_dash === '1' && p.customdash) {
      const parts = p.customdash.split(';').map(Number).filter(Number.isFinite);
      const wMm = Number.parseFloat(p.line_width) || 0.26;
      if (parts.length >= 2) dash = parts.map((d) => Math.max(0.05, d / wMm));
    }
    if (p.line_style === 'no') return null;
    return { kind: 'line', color: stroke.color, opacity: stroke.opacity, width, dash };
  }

  if (type === 'fill') {
    const fill = parseQgisColor(p.color) || { color: '#999999', opacity: 0.5 };
    const outline = parseQgisColor(p.outline_color) || { color: '#555555', opacity: 1 };
    return {
      kind: 'fill',
      color: fill.color,
      opacity: p.style === 'no' ? 0 : fill.opacity,
      outlineColor: outline.color,
      outlineOpacity: p.outline_style === 'no' ? 0 : outline.opacity,
      outlineWidth: widthToPx(p.outline_width, p.outline_width_unit),
      outlineDash: QGIS_DASH[p.outline_style] ?? null,
    };
  }

  // Marcadores: sólo el círculo/relleno básico, suficiente para puntos.
  const fill = parseQgisColor(p.color) || { color: '#cc3333', opacity: 1 };
  const outline = parseQgisColor(p.outline_color) || { color: '#ffffff', opacity: 1 };
  return {
    kind: 'marker',
    shape: p.name || 'circle',
    symbolLayerClass: cls,
    color: fill.color,
    opacity: fill.opacity,
    outlineColor: outline.color,
    outlineOpacity: outline.opacity,
    outlineWidth: widthToPx(p.outline_width, p.outline_width_unit),
    radius: widthToPx(p.size, p.size_unit) / 2,
  };
}

/**
 * Traduce una expresión de filtro de QGIS a un filtro de MapLibre.
 * Soporta el subconjunto habitual — `"campo" = 'valor'` unido por AND/OR y
 * comparaciones numéricas — y devuelve `undefined` si no lo entiende, para
 * que la regla se aplique sin filtro en vez de romper la carga.
 */
export function parseQgisFilter(expr) {
  if (!expr || !expr.trim() || expr.trim().toUpperCase() === 'ELSE') return null;
  const text = expr.trim();

  const splitTop = (s, op) => {
    const parts = [];
    let depth = 0;
    let quote = null;
    let last = 0;
    const re = new RegExp(`\\s${op}\\s`, 'gi');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0) {
        re.lastIndex = i;
        const m = re.exec(s);
        if (m && m.index === i) {
          parts.push(s.slice(last, i));
          i += m[0].length - 1;
          last = i + 1;
        }
      }
    }
    parts.push(s.slice(last));
    return parts.length > 1 ? parts : null;
  };

  const ands = splitTop(text, 'AND');
  if (ands) {
    const subs = ands.map((s) => parseQgisFilter(s));
    return subs.some((s) => s === undefined) ? undefined : ['all', ...subs.filter(Boolean)];
  }
  const ors = splitTop(text, 'OR');
  if (ors) {
    const subs = ors.map((s) => parseQgisFilter(s));
    return subs.some((s) => s === undefined || s === null) ? undefined : ['any', ...subs];
  }

  const inner = /^\((.*)\)$/s.exec(text);
  if (inner) return parseQgisFilter(inner[1]);

  const cmp = /^\s*"([^"]+)"\s*(<=|>=|<>|!=|=|<|>)\s*(.+?)\s*$/s.exec(text);
  if (!cmp) return undefined;
  const [, field, op, rawValue] = cmp;
  let value;
  const str = /^'(.*)'$/s.exec(rawValue);
  if (str) value = str[1].replace(/''/g, "'");
  else if (/^-?\d+(\.\d+)?$/.test(rawValue)) value = Number(rawValue);
  else return undefined;

  // QGIS usa `=` y `<>`; MapLibre exige `==` y `!=`.
  const mlOp = op === '=' ? '==' : op === '<>' || op === '!=' ? '!=' : op;
  return [mlOp, ['get', field], value];
}

/**
 * Parsea un QML y devuelve reglas ordenadas: la primera que hace match manda.
 * Cubre singleSymbol, categorizedSymbol, graduatedSymbol y RuleRenderer.
 */
export function parseQML(qmlText) {
  const doc = new DOMParser().parseFromString(qmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('QML mal formado');

  const renderer = doc.querySelector('renderer-v2');
  if (!renderer) throw new Error('El QML no trae renderer-v2');
  const kind = renderer.getAttribute('type');

  const symbolsById = new Map();
  for (const s of renderer.querySelectorAll(':scope > symbols > symbol')) {
    symbolsById.set(s.getAttribute('name'), parseSymbol(s));
  }

  const warnings = [];
  const rules = [];

  if (kind === 'singleSymbol') {
    const sym = symbolsById.get('0') || symbolsById.values().next().value;
    if (sym) rules.push({ filter: null, symbol: sym, label: '' });
  } else if (kind === 'categorizedSymbol') {
    const attr = renderer.getAttribute('attr');
    for (const c of renderer.querySelectorAll(':scope > categories > category')) {
      if (c.getAttribute('render') === 'false') continue;
      const sym = symbolsById.get(c.getAttribute('symbol'));
      if (!sym) continue;
      const raw = c.getAttribute('value');
      const label = c.getAttribute('label') || raw || '';
      // value vacío = categoría "todos los demás valores"
      const filter = raw === '' || raw === null ? null : ['==', ['get', attr], coerce(raw)];
      rules.push({ filter, symbol: sym, label });
    }
    // La categoría comodín debe quedar al final o se comería a las demás.
    rules.sort((a, b) => (a.filter === null ? 1 : 0) - (b.filter === null ? 1 : 0));
  } else if (kind === 'graduatedSymbol') {
    const attr = renderer.getAttribute('attr');
    for (const r of renderer.querySelectorAll(':scope > ranges > range')) {
      if (r.getAttribute('render') === 'false') continue;
      const sym = symbolsById.get(r.getAttribute('symbol'));
      if (!sym) continue;
      const lower = Number(r.getAttribute('lower'));
      const upper = Number(r.getAttribute('upper'));
      rules.push({
        filter: ['all', ['>=', ['get', attr], lower], ['<=', ['get', attr], upper]],
        symbol: sym,
        label: r.getAttribute('label') || '',
      });
    }
  } else if (kind === 'RuleRenderer') {
    for (const r of renderer.querySelectorAll('rules > rule')) {
      const sym = symbolsById.get(r.getAttribute('symbol'));
      if (!sym) continue;
      const parsed = parseQgisFilter(r.getAttribute('filter'));
      if (parsed === undefined) {
        warnings.push(`Filtro no interpretado: ${r.getAttribute('filter')}`);
      }
      rules.push({
        filter: parsed === undefined ? null : parsed,
        symbol: sym,
        label: r.getAttribute('label') || '',
      });
    }
  } else {
    throw new Error(`Renderer no soportado: ${kind}`);
  }

  if (rules.length === 0) throw new Error('El QML no produjo ninguna regla utilizable');
  return { rules, warnings, rendererType: kind };
}

function coerce(v) {
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
