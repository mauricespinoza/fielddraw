const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

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
    label: 'Esri — Satélite',
    tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxzoom: 19,
  },
  {
    id: 'esri-topo',
    label: 'Esri — Topográfico',
    tiles: [`${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, HERE, Garmin, USGS, INTERMAP',
    maxzoom: 19,
  },
  {
    id: 'esri-terrain',
    label: 'Esri — Terreno',
    tiles: [`${ESRI}/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, USGS, NOAA',
    maxzoom: 13,
  },
  {
    id: 'esri-hillshade',
    label: 'Esri — Sombreado',
    tiles: [`${ESRI}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, Airbus DS, USGS, NGA, NASA',
    maxzoom: 16,
  },
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)',
    maxzoom: 17,
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors',
    maxzoom: 19,
  },
];

/** Terrain-RGB de dominio público (AWS Open Data) para curvas en el cliente. */
export const TERRARIUM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
