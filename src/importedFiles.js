/**
 * Archivos importados que sobreviven a cerrar la app.
 *
 * Un `.pmtiles` o un `.mbtiles` entra por un `<input type="file">`, y ese
 * `File` vive solo mientras dure la pestaña: al recargar, el mapa base offline
 * y el modelo de elevación desaparecían y había que volver a elegirlos a mano.
 * En terreno eso es abrir la app cada mañana y repetir la misma faena —con el
 * archivo metido en Archivos de iPadOS, a varios toques de distancia— antes de
 * poder trabajar.
 *
 * POR QUÉ IndexedDB Y NO OPFS
 *
 * Para archivos grandes lo natural sería el sistema de archivos privado del
 * origen, pero escribir ahí necesita `createWritable()`, que Safari no trae en
 * las versiones que corren en los iPad a los que apunta esta app; el sustituto
 * —`createSyncAccessHandle()`— solo existe dentro de un Worker dedicado, o sea
 * un camino de código aparte mantenido solo para iOS.
 *
 * IndexedDB guarda un `File` tal cual en todos los navegadores donde la app ya
 * funciona, el navegador lo respalda en disco y no en memoria, y —esto es lo
 * que importa— lo que se recupera sigue siendo un `File`: conserva su `.name`,
 * de donde PMTiles saca la clave del archivo, y su `.slice()`, que es como lee
 * por rangos sin cargarlo entero. Un mapa de varios GB sigue funcionando igual
 * que recién elegido a mano.
 */

import { STORE_FILES, del, getAll, put } from './idb.js';

/**
 * Guarda un archivo ya abierto con éxito para la próxima sesión.
 *
 * `role` distingue el modelo de elevación —del que hay uno solo— de los mapas
 * offline, de los que puede haber varios: es lo que permite al arranque volver
 * a enchufar cada uno donde iba sin adivinar por el nombre.
 */
export function rememberImportedFile({ id, role, file }) {
  return put(STORE_FILES, {
    id,
    role,
    file,
    // Copiados fuera del `File` para poder listar y avisar sin tocar los
    // bytes, que es lo caro.
    name: file.name,
    bytes: file.size,
    savedAt: Date.now(),
  });
}

/** Todo lo guardado, en el orden en que se importó. */
export async function listImportedFiles() {
  const all = await getAll(STORE_FILES);
  return all.slice().sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
}

export function forgetImportedFile(id) {
  return del(STORE_FILES, id);
}

/**
 * Olvida todo lo de un rol. Lo usa el modelo de elevación al cargar uno nuevo:
 * solo puede haber uno activo, y sin esto cada DEM que se probara quedaría
 * ocupando disco para siempre.
 */
export async function forgetImportedFilesByRole(role) {
  const all = await getAll(STORE_FILES);
  for (const rec of all) {
    if (rec.role === role) await del(STORE_FILES, rec.id);
  }
}
