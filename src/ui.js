import * as store from './store.js';
import {
  CERTAINTIES,
  CERTAINTY_BY_ID,
  LINE_GROUPS,
  LINE_TYPES,
  LINE_TYPE_BY_ID,
  ORNAMENT_LIMITS,
  ORNAMENT_TYPES,
} from './symbology.js';
import { chaikin, simplifyDP } from './simplify.js';
import { downloadBlob, downloadGeoJSON } from './persistence.js';
import { exportGeoPackage, importGeoPackage } from './gpkg/index.js';
import { MBTILES_WARN_BYTES, openTileFile } from './tiles.js';
import { applyCut, applyMerge, applyTopology } from './editOps.js';
import { openProject, parseProject, saveProject } from './project.js';
import { initStraboPanel } from './strabo/panel.js';

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

function chip({ label, title, color, dash, swatch, glyph, active, onClick, cls = '' }) {
  const b = document.createElement('button');
  b.className = `chip${cls ? ` ${cls}` : ''}${active ? ' active' : ''}`;
  if (title) b.title = title;
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

  // Estas herramientas no crean elementos, así que no hay tipo que escoger.
  if (['navigate', 'select', 'cut'].includes(s.tool)) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  // Fila de certeza: tres chips minúsculos arriba del todo.
  const certRow = document.createElement('div');
  certRow.className = 'palette-row certainty-row';
  for (const c of CERTAINTIES) {
    certRow.appendChild(
      chip({
        label: c.short,
        title: c.label,
        color: '#e6edf3',
        dash: c.dash,
        active: s.certainty === c.id,
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
            color: t.color,
            dash: activeDash,
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
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = meta.color;
    const name = document.createElement('strong');
    name.textContent = meta.label;
    head.append(sw, name);
    li.appendChild(head);

    for (const f of SYMB_FIELDS) li.appendChild(symbField(type, f, s[f.key]));
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
  $('props-title').textContent =
    sel.length === 1 ? '1 feature selected' : `${sel.length} features selected`;

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

  // Flip del ornamento: solo tiene sentido en las fallas que llevan símbolo.
  const conOrnamento = sel.filter((f) => ORNAMENT_TYPES.includes(f.properties.type));
  if (conOrnamento.length > 0) {
    const simb = section(body, 'Symbology');
    const flip = document.createElement('button');
    flip.className = 'pill wide';
    flip.textContent = `Flip symbol (${conOrnamento.length})`;
    flip.title =
      'Moves the teeth or ticks to the other side of the trace, with no need to redraw the fault backwards';
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
  for (const c of CERTAINTIES) {
    certRow.appendChild(
      chip({
        label: c.label,
        color: '#e6edf3',
        dash: c.dash,
        active: currentCert === c.id,
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
  geo.appendChild(geoRow);

  // Borrar
  const del = document.createElement('button');
  del.className = 'pill danger wide';
  del.textContent = `Delete ${sel.length} feature${sel.length === 1 ? '' : 's'}`;
  del.addEventListener('click', () => {
    store.deleteSelected();
    closePropsMenu();
  });
  body.appendChild(del);

  // Posicionar cerca del toque, sin salirse de la pantalla.
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const x = Math.min(Math.max(12, screen[0] - rect.width / 2), window.innerWidth - rect.width - 12);
  const y = Math.min(screen[1] + 18, window.innerHeight - rect.height - 12);
  menu.style.left = `${x}px`;
  menu.style.top = `${Math.max(12, y)}px`;
}

export function closePropsMenu() {
  $('props-menu').classList.add('hidden');
}

/* ---------- paneles ---------- */

/** Cajones laterales: solo uno abierto a la vez. */
const DRAWERS = ['layer-panel', 'units-panel', 'symbology-panel', 'strabo-panel'];
/** Paneles flotantes, que se ocultan con `hidden` en vez de con `open`. */
const POPOVERS = ['settings', 'project-menu', 'topo-menu', 'strabo-attrs'];

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
    const bytes = await exportGeoPackage(features, store.getState().units);
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

function renderToolbar() {
  const s = store.getState();
  const hasDraft = !!s.draft && s.draft.coords.length > 0;
  for (const [id, tool] of [
    ['t-nav', 'navigate'],
    ['t-line', 'line'],
    ['t-poly', 'polygon'],
    ['t-select', 'select'],
    ['t-vertices', 'vertices'],
    ['t-cut', 'cut'],
  ]) {
    $(id).classList.toggle('active', s.tool === tool);
  }
  $('t-snap').classList.toggle('active', s.snapEnabled);
  $('t-trace').classList.toggle('active', s.traceEnabled);

  // Unir exige dos o más elementos del mismo tipo de geometría.
  const sel = store.selectedFeatures();
  const kinds = new Set(sel.map((f) => f.geometry.type));
  $('t-merge').disabled = sel.length < 2 || kinds.size > 1;

  // La topología trabaja sobre la selección, o sobre todo si no hay ninguna.
  const alcance = sel.length || s.features.length;
  $('t-topo').disabled = alcance < 2;
  $('t-topo').title = sel.length
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
  if (s.tool === 'navigate') {
    $('status-text').textContent = 'Navigation mode — pick Line or Polygon to draw';
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
];

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
      store.changed('units')
    ) {
      buildPalette();
    }
    if (store.changed('units')) renderUnits();
    if (store.changed('ornaments')) renderSymbology();
    if (store.changed('layers')) renderLayers();
    // Abrir un proyecto reescribe los ajustes: los controles tienen que
    // reflejarlo, o mostrarían valores que ya no son los que rigen.
    if (SETTING_INPUTS.some((s) => store.changed(s.key))) syncSettingsUI();
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
      store.changed('cutSource')
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
  });
}
