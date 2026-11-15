/**
 * Historial de versiones del proyecto, en el propio dispositivo.
 *
 * El autoguardado de siempre guarda UNA copia, que se pisa con la siguiente:
 * protege de cerrar la app de golpe, pero no de un error de edición (borrar
 * una capa entera, un «New project» sin querer, abrir otro proyecto encima)
 * descubierto media hora después. Esto guarda fotos del proyecto —el mismo
 * contenido que `.fdproj.json.gz`— en IndexedDB, comprimidas, con un tope:
 *
 * - las últimas `keepRecent` fotos, sean del momento que sean;
 * - además, la última de cada día de los últimos `keepDays` días.
 *
 * Una foto igual a la anterior (misma huella) no se guarda: dejar la app
 * abierta toda la noche no llena el historial de copias idénticas.
 *
 * Igual que todo lo de IndexedDB, puede fallar sin romper nada: sin almacén,
 * no hay historial y ya.
 */

import { STORE_SNAPSHOTS, del, getAll, put } from './idb.js';

export const KEEP_RECENT = 30;
export const KEEP_DAYS = 14;

/** Por qué se tomó una foto: se muestra en el historial. */
export const SNAPSHOT_REASONS = {
  auto: 'Autosave',
  'before-open': 'Before opening another project',
  'before-new': 'Before starting a new project',
  'before-restore': 'Before restoring a version',
  manual: 'Saved by hand',
};

/** Día local `AAAA-MM-DD` de una hora en ms. */
function dia(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Qué fotos sobran según la política de arriba. Pura: recibe
 * `[{id, savedAt}]` en cualquier orden y devuelve los ids a borrar.
 */
export function planPrune(list, now = Date.now(), { keepRecent = KEEP_RECENT, keepDays = KEEP_DAYS } = {}) {
  const orden = [...list].sort((a, b) => b.savedAt - a.savedAt);
  const quedan = new Set(orden.slice(0, keepRecent).map((s) => s.id));
  const limite = now - keepDays * 86400e3;
  const vistos = new Set();
  for (const s of orden) {
    if (s.savedAt < limite) continue;
    const d = dia(s.savedAt);
    if (vistos.has(d)) continue;
    vistos.add(d); // la primera de cada día en orden descendente es la última del día
    quedan.add(s.id);
  }
  return orden.filter((s) => !quedan.has(s.id)).map((s) => s.id);
}

let ultimaHuella = null;

/**
 * Guarda una foto. `blob` ya viene comprimido (lo prepara `backup.js`, que
 * comparte la misma serialización con Drive).
 *
 * @param {{blob: Blob, hash: string, name: string, features: number, plainBytes: number, reason?: string, force?: boolean}} s
 * @returns {Promise<'saved'|'same'|'failed'>}
 */
export async function takeSnapshot({ blob, hash, name, features, plainBytes, reason = 'auto', force = false }) {
  try {
    if (ultimaHuella === null) {
      const todas = await getAll(STORE_SNAPSHOTS);
      const ultima = todas.sort((a, b) => b.savedAt - a.savedAt)[0];
      ultimaHuella = ultima ? ultima.hash : '';
    }
    if (!force && hash === ultimaHuella) return 'same';
    const savedAt = Date.now();
    await put(STORE_SNAPSHOTS, {
      id: `${savedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      savedAt,
      name: name || '',
      reason,
      features,
      bytes: blob.size,
      plainBytes,
      hash,
      blob,
    });
    ultimaHuella = hash;
    const todas = await getAll(STORE_SNAPSHOTS);
    for (const id of planPrune(todas, savedAt)) await del(STORE_SNAPSHOTS, id);
    return 'saved';
  } catch (err) {
    console.warn('[historial] no se pudo guardar la foto:', err);
    return 'failed';
  }
}

/** Las fotos, de la más reciente a la más antigua (sin cargar nada extra: el Blob es una referencia). */
export async function listSnapshots() {
  try {
    const todas = await getAll(STORE_SNAPSHOTS);
    return todas.filter((s) => s && s.blob).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Nombre de archivo de una foto, para abrirla o descargarla. */
export function snapshotFilename(s) {
  const slug =
    (s.name || 'fielddraw')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'fielddraw';
  const d = new Date(s.savedAt);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const gz = s.blob && s.blob.type === 'application/gzip';
  return `${slug}-${dia(s.savedAt)}-${hhmm}.fdproj.json${gz ? '.gz' : ''}`;
}

export async function deleteSnapshot(id) {
  try {
    await del(STORE_SNAPSHOTS, id);
  } catch {
    /* ignorar */
  }
  ultimaHuella = null;
}
