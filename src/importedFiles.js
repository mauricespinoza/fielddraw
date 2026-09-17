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

const DB_NAME = 'fielddraw';
const DB_VERSION = 1;
const STORE = 'imported-files';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in globalThis) || !globalThis.indexedDB) {
        reject(new Error('this browser has no IndexedDB'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('could not open IndexedDB'));
      // Safari en modo privado puede dejar la apertura bloqueada en vez de
      // fallar; sin esto, el `await` de quien llame no vuelve nunca.
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
    // Un fallo puntual no debe dejar la promesa rota cacheada para siempre.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** Promesa de una petición de IndexedDB, que es API de eventos y no de promesas. */
function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

/**
 * Guarda un archivo ya abierto con éxito para la próxima sesión.
 *
 * `role` distingue el modelo de elevación —del que hay uno solo— de los mapas
 * offline, de los que puede haber varios: es lo que permite al arranque volver
 * a enchufar cada uno donde iba sin adivinar por el nombre.
 */
export async function rememberImportedFile({ id, role, file }) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await done(
    tx.objectStore(STORE).put({
      id,
      role,
      file,
      // Copiados fuera del `File` para poder listar y avisar sin tocar los
      // bytes, que es lo caro.
      name: file.name,
      bytes: file.size,
      savedAt: Date.now(),
    }),
  );
}

/** Todo lo guardado, en el orden en que se importó. */
export async function listImportedFiles() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const all = await done(tx.objectStore(STORE).getAll());
  return (all || []).slice().sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
}

export async function forgetImportedFile(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await done(tx.objectStore(STORE).delete(id));
}

/**
 * Olvida todo lo de un rol. Lo usa el modelo de elevación al cargar uno nuevo:
 * solo puede haber uno activo, y sin esto cada DEM que se probara quedaría
 * ocupando disco para siempre.
 */
export async function forgetImportedFilesByRole(role) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const st = tx.objectStore(STORE);
  const all = await done(st.getAll());
  for (const rec of all || []) {
    if (rec.role === role) st.delete(rec.id);
  }
}
