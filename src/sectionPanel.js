/**
 * El panel del perfil estructural: construirlo, dibujarlo y sacarlo fuera.
 *
 * Vive en su propio módulo y no dentro de `ui.js` por tamaño y por naturaleza:
 * es una vista entera con su ciclo propio —construir el corte, repintarlo
 * cuando cambian sus opciones, exportarlo a cuatro formatos— y meterla en el
 * archivo que ya lleva la barra, la paleta y los paneles lo habría hecho
 * ilegible.
 *
 * El corte se construye con la traza del perfil topográfico que ya está
 * calculado. No se pide una traza nueva a propósito: la topografía del corte y
 * la del perfil tienen que ser la misma línea, y muestrear el DEM dos veces
 * para la misma sección sería pedirle a la red lo que ya se tiene.
 */

import * as store from './store.js';
import { buildSection, projectContacts } from './section.js';
import { cancelStroke, initSectionInk } from './sectionInk.js';
import { applyZoom, initSectionZoom } from './sectionZoom.js';
import { openInSketcher, sketcherMessage } from './sketcherLink.js';
import { makeFloating } from './floating.js';
import { byId, getSectionPopup, setSectionPopup } from './sectionWindow.js';
import { renderSection, sectionPNG, sectionSVG } from './sectionView.js';
import { sketcherDocument, structuralModellerZip } from './sectionExport.js';
import { LINE_TYPE_BY_ID, STRUCTURE_TYPE_BY_ID } from './symbology.js';
import { downloadBlob } from './persistence.js';

const $ = byId;

let onMessage = () => {};
let onBusy = () => {};
/** Muestreador del DEM, inyectado por `ui.js`: es el mismo que usa el perfil. */
let samplerFor = null;

export function initSectionPanel({ message, busy, sampler }) {
  onMessage = message || onMessage;
  onBusy = busy || onBusy;
  samplerFor = sampler;

  $('btn-close-section').addEventListener('click', () => store.clearSection());
  $('section-exag').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v > 0) store.setSectionOpts({ exaggeration: v });
  });
  $('section-show-intersections').addEventListener('change', (e) =>
    store.setSectionOpts({ showIntersections: e.target.checked }),
  );
  $('section-show-labels').addEventListener('change', (e) =>
    store.setSectionOpts({ showLabels: e.target.checked }),
  );
  $('section-show-cross-labels').addEventListener('change', (e) =>
    store.setSectionOpts({ showCrossLabels: e.target.checked }),
  );
  $('section-show-codes').addEventListener('change', (e) =>
    store.setSectionOpts({ showCodes: e.target.checked }),
  );
  $('btn-section-lists').addEventListener('click', () => {
    $('section-side').classList.toggle('hidden');
    $('btn-section-lists').classList.toggle('active');
    renderSectionPanel();
  });
  $('section-dips-by-unit').addEventListener('change', (e) =>
    store.setSectionOpts({ dipsByUnit: e.target.checked }),
  );
  $('btn-section-popout').addEventListener('click', togglePopOut);
  window.addEventListener('beforeunload', () => {
    const w = getSectionPopup();
    if (w) w.close();
  });
  $('btn-section-info').addEventListener('click', () => $('section-note').classList.toggle('hidden'));
  initFloating();
  initSectionInk({ scales: () => lastScales });
  initSectionZoom($('section-chart'), $('section-chart-wrap'), { onStart: cancelStroke });

  $('btn-section-save').addEventListener('click', saveProfile);
  $('btn-section-open-sketcher').addEventListener('click', openSketcher);
  $('btn-project-contacts').addEventListener('click', () => {
    const sec = store.getState().section;
    if (sec) store.beginPickBand({ coords: sec.coords, width: sec.bandwidth || 500 });
  });
  $('pickband-range').addEventListener('input', (e) => store.setBandWidth(Number(e.target.value)));
  $('pickband-num').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    if (v > 0) store.setBandWidth(v);
  });
  $('pickband-cancel').addEventListener('click', () => store.cancelPickBand());
  $('pickband-confirm').addEventListener('click', confirmBand);
  $('section-x-all').addEventListener('click', () => store.setAllIntersections(true));
  $('section-x-none').addEventListener('click', () => store.setAllIntersections(false));

  $('btn-section-svg').addEventListener('click', exportSVG);
  $('btn-section-png').addEventListener('click', exportPNG);
  $('btn-section-shp').addEventListener('click', exportShapefile);
  $('btn-section-sketcher').addEventListener('click', exportSketcher);
}

/* ============================================================ construir === */

let building = false;

/**
 * Construye el corte a partir de la petición publicada por el store.
 *
 * Lo asíncrono es una sola cosa: la cota de cada medida. El símbolo de
 * rumbo/manteo guarda dónde se midió pero no a qué altura, y sin la cota el
 * manteo proyectado no tiene dónde colgarse en el corte.
 */
export async function runSection(pending) {
  if (building) {
    store.clearPendingSection();
    onMessage('Still building the previous section.');
    return;
  }
  const st = store.getState();
  const { coords, measurementIds, maxOffset, projection } = pending || {};
  if (!Array.isArray(coords) || coords.length < 2) {
    store.clearPendingSection();
    return;
  }

  // `measurementIds` es siempre la lista explícita a proyectar —vacía es un
  // corte solo con topografía, no "todas"— así que nunca se completa con el
  // resto de medidas del dibujo (ver `requestSection` en store.js).
  const todas = st.features.filter(
    (f) => f.geometry && f.geometry.type === 'Point' && f.properties.geomKind === 'measurement',
  );
  const ids = new Set(measurementIds || []);
  const elegidas = todas.filter((f) => ids.has(f.properties.id));

  building = true;
  onBusy('Reading elevations of the measurements…');
  try {
    const sampler = samplerFor(st);
    if (sampler.loadGrid && elegidas.length) {
      await sampler.loadGrid(elegidas.map((f) => f.geometry.coordinates));
    }
    const cotas = await Promise.all(
      elegidas.map((f) =>
        sampler.elevationAt(f.geometry.coordinates[0], f.geometry.coordinates[1]),
      ),
    );
    const conCota = elegidas.map((f, i) => ({
      properties: f.properties,
      lngLat: f.geometry.coordinates,
      elevation: cotas[i],
    }));

    // Las intersecciones se buscan contra las LÍNEAS del dibujo: un polígono
    // aporta su borde, que ya está cartografiado como contacto casi siempre.
    const lineas = st.features.filter((f) => f.geometry && f.geometry.type !== 'Point');

    // Al proyectar manteos sobre la MISMA traza se reutiliza la topografía del
    // corte ya abierto: `st.profile` es el perfil topográfico de ahora (puede
    // haberse cerrado o ser el de otra traza) y, sin él, el corte se
    // reconstruiría sin la línea del terreno.
    const previo = st.section;
    const mismaTraza =
      previo && previo.samples && previo.samples.length > 0 &&
      JSON.stringify(previo.coords) === JSON.stringify(coords);
    const perfil = mismaTraza ? { samples: previo.samples, label: previo.source } : st.profile;

    const section = buildSection({
      coords,
      profile: perfil,
      measurements: conCota,
      features: lineas,
      maxOffset: maxOffset === null || maxOffset === undefined ? Infinity : maxOffset,
      projection,
    });

    // Con medidas pedidas EXPLÍCITAMENTE (desde "Project dips") y ninguna
    // proyectada, algo falló —lejos del corte, sin cota, mal orientadas— y
    // hay que decirlo. Un corte recién abierto sin medidas todavía (la lista
    // llega vacía a propósito) no es ese caso: es solo topografía.
    if (
      (measurementIds || []).length > 0 &&
      section.dips.length === 0 &&
      section.intersections.length === 0
    ) {
      onMessage(
        'Nothing fell on that section: no measurement within reach and no mapped line crossing it.',
      );
      store.clearPendingSection();
      return;
    }
    store.setSection(section);
    const sinCota = section.dips.filter((d) => !Number.isFinite(d.z)).length;
    onMessage(
      section.dips.length || section.intersections.length
        ? `${section.dips.length} measurement(s) projected and ${section.intersections.length} crossing(s) found.` +
            (sinCota ? ` ${sinCota} had no elevation in the model and are not drawn.` : '')
        : 'Section ready — use "Project dips" to choose which measurements go on it.',
      'info',
    );
  } catch (err) {
    onMessage(err.message);
    store.clearPendingSection();
  } finally {
    onBusy(null);
    building = false;
  }
}

/* ============================================================== dibujar === */

export function renderSectionPanel() {
  const st = store.getState();
  const panel = $('section-view');
  renderBandBar(st);
  // Mientras se eligen los manteos en el mapa (`pickDips`) la vista se quita
  // de en medio, aunque ya hubiera un corte construido: es al mapa a donde
  // hay que ver, y el corte anterior sigue intacto para cuando se cancele.
  if (!st.section || st.pickDips || st.pickBand) {
    panel.classList.add('hidden');
    if (!st.section && getSectionPopup()) getSectionPopup().close();
    return;
  }
  panel.classList.remove('hidden');

  const s = st.section;
  const o = st.sectionOpts;
  $('section-meta').textContent =
    `${(s.length / 1000).toFixed(2)} km · azimuth ${Math.round(s.azimuth)}° · ` +
    `${Math.round(s.zMin)}–${Math.round(s.zMax)} m`;

  const wrap = $('section-chart-wrap');
  // Solo el ancho viene de la ventana: el alto lo da la escala 1:1 del corte.
  const width = Math.max(320, Math.round(wrap.clientWidth) - 2);
  lastWidth = width;
  // El rótulo de unidad se toma del mapa de ahora: así un contacto al que se le
  // asignó unidad (o cuyo código cambió) después de armar el corte se ve sin
  // tener que regenerarlo.
  const vivo = new Map(st.features.map((f) => [f.properties.id, f.properties.contactLabel || '']));
  const conCodigo = (x) => (vivo.has(x.id) ? { ...x, contactLabel: vivo.get(x.id) } : x);
  // Unidad de cada manteo, leída del dibujo de ahora (puede haberse cambiado
  // después de proyectarlo) y con el color del catálogo vivo.
  const unidadViva = new Map(st.features.map((f) => [f.properties.id, f.properties.unitId || null]));
  const colores = new Map(st.units.map((u) => [u.id, u.color]));
  const conUnidad = (d) => (unidadViva.has(d.id) ? { ...d, unitId: unidadViva.get(d.id) } : d);
  const { scales } = renderSection(
    $('section-chart'),
    {
      ...s,
      intersections: s.intersections.map(conCodigo),
      contacts: (s.contacts || []).map(conCodigo),
      dips: s.dips.map(conUnidad),
    },
    {
    unitColor: (id) => colores.get(id) || null,
    dipsByUnit: !!o.dipsByUnit,
    width,
    exaggeration: o.exaggeration,
    showIntersections: o.showIntersections,
    showLabels: o.showLabels,
    showCrossLabels: o.showCrossLabels,
    showCodes: !!o.showCodes,
    showContacts: o.showIntersections,
    ink: s.ink || [],
    // Papel blanco: se interpreta a la luz del día, junto al afloramiento —el
    // mismo motivo por el que la brújula en vivo (`compassWidget.js`) también
    // se dibuja clara y no oscura— y es lo que sale impreso o pegado en un
    // informe, donde un fondo negro gasta tinta y desentona con el resto.
    theme: 'light',
    },
  );

  lastScales = scales;
  applyZoom($('section-chart'));

  renderDipList(s, o.dipsByUnit ? colores : null);
  renderCrossingList(s);
  renderContactList(s, colores);
  $('section-note').textContent = sectionNote(s);

  const ex = $('section-exag');
  if (document.activeElement !== ex) ex.value = String(o.exaggeration);
  $('section-show-intersections').checked = o.showIntersections;
  $('section-show-labels').checked = o.showLabels;
  $('section-show-cross-labels').checked = o.showCrossLabels;
  $('section-show-codes').checked = !!o.showCodes;
  $('section-dips-by-unit').checked = !!o.dipsByUnit;
  $('section-show-cross-labels').disabled = !o.showIntersections;
}

/* ==================================================== ventana flotante === */

let lastWidth = 0;
let lastScales = null;

/** Arrastre, redimensión y plegado: ver `floating.js`. */
function initFloating() {
  makeFloating({
    panel: $('section-view'),
    handle: $('section-drag'),
    grip: $('section-grip'),
    collapseBtn: $('btn-section-collapse'),
  });
  // Un cambio de ancho de la ventana re-escala el corte (el alto sale de 1:1).
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      const w = Math.max(320, Math.round($('section-chart-wrap').clientWidth) - 2);
      if (store.getState().section && w > 0 && Math.abs(w - lastWidth) > 2) renderSectionPanel();
    }).observe($('section-chart-wrap'));
  }
}

function row(parent, { color, what, num, className }) {
  const r = document.createElement('div');
  r.className = `sv-row${className ? ` ${className}` : ''}`;
  if (color) {
    const sw = document.createElement('span');
    sw.className = 'sv-swatch';
    sw.style.background = color;
    r.appendChild(sw);
  }
  const w = document.createElement('span');
  w.className = 'sv-what';
  w.textContent = what;
  const n = document.createElement('span');
  n.className = 'sv-num';
  n.textContent = num;
  r.append(w, n);
  parent.appendChild(r);
  return r;
}

function renderDipList(section, colorByUnit = null) {
  const lista = $('section-dip-list');
  lista.replaceChildren();
  $('section-dip-count').textContent = String(section.dips.length);

  for (const d of section.dips) {
    const tipo = STRUCTURE_TYPE_BY_ID.get(d.type);
    /*
     * El offset es el dato honesto de la proyección: una medida a dos
     * kilómetros del corte, dibujada sobre él, es una extrapolación, y quien
     * mire la figura tiene derecho a saber cuánto se estiró.
     */
    const unit = colorByUnit && d.unitId ? colorByUnit.get(d.unitId) : null;
    const r = row(lista, {
      color: unit || (tipo ? tipo.color : '#2dd4bf'),
      what: `${Math.round(d.strike)}/${Math.round(d.dip)}${tipo ? ` · ${tipo.short}` : ''}`,
      num: `${Math.round(d.apparent)}° ap · ${Math.round(d.offset)} m`,
      // Muy achatado: el corte va casi paralelo al rumbo y el aparente ya no
      // dice nada de la estructura.
      className: d.foreshortening < 0.35 ? 'faint' : '',
    });
    r.title =
      `True ${Math.round(d.strike)}/${Math.round(d.dip)} · apparent ${d.apparent.toFixed(1)}° ` +
      `on a section trending ${Math.round(d.sectionAzimuth)}° · projected ${Math.round(d.offset)} m ` +
      `${d.side > 0 ? 'from the left' : 'from the right'}` +
      (Number.isFinite(d.z) ? ` · ${Math.round(d.z)} m a.s.l.` : ' · no elevation in the model');
  }
  if (section.dips.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No measurement fell within reach of this section.';
    lista.appendChild(p);
  }
}

function renderCrossingList(section) {
  const lista = $('section-x-list');
  lista.replaceChildren();
  const encendidas = section.intersections.filter((x) => x.enabled !== false).length;
  $('section-x-count').textContent = `${encendidas}/${section.intersections.length}`;

  section.intersections.forEach((x, i) => {
    const tipo = LINE_TYPE_BY_ID.get(x.type);
    const r = row(lista, {
      color: tipo ? tipo.color : '#888',
      what: tipo ? tipo.label : x.type || 'line',
      num: `${(x.s / 1000).toFixed(2)} km`,
      className: x.enabled === false ? 'off' : '',
    });
    r.style.cursor = 'pointer';
    r.title = x.enabled === false ? 'Off — click to show it on the section' : 'Click to hide it';
    r.addEventListener('click', () => store.toggleIntersection(i));
  });
  if (section.intersections.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No mapped line crosses this section.';
    lista.appendChild(p);
  }
}

function renderContactList(section, colorByUnit = null) {
  const lista = $('section-c-list');
  lista.replaceChildren();
  const contactos = section.contacts || [];
  const on = contactos.filter((x) => x.enabled !== false).length;
  $('section-c-count').textContent = contactos.length ? `${on}/${contactos.length}` : '';

  contactos.forEach((k, i) => {
    const tipo = LINE_TYPE_BY_ID.get(k.type);
    const r = row(lista, {
      color: (colorByUnit && colorByUnit.get(k.type)) || (tipo ? tipo.color : '#888'),
      what: k.name || (tipo ? tipo.label : 'Contact'),
      num: `${(k.s / 1000).toFixed(2)} km · ${Math.round(k.offset)} m`,
      className: k.enabled === false ? 'off' : '',
    });
    r.style.cursor = 'pointer';
    r.title = `Projected from ${Math.round(k.offset)} m ${k.side > 0 ? 'left' : 'right'} of the profile. Click to ${k.enabled === false ? 'show' : 'hide'}.`;
    r.addEventListener('click', () => store.toggleContact(i));
  });
  if (contactos.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Use "Project contacts" to bring nearby contacts onto the profile.';
    lista.appendChild(p);
  }
}

/** La nota al pie: de dónde salen los números y qué NO dicen. */
function sectionNote(section) {
  const achatados = section.dips.filter((d) => d.foreshortening < 0.35).length;
  const lejos = section.dips.filter((d) => d.offset > 1000).length;
  const partes = [
    `Scale is true 1:1 at V.E. 1. Ticks show the APPARENT dip on this section, drawn at the angle you see; labels carry the apparent value.`,
  ];
  if (achatados) {
    partes.push(
      `${achatados} measurement(s) are drawn faint: the section runs nearly along their strike, so their apparent dip says little about the structure.`,
    );
  }
  if (lejos) {
    partes.push(`${lejos} were projected from over 1 km away — that is extrapolation, not measurement.`);
  }
  return partes.join(' ');
}

/* ================================================== franja de contactos === */

/** Barra flotante donde se fija el ancho de la franja, viéndola en el mapa. */
function renderBandBar(st) {
  const bar = $('pickband-bar');
  if (!st.pickBand) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const w = Math.round(st.pickBand.width);
  const largo = st.section ? st.section.length : 10000;
  const range = $('pickband-range');
  range.max = String(Math.max(1000, Math.round(largo / 2 / 100) * 100));
  if (document.activeElement !== range) range.value = String(Math.min(w, Number(range.max)));
  if (document.activeElement !== $('pickband-num')) $('pickband-num').value = String(w);
  $('pickband-note').textContent =
    `Band ±${w} m around the profile (${w * 2} m wide): contacts inside it are projected onto the section.`;
}

async function confirmBand() {
  const st = store.getState();
  if (!st.pickBand || !st.section) return;
  const width = st.pickBand.width;
  const lineas = st.features.filter((f) => f.geometry && f.geometry.type !== 'Point');
  const contactos = projectContacts(st.section.trace, lineas, width);

  /*
   * La cota de cada vértice del trazo, del mismo DEM del perfil: es lo que
   * hace que el contacto se dibuje a su altura y no como un punto sobre la
   * topografía. Un hueco sin dato queda como `null` y la línea se corta ahí.
   */
  if (contactos.some((k) => k.path && k.path.length)) {
    onBusy('Reading elevations along the contacts…');
    try {
      const sampler = samplerFor(st);
      const todos = contactos.flatMap((k) => (k.path || []).map((q) => q.lngLat));
      if (sampler.loadGrid && todos.length) await sampler.loadGrid(todos);
      for (const k of contactos) {
        const zs = await Promise.all(
          (k.path || []).map((q) => sampler.elevationAt(q.lngLat[0], q.lngLat[1]).catch(() => null)),
        );
        k.path = k.path.map((q, i) => [q.s, Number.isFinite(zs[i]) ? zs[i] : null]);
      }
    } catch (err) {
      // Sin cotas el contacto vuelve a dibujarse como punto, que es lo de antes.
      for (const k of contactos) delete k.path;
      onMessage(`Could not read elevations along the contacts (${err.message}); they are drawn as points.`, 'warn');
    } finally {
      onBusy(null);
    }
  }

  store.setSectionContacts(contactos, width);
  onMessage(
    contactos.length
      ? `${contactos.length} contact(s) projected from within ±${Math.round(width)} m.`
      : `No contact that doesn't already cross the profile lies within ±${Math.round(width)} m: try a wider band.`,
    'info',
  );
}

/* ======================================================= otra ventana === */

/** Dónde estaba el panel en el documento principal, para devolverlo. */
let anclaPanel = null;

function togglePopOut() {
  const abierta = getSectionPopup();
  if (abierta) {
    abierta.close(); // `pagehide` lo devuelve a su sitio
    return;
  }
  const panel = document.getElementById('section-view');
  const w = window.open('', 'fielddraw-section', 'popup=yes,width=1180,height=760');
  if (!w) {
    onMessage('The browser blocked the new window: allow pop-ups for this site and try again.');
    return;
  }
  // Mismas hojas de estilo y mismo tema que la ventana principal; las rutas
  // se vuelven absolutas porque la ventana nueva es about:blank.
  const d = w.document;
  d.open();
  d.write('<!doctype html><html><head><meta charset="utf-8"><title>FieldDraw — Structural section</title></head><body></body></html>');
  d.close();
  d.documentElement.className = document.documentElement.className;
  for (const a of document.documentElement.attributes) d.documentElement.setAttribute(a.name, a.value);
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
    const n = d.createElement('link');
    n.rel = 'stylesheet';
    n.href = l.href;
    d.head.appendChild(n);
  }
  const estilo = d.createElement('style');
  // Ocupa la ventana entera y ya no es flotante: ni arrastre ni esquina.
  estilo.textContent = `
    html, body { margin: 0; height: 100%; background: var(--panel-solid, #0d1117); overflow: hidden; }
    .section-view.popped { position: static !important; width: 100% !important;
      height: 100%; max-height: none; border: 0; border-radius: 0; box-shadow: none;
      box-sizing: border-box; padding: 8px 10px 10px; }
    .section-view.popped .sv-body { flex: 1; min-height: 0; }
    .section-view.popped #section-chart-wrap { max-height: none; flex: 1; min-height: 0; }
    .section-view.popped #section-grip, .section-view.popped #btn-section-collapse { display: none; }
    .section-view.popped #section-drag { cursor: default; }
  `;
  d.head.appendChild(estilo);

  anclaPanel = { parent: panel.parentNode, next: panel.nextSibling };
  setSectionPopup(w);
  d.body.appendChild(d.adoptNode(panel));
  panel.classList.add('popped');
  panel.classList.remove('collapsed');
  $('btn-section-popout').title = 'Bring the profile back into the app window';

  const volver = () => {
    if (getSectionPopup() !== w && !w.closed) return;
    setSectionPopup(null);
    panel.classList.remove('popped');
    if (anclaPanel) {
      anclaPanel.parent.insertBefore(document.adoptNode(panel), anclaPanel.next);
      anclaPanel = null;
    }
    $('btn-section-popout').title = 'Open the profile in its own window (drag it to another screen)';
    lastWidth = 0;
    renderSectionPanel();
  };
  w.addEventListener('pagehide', volver);
  // Mientras el panel vive en la otra ventana, el ancho lo da esa ventana.
  w.addEventListener('resize', () => renderSectionPanel());
  lastWidth = 0;
  renderSectionPanel();
}

/* ================================================= guardar y abrir fuera === */

function saveProfile() {
  const sec = store.getState().section;
  if (!sec) return;
  const sugerido = `Profile ${Math.round(sec.azimuth)}° · ${(sec.length / 1000).toFixed(1)} km`;
  const nombre = window.prompt('Name for this profile:', sugerido);
  if (nombre === null) return;
  const e = store.saveCurrentSection(nombre.trim() || sugerido);
  if (e) onMessage(`Saved "${e.name}" with its drawing. Its trace is on the map; reopen it from the Layers panel.`, 'info');
}

/** El perfil que se ve, sin el dibujo a mano, directo a StructuralSketcher. */
function openSketcher() {
  const st = store.getState();
  if (!st.section) return;
  const doc = sketcherDocument(st.section, {
    name: `FieldDraw section ${Math.round(st.section.azimuth)}°`,
    exaggeration: st.sectionOpts.exaggeration,
  });
  onMessage(sketcherMessage(openInSketcher(doc, `${baseName(st.section)}.sketch.json`)), 'info');
}

/* ========================================================== exportación === */

/** Nombre base estable para los cuatro archivos que salen de un mismo corte. */
function baseName(section) {
  const fecha = new Date().toISOString().slice(0, 10);
  return `fielddraw-section-${Math.round(section.azimuth)}deg-${fecha}`;
}

function exportSVG() {
  const s = store.getState().section;
  if (!s) return;
  downloadBlob(
    new Blob([sectionSVG($('section-chart'))], { type: 'image/svg+xml' }),
    `${baseName(s)}.svg`,
  );
  onMessage('Section exported as SVG — editable in Illustrator or Inkscape.', 'info');
}

async function exportPNG() {
  const s = store.getState().section;
  if (!s) return;
  onBusy('Rendering the image…');
  try {
    const blob = await sectionPNG($('section-chart'), { scale: 2 });
    downloadBlob(blob, `${baseName(s)}.png`);
    onMessage('Section exported as PNG at twice the on-screen size.', 'info');
  } catch (err) {
    onMessage(`Could not render the image: ${err.message}`);
  } finally {
    onBusy(null);
  }
}

function exportShapefile() {
  const s = store.getState().section;
  if (!s) return;
  const name = baseName(s);
  const bytes = structuralModellerZip(s, name);
  if (!bytes) {
    onMessage('There is nothing in this section to write to a shapefile yet.');
    return;
  }
  downloadBlob(new Blob([bytes], { type: 'application/zip' }), `${name}.zip`);
  onMessage(
    'Written as 3D shapefiles inside a zip: the lines (topography and crossings) and the dips as points. Open the lines file with "Import 3D shapefile" in Structural Modeller.',
    'info',
  );
}

function exportSketcher() {
  const st = store.getState();
  const s = st.section;
  if (!s) return;
  const doc = sketcherDocument(s, {
    name: `FieldDraw section ${Math.round(s.azimuth)}°`,
    exaggeration: st.sectionOpts.exaggeration,
  });
  downloadBlob(
    new Blob([JSON.stringify(doc)], { type: 'application/json' }),
    `${baseName(s)}.sketch.json`,
  );
  onMessage('Written as a StructuralSketcher project: open it there to interpret the section.', 'info');
}
