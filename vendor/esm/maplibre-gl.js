/**
 * Puente ESM sobre el build UMD de MapLibre.
 *
 * El import map apunta aquí en vez de a esm.sh. El motivo es el modo offline:
 * los bundles de esm.sh y de jsdelivr no son un archivo único, sino un módulo
 * que a su vez importa rutas del propio CDN, así que copiarlos a `vendor/` deja
 * imports colgando contra un origen que en terreno no existe. El build UMD sí
 * es un archivo autocontenido.
 *
 * `index.html` carga `vendor/maplibre-gl.js` como script clásico antes que
 * cualquier módulo —los scripts clásicos corren antes que los `type="module"`,
 * que van diferidos—, así que para cuando esto se evalúa el global ya está.
 */
if (!globalThis.maplibregl) {
  throw new Error(
    'maplibre-gl no está cargado: falta <script src="./vendor/maplibre-gl.js"> antes de los módulos.',
  );
}

export default globalThis.maplibregl;
