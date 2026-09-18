import * as store from './store.js';
import {
  SCREEN_SIZES,
  STANDARD_PIXEL_MM,
  calibratePixelMm,
  diagonalFromPixelMm,
  formatScale,
  niceScale,
  parseScale,
  pixelMmFromDiagonal,
} from './scale.js';
import { closeAttrs, importedEntries, importedTitle, openAttrs } from './attrs.js';
import { COMPASS_DIP_SIGMA_DEG, COMPASS_STRIKE_SIGMA_DEG, measureThickness } from './thickness.js';
import {
  DEFAULT_MAX_OFFSET_M,
  initSectionPanel,
  renderSectionPanel,
  runSection,
} from './sectionPanel.js';
import {
  CERTAINTIES,
  CERTAINTY_BY_ID,
  FLIPPABLE_ORNAMENT_TYPES,
  LINE_GROUPS,
  LINE_TYPES,
  LINE_TYPE_BY_ID,
  ORNAMENT_LIMITS,
  STRUCTURE_TYPES,
  STRUCTURE_TYPE_BY_ID,
  effectiveLineColor,
  isObservedOnly,
} from './symbology.js';
import {
  DEFAULT_TRACE_KM,
  MAX_TRACE_KM,
  MIN_TRACE_DIP_DEG,
  traceFromPlane,
} from './planeTrace.js';
import {
  DEM_METHODS,
  MEASURE_METHODS,
  METHOD_BY_ID,
  formatStrikeDip,
  planeFromPoints,
  quadrant,
} from './structure.js';
import {
  deviceOrientationSupported,
  needsOrientationPermission,
  requestOrientationPermission,
  startOrientationCapture,
} from './deviceOrientation.js';
import { buildCompass, compassHint } from './compassWidget.js';
import { closeStereogram, initStereogramPanel, isStereogramOpen } from './stereogramPanel.js';
import { chaikin, simplifyDP } from './simplify.js';
import {
  DemSampler,
  OPENTOPO_DEMS,
  OPENTOPO_DEM_BY_ID,
  OPENTOPO_SIGNUP,
  OpenTopoSampler,
  TERRARIUM_NOMINAL_M,
  TileDemSampler,
} from './dem.js';
import {
  formatDistance,
  formatElevation,
  indexAtDistance,
  profileCSV,
  profilePNG,
  profileSVG,
  renderProfileChart,
} from './profile.js';
import {
  downloadBlob,
  downloadGeoJSON,
  downloadText,
  saveOpenTopoKey,
} from './persistence.js';
import { exportGeoPackage, importGeoPackage } from './gpkg/index.js';
import { exportMapImage, pageSizeMm } from './mapExport.js';
import { MBTILES_WARN_BYTES, openTileFile, readTileBytes } from './tiles.js';
import {
  forgetImportedFile,
  forgetImportedFilesByRole,
  listImportedFiles,
  rememberImportedFile,
} from './importedFiles.js';
import {
  deleteArea,
  downloadArea,
  listAreas,
  metresPerTile,
  planArea,
  storageUse,
} from './areaCache.js';
import { BASEMAPS, PREFETCH_BLOCKED } from './basemaps.js';
import {
  applyCut,
  applyLinesToPolygon,
  applyMerge,
  applyHole,
  applyReshape,
  applyTopology,
} from './editOps.js';
import { openProject, parseProject, saveProject } from './project.js';
import {
  APP_AUTHOR,
  APP_CONTACT,
  APP_ORG,
  APP_STAGE,
  APP_TOOLS,
  APP_VERSION,
  CHANGELOG,
} from './version.js';
import { initStraboPanel } from './strabo/panel.js';
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  comboLabel,
  consumesDefault,
  isTyping,
  labelsFor,
  repeatsAllowed,
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

/**
 * Fila de chips de unidad geológica, compartida entre la paleta de medir y el
 * panel de propiedades de una medida ya puesta. `allowNone` ofrece un chip
 * "None" que quita la etiqueta: a diferencia de un polígono, cuya unidad ES
 * su tipo, una medida puede no tener unidad asignada todavía.
 */
function unitChips(container, units, activeId, onPick, { allowNone = true } = {}) {
  if (allowNone) {
    container.appendChild(
      chip({
        label: 'None',
        title: 'Do not tag this measurement with a map unit',
        active: activeId === null || activeId === undefined,
        onClick: () => onPick(null),
      }),
    );
  }
  for (const u of units) {
    container.appendChild(
      chip({
        label: u.code || u.name.slice(0, 8),
        title: u.name,
        color: u.color,
        swatch: true,
        active: activeId === u.id,
        onClick: () => onPick(u.id),
      }),
    );
  }
}

/**
 * La misma elección de unidad que `unitChips`, pero como menú desplegable:
 * una fila de chips con seis u ocho unidades no cabe en el panel de crear
 * medida sin empujar todo lo demás fuera de la pantalla, y ahí lo que importa
 * es tocar rápido, no ver el color de un vistazo — ese color ya se ve en el
 * chip de la medida una vez puesta.
 */
function unitSelect(container, units, activeId, onPick) {
  const select = document.createElement('select');
  select.className = 'palette-select';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'None';
  select.appendChild(none);
  for (const u of units) {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.code ? `${u.code} — ${u.name}` : u.name;
    select.appendChild(opt);
  }
  select.value = activeId || '';
  select.addEventListener('change', () => onPick(select.value || null));
  container.appendChild(select);
}

/* ---------- paleta de tipos ---------- */

/**
 * Mismo corte que la disposición compacta de app.css (`.side-actions`,
 * `.toolbar` en tira): un teléfono, o cualquier pantalla igual de angosta o
 * baja. En tablet y PC no aplica — ahí sobra sitio para dejar la paleta
 * abierta mientras se ajustan varias cosas a la vez.
 */
function isCompactLayout() {
  return window.matchMedia('(max-width: 680px), (max-height: 520px)').matches;
}

/** Modos de la herramienta Edit Nodes, con su glifo y su ayuda. */
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
    gl.textContent = 'Edit Nodes';
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
          onClick: () => {
            store.setMeasureMethod(m.id);
            /*
             * Elegido el método, el panel ya dijo lo que tenía que decir: se
             * esconde para dejarle sitio al mapa —o, con Device, al panel de
             * la brújula—. Sigue pudiéndose reabrir desde Create ▸ Dip para
             * tocar Surface o Unit otra vez.
             *
             * Salvo que Device se haya revertido solo por falta de GPS: ahí
             * el método vigente ya no es el que se tocó, y esconder el panel
             * dejaría sin cómo elegir otro sin salir de la herramienta y
             * volver a entrar.
             */
            if (store.getState().measureMethod === m.id) {
              $('palette').classList.add('hidden');
            }
          },
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

    const unidades = paletteGroup(scroll, 'Unit');
    unitSelect(unidades, s.units, s.measureUnit, (id) => store.setMeasureUnit(id));

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
            onClick: () => {
              store.setLineType(t.id);
              /*
               * Solo en móvil: elegido el tipo, la paleta ya dijo lo que
               * tenía que decir y en una pantalla de teléfono es medio mapa
               * tapado por gusto. En tablet y PC se queda —ahí cabe de sobra
               * y cambiar de tipo entre trazo y trazo es cómodo con ella
               * abierta.
               */
              if (isCompactLayout()) $('palette').classList.add('hidden');
            },
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
          onClick: () => {
            store.setPolygonType(u.id);
            if (isCompactLayout()) $('palette').classList.add('hidden');
          },
        }),
      );
    }
    const edit = document.createElement('button');
    edit.className = 'chip ghost';
    edit.textContent = '+ Edit';
    edit.title = 'Open the units module';
    edit.addEventListener('click', () => $('units-panel').classList.add('open'));
    group.appendChild(edit);

    const crear = document.createElement('button');
    crear.className = 'chip ghost';
    crear.textContent = '+ Create unit';
    crear.title = 'Add a new geological unit';
    crear.addEventListener('click', () => {
      $('units-panel').classList.add('open');
      // El campo de nombre puede quedar tapado si ya hay muchas unidades en
      // la lista: se enfoca y se lleva a la vista para poder escribir de una.
      requestAnimationFrame(() => {
        const input = $('new-unit-name');
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
        input.focus();
      });
    });
    group.appendChild(crear);
    scroll.appendChild(group);
  }
  el.appendChild(scroll);
}

/* ---------- módulo de unidades ---------- */

function renderUnits() {
  const list = $('unit-list');
  const s = store.getState();
  list.replaceChildren();

  $('unit-labels').checked = !!s.unitLabels;

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

/* ---------- módulo de simbología de línea ---------- */

/**
 * Los campos, en el orden en que se ven. `width` y el color los lleva TODO
 * tipo de línea —también un contacto, que no tiene ornamento que espaciar—; el
 * resto solo aparece cuando el tipo trae ese parámetro, que es lo que decide
 * `defaultOrnaments()` y no una lista aparte que habría que mantener a la par.
 */
const SYMB_FIELDS = [
  { key: 'width', label: 'Width', fmt: (v) => `${v.toFixed(2)}×` },
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

  // Agrupadas como en la paleta —Contactos, Fallas, Pliegues, Diques— porque
  // ahora están las once y una lista plana obliga a leerla entera para dar con
  // un contacto.
  for (const grupo of LINE_GROUPS) {
    const tipos = LINE_TYPES.filter((t) => t.group === grupo);
    if (tipos.length === 0) continue;

    const cabecera = document.createElement('li');
    cabecera.className = 'symb-group';
    cabecera.textContent = grupo;
    list.appendChild(cabecera);

    for (const meta of tipos) {
      const type = meta.id;
      const s = ornaments[type];
      if (!s) continue;

      const li = document.createElement('li');
      li.className = 'symb-row';

      const head = document.createElement('div');
      head.className = 'symb-head';
      const name = document.createElement('strong');
      name.textContent = meta.label;
      head.append(symbColor(type, effectiveLineColor(type, ornaments), meta.label), name);
      li.appendChild(head);

      // Solo los campos que el tipo tiene: un contacto lleva color y grosor, y
      // nada más. El símbolo de un pliegue va además a caballo del eje, así
      // que desplazarlo hacia un lado rompe lo que significa y ese deslizador
      // ni se ofrece.
      const fields = SYMB_FIELDS.filter(
        (f) => f.key in s && !(f.key === 'offset' && isObservedOnly(type)),
      );
      for (const f of fields) li.appendChild(symbField(type, f, s[f.key]));
      list.appendChild(li);
    }
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
  if (layer.kind === 'imported') {
    /*
     * Adoptar la capa. Va aquí y no en el menú de propiedades porque es una
     * operación sobre la CAPA entera, no sobre un elemento: lo que decide es
     * si ese mapa se va a seguir usando como referencia o se va a continuar.
     */
    const editar = document.createElement('button');
    editar.className = 'icon-btn';
    editar.textContent = '✎';
    editar.title = 'Move this layer into the drawing so every tool can edit it';
    editar.setAttribute('aria-label', `Make ${layer.label} editable`);
    editar.addEventListener('click', () => adoptLayerInto(layer));
    move.appendChild(editar);
  }
  if (layer.kind === 'imported' || layer.kind === 'tiles') {
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '✕';
    del.title = layer.kind === 'tiles' ? 'Remove offline map' : 'Remove imported layer';
    del.setAttribute('aria-label', `Remove ${layer.label}`);
    del.addEventListener('click', () => {
      if (layer.kind !== 'tiles') {
        store.removeImported(layer.id);
        return;
      }
      store.removeTileSet(layer.id);
      // Quitar el mapa de la sesión es también decidir que no vuelva mañana.
      forgetImportedFile(layer.id).catch(() => {});
    });
    move.appendChild(del);
  }
  /*
   * Las tres capas del dibujo no se reordenan entre sí: unidades debajo,
   * trazas encima, medidas al final. No es una preferencia — cualquier otro
   * orden esconde las trazas bajo el relleno de las unidades.
   */
  const fijo = store.DRAWING_KINDS.has(layer.kind);
  let up = null;
  let down = null;
  if (!fijo) {
    up = document.createElement('button');
    up.className = 'icon-btn';
    up.textContent = '▲';
    up.setAttribute('aria-label', `Move ${layer.label} up`);
    up.addEventListener('click', () => store.moveLayer(layer.id, -1));
    down = document.createElement('button');
    down.className = 'icon-btn';
    down.textContent = '▼';
    down.setAttribute('aria-label', `Move ${layer.label} down`);
    down.addEventListener('click', () => store.moveLayer(layer.id, 1));
    move.append(up, down);
  }

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

/**
 * CÓMO SE AGRUPA EL PANEL.
 *
 * El dibujo propio primero, ya repartido en unidades, trazas y medidas —que es
 * lo que uno enciende y apaga mientras cartografía—, después lo que viene de
 * fuera, y al final los fondos, anidados bajo su propia cabecera: son muchos,
 * se eligen una vez y no tienen por qué ocupar media pantalla cada vez que se
 * abre el panel.
 *
 * `order` existe solo para el dibujo: en el mapa las unidades van DEBAJO, así
 * que en un panel que lista de arriba hacia abajo saldrían las últimas, y
 * nombrarlas en el orden en que se piensa el mapa —unidades, fallas, medidas—
 * se lee mejor que nombrarlas en el orden en que se pintan.
 */
const LAYER_GROUPS = [
  { title: null, kinds: ['units', 'faults', 'dips'], order: ['units', 'faults', 'dips'] },
  { title: 'StraboSpot', kinds: ['strabo'] },
  { title: 'Imported layers', kinds: ['imported'] },
  { title: 'Basemaps', kinds: ['contours', 'hillshade', 'tiles', 'basemap'], nested: true },
];

function groupHeader(title) {
  const li = document.createElement('li');
  li.className = 'layer-group';
  li.textContent = title;
  return li;
}

function renderLayers() {
  const list = $('layer-list');
  const layers = store.getState().layers;

  const live = new Set(layers.map((l) => l.id));
  for (const id of [...layerRows.keys()]) if (!live.has(id)) layerRows.delete(id);
  for (const l of layers) {
    if (!layerRows.has(l.id)) layerRows.set(l.id, layerRow(l));
  }

  const desired = [];
  for (const g of LAYER_GROUPS) {
    let suyas = layers.filter((l) => g.kinds.includes(l.kind));
    if (suyas.length === 0) continue;
    if (g.order) {
      suyas = g.order.map((k) => suyas.find((l) => l.kind === k)).filter(Boolean);
    }
    if (g.title) desired.push(groupHeader(g.title));
    const filas = suyas.map((l) => layerRows.get(l.id).li);
    if (g.nested) {
      // Anidado de verdad: una lista dentro de la lista, sangrada bajo su
      // cabecera, para que se vea que los fondos son un conjunto aparte.
      const nest = document.createElement('li');
      nest.className = 'layer-nest-host';
      const ul = document.createElement('ul');
      ul.className = 'layer-nest';
      ul.append(...filas);
      nest.appendChild(ul);
      desired.push(nest);
    } else {
      desired.push(...filas);
    }
  }

  /*
   * Reordenar sin recrear: recrear mataría el arrastre de un slider en curso.
   * La comparación mira las FILAS y no los envoltorios —las cabeceras y el
   * <li> que anida los fondos se crean nuevos en cada pasada—, así que se
   * compara la lista de filas ya cacheadas, que es lo único que puede cambiar.
   */
  const filasDe = (nodo) =>
    nodo.classList.contains('layer-nest-host') ? [...nodo.firstChild.children] : [nodo];
  const actuales = [...list.children].flatMap(filasDe);
  const buscadas = desired.flatMap(filasDe);
  const mismoOrden =
    actuales.length === buscadas.length &&
    list.children.length === desired.length &&
    buscadas.every((el, i) => actuales[i] === el);
  if (!mismoOrden) list.replaceChildren(...desired);

  layers.forEach((l) => {
    const row = layerRows.get(l.id);
    row.li.classList.toggle('off', !l.visible);
    if (row.cb.checked !== l.visible) row.cb.checked = l.visible;
    if (document.activeElement !== row.range && Number(row.range.value) !== l.opacity) {
      row.range.value = String(l.opacity);
      row.pct.textContent = `${Math.round(l.opacity * 100)}%`;
    }
    // El dibujo no lleva flechas; el resto se queda sin la que no puede usar.
    const i = layers.indexOf(l);
    if (row.up) row.up.disabled = i === 0;
    if (row.down) row.down.disabled = i === layers.length - 1;
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

  /*
   * EDIT NODES. Es la primera sección del menú a propósito: con el elemento
   * ya señalado, corregir por dónde pasa es lo que más se viene a hacer aquí,
   * y llegar por la barra obliga a acertarle otra vez a la geometría.
   *
   * Solo con líneas o polígonos en la selección: una medida de rumbo y manteo
   * es un punto, y no tiene nodos que mover. El botón ancho entra en modo
   * Mover, que es el caso de siempre; los tres chips van directo al modo que
   * se quiera, para poder añadir o borrar sin pasar por Mover.
   */
  const conNodos = [...lines, ...polys];
  if (conNodos.length > 0) {
    const acciones = section(body, 'Edit Nodes');
    const abrirNodos = document.createElement('button');
    abrirNodos.className = 'pill wide';
    abrirNodos.textContent =
      conNodos.length === 1
        ? 'Edit nodes'
        : `Edit nodes (${conNodos.length} features)`;
    abrirNodos.title =
      'Show the vertex handles of the selection and drag them — a midpoint inserts a vertex, a double tap deletes one';
    abrirNodos.addEventListener('click', () => {
      store.setVertexMode('move');
      // Con el relieve 3D puesto esto también entra: ver `DRAWING_TOOLS_3D_OK`.
      store.setTool('vertices');
      closePropsMenu();
    });
    acciones.appendChild(abrirNodos);

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
  }

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

/**
 * Coloca el menú junto al toque, sin salirse de la pantalla y —esto es lo
 * importante— SIN TAPAR EL PUNTO QUE SE TOCÓ.
 *
 * Antes se centraba sobre el toque y se bajaba 18 px, pero con el menú
 * completo (320×460 px) eso lo dejaba encima del cursor en cuanto no cabía
 * hacia abajo y había que subirlo. Tapar el cursor tiene dos consecuencias
 * feas: el siguiente clic, que uno suelta sin mirar, cae sobre un botón del
 * menú; y en Windows —donde Chrome emite el `contextmenu` AL SOLTAR, o sea
 * después de que el menú ya está puesto— el evento llegaba dirigido al menú
 * en vez de al mapa, con las consecuencias que se cuentan en
 * `wireClickOutside`.
 *
 * Se prueban las cuatro esquinas alrededor del cursor, empezando por abajo a
 * la derecha, que es donde uno espera un menú contextual. Si ninguna cabe
 * entera —una pantalla baja con el menú largo—, se pega arriba y se aparta a
 * un lado, que es lo único que sigue dejando el cursor a la vista.
 */
function positionPropsMenu(menu, screen) {
  menu.classList.remove('hidden');
  const { width: w, height: h } = menu.getBoundingClientRect();
  const M = 12; // margen con el borde de la ventana
  const D = 14; // separación con el cursor
  const [px, py] = screen;
  const maxX = window.innerWidth - w - M;
  const maxY = window.innerHeight - h - M;

  for (const [x, y] of [
    [px + D, py + D],
    [px - w - D, py + D],
    [px + D, py - h - D],
    [px - w - D, py - h - D],
  ]) {
    if (x >= M && y >= M && x <= maxX && y <= maxY) {
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      return;
    }
  }

  // No cabe en ninguna esquina: se acota a la ventana y se manda al lado con
  // más sitio, para que el cursor siga fuera del menú.
  const y = Math.max(M, Math.min(py + D, maxY));
  const x = px > window.innerWidth / 2 ? Math.max(M, px - w - D) : Math.min(maxX, px + D);
  menu.style.left = `${Math.max(M, x)}px`;
  menu.style.top = `${y}px`;
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

/* ---------- tipo y unidad, al vuelo ---------- */

/**
 * Cuerpo del cuadro que se abre solo apenas se coloca una medida: elegir tipo
 * de superficie y unidad es lo único que hace falta confirmar de inmediato —el
 * resto del menú de propiedades (números, calidad, espesor) puede esperar a
 * que alguien lo pida—.
 */
function quickTypeUnitBody(f) {
  const body = $('quick-typeunit-body');
  body.replaceChildren();
  const p = f.properties;

  /*
   * Qué se acaba de anotar, antes de preguntar qué es. Con el método Device o
   * con un ajuste sobre el DEM el número no lo escribió nadie: verlo aquí es
   * la única oportunidad de detectar en el acto un rumbo que salió 180° girado
   * —cuando todavía se está delante del afloramiento y se puede repetir— en
   * vez de descubrirlo en casa mirando el mapa.
   */
  const lectura = document.createElement('p');
  lectura.className = 'quick-reading';
  lectura.textContent = `${formatStrikeDip(p.strike, p.dip)} · dips ${quadrant(p.dipAzimuth)}`;
  body.appendChild(lectura);

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
        onClick: () => store.updateMeasurement({ type: t.id }),
      }),
    );
  }
  body.appendChild(tipos);

  if (p.type === 'bedding') {
    const inv = document.createElement('div');
    inv.className = 'palette-row';
    inv.appendChild(
      chip({
        label: 'Overturned',
        glyph: '⤣',
        active: !!p.overturned,
        onClick: () => store.updateMeasurement({ overturned: !p.overturned }),
      }),
    );
    body.appendChild(inv);
  }

  const uni = document.createElement('div');
  unitSelect(uni, store.getState().units, p.unitId ?? null, (id) => store.assignUnitToSelection(id));
  body.appendChild(uni);
}

/** El id de la medida que el cuadro rápido tiene abierta, o `null`. */
let quickTypeUnitFor = null;

export function openQuickTypeUnitMenu(id) {
  const f = store.getState().features.find((x) => x.properties.id === id);
  if (!f) return;
  quickTypeUnitFor = id;
  quickTypeUnitBody(f);
  $('quick-typeunit').classList.remove('hidden');
}

export function closeQuickTypeUnitMenu() {
  quickTypeUnitFor = null;
  $('quick-typeunit').classList.add('hidden');
}

/** La medida sobre la que opera el cuadro rápido, o `null` si está cerrado. */
function quickTypeUnitTarget() {
  return $('quick-typeunit').classList.contains('hidden') ? null : quickTypeUnitFor;
}

/** Refresca los chips activos tras un cambio de tipo/unidad, sin cerrar el cuadro. */
function refreshQuickTypeUnitMenu() {
  if (!quickTypeUnitFor || $('quick-typeunit').classList.contains('hidden')) return;
  const f = store.getState().features.find((x) => x.properties.id === quickTypeUnitFor);
  if (!f) {
    closeQuickTypeUnitMenu();
    return;
  }
  quickTypeUnitBody(f);
}

/* ---------- paneles ---------- */

/** Cajones laterales: solo uno abierto a la vez. */
const DRAWERS = ['layer-panel', 'units-panel', 'symbology-panel', 'strabo-panel'];
/** Paneles flotantes, que se ocultan con `hidden` en vez de con `open`. */
const POPOVERS = [
  'settings',
  'project-menu',
  'topo-menu',
  'scale-menu',
  'map-export-menu',
  'attrs',
  'shortcuts',
  'about',
  'trace-menu',
  'trace-type-menu',
  'import-menu',
  'area-menu',
  'dem-notice',
  'quick-typeunit',
  'gps-required-dialog',
];

/**
 * Elementos que NO cuentan como "fuera" al cerrar por clic.
 *
 * Sin la barra superior, pulsar **Capas** con el panel de Capas abierto se
 * comería el clic: primero lo cerraría este manejador y después el botón lo
 * volvería a abrir, o al revés según el orden. La hoja del perfil va aquí por
 * otro motivo —no se cierra al tocar el mapa a propósito— y la barra de
 * herramientas porque cambiar de herramienta no debería cerrar el panel que se
 * está consultando. `side-actions` es la misma razón que la barra: Deshacer,
 * Rehacer, Hecho, Cancelar y Borrar viven fuera de `#toolbar` desde que
 * tienen su propia columna, pero siguen siendo controles del dibujo en
 * curso, no algo "fuera" de él.
 */
const CLICK_OUTSIDE_EXEMPT = [
  'toolbar',
  'side-actions',
  'palette',
  'profile-sheet',
  'btn-scale',
  'device-panel',
  'stereo-view',
];

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
/**
 * Publica el ancho real de la barra de herramientas como `--toolbar-w`.
 *
 * La barra envuelve en columnas cuando no le cabe todo a lo alto —es lo que
 * evita que se recorten Escala, GPS o Hecho en una tablet apaisada— y por eso
 * su ancho ya no es una constante que se pueda escribir en el CSS. Lo que
 * cuelga a su derecha, hoy la marca, necesita saberlo para no plantarse
 * encima. Se recalcula al girar la tablet y al aparecer o desaparecer un
 * botón, que es cuando puede cambiar el número de columnas.
 *
 * De paso publica `--top-right-h`, el alto real de la fila Project / Layers
 * / ... En PC esa fila y la columna Deshacer/Rehacer/Hecho/Cancelar/Borrar
 * (`.side-actions`) comparten la esquina superior derecha, y la fila
 * envuelve a dos o tres líneas en una ventana angosta —«Con siete botones ya
 * no caben en una fila en el iPad en vertical», dice su propio comentario—,
 * así que un alto fijo en el CSS habría dejado la columna encima de las
 * píldoras en cuanto envuelven. Medido aquí, `.side-actions` siempre se
 * apoya justo debajo, envuelva lo que envuelva.
 */
function wireToolbarWidth() {
  const barra = $('toolbar');
  const marca = document.querySelector('.brand');
  const arriba = document.querySelector('.top-right');
  const acciones = $('side-actions');
  const medir = () => {
    if (barra) {
      const w = Math.round(barra.getBoundingClientRect().width);
      if (w > 0) document.documentElement.style.setProperty('--toolbar-w', `${w}px`);
    }
    if (arriba) {
      const h = Math.round(arriba.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--top-right-h', `${h}px`);
    }
    if (acciones) {
      /*
       * En tablet `.side-actions` cae en la misma esquina inferior derecha
       * que el zoom, la brújula, el GPS y la atribución de MapLibre (ver
       * `.maplibregl-ctrl-bottom-right` en app.css): sin este alto medido, la
       * columna los tapaba enteros.
       */
      const h = Math.round(acciones.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--side-actions-h', `${h}px`);
    }
    if (!marca || !arriba) return;
    /*
     * Y si con ese ancho la marca ya no cabe antes de los botones, se retira.
     * Se mide en limpio —sin la clase puesta— porque lo que hay que saber es
     * si CABRÍA, no si cabe estando escondida.
     */
    marca.classList.remove('crowded');
    const m = marca.getBoundingClientRect();
    if (m.width > 0 && m.right > arriba.getBoundingClientRect().left - 8) {
      marca.classList.add('crowded');
    }
  };
  medir();
  if (typeof ResizeObserver === 'function') {
    if (barra) new ResizeObserver(medir).observe(barra);
    if (arriba) new ResizeObserver(medir).observe(arriba);
    if (acciones) new ResizeObserver(medir).observe(acciones);
  } else {
    window.addEventListener('resize', medir);
  }
}

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
   * EL MENÚ NATIVO NO APARECE SOBRE LA APLICACIÓN. NI SOBRE EL MAPA NI SOBRE
   * LO QUE LA APLICACIÓN ACABA DE PONER ENCIMA DEL MAPA.
   *
   * Esa segunda mitad es la que faltaba, y es la que hacía salir el
   * «Guardar imagen como…» de Chrome al clic derecho sobre una línea o una
   * medida. El motivo es una diferencia de plataforma:
   *
   * - En Linux y macOS, Chrome emite el `contextmenu` con el `mousedown`.
   * - En Windows lo emite al SOLTAR, después del `pointerup`.
   *
   * Y en el `pointerup` es donde se abre el menú de propiedades, colocado
   * junto al cursor. Así que en Windows, cuando llega el `contextmenu`, lo
   * que hay bajo el puntero ya no es el mapa: es el propio menú, que NO
   * cuelga de `map-host`. El manejador se iba por la rama de «esto es de
   * fuera», cerraba el menú recién abierto y dejaba pasar el evento; el
   * navegador, al construir su menú con el nuestro ya oculto, encontraba el
   * lienzo debajo y ofrecía guardar la imagen.
   *
   * De paso se quita el `closeOverlays()`: cerrar aquí no hace falta —el
   * `pointerdown` de más arriba ya cerró lo que hubiera abierto— y era justo
   * lo que se llevaba por delante el menú del elemento.
   *
   * Los campos de texto se quedan con su menú de siempre: ahí el clic derecho
   * es para copiar y pegar, y no hay nada nuestro que ofrecer en su lugar.
   */
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (enCampoDeTexto(e.target)) return;
      // Todo lo demás de la página es la aplicación: el mapa, la barra, los
      // paneles y los menús. En ninguno de ellos el menú del navegador
      // aporta nada.
      e.preventDefault();
    },
    { capture: true },
  );
}

/**
 * ¿El clic cayó en algo donde escribir? Ahí el menú del navegador sigue
 * siendo el bueno: copiar, pegar, deshacer y el corrector.
 */
function enCampoDeTexto(target) {
  if (!target || !target.closest) return false;
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

/** Margen al borde de la pantalla al colocar un volante, en px. */
const FLYOUT_MARGIN = 8;

/**
 * Coloca un volante junto a su botón, en coordenadas de ventana.
 *
 * El lado lo decide la FORMA de la barra y no un punto de quiebre repetido
 * aquí: cuando es columna (PC y tablet) el volante sale a la derecha, y
 * cuando es tira (móvil, al pie) sale por encima. Preguntarle al estilo ya
 * calculado evita que la media query de `app.css` y esta función se
 * contradigan cuando una de las dos cambie.
 *
 * Después se mete dentro de la pantalla a la fuerza. Sin esto, el volante de
 * Topology —siete botones— se salía por abajo en un iPad apaisado y por la
 * derecha en un móvil con el botón cerca del borde.
 */
function placeFlyout(toggle, flyout) {
  const barra = $('toolbar');
  const tira = getComputedStyle(barra).flexDirection === 'row';
  const t = toggle.getBoundingClientRect();

  // Se mide con el volante YA visible: oculto, `display: none` da 0×0 y todo
  // el encaje se calcularía contra una caja que no existe.
  const f = flyout.getBoundingClientRect();
  const maxX = window.innerWidth - f.width - FLYOUT_MARGIN;
  const maxY = window.innerHeight - f.height - FLYOUT_MARGIN;

  const x = tira ? t.left : t.right + 6;
  const y = tira ? t.top - f.height - 6 : t.top;

  flyout.style.left = `${Math.max(FLYOUT_MARGIN, Math.min(x, maxX))}px`;
  flyout.style.top = `${Math.max(FLYOUT_MARGIN, Math.min(y, maxY))}px`;
}

/** El grupo abierto ahora mismo, o null. */
let openFlyout = null;

function closeToolGroups() {
  if (!openFlyout) return;
  $(openFlyout.flyout).classList.remove('open');
  openFlyout = null;
}

function openToolGroup(grupo) {
  closeToolGroups();
  const flyout = $(grupo.flyout);
  flyout.classList.add('open');
  openFlyout = grupo;
  placeFlyout($(grupo.toggle), flyout);
}

/**
 * Abre y cierra los menús volantes de Create y Topology.
 *
 * Van aparte de `wireClickOutside`: ese sistema trata la barra entera como
 * "dentro" —`CLICK_OUTSIDE_EXEMPT` incluye `toolbar`—, así que un clic en
 * Navigate mientras el volante de Create está abierto no lo cerraría por esa
 * vía. Aquí basta con lo mismo que ya usa ese otro sistema: capturar el
 * `pointerdown`, antes de que el propio botón de debajo actúe.
 */
function wireToolGroups() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!openFlyout) return;
      /*
       * El volante ya no cuelga del grupo —vive fuera de la barra para que no
       * lo recorte— así que hay que preguntar por los dos: si solo se mirara
       * el grupo, tocar un botón del volante contaría como "fuera", se
       * cerraría en el `pointerdown` y el `click` nunca llegaría a un botón
       * que para entonces ya está en `display: none`. Es decir: no se podría
       * elegir ninguna herramienta.
       */
      if ($(openFlyout.flyout).contains(e.target) || $(openFlyout.toggle).contains(e.target)) return;
      closeToolGroups();
    },
    { capture: true },
  );

  for (const grupo of Object.values(TOOL_GROUPS)) {
    $(grupo.toggle).addEventListener('click', () => {
      if (openFlyout === grupo) closeToolGroups();
      else openToolGroup(grupo);
    });
    // Elegir una herramienta del volante lo cierra: ya se sabe qué se quería,
    // y dejarlo abierto solo taparía el mapa sin motivo.
    for (const btn of $(grupo.flyout).querySelectorAll('.tool')) {
      btn.addEventListener('click', () => closeToolGroups());
    }
  }

  /*
   * Girar la tablet cambia la barra de columna a tira —y con ella el lado por
   * el que sale el volante—, así que un volante abierto se recoloca. Lo mismo
   * al desplazar la tira: el botón se mueve y el volante se quedaría flotando
   * sobre otro.
   */
  const recolocar = () => {
    if (openFlyout) placeFlyout($(openFlyout.toggle), $(openFlyout.flyout));
  };
  window.addEventListener('resize', recolocar);
  $('toolbar').addEventListener('scroll', recolocar, { passive: true });
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
  /*
   * La traza a medio decidir se va con su diálogo. Dejarla dibujada sin el
   * cuadro que pregunta qué es la convertiría en una línea punteada que no se
   * puede ni guardar ni quitar: existiría solo en la pantalla.
   */
  if (!$('trace-type-menu').classList.contains('hidden')) store.clearPlaneTrace();
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

/**
 * Lleva una capa importada al dibujo.
 *
 * Se pregunta antes porque no es reversible con un botón: la capa desaparece
 * como capa y su estilo QML se pierde: el dibujo tiene una sola simbología. Sí
 * es reversible con Deshacer, y eso se dice, que es lo que de verdad quita el
 * miedo a probarlo.
 */
function adoptLayerInto(layer) {
  const capa = store.getState().imported.find((l) => l.id === layer.id);
  const n = capa ? capa.geojson.features.length : 0;
  if (!n) {
    showBanner('That layer has no features to edit.');
    return;
  }
  const seguir = confirm(
    `Move "${layer.label}" (${n} feature(s)) into the drawing?\n\n` +
      'Every tool will then work on it — vertices, split, merge, reshape, holes — and it ' +
      'will travel in the project and the GeoPackage.\n\n' +
      'It stops being a separate layer, and its QGIS style is replaced by the FieldDraw ' +
      'symbology. Undo puts it back.',
  );
  if (!seguir) return;

  const r = store.adoptImported(layer.id);
  if (!r) return;
  if (r.features.length === 0) {
    showBanner('Nothing in that layer could be turned into drawing features.');
    return;
  }
  const partes = [];
  if (r.stats.lines) partes.push(`${r.stats.lines} line(s)`);
  if (r.stats.polygons) partes.push(`${r.stats.polygons} polygon(s)`);
  if (r.stats.points) partes.push(`${r.stats.points} measurement(s)`);
  const resumen = `${partes.join(', ')} from "${layer.label}" are now editable.`;
  showBanner(r.warnings.length ? `${resumen} ${r.warnings.join(' ')}` : resumen, 'info');
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

/**
 * Abre el perfil estructural desde el topográfico que ya está calculado.
 *
 * La traza es la MISMA línea, no una nueva: la topografía del corte y la del
 * perfil tienen que ser la misma, y volver a muestrear el DEM para la misma
 * sección sería pedirle a la red lo que ya se tiene.
 */
function openSectionFromProfile() {
  const st = store.getState();
  const perfil = st.profile;
  if (!perfil || !perfil.coords || perfil.coords.length < 2) {
    showBanner('Draw a profile line first: the section is built on it.');
    return;
  }

  /*
   * Con selección se proyecta lo seleccionado y sin límite de distancia: quien
   * eligió con el lazo ya decidió qué le interesa. Sin selección se toman todas
   * las medidas dentro de dos kilómetros del corte, porque proyectar un manteo
   * tomado a veinte no es un dato.
   */
  const seleccionadas = store
    .selectedFeatures()
    .filter((f) => f.geometry.type === 'Point' && f.properties.geomKind === 'measurement')
    .map((f) => f.properties.id);

  store.requestSection({
    coords: perfil.coords,
    measurementIds: seleccionadas.length ? seleccionadas : null,
    maxOffset: seleccionadas.length ? null : DEFAULT_MAX_OFFSET_M,
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
  $('t-scale').classList.toggle('active', !!fijada);
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

  renderScreenSection(s.scalePixelMm);
}

/**
 * Lo que el dispositivo SÍ cuenta de su pantalla.
 *
 * Resolución en píxeles CSS y cuántos píxeles físicos hay detrás de cada uno.
 * El tamaño del vidrio no está en esta lista porque no existe ninguna API que
 * lo dé: es justo el dato que hay que preguntar.
 *
 * Se lee de `window.screen` y no del tamaño de la ventana a propósito. La
 * ventana se redimensiona —media pantalla, split view en el iPad— y el píxel
 * no cambia de tamaño por eso; la pantalla es la que tiene una diagonal fija
 * que el usuario puede ir a medir.
 */
function detectScreen() {
  const w = Math.round(window.screen && window.screen.width ? window.screen.width : 0);
  const h = Math.round(window.screen && window.screen.height ? window.screen.height : 0);
  const dpr = Number(window.devicePixelRatio) || 1;
  return { w, h, dpr, ok: w > 0 && h > 0 };
}

/** Rellena, una sola vez, la lista de tamaños estándar. */
function fillScreenSizes() {
  const sel = $('scale-screen-preset');
  if (sel.options.length) return;
  const nada = document.createElement('option');
  nada.value = '';
  nada.textContent = 'OGC standard pixel (0.28 mm)';
  sel.appendChild(nada);
  for (const s of SCREEN_SIZES) {
    const o = document.createElement('option');
    o.value = String(s.inches);
    o.textContent = s.label;
    sel.appendChild(o);
  }
}

/**
 * La parte de "esta pantalla" del desplegable.
 *
 * Los tres controles dicen lo mismo de tres maneras y por eso se mantienen
 * sincronizados: elegir 15,6" escribe el milímetro correspondiente, y escribir
 * un milímetro a mano deja marcada la diagonal que lo produce, si es una de la
 * lista. Sin eso, el panel mostraría a la vez un tamaño elegido y un píxel que
 * no se corresponde con él, y no habría manera de saber cuál manda.
 */
function renderScreenSection(pixelMm) {
  fillScreenSizes();
  const sc = detectScreen();

  $('scale-screen-detected').textContent = sc.ok
    ? `Detected: ${sc.w} × ${sc.h} CSS pixels at ${sc.dpr.toFixed(2)}× device ratio (${Math.round(sc.w * sc.dpr)} × ${Math.round(sc.h * sc.dpr)} real pixels). How big the glass is, no browser will say.`
    : 'This browser does not report the screen resolution; use the ruler below.';

  const diagonal = sc.ok ? diagonalFromPixelMm(pixelMm, sc.w, sc.h) : null;

  const campo = $('scale-screen-diagonal');
  if (document.activeElement !== campo) campo.value = diagonal === null ? '' : String(diagonal);

  const sel = $('scale-screen-preset');
  const estandar = Math.abs(pixelMm - STANDARD_PIXEL_MM) < 0.0005;
  // La coincidencia con la lista se juzga con holgura: 15,6" y 15,61" son la
  // misma pantalla, y exigir igualdad exacta dejaría el desplegable en blanco
  // justo después de haber elegido en él.
  const match = estandar || diagonal === null
    ? null
    : SCREEN_SIZES.find((s) => Math.abs(s.inches - diagonal) < 0.15);
  sel.value = match ? String(match.inches) : '';

  const bar = $('scale-ruler');
  const ancho = bar.getBoundingClientRect().width || bar.offsetWidth;
  const mm = ancho * pixelMm;
  $('scale-ruler-label').textContent = mm > 0 ? `${mm.toFixed(1)} mm` : '—';
  $('scale-ruler-hint').textContent =
    'Check it with a real ruler. With the pixel size above, this bar claims to measure:';
  const campoRegla = $('scale-ruler-mm');
  if (document.activeElement !== campoRegla) campoRegla.placeholder = mm > 0 ? mm.toFixed(1) : '';
  // El ancho medido es el que hay que devolverle a la calibración; el panel
  // puede estar más angosto en una tablet en vertical que en un monitor.
  bar.dataset.mm = String(mm);
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
  const abrir = () => {
    togglePanel('scale-menu');
    if (!$('scale-menu').classList.contains('hidden')) renderScaleMenu();
  };
  // Dos puertas al mismo panel: la píldora del pie, que además muestra la
  // escala vigente, y el botón de la barra, que es donde se busca cuando lo
  // que se quiere es FIJARLA antes de empezar a dibujar.
  $('btn-scale').addEventListener('click', abrir);
  $('t-scale').addEventListener('click', abrir);
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

  /* --- el tamaño de esta pantalla --- */

  const desdeDiagonal = (pulgadas) => {
    const sc = detectScreen();
    if (!sc.ok) {
      showBanner('This browser does not report the screen resolution; use the ruler instead.');
      return;
    }
    const mm = pixelMmFromDiagonal(pulgadas, sc.w, sc.h);
    if (mm === null) {
      showBanner('That is not a screen diagonal. Type it in inches, like 15.6.');
      return;
    }
    store.setScalePixelMm(mm);
    renderScaleMenu();
    showBanner(
      `A ${pulgadas}″ screen at ${sc.w} × ${sc.h} puts one pixel at ${mm.toFixed(3)} mm. The map now measures what it says — but it no longer matches QGIS, which assumes 0.28 mm.`,
      'info',
    );
  };

  $('scale-screen-preset').addEventListener('change', (e) => {
    const v = e.target.value;
    // La entrada vacía es el píxel estándar, que es una decisión y no un
    // "sin elegir": vuelve al supuesto de la OGC.
    if (!v) {
      store.setScalePixelMm(STANDARD_PIXEL_MM);
      renderScaleMenu();
      return;
    }
    desdeDiagonal(Number(v));
  });

  const aplicarDiagonal = () => desdeDiagonal(Number($('scale-screen-diagonal').value));
  $('scale-screen-apply').addEventListener('click', aplicarDiagonal);
  $('scale-screen-diagonal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') aplicarDiagonal();
  });

  const calibrar = () => {
    const medido = Number($('scale-ruler-mm').value);
    const nominal = Number($('scale-ruler').dataset.mm);
    const mm = calibratePixelMm(store.getState().scalePixelMm, medido, nominal);
    if (mm === null) {
      showBanner('That reading does not fit any screen. Measure the bar in millimetres.');
      return;
    }
    store.setScalePixelMm(mm);
    $('scale-ruler-mm').value = '';
    renderScaleMenu();
    showBanner(
      `Calibrated: one pixel is ${mm.toFixed(3)} mm on this screen, so the scale bar now measures what it says.`,
      'info',
    );
  };
  $('scale-ruler-apply').addEventListener('click', calibrar);
  $('scale-ruler-mm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') calibrar();
  });
}

/** Cuánto dura un aviso en pantalla antes de desvanecerse solo, en ms. */
const BANNER_TIMEOUT_MS = 10000;
/** Cuánto tarda el desvanecimiento en sí, para no ocultarlo antes de que acabe. */
const BANNER_FADE_MS = 600;

let bannerFadeTimer = null;
let bannerHideTimer = null;

/**
 * Lo que hay que deshacer cuando el aviso de ahora desaparezca.
 *
 * Existe por el espesor estratigráfico: mientras su resultado está en pantalla
 * el mapa dibuja la línea punteada entre las dos superficies y el punto
 * auxiliar desde el que se midió, y eso solo tiene sentido mientras se está
 * leyendo el número. Cerrado el aviso, es basura sobre el dibujo.
 */
let bannerCleanup = null;

function runBannerCleanup() {
  const fn = bannerCleanup;
  bannerCleanup = null;
  if (fn) fn();
}

export function showBanner(text, variant = 'warn', { onDismiss = null } = {}) {
  const el = $('banner');
  // Un aviso nuevo se lleva por delante al anterior, así que lo que aquel
  // dejara pendiente de limpiar se limpia ahora y no cuando caduque su reloj.
  runBannerCleanup();
  bannerCleanup = onDismiss;

  $('banner-text').textContent = text;
  el.classList.remove('hidden', 'fade-out');
  el.classList.toggle('info', variant === 'info');

  // Un aviso nuevo cancela el reloj del anterior: los diez segundos son desde
  // que ESTE se leyó, no un resto del que estaba puesto antes.
  clearTimeout(bannerFadeTimer);
  clearTimeout(bannerHideTimer);
  bannerFadeTimer = setTimeout(() => {
    el.classList.add('fade-out');
    bannerHideTimer = setTimeout(() => {
      el.classList.add('hidden');
      runBannerCleanup();
    }, BANNER_FADE_MS);
  }, BANNER_TIMEOUT_MS);
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

/* ---------- la lámina del mapa ---------- */

/**
 * Escribe la vista del mapa como lámina.
 *
 * Todo el trabajo está en otros dos módulos —`mapFrame` compone y `mapExport`
 * escribe—; aquí solo se recogen las opciones del panel, se avisa de lo que el
 * usuario tiene que saber y se entrega el archivo.
 */
async function doExportMapImage(format) {
  if (!mapBridge || !mapBridge.captureForExport) return;
  const titulo = $('map-export-title').value.trim();
  const credito = $('map-export-credit').value.trim();
  const escala = Number($('map-export-scale').value) || 2;

  setBusy('Composing the sheet…');
  try {
    const view = await mapBridge.captureForExport();
    const { blob, filename, layout } = await exportMapImage(view, {
      format,
      title: titulo,
      scale: escala,
      credit: credito || undefined,
    });
    downloadBlob(blob, filename);

    const mm = pageSizeMm(layout);
    const aviso = view.flattened
      ? ' Taken in plan view: tilted, a map has no single scale and no honest coordinate frame.'
      : '';
    showBanner(
      `Map exported as ${format.toUpperCase()}, ${mm.width}\u2009\u00D7\u2009${mm.height} mm on paper.${aviso}`,
      'info',
    );
  } catch (err) {
    showBanner(`Could not export the map view: ${err && err.message ? err.message : err}`);
  } finally {
    setBusy(null);
  }
}

/** Lo que el panel dice del encuadre de ahora, antes de exportar nada. */
function renderMapExportNote() {
  const nota = $('map-export-note');
  if (!nota) return;
  const s = store.getState();
  const partes = [];
  if (Number.isFinite(escalaActual)) partes.push(`Now showing ${formatScale(escalaActual)}.`);
  if (s.terrain3d) {
    partes.push('3D terrain is on: the sheet will be taken flat, from directly above.');
  }
  nota.textContent = partes.join(' ');
}

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
    await rememberImported(id, 'tiles', file);
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
 * Cambia de herramienta.
 *
 * Queda como envoltorio de `setTool` —y no como llamada directa— porque el
 * despachador de teclas y el botón de Hueco pasan por aquí: es el único sitio
 * donde meter un aviso si alguna herramienta vuelve a poder rechazarse. Hoy
 * ninguna lo hace.
 */
function pickTool(tool) {
  if (store.setTool(tool) === false) {
    showBanner(
      'Not available while 3D terrain is on: on tilted ground the point you click is not the point on the map. Line and Polygon still work here. Press 3 to go back to plan view.',
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
  // El perfil estructural y el estereograma tapan la pantalla entera: son lo
  // primero que hay que poder cerrar, antes que cualquier panel que quedara
  // debajo.
  if (store.getState().section) {
    store.clearSection();
    return;
  }
  if (isStereogramOpen()) {
    closeStereogram();
    return;
  }
  if (anyOverlayOpen()) {
    closeOverlays();
    return;
  }
  // Un volante de la barra también es algo abierto por encima del mapa, y va
  // antes que descartar el trazo: cerrar un menú no debería costar el dibujo.
  if (openFlyout) {
    closeToolGroups();
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

    'camera-pan': (e) => {
      const dir = ARROW_DIR[String(e.key || '').toLowerCase()];
      if (dir && mapBridge) mapBridge.camera.panBy(dir[0] * PAN_STEP_PX, dir[1] * PAN_STEP_PX);
    },
    'camera-orbit': (e) => {
      const dir = ARROW_DIR[String(e.key || '').toLowerCase()];
      if (dir && mapBridge) mapBridge.camera.orbit(dir[0] * BEARING_STEP, -dir[1] * PITCH_STEP);
    },
    'camera-zoom-in': () => mapBridge && mapBridge.camera.zoom(1),
    'camera-zoom-out': () => mapBridge && mapBridge.camera.zoom(-1),
    'camera-reset': () => mapBridge && mapBridge.camera.reset(),
  };
}

/* ---------- cámara desde el teclado ---------- */

/*
 * Los mismos pasos que usa MapLibre con su propio teclado, para que quien ya
 * conozca un visor no tenga que aprender otros. La flecha mueve la cámara, no
 * el mapa: pulsar → enseña lo que hay a la derecha.
 */
const PAN_STEP_PX = 100;
const BEARING_STEP = 15; // grados
const PITCH_STEP = 10; // grados

/** Flecha → vector de pantalla. Arriba es -Y, como en el DOM. */
const ARROW_DIR = {
  arrowup: [0, -1],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
};

/* ---------- About ---------- */

/** Un párrafo de ayuda, que es el formato en el que habla el resto de paneles. */
function aboutHint(parent, texto, cls = 'hint') {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = texto;
  parent.appendChild(p);
  return p;
}

function aboutSection(parent, titulo) {
  const h = document.createElement('span');
  h.className = 'palette-label';
  h.textContent = titulo;
  parent.appendChild(h);
}

/**
 * Pinta el panel «About» desde `src/version.js`.
 *
 * Se dibuja una sola vez, al arrancar: ni la versión ni el registro de
 * cambios dependen de nada que pase durante la sesión.
 */
function renderAbout() {
  const body = $('about-body');
  body.replaceChildren();

  const version = document.createElement('p');
  version.className = 'about-version';
  version.textContent = `v${APP_VERSION} ${APP_STAGE}`;
  body.appendChild(version);

  aboutHint(body, `${APP_AUTHOR} · ${APP_ORG} · 2026`);

  aboutHint(
    body,
    'Versión beta: gratuita para uso académico y docente, sin uso comercial. ' +
      'Está en desarrollo, así que conviene guardar el proyecto seguido y no ' +
      'confiarle el único respaldo de una campaña.',
  );
  aboutHint(body, 'Implementada con asistencia de inteligencia artificial.');

  // El correo es lo que se viene a buscar cuando algo falla en terreno, así
  // que va enlazado y no como texto suelto que haya que copiar a mano.
  const contacto = document.createElement('p');
  contacto.className = 'hint';
  contacto.append(document.createTextNode('Errores y sugerencias: '));
  const mail = document.createElement('a');
  mail.href = `mailto:${APP_CONTACT}?subject=${encodeURIComponent(`FieldDraw v${APP_VERSION} — reporte`)}`;
  mail.textContent = APP_CONTACT;
  contacto.appendChild(mail);
  body.appendChild(contacto);

  aboutSection(body, 'Herramientas');
  const tools = document.createElement('dl');
  tools.className = 'about-tools';
  for (const [nombre, texto] of APP_TOOLS) {
    const dt = document.createElement('dt');
    dt.textContent = nombre;
    const dd = document.createElement('dd');
    dd.textContent = texto;
    tools.append(dt, dd);
  }
  body.appendChild(tools);

  aboutSection(body, 'Novedades');
  for (const entrada of CHANGELOG) {
    const h = document.createElement('p');
    h.className = 'about-release';
    h.textContent = `v${entrada.version}`;
    body.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'about-list';
    for (const item of entrada.items) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
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
    't-scale': 'panel-scale',
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
    const id = shortcutFor(e);
    if (!id) return;
    // Mover la vista vale mantenido; cambiar de herramienta, no.
    if (e.repeat && !repeatsAllowed(id)) return;

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
    fn(e);
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
  // El DEM propio manda cuando está elegido: es el único que puede tener
  // metros donde los demás tienen decenas.
  if (state.profileSource === 'imported' && state.demSet) {
    return demSamplerFor(state.demSet);
  }
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
  downloadText(profileCSV(result), `${profileBaseName()}.csv`, 'text/csv;charset=utf-8');
}

/** Nombre de archivo de las salidas del perfil: la fecha basta para ordenarlas. */
function profileBaseName() {
  return `profile-${new Date().toISOString().slice(0, 10)}`;
}

/**
 * La figura se exporta en claro aunque la app se vea en oscuro.
 *
 * Un perfil guardado termina en un informe, en una diapositiva o pegado en un
 * Word, y ahí el fondo es blanco: un PNG de fondo negro obliga a rehacerlo.
 * Quien lo quiera oscuro tiene el SVG, donde cambiar dos colores es trivial.
 */
const PROFILE_FIGURE = { width: 1200, height: 560, theme: 'light' };

function downloadProfileSVG() {
  const result = store.getState().profile;
  if (!result) return;
  downloadBlob(
    new Blob([profileSVG(result, PROFILE_FIGURE)], { type: 'image/svg+xml' }),
    `${profileBaseName()}.svg`,
  );
  showBanner('Profile saved as SVG — editable in Illustrator or Inkscape.', 'info');
}

async function downloadProfilePNG() {
  const result = store.getState().profile;
  if (!result) return;
  setBusy('Rendering the figure…');
  try {
    const blob = await profilePNG(result, { ...PROFILE_FIGURE, scale: 2 });
    downloadBlob(blob, `${profileBaseName()}.png`);
    showBanner('Profile saved as a 2400 × 1120 PNG, ready to drop into a report.', 'info');
  } catch (err) {
    showBanner(`Could not render the figure: ${err.message}`);
  } finally {
    setBusy(null);
  }
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

/** Corta la escucha de sensores en curso, si hay una. */
let stopDeviceCapture = null;
/** La brújula del panel Device, construida una sola vez sobre su `<svg>`. */
let deviceCompass = null;

/**
 * El método Device ancla la medida en la posición del GPS, así que sin GPS
 * activo no tiene dónde ponerla. Se comprueba ANTES de arrancar los sensores
 * —pedir permiso de orientación para nada, si total no se va a poder guardar
 * la medida, sería un permiso pedido de más— y otra vez al apretar Done, por
 * si el GPS se apagó mientras tanto.
 */
function gpsReadyForDevice() {
  return !!(mapBridge && mapBridge.isGpsActive());
}

function openGpsRequiredDialog() {
  openPanel('gps-required-dialog');
}

/**
 * Arranca o corta la escucha del giroscopio/magnetómetro, y muestra u oculta
 * el panel de la brújula, según si la herramienta de medir está activa con el
 * método 'device'. Vive fuera del store porque hablar con
 * `DeviceOrientationEvent` y con el GPS es asunto de la capa de aplicación,
 * no del estado.
 */
function syncDeviceCapture() {
  const s = store.getState();
  const quiere = s.tool === 'measure' && s.measureMethod === 'device';

  if (!quiere) {
    if (stopDeviceCapture) {
      stopDeviceCapture();
      stopDeviceCapture = null;
      store.setDeviceReading(null);
    }
    $('device-panel').classList.add('hidden');
    return;
  }

  if (!gpsReadyForDevice()) {
    // Se revierte al método manual y se explica por qué en vez de dejar la
    // herramienta puesta en un método que no va a poder guardar nada.
    store.setMeasureMethod('manual');
    openGpsRequiredDialog();
    return;
  }

  $('device-panel').classList.remove('hidden');
  if (!deviceCompass) deviceCompass = buildCompass($('device-compass'));
  renderDevicePanel();

  if (stopDeviceCapture) return; // ya está escuchando

  const begin = () => {
    // Puede haber cambiado de herramienta o de método mientras se esperaba
    // el permiso; no arrancar la escucha sobre un estado que ya no aplica.
    const st = store.getState();
    if (st.tool !== 'measure' || st.measureMethod !== 'device') return;
    stopDeviceCapture = startOrientationCapture({
      onReading: (r) => store.setDeviceReading(r),
      onError: (msg) => {
        showBanner(msg, 'warn');
        store.setMeasureMethod('manual');
      },
    });
  };

  if (!deviceOrientationSupported()) {
    showBanner('This device or browser has no orientation sensor available.', 'warn');
    store.setMeasureMethod('manual');
    return;
  }

  if (needsOrientationPermission()) {
    requestOrientationPermission().then((granted) => {
      if (granted) begin();
      else {
        showBanner(
          'Motion & orientation access was not granted. Allow it in Settings to read the device sensors.',
          'warn',
        );
        store.setMeasureMethod('manual');
      }
    });
  } else {
    begin();
  }
}

/** Refresca la aguja, el texto y el botón Done del panel Device. */
function renderDevicePanel() {
  if ($('device-panel').classList.contains('hidden')) return;
  const r = store.getState().deviceReading;
  if (deviceCompass) deviceCompass.update(r);

  const fix = mapBridge && mapBridge.getGpsFix();
  const note = $('device-gps-note');
  if (!fix) {
    note.textContent = 'Waiting for a GPS fix…';
  } else {
    note.textContent = `GPS fix: ±${Math.round(fix.accuracy)} m`;
  }
  // El mismo consejo que da la pestaña Compass, palabra por palabra: los dos
  // sitios leen los mismos sensores y no pueden discrepar sobre si la lectura
  // vale (ver `compassHint`).
  $('device-read-note').textContent = compassHint(r);

  const listo = !!(r && r.ready) && !!fix;
  const boton = $('btn-device-done');
  boton.disabled = !listo;
  boton.textContent = listo ? 'Add measurement' : 'Hold steady…';
}

/**
 * Botón Done del panel Device: crea la medida en la posición GPS actual, con
 * la lectura acumulada de los sensores. No hay toque en el mapa que valga
 * aquí — es el mismo motivo por el que el manteo se lee apoyando el teléfono
 * contra la roca y no mirando dónde cae el dedo.
 */
function commitDeviceReading() {
  const r = store.getState().deviceReading;
  const fix = mapBridge && mapBridge.getGpsFix();
  if (!fix) {
    openGpsRequiredDialog();
    return;
  }
  if (!r || !r.ready) {
    showBanner('Still reading — hold the phone still against the surface a moment longer.', 'warn');
    return;
  }
  store.createMeasurement({
    lngLat: fix.lngLat,
    strike: r.strike,
    dip: r.dip,
    dipAzimuth: r.dipAzimuth,
    method: 'device',
    quality: {
      strikeSd: round1(r.strikeSd),
      dipSd: round1(r.dipSd),
      // Dispersión angular del polo en la tanda: es la cifra que de verdad
      // dice si el teléfono estaba quieto, y viaja con el dato porque sin ella
      // nadie puede volver a juzgar la medida meses después.
      poleSpread: round1(r.spread),
      n: r.n,
      gpsAccuracy: Math.round(fix.accuracy),
    },
  });
}

/**
 * Color único de lo traído de StraboSpot. La casilla y el selector van juntos:
 * apagarla no borra el color elegido, solo deja de aplicarlo, así que volver a
 * encenderla devuelve el mismo mapa de antes.
 */
function syncImportControls() {
  const st = store.getState().importStyle;
  $('import-uniform').checked = st.uniform;
  const color = $('import-color');
  if (document.activeElement !== color) color.value = st.color;
  color.disabled = !st.uniform;
}

function wireImportControls() {
  $('import-uniform').addEventListener('change', (e) =>
    store.setImportStyle({ uniform: e.target.checked }),
  );
  $('import-color').addEventListener('input', (e) =>
    store.setImportStyle({ color: e.target.value }),
  );
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
    // De qué modelo salió el número, que es lo que decide cuánto vale.
    showDemNotice(pending.method === 'three-point' ? 'That three-point plane' : 'That fitted plane');
  } catch (err) {
    showBanner(err.message);
    store.clearPendingPlane();
  } finally {
    setBusy(null);
    planeBusy = false;
  }
}

let thicknessBusy = false;

/**
 * Espesor estratigráfico entre la medida elegida y el punto marcado.
 *
 * Las dos cotas salen del DEM —también la del punto donde está la medida, que
 * el símbolo no guarda— y por eso esto es asíncrono, igual que el perfil.
 */
async function runThickness(pending) {
  if (thicknessBusy) {
    store.clearPendingThickness();
    showBanner('Still reading the elevations of the previous measurement.');
    return;
  }
  const { from, to } = pending || {};
  if (!from || !to) {
    store.clearPendingThickness();
    return;
  }

  thicknessBusy = true;
  const st = store.getState();
  setBusy('Reading elevations…');
  try {
    const sampler = samplerFor(st);
    if (sampler.loadGrid) await sampler.loadGrid([from.lngLat, to]);
    const [zBase, zTecho] = await Promise.all([
      sampler.elevationAt(from.lngLat[0], from.lngLat[1]),
      sampler.elevationAt(to[0], to[1]),
    ]);

    const dem = OPENTOPO_DEM_BY_ID.get(st.opentopoDem);
    const nominal = st.profileSource === 'opentopo' && dem ? dem.nominal : TERRARIUM_NOMINAL_M;

    /*
     * La incertidumbre de la orientación sale de la propia medida cuando se
     * calculó sobre el modelo; si se tomó con brújula, del error típico de una
     * lectura de campo. Usar cero en ese caso daría un margen falsamente
     * estrecho, que es la manera de mentir con una barra de error.
     */
    const q = from.quality || {};
    const sigmaStrike = Number.isFinite(Number(q.strikeSd)) ? Number(q.strikeSd) : COMPASS_STRIKE_SIGMA_DEG;
    const sigmaDip = Number.isFinite(Number(q.dipSd)) ? Number(q.dipSd) : COMPASS_DIP_SIGMA_DEG;

    const r = measureThickness({
      base: { lngLat: from.lngLat, elevation: zBase },
      top: { lngLat: to, elevation: zTecho },
      strike: from.strike,
      dip: from.dip,
      resolution: nominal,
      sigmaStrike,
      sigmaDip,
    });
    if (!r.ok) {
      showBanner(r.reason);
      store.clearPendingThickness();
      return;
    }

    store.setThickness({
      ...r,
      from: from.lngLat,
      to,
      elevations: [zBase, zTecho],
      demSource: st.profileSource,
    });

    /*
     * El dibujo auxiliar —la línea punteada entre las dos superficies y el
     * punto desde el que se midió— vive lo que vive el aviso. Es lo que
     * explica el número mientras se lee; en cuanto el aviso se va, sin nada
     * que lo nombre, queda como un trazo suelto sobre la carta que además no
     * se puede seleccionar ni borrar como los demás.
     */
    const resumen = `True thickness ${formatMetres(r.thickness)} ±${formatMetres(r.sd)} · ${Math.round(r.separation)} m apart, ${Math.round(r.obliquity)}° off the bedding normal.`;
    const limpiar = { onDismiss: () => store.clearThickness() };
    if (r.warnings.length) showBanner(`${resumen} ${r.warnings.join(' ')}`, 'warn', limpiar);
    else showBanner(resumen, 'info', limpiar);
  } catch (err) {
    showBanner(err.message);
    store.clearPendingThickness();
  } finally {
    setBusy(null);
    thicknessBusy = false;
  }
}

/* ---------- de qué modelo de elevación salen los números ---------- */

const DEM_NOTICE_MUTE_KEY = 'fielddraw.demNotice.muted';

function demNoticeMuted() {
  try {
    return localStorage.getItem(DEM_NOTICE_MUTE_KEY) === '1';
  } catch {
    // Safari en privado lanza al leer; el aviso simplemente se enseña.
    return false;
  }
}

/**
 * Formatos de elevación que se pueden traer de fuera, de mejor a peor.
 *
 * **PMTiles con teselas Terrain-RGB es el formato**, y la respuesta no es de
 * gusto sino de lo que un navegador puede hacer sin ayuda:
 *
 * - Es **un solo archivo** y se lee por **rangos HTTP**: se baja el pedazo que
 *   se está mirando y nada más. Un GeoTIFF de una hoja entera hay que cargarlo
 *   completo en memoria antes de poder leer una cota — en una tablet eso es la
 *   diferencia entre funcionar y quedarse sin RAM.
 * - Viene **piramidado**: cada zoom tiene su propio nivel ya remuestreado, que
 *   es justo lo que necesitan tanto el relieve como las curvas de nivel.
 * - Sus teselas son **PNG Terrain-RGB**, el mismo empaquetado que ya decodifica
 *   la app para el DEM de AWS. No hace falta ni un decodificador nuevo ni una
 *   dependencia más, que en un proyecto sin `node_modules` no es un detalle.
 * - Y la app **ya lo abre**: es el formato con el que se llevan los mapas base
 *   a terreno.
 *
 * MBTiles sirve igual de bien salvo por una cosa que importa en tablet: es
 * SQLite y se carga entero en memoria. Para un DEM de una zona de trabajo
 * pequeña da lo mismo; para una región, no.
 */
const DEM_IMPORT_FORMATS = [
  {
    ext: '.pmtiles',
    label: 'PMTiles con teselas Terrain-RGB',
    note: 'un archivo, leído por rangos: es el que conviene',
  },
  {
    ext: '.mbtiles',
    label: 'MBTiles con teselas Terrain-RGB',
    note: 'igual de bueno, pero se carga entero en memoria',
  },
];

/**
 * Qué modelo está en uso ahora mismo y qué resolución tiene.
 * @returns {{label: string, nominal: number, offline: boolean}}
 */
function demInUse(st) {
  if (st.profileSource === 'imported' && st.demSet) {
    const s = demSamplerFor(st.demSet);
    return { label: `${s.label} (imported)`, nominal: Math.round(s.nominal), offline: true };
  }
  if (st.profileSource === 'opentopo') {
    const dem = OPENTOPO_DEM_BY_ID.get(st.opentopoDem);
    return {
      label: dem ? `${dem.label} (OpenTopography)` : 'OpenTopography',
      nominal: dem ? dem.nominal : 30,
      offline: false,
    };
  }
  return { label: 'AWS Terrain Tiles', nominal: TERRARIUM_NOMINAL_M, offline: true };
}

/**
 * Avisa de con qué modelo se acaba de calcular, y de qué vale por eso.
 *
 * Se enseña después de ajustar un plano y después de proyectar una traza: son
 * las dos cuentas en las que la resolución del DEM NO es un detalle de fondo
 * sino el límite del resultado. Un manteo sacado de una base de cien metros
 * sobre celdas de treinta arrastra varios grados de error, y una traza a un
 * kilómetro los amplifica todo lo que haga falta.
 *
 * Se puede callar para siempre, porque quien ya lo sabe no necesita leerlo en
 * cada medida; pero se enseña por omisión, porque quien no lo sabe está
 * citando un número sin su letra pequeña.
 */
function showDemNotice(contexto) {
  if (demNoticeMuted()) return;
  const st = store.getState();
  const dem = demInUse(st);

  $('dem-notice-source').textContent =
    `${contexto} used ${dem.label}, about ${dem.nominal} m per cell${dem.offline ? ' — the same tiles that draw the contour lines, so it works with no signal' : ''}.`;
  $('dem-notice-effect').textContent =
    `A ${dem.nominal} m cell is the floor on what any of this can resolve: a dip fitted over a base shorter than two cells is noise, and every metre of vertical error moves a projected trace sideways by that metre divided by the tangent of the dip.`;

  const advice = $('dem-notice-advice');
  advice.replaceChildren();
  const h = document.createElement('span');
  h.className = 'palette-label';
  h.textContent = 'A finer model, if you have one';
  advice.appendChild(h);

  const lista = document.createElement('div');
  lista.className = 'hint';
  lista.textContent =
    'A LiDAR or photogrammetric DEM of the survey area — 1 to 5 m — changes what these numbers are worth. Bring it in as Terrain-RGB tiles:';
  advice.appendChild(lista);

  for (const f of DEM_IMPORT_FORMATS) {
    const fila = document.createElement('div');
    fila.className = 'attrs-row';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = f.ext;
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = f.note;
    fila.append(k, v);
    advice.appendChild(fila);
  }

  $('dem-notice-mute').checked = false;
  openPanel('dem-notice');
}

function wireDemNotice() {
  $('btn-close-dem-notice').addEventListener('click', () =>
    $('dem-notice').classList.add('hidden'),
  );
  $('dem-notice-import').addEventListener('click', () => {
    $('dem-notice').classList.add('hidden');
    $('file-gpkg').click();
  });
  $('dem-notice-mute').addEventListener('change', (e) => {
    try {
      if (e.target.checked) localStorage.setItem(DEM_NOTICE_MUTE_KEY, '1');
      else localStorage.removeItem(DEM_NOTICE_MUTE_KEY);
    } catch {
      /* sin almacenamiento el aviso seguirá saliendo, que es el lado seguro */
    }
  });
}

/* ---------- traza de un plano sobre el terreno ---------- */

/**
 * La medida desde la que se está proyectando. Se guarda porque el cálculo es
 * asíncrono y el menú de propiedades ya se cerró cuando termina.
 */
let traceFrom = null;
let traceBusy = false;

/** La resolución real del modelo en uso: decide el paso y el detalle posible. */
function demResolution(st) {
  const dem = OPENTOPO_DEM_BY_ID.get(st.opentopoDem);
  return st.profileSource === 'opentopo' && dem ? dem.nominal : TERRARIUM_NOMINAL_M;
}

/**
 * Abre el diálogo de la traza para una medida concreta.
 *
 * Los dos rótulos se escriben con el cuadrante hacia el que va cada lado —«NE»
 * y «SW», no «adelante» y «atrás»—: sobre el terreno uno sabe hacia dónde
 * quiere estirar el contacto, y no hacia qué extremo arbitrario de un vector.
 */
function openTraceMenu(medida) {
  const p = medida.properties;
  const strike = Number(p.strike);
  const dip = Number(p.dip);
  const az = Number.isFinite(Number(p.dipAzimuth)) ? Number(p.dipAzimuth) : strike + 90;
  const rumbo = ((az - 90) % 360 + 360) % 360;

  traceFrom = {
    id: p.id,
    origin: medida.geometry.coordinates.slice(0, 2),
    strike: rumbo,
    dip,
    dipAzimuth: az,
    type: p.type,
  };

  $('trace-from').textContent =
    `From ${formatStrikeDip(rumbo, dip)} (dip ${quadrant(az)}). The trace runs along strike from this point.`;
  $('trace-back-label').textContent = `Toward ${quadrant((rumbo + 180) % 360)} (${Math.round((rumbo + 180) % 360)}°)`;
  $('trace-forward-label').textContent = `Toward ${quadrant(rumbo)} (${Math.round(rumbo)}°)`;
  $('trace-back').value = String(DEFAULT_TRACE_KM);
  $('trace-forward').value = String(DEFAULT_TRACE_KM);

  openPanel('trace-menu');

  // Un manteo bajo el umbral no se traza, pero el diálogo se abre igual: es
  // donde está escrito por qué, y esconder el botón dejaría la pregunta.
  const puede = Number.isFinite(dip) && dip >= MIN_TRACE_DIP_DEG;
  $('trace-run').disabled = !puede;
  if (!puede) {
    $('trace-from').textContent =
      `A ${Number.isFinite(dip) ? dip.toFixed(0) : '—'}° dip is below the ${MIN_TRACE_DIP_DEG}° floor: that flat, the plane crops out along a contour line and its strike points nowhere, so there is no line to run along.`;
  }
}

/** Calcula la traza con los kilómetros que dice el diálogo. */
async function runPlaneTrace() {
  if (traceBusy || !traceFrom) return;
  const backKm = Number($('trace-back').value);
  const forwardKm = Number($('trace-forward').value);

  traceBusy = true;
  const st = store.getState();
  setBusy(st.profileSource === 'opentopo' ? 'Downloading the DEM…' : 'Reading elevations…');
  try {
    const sampler = samplerFor(st);
    const resolution = demResolution(st);
    /*
     * OpenTopography necesita el recorte antes de contestar, y el recorte
     * tiene que cubrir el corredor entero, no solo la recta del rumbo: la
     * traza se aparta de ella justamente donde el terreno es accidentado, que
     * es donde interesa. Se le pasan las cuatro esquinas.
     */
    if (sampler.loadGrid) {
      await sampler.loadGrid(corridorCorners(traceFrom, backKm, forwardKm));
    }

    const r = await traceFromPlane({
      ...traceFrom,
      backKm,
      forwardKm,
      resolution,
      elevationAt: (lng, lat) => sampler.elevationAt(lng, lat),
    });

    if (!r.ok) {
      showBanner(r.reason);
      return;
    }

    store.setPlaneTrace({
      coords: r.coords,
      origin: traceFrom.origin,
      from: traceFrom.id,
      strike: r.strike,
      dip: r.dip,
      dipAzimuth: r.dipAzimuth,
      elevation: r.elevation,
      demSource: st.profileSource,
      stats: r.stats,
      warnings: r.warnings,
    });
    /*
     * Primero el panel y después el encuadre, no al revés: en un teléfono el
     * cuadro de «¿qué es esta línea?» se lleva media pantalla, y encuadrar
     * sobre el centro de la ventana dejaría la traza justo detrás de él —que
     * es lo único que hay que mirar para contestar la pregunta.
     */
    openTraceTypeMenu();
    // Solo se toca el zoom si la traza se sale de lo que ya se ve: tocarla
    // salió a acercarla, se sabe dónde está mirando el usuario, y alejar la
    // vista de golpe cada vez —incluso cuando la traza entera ya cabía— era
    // el salto que sobraba.
    if (mapBridge) mapBridge.fitToCoordsIfOffscreen(r.coords, paddingParaPanel('trace-type-menu'));
    if (r.warnings.length) showBanner(r.warnings.join(' '));
    demNoticePendiente = 'That projected trace';
  } catch (err) {
    showBanner(err.message);
  } finally {
    setBusy(null);
    traceBusy = false;
  }
}

/**
 * Márgenes de encuadre que dejan libre el panel abierto.
 *
 * Se mide el panel de verdad en vez de suponer su alto: cambia con la
 * disposición —al costado en una tablet, media pantalla en un teléfono— y con
 * lo que tenga dentro.
 */
function paddingParaPanel(id) {
  const el = $(id);
  if (!el || el.classList.contains('hidden')) return 60;
  const r = el.getBoundingClientRect();
  const base = { top: 60, bottom: 60, left: 40, right: 40 };
  // El panel ocupa el borde del que esté más cerca.
  if (r.top > window.innerHeight - r.bottom) base.bottom = Math.round(r.height) + 24;
  else base.top = Math.round(r.height) + 24;
  // Un margen mayor que la ventana haría que `fitBounds` no encuadrara nada.
  const alto = window.innerHeight - 80;
  if (base.top + base.bottom > alto) {
    const sobra = base.top + base.bottom - alto;
    if (base.bottom > base.top) base.bottom = Math.max(40, base.bottom - sobra);
    else base.top = Math.max(40, base.top - sobra);
  }
  return base;
}

/** Las cuatro esquinas del corredor que la traza puede llegar a recorrer. */
function corridorCorners(from, backKm, forwardKm) {
  const DEG = Math.PI / 180;
  const ancho = Math.min(8000, Math.max(750, (backKm + forwardKm) * 1000));
  const largo = Math.max(backKm, forwardKm) * 1000;
  const r = Math.hypot(largo, ancho);
  const dLat = r / 110540;
  const dLng = r / (111320 * Math.max(Math.cos(from.origin[1] * DEG), 1e-6));
  const [lng, lat] = from.origin;
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
  ];
}

/**
 * Segundo paso: con la traza ya dibujada, qué es.
 *
 * Los tipos son los mismos de la paleta y no una lista aparte: una traza
 * proyectada acaba siendo un contacto o una falla como cualquier otra, y
 * ofrecerle un vocabulario propio solo produciría dos cartografías que después
 * no se pueden mezclar.
 */
function openTraceTypeMenu() {
  if (!store.getState().planeTrace) return;
  openPanel('trace-type-menu');
  renderTraceTypeMenu();
}

/**
 * Repinta el contenido sin volver a abrir el panel.
 *
 * Separado de `openTraceTypeMenu` por un motivo concreto: elegir un tipo
 * repinta la lista para marcar el chip activo, y si eso pasara por `openPanel`
 * —que cierra todo lo demás antes de abrir— el cierre se llevaría por delante
 * la propia traza que se está tipificando. Se abre una vez; después solo se
 * repinta.
 */
function renderTraceTypeMenu() {
  const t = store.getState().planeTrace;
  if (!t) return;

  const km = (t.stats.backKm + t.stats.forwardKm).toFixed(2);
  $('trace-summary').textContent =
    `${km} km of trace from ${formatStrikeDip(t.strike, t.dip)} at ${Math.round(t.elevation)} m, ${t.stats.points} points. It wanders up to ${Math.round(t.stats.maxOffset)} m off the strike line.`;

  const body = $('trace-type-body');
  body.replaceChildren();
  const s = store.getState();

  for (const g of LINE_GROUPS) {
    const items = LINE_TYPES.filter((x) => x.group === g);
    if (!items.length) continue;
    const grupo = document.createElement('div');
    grupo.className = 'palette-group';
    const gl = document.createElement('span');
    gl.className = 'palette-label';
    gl.textContent = g;
    grupo.appendChild(gl);
    const fila = document.createElement('div');
    fila.className = 'palette-row';
    for (const t2 of items) {
      fila.appendChild(
        chip({
          label: t2.short,
          title: t2.label,
          color: effectiveLineColor(t2.id, s.ornaments),
          dash: (CERTAINTY_BY_ID.get(s.certainty) || {}).dash ?? null,
          active: s.lineType === t2.id,
          onClick: () => {
            store.setLineType(t2.id);
            renderTraceTypeMenu();
          },
        }),
      );
    }
    grupo.appendChild(fila);
    body.appendChild(grupo);
  }

  // La certeza, aquí más que en ninguna otra parte: una traza proyectada a dos
  // kilómetros del único punto medido es, por definición, inferida.
  const cert = document.createElement('div');
  cert.className = 'palette-group';
  const cl = document.createElement('span');
  cl.className = 'palette-label';
  cl.textContent = 'Certainty';
  cert.appendChild(cl);
  const certFila = document.createElement('div');
  certFila.className = 'palette-row';
  const soloObservado = isObservedOnly(s.lineType);
  for (const c of CERTAINTIES) {
    certFila.appendChild(
      chip({
        label: c.label,
        color: '#e6edf3',
        dash: c.dash,
        active: s.certainty === c.id,
        disabled: soloObservado && c.id !== 'observed',
        onClick: () => {
          store.setCertainty(c.id);
          renderTraceTypeMenu();
        },
      }),
    );
  }
  cert.appendChild(certFila);
  body.appendChild(cert);
}

/** Pasa la traza al dibujo con el tipo elegido. */
function addTraceAsLine() {
  const t = store.getState().planeTrace;
  if (!t) return;
  const s = store.getState();
  const f = store.createTraceLine({
    coords: t.coords,
    type: s.lineType,
    certainty: s.certainty,
    /*
     * De dónde salió, escrito en el dato y no solo en la pantalla. El proyecto
     * `.fdproj.json` lo guarda entero, y el GeoPackage lo resume en sus
     * columnas `method` y `source` (ver gpkg/index.js): quien abra la carta
     * dentro de un año tiene que poder distinguir un contacto caminado de uno
     * proyectado desde un manteo y un modelo de elevación.
     */
    source: {
      traceFrom: t.from,
      traceStrike: Math.round(t.strike * 10) / 10,
      traceDip: Math.round(t.dip * 10) / 10,
      traceKm: Math.round((t.stats.backKm + t.stats.forwardKm) * 100) / 100,
      demSource: t.demSource,
    },
  });
  $('trace-type-menu').classList.add('hidden');
  flushDemNotice();
  if (f) {
    const tipo = LINE_TYPE_BY_ID.get(f.properties.type);
    showBanner(
      `Trace added as ${tipo ? tipo.label.toLowerCase() : f.properties.type}. Undo removes it in one step.`,
      'info',
    );
  }
}

function discardTrace() {
  store.clearPlaneTrace();
  $('trace-type-menu').classList.add('hidden');
  flushDemNotice();
}

/**
 * El aviso del modelo, aplazado hasta que el cuadro de la traza se cierre.
 *
 * Los dos son desplegables y se taparían uno al otro. El de «¿qué es esta
 * línea?» va primero porque es el que hay que contestar; el del modelo llega
 * después, cuando ya hay algo que juzgar.
 */
let demNoticePendiente = null;

function flushDemNotice() {
  const ctx = demNoticePendiente;
  demNoticePendiente = null;
  if (ctx) showDemNotice(ctx);
}

function wireTraceMenus() {
  $('btn-close-trace').addEventListener('click', () => $('trace-menu').classList.add('hidden'));
  $('trace-run').addEventListener('click', runPlaneTrace);
  $('btn-close-trace-type').addEventListener('click', discardTrace);
  $('trace-discard').addEventListener('click', discardTrace);
  $('trace-add').addEventListener('click', addTraceAsLine);

  for (const id of ['trace-back', 'trace-forward']) {
    $(id).addEventListener('change', (e) => {
      const v = Math.max(0, Math.min(MAX_TRACE_KM, Number(e.target.value) || 0));
      e.target.value = String(v);
    });
  }
}

/** Metros con la precisión que el número aguanta, no la que sobra. */
function formatMetres(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(2)} km`;
  if (v >= 100) return `${Math.round(v)} m`;
  return `${v.toFixed(1)} m`;
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

  const uni = section(body, 'Unit');
  const uniRow = document.createElement('div');
  uniRow.className = 'palette-row';
  unitChips(uniRow, store.getState().units, p.unitId ?? null, (id) => {
    store.assignUnitToSelection(id);
    reabrir();
  });
  uni.appendChild(uniRow);

  /*
   * Calidad. Es la parte que justifica todo el módulo: un manteo sacado de un
   * DEM sin la base sobre la que se midió y sin su incertidumbre es un número
   * que nadie puede evaluar, y que acaba citado como si fuera de brújula.
   */
  const met = METHOD_BY_ID.get(p.method);
  const cal = section(body, 'Quality');
  // Los dos métodos que no salen del catálogo: una medida retocada a mano y una
  // adoptada de StraboSpot, que se tomó con brújula pero no aquí.
  const OTROS_METODOS = {
    edited: 'Edited by hand',
    strabospot: 'Field compass, imported from StraboSpot',
  };
  measureRow(cal, 'Method', met ? met.label : OTROS_METODOS[p.method] || p.method);
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
  } else if (p.method === 'device') {
    measureRow(
      cal,
      'Uncertainty',
      `±${p.strikeSd ?? '—'}° strike · ±${p.dipSd ?? '—'}° dip`,
      'One standard deviation across the samples taken while the phone was held against the surface',
    );
    measureRow(cal, 'Samples', `${p.n ?? '—'}`);
    if (Number.isFinite(p.gpsAccuracy)) {
      measureRow(cal, 'GPS accuracy', `±${p.gpsAccuracy} m`, 'The point was placed at the GPS position, not a tapped location');
    }
  } else if (p.method === 'edited') {
    measureRow(cal, 'Uncertainty', 'not applicable — typed in by hand');
  } else if (p.method === 'digitize') {
    measureRow(cal, 'Uncertainty', 'not applicable — traced from a map symbol, not measured in the field');
  }

  /*
   * Espesor estratigráfico desde esta medida.
   *
   * Vive aquí y no en la barra porque necesita una orientación, y la única que
   * tiene sentido usar es la de la capa sobre la que se está midiendo: el
   * espesor es la separación proyectada sobre la normal a ESE plano. Desde un
   * punto cualquiera del mapa no significaría nada.
   */
  const esp = section(body, 'Stratigraphic thickness');
  const btnEsp = document.createElement('button');
  btnEsp.className = 'pill wide';
  btnEsp.textContent = 'Measure thickness from here';
  btnEsp.title = 'Tap the other bounding surface on the map; the DEM supplies both elevations';
  btnEsp.addEventListener('click', () => {
    closePropsMenu();
    if (store.startThickness(p.id)) {
      showBanner(
        `Now tap the other surface of the unit. The thickness is measured normal to ${formatStrikeDip(p.strike, p.dip)}.`,
        'info',
      );
    } else {
      showBanner('That measurement has no strike and dip to measure against.');
    }
  });
  esp.appendChild(btnEsp);

  /*
   * Traza de afloramiento. Vive junto al espesor porque son las dos cosas que
   * un manteo permite calcular y que no son el manteo: una mira hacia dentro
   * de la unidad y la otra a lo largo de ella.
   */
  const tr = section(body, 'Trace from the DEM');
  const btnTr = document.createElement('button');
  btnTr.className = 'pill wide';
  btnTr.textContent = 'Retrieve trace from DEM intersection';
  btnTr.title =
    'Project this plane along strike and draw where it would crop out on the terrain';
  btnTr.addEventListener('click', () => {
    closePropsMenu();
    openTraceMenu(medida);
  });
  tr.appendChild(btnTr);
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

/** Qué DEM propio hay cargado, si hay alguno. */
function renderImportMenu() {
  const { demSet } = store.getState();
  $('import-dem-current').textContent = demSet
    ? `Loaded: ${demSet.label} · z${demSet.minzoom}–${demSet.maxzoom}, about ${Math.round(demSamplerFor(demSet).nominal)} m per cell.`
    : 'No elevation model imported: the AWS tiles (~30 m) are in use.';
}

/**
 * Abre un DEM propio y lo deja como origen de cotas.
 *
 * Se comprueba leyendo una tesela de verdad y mirando si los números que salen
 * son cotas plausibles. Un PNG de mapa base decodificado como Terrain-RGB da
 * valores disparatados —decenas de miles de metros, o el fondo del mar en una
 * cumbre—, y cargarlo en silencio dejaría todos los manteos de la sesión
 * calculados sobre el color de una imagen satelital.
 */
async function doImportDem(file) {
  setBusy(`Opening ${file.name}…`);
  try {
    const id = `dem-${Date.now().toString(36)}`;
    const descriptor = await openTileFile(file, id);
    if (descriptor.tileKind !== 'raster') {
      showBanner('An elevation model has to be raster tiles; that file holds vector tiles.');
      return;
    }

    const sampler = demSamplerFor(descriptor);
    const centro = descriptor.bounds
      ? [
          (descriptor.bounds[0] + descriptor.bounds[2]) / 2,
          (descriptor.bounds[1] + descriptor.bounds[3]) / 2,
        ]
      : null;
    const z = centro ? await sampler.elevationAt(centro[0], centro[1]) : null;
    if (!Number.isFinite(z) || z < -500 || z > 9000) {
      showBanner(
        centro
          ? `That file does not decode as Terrain-RGB: the middle of its coverage reads ${z === null ? 'no data' : `${Math.round(z)} m`}. Is it a basemap rather than an elevation model?`
          : 'That file declares no bounds, so it cannot be checked as an elevation model.',
      );
      return;
    }

    store.setDemSet(descriptor);
    await rememberImported(descriptor.id, 'dem', file);
    showBanner(
      `${descriptor.label}: elevation model at about ${Math.round(sampler.nominal)} m per cell (z${descriptor.maxzoom}). Profiles, plane fits, traces, hillshade and 3D relief now read from it.`,
      'info',
    );
  } catch (err) {
    showBanner(`Could not open the elevation model: ${err.message}`);
  } finally {
    setBusy(null);
  }
}

/** Un muestreador por descriptor; decodificar teselas se cachea dentro. */
const demSamplers = new WeakMap();
function demSamplerFor(descriptor) {
  let s = demSamplers.get(descriptor);
  if (!s) {
    s = new TileDemSampler(descriptor, readTileBytes);
    demSamplers.set(descriptor, s);
  }
  return s;
}

/**
 * Guarda el archivo recién importado para la próxima sesión.
 *
 * Un fallo aquí NO invalida la importación: el archivo ya está abierto y
 * funcionando, y lo único que se pierde es que siga estando mañana. Pero se
 * dice, en vez de dejar creer que quedó guardado: alguien que cuenta con su
 * mapa base cargado se entera en el cerro, no antes.
 */
async function rememberImported(id, role, file) {
  try {
    // Del modelo de elevación hay uno solo: el anterior deja de servir en
    // cuanto se carga otro, y quedaría ocupando disco para siempre.
    if (role === 'dem') await forgetImportedFilesByRole('dem');
    await rememberImportedFile({ id, role, file });
  } catch (err) {
    showBanner(
      `${file.name} is open for this session, but could not be stored for the next one (${err.message}). You will have to import it again after a reload.`,
      'warn',
    );
  }
}

/* ------------------------------------------- descargar un área a la caché */

/** Descarga en curso, para poder cancelarla. */
let areaAbort = null;

/** Tamaños legibles. Sube a GB porque la cuota del navegador llega ahí. */
function fmtMB(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** El recuadro que se está mirando, que es lo que se va a descargar. */
function currentBbox() {
  if (!mapBridge || !mapBridge.map) return null;
  const b = mapBridge.map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

function areaPlanFromForm() {
  const bbox = currentBbox();
  if (!bbox) return null;
  return planArea({
    bbox,
    demZoom: Number($('area-dem-zoom').value),
    basemapId: $('area-basemap').value || null,
    basemapZoom: Number($('area-basemap-zoom').value),
  });
}

/**
 * Cuánto se va a bajar, dicho antes de bajarlo.
 *
 * Es la mitad del valor de esta herramienta: sin la cuenta por delante, "bajar
 * el área" es una apuesta que se cobra en datos móviles y en minutos, y en
 * terreno se descubre tarde.
 */
function renderAreaEstimate() {
  const plan = areaPlanFromForm();
  const salida = $('area-estimate');
  const boton = $('area-download');
  if (!plan) {
    salida.textContent = 'The map is not ready yet.';
    boton.disabled = true;
    return;
  }

  const bbox = currentBbox();
  const lat = (bbox[1] + bbox[3]) / 2;
  const anchoKm = Math.round((metresPerTile(0, lat) * (bbox[2] - bbox[0])) / 360 / 1000);
  const usables = plan.partes.filter((p) => !p.blocked);
  // Lo vetado se nombra aquí y no solo en el aviso de términos: si no, el
  // botón diría "Download" sin dejar claro que ese basemap no va dentro.
  const vetadas = plan.partes.filter((p) => p.blocked).map((p) => p.label);
  const coletilla = vetadas.length ? ` ${vetadas.join(' and ')} will be skipped: not allowed.` : '';

  if (plan.excede.length) {
    const p = plan.excede[0];
    salida.textContent =
      `${p.label} would need ${p.tiles.toLocaleString()} tiles, over the ${p.limit.toLocaleString()} cap. ` +
      `Zoom in, or ask for less detail. A whole region belongs in a PMTiles file, not in a browser cache.` +
      coletilla;
    boton.disabled = true;
    return;
  }
  if (!usables.length) {
    salida.textContent = `Nothing here can be downloaded.${coletilla}`;
    boton.disabled = true;
    return;
  }

  const partes = usables.map((p) => `${p.label}: ${p.tiles.toLocaleString()} tiles to z${p.zmax}`);
  salida.textContent =
    `About ${anchoKm} km across · ${partes.join(' · ')} · ` +
    `roughly ${fmtMB(plan.bytes)}. Sizes are estimates; tiles already downloaded are not fetched again.` +
    coletilla;
  boton.disabled = false;
}

/** El aviso de términos de uso del basemap elegido, si lo hay. */
function renderAreaTos() {
  const id = $('area-basemap').value;
  const nota = $('area-tos');
  const bm = BASEMAPS.find((b) => b.id === id);
  if (!bm) {
    nota.textContent = '';
    return;
  }
  if (bm.prefetch === PREFETCH_BLOCKED) {
    nota.textContent =
      `${bm.label} cannot be downloaded in advance: its tile usage policy forbids bulk downloading, ` +
      `and those servers are paid for by donations, not by this app. Browsing it normally is fine — ` +
      `what is off limits is saving an area for later. For guaranteed coverage, convert your zone to ` +
      `PMTiles and import it.`;
    return;
  }
  nota.textContent =
    `${bm.attribution}. Downloading an area uses someone else's servers, so it is capped and meant for ` +
    `your working area, not for a region. Keep the attribution on anything you publish.`;
}

async function renderAreaStorage() {
  const uso = await storageUse();
  $('area-storage').textContent = uso
    ? `Browser storage in use: ${fmtMB(uso.usage)} of about ${fmtMB(uso.quota)} available.`
    : '';
}

async function renderAreaList() {
  const cont = $('area-list');
  cont.textContent = '';
  let areas = [];
  try {
    areas = await listAreas();
  } catch {
    cont.textContent = 'Downloaded areas cannot be listed in this browser.';
    return;
  }
  if (!areas.length) {
    const p = document.createElement('p');
    p.className = 'hint footnote';
    p.textContent = 'Nothing downloaded yet.';
    cont.appendChild(p);
    return;
  }
  for (const a of areas) {
    const fila = document.createElement('div');
    fila.className = 'export-row';
    const txt = document.createElement('span');
    txt.className = 'hint';
    const que = a.partes.map((p) => `${p.label} z${p.zmax}`).join(', ');
    txt.textContent =
      `${a.name} — ${a.tiles.toLocaleString()} tiles, ${fmtMB(a.bytes)} · ${que}` +
      (a.fallidas ? ` · ${a.fallidas} failed` : '') +
      (a.cancelada ? ' · cancelled' : '');
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '✕';
    del.setAttribute('aria-label', `Delete ${a.name}`);
    del.addEventListener('click', async () => {
      del.disabled = true;
      try {
        const { borradas } = await deleteArea(a.id);
        showBanner(`${a.name} deleted: ${borradas.toLocaleString()} tiles freed.`, 'info');
      } catch (err) {
        showBanner(`Could not delete the area: ${err.message}`);
      }
      await renderAreaList();
      await renderAreaStorage();
    });
    fila.appendChild(txt);
    fila.appendChild(del);
    cont.appendChild(fila);
  }
}

export function renderAreaMenu() {
  const sel = $('area-basemap');
  if (sel.options.length <= 1) {
    for (const b of BASEMAPS) {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.prefetch === PREFETCH_BLOCKED ? `${b.label} — not allowed` : b.label;
      sel.appendChild(o);
    }
    /*
     * Arranca SIN basemap, no con el que se está mirando.
     *
     * Parecía más servicial preseleccionarlo, pero con la vista por omisión
     * —decenas de km de ancho— cualquier basemap a z16 se pasa del tope, así
     * que el panel recibía a todo el mundo con un "no se puede" antes de que
     * hubiera pedido nada. El DEM solo, en cambio, casi siempre cabe, es lo
     * barato y es lo que más desbloquea sin señal: ese es el punto de partida
     * honesto, y añadir imagen es una decisión aparte.
     */
  }
  renderAreaTos();
  renderAreaEstimate();
  renderAreaList();
  renderAreaStorage();
}

async function doDownloadArea() {
  const plan = areaPlanFromForm();
  if (!plan) return;
  const usables = plan.partes.filter((p) => !p.blocked);
  if (!usables.length || plan.excede.length) return;

  const bbox = currentBbox();
  const id = `area-${Date.now().toString(36)}`;
  const centro = `${Math.abs((bbox[1] + bbox[3]) / 2).toFixed(2)}°${(bbox[1] + bbox[3]) / 2 < 0 ? 'S' : 'N'}`;
  const name = `Area ${centro} · ${new Date().toISOString().slice(0, 10)}`;

  areaAbort = new AbortController();
  $('area-cancel').classList.remove('hidden');
  $('area-download').disabled = true;

  try {
    const res = await downloadArea(
      { id, name, bbox, partes: plan.partes },
      {
        signal: areaAbort.signal,
        onProgress: ({ hechas, total, fallidas }) => {
          $('area-estimate').textContent =
            `Downloading ${hechas.toLocaleString()} of ${total.toLocaleString()}` +
            (fallidas ? ` · ${fallidas} failed` : '') +
            '. You can keep working; leaving this page stops it.';
        },
      },
    );
    showBanner(
      res.cancelada
        ? `Stopped: ${res.tiles.toLocaleString()} tiles kept. What was downloaded works offline.`
        : `${name}: ${res.tiles.toLocaleString()} tiles downloaded` +
            (res.fallidas ? `, ${res.fallidas} failed and will show as gaps` : '') +
            '. This area now works with no signal.',
      'info',
    );
  } catch (err) {
    showBanner(`The download failed: ${err.message}`);
  } finally {
    areaAbort = null;
    $('area-cancel').classList.add('hidden');
    $('area-download').disabled = false;
    renderAreaEstimate();
    await renderAreaList();
    await renderAreaStorage();
  }
}

/**
 * Vuelve a abrir los mapas offline y el modelo de elevación de la sesión
 * anterior.
 *
 * Lo llama `app.js` al arrancar, sin bloquear el resto de la restauración: un
 * `.mbtiles` se carga entero en memoria y puede tardar, y no hay motivo para
 * que el dibujo guardado espere por eso.
 *
 * Lo que no vuelve es el ORDEN y la opacidad que tuvieran en el panel de
 * capas: eso vive en el proyecto, no en el archivo, así que cada mapa
 * reaparece con sus valores por omisión.
 */
export async function restoreImportedFiles() {
  let records;
  try {
    records = await listImportedFiles();
  } catch (err) {
    // Sin IndexedDB —modo privado, almacenamiento bloqueado— la app funciona
    // igual, solo que sin recordar nada. No es motivo para molestar a nadie.
    console.warn('[importados] no se pudo leer lo guardado:', err);
    return;
  }
  if (!records.length) return;

  setBusy(`Reopening ${records.length} imported file(s)…`);
  try {
    for (const rec of records) {
      try {
        const descriptor = await openTileFile(rec.file, rec.id);
        if (rec.role === 'dem') store.setDemSet(descriptor);
        else store.addTileSet(descriptor);
      } catch (err) {
        // El archivo sigue ahí pero ya no se puede abrir: arrastrarlo a la
        // siguiente sesión solo repetiría el fallo cada vez que se arranque.
        forgetImportedFile(rec.id).catch(() => {});
        showBanner(
          `${rec.name || 'An imported file'} could not be reopened and was dropped: ${err.message}`,
          'warn',
        );
      }
    }
  } finally {
    setBusy(null);
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

/**
 * Botones que crean o mueven geometría, y que el relieve 3D deshabilita.
 * Línea, Polígono y Edit Nodes quedan fuera: esos tres sí se ofrecen con el
 * relieve puesto, avisando de la pérdida de precisión en vez de bloquearlos.
 * Ver `DRAWING_TOOLS_3D_OK` en store.js.
 */
const GEOMETRY_TOOL_BUTTONS = ['t-hole', 't-measure', 't-cut', 't-reshape', 't-profile'];

/**
 * Qué herramientas hay detrás de cada botón de grupo (Create, Topology), para
 * que el botón se marque activo aunque el menú volante esté cerrado: sin
 * esto, elegir Dip y cerrar el menú dejaría la barra sin decir con qué se
 * está dibujando.
 */
const TOOL_GROUPS = {
  create: {
    toggle: 'tg-create',
    flyout: 'flyout-create',
    tools: new Set(['line', 'polygon', 'measure']),
  },
  topology: {
    toggle: 'tg-topology',
    flyout: 'flyout-topology',
    tools: new Set(['vertices', 'hole', 'cut', 'reshape']),
  },
};

const TERRAIN_BLOCKED_TITLE =
  'Not available while 3D terrain is on: on tilted ground the point you touch is not the point on the map';

const TERRAIN_LOW_PRECISION_WARNING =
  '3D terrain is on: the point you tap may not match the actual point on the ground, so quality here is not the best. Shift + drag tilts and rotates the view, the arrow keys pan it, and the wheel zooms — all without leaving the tool.';

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
   * El botón de grupo se enciende SOLO si la herramienta activa vive dentro.
   *
   * Snap y Follow trace no cuentan aunque estén encendidos: son ajustes que
   * acompañan al dibujo, no una herramienta elegida, y teñirlos de verde
   * dejaba Topology marcado de forma permanente —Snap suele quedarse puesto
   * toda la jornada—, que es justo lo contrario de lo que el resalte tiene
   * que decir: en qué modo está el puntero ahora mismo.
   */
  for (const grupo of Object.values(TOOL_GROUPS)) {
    $(grupo.toggle).classList.toggle('active', grupo.tools.has(s.tool));
  }

  /*
   * Con el relieve puesto, las herramientas que dependen de tocar con
   * exactitud algo que ya existe se apagan en vez de fallar en silencio.
   * Línea y Polígono no están en la lista: esos dos sí se ofrecen, avisando
   * de que la precisión baja.
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

  /*
   * El deshacer de la barra —que solo retiraba el último VÉRTICE del trazo en
   * curso— se quitó por redundante con el de la esquina («ya está»), que
   * deshace la última operación sobre el dibujo. El atajo `undo-vertex` sigue
   * vivo para quien lo usaba desde el teclado.
   */
  $('btn-undo').disabled = !store.canUndo();
  $('btn-redo').disabled = !store.canRedo();
  $('t-finish').disabled = !hasDraft;
  $('t-cancel').disabled = !hasDraft;
  $('t-delete').disabled = s.selection.length === 0;
  $('t-delete').title = `Delete ${s.selection.length} selected feature(s)`;
  $('btn-export').disabled = s.features.length === 0;

  /*
   * Deshacer y Rehacer se quedan siempre a la vista —son del documento
   * entero, no de lo que se esté mirando ahora— pero Hecho, Cancelar y
   * Borrar solo dicen algo cuando hay a qué aplicarlos: un elemento a medio
   * trazar (línea, polígono, medida o perfil) para los dos primeros, una
   * selección para Borrar —«hay features guardadas en alguna parte» se
   * cumple casi siempre con el proyecto autoguardado en localStorage, así
   * que Borrar quedaba a la vista todo el rato igual que Deshacer y
   * Rehacer, y eso es justo lo que este botón no debía hacer. Se esconden y
   * no solo se apagan, y el separador que los antecede se va con ellos para
   * no dejar una rayita suelta entre Rehacer y el siguiente botón visible.
   */
  $('sep-draft').classList.toggle('hidden', !hasDraft);
  $('t-finish').classList.toggle('hidden', !hasDraft);
  $('t-cancel').classList.toggle('hidden', !hasDraft);
  const haySeleccion = s.selection.length > 0;
  $('sep-delete').classList.toggle('hidden', !haySeleccion);
  $('t-delete').classList.toggle('hidden', !haySeleccion);
}

function renderStatus() {
  const s = store.getState();
  const n = s.draft ? s.draft.coords.length : 0;
  $('status-count').textContent = `${s.features.length} feature${s.features.length === 1 ? '' : 's'}`;
  if (s.terrain3d && s.tool === 'navigate') {
    $('status-text').textContent =
      '3D terrain on — two fingers or the right button tilt the view; Line and Polygon can draw here too (lower quality)';
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
    } else if (s.measureMethod === 'device') {
      const r = s.deviceReading;
      if (!r) {
        $('status-text').textContent = `Requesting sensor access… hold the phone flat against the ${que}`;
      } else if (!r.ready) {
        // El mismo consejo que da el panel de la brújula: si la barra de
        // estado dijera «sostén el teléfono contra la roca» mientras el panel
        // pide nivelarlo para encontrar el norte, se estarían contradiciendo.
        $('status-text').textContent = compassHint(r);
      } else {
        $('status-text').textContent =
          `${formatStrikeDip(r.strike, r.dip)} ±${round1(r.strikeSd)}°/±${round1(r.dipSd)}° · press Add measurement in the compass panel to record it at your GPS position`;
      }
    } else if (s.measureMethod === 'digitize') {
      $('status-text').textContent =
        n === 0
          ? `Tap the two ends of the ${que}'s strike trace on the map`
          : n === 1
            ? '1 of 2 strike points · tap the other end'
            : 'Drag away from the strike line to set dip direction and magnitude · release to place it at the midpoint';
    } else {
      $('status-text').textContent =
        n > 0
          ? `${n} nodes along the trace · close it to fit the plane`
          : `Draw along the trace of the ${que} · every node is sampled on the DEM`;
    }
  } else if (s.tool === 'select') {
    // El arrastre es el lazo, no el desplazamiento: decirlo al revés mandaba a
    // la gente a buscar una herramienta de selección múltiple que ya tenía.
    const gesto = s.selectMode === 'rect' ? 'drag a rectangle' : 'draw a lasso';
    $('status-text').textContent = s.selection.length
      ? `${s.selection.length} selected · ${gesto} or Shift+click to add · right-click opens the menu`
      : `Tap a feature to select it · ${gesto} around several · touching them is enough`;
  } else if (s.tool === 'vertices') {
    const base =
      s.vertexMode === 'add'
        ? 'Add mode · tap an edge to insert a vertex, drag to place it'
        : s.vertexMode === 'delete'
          ? 'Delete mode · tap a vertex to remove it'
          : 'Drag a vertex to move it · a midpoint to insert · double tap to delete';
    // El clic derecho se anuncia aquí igual que en Elegir: es la puerta al
    // menú de propiedades sin soltar la herramienta, y sin decirlo no se
    // descubre.
    const conMenu = `${base} · right-click opens the menu`;
    $('status-text').textContent = s.topoEdit
      ? `${conMenu} · topological editing on: magenta ones move together`
      : conMenu;
  } else if (s.tool === 'thickness') {
    $('status-text').textContent = s.thicknessFrom
      ? `Tap the other surface of the unit · thickness measured normal to ${formatStrikeDip(s.thicknessFrom.strike, s.thicknessFrom.dip)}`
      : 'Pick a strike and dip measurement first';
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
    $('status-text').textContent = s.terrain3d
      ? `${n} vertex${n === 1 ? '' : 'es'} · 3D terrain on, quality here is not the best · tap to add, press and hold for freehand, double tap to close`
      : `${n} vertex${n === 1 ? '' : 'es'} · tap to add, press and hold for freehand, double tap to close`;
  } else {
    $('status-text').textContent = s.terrain3d
      ? 'Tap for the first vertex · 3D terrain on, quality here is not the best · press and hold for freehand'
      : 'Tap for the first vertex · press and hold for freehand';
  }
}

/**
 * Rumbo y manteo en vivo mientras dura el arrastre de Digitize. `mapView.js`
 * la llama en cada fotograma del gesto porque escribir en el store ahí
 * dispararía a todos los suscriptores por cada píxel de arrastre; esto se
 * limita a pintar el texto y deja que `renderStatus()` retome al soltar.
 */
export function renderDigitizePreview(geo) {
  if (!geo) {
    renderStatus();
    return;
  }
  $('status-text').textContent =
    `${formatStrikeDip(geo.strike, geo.dip)} · release to place it at the midpoint of the strike line`;
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
const RADIO_SETTING_KEYS = ['freehandMode', 'cutSource', 'profileSource', 'selectMode'];

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
  $(s.selectMode === 'rect' ? 'sel-rect' : 'sel-lasso').checked = true;
  // La tercera opción solo existe si hay un DEM propio cargado: ofrecerla
  // vacía sería un botón que no hace nada.
  const propio = !!s.demSet;
  $('dem-imported-row').hidden = !propio;
  $('dem-imported-sub').hidden = !propio;
  if (propio) {
    const sam = demSamplerFor(s.demSet);
    $('dem-imported-label').textContent = `${sam.label} (~${Math.round(sam.nominal)} m)`;
  }
  const elegida =
    s.profileSource === 'imported' && propio
      ? 'dem-imported'
      : s.profileSource === 'opentopo'
        ? 'dem-opentopo'
        : 'dem-terrarium';
  $(elegida).checked = true;
}

export function initUI() {
  $('t-nav').addEventListener('click', () => store.setTool('navigate'));
  $('t-line').addEventListener('click', () => store.setTool('line'));
  $('t-poly').addEventListener('click', () => store.setTool('polygon'));
  $('t-snap').addEventListener('click', () => store.setSnapEnabled(!store.getState().snapEnabled));
  $('t-trace').addEventListener('click', () =>
    store.setTraceEnabled(!store.getState().traceEnabled),
  );
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
        ? 'The drawing is draped over the relief, and Line and Polygon still draw on it — the rest of the tools need plan view, where a tap lands exactly on what it touches. Off the cached tiles the ground renders flat, and on an older tablet this costs noticeably more to render.'
        : 'Back to plan view: every tool is available again.',
      'info',
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
  $('btn-close-quick-typeunit').addEventListener('click', closeQuickTypeUnitMenu);
  $('btn-close-device').addEventListener('click', () => store.setMeasureMethod('manual'));
  $('btn-device-done').addEventListener('click', commitDeviceReading);
  $('btn-close-gps-required').addEventListener('click', closeOverlays);
  $('btn-gps-required-enable').addEventListener('click', () => {
    if (mapBridge) mapBridge.locateMe();
    closeOverlays();
  });
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
  // Visible y activo solo con selección (ver `renderToolbar()`), así que
  // aquí ya no hace falta el «si no hay nada elegido, borra lo último».
  $('t-delete').addEventListener('click', () => store.deleteSelected());

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
    showBanner('Line symbology reset to defaults.', 'info');
  });
  wireImportControls();

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
  $('unit-labels').addEventListener('change', (e) => store.setUnitLabels(e.target.checked));

  $('btn-map-image').addEventListener('click', () => {
    openPanel('map-export-menu');
    // El nombre del proyecto es el título que uno querría casi siempre; se
    // propone y se puede cambiar, en vez de dejarlo en blanco.
    const titulo = $('map-export-title');
    if (!titulo.value.trim()) titulo.value = $('project-name').value.trim();
    renderMapExportNote();
  });
  $('btn-close-map-export').addEventListener('click', () => closeOverlays());
  $('btn-map-svg').addEventListener('click', () => doExportMapImage('svg'));
  $('btn-map-png').addEventListener('click', () => doExportMapImage('png'));
  $('btn-map-pdf').addEventListener('click', () => doExportMapImage('pdf'));
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
  $('btn-import').addEventListener('click', () => {
    renderImportMenu();
    togglePanel('import-menu');
  });
  $('btn-close-import').addEventListener('click', () => $('import-menu').classList.add('hidden'));

  $('open-area-menu').addEventListener('click', () => {
    $('import-menu').classList.add('hidden');
    renderAreaMenu();
    openPanel('area-menu');
  });
  $('btn-close-area').addEventListener('click', () => $('area-menu').classList.add('hidden'));
  $('area-basemap').addEventListener('change', () => {
    renderAreaTos();
    renderAreaEstimate();
  });
  $('area-dem-zoom').addEventListener('change', renderAreaEstimate);
  $('area-basemap-zoom').addEventListener('change', renderAreaEstimate);
  $('area-download').addEventListener('click', doDownloadArea);
  $('area-cancel').addEventListener('click', () => {
    if (areaAbort) areaAbort.abort();
  });
  $('import-map').addEventListener('click', () => {
    $('import-menu').classList.add('hidden');
    $('file-gpkg').click();
  });
  $('import-dem').addEventListener('click', () => {
    $('import-menu').classList.add('hidden');
    $('file-dem').click();
  });
  $('file-gpkg').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permite reimportar el mismo archivo
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.mbtiles') || name.endsWith('.pmtiles')) doOpenTiles(file);
    else doImportGeoPackage(file);
  });
  $('file-dem').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) doImportDem(file);
  });
  $('banner-close').addEventListener('click', () => {
    // Cerrar a mano también apaga los relojes: sin esto, el desvanecimiento
    // programado le quitaba la clase `hidden` que la persona acababa de poner.
    clearTimeout(bannerFadeTimer);
    clearTimeout(bannerHideTimer);
    $('banner').classList.remove('fade-out');
    $('banner').classList.add('hidden');
    runBannerCleanup();
  });

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
  $('sel-lasso').addEventListener('change', () => store.setSelectMode('lasso'));
  $('sel-rect').addEventListener('change', () => store.setSelectMode('rect'));
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
  $('dem-imported').addEventListener('change', () => store.setProfileSource('imported'));
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
  $('btn-section').addEventListener('click', openSectionFromProfile);
  $('btn-profile-csv').addEventListener('click', downloadProfileCSV);
  $('btn-profile-png').addEventListener('click', downloadProfilePNG);
  $('btn-profile-svg').addEventListener('click', downloadProfileSVG);
  wireProfilePointer();
  wireStructureControls();
  syncStructureControls();
  wireTraceMenus();
  wireDemNotice();

  // Mismo gancho de depuración que monta mapView: la traza se abre desde el
  // menú de propiedades de una medida, y eso desde una prueba de navegador
  // significaría simular un long-press sobre un símbolo de 20 px.
  if (typeof window !== 'undefined') {
    window.__fielddraw = Object.assign(window.__fielddraw || {}, { openTraceMenu, store });
  }

  $('btn-undo').addEventListener('click', () => {
    if (!store.undo()) showBanner('Nothing left to undo.');
  });
  $('btn-redo').addEventListener('click', () => {
    if (!store.redo()) showBanner('Nothing left to redo.');
  });

  $('btn-about').addEventListener('click', () => togglePanel('about'));
  $('btn-close-about').addEventListener('click', () => $('about').classList.add('hidden'));
  renderAbout();

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
  // El perfil estructural comparte el muestreador del DEM con el topográfico:
  // dos muestreadores distintos pedirían dos veces las mismas teselas.
  initSectionPanel({ message: showBanner, busy: setBusy, sampler: samplerFor });
  initStereogramPanel({ message: showBanner });
  wireScale();
  wireShortcuts();
  wireClickOutside();
  wireToolbarWidth();
  wireToolGroups();

  // StraboSpot vive en su propio módulo: la API, el aplanado de spots y su
  // simbología no tienen por qué mezclarse con el resto de la interfaz.
  initStraboPanel({ message: showBanner, busy: setBusy });

  buildPalette();
  renderLayers();
  renderUnits();
  renderSymbology();
  syncImportControls();
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
      store.changed('measureUnit') ||
      store.changed('units')
    ) {
      buildPalette();
    }
    if (store.changed('units') || store.changed('unitLabels')) renderUnits();
    if (store.changed('ornaments')) renderSymbology();
    if (store.changed('importStyle')) syncImportControls();
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
    /*
     * Cada medida nueva —cualquiera sea el método— abre sola el cuadro de
     * tipo y unidad: son los dos datos que conviene confirmar de inmediato, y
     * pedirlos antes de tocar el mapa habría significado repetirlos en cada
     * punto en vez de corregirlos solo donde hace falta.
     *
     * Lo que lo dispara es `justMeasured`, la señal que publica el store al
     * crear la medida, y no la selección: crear una medida ahora devuelve la
     * herramienta a Elegir, así que "estar en la herramienta de medir" ya no
     * distingue una medida recién nacida de una que alguien volvió a tocar.
     */
    if (store.changed('justMeasured')) {
      const id = store.getState().justMeasured;
      if (id) openQuickTypeUnitMenu(id);
    }
    // Tocar otra cosa —o deseleccionar— cierra el cuadro: pregunta por UNA
    // medida concreta, y sin ella no tiene sujeto.
    if (store.changed('selection') && !store.changed('justMeasured')) {
      const sel = store.getState().selection;
      if (quickTypeUnitTarget() && (sel.length !== 1 || sel[0] !== quickTypeUnitTarget())) {
        closeQuickTypeUnitMenu();
      }
    }
    if (store.changed('features')) refreshQuickTypeUnitMenu();
    if (store.changed('deviceReading')) renderDevicePanel();
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
      store.changed('manualDip') ||
      store.changed('deviceReading') ||
      store.changed('thicknessFrom')
    ) {
      renderToolbar();
      renderStatus();
    }
    if (store.changed('tool') || store.changed('measureMethod')) syncDeviceCapture();
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
    if (store.changed('pendingSection')) {
      const pedido = store.getState().pendingSection;
      if (pedido) runSection(pedido);
    }
    if (store.changed('section') || store.changed('sectionOpts')) renderSectionPanel();
    if (store.changed('pendingThickness')) {
      const par = store.getState().pendingThickness;
      if (par) runThickness(par);
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
      $('t-scale').classList.toggle('active', !!fijada);
      if (!$('scale-menu').classList.contains('hidden')) renderScaleMenu();
    }
    if (store.changed('structureStyle')) syncStructureControls();
    if (store.changed('profile')) renderProfilePanel();
    if (store.changed('terrain3d')) {
      renderToolbar();
      renderStatus();
      buildPalette();
    }
    // Línea y Polígono siguen disponibles con el relieve puesto, pero con
    // menos precisión: se avisa cada vez que se entra a dibujar así, sea por
    // la barra, el teclado o al encender el 3D estando ya en una de las dos.
    if (
      (store.changed('tool') || store.changed('terrain3d')) &&
      store.getState().terrain3d &&
      store.DRAWING_TOOLS_3D_OK.includes(store.getState().tool)
    ) {
      showBanner(TERRAIN_LOW_PRECISION_WARNING, 'warn');
    }
  });
}
