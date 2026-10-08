/**
 * Dónde vive ahora el panel del perfil: en la ventana principal o, tras «⧉»,
 * en una ventana aparte (ver `popOut` en `sectionPanel.js`).
 *
 * El panel se MUDA de documento con `adoptNode`, así que sus elementos
 * conservan sus manejadores, pero `document.getElementById` de la ventana
 * principal deja de verlos. Todo el código del perfil busca por aquí.
 */

let popup = null;

export const setSectionPopup = (w) => {
  popup = w;
};
export const getSectionPopup = () => (popup && !popup.closed ? popup : null);

/** El elemento por id, esté el panel donde esté. */
export function byId(id) {
  return document.getElementById(id) || (getSectionPopup() && getSectionPopup().document.getElementById(id));
}

/** `querySelectorAll` dentro del panel, esté donde esté. */
export function panelAll(selector) {
  const root = byId('section-view') || document;
  return root.querySelectorAll(selector);
}
