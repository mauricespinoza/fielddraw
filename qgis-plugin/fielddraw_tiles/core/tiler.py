"""Orquestación: de un raster de QGIS a .mbtiles / .pmtiles para FieldDraw."""

import os
import time

from . import encoder as encoder_mod
from . import grid, render
from .mbtiles import MBTILES_WARN_BYTES, MBTilesWriter
from .pmtiles import TILETYPE_BY_FORMAT, TILETYPE_UNKNOWN, PMTilesWriter
from .pyramid import Cancelled, PyramidBuilder

TILE_SIZE = grid.TILE_SIZE


class ExportSettings(object):
    def __init__(self, source=None, layer=None, mbtiles_path=None, pmtiles_path=None,
                 min_zoom=None, max_zoom=None, extent_3857=None, tile_format='auto',
                 quality=75, background=(255, 255, 255), use_style=True,
                 resampling='average', name=None, description=None,
                 attribution=None, native_resolution=None, pipe=None,
                 transform_context=None, keep_intermediate=False):
        self.source = source
        self.layer = layer
        self.mbtiles_path = mbtiles_path
        self.pmtiles_path = pmtiles_path
        self.min_zoom = min_zoom
        self.max_zoom = max_zoom
        self.extent_3857 = extent_3857
        self.tile_format = tile_format
        self.quality = quality
        self.background = background
        self.use_style = use_style
        self.resampling = resampling
        self.name = name
        self.description = description
        self.attribution = attribution
        #: Metros por píxel del origen, medidos en EPSG:3857. De aquí sale el
        #: zoom máximo automático.
        self.native_resolution = native_resolution
        #: `QgsRasterPipe` ya armado en el hilo principal, con su contexto de
        #: transformación. Es lo que usa Processing; fuera de él basta con
        #: `layer` y el pipe se arma al vuelo.
        self.pipe = pipe
        self.transform_context = transform_context
        self.keep_intermediate = keep_intermediate


class ExportResult(object):
    def __init__(self):
        self.outputs = []          # [(ruta, teselas, bytes)]
        self.tiles = 0
        self.min_zoom = 0
        self.max_zoom = 0
        self.bounds = None
        self.seconds = 0.0
        self.warnings = []


class _Feedback(object):
    """Adaptador mínimo para poder usar el módulo sin QGIS."""

    def isCanceled(self):
        return False

    def setProgress(self, value):
        pass

    def pushInfo(self, text):
        pass

    def reportError(self, text, fatalError=False):
        pass


def auto_zooms(bounds_3857, native_resolution, min_zoom=None, max_zoom=None):
    """Rellena los zooms que el usuario dejó en automático."""
    if max_zoom is None:
        max_zoom = grid.zoom_for_resolution(native_resolution)
    max_zoom = int(max(0, min(grid.MAX_ZOOM, max_zoom)))
    if min_zoom is None:
        # Hasta que toda la zona quepa en una tesela: la pirámide completa
        # pesa un tercio más que su base y evita que el mapa desaparezca al
        # alejarse en terreno.
        min_zoom = grid.zoom_for_extent(bounds_3857)
    min_zoom = int(max(0, min(max_zoom, min_zoom)))
    return min_zoom, max_zoom


def _normalizer(ds):
    """Devuelve ``f(xoff, yoff, w, h) -> ndarray(4, h, w)`` desde el GeoTIFF.

    Da igual con cuántas bandas venga el intermedio: siempre sale RGBA. El
    alfa, si no hay banda explícita, se toma de la máscara de GDAL, que es
    la que sabe de `nodata`.
    """
    import numpy as np

    count = ds.RasterCount
    bands = [ds.GetRasterBand(i + 1) for i in range(count)]

    def read(xoff, yoff, width, height):
        out = np.zeros((4, height, width), dtype=np.uint8)
        if count >= 4:
            for i in range(4):
                out[i] = bands[i].ReadAsArray(xoff, yoff, width, height)
            return out
        if count == 3:
            for i in range(3):
                out[i] = bands[i].ReadAsArray(xoff, yoff, width, height)
        elif count == 2:
            gray = bands[0].ReadAsArray(xoff, yoff, width, height)
            out[0] = out[1] = out[2] = gray
            out[3] = bands[1].ReadAsArray(xoff, yoff, width, height)
            return out
        else:
            gray = bands[0].ReadAsArray(xoff, yoff, width, height)
            out[0] = out[1] = out[2] = gray
        out[3] = bands[0].GetMaskBand().ReadAsArray(xoff, yoff, width, height)
        return out

    return read


def export(settings, feedback=None):
    """Ejecuta la exportación completa. Devuelve un :class:`ExportResult`."""
    from osgeo import gdal

    feedback = feedback or _Feedback()
    started = time.time()
    result = ExportResult()

    targets = [p for p in (settings.mbtiles_path, settings.pmtiles_path) if p]
    if not targets:
        raise ValueError('Hay que pedir al menos un archivo de salida')

    bounds_3857 = grid.clip_bounds(settings.extent_3857)
    if bounds_3857[2] <= bounds_3857[0] or bounds_3857[3] <= bounds_3857[1]:
        raise ValueError('La extensión a exportar está vacía')

    native = settings.native_resolution or grid.resolution(grid.MAX_ZOOM)
    min_zoom, max_zoom = auto_zooms(bounds_3857, native,
                                    settings.min_zoom, settings.max_zoom)
    result.min_zoom, result.max_zoom = min_zoom, max_zoom

    tiles, aligned, cols, rows = render.aligned_target(bounds_3857, max_zoom)
    tx0, ty0, tx1, ty1 = tiles
    base_tiles = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)

    feedback.pushInfo('Zoom %d–%d · %d teselas base · raster intermedio %d×%d px'
                      % (min_zoom, max_zoom, base_tiles, cols, rows))
    if cols * rows > render.HUGE_PIXELS:
        result.warnings.append(
            'El raster intermedio ocupa %.1f Gpx. Si falta memoria o disco, '
            'baja el zoom máximo un nivel: cada nivel divide el tamaño por '
            'cuatro.' % (cols * rows / 1e9))
        feedback.pushInfo(result.warnings[-1])

    intermediate = os.path.splitext(targets[0])[0] + '.fielddraw-3857.tmp.tif'
    dataset = None
    writers = []
    try:
        feedback.pushInfo('Reproyectando a EPSG:3857 y alineando a la grilla…')
        if settings.use_style and (settings.pipe is not None or settings.layer is not None):
            try:
                if settings.pipe is not None:
                    render.render_pipe(settings.pipe, settings.transform_context,
                                       aligned, cols, rows, intermediate, feedback)
                else:
                    render.render_with_qgis(settings.layer, aligned, cols, rows,
                                            intermediate, feedback)
            except Exception as exc:
                if not settings.source:
                    raise
                feedback.pushInfo('La simbología de QGIS no se pudo usar (%s); '
                                  'se sigue con GDAL sobre los datos originales.'
                                  % exc)
                render.render_with_gdal(settings.source, aligned, cols, rows,
                                        intermediate, settings.resampling, feedback)
        else:
            render.render_with_gdal(settings.source, aligned, cols, rows,
                                    intermediate, settings.resampling, feedback)

        if feedback.isCanceled():
            raise Cancelled()

        gdal.SetCacheMax(512 * 1024 * 1024)
        dataset = gdal.Open(intermediate)
        if dataset is None:
            raise RuntimeError('No se pudo abrir el raster intermedio')
        read_window = _normalizer(dataset)
        width, height = dataset.RasterXSize, dataset.RasterYSize

        encoder = encoder_mod.TileEncoder(settings.tile_format, settings.quality,
                                          settings.background)
        container_format = encoder.container_format
        if settings.tile_format == 'auto':
            feedback.pushInfo(
                'Formato automático: JPEG en las teselas opacas y %s en las que '
                'llevan transparencia.' % encoder.alpha_format.upper())

        west, south = grid.meters_to_lonlat(bounds_3857[0], bounds_3857[1])
        east, north = grid.meters_to_lonlat(bounds_3857[2], bounds_3857[3])
        bounds_lonlat = (west, south, east, north)
        result.bounds = bounds_lonlat

        name = settings.name or os.path.splitext(os.path.basename(targets[0]))[0]
        metadata = {
            'name': name,
            'format': container_format,
            'type': 'overlay',
            'version': '1.1',
            'description': settings.description or 'Generado con FieldDraw Tiles para QGIS',
        }
        if settings.attribution:
            metadata['attribution'] = settings.attribution

        if settings.mbtiles_path:
            writers.append(MBTilesWriter(settings.mbtiles_path, metadata))
        if settings.pmtiles_path:
            tile_type = TILETYPE_BY_FORMAT.get(container_format, TILETYPE_UNKNOWN)
            writers.append(PMTilesWriter(settings.pmtiles_path, tile_type,
                                         metadata=dict(metadata)))

        def read_base(x, y):
            xoff = (x - tx0) * TILE_SIZE
            yoff = (y - ty0) * TILE_SIZE
            if xoff < 0 or yoff < 0 or xoff >= width or yoff >= height:
                return None
            return read_window(xoff, yoff, TILE_SIZE, TILE_SIZE)

        def emit(z, x, y, tile):
            data = encoder.encode(tile)
            if not data:
                return
            for writer in writers:
                writer.add_tile(z, x, y, data)
            result.tiles += 1

        def on_progress(done, total):
            feedback.setProgress(40.0 + 58.0 * done / max(1, total))

        builder = PyramidBuilder(read_base, emit, tiles, min_zoom, max_zoom,
                                 TILE_SIZE, feedback.isCanceled, on_progress)
        feedback.setProgress(40.0)
        feedback.pushInfo('Cortando teselas…')
        builder.run()

        center = ((west + east) / 2.0, (south + north) / 2.0)
        for writer in writers:
            size = writer.finalize(bounds_lonlat, center, min_zoom, max_zoom)
            result.outputs.append((writer.path, writer.tile_count, size))
        writers = []

    except Cancelled:
        for writer in writers:
            writer.abort()
        raise
    except Exception:
        for writer in writers:
            writer.abort()
        raise
    finally:
        dataset = None
        if not settings.keep_intermediate and os.path.exists(intermediate):
            try:
                os.remove(intermediate)
            except OSError:
                pass
        for suffix in ('.aux.xml', '.ovr'):
            side = intermediate + suffix
            if not settings.keep_intermediate and os.path.exists(side):
                try:
                    os.remove(side)
                except OSError:
                    pass

    for path, _count, size in result.outputs:
        if path.endswith('.mbtiles') and size > MBTILES_WARN_BYTES:
            result.warnings.append(
                '%s pesa %.0f MB. FieldDraw carga el MBTiles entero en memoria '
                'y avisa por encima de 250 MB: para terreno usa el PMTiles, que '
                'se lee por rangos.' % (os.path.basename(path), size / 1e6))

    result.seconds = time.time() - started
    feedback.setProgress(100.0)
    return result
