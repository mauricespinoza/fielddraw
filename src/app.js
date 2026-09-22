import * as store from './store.js';
import { createMapView } from './mapView.js';
import {
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
import { openStraboAttrs } from './strabo/panel.js';
import {
  loadSavedControlPointStyle,
  loadSavedFeatures,
  loadSavedImportStyle,
  loadSavedOpenTopoKey,
  loadSavedOrnaments,
  loadSavedStraboStyle,
  loadSavedStructureStyle,
  loadSavedUnits,
  saveControlPointStyle,
  saveFeatures,
  saveImportStyle,
  saveOrnaments,
  saveStraboStyle,
  saveStructureStyle,
  saveUnits,
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
store.subscribe(() => {
  if (store.changed('units')) saveUnits(store.getState().units);
  if (store.changed('ornaments')) saveOrnaments(store.getState().ornaments);
  if (store.changed('structureStyle')) saveStructureStyle(store.getState().structureStyle);
  if (store.changed('controlPointStyle')) saveControlPointStyle(store.getState().controlPointStyle);
  if (store.changed('straboStyle')) saveStraboStyle(store.getState().straboStyle);
  if (store.changed('importStyle')) saveImportStyle(store.getState().importStyle);
  if (!store.changed('features')) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveFeatures(store.getState().features), 500);
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
  const registrar = () => {
    navigator.serviceWorker
      .register(new URL('../sw.js', import.meta.url), { scope: './' })
      .catch((err) => console.warn('[sw] no se pudo registrar:', err));
  };
  // Se espera a `load` para no competir por ancho de banda con el arranque del
  // mapa, pero si la página ya terminó de cargar el evento no volverá a
  // dispararse y quedaríamos sin registrar nunca.
  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar, { once: true });

  /*
   * Se recarga una vez cuando un service worker NUEVO toma el control.
   *
   * Sin esto, publicar una versión no llegaba a quien ya tenía la app
   * abierta o instalada: `sw.js` cachea el HTML en red-primero pero los
   * módulos en caché-primero, así que el shell nuevo se ejecutaba con los
   * módulos viejos hasta la SIGUIENTE navegación —y en una PWA de pantalla de
   * inicio, "la siguiente navegación" puede no llegar nunca—. `skipWaiting` +
   * `clients.claim` en el propio `sw.js` hacen que el nuevo worker tome el
   * control sin esperar a que se cierren las pestañas; a esto solo le
   * faltaba refrescar la página para que ese control se notara.
   *
   * `controllerchange` dispara igual la PRIMERA vez que se instala —pasar de
   * «sin worker» a «con worker» también es un cambio—, y ahí no hace falta
   * recargar nada: lo que ya está corriendo se pidió a la red tal cual,
   * directo, así que no puede estar desactualizado. La distinción es de
   * qué había ANTES de registrar: si ya existía un controlador, lo que
   * llega después es una versión nueva reemplazando a una vieja.
   */
  const habiaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habiaControlador) location.reload();
  });
}

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
