/** Puente ESM sobre el build UMD de maplibre-contour. Ver ./maplibre-gl.js. */
if (!globalThis.mlcontour) {
  throw new Error(
    'maplibre-contour no está cargado: falta <script src="./vendor/maplibre-contour.js"> antes de los módulos.',
  );
}

export default globalThis.mlcontour;
