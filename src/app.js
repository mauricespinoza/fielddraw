import * as store from './store.js';
import { createMapView } from './mapView.js';
import {
  closeOverlays,
  initUI,
  openPropsMenu,
  renderPointerInfo,
  showBanner,
  wireLocate,
  wireMapView,
} from './ui.js';
import { openStraboAttrs } from './strabo/panel.js';
import {
  loadSavedFeatures,
  loadSavedOpenTopoKey,
  loadSavedOrnaments,
  loadSavedStraboStyle,
  loadSavedStructureStyle,
  loadSavedUnits,
  saveFeatures,
  saveOrnaments,
  saveStraboStyle,
  saveStructureStyle,
  saveUnits,
} from './persistence.js';

initUI();

const view = createMapView({
  onPointerInfo: renderPointerInfo,
  onContourError: (msg) => showBanner(`Curvas de nivel no disponibles: ${msg}`),
  onEditMessage: showBanner,
  onOpenProps: openPropsMenu,
  // Cualquier toque sobre el mapa cierra lo que estuviera abierto encima.
  onMapTap: closeOverlays,
  onStraboFeatureTap: openStraboAttrs,
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
const savedStraboStyle = loadSavedStraboStyle();
if (savedStraboStyle) store.setStraboStyle(savedStraboStyle);
// La clave de OpenTopography es del dispositivo, no del proyecto: se recupera
// aquí y no se toca al abrir un .fdproj.
const savedOpenTopoKey = loadSavedOpenTopoKey();
if (savedOpenTopoKey) store.setOpenTopoKey(savedOpenTopoKey);
const saved = loadSavedFeatures();
if (saved.length) store.loadFeatures(saved);

// Autosave con debounce: dibujar genera muchos cambios seguidos.
let saveTimer = null;
store.subscribe(() => {
  if (store.changed('units')) saveUnits(store.getState().units);
  if (store.changed('ornaments')) saveOrnaments(store.getState().ornaments);
  if (store.changed('structureStyle')) saveStructureStyle(store.getState().structureStyle);
  if (store.changed('straboStyle')) saveStraboStyle(store.getState().straboStyle);
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
}
