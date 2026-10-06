/**
 * "Open in StructuralSketcher": llevar el perfil que se está viendo a la webapp.
 *
 * StructuralSketcher guarda su proyecto en el `localStorage` de su origen
 * (`structuralsketcher.project.v1`) y lo recupera al arrancar. FieldDraw y el
 * Sketcher se publican bajo el mismo origen (`mauricespinoza.github.io`), así
 * que desde aquí se puede dejar el documento en esa clave y abrir la app, que lo
 * restaura sola: el perfil aparece cargado sin pasar por un archivo.
 *
 * Si FieldDraw corre desde otro origen (un servidor local, otro dominio) el
 * navegador no deja escribir en el almacenamiento del Sketcher; entonces se
 * descarga el `.sketch.json` y se abre la app para que lo abra con "Open".
 */

import { downloadBlob } from './persistence.js';

export const SKETCHER_URL = 'https://mauricespinoza.github.io/StructuralSketcher/';
const STORAGE_KEY = 'structuralsketcher.project.v1';

/**
 * @param {object} doc          documento de `sketcherDocument`
 * @param {string} filename     nombre del respaldo si hay que descargarlo
 * @returns {'direct'|'download'|'cancelled'}
 */
export function openInSketcher(doc, filename) {
  const text = JSON.stringify(doc);
  let sameOrigin = false;
  try {
    sameOrigin = window.location.origin === new URL(SKETCHER_URL).origin;
  } catch {
    sameOrigin = false;
  }

  if (sameOrigin) {
    try {
      const prev = window.localStorage.getItem(STORAGE_KEY);
      if (prev && prev !== text) {
        const ok = window.confirm(
          'StructuralSketcher has a section autosaved in this browser. Opening this profile replaces it. Continue?',
        );
        if (!ok) return 'cancelled';
      }
      window.localStorage.setItem(STORAGE_KEY, text);
      window.open(SKETCHER_URL, '_blank', 'noopener');
      return 'direct';
    } catch {
      /* almacenamiento bloqueado o lleno: se cae al archivo */
    }
  }

  downloadBlob(new Blob([text], { type: 'application/json' }), filename);
  window.open(SKETCHER_URL, '_blank', 'noopener');
  return 'download';
}

export function sketcherMessage(result) {
  return result === 'direct'
    ? 'Opened in StructuralSketcher — the profile is already loaded there.'
    : 'Downloaded the profile as .sketch.json and opened StructuralSketcher: use its Open button to load it.';
}
