import * as store from './store.js';
import { createMapView } from './mapView.js';
import {
  allowUnload,
  closeOverlays,
  initUI,
  openImportedAttrs,
  openPropsMenu,
  renderDigitizePreview,
  renderScale,
  restoreImportedFiles,
  showBanner,
  wireLocate,
  wireMapView,
} from './ui.js';
import { openLockedAttrs, openStraboAttrs } from './strabo/panel.js';
import {
  loadSavedControlPointStyle,
  loadNewerFeatures,
  loadSavedFeatures,
  loadSavedSections,
  saveSections,
  loadSavedImportStyle,
  loadSavedOpenTopoKey,
  loadSavedOrnaments,
  loadSavedStraboDatasets,
  loadSavedStraboStyle,
  loadSavedStructureStyle,
  loadSavedUnits,
  saveControlPointStyle,
  saveFeatures,
  saveImportStyle,
  saveOrnaments,
  saveStraboDatasets,
  saveStraboStyle,
  saveStructureStyle,
  saveUnits,
  savedFeaturesTime,
} from './persistence.js';

initUI();

const view = createMapView({
  // El HUD de diagnóstico del lápiz (presión, inclinación, altitud) se quitó
  // de la interfaz; el cálculo sigue intacto en drawController/mapView —no
  // hay nada más que dependa de él— así que aquí solo hace falta un callback
  // que no haga nada.
  onPointerInfo: () => {},
  onContourError: (msg) => showBanner(`Curvas de nivel no disponibles: ${msg}`),
  onEditMessage: showBanner,
  onOpenProps: openPropsMenu,
  // Cualquier toque sobre el mapa cierra lo que estuviera abierto encima.
  onMapTap: closeOverlays,
  onStraboFeatureTap: openStraboAttrs,
  onLockedFeatureTap: openLockedAttrs,
  onImportedFeatureTap: openImportedAttrs,
  onScale: renderScale,
  onDigitizePreview: renderDigitizePreview,
});

wireLocate(() => view.locateMe());
// La interfaz necesita el mapa para encuadrar la traza de un perfil pedido
// desde el menú de propiedades; `createMapView` no existe hasta aquí.
wireMapView(view);

// Restaurar el trabajo previo. Las unidades primero: los polígonos guardados
// referencian sus ids, y sin ellas se dibujarían con el color por defecto.
const savedUnits = loadSavedUnits();
if (savedUnits) store.loadUnits(savedUnits);
const savedOrnaments = loadSavedOrnaments();
if (savedOrnaments) store.setOrnaments(savedOrnaments);
const savedStructureStyle = loadSavedStructureStyle();
if (savedStructureStyle) store.setStructureStyle(savedStructureStyle);
const savedControlPointStyle = loadSavedControlPointStyle();
if (savedControlPointStyle) store.setControlPointStyle(savedControlPointStyle);
const savedStraboStyle = loadSavedStraboStyle();
if (savedStraboStyle) store.setStraboStyle(savedStraboStyle);
const savedImportStyle = loadSavedImportStyle();
if (savedImportStyle) store.setImportStyle(savedImportStyle);
// La clave de OpenTopography es del dispositivo, no del proyecto: se recupera
// aquí y no se toca al abrir un .fdproj.
const savedOpenTopoKey = loadSavedOpenTopoKey();
if (savedOpenTopoKey) store.setOpenTopoKey(savedOpenTopoKey);
const saved = loadSavedFeatures();
if (saved.length) store.loadFeatures(saved);
// Si localStorage se llenó, la copia buena es la de IndexedDB: llega un
// instante después y solo se pone si todavía no se tocó el dibujo.
{
  const atStart = store.getState().features;
  loadNewerFeatures(savedFeaturesTime()).then((newer) => {
    if (newer && store.getState().features === atStart) store.loadFeatures(newer);
  });
}
// Después del dibujo y no antes: un dataset ya abierto se reconoce por sus
// elementos en el dibujo, y sin ellos cargados se daría por vacío.
const savedSections = loadSavedSections();
if (savedSections) store.loadSavedSections(savedSections);
const savedStraboDatasets = loadSavedStraboDatasets();
if (savedStraboDatasets) store.loadStraboDatasets(savedStraboDatasets);

/*
 * Los mapas offline y el modelo de elevación de la sesión anterior.
 *
 * Aparte del resto y sin que nadie lo espere: leerlos de IndexedDB es
 * asíncrono y un `.mbtiles` grande tarda, mientras que el dibujo guardado ya
 * está puesto y se puede trabajar sobre él. Si el mapa todavía no montó su
 * estilo cuando llegan, `mapView` los encuentra en el store al montarlo; si ya
 * lo montó, se enchufan por la suscripción de siempre.
 */
restoreImportedFiles();

// Autosave con debounce: dibujar genera muchos cambios seguidos.
let saveTimer = null;
let straboSaveTimer = null;
store.subscribe(() => {
  if (store.changed('units')) saveUnits(store.getState().units);
  if (store.changed('ornaments')) saveOrnaments(store.getState().ornaments);
  if (store.changed('structureStyle')) saveStructureStyle(store.getState().structureStyle);
  if (store.changed('controlPointStyle')) saveControlPointStyle(store.getState().controlPointStyle);
  if (store.changed('straboStyle')) saveStraboStyle(store.getState().straboStyle);
  if (store.changed('importStyle')) saveImportStyle(store.getState().importStyle);
  if (store.changed('straboDatasets') || store.changed('layers')) {
    clearTimeout(straboSaveTimer);
    straboSaveTimer = setTimeout(() => saveStraboDatasets(store.currentStraboDatasets()), 500);
  }
  if (store.changed('savedSections')) saveSections(store.getState().savedSections);
  if (!store.changed('features')) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushFeatures, 500);
});

/** Guarda ya el dibujo pendiente; avisa una vez si no cupo en ningún lado. */
let saveFailNoticed = false;
function flushFeatures() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  saveFeatures(store.getState().features).then((ok) => {
    if (ok || saveFailNoticed) return;
    saveFailNoticed = true;
    showBanner('Autosave failed: browser storage is full. Use “Save project…” to keep a copy of your work.');
  });
}

// Al pasar a segundo plano o cerrar: en iOS no hay `beforeunload` y lo de los
// últimos 500 ms se perdía. `pagehide` y `visibilitychange` sí llegan.
addEventListener('pagehide', flushFeatures);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushFeatures();
});

/*
 * Service worker: es lo que permite abrir la app sin señal.
 *
 * Solo se registra en un contexto seguro —HTTPS o localhost—, que es lo que
 * exige la plataforma. Servida por IP en la red local (http://192.168.x.x) la
 * app funciona igual, pero sin modo offline: el navegador no deja instalar un
 * service worker sobre http. Por eso no se avisa de nada en ese caso: no es un
 * error, es que ese despliegue no puede ofrecerlo.
 */
if ('serviceWorker' in navigator && window.isSecureContext) {
  /*
   * VERSIONES NUEVAS: SOLO AL ARRANCAR, Y SOLO SI LLEGARON ENTERAS.
   *
   * `sw.js` ya no se instala a medias (ver su `install`) ni toma el control
   * por su cuenta. Una versión nueva queda esperando, y se aplica:
   *
   * - al abrir la app, si ya estaba esperando: es el único momento en que
   *   recargar no interrumpe nada, y la recarga sale entera de caché, sin red;
   * - en los primeros segundos de la sesión, si termina de bajar entonces;
   * - si llega con la sesión ya en marcha, se avisa y se aplica la próxima
   *   vez que se abra. Antes la página se recargaba sola en mitad del
   *   trabajo, y con señal mala esa recarga era la que dejaba el mapa vacío.
   */
  const ARRANQUE_MS = 15000;
  let pedida = false;
  const aplicar = (worker) => {
    if (!worker || pedida) return;
    pedida = true;
    worker.postMessage('skipWaiting');
  };
  const nueva = (reg) => {
    const w = reg.waiting;
    if (!w || !navigator.serviceWorker.controller) return;
    if (performance.now() < ARRANQUE_MS) aplicar(w);
    else showBanner('A new version of FieldDraw is ready. It will load the next time you open the app.', 'info');
  };

  const registrar = () => {
    navigator.serviceWorker
      .register(new URL('../sw.js', import.meta.url), { scope: './' })
      .then((reg) => {
        nueva(reg);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed') nueva(reg);
          });
        });
      })
      .catch((err) => console.warn('[sw] no se pudo registrar:', err));
  };
  // Se espera a `load` para no competir por ancho de banda con el arranque del
  // mapa, pero si la página ya terminó de cargar el evento no volverá a
  // dispararse y quedaríamos sin registrar nunca.
  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar, { once: true });

  // Solo se recarga cuando ESTA página pidió el cambio: si lo pidió otra
  // pestaña, esta sigue con lo que tiene en vez de recargarse a media faena.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!pedida) return;
    // Lo dibujado ya está autoguardado: el aviso de «¿salir sin guardar?»
    // aquí solo estorbaría una recarga que nadie pidió a mano.
    flushFeatures();
    allowUnload();
    location.reload();
  });
}

/*
 * Huecos del mapa tras un corte de señal.
 *
 * MapLibre no reintenta una tesela fallida, así que lo que no llegó durante
 * un corte seguía en blanco al volver la señal. Al volver (`online`), al
 * volver a la app, y cada rato mientras queden huecos, se piden otra vez:
 * lo que ya está en caché sale al instante y lo demás se intenta con la red
 * que haya. Con `online` se recargan también las rellenadas con la tesela
 * padre ampliada, para cambiarlas por la de verdad.
 */
addEventListener('online', () => view.retryFailedTiles({ all: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') view.retryFailedTiles();
});
setInterval(() => {
  if (document.visibilityState === 'visible') view.retryFailedTiles();
}, 20000);

/*
 * Pide almacenamiento persistente.
 *
 * Sin esto, la caché de teselas y el proyecto en localStorage son "best
 * effort": el navegador puede evictarlos bajo presión de disco sin avisar, y
 * en iOS Safari una PWA no instalada a pantalla de inicio los pierde tras
 * ~7 días sin abrirse. El permiso se concede solo (Chrome/Edge, con la app ya
 * usada un poco) o se deniega en silencio (Safari fuera de pantalla de
 * inicio); no hay diálogo que interrumpa. No es awaitable de forma útil aquí
 * —nada depende del resultado— así que no se espera la promesa.
 */
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {
    /* API presente pero rechazada: sin persist() la caché sigue funcionando,
     * solo sin la garantía. */
  });
}
