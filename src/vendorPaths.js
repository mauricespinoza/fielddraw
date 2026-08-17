/**
 * Rutas a las dependencias que viven en `vendor/`.
 *
 * Se resuelven contra `import.meta.url` y no contra la página, para que la app
 * funcione igual servida en la raíz de un dominio o en un subdirectorio
 * (`usuario.github.io/fielddraw/`, por ejemplo). Como este módulo vive en
 * `src/`, `../vendor/` siempre apunta bien, sin importar desde qué carpeta lo
 * importe quien lo use.
 */
export const vendorUrl = (file) => new URL(`../vendor/${file}`, import.meta.url).href;

/**
 * Base de la carpeta de fuentes, con la barra final. Se concatena en vez de
 * pasar por `new URL()` porque MapLibre necesita los marcadores `{fontstack}` y
 * `{range}` literales, y `new URL()` los escaparía a %7B…%7D.
 */
export const vendorBase = () => new URL('../vendor/', import.meta.url).href;

/** Carga un script clásico una sola vez. Lo comparten sql.js, JSTS y PMTiles. */
const loaded = new Map();
export function loadVendorScript(file) {
  let p = loaded.get(file);
  if (!p) {
    const src = vendorUrl(file);
    p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(s);
    });
    loaded.set(file, p);
  }
  return p;
}
