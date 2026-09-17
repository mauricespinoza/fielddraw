const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

/**
 * Si se puede o no bajar un basemap por adelantado para llevárselo a terreno.
 *
 * No es una decisión técnica —bajar teselas es igual de fácil en todos— sino
 * de términos de uso, y la diferencia es de quién paga el servidor:
 *
 * - `'blocked'`: la política del proveedor lo **prohíbe explícitamente**. La
 *   de OpenStreetMap nombra el caso con estas palabras —«Download
 *   city/country for offline use», «Save area for later»— y advierte que ese
 *   patrón se bloquea sin aviso, porque son servidores de una fundación
 *   pagados con donaciones. OpenTopoMap es un proyecto voluntario aún más
 *   pequeño y corre la misma suerte. Construir aquí el botón sería gastarles
 *   el ancho de banda a ellos y hacer que les bloqueen la IP al geólogo.
 * - `'capped'`: un CDN comercial dimensionado para volumen, del que la app ya
 *   depende para navegar. Se permite, con tope y diciéndolo.
 *
 * Quien necesite cobertura garantizada de un basemap tiene la vía limpia y
 * sin asteriscos: convertirlo a PMTiles e importarlo. Está documentado en el
 * README y es lo que la interfaz ofrece cuando esto dice `'blocked'`.
 */
export const PREFETCH_BLOCKED = 'blocked';
export const PREFETCH_CAPPED = 'capped';

/**
 * Solo fuentes usables sin token y sin violar términos de servicio.
 * Google Satellite (mt1.google.com/vt) queda deliberadamente fuera: funciona,
 * pero incumple los ToS de Google. Esri World Imagery cubre bien Chile.
 *
 * Ojo: los servicios de Esri usan orden {z}/{y}/{x}, no {z}/{x}/{y}.
 */
export const BASEMAPS = [
  {
    id: 'esri-imagery',
    label: 'Esri — Imagery',
    tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxzoom: 19,
    // Esri ArcGIS Online: CDN comercial; se permite con tope.
    prefetch: PREFETCH_CAPPED,
  },
  {
    id: 'esri-topo',
    label: 'Esri — Topographic',
    tiles: [`${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, HERE, Garmin, USGS, INTERMAP',
    maxzoom: 19,
    // Esri ArcGIS Online: CDN comercial; se permite con tope.
    prefetch: PREFETCH_CAPPED,
  },
  {
    id: 'esri-terrain',
    label: 'Esri — Terrain',
    tiles: [`${ESRI}/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, USGS, NOAA',
    maxzoom: 13,
    // Esri ArcGIS Online: CDN comercial; se permite con tope.
    prefetch: PREFETCH_CAPPED,
  },
  {
    id: 'esri-hillshade',
    label: 'Esri — Hillshade',
    tiles: [`${ESRI}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, Airbus DS, USGS, NGA, NASA',
    maxzoom: 16,
    // Esri ArcGIS Online: CDN comercial; se permite con tope.
    prefetch: PREFETCH_CAPPED,
  },
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)',
    maxzoom: 17,
    // Proyecto voluntario con servidores propios muy modestos.
    prefetch: PREFETCH_BLOCKED,
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors',
    maxzoom: 19,
    // La Tile Usage Policy de la OSMF prohibe la descarga masiva.
    prefetch: PREFETCH_BLOCKED,
  },
];

/** Terrain-RGB de dominio público (AWS Open Data) para curvas en el cliente. */
export const TERRARIUM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
