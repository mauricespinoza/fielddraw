/**
 * La base IndexedDB de la app, y nada más.
 *
 * Existe para que dos cosas distintas —los archivos importados que sobreviven
 * a recargar y el manifiesto de las áreas descargadas— compartan una sola
 * base, una sola versión y un solo camino de migración. Tenerlas en dos bases
 * separadas obligaría a llevar dos versiones en paralelo y a acordarse de
 * subir la correcta; tenerlas en un módulo que se llame como una de las dos
 * dejaría a la otra importando algo que no le corresponde.
 *
 * Todo lo de aquí puede fallar sin que la app se caiga: en modo privado, con
 * el almacenamiento bloqueado o con la cuota llena, IndexedDB no está y lo
 * único que se pierde es la memoria entre sesiones.
 */

const DB_NAME = 'fielddraw';

/**
 * Sube con cada almacén nuevo. v1 traía solo los archivos importados; v2
 * añade el manifiesto de áreas descargadas.
 */
const DB_VERSION = 2;

export const STORE_FILES = 'imported-files';
export const STORE_AREAS = 'offline-areas';

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
        // Idempotente a propósito: al subir de v1 a v2 el almacén de archivos
        // ya existe y solo falta el de áreas.
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_AREAS)) {
          db.createObjectStore(STORE_AREAS, { keyPath: 'id' });
        }
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
export function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

/**
 * Abre una transacción sobre un almacén y le pasa el objeto a `fn`.
 *
 * `fn` recibe el object store y devuelve lo que quiera —normalmente una
 * promesa de `done()`—. La transacción se cierra sola cuando se vacía la cola
 * de peticiones, que es como funciona IndexedDB: no hay que confirmarla.
 */
export async function withStore(name, mode, fn) {
  const db = await openDb();
  const tx = db.transaction(name, mode);
  return fn(tx.objectStore(name));
}

/** Todo lo de un almacén, tal cual está guardado. */
export async function getAll(name) {
  const all = await withStore(name, 'readonly', (st) => done(st.getAll()));
  return all || [];
}

export function put(name, value) {
  return withStore(name, 'readwrite', (st) => done(st.put(value)));
}

export function del(name, key) {
  return withStore(name, 'readwrite', (st) => done(st.delete(key)));
}
