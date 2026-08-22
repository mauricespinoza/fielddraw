"""Paso previo: dejar el raster reproyectado y alineado a la grilla.

Antes de cortar teselas hay que llevar el raster a EPSG:3857. En vez de
reproyectar «a ojo» y luego remuestrear cada tesela, se reproyecta **una vez**
a una extensión que coincide exactamente con los bordes de las teselas del
zoom máximo. A partir de ahí cada tesela es un recorte entero de 256x256 y los
bloques del GeoTIFF caen justo sobre ellas, así que leer una tesela es leer un
bloque: ni interpolación de más, ni bordes movidos medio píxel.

Hay dos caminos para producir ese raster:

- **Con la simbología de QGIS** (por defecto): el mapa sale como se ve en el
  proyecto —paleta de un DEM, hillshade, clasificación de una carta
  geológica—, porque se renderiza pasando por el `QgsRasterPipe` de la capa.
- **Con GDAL** (`gdal.Warp`): usa los valores originales del archivo. Sirve
  para ortofotos RGB, donde la simbología no aporta nada, y es el respaldo si
  el renderizado de QGIS falla.
"""

import os

from . import grid

TILE_SIZE = grid.TILE_SIZE

#: Aviso a partir del cual conviene bajar el zoom máximo (unos 12 GB en RGBA).
HUGE_PIXELS = 3_000_000_000

GTIFF_OPTIONS = [
    'TILED=YES',
    'BLOCKXSIZE=%d' % TILE_SIZE,
    'BLOCKYSIZE=%d' % TILE_SIZE,
    'COMPRESS=DEFLATE',
    'ZLEVEL=1',            # es un temporal: comprimir rápido, no mucho
    'BIGTIFF=IF_SAFER',
]

RESAMPLING = ('nearest', 'bilinear', 'cubic', 'average', 'lanczos')


def aligned_target(bounds_3857, max_zoom):
    """Extensión alineada y tamaño en píxeles del raster intermedio."""
    tiles, aligned = grid.align_to_grid(bounds_3857, max_zoom)
    x0, y0, x1, y1 = tiles
    cols = (x1 - x0 + 1) * TILE_SIZE
    rows = (y1 - y0 + 1) * TILE_SIZE
    return tiles, aligned, cols, rows


def render_with_gdal(source, aligned_bounds, cols, rows, out_path,
                     resampling='average', feedback=None):
    """Reproyecta con `gdal.Warp` conservando los valores del archivo."""
    from osgeo import gdal

    ds = gdal.Open(source) if isinstance(source, str) else source
    if ds is None:
        raise RuntimeError('GDAL no pudo abrir el raster: %s' % source)

    # Una paleta no se puede reproyectar bien: primero se expande a RGBA.
    band = ds.GetRasterBand(1)
    if band.GetColorTable() is not None:
        ds = gdal.Translate('', ds, format='VRT', rgbExpand='rgba')

    def report(progress, _message, _data):
        if feedback.isCanceled():
            return 0                      # 0 aborta el warp
        # Reproyectar es el primer 40% de la barra; cortar teselas, el resto.
        feedback.setProgress(progress * 40.0)
        return 1

    callback = report if feedback is not None else None

    xmin, ymin, xmax, ymax = aligned_bounds
    warped = gdal.Warp(
        out_path, ds,
        format='GTiff',
        dstSRS='EPSG:3857',
        outputBounds=(xmin, ymin, xmax, ymax),
        width=cols, height=rows,
        resampleAlg=resampling,
        dstAlpha=True,
        multithread=True,
        warpMemoryLimit=512 * 1024 * 1024,
        creationOptions=GTIFF_OPTIONS,
        callback=callback,
    )
    if warped is None or not os.path.exists(out_path):
        raise RuntimeError('gdal.Warp no produjo el raster intermedio: %s'
                           % gdal.GetLastErrorMsg())
    warped.FlushCache()
    del warped
    return out_path


def build_pipe(layer, smooth=True):
    """Arma el `QgsRasterPipe` de la capa: proveedor, simbología y proyector.

    Se llama **en el hilo principal** (`prepareAlgorithm`), porque las capas de
    QGIS no son seguras fuera de él. Lo que se pasa luego al hilo de trabajo
    son estos clones, que sí lo son.
    """
    from qgis.core import (
        QgsCoordinateReferenceSystem,
        QgsCoordinateTransformContext,
        QgsRasterPipe,
        QgsRasterProjector,
    )

    provider = layer.dataProvider()
    if provider is None:
        raise RuntimeError('La capa no tiene proveedor de datos')

    pipe = QgsRasterPipe()
    if not pipe.set(provider.clone()):
        raise RuntimeError('No se pudo clonar el proveedor de la capa')

    renderer = layer.renderer()
    if renderer is None:
        raise RuntimeError('La capa no tiene simbología que renderizar')
    if not pipe.set(renderer.clone()):
        raise RuntimeError('No se pudo aplicar la simbología de la capa')

    for accessor in ('brightnessFilter', 'hueSaturationFilter'):
        try:
            source_filter = getattr(layer, accessor)()
            if source_filter is not None:
                pipe.set(source_filter.clone())
        except Exception:
            pass

    if smooth:
        _set_resampler(pipe, layer)

    context = QgsCoordinateTransformContext()
    try:
        from qgis.core import QgsProject
        context = QgsProject.instance().transformContext()
    except Exception:
        pass

    dest_crs = QgsCoordinateReferenceSystem('EPSG:3857')
    projector = QgsRasterProjector()
    try:
        projector.setCrs(provider.crs(), dest_crs, context)
    except TypeError:                                   # QGIS antiguo
        projector.setCrs(provider.crs(), dest_crs)
    if not pipe.set(projector):
        raise RuntimeError('No se pudo reproyectar la capa a EPSG:3857')

    return pipe, context


def render_pipe(pipe, context, aligned_bounds, cols, rows, out_path, feedback=None):
    """Escribe el GeoTIFF RGBA alineado a partir de un pipe ya armado."""
    from qgis.core import QgsCoordinateReferenceSystem, QgsRasterFileWriter, QgsRectangle

    dest_crs = QgsCoordinateReferenceSystem('EPSG:3857')

    writer = QgsRasterFileWriter(out_path)
    writer.setOutputProviderKey('gdal')
    writer.setOutputFormat('GTiff')
    writer.setCreateOptions(GTIFF_OPTIONS)
    try:
        # Que cada bloque renderizado sea un múltiplo exacto de la tesela.
        writer.setMaxTileWidth(TILE_SIZE * 4)
        writer.setMaxTileHeight(TILE_SIZE * 4)
    except AttributeError:
        pass

    xmin, ymin, xmax, ymax = aligned_bounds
    extent = QgsRectangle(xmin, ymin, xmax, ymax)

    # `writeRaster` quiere un QgsRasterBlockFeedback, no el del algoritmo: se
    # hace de puente para que la barra avance y el botón de cancelar sirva
    # también durante el renderizado, que es la parte larga.
    block_feedback = _block_feedback(feedback)

    args = [pipe, cols, rows, extent, dest_crs]
    try:
        error = writer.writeRaster(*(args + [context, block_feedback]))
    except TypeError:
        try:
            error = writer.writeRaster(*(args + [context]))
        except TypeError:                               # QGIS antiguo
            error = writer.writeRaster(*args)

    no_error = getattr(QgsRasterFileWriter, 'NoError', 0)
    if error != no_error:
        raise RuntimeError('QGIS no pudo escribir el raster intermedio (código %s)'
                           % error)
    if not os.path.exists(out_path):
        raise RuntimeError('El raster intermedio no se creó')
    return out_path


def render_with_qgis(layer, aligned_bounds, cols, rows, out_path, feedback=None,
                     smooth=True):
    """Renderiza la capa **con su simbología**, armando el pipe al vuelo.

    Solo para uso fuera de Processing (consola de Python, pruebas): dentro de
    un algoritmo hay que armar el pipe en el hilo principal con
    :func:`build_pipe` y pasarlo a :func:`render_pipe`.
    """
    pipe, context = build_pipe(layer, smooth)
    return render_pipe(pipe, context, aligned_bounds, cols, rows, out_path, feedback)


def _block_feedback(feedback):
    """Puente entre el feedback de Processing y el de escritura del ráster."""
    if feedback is None:
        return None
    try:
        from qgis.core import QgsRasterBlockFeedback
        bridge = QgsRasterBlockFeedback()
        # El renderizado es el 40% de la barra; el resto es cortar teselas.
        bridge.progressChanged.connect(
            lambda progress: feedback.setProgress(progress * 0.4))
        feedback.canceled.connect(bridge.cancel)
        return bridge
    except Exception:
        return None


def _set_resampler(pipe, layer):
    """Interpolación bilineal al renderizar, si esta versión la ofrece."""
    try:
        from qgis.core import QgsBilinearRasterResampler, QgsRasterResampleFilter
    except ImportError:
        return
    try:
        resample = layer.resampleFilter()
        resample = resample.clone() if resample is not None else QgsRasterResampleFilter()
        resample.setZoomedInResampler(QgsBilinearRasterResampler())
        resample.setZoomedOutResampler(QgsBilinearRasterResampler())
        resample.setMaxOversampling(2.0)
        pipe.set(resample)
    except Exception:
        pass
