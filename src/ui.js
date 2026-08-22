import * as store from './store.js';
import { STANDARD_PIXEL_MM, formatScale, niceScale, parseScale } from './scale.js';
import { closeAttrs, importedEntries, importedTitle, openAttrs } from './attrs.js';
import {
  CERTAINTIES,
  CERTAINTY_BY_ID,
  FLIPPABLE_ORNAMENT_TYPES,
  LINE_GROUPS,
  LINE_TYPES,
  LINE_TYPE_BY_ID,
  ORNAMENT_LIMITS,
  ORNAMENT_TYPES,
  STRUCTURE_TYPES,
  STRUCTURE_TYPE_BY_ID,
  effectiveLineColor,
  isObservedOnly,
} from './symbology.js';
import {
  DEM_METHODS,
  MEASURE_METHODS,
  METHOD_BY_ID,
  formatStrikeDip,
  planeFromPoints,
  quadrant,
} from './structure.js';
import { chaikin, simplifyDP } from './simplify.js';
import {
  DemSampler,
  OPENTOPO_DEMS,
  OPENTOPO_DEM_BY_ID,
  OPENTOPO_SIGNUP,
  OpenTopoSampler,
  TERRARIUM_NOMINAL_M,
} from './dem.js';
import {
  formatDistance,
  formatElevation,
  indexAtDistance,
  profileCSV,
  renderProfileChart,
} from './profile.js';
import {
  downloadBlob,
  downloadGeoJSON,
  downloadText,
  saveOpenTopoKey,
} from './persistence.js';
import { exportGeoPackage, importGeoPackage } from './gpkg/index.js';
import { MBTILES_WARN_BYTES, openTileFile } from './tiles.js';
import {
  applyCut,
  applyLinesToPolygon,
  applyMerge,
  applyHole,
  applyReshape,
  applyTopology,
} from './editOps.js';
import { openProject, parseProject, saveProject } from './project.js';
import { initStraboPanel } from './strabo/panel.js';
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  comboLabel,
  consumesDefault,
  isTyping,
  labelsFor,
  shortcutFor,
} from './shortcuts.js';

const $ = (id) => document.getElementById(id);

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Muestra de cómo se verá el trazo: color = tipo, patrón = certeza. */
function dashPreview(color, dash) {
  const w = 3;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 8');
  svg.setAttribute('width', '40');
  svg.setAttribute('height', '8');
  svg.setAttribute('class', 'dash-preview');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', '1');
  line.setAttribute('y1', '4');
  line.setAttribute('x2', '39');
  line.setAttribute('y2', '4');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', String(w));
  line.setAttribute('stroke-linecap', dash ? 'round' : 'butt');
  if (dash) line.setAttribute('stroke-dasharray', dash.map((d) => d * w).join(' '));
  svg.appendChild(line);
  return svg;
}

function chip({ label, title, color, dash, swatch, glyph, active, disabled, onClick, cls = '' }) {
  const b = document.createElement('button');
  b.className = `chip${cls ? ` ${cls}` : ''}${active ? ' active' : ''}`;
  if (title) b.title = title;
  if (disabled) b.disabled = true;
  if (glyph) {
    const g = document.createElement('span');
    g.className = 'glyph';
    g.textContent = glyph;
    b.appendChild(g);
  } else if (swatch) {
    const s = document.createElement('span');
    s.className = 'swatch';
    s.style.background = color;
    b.appendChild(s);
  } else {
    b.appendChild(dashPreview(color, dash));
  }
  const t = document.createElement('span');
  t.textContent = label;
  b.appendChild(t);
  b.addEventListener('click', onClick);
  return b;
}

/** Grupo etiquetado dentro de la paleta; devuelve el contenedor de los chips. */
function paletteGroup(parent, label) {
  const group = document.createElement('div');
  group.className = 'palette-group';
  const l = document.createElement('span');
  l.className = 'palette-label';
  l.textContent = label;
  group.appendChild(l);
  const row = document.createElement('div');
  row.className = 'palette-row';
  group.appendChild(row);
  parent.appendChild(group);
  return row;
}

/**
 * Campo numérico compacto para la paleta. Emite en `input` y no en `change`
 * para que el número que se escribe con brújula ya esté puesto cuando el dedo
 * va al mapa a colocar la medida.
 */
function numberField(label, value, { min, max, step }, onInput) {
  const wrap = document.createElement('label');
  wrap.className = 'palette-number';
  const l = document.createElement('span');
  l.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(Math.round(value * 10) / 10);
  input.inputMode = 'decimal';
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onInput(v);
  });
  wrap.append(l, input);
  return wrap;
}

/* ---------- paleta de tipos ---------- */

/** Modos de la herramienta Nodos, con su glifo y su ayuda. */
const VERTEX_MODES = [
  { id: 'move', label: 'Move', glyph: '✥', help: 'Drag a handle; a midpoint inserts one' },
  { id: 'add', label: 'Add', glyph: '＋', help: 'Tap the edge to insert a vertex' },
  { id: 'delete', label: 'Delete', glyph: '✕', help: 'Tap a vertex to remove it' },
];

function buildPalette() {
  const el = $('palette');
  const s = store.getState();
  el.replaceChildren();

  // La herramienta de nodos no elige tipo, pero sí modo de edición.
  if (s.tool === 'vertices') {
    el.classList.remove('hidden');
    const scroll = document.createElement('div');
    scroll.className = 'palette-scroll';
    const group = document.createElement('div');
    group.className = 'palette-group';
    const gl = document.createElement('span');
    gl.className = 'palette-label';
    gl.textContent = 'Vertices';
    group.appendChild(gl);
    for (const m of VERTEX_MODES) {
      group.appendChild(
        chip({
          label: m.label,
          title: m.help,
          glyph: m.glyph,
          active: s.vertexMode === m.id,
          onClick: () => store.setVertexMode(m.id),
        }),
      );
    }
    scroll.appendChild(group);
    el.appendChild(scroll);
    return;
  }

  // Rumbo y manteo: método, superficie medida y, con brújula, los números.
  if (s.tool === 'measure') {
    el.classList.remove('hidden');
    const scroll = document.createElement('div');
    scroll.className = 'palette-scroll';

    const metodos = paletteGroup(scroll, 'Method');
    for (const m of MEASURE_METHODS) {
      metodos.appendChild(
        chip({
          label: m.short,
          title: m.help,
          glyph: m.glyph,
          active: s.measureMethod === m.id,
          onClick: () => store.setMeasureMethod(m.id),
        }),
      );
    }

    const tipos = paletteGroup(scroll, 'Surface');
    for (const t of STRUCTURE_TYPES) {
      tipos.appendChild(
        chip({
          label: t.short,
          title: t.label,
          color: t.color,
          swatch: true,
          active: s.measureType === t.id,
          onClick: () => store.setMeasureType(t.id),
        }),
      );
    }

    // Invertido solo aplica a la estratificación: una foliación o una diaclasa
    // no tienen techo y muro que se puedan haber dado vuelta.
    if (s.measureType === 'bedding') {
      const inv = paletteGroup(scroll, 'Younging');
      inv.appendChild(
        chip({
          label: 'Overturned',
          title: 'Beds are upside down: the tick gets a hook back',
          glyph: '⤣',
          active: s.measureOverturned,
          onClick: () => store.setMeasureOverturned(!s.measureOverturned),
        }),
      );
    }

    if (s.measureMethod === 'manual') {
      const nums = paletteGroup(scroll, 'Compass');
      nums.appendChild(
        numberField('Strike', s.manualStrike, { min: 0, max: 359.9, step: 1 }, (v) =>
          store.setManualStrike(v),
        ),
      );
      nums.appendChild(
        numberField('Dip', s.manualDip, { min: 0, max: 90, step: 1 }, (v) => store.setManualDip(v)),
      );
    }

    el.appendChild(scroll);
    return;
  }

  // Estas herramientas no crean elementos, así que no hay tipo que escoger.
  if (['navigate', 'select', 'cut', 'reshape', 'profile'].includes(s.tool)) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  // Fila de certeza: tres chips minúsculos arriba del todo. Con un tipo de
  // certeza acotada (los pliegues) los otros dos se ven pero no se pueden
  // pulsar: dejarlos a la vista explica la regla, esconderlos solo desconcierta.
  const soloObservado = s.tool === 'line' && isObservedOnly(s.lineType);
  const certRow = document.createElement('div');
  certRow.className = 'palette-row certainty-row';
  for (const c of CERTAINTIES) {
    const bloqueado = soloObservado && c.id !== 'observed';
    certRow.appendChild(
      chip({
        label: c.short,
        title: bloqueado
          ? `${LINE_TYPE_BY_ID.get(s.lineType).label} is only mapped as observed`
          : c.label,
        color: '#e6edf3',
        dash: c.dash,
        active: s.certainty === c.id,
        disabled: bloqueado,
        cls: 'certainty',
        onClick: () => store.setCertainty(c.id),
      }),
    );
  }
  el.appendChild(certRow);

  const scroll = document.createElement('div');
  scroll.className = 'palette-scroll';
  const activeDash = (CERTAINTY_BY_ID.get(s.certainty) || {}).dash ?? null;

  if (s.tool === 'line') {
    for (const g of LINE_GROUPS) {
      const items = LINE_TYPES.filter((x) => x.group === g);
      if (!items.length) continue;
      const group = document.createElement('div');
      group.className = 'palette-group';
      const gl = document.createElement('span');
      gl.className = 'palette-label';
      gl.textContent = g;
      group.appendChild(gl);
      for (const t of items) {
        group.appendChild(
          chip({
            label: t.short,
            title: t.label,
            color: effectiveLineColor(t.id, s.ornaments),
            // Un pliegue se dibuja siempre continuo, sea cual sea la certeza
            // activa: la muestra tiene que enseñar eso y no el patrón de otro.
            dash: isObservedOnly(t.id) ? null : activeDash,
            active: s.lineType === t.id,
            onClick: () => store.setLineType(t.id),
          }),
        );
      }
      scroll.appendChild(group);
    }
  } else {
    const group = document.createElement('div');
    group.className = 'palette-group';
    const gl = document.createElement('span');
    gl.className = 'palette-label';
    gl.textContent = 'Units';
    group.appendChild(gl);
    for (const u of s.units) {
      group.appendChild(
        chip({
          label: u.code || u.name.slice(0, 8),
          title: `${u.name}${u.code ? ` (${u.code})` : ''}`,
          color: u.color,
          swatch: true,
          active: s.polygonType === u.id,
          onClick: () => store.setPolygonType(u.id),
        }),
      );
    }
    const edit = document.createElement('button');
    edit.className = 'chip ghost';
    edit.textContent = '+ Edit';
    edit.title = 'Open the units module';
    edit.addEventListener('click', () => $('units-panel').classList.add('open'));
    group.appendChild(edit);
    scroll.appendChild(group);
  }
  el.appendChild(scroll);
}

/* ---------- módulo de unidades ---------- */

function renderUnits() {
  const list = $('unit-list');
  const s = store.getState();
  list.replaceChildren();

  for (const u of s.units) {
    const li = document.createElement('li');
    li.className = 'unit-row';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = u.color;
    color.setAttribute('aria-label', `Colour of ${u.name}`);
    color.addEventListener('input', () => store.updateUnit(u.id, { color: color.value }));

    const name = document.createElement('input');
    name.type = 'text';
    name.value = u.name;
    name.className = 'unit-name';
    name.setAttribute('aria-label', 'Name');
    name.addEventListener('change', () => store.updateUnit(u.id, { name: name.value }));

    const code = document.createElement('input');
    code.type = 'text';
    code.value = u.code;
    code.className = 'unit-code';
    code.maxLength = 12;
    code.setAttribute('aria-label', 'Code');
    code.addEventListener('change', () => store.updateUnit(u.id, { code: code.value }));

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '✕';
    del.title = 'Remove unit';
    del.disabled = s.units.length <= 1;
    del.addEventListener('click', () => store.removeUnit(u.id));

    li.append(color, name, code, del);
    list.appendChild(li);
  }
}

/* ---------- módulo de simbología de ornamentos ---------- */

const SYMB_FIELDS = [
  { key: 'size', label: 'Size', fmt: (v) => `${v.toFixed(2)}×` },
  { key: 'spacing', label: 'Spacing', fmt: (v) => `${v} px` },
  { key: 'offset', label: 'Position', fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} px` },
  { key: 'minzoom', label: 'Min zoom', fmt: (v) => `z${v}` },
];

function symbField(type, field, value) {
  const lim = ORNAMENT_LIMITS[field.key];
  const row = document.createElement('label');
  row.className = 'symb-field';

  const name = document.createElement('span');
  name.textContent = field.label;

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(lim.min);
  range.max = String(lim.max);
  range.step = String(lim.step);
  range.value = String(value);
  range.setAttribute('aria-label', `${field.label} of ${LINE_TYPE_BY_ID.get(type).label}`);

  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = field.fmt(value);

  range.addEventListener('input', () => {
    const v = Number(range.value);
    num.textContent = field.fmt(v);
    store.setOrnament(type, { [field.key]: v });
  });

  row.append(name, range, num);
  return row;
}

/**
 * La muestra de color es el propio selector: en una tablet, tocar el cuadrito
 * y que se abra la rueda del sistema es el gesto que uno intenta igual. El
 * cambio se aplica en `input` para que se vea en el mapa mientras se arrastra,
 * como los deslizadores de al lado.
 */
function symbColor(type, value, label) {
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'swatch swatch-input';
  input.value = value;
  input.title = `Colour of ${label}`;
  input.setAttribute('aria-label', `Colour of ${label}`);
  input.addEventListener('input', () => store.setOrnament(type, { color: input.value }));
  return input;
}

function renderSymbology() {
  const list = $('symbology-list');
  const { ornaments } = store.getState();
  list.replaceChildren();

  for (const type of ORNAMENT_TYPES) {
    const meta = LINE_TYPE_BY_ID.get(type);
    const s = ornaments[type];
    if (!meta || !s) continue;

    const li = document.createElement('li');
    li.className = 'symb-row';

    const head = document.createElement('div');
    head.className = 'symb-head';
    const name = document.createElement('strong');
    name.textContent = meta.label;
    head.append(symbColor(type, effectiveLineColor(type, ornaments), meta.label), name);
    li.appendChild(head);

    // El símbolo de un pliegue va a caballo del eje: desplazarlo hacia un lado
    // rompe lo que significa, así que ese deslizador ni se ofrece.
    const fields = isObservedOnly(type) ? SYMB_FIELDS.filter((f) => f.key !== 'offset') : SYMB_FIELDS;
    for (const f of fields) li.appendChild(symbField(type, f, s[f.key]));
    list.appendChild(li);
  }
}

/* ---------- panel de capas ---------- */

const layerRows = new Map();

function layerRow(layer) {
  const li = document.createElement('li');

  const head = document.createElement('div');
  head.className = 'layer-head';

  const toggle = document.createElement('label');
  toggle.className = 'layer-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = layer.visible;
  cb.addEventListener('change', () => store.setLayerVisible(layer.id, cb.checked));
  const name = document.createElement('span');
  name.className = 'layer-name';
  name.textContent = layer.label;
  toggle.append(cb, name);

  const move = document.createElement('div');
  move.className = 'layer-move';
  if (layer.kind === 'imported' || layer.kind === 'tiles') {
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '✕';
    del.title = layer.kind === 'tiles' ? 'Remove offline map' : 'Remove imported layer';
    del.setAttribute('aria-label', `Remove ${layer.label}`);
    del.addEventListener('click', () =>
      layer.kind === 'tiles' ? store.removeTileSet(layer.id) : store.removeImported(layer.id),
    );
    move.appendChild(del);
  }
  const up = document.createElement('button');
  up.className = 'icon-btn';
  up.textContent = '▲';
  up.setAttribute('aria-label', `Move ${layer.label} up`);
  up.addEventListener('click', () => store.moveLayer(layer.id, -1));
  const down = document.createElement('button');
  down.className = 'icon-btn';
  down.textContent = '▼';
  down.setAttribute('aria-label', `Move ${layer.label} down`);
  down.addEventListener('click', () => store.moveLayer(layer.id, 1));
  move.append(up, down);

  head.append(toggle, move);

  const opacity = document.createElement('div');
  opacity.className = 'layer-opacity';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '1';
  range.step = '0.02';
  range.value = String(layer.opacity);
  range.setAttribute('aria-label', `Opacity of ${layer.label}`);
  const pct = document.createElement('span');
  pct.className = 'opacity-value';
  pct.textContent = `${Math.round(layer.opacity * 100)}%`;
  range.addEventListener('input', () => {
    pct.textContent = `${Math.round(Number(range.value) * 100)}%`;
    store.setLayerOpacity(layer.id, Number(range.value));
  });
  opacity.append(range, pct);

  li.append(head, opacity);
  return { li, cb, range, pct, up, down };
}

function renderLayers() {
  const list = $('layer-list');
  const layers = store.getState().layers;

  const live = new Set(layers.map((l) => l.id));
  for (const id of [...layerRows.keys()]) if (!live.has(id)) layerRows.delete(id);
  for (const l of layers) {
    if (!layerRows.has(l.id)) layerRows.set(l.id, layerRow(l));
  }

  // Reordenar sin recrear: recrear mataría el arrastre de un slider en curso.
  const desired = layers.map((l) => layerRows.get(l.id).li);
  const current = Array.from(list.children);
  const sameOrder =
    current.length === desired.length && desired.every((el, i) => current[i] === el);
  if (!sameOrder) list.replaceChildren(...desired);

  layers.forEach((l, i) => {
    const row = layerRows.get(l.id);
    row.li.classList.toggle('off', !l.visible);
    if (row.cb.checked !== l.visible) row.cb.checked = l.visible;
    if (document.activeElement !== row.range && Number(row.range.value) !== l.opacity) {
      row.range.value = String(l.opacity);
      row.pct.textContent = `${Math.round(l.opacity * 100)}%`;
    }
    row.up.disabled = i === 0;
    row.down.disabled = i === layers.length - 1;
  });
}

/* ---------- menú de propiedades de la selección ---------- */

/** Nombre de la unidad que la paleta tiene activa, para los tooltips. */
function activeUnitName(state) {
  const unit = state.units.find((u) => u.id === state.polygonType);
  return unit ? unit.name : 'no unit';
}

function section(parent, title) {
  const wrap = document.createElement('div');
  wrap.className = 'props-section';
  const h = document.createElement('span');
  h.className = 'palette-label';
  h.textContent = title;
  wrap.appendChild(h);
  parent.appendChild(wrap);
  return wrap;
}

export function openPropsMenu(screen) {
  const s = store.getState();
  const sel = store.selectedFeatures();
  if (sel.length === 0) return;

  const menu = $('props-menu');
  const body = $('props-body');
  body.replaceChildren();

  const polys = sel.filter((f) => f.geometry.type === 'Polygon');
  const lines = sel.filter((f) => f.geometry.type === 'LineString');
  const medidas = sel.filter((f) => f.properties.geomKind === 'measurement');
  $('props-title').textContent =
    sel.length === 1 ? '1 feature selected' : `${sel.length} features selected`;

  /*
   * Una medida sola se lleva el menú entero: sus dos números son lo único que
   * se edita, y las secciones de línea y polígono (certeza, unidad, suavizar,
   * cerrar contorno) no significan nada sobre un punto.
   */
  if (medidas.length === 1 && sel.length === 1) {
    $('props-title').textContent = `${STRUCTURE_TYPE_BY_ID.get(medidas[0].properties.type)?.label || 'Measurement'} ${formatStrikeDip(medidas[0].properties.strike, medidas[0].properties.dip)}`;
    measurementSection(body, medidas[0], () => openPropsMenu(screen));

    const del = document.createElement('button');
    del.className = 'pill danger wide';
    del.textContent = 'Delete measurement';
    del.addEventListener('click', () => {
      store.deleteSelected();
      closePropsMenu();
    });
    body.appendChild(del);

    positionPropsMenu(menu, screen);
    return;
  }

  // Editar nodos: el atajo natural desde aquí, ya que la selección ya acota
  // sobre qué geometrías se muestran las manijas. Los tres modos entran por la
  // misma puerta, para poder ir directo a añadir o a borrar un vértice.
  const acciones = section(body, 'Vertices');
  const nodosRow = document.createElement('div');
  nodosRow.className = 'palette-row';
  for (const m of VERTEX_MODES) {
    nodosRow.appendChild(
      chip({
        label: m.label,
        title: m.help,
        glyph: m.glyph,
        onClick: () => {
          store.setVertexMode(m.id);
          store.setTool('vertices');
          closePropsMenu();
        },
      }),
    );
  }
  acciones.appendChild(nodosRow);

  // Flip del ornamento: solo en las fallas, cuyo símbolo es asimétrico. Las
  // flechas de un pliegue son simétricas respecto del eje, así que reflejarlas
  // devolvería el mismo dibujo.
  const conOrnamento = sel.filter((f) => FLIPPABLE_ORNAMENT_TYPES.includes(f.properties.type));
  if (conOrnamento.length > 0) {
    const simb = section(body, 'Symbology');
    const flip = document.createElement('button');
    flip.className = 'pill wide';
    flip.textContent = `Flip symbol (${conOrnamento.length})`;
    flip.title =
      'Mirrors the teeth or ticks across the trace, moving them to the other block with no need to redraw the fault backwards';
    flip.addEventListener('click', () => {
      const n = store.flipSelectedOrnament();
      showBanner(
        n ? `Symbol flipped on ${n} feature(s).` : 'No ornamented lines to flip.',
        n ? 'info' : 'warn',
      );
      openPropsMenu(screen);
    });
    simb.appendChild(flip);

    const abrir = document.createElement('button');
    abrir.className = 'chip';
    abrir.textContent = 'Adjust size and spacing…';
    abrir.addEventListener('click', () => {
      closePropsMenu();
      openPanel('symbology-panel');
    });
    simb.appendChild(abrir);
  }

  // Certeza
  const cert = section(body, 'Certainty');
  const certRow = document.createElement('div');
  certRow.className = 'palette-row';
  const currentCert = sel.every((f) => f.properties.certainty === sel[0].properties.certainty)
    ? sel[0].properties.certainty
    : null;
  // Si TODO lo seleccionado tiene la certeza acotada, los otros dos valores se
  // bloquean. En una selección mixta se dejan pulsables: el store los aplica a
  // lo que los admite y respeta los ejes de pliegue.
  const todoObservado = sel.every((f) => isObservedOnly(f.properties.type));
  for (const c of CERTAINTIES) {
    const bloqueado = todoObservado && c.id !== 'observed';
    certRow.appendChild(
      chip({
        label: c.label,
        title: bloqueado ? 'Fold axial traces are only mapped as observed' : undefined,
        color: '#e6edf3',
        dash: c.dash,
        active: currentCert === c.id,
        disabled: bloqueado,
        onClick: () => {
          store.updateSelectedProps({ certainty: c.id });
          openPropsMenu(screen);
        },
      }),
    );
  }
  cert.appendChild(certRow);

  // Unidad, solo si hay polígonos en la selección
  if (polys.length > 0) {
    const uni = section(body, `Unit (${polys.length} polygon${polys.length === 1 ? '' : 's'})`);
    const row = document.createElement('div');
    row.className = 'palette-row';
    const currentUnit = polys.every((f) => f.properties.type === polys[0].properties.type)
      ? polys[0].properties.type
      : null;
    for (const u of s.units) {
      row.appendChild(
        chip({
          label: u.code || u.name.slice(0, 10),
          title: u.name,
          color: u.color,
          swatch: true,
          active: currentUnit === u.id,
          onClick: () => {
            store.assignUnitToSelection(u.id);
            openPropsMenu(screen);
          },
        }),
      );
    }
    uni.appendChild(row);
  }

  // Opacidad
  const op = section(body, 'Opacity');
  const opRow = document.createElement('label');
  opRow.className = 'layer-opacity';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0.1';
  range.max = '1';
  range.step = '0.05';
  range.value = String(sel[0].properties.opacity ?? 1);
  const pct = document.createElement('span');
  pct.className = 'opacity-value';
  pct.textContent = `${Math.round(Number(range.value) * 100)}%`;
  range.addEventListener('input', () => {
    pct.textContent = `${Math.round(Number(range.value) * 100)}%`;
    store.updateSelectedProps({ opacity: Number(range.value) });
  });
  opRow.append(range, pct);
  op.appendChild(opRow);

  // Geometría
  const geo = section(body, 'Geometry');
  const geoRow = document.createElement('div');
  geoRow.className = 'palette-row';

  const suavizar = document.createElement('button');
  suavizar.className = 'chip';
  suavizar.textContent = 'Smooth';
  suavizar.title = 'Round off the corners (Chaikin)';
  suavizar.addEventListener('click', () => {
    store.transformSelectedGeometry((g) => smoothGeometry(g));
  });

  const simplificar = document.createElement('button');
  simplificar.className = 'chip';
  simplificar.textContent = 'Simplify';
  simplificar.title = 'Drop redundant vertices (Douglas-Peucker)';
  simplificar.addEventListener('click', () => {
    store.transformSelectedGeometry((g) => simplifyGeometry(g));
  });

  geoRow.append(suavizar, simplificar);

  // Cerrar el contorno y convertirlo en unidad: con varias líneas se encadenan
  // primero, que es como se cierra un borde hecho de contactos y fallas.
  if (lines.length > 0) {
    const aPoligono = document.createElement('button');
    aPoligono.className = 'chip';
    aPoligono.textContent = lines.length === 1 ? 'To polygon' : `Close ${lines.length} lines`;
    aPoligono.title =
      lines.length === 1
        ? `Close the line into a polygon of the active unit (${activeUnitName(s)})`
        : `Chain the lines by their nearest ends and close them into one polygon of the active unit (${activeUnitName(s)})`;
    aPoligono.addEventListener('click', () => {
      try {
        const { desde, unidad } = applyLinesToPolygon();
        showBanner(
          `${desde} line${desde === 1 ? '' : 's'} converted into a polygon${unidad ? ` — ${unidad}` : ''}.`,
          'info',
        );
        closePropsMenu();
      } catch (err) {
        showBanner(err.message, 'warn');
      }
    });
    geoRow.appendChild(aPoligono);
  }

  geo.appendChild(geoRow);

  /*
   * Continuar la línea. Existía desde siempre —seleccionar una línea y pulsar
   * **Línea** la sigue en vez de empezar otra— pero no había forma de
   * enterarse: ningún botón lo nombraba y nada en pantalla lo anunciaba. Aquí
   * queda a un clic del sitio donde uno ya está mirando el elemento.
   */
  if (lines.length === 1 && polys.length === 0 && medidas.length === 0) {
    const seguir = document.createElement('button');
    seguir.className = 'chip';
    seguir.textContent = 'Continue line';
    seguir.title =
      'Carry on drawing from one of its ends — the next click picks which end, and the attributes are inherited';
    seguir.addEventListener('click', () => {
      closePropsMenu();
      store.setTool('line');
    });
    geoRow.appendChild(seguir);
  }

  // Perfil de una línea que ya está en el mapa. Es el caso más útil de todos:
  // el corte que interesa suele ser justo un contacto o una falla que ya se
  // cartografió, y volver a trazarlo a mano introduciría un error propio.
  if (lines.length === 1) {
    const perfil = section(body, 'Terrain');
    const btn = document.createElement('button');
    btn.className = 'pill wide';
    btn.textContent = 'Topographic profile';
    btn.title = 'Read the elevation along this line off the DEM';
    btn.addEventListener('click', () => {
      closePropsMenu();
      if (mapBridge) mapBridge.fitToCoords(lines[0].geometry.coordinates);
      store.requestProfileFor(lines[0].properties.id);
    });
    perfil.appendChild(btn);
  }

  // Borrar
  const del = document.createElement('button');
  del.className = 'pill danger wide';
  del.textContent = `Delete ${sel.length} feature${sel.length === 1 ? '' : 's'}`;
  del.addEventListener('click', () => {
    store.deleteSelected();
    closePropsMenu();
  });
  body.appendChild(del);

  positionPropsMenu(menu, screen);
}

/** Coloca el menú cerca del toque, sin salirse de la pantalla. */
function positionPropsMenu(menu, screen) {
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const x = Math.min(Math.max(12, screen[0] - rect.width / 2), window.innerWidth - rect.width - 12);
  const y = Math.min(screen[1] + 18, window.innerHeight - rect.height - 12);
  menu.style.left = `${x}px`;
  menu.style.top = `${Math.max(12, y)}px`;
}

/**
 * Cablea el botón de GPS. Va aparte del resto de la barra porque su manejador
 * lo provee mapView, que se construye después de `initUI()`.
 */
export function wireLocate(handler) {
  $('t-locate').addEventListener('click', handler);
}

export function closePropsMenu() {
  $('props-menu').classList.add('hidden');
}

/* ---------- paneles ---------- */

/** Cajones laterales: solo uno abierto a la vez. */
const DRAWERS = ['layer-panel', 'units-panel', 'symbology-panel', 'strabo-panel'];
/** Paneles flotantes, que se ocultan con `hidden` en vez de con `open`. */
const POPOVERS = ['settings', 'project-menu', 'topo-menu', 'scale-menu', 'attrs', 'shortcuts'];

/**
 * Elementos que NO cuentan como "fuera" al cerrar por clic.
 *
 * Sin la barra superior, pulsar **Capas** con el panel de Capas abierto se
 * comería el clic: primero lo cerraría este manejador y después el botón lo
 * volvería a abrir, o al revés según el orden. La hoja del perfil va aquí por
 * otro motivo —no se cierra al tocar el mapa a propósito— y la barra de
 * herramientas porque cambiar de herramienta no debería cerrar el panel que se
 * está consultando.
 */
const CLICK_OUTSIDE_EXEMPT = ['toolbar', 'palette', 'profile-sheet', 'btn-scale'];

/**
 * Cierra los paneles al hacer clic fuera de ellos.
 *
 * En tablet esto ya lo resolvía `onMapTap`, porque cualquier toque cae sobre el
 * mapa. Desde un PC no: se pulsa un botón de la barra superior, o el borde de
 * la ventana, y el panel se quedaba abierto tapando el mapa.
 *
 * Va en captura y sobre `pointerdown` —no sobre `click`— para que cierre antes
 * de que el elemento de debajo reaccione, que es lo que uno espera de un
 * popover.
 */
function wireClickOutside() {
  const dentroDeAlgoAbierto = (target) => {
    for (const id of [...DRAWERS, ...POPOVERS, 'props-menu', ...CLICK_OUTSIDE_EXEMPT]) {
      const el = $(id);
      if (el && el.contains(target)) return true;
    }
    // El menú superior abre y cierra sus propios paneles.
    const top = document.querySelector('.top-right');
    return !!(top && top.contains(target));
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!anyOverlayOpen() || dentroDeAlgoAbierto(e.target)) return;
      closeOverlays();
    },
    { capture: true },
  );

  /*
   * Clic secundario: cierra siempre, esté donde esté. Sobre el mapa el menú
   * contextual ya lo suprime DrawController —el clic derecho cierra el
   * elemento en curso, como en QGIS—, así que aquí solo se añade el cierre de
   * paneles, sin tocar el menú nativo fuera del mapa.
   */
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (!anyOverlayOpen()) return;
      closeOverlays();
      const mapa = $('map-host');
      if (mapa && mapa.contains(e.target)) e.preventDefault();
    },
    { capture: true },
  );
}

/** ¿Hay algo flotando sobre el mapa ahora mismo? */
function anyOverlayOpen() {
  if (DRAWERS.some((id) => $(id).classList.contains('open'))) return true;
  if (POPOVERS.some((id) => !$(id).classList.contains('hidden'))) return true;
  return !$('props-menu').classList.contains('hidden');
}

function openPanel(id) {
  closeOverlays();
  if (DRAWERS.includes(id)) $(id).classList.add('open');
  else $(id).classList.remove('hidden');
}

function togglePanel(id) {
  const open = DRAWERS.includes(id)
    ? $(id).classList.contains('open')
    : !$(id).classList.contains('hidden');
  closeOverlays();
  if (!open) openPanel(id);
}

/**
 * Cierra todo lo que flota sobre el mapa. Se llama también al tocar el mapa:
 * un toque afuera cierra lo que esté abierto, que es lo que uno espera de
 * cualquier panel en una tablet.
 */
export function closeOverlays() {
  for (const id of DRAWERS) $(id).classList.remove('open');
  for (const id of POPOVERS) $(id).classList.add('hidden');
  closePropsMenu();
  // El resalte solo tiene sentido mientras su recuadro está abierto; dejarlo
  // encendido marcaría un elemento del que ya no se está leyendo nada.
  if (mapBridge) mapBridge.clearForeignHighlight();
}

function mapRings(geometry, fn) {
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: fn(geometry.coordinates, false) };
  }
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((r) => {
        const open = r.slice(0, -1);
        const out = fn(open, true);
        return [...out, out[0]];
      }),
    };
  }
  return null;
}

const smoothGeometry = (g) => mapRings(g, (coords) => (coords.length < 3 ? coords : chaikin(coords, 1)));

/**
 * La tolerancia se deriva de la extensión de la propia geometría (0,05 % de la
 * diagonal de su bbox), para que simplificar se comporte igual en un dique de
 * 200 m que en un contacto de 20 km.
 */
function simplifyGeometry(g) {
  return mapRings(g, (coords) => {
    if (coords.length < 4) return coords;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of coords) {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    }
    const tol = Math.hypot(maxX - minX, maxY - minY) * 0.0005;
    const out = simplifyDP(coords, tol);
    return out.length >= 3 ? out : coords;
  });
}

/* ---------- atributos de una capa importada ---------- */

/** Pulsación sostenida sobre una capa importada: sus campos, en solo lectura. */
export function openImportedAttrs(hit, screen) {
  const { layer: capa, feature, exact } = hit;
  openAttrs({
    title: importedTitle(capa.label, feature),
    entries: importedEntries(feature),
    screen,
    empty: 'This feature carries no attributes in the GeoPackage.',
    // Se dice cuando el resalte no es fiable, en vez de dejar creer que lo es.
    note: exact ? null : 'Imported layer · the highlight may be clipped',
  });
}

/* ---------- escala de trabajo ---------- */

/**
 * Última escala publicada por el mapa. Se guarda porque el desplegable la
 * necesita para proponer una escala nueva y para marcar cuál está vigente, y
 * el mapa solo la manda cuando cambia.
 */
let escalaActual = NaN;

/**
 * Lectura de la escala. La manda el mapa cada vez que se mueve, así que este
 * camino tiene que ser barato: se escriben dos nodos de texto y una clase.
 */
export function renderScale(denominator) {
  escalaActual = denominator;
  const fijada = store.getState().scaleLock;
  $('scale-value').textContent = formatScale(denominator);
  $('scale-lock-mark').hidden = !fijada;
  $('btn-scale').classList.toggle('locked', !!fijada);
  if (!$('scale-menu').classList.contains('hidden')) renderScaleMenu();
}

/** Contenido del desplegable: la lista, lo que está vigente y los controles. */
function renderScaleMenu() {
  const s = store.getState();
  const fijada = s.scaleLock;

  $('scale-current').textContent = fijada
    ? `Locked at ${formatScale(fijada)}. The map pans; the zoom is held.`
    : `Now showing ${formatScale(escalaActual)}. Pick one to snap the map to it.`;

  const grid = $('scale-presets');
  grid.textContent = '';
  for (const d of s.scalePresets) {
    const b = document.createElement('button');
    b.type = 'button';
    // Vigente es la fijada; sin fijar, la que esté a menos de un 2 % de lo que
    // se ve — marcar una exacta con el zoom libre no significaría nada.
    const vigente = fijada
      ? d === fijada
      : Number.isFinite(escalaActual) && Math.abs(escalaActual - d) / d < 0.02;
    b.className = vigente ? 'active' : '';
    b.append(document.createTextNode(formatScale(d)));
    b.addEventListener('click', () => pickScale(d));

    const quitar = document.createElement('span');
    quitar.className = 'drop';
    quitar.textContent = '✕';
    quitar.title = 'Remove from the list';
    quitar.addEventListener('click', (e) => {
      // Sin esto, quitar una escala además saltaría a ella.
      e.stopPropagation();
      store.removeScalePreset(d);
      renderScaleMenu();
    });
    b.appendChild(quitar);
    grid.appendChild(b);
  }

  $('scale-lock').checked = !!fijada;
  const px = $('scale-pixel-mm');
  if (document.activeElement !== px) px.value = String(s.scalePixelMm);
}

/**
 * Toque en una escala de la lista.
 *
 * Con el candado puesto, elegir otra cambia a esa escala y la deja fijada; sin
 * él, solo lleva el mapa ahí y el zoom sigue libre. Es la diferencia entre
 * "ponme a 1:25.000" y "trabajo a 1:25.000".
 */
function pickScale(denominator) {
  if (store.getState().scaleLock) store.setScaleLock(denominator);
  else if (mapBridge) mapBridge.goToScale(denominator);
  renderScaleMenu();
}

function wireScale() {
  $('btn-scale').addEventListener('click', () => {
    togglePanel('scale-menu');
    if (!$('scale-menu').classList.contains('hidden')) renderScaleMenu();
  });
  $('btn-close-scale').addEventListener('click', () => closeOverlays());

  $('scale-lock').addEventListener('change', (e) => {
    if (!e.target.checked) {
      store.setScaleLock(null);
    } else {
      /*
       * Al fijar sin haber elegido antes se toma la escala que se está viendo,
       * redondeada a una de mapeo. Fijar un 1:37.412 sería fijar el accidente
       * de dónde quedó el zoom, no una escala de trabajo.
       */
      const s = store.getState();
      const propuesta = Number.isFinite(escalaActual) ? niceScale(escalaActual) : s.scalePresets[0];
      store.setScaleLock(s.scalePresets.includes(propuesta) ? propuesta : store.addScalePreset(propuesta));
    }
    renderScaleMenu();
  });

  const añadir = () => {
    const campo = $('scale-custom');
    const d = parseScale(campo.value);
    if (d === null) {
      showBanner('That is not a scale. Write it as 1:12 500, 12500 or 25k.');
      return;
    }
    store.addScalePreset(d);
    campo.value = '';
    pickScale(d);
  };
  $('scale-add').addEventListener('click', añadir);
  $('scale-custom').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') añadir();
  });

  $('scale-pixel-mm').addEventListener('change', (e) => store.setScalePixelMm(e.target.value));
  $('scale-pixel-reset').addEventListener('click', () => {
    store.setScalePixelMm(STANDARD_PIXEL_MM);
    renderScaleMenu();
  });
  $('scale-reset').addEventListener('click', () => {
    store.resetScalePresets();
    renderScaleMenu();
  });
}

/* ---------- diagnóstico del lápiz ---------- */

const POINTER_LABEL = {
  pen: 'Apple Pencil / stylus',
  touch: 'Finger',
  mouse: 'Mouse / trackpad',
};

export function renderPointerInfo(info) {
  const box = $('pen-readout');
  const detail = $('pen-detail');
  box.classList.toggle('live', !!info);
  if (!info) {
    $('pen-kind').textContent = 'No contact';
    detail.hidden = true;
    return;
  }
  detail.hidden = false;
  $('pen-kind').textContent = POINTER_LABEL[info.pointerType] || info.pointerType;
  $('pen-pressure').textContent = info.pressure.toFixed(2);
  $('pen-pressure-bar').style.width = `${Math.round(info.pressure * 100)}%`;
  $('pen-tilt').textContent = `${info.tiltX.toFixed(0)}° / ${info.tiltY.toFixed(0)}°`;
  $('pen-alt').textContent =
    info.altitudeAngle === null ? 'n/a' : `${((info.altitudeAngle * 180) / Math.PI).toFixed(0)}°`;
  $('pen-coalesced').textContent = String(info.coalesced);
}

export function showBanner(text, variant = 'warn') {
  const el = $('banner');
  $('banner-text').textContent = text;
  el.classList.remove('hidden');
  el.classList.toggle('info', variant === 'info');
}

function setBusy(text) {
  const el = $('busy');
  if (!text) {
    el.classList.add('hidden');
    return;
  }
  $('busy-text').textContent = text;
  el.classList.remove('hidden');
}

/* ---------- GeoPackage ---------- */

async function doExportGeoPackage() {
  const features = store.getState().features;
  if (!features.length) return;
  setBusy('Building GeoPackage…');
  try {
    const st = store.getState();
    const bytes = await exportGeoPackage(features, st.units, st.ornaments);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(
      new Blob([bytes], { type: 'application/geopackage+sqlite3' }),
      `fielddraw-${stamp}.gpkg`,
    );
    showBanner(
      `GeoPackage exported with ${features.length} feature(s) and their QGIS symbology.`,
      'info',
    );
  } catch (err) {
    showBanner(`Could not export the GeoPackage: ${err.message}`);
  } finally {
    setBusy(null);
  }
}

const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

async function doOpenTiles(file) {
  const isMbtiles = file.name.toLowerCase().endsWith('.mbtiles');
  if (isMbtiles && file.size > MBTILES_WARN_BYTES) {
    const proceed = confirm(
      `${file.name} is ${fmtMB(file.size)}. An MBTiles is loaded entirely into memory, ` +
        `so one this size may exhaust the iPad's RAM. Converting it to PMTiles ` +
        `would make it work through range reads.\n\nOpen it anyway?`,
    );
    if (!proceed) return;
  }
  setBusy(`Opening ${file.name}…`);
  try {
    const id = `tiles-${Date.now().toString(36)}`;
    const descriptor = await openTileFile(file, id);
    store.addTileSet(descriptor);
    const kind = descriptor.tileKind === 'vector' ? 'vector' : 'raster';
    const zooms = `z${descriptor.minzoom}–${descriptor.maxzoom}`;
    const extra =
      descriptor.tileKind === 'vector' && descriptor.vectorLayers.length
        ? ` · ${descriptor.vectorLayers.length} layer(s): generic style, the format carries no symbology`
        : '';
    showBanner(`${descriptor.label}: ${kind} ${descriptor.format}, ${zooms}${extra}.`, 'info');
  } catch (err) {
    showBanner(`Could not open the map: ${err.message}`);
  } finally {
    setBusy(null);
  }
}

/* ---------- cortar y unir ---------- */

let editBusy = false;

/**
 * Aplica la línea de reshape. Síncrono: la geometría es propia y no hay que
 * cargar JSTS.
 */
function runReshape(linea) {
  try {
    const { redibujados, intactos } = applyReshape(linea);
    if (redibujados === 0) {
      showBanner(
        'The line did not cross the outline twice, so nothing was reshaped. Draw it so it enters and leaves the feature.',
        'warn',
      );
    } else {
      showBanner(
        `${redibujados} feature(s) reshaped${intactos ? `; ${intactos} left alone (the line did not cross them)` : ''}.`,
        'info',
      );
    }
  } catch (err) {
    showBanner(err.message, 'warn');
  } finally {
    store.clearPendingReshape();
  }
}

/**
 * Resta el área dibujada. Asíncrono como el corte: usa JSTS, que se descarga
 * la primera vez que hace falta.
 */
async function runHole(hole) {
  if (editBusy) {
    store.clearPendingHole();
    showBanner('Another geometry operation is still running.');
    return;
  }
  editBusy = true;
  setBusy('Removing the area…');
  try {
    const { abiertos, piezas, partidos } = await applyHole(hole);
    if (abiertos === 0) {
      showBanner('That area did not overlap the polygon, so nothing was removed.');
    } else if (partidos) {
      // Que se parta en dos no es un error: es lo que pasa cuando el área
      // atraviesa el polígono de lado a lado. Se dice, porque el resultado no
      // es el hueco que se esperaba.
      showBanner(
        `${abiertos} polygon(s) cut through into ${piezas} pieces: the area crossed them from side to side instead of leaving a hole.`,
        'info',
      );
    } else {
      showBanner(`Hole removed from ${abiertos} polygon(s).`, 'info');
    }
  } catch (err) {
    showBanner(err.message);
  } finally {
    store.clearPendingHole();
    setBusy(null);
    editBusy = false;
  }
}

async function runCut(cut) {
  if (editBusy) return;
  // El corte exige elegir antes qué se corta: aplicarlo a todo el mapa por
  // omisión es demasiado destructivo para un gesto tan fácil de disparar.
  if (store.getState().selection.length === 0) {
    showBanner(
      'Select what you want to split first: Select tool, tap it, then come back to Split.',
    );
    store.clearPendingCut();
    return;
  }
  editBusy = true;
  setBusy('Splitting…');
  try {
    const { cortados, piezas } = await applyCut(cut);
    const conQue = cut.type === 'feature' ? 'The cutting feature' : 'The split line';
    if (cortados === 0) showBanner(`${conQue} did not cross any other feature.`);
    else showBanner(`${cortados} feature(s) split into ${piezas} pieces.`, 'info');
  } catch (err) {
    showBanner(`Could not split: ${err.message}`);
  } finally {
    store.clearPendingCut();
    setBusy(null);
    editBusy = false;
  }
}

/**
 * Confirmación topológica. Es síncrona a propósito: sobre un dibujo de terreno
 * son milisegundos, y meterla en un worker obligaría a serializar todo el
 * conjunto de features de ida y de vuelta.
 */
/** Abre el desplegable del botón Topología, con el alcance ya calculado. */
function openTopoMenu() {
  const s = store.getState();
  const n = s.selection.length || s.features.length;
  $('topo-scope').textContent = s.selection.length
    ? `Will run on the ${s.selection.length} selected feature(s).`
    : `Nothing selected: will run on all ${n} feature(s).`;
  syncTopoTolerance(s.topoTolerance);
  openPanel('topo-menu');
}

/** Mantiene alineados los dos controles de tolerancia y el store. */
function syncTopoTolerance(value, from) {
  const v = Math.max(0.1, Number(value) || 0.1);
  for (const id of ['opt-topo-tol', 'topo-menu-range', 'opt-topo-tol-num', 'topo-menu-num']) {
    const el = $(id);
    if (el && id !== from) el.value = String(id.endsWith('range') || id === 'opt-topo-tol' ? Math.min(v, 200) : v);
  }
  store.setTopoTolerance(v);
}

function runTopology() {
  try {
    const r = applyTopology();
    const alcance = store.getState().selection.length
      ? `${r.revisados} selected feature(s)`
      : `${r.revisados} feature(s)`;
    if (!r.cambio) {
      showBanner(
        `Topology already consistent across ${alcance}: ${r.compartidos} shared vertex/vertices.`,
        'info',
      );
      return;
    }
    const extra = r.degenerados
      ? ` ${r.degenerados} geometry/geometries were left alone so they would not degenerate.`
      : '';
    showBanner(
      `Topology applied to ${alcance}: ${r.fusionados} vertex/vertices fused, ` +
        `${r.insertados} inserted, ${r.compartidos} shared node(s).${extra}`,
      'info',
    );
  } catch (err) {
    showBanner(err.message);
  }
}

/* ---------- atajos de teclado ---------- */

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

/**
 * Cambia de herramienta explicando el rechazo.
 *
 * Con el relieve 3D puesto los botones de la barra salen deshabilitados y se
 * ve por qué, pero una tecla no se puede deshabilitar: sin este aviso, pulsar
 * `L` con el 3D encendido no haría absolutamente nada y parecería un fallo.
 */
function pickTool(tool) {
  if (store.setTool(tool) === false) {
    showBanner(
      'Drawing is disabled while 3D terrain is on: on tilted ground the point you click is not the point on the map. Press 3 to go back to plan view.',
    );
  }
}

/** Rota la certeza activa. Los tipos acotados (pliegues) se quedan en observado. */
function cycleCertainty() {
  const s = store.getState();
  if (isObservedOnly(s.lineType)) {
    showBanner(`${LINE_TYPE_BY_ID.get(s.lineType).label} is only mapped as observed.`);
    return;
  }
  const i = CERTAINTIES.findIndex((c) => c.id === s.certainty);
  const next = CERTAINTIES[(i + 1) % CERTAINTIES.length];
  store.setCertainty(next.id);
  showBanner(`Certainty: ${next.label.toLowerCase()}.`, 'info');
}

/**
 * Escape en cascada, de lo más superficial a lo más profundo. Pulsarlo varias
 * veces desanda el estado sin sorpresas, en vez de tirarlo todo de golpe: un
 * solo Escape no debería descartar un trazo de veinte vértices solo porque
 * había un panel abierto.
 */
function handleEscape() {
  if (anyOverlayOpen()) {
    closeOverlays();
    return;
  }
  const s = store.getState();
  if (s.draft) {
    store.cancelDraft();
    return;
  }
  if (s.selection.length) {
    store.clearSelection();
    return;
  }
  if (s.tool !== 'navigate') store.setTool('navigate');
}

/** Qué hace cada acción de la tabla de atajos. */
function shortcutActions() {
  return {
    'tool-navigate': () => pickTool('navigate'),
    'tool-select': () => pickTool('select'),
    'tool-line': () => pickTool('line'),
    'tool-polygon': () => pickTool('polygon'),
    'tool-hole': () => pickTool('hole'),
    'tool-vertices': () => pickTool('vertices'),
    'tool-cut': () => pickTool('cut'),
    'tool-reshape': () => pickTool('reshape'),
    'tool-measure': () => pickTool('measure'),
    'tool-profile': () => pickTool('profile'),

    'toggle-snap': () => store.setSnapEnabled(!store.getState().snapEnabled),
    'toggle-trace': () => store.setTraceEnabled(!store.getState().traceEnabled),
    'toggle-terrain': () => $('t-3d').click(),
    'cycle-certainty': cycleCertainty,
    locate: () => $('t-locate').click(),

    finish: () => store.finishDraft(),
    'undo-vertex': () => store.undoVertex(),
    escape: handleEscape,
    'delete-selection': () => {
      if (store.getState().selection.length) store.deleteSelected();
      else showBanner('Nothing selected. Pick features with V first.');
    },
    undo: () => {
      if (!store.undo()) showBanner('Nothing left to undo.');
    },
    redo: () => {
      if (!store.redo()) showBanner('Nothing left to redo.');
    },
    'select-all': () => {
      const ids = store.getState().features.map((f) => f.properties.id);
      if (!ids.length) return;
      store.setTool('select');
      store.setSelection(ids);
    },
    merge: () => {
      if ($('t-merge').disabled) {
        showBanner('Merge needs two or more features of the same geometry type selected.');
        return;
      }
      runMerge();
    },
    topology: () => {
      if ($('t-topo').disabled) return;
      $('t-topo').click();
    },

    'panel-layers': () => togglePanel('layer-panel'),
    'panel-units': () => togglePanel('units-panel'),
    'panel-symbology': () => togglePanel('symbology-panel'),
    'panel-strabo': () => togglePanel('strabo-panel'),
    'panel-scale': () => {
      togglePanel('scale-menu');
      if (!$('scale-menu').classList.contains('hidden')) renderScaleMenu();
    },
    'panel-settings': () => togglePanel('settings'),
    'project-save': doSaveProject,
    'project-open': () => $('file-project').click(),
    'export-gpkg': () => {
      if (!$('btn-export').disabled) doExportGeoPackage();
    },
    help: () => togglePanel('shortcuts'),
  };
}

/** Pinta la ayuda a partir de la misma tabla que alimenta el despachador. */
function renderShortcutsHelp() {
  const body = $('shortcuts-body');
  body.replaceChildren();
  for (const grupo of SHORTCUT_GROUPS) {
    const bloque = document.createElement('div');
    bloque.className = 'shortcut-group';
    const h = document.createElement('span');
    h.className = 'palette-label';
    h.textContent = grupo;
    bloque.appendChild(h);
    for (const s of SHORTCUTS.filter((x) => x.group === grupo)) {
      const fila = document.createElement('div');
      fila.className = 'shortcut-row';
      const teclas = document.createElement('span');
      teclas.className = 'shortcut-keys';
      for (const k of s.keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = comboLabel(k, IS_MAC);
        teclas.appendChild(kbd);
      }
      const texto = document.createElement('span');
      texto.className = 'shortcut-label';
      texto.textContent = s.label;
      fila.append(teclas, texto);
      bloque.appendChild(fila);
    }
    body.appendChild(bloque);
  }
}

/** Añade el atajo a la ayuda del botón, para que se descubra usándolo. */
function annotateToolbarShortcuts() {
  const porBoton = {
    't-nav': 'tool-navigate',
    't-select': 'tool-select',
    't-line': 'tool-line',
    't-poly': 'tool-polygon',
    't-vertices': 'tool-vertices',
    't-cut': 'tool-cut',
    't-hole': 'tool-hole',
    't-reshape': 'tool-reshape',
    't-measure': 'tool-measure',
    't-profile': 'tool-profile',
    't-snap': 'toggle-snap',
    't-trace': 'toggle-trace',
    't-3d': 'toggle-terrain',
    't-locate': 'locate',
    't-merge': 'merge',
    't-topo': 'topology',
    'btn-layers': 'panel-layers',
    'btn-units': 'panel-units',
    'btn-symbology': 'panel-symbology',
    'btn-strabo': 'panel-strabo',
    'btn-scale': 'panel-scale',
    'btn-settings': 'panel-settings',
    'btn-project': 'project-save',
    'btn-export': 'export-gpkg',
  };
  for (const [id, accion] of Object.entries(porBoton)) {
    const el = $(id);
    if (!el) continue;
    const teclas = labelsFor(accion, IS_MAC);
    if (!teclas.length) continue;
    const base = defaultTitle(id) || el.textContent.trim();
    // Se guarda como base la ayuda YA anotada: `defaultTitle` la cachea, y el
    // bloqueo por relieve la restaura desde ahí.
    const anotada = `${base} (${teclas[0]})`;
    el.title = anotada;
    defaultTitles.set(id, anotada);
  }
}

function wireShortcuts() {
  const acciones = shortcutActions();
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const id = shortcutFor(e);
    if (!id) return;

    /*
     * Escribiendo, el teclado es del campo — con una excepción: Escape.
     *
     * Sin ella, con el cursor en la clave de OpenTopography no había forma de
     * cerrar Ajustes con el teclado. Primero suelta el foco y solo entonces
     * hace su cascada, así que el primer Escape sale del campo y el segundo
     * cierra el panel, que es lo que uno espera de un formulario.
     */
    if (isTyping(e.target)) {
      if (id !== 'escape') return;
      e.target.blur();
      return;
    }

    const fn = acciones[id];
    if (!fn) return;
    if (consumesDefault(id)) e.preventDefault();
    fn();
  });
}

/* ---------- perfil topográfico ---------- */

/**
 * La vista del mapa, para poder encuadrar la traza de un perfil pedido desde
 * el menú de propiedades. Llega por `wireMapView` porque `createMapView` se
 * construye después de `initUI()`.
 */
let mapBridge = null;

export function wireMapView(view) {
  mapBridge = view;
}

/** Handle del gráfico dibujado, para mover el cursor sin repintar todo. */
let chart = null;
let profileBusy = false;

/**
 * Muestreador del terrarium, reutilizado entre perfiles y medidas.
 *
 * Guarda las teselas ya decodificadas, así que dos perfiles sobre la misma
 * ladera no vuelven a descargar ni a decodificar nada. Uno nuevo por
 * operación tiraría esa caché justo cuando más sirve: en terreno se perfila
 * varias veces la misma zona.
 */
let terrariumSampler = null;

function samplerFor(state) {
  if (state.profileSource === 'opentopo') {
    // Este sí se crea nuevo cada vez: cachea UN recorte, y el recorte depende
    // de la traza que se acaba de dibujar.
    return new OpenTopoSampler({
      key: (state.opentopoKey || '').trim(),
      demtype: state.opentopoDem,
    });
  }
  if (!terrariumSampler) terrariumSampler = new DemSampler();
  return terrariumSampler;
}

/**
 * Calcula el perfil de una traza. Es lo único asíncrono de todo el camino: el
 * store publica la traza y aquí se muestrea el DEM, igual que con el corte.
 */
async function runProfile(pending) {
  // Descartar en silencio dejaba a la herramienta pareciendo rota: se cerraba
  // la traza, no pasaba nada, y no había forma de saber que había otra en
  // curso. Ahora se dice; y como el muestreo del DEM ya no puede quedarse
  // pendiente para siempre, la bandera siempre acaba bajando.
  if (profileBusy) {
    store.clearPendingProfile();
    showBanner('Still reading the elevations of the previous profile.');
    return;
  }
  const coords = pending && pending.coords;
  if (!coords || coords.length < 2) {
    store.clearPendingProfile();
    return;
  }

  profileBusy = true;
  const st = store.getState();
  setBusy(st.profileSource === 'opentopo' ? 'Downloading the DEM…' : 'Reading elevations…');
  try {
    const result = await samplerFor(st).profile(coords, st.profileSamples);
    if (result.stats.samples === 0) {
      showBanner(
        st.profileSource === 'opentopo'
          ? 'The DEM has no data over that line.'
          : 'No elevation tiles for that line. Off the network only ground you have already looked at is available.',
      );
      store.clearProfile();
      return;
    }
    // Una traza de longitud cero —dos toques en el mismo sitio— no tiene
    // perfil: el eje horizontal no existe y el gráfico saldría degenerado.
    if (!(result.stats.length > 0)) {
      showBanner('That line has no length: draw it across the ground you want to section.');
      store.clearPendingProfile();
      return;
    }
    if (result.stats.missing > 0) {
      showBanner(
        `${result.stats.missing} of ${result.samples.length} samples had no elevation; the profile is drawn with gaps.`,
      );
    }
    store.setProfile({ ...result, coords });
  } catch (err) {
    showBanner(err.message);
    store.clearPendingProfile();
  } finally {
    setBusy(null);
    profileBusy = false;
  }
}

/** Fila del resumen: una etiqueta y su valor. */
function statChip(parent, label, value, live = false) {
  const s = document.createElement('span');
  s.className = `pf-stat${live ? ' live' : ''}`;
  s.append(`${label} `);
  const b = document.createElement('b');
  b.textContent = value;
  s.appendChild(b);
  parent.appendChild(s);
  return s;
}

function renderProfileStats(result, index) {
  const box = $('profile-stats');
  box.replaceChildren();
  const { stats } = result;

  const m = Number.isInteger(index) ? result.samples[index] : null;
  if (m && Number.isFinite(m.elevation)) {
    statChip(box, 'At', formatDistance(m.distance), true);
    statChip(box, '·', formatElevation(m.elevation), true);
  }
  statChip(box, 'Length', formatDistance(stats.length));
  statChip(box, 'Min', formatElevation(stats.min));
  statChip(box, 'Max', formatElevation(stats.max));
  statChip(box, 'Relief', formatElevation(stats.max - stats.min));
  statChip(box, 'Ascent', formatElevation(stats.gain));
  statChip(box, 'Descent', formatElevation(stats.loss));
}

/**
 * Nota al pie del gráfico. Dice de dónde salió la cota y con qué resolución,
 * porque un perfil sin eso invita a leer detalle que el dato no tiene: sobre
 * un DEM de 30 m, un escalón de 40 m de ancho no existe.
 */
function profileNote(result) {
  const partes = [
    `${result.label} · nominal resolution ≈ ${Math.round(result.nominal)} m`,
    `${result.stats.samples} samples`,
  ];
  if (Number.isFinite(result.step)) {
    partes.push(`sampling step ≈ ${Math.round(result.stats.length / (result.samples.length - 1))} m`);
  }
  if (!result.offline) partes.push('needs a connection');
  return `${partes.join(' · ')}. Detail finer than the DEM's resolution is interpolation, not data.`;
}

/** Dibuja el gráfico al tamaño real que tiene el contenedor en pantalla. */
function renderProfilePanel() {
  const result = store.getState().profile;
  const sheet = $('profile-sheet');
  if (!result) {
    sheet.classList.add('hidden');
    chart = null;
    return;
  }
  sheet.classList.remove('hidden');
  $('profile-source-label').textContent = result.label;

  const wrap = $('profile-chart').parentElement;
  const width = Math.max(240, Math.round(wrap.clientWidth));
  const height = Math.max(110, Math.round(wrap.clientHeight));
  chart = renderProfileChart($('profile-chart'), result, { width, height });

  renderProfileStats(result, null);
  $('profile-note').textContent = profileNote(result);
}

/**
 * Puntero sobre el gráfico: mueve el cursor y, sobre todo, marca en el MAPA la
 * muestra señalada. Es lo que convierte la curva en algo que se puede leer
 * geológicamente — ver qué quiebre del perfil cae sobre qué contacto.
 */
function wireProfilePointer() {
  const svg = $('profile-chart');

  const señalar = (e) => {
    const result = store.getState().profile;
    if (!result || !chart) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    // El viewBox se dibuja al tamaño real del elemento y con
    // `preserveAspectRatio="none"`, así que la conversión es una regla de tres.
    const px = ((e.clientX - rect.left) / rect.width) * chart.width;
    const d = chart.scales.distanceAt(px);
    const i = indexAtDistance(result.samples, Math.min(Math.max(0, d), chart.scales.total));
    if (i < 0) return;
    chart.setCursor(i);
    renderProfileStats(result, i);
    store.setProfileCursor(i);
  };

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    señalar(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (e.buttons === 0 && e.pointerType !== 'mouse') return;
    señalar(e);
  });
  svg.addEventListener('pointerleave', () => {
    const result = store.getState().profile;
    if (!result || !chart) return;
    chart.setCursor(-1);
    renderProfileStats(result, null);
    store.setProfileCursor(null);
  });

  // Al girar la tablet el ancho cambia y el SVG quedaría estirado.
  window.addEventListener('resize', () => {
    if (store.getState().profile) renderProfilePanel();
  });
}

function downloadProfileCSV() {
  const result = store.getState().profile;
  if (!result) return;
  downloadText(profileCSV(result), `profile-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
}

/* ---------- rumbo y manteo ---------- */

/** Refleja en los controles del panel de símbolos lo que dice el store. */
function syncStructureControls() {
  const st = store.getState().structureStyle;
  const size = $('structure-size');
  if (document.activeElement !== size) size.value = String(st.size);
  $('structure-size-num').textContent = `${st.size.toFixed(1)}×`;
  const mz = $('structure-minzoom');
  if (document.activeElement !== mz) mz.value = String(st.minzoom);
  $('structure-minzoom-num').textContent = String(st.minzoom);
  $('structure-labels').checked = st.showLabels;
}

function wireStructureControls() {
  $('structure-size').addEventListener('input', (e) =>
    store.setStructureStyle({ size: Number(e.target.value) }),
  );
  $('structure-minzoom').addEventListener('input', (e) =>
    store.setStructureStyle({ minzoom: Number(e.target.value) }),
  );
  $('structure-labels').addEventListener('change', (e) =>
    store.setStructureStyle({ showLabels: e.target.checked }),
  );
}

let planeBusy = false;

/**
 * Resuelve una medida estructural a partir de los puntos marcados.
 *
 * Los tres pasos son: leer la cota de cada punto en el DEM, ajustar el plano y
 * —lo que de verdad decide si el número sirve— comprobar la geometría de la
 * base. Un manteo sobre una base más corta que dos celdas del modelo es ruido,
 * y aquí se dice en vez de dibujarlo como si fuera un dato.
 */
async function runPlane(pending) {
  if (planeBusy) {
    store.clearPendingPlane();
    showBanner('Still reading the elevations of the previous measurement.');
    return;
  }
  const coords = pending && pending.coords;
  if (!coords || coords.length < 3) {
    store.clearPendingPlane();
    showBanner('Three points are needed to define a plane.');
    return;
  }

  planeBusy = true;
  const st = store.getState();
  setBusy('Reading elevations…');
  try {
    const sampler = samplerFor(st);
    // Un muestreador de OpenTopography necesita descargar su recorte antes de
    // poder contestar; el de terrarium resuelve tesela a tesela.
    if (sampler.loadGrid) await sampler.loadGrid(coords);
    const cotas = await Promise.all(coords.map((c) => sampler.elevationAt(c[0], c[1])));
    const puntos = coords.map((c, i) => ({ lngLat: c, elevation: cotas[i] }));

    // La resolución del modelo es lo que decide si una base es suficiente, así
    // que se pasa la real y no un valor fijo: con COP90 hace falta el triple
    // de base que con COP30 para el mismo margen de error.
    const dem = OPENTOPO_DEM_BY_ID.get(st.opentopoDem);
    const nominal = st.profileSource === 'opentopo' && dem ? dem.nominal : TERRARIUM_NOMINAL_M;
    const r = planeFromPoints(puntos, { resolution: nominal });
    if (!r.ok) {
      showBanner(r.reason);
      store.clearPendingPlane();
      return;
    }

    store.createMeasurement({
      lngLat: r.lngLat,
      strike: r.strike,
      dip: r.dip,
      dipAzimuth: r.dipAzimuth,
      method: pending.method,
      quality: {
        strikeSd: round1(r.strikeSd),
        dipSd: round1(r.dipSd),
        rms: round1(r.rms),
        n: r.n,
        baseline: Math.round(r.baseline),
        minorSpread: Math.round(r.minorSpread),
        demSource: st.profileSource,
      },
    });

    const resumen = `${formatStrikeDip(r.strike, r.dip)} (dip ${quadrant(r.dipAzimuth)}) ±${round1(r.dipSd)}° over a ${Math.round(r.baseline)} m base.`;
    if (r.warnings.length) showBanner(`${resumen} ${r.warnings.join(' ')}`);
    else showBanner(`${resumen} Tap it to see the full quality figures.`, 'info');
  } catch (err) {
    showBanner(err.message);
    store.clearPendingPlane();
  } finally {
    setBusy(null);
    planeBusy = false;
  }
}

const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** Una fila «clave: valor» del bloque de calidad de una medida. */
function measureRow(parent, k, v, title) {
  const row = document.createElement('div');
  row.className = 'attrs-row';
  const ke = document.createElement('span');
  ke.className = 'k';
  ke.textContent = k;
  const ve = document.createElement('span');
  ve.className = 'v';
  ve.textContent = v;
  if (title) row.title = title;
  row.append(ke, ve);
  parent.appendChild(row);
}

/**
 * Bloque de una medida dentro del menú de propiedades: los dos números
 * editables y, debajo, de dónde salieron y cuánto valen.
 */
function measurementSection(body, medida, reabrir) {
  const p = medida.properties;

  const sec = section(body, 'Strike and dip');

  const fila = document.createElement('div');
  fila.className = 'palette-row';
  fila.append(
    numberField('Strike', p.strike ?? 0, { min: 0, max: 359.9, step: 1 }, (v) =>
      store.updateMeasurement({ strike: v }),
    ),
    numberField('Dip', p.dip ?? 0, { min: 0, max: 90, step: 1 }, (v) =>
      store.updateMeasurement({ dip: v }),
    ),
  );
  sec.appendChild(fila);

  const tipos = document.createElement('div');
  tipos.className = 'palette-row';
  for (const t of STRUCTURE_TYPES) {
    tipos.appendChild(
      chip({
        label: t.short,
        title: t.label,
        color: t.color,
        swatch: true,
        active: p.type === t.id,
        onClick: () => {
          store.updateMeasurement({ type: t.id });
          reabrir();
        },
      }),
    );
  }
  sec.appendChild(tipos);

  if (p.type === 'bedding') {
    const inv = document.createElement('div');
    inv.className = 'palette-row';
    inv.appendChild(
      chip({
        label: 'Overturned',
        glyph: '⤣',
        active: !!p.overturned,
        onClick: () => {
          store.updateMeasurement({ overturned: !p.overturned });
          reabrir();
        },
      }),
    );
    sec.appendChild(inv);
  }

  /*
   * Calidad. Es la parte que justifica todo el módulo: un manteo sacado de un
   * DEM sin la base sobre la que se midió y sin su incertidumbre es un número
   * que nadie puede evaluar, y que acaba citado como si fuera de brújula.
   */
  const met = METHOD_BY_ID.get(p.method);
  const cal = section(body, 'Quality');
  measureRow(cal, 'Method', met ? met.label : p.method === 'edited' ? 'Edited by hand' : p.method);
  measureRow(cal, 'Dip direction', `${Math.round(p.dipAzimuth ?? 0)}° (${quadrant(p.dipAzimuth)})`);

  if (DEM_METHODS.has(p.method)) {
    measureRow(
      cal,
      'Uncertainty',
      `±${p.strikeSd ?? '—'}° strike · ±${p.dipSd ?? '—'}° dip`,
      'One standard deviation, propagated from the DEM vertical error by Monte Carlo',
    );
    measureRow(cal, 'Base', `${p.baseline ?? '—'} m long · ${p.minorSpread ?? '—'} m across`);
    measureRow(cal, 'Fit', `${p.n ?? '—'} points · RMS ${p.rms ?? '—'} m`);
    measureRow(cal, 'Elevations from', p.demSource === 'opentopo' ? 'OpenTopography' : 'AWS Terrain Tiles');
  } else if (p.method === 'edited') {
    measureRow(cal, 'Uncertainty', 'not applicable — typed in by hand');
  }
}

/* ---------- proyectos ---------- */

function setProjectStatus(text) {
  $('project-status').textContent = text;
}

function doSaveProject() {
  const name = $('project-name').value.trim();
  const data = saveProject(name);
  setProjectStatus(
    `Saved at ${new Date(data.savedAt).toLocaleTimeString()} · ${data.features.length} feature(s).`,
  );
  showBanner('Project saved. On iPadOS it lands in the Files app.', 'info');
}

async function doOpenProject(file) {
  setBusy(`Opening ${file.name}…`);
  try {
    const text = await file.text();
    const { project, warnings } = parseProject(text);
    // Se pregunta DESPUÉS de validar: no tiene sentido avisar de que se va a
    // perder el dibujo si el archivo ni siquiera era un proyecto.
    if (
      store.getState().features.length &&
      !confirm('Opening this project replaces the current drawing. Continue?')
    ) {
      return;
    }
    const n = openProject(project);
    if (project.name) $('project-name').value = project.name;
    setProjectStatus(`Opened ${file.name} · ${n} feature(s).`);
    showBanner(
      [`Project opened: ${n} feature(s).`, ...warnings].join(' '),
      warnings.length ? 'warn' : 'info',
    );
  } catch (err) {
    showBanner(`Could not open the project: ${err.message}`);
  } finally {
    setBusy(null);
  }
}

function doNewProject() {
  if (store.getState().features.length && !confirm('Start a new project? The current drawing is deleted.')) {
    return;
  }
  store.loadProject({ features: [] });
  $('project-name').value = '';
  setProjectStatus('New project, not saved yet.');
}

async function runMerge() {
  if (editBusy) return;
  editBusy = true;
  setBusy('Merging…');
  try {
    const { desde, hasta, puenteadas } = await applyMerge();
    showBanner(
      puenteadas
        ? `${desde} features merged into ${hasta}; ${puenteadas} segment(s) did not touch and were joined by their nearest endpoints.`
        : `${desde} features merged into ${hasta}.`,
      'info',
    );
  } catch (err) {
    showBanner(err.message);
  } finally {
    setBusy(null);
    editBusy = false;
  }
}

async function doImportGeoPackage(file) {
  setBusy(`Reading ${file.name}…`);
  try {
    const buf = await file.arrayBuffer();
    const { layers, warnings } = await importGeoPackage(buf);
    if (!layers.length) {
      showBanner('The GeoPackage has no usable feature layers.');
      return;
    }
    store.addImportedLayers(layers);
    const total = layers.reduce((n, l) => n + l.geojson.features.length, 0);
    const styled = layers.filter((l) => l.style).length;
    const parts = [
      `${layers.length} layer(s), ${total} feature(s).`,
      styled ? `${styled} with QGIS symbology applied.` : 'No QGIS styles: the default style is used.',
    ];
    if (warnings.length) parts.push(warnings.join(' '));
    showBanner(parts.join(' '), warnings.length ? 'warn' : 'info');
  } catch (err) {
    showBanner(`Could not read the GeoPackage: ${err.message}`);
  } finally {
    setBusy(null);
  }
}

/* ---------- barra de herramientas y estado ---------- */

/** Botones que crean o mueven geometría, y que el relieve 3D deshabilita. */
const GEOMETRY_TOOL_BUTTONS = [
  't-line',
  't-poly',
  't-hole',
  't-measure',
  't-vertices',
  't-cut',
  't-reshape',
  't-profile',
];

const TERRAIN_BLOCKED_TITLE =
  'Not available while 3D terrain is on: on tilted ground the point you touch is not the point on the map';

/**
 * Ayuda original de cada botón, capturada del HTML la primera vez. Hace falta
 * para poder devolverla al apagar el relieve, en vez de dejar el mensaje del
 * bloqueo puesto para siempre.
 */
const defaultTitles = new Map();
function defaultTitle(id) {
  if (!defaultTitles.has(id)) defaultTitles.set(id, $(id).title);
  return defaultTitles.get(id);
}

function renderToolbar() {
  const s = store.getState();
  const hasDraft = !!s.draft && s.draft.coords.length > 0;
  for (const [id, tool] of [
    ['t-nav', 'navigate'],
    ['t-line', 'line'],
    ['t-poly', 'polygon'],
    ['t-hole', 'hole'],
    ['t-select', 'select'],
    ['t-vertices', 'vertices'],
    ['t-cut', 'cut'],
    ['t-reshape', 'reshape'],
    ['t-profile', 'profile'],
    ['t-measure', 'measure'],
  ]) {
    $(id).classList.toggle('active', s.tool === tool);
  }
  $('t-snap').classList.toggle('active', s.snapEnabled);
  $('t-trace').classList.toggle('active', s.traceEnabled);
  $('t-3d').classList.toggle('active', s.terrain3d);

  /*
   * Con el relieve puesto, las herramientas que crean o mueven geometría se
   * apagan en vez de fallar en silencio: sobre terreno inclinado el vértice no
   * cae donde se toca, y el resultado sería un dibujo corrido que nadie
   * relacionaría con haber tenido el 3D encendido.
   */
  for (const id of GEOMETRY_TOOL_BUTTONS) {
    const btn = $(id);
    const original = defaultTitle(id); // se captura siempre, no solo al restaurar
    btn.disabled = s.terrain3d;
    btn.title = s.terrain3d ? TERRAIN_BLOCKED_TITLE : original;
  }

  // Unir exige dos o más elementos del mismo tipo de geometría.
  const sel = store.selectedFeatures();
  const kinds = new Set(sel.map((f) => f.geometry.type));
  $('t-merge').disabled = s.terrain3d || sel.length < 2 || kinds.size > 1;

  // La topología trabaja sobre la selección, o sobre todo si no hay ninguna.
  const alcance = sel.length || s.features.length;
  $('t-topo').disabled = s.terrain3d || alcance < 2;
  $('t-topo').title = s.terrain3d
    ? TERRAIN_BLOCKED_TITLE
    : sel.length
      ? `Make the ${sel.length} selected features share vertices`
      : 'Make all adjacent features share vertices';

  $('t-undo').disabled = !hasDraft;
  $('t-finish').disabled = !hasDraft;
  $('t-cancel').disabled = !hasDraft;
  $('t-delete').disabled = s.features.length === 0;
  $('t-delete').title = s.selection.length
    ? `Delete ${s.selection.length} selected feature(s)`
    : 'Delete the last saved feature';
  $('btn-export').disabled = s.features.length === 0;
}

function renderStatus() {
  const s = store.getState();
  const n = s.draft ? s.draft.coords.length : 0;
  $('status-count').textContent = `${s.features.length} feature${s.features.length === 1 ? '' : 's'}`;
  if (s.terrain3d) {
    $('status-text').textContent =
      '3D terrain on — viewing only: drag with two fingers to tilt, tap 3D again to draw';
  } else if (s.tool === 'navigate') {
    $('status-text').textContent = 'Navigation mode — pick Line or Polygon to draw';
  } else if (s.tool === 'profile') {
    $('status-text').textContent =
      n > 0
        ? `Profile line with ${n} vertices · close it to read the terrain along it`
        : 'Draw the line to profile · press and hold for freehand, double tap to close';
  } else if (s.tool === 'measure') {
    const superficie = STRUCTURE_TYPE_BY_ID.get(s.measureType);
    const que = superficie ? superficie.label.toLowerCase() : 'surface';
    if (s.measureMethod === 'manual') {
      $('status-text').textContent = `Tap where you measured the ${que} — ${formatStrikeDip(s.manualStrike, s.manualDip)} goes in, and you can correct it right after`;
    } else if (s.measureMethod === 'three-point') {
      $('status-text').textContent =
        n === 0
          ? `Tap three points on the same ${que}, spread as widely as the outcrop allows`
          : `${n} of 3 points · spread them out: a short or collinear base gives a worthless dip`;
    } else {
      $('status-text').textContent =
        n > 0
          ? `${n} nodes along the trace · close it to fit the plane`
          : `Draw along the trace of the ${que} · every node is sampled on the DEM`;
    }
  } else if (s.tool === 'select') {
    $('status-text').textContent = s.selection.length
      ? `${s.selection.length} selected · tap another to add it, or outside to clear`
      : 'Tap a feature to select it';
  } else if (s.tool === 'vertices') {
    const base =
      s.vertexMode === 'add'
        ? 'Add mode · tap an edge to insert a vertex, drag to place it'
        : s.vertexMode === 'delete'
          ? 'Delete mode · tap a vertex to remove it'
          : 'Drag a vertex to move it · a midpoint to insert · double tap to delete';
    $('status-text').textContent = s.topoEdit
      ? `${base} · topological editing on: magenta ones move together`
      : base;
  } else if (s.tool === 'hole') {
    /*
     * Se dice a QUÉ va a afectar antes de dibujarlo, no después. Con una
     * selección es a ella; sin selección, al único polígono que contenga el
     * área — y si acaban solapando varios, la operación se detiene y lo pide.
     */
    $('status-text').textContent =
      n > 0
        ? `Hole outline with ${n} vertices · close it to remove that area`
        : s.selection.length
          ? `Draw the area to remove from the ${s.selection.length} selected polygon(s)`
          : 'Draw the area to remove · it comes out of the polygon it falls inside';
  } else if (s.tool === 'reshape') {
    $('status-text').textContent = !s.selection.length
      ? 'Select the feature to reshape first (Select tool), then come back'
      : n > 0
        ? `Reshape line with ${n} vertices · close it to redraw that stretch`
        : `Draw a line that enters and leaves the ${s.selection.length} selected feature(s)`;
  } else if (s.tool === 'cut') {
    if (s.cutSource === 'feature') {
      $('status-text').textContent = s.selection.length
        ? `Tap the feature to use as the blade · it will only cut the ${s.selection.length} selected`
        : 'Tap the feature to use as the blade · it will cut everything it crosses';
    } else {
      $('status-text').textContent =
        n > 0
          ? `Split line with ${n} vertices · close it to apply the split`
          : (s.selection.length
              ? `Draw the split line · it will only affect the ${s.selection.length} selected features`
              : 'Draw the split line · it will affect everything it crosses');
    }
  } else if (s.extendFrom) {
    // El primer clic decide por qué extremo se sigue, así que eso es lo único
    // que hay que decir aquí.
    $('status-text').textContent =
      'Continuing the selected line — click near the end you want to carry on from (both are marked)';
  } else if (s.traceEnabled) {
    $('status-text').textContent =
      n > 0
        ? `${n} vertices · Trace on: tap another feature and the stroke will follow its edge`
        : 'Trace on · tap an existing feature to start following its edge';
  } else if (n > 0) {
    $('status-text').textContent = `${n} vertex${n === 1 ? '' : 'es'} · tap to add, press and hold for freehand, double tap to close`;
  } else {
    $('status-text').textContent =
      'Tap for the first vertex · press and hold for freehand';
  }
}

/* ---------- cableado ---------- */

/**
 * Controles de Ajustes que reflejan estado del store. Se declaran una vez para
 * poder repintarlos en bloque cuando el estado cambia sin pasar por ellos —al
 * abrir un proyecto, por ejemplo.
 */
const SETTING_INPUTS = [
  { key: 'fingerDraw', id: 'opt-finger', kind: 'check' },
  { key: 'smoothing', id: 'opt-smooth', kind: 'check' },
  { key: 'topoEdit', id: 'opt-topo', kind: 'check' },
  { key: 'tolerance', id: 'opt-tol', out: 'tol-value', fmt: (v) => `${v.toFixed(1)} px` },
  { key: 'snapTolerance', id: 'opt-snap-tol', out: 'snap-tol-value', fmt: (v) => `${v} px` },
  { key: 'traceTolerance', id: 'opt-trace-tol', out: 'trace-tol-value', fmt: (v) => `${v} px` },
  // La tolerancia topológica tiene dos controles (deslizador y número) que se
  // sincronizan en syncTopoTolerance; aquí solo se refresca su valor.
  { key: 'topoTolerance', id: 'opt-topo-tol' },
  { key: 'topoTolerance', id: 'opt-topo-tol-num' },
  { key: 'terrain3d', id: 'opt-terrain', kind: 'check' },
  {
    key: 'terrainExaggeration',
    id: 'opt-terrain-exag',
    out: 'terrain-exag-value',
    fmt: (v) => `${v.toFixed(1)}×`,
  },
  { key: 'opentopoDem', id: 'opt-opentopo-dem' },
  { key: 'opentopoKey', id: 'opt-opentopo-key' },
  {
    key: 'profileSamples',
    id: 'opt-profile-samples',
    out: 'profile-samples-value',
    fmt: (v) => String(v),
  },
];

/** Ajustes que se ven en un grupo de radios y no en un control con valor. */
const RADIO_SETTING_KEYS = ['freehandMode', 'cutSource', 'profileSource'];

function syncSettingsUI() {
  const s = store.getState();
  for (const item of SETTING_INPUTS) {
    const el = $(item.id);
    if (!el) continue;
    if (item.kind === 'check') {
      el.checked = !!s[item.key];
      continue;
    }
    // No se pisa un deslizador que el usuario está arrastrando.
    if (document.activeElement === el) continue;
    el.value = String(s[item.key]);
    if (item.out) $(item.out).textContent = item.fmt(s[item.key]);
  }
  $(s.freehandMode === 'drag' ? 'fh-drag' : 'fh-hold').checked = true;
  $(s.cutSource === 'feature' ? 'cut-feature' : 'cut-draw').checked = true;
  $(s.profileSource === 'opentopo' ? 'dem-opentopo' : 'dem-terrarium').checked = true;
}

export function initUI() {
  $('t-nav').addEventListener('click', () => store.setTool('navigate'));
  $('t-line').addEventListener('click', () => store.setTool('line'));
  $('t-poly').addEventListener('click', () => store.setTool('polygon'));
  $('t-snap').addEventListener('click', () => store.setSnapEnabled(!store.getState().snapEnabled));
  $('t-trace').addEventListener('click', () =>
    store.setTraceEnabled(!store.getState().traceEnabled),
  );
  $('t-undo').addEventListener('click', () => store.undoVertex());
  $('t-finish').addEventListener('click', () => store.finishDraft());
  $('t-cancel').addEventListener('click', () => store.cancelDraft());
  $('t-select').addEventListener('click', () => store.setTool('select'));
  $('t-vertices').addEventListener('click', () => store.setTool('vertices'));
  $('t-cut').addEventListener('click', () => store.setTool('cut'));
  $('t-hole').addEventListener('click', () => pickTool('hole'));
  $('t-reshape').addEventListener('click', () => store.setTool('reshape'));
  $('t-profile').addEventListener('click', () => store.setTool('profile'));
  $('t-measure').addEventListener('click', () => store.setTool('measure'));
  $('t-3d').addEventListener('click', () => {
    const encender = !store.getState().terrain3d;
    store.setTerrain3d(encender);
    /*
     * Se lee el estado DE VUELTA en vez de dar por hecho que se aplicó: si el
     * dispositivo no puede con el terreno, `applyTerrain` lo revierte y deja su
     * propio aviso. Anunciar aquí "modo de visualización" a ciegas pisaría ese
     * mensaje y dejaría al usuario creyendo que el 3D está puesto cuando no lo
     * está — y sin entender por qué no puede dibujar... o por qué sí puede.
     */
    if (store.getState().terrain3d !== encender) return;
    showBanner(
      encender
        ? 'Viewing mode: the drawing is draped over the relief but digitising is disabled. Off the cached tiles the ground renders flat, and on an older tablet this costs noticeably more to render.'
        : 'Back to plan view: you can draw again.',
      encender ? 'warn' : 'info',
    );
  });
  $('t-merge').addEventListener('click', runMerge);
  // El botón abre el desplegable en vez de aplicar a ciegas: el umbral es el
  // parámetro que decide el resultado y tiene que verse antes de tocarlo.
  $('t-topo').addEventListener('click', () => {
    if (!$('topo-menu').classList.contains('hidden')) closeOverlays();
    else openTopoMenu();
  });
  $('btn-close-topo').addEventListener('click', () => $('topo-menu').classList.add('hidden'));
  $('topo-apply').addEventListener('click', () => {
    closeOverlays();
    runTopology();
  });
  $('topo-menu-range').addEventListener('input', (e) =>
    syncTopoTolerance(e.target.value, 'topo-menu-range'),
  );
  $('topo-menu-num').addEventListener('input', (e) =>
    syncTopoTolerance(e.target.value, 'topo-menu-num'),
  );
  $('opt-topo-tol-num').addEventListener('input', (e) =>
    syncTopoTolerance(e.target.value, 'opt-topo-tol-num'),
  );

  $('btn-strabo').addEventListener('click', () => togglePanel('strabo-panel'));
  $('btn-close-strabo').addEventListener('click', () =>
    $('strabo-panel').classList.remove('open'),
  );
  $('t-delete').addEventListener('click', () => {
    if (store.getState().selection.length) store.deleteSelected();
    else store.deleteLastFeature();
  });

  $('btn-layers').addEventListener('click', () => togglePanel('layer-panel'));
  $('btn-close-layers').addEventListener('click', () => $('layer-panel').classList.remove('open'));
  $('btn-units').addEventListener('click', () => togglePanel('units-panel'));
  $('btn-close-units').addEventListener('click', () => $('units-panel').classList.remove('open'));
  $('btn-symbology').addEventListener('click', () => togglePanel('symbology-panel'));
  $('btn-close-symbology').addEventListener('click', () =>
    $('symbology-panel').classList.remove('open'),
  );
  $('btn-reset-symbology').addEventListener('click', () => {
    store.resetOrnaments();
    showBanner('Fault symbology reset to defaults.', 'info');
  });

  $('btn-project').addEventListener('click', () => togglePanel('project-menu'));
  $('btn-close-project').addEventListener('click', () => $('project-menu').classList.add('hidden'));
  $('btn-save-project').addEventListener('click', doSaveProject);
  $('btn-new-project').addEventListener('click', doNewProject);
  $('btn-open-project').addEventListener('click', () => $('file-project').click());
  $('file-project').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permite reabrir el mismo archivo
    if (file) doOpenProject(file);
  });
  $('btn-close-props').addEventListener('click', closePropsMenu);
  $('btn-add-unit').addEventListener('click', () => {
    const name = $('new-unit-name').value.trim();
    if (!name) return;
    const unit = store.addUnit({
      name,
      code: $('new-unit-code').value.trim(),
      color: $('new-unit-color').value,
    });
    $('new-unit-name').value = '';
    $('new-unit-code').value = '';
    store.setPolygonType(unit.id);
  });
  $('btn-settings').addEventListener('click', () => togglePanel('settings'));
  $('btn-close-settings').addEventListener('click', () => $('settings').classList.add('hidden'));
  $('btn-export').addEventListener('click', doExportGeoPackage);
  $('btn-export-geojson').addEventListener('click', () =>
    downloadGeoJSON(store.getState().features),
  );
  $('btn-import').addEventListener('click', () => $('file-gpkg').click());
  $('file-gpkg').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permite reimportar el mismo archivo
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.mbtiles') || name.endsWith('.pmtiles')) doOpenTiles(file);
    else doImportGeoPackage(file);
  });
  $('banner-close').addEventListener('click', () => $('banner').classList.add('hidden'));

  $('fh-hold').addEventListener('change', () => store.setFreehandMode('hold'));
  $('fh-drag').addEventListener('change', () => store.setFreehandMode('drag'));
  $('opt-finger').addEventListener('change', (e) => store.setFingerDraw(e.target.checked));
  $('opt-smooth').addEventListener('change', (e) => store.setSmoothing(e.target.checked));
  $('opt-tol').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('tol-value').textContent = `${v.toFixed(1)} px`;
    store.setTolerance(v);
  });
  $('opt-topo').addEventListener('change', (e) => store.setTopoEdit(e.target.checked));
  $('cut-draw').addEventListener('change', () => store.setCutSource('draw'));
  $('cut-feature').addEventListener('change', () => store.setCutSource('feature'));
  $('opt-snap-tol').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('snap-tol-value').textContent = `${v} px`;
    store.setSnapTolerance(v);
  });
  $('opt-trace-tol').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('trace-tol-value').textContent = `${v} px`;
    store.setTraceTolerance(v);
  });
  $('opt-topo-tol').addEventListener('input', (e) =>
    syncTopoTolerance(e.target.value, 'opt-topo-tol'),
  );
  $('btn-clear').addEventListener('click', () => {
    if (confirm('Delete every drawn feature?')) store.clearFeatures();
  });

  /* ---------- elevación y relieve ---------- */

  const demSelect = $('opt-opentopo-dem');
  for (const d of OPENTOPO_DEMS) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.label} (~${d.nominal} m)`;
    demSelect.appendChild(opt);
  }
  // Texto y no enlace: abrir el navegador desde una PWA en terreno saca de la
  // app, y la clave se pega igual copiándola desde otro dispositivo.
  $('opentopo-signup').textContent = OPENTOPO_SIGNUP;

  $('dem-terrarium').addEventListener('change', () => store.setProfileSource('terrarium'));
  $('dem-opentopo').addEventListener('change', () => {
    store.setProfileSource('opentopo');
    if (!store.getState().opentopoKey.trim()) {
      showBanner('OpenTopography needs a free API key. Paste it just below.');
    }
  });
  demSelect.addEventListener('change', (e) => store.setOpenTopoDem(e.target.value));
  $('opt-opentopo-key').addEventListener('change', (e) => {
    const key = e.target.value.trim();
    store.setOpenTopoKey(key);
    saveOpenTopoKey(key);
  });
  $('opt-profile-samples').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('profile-samples-value').textContent = String(v);
    store.setProfileSamples(v);
  });

  $('opt-terrain').addEventListener('change', (e) => store.setTerrain3d(e.target.checked));
  $('opt-terrain-exag').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('terrain-exag-value').textContent = `${v.toFixed(1)}×`;
    store.setTerrainExaggeration(v);
  });

  $('btn-close-profile').addEventListener('click', () => store.clearProfile());
  $('btn-profile-csv').addEventListener('click', downloadProfileCSV);
  wireProfilePointer();
  wireStructureControls();
  syncStructureControls();

  $('btn-shortcuts').addEventListener('click', () => togglePanel('shortcuts'));
  $('btn-close-shortcuts').addEventListener('click', () => $('shortcuts').classList.add('hidden'));
  renderShortcutsHelp();
  // Anotar ANTES de que renderToolbar cachee las ayudas originales, para que
  // el bloqueo por relieve 3D restaure la versión con el atajo incluido.
  annotateToolbarShortcuts();
  $('btn-close-attrs').addEventListener('click', () => {
    closeAttrs();
    if (mapBridge) mapBridge.clearForeignHighlight();
  });
  wireScale();
  wireShortcuts();
  wireClickOutside();

  // StraboSpot vive en su propio módulo: la API, el aplanado de spots y su
  // simbología no tienen por qué mezclarse con el resto de la interfaz.
  initStraboPanel({ message: showBanner, busy: setBusy });

  buildPalette();
  renderLayers();
  renderUnits();
  renderSymbology();
  renderToolbar();
  renderStatus();
  syncSettingsUI();

  store.subscribe(() => {
    if (
      store.changed('tool') ||
      store.changed('certainty') ||
      store.changed('lineType') ||
      store.changed('polygonType') ||
      store.changed('vertexMode') ||
      store.changed('measureMethod') ||
      store.changed('measureType') ||
      store.changed('measureOverturned') ||
      store.changed('units')
    ) {
      buildPalette();
    }
    if (store.changed('units')) renderUnits();
    if (store.changed('ornaments')) renderSymbology();
    if (store.changed('layers')) renderLayers();
    // Abrir un proyecto reescribe los ajustes: los controles tienen que
    // reflejarlo, o mostrarían valores que ya no son los que rigen.
    if (
      SETTING_INPUTS.some((s) => store.changed(s.key)) ||
      RADIO_SETTING_KEYS.some((k) => store.changed(k))
    ) {
      syncSettingsUI();
    }
    // Si la selección desaparece, el menú de propiedades ya no aplica a nada.
    if (store.changed('selection') && store.getState().selection.length === 0) closePropsMenu();
    if (
      store.changed('tool') ||
      store.changed('draft') ||
      store.changed('features') ||
      store.changed('selection') ||
      store.changed('snapEnabled') ||
      store.changed('traceEnabled') ||
      store.changed('topoEdit') ||
      store.changed('vertexMode') ||
      store.changed('cutSource') ||
      store.changed('extendFrom') ||
      store.changed('measureMethod') ||
      store.changed('measureType') ||
      store.changed('manualStrike') ||
      store.changed('manualDip')
    ) {
      renderToolbar();
      renderStatus();
    }
    // La línea de corte se publica desde el store; aquí es donde se aplica,
    // porque cargar JSTS es asíncrono y el store se mantiene síncrono.
    if (store.changed('pendingCut')) {
      const cut = store.getState().pendingCut;
      if (cut) runCut(cut);
    }
    if (store.changed('pendingReshape')) {
      const linea = store.getState().pendingReshape;
      if (linea) runReshape(linea);
    }
    if (store.changed('pendingHole')) {
      const area = store.getState().pendingHole;
      if (area) runHole(area);
    }
    // Mismo patrón que el corte: el store publica la traza y aquí se muestrea
    // el DEM, que es asíncrono.
    if (store.changed('pendingProfile')) {
      const traza = store.getState().pendingProfile;
      if (traza) runProfile(traza);
    }
    if (store.changed('pendingPlane')) {
      const puntos = store.getState().pendingPlane;
      if (puntos) runPlane(puntos);
    }
    if (
      store.changed('scaleLock') ||
      store.changed('scalePresets') ||
      store.changed('scalePixelMm')
    ) {
      // La píldora refleja el candado; la escala en sí la manda el mapa.
      const fijada = store.getState().scaleLock;
      $('scale-lock-mark').hidden = !fijada;
      $('btn-scale').classList.toggle('locked', !!fijada);
      if (!$('scale-menu').classList.contains('hidden')) renderScaleMenu();
    }
    if (store.changed('structureStyle')) syncStructureControls();
    if (store.changed('profile')) renderProfilePanel();
    if (store.changed('terrain3d')) {
      renderToolbar();
      renderStatus();
      buildPalette();
    }
  });
}
