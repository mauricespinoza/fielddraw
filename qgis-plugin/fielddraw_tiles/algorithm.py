"""Algoritmo de Processing: «Ráster a teselas para FieldDraw»."""

import os

from qgis.PyQt.QtGui import QIcon
from qgis.core import (
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsProcessingAlgorithm,
    QgsProcessingException,
    QgsProcessingParameterBoolean,
    QgsProcessingParameterEnum,
    QgsProcessingParameterExtent,
    QgsProcessingParameterFileDestination,
    QgsProcessingParameterNumber,
    QgsProcessingParameterRasterLayer,
    QgsProcessingParameterString,
)

from .core import encoder as encoder_mod
from .core import grid, render, tiler
from .core.pyramid import Cancelled
from .qgis_compat import PARAMETER_FLAG_ADVANCED, PROCESSING_INTEGER

PLUGIN_DIR = os.path.dirname(__file__)

FORMATS = list(encoder_mod.FORMATS)
RESAMPLINGS = list(render.RESAMPLING)


class RasterToFieldDrawTiles(QgsProcessingAlgorithm):
    INPUT = 'INPUT'
    EXTENT = 'EXTENT'
    MIN_ZOOM = 'MIN_ZOOM'
    MAX_ZOOM = 'MAX_ZOOM'
    TILE_FORMAT = 'TILE_FORMAT'
    QUALITY = 'QUALITY'
    USE_STYLE = 'USE_STYLE'
    RESAMPLING = 'RESAMPLING'
    NAME = 'NAME'
    ATTRIBUTION = 'ATTRIBUTION'
    PMTILES = 'PMTILES'
    MBTILES = 'MBTILES'

    def name(self):
        return 'rastertofielddrawtiles'

    def displayName(self):
        return 'Ráster a teselas para FieldDraw'

    def group(self):
        return 'FieldDraw'

    def groupId(self):
        return 'fielddraw'

    def icon(self):
        return QIcon(os.path.join(PLUGIN_DIR, 'icon.svg'))

    def shortDescription(self):
        return 'Convierte un ráster en MBTiles y PMTiles listos para FieldDraw.'

    def shortHelpString(self):
        return (
            '<p>Convierte una capa ráster —ortofoto, carta escaneada, geología '
            'clasificada, hillshade— en un mapa de teselas offline que '
            '<b>FieldDraw</b> puede abrir desde el botón <i>Importar</i>.</p>'
            '<p>Se generan teselas de <b>256&nbsp;px en EPSG:3857</b>, que es lo '
            'que la app espera: <code>MBTiles 1.3</code> con las filas en TMS y '
            '<code>PMTiles v3</code>. Puedes pedir los dos a la vez; se cortan '
            'en una sola pasada.</p>'
            '<h3>Para que salga liviano</h3><ul>'
            '<li><b>Formato automático</b> (recomendado): JPEG en las teselas '
            'opacas y PNG donde hay transparencia. Suele pesar entre cinco y '
            'diez veces menos que todo en PNG.</li>'
            '<li><b>PNG de 8 bits</b> si el ráster es de colores planos, como '
            'una carta geológica clasificada.</li>'
            '<li>Las teselas totalmente transparentes no se guardan.</li>'
            '<li>Sube el <b>zoom mínimo</b> o baja el <b>máximo</b>: cada nivel '
            'de más multiplica por cuatro el número de teselas.</li></ul>'
            '<h3>Qué formato llevar a terreno</h3>'
            '<p><b>PMTiles</b>. FieldDraw lo lee por rangos del archivo, así que '
            'aguanta varios GB. El MBTiles se carga entero en memoria y la app '
            'avisa por encima de 250&nbsp;MB.</p>'
            '<p>Con <i>Usar la simbología de la capa</i> el mapa sale como se ve '
            'en QGIS. Desactívalo para exportar los valores originales del '
            'archivo.</p>'
        )

    def createInstance(self):
        return RasterToFieldDrawTiles()

    def __init__(self):
        super().__init__()
        self.full_extent = None
        self.extent = None
        self.native_resolution = None
        self.layer_name = None
        self.layer_source = None
        self.pipe = None
        self.transform_context = None

    # -- parámetros --------------------------------------------------------

    def initAlgorithm(self, config=None):
        self.addParameter(QgsProcessingParameterRasterLayer(
            self.INPUT, 'Capa ráster'))

        self.addParameter(QgsProcessingParameterExtent(
            self.EXTENT, 'Extensión a exportar (por defecto, toda la capa)',
            optional=True))

        self.addParameter(QgsProcessingParameterNumber(
            self.MIN_ZOOM, 'Zoom mínimo (−1 = automático)',
            PROCESSING_INTEGER,
            defaultValue=-1, minValue=-1, maxValue=grid.MAX_ZOOM))

        self.addParameter(QgsProcessingParameterNumber(
            self.MAX_ZOOM, 'Zoom máximo (−1 = según la resolución del ráster)',
            PROCESSING_INTEGER,
            defaultValue=-1, minValue=-1, maxValue=grid.MAX_ZOOM))

        self.addParameter(QgsProcessingParameterEnum(
            self.TILE_FORMAT, 'Formato de las teselas',
            options=[encoder_mod.FORMAT_LABELS[f] for f in FORMATS],
            defaultValue=0))

        self.addParameter(QgsProcessingParameterNumber(
            self.QUALITY, 'Calidad JPEG/WebP (1–100)',
            PROCESSING_INTEGER,
            defaultValue=75, minValue=1, maxValue=100))

        self.addParameter(QgsProcessingParameterBoolean(
            self.USE_STYLE, 'Usar la simbología de la capa', defaultValue=True))

        self.addParameter(QgsProcessingParameterFileDestination(
            self.PMTILES, 'PMTiles de salida (recomendado para terreno)',
            'PMTiles (*.pmtiles)', optional=True, createByDefault=True))

        self.addParameter(QgsProcessingParameterFileDestination(
            self.MBTILES, 'MBTiles de salida',
            'MBTiles (*.mbtiles)', optional=True, createByDefault=False))

        advanced = []
        advanced.append(QgsProcessingParameterEnum(
            self.RESAMPLING, 'Remuestreo (solo sin simbología de QGIS)',
            options=RESAMPLINGS, defaultValue=RESAMPLINGS.index('average')))
        advanced.append(QgsProcessingParameterString(
            self.NAME, 'Nombre del mapa', optional=True))
        advanced.append(QgsProcessingParameterString(
            self.ATTRIBUTION, 'Atribución', optional=True))
        for param in advanced:
            param.setFlags(param.flags() | PARAMETER_FLAG_ADVANCED)
            self.addParameter(param)

    # -- preparación (hilo principal) --------------------------------------

    def prepareAlgorithm(self, parameters, context, feedback):
        """Todo lo que toca la capa se hace aquí.

        Processing ejecuta `processAlgorithm` en un hilo de trabajo, y las
        capas de QGIS no son seguras fuera del hilo principal. Aquí se resuelve
        la capa, se mide su extensión y —si se va a usar su simbología— se
        clona el `QgsRasterPipe` entero. Al hilo de trabajo solo viajan clones
        y números.
        """
        layer = self.parameterAsRasterLayer(parameters, self.INPUT, context)
        if layer is None or not layer.isValid():
            raise QgsProcessingException('La capa ráster no es válida')

        mercator = QgsCoordinateReferenceSystem('EPSG:3857')
        try:
            transform = QgsCoordinateTransform(layer.crs(), mercator,
                                               context.transformContext())
            self.full_extent = transform.transformBoundingBox(layer.extent())
        except Exception as exc:
            raise QgsProcessingException(
                'No se pudo reproyectar la extensión de la capa a EPSG:3857: %s' % exc)
        if self.full_extent.isEmpty():
            raise QgsProcessingException('La capa no tiene extensión')

        self.extent = self.full_extent
        requested = self.parameterAsExtent(parameters, self.EXTENT, context, mercator)
        if requested is not None and not requested.isEmpty():
            self.extent = requested.intersect(self.full_extent)
            if self.extent.isEmpty():
                raise QgsProcessingException('La extensión pedida no toca la capa')

        # Resolución nativa medida en el mismo sistema que la grilla: el
        # factor de escala de Mercator se cancela al comparar con
        # `grid.resolution(z)`, así que la comparación es directa.
        self.native_resolution = self.full_extent.width() / max(1, layer.width())

        self.layer_name = layer.name()
        self.layer_source = layer.source() if layer.providerType() == 'gdal' else None
        self.pipe = None
        self.transform_context = context.transformContext()

        if self.parameterAsBool(parameters, self.USE_STYLE, context):
            try:
                self.pipe, self.transform_context = render.build_pipe(layer)
            except Exception as exc:
                if not self.layer_source:
                    raise QgsProcessingException(
                        'No se pudo preparar el renderizado de la capa: %s' % exc)
                feedback.pushInfo('No se pudo preparar la simbología (%s); se '
                                  'exportarán los datos originales.' % exc)

        if self.pipe is None and not self.layer_source:
            raise QgsProcessingException(
                'El proveedor «%s» no es un archivo que GDAL pueda abrir y no '
                'se pudo renderizar la capa. Exporta primero la capa a '
                'GeoTIFF.' % layer.providerType())
        return True

    # -- ejecución (hilo de trabajo) ---------------------------------------

    def processAlgorithm(self, parameters, context, feedback):
        full = self.full_extent
        extent = self.extent
        native = self.native_resolution

        min_zoom = self.parameterAsInt(parameters, self.MIN_ZOOM, context)
        max_zoom = self.parameterAsInt(parameters, self.MAX_ZOOM, context)
        tile_format = FORMATS[self.parameterAsEnum(parameters, self.TILE_FORMAT, context)]
        resampling = RESAMPLINGS[self.parameterAsEnum(parameters, self.RESAMPLING, context)]

        pmtiles_path = self.parameterAsFileOutput(parameters, self.PMTILES, context)
        mbtiles_path = self.parameterAsFileOutput(parameters, self.MBTILES, context)
        pmtiles_path = _with_suffix(pmtiles_path, '.pmtiles')
        mbtiles_path = _with_suffix(mbtiles_path, '.mbtiles')
        if not pmtiles_path and not mbtiles_path:
            raise QgsProcessingException(
                'Indica al menos una salida: PMTiles, MBTiles o las dos')

        settings = tiler.ExportSettings(
            source=self.layer_source,
            pipe=self.pipe,
            transform_context=self.transform_context,
            mbtiles_path=mbtiles_path,
            pmtiles_path=pmtiles_path,
            min_zoom=None if min_zoom < 0 else min_zoom,
            max_zoom=None if max_zoom < 0 else max_zoom,
            extent_3857=(extent.xMinimum(), extent.yMinimum(),
                         extent.xMaximum(), extent.yMaximum()),
            tile_format=tile_format,
            quality=self.parameterAsInt(parameters, self.QUALITY, context),
            use_style=self.pipe is not None,
            resampling=resampling,
            name=(self.parameterAsString(parameters, self.NAME, context)
                  or self.layer_name),
            attribution=self.parameterAsString(parameters, self.ATTRIBUTION, context),
            native_resolution=native,
        )

        if extent != full:
            feedback.pushInfo('Se exporta solo la extensión pedida, no toda la capa.')

        try:
            result = tiler.export(settings, feedback)
        except Cancelled:
            feedback.pushInfo('Exportación cancelada; no se dejó ningún archivo a medias.')
            return {}
        except Exception as exc:
            raise QgsProcessingException(str(exc))

        feedback.pushInfo('')
        feedback.pushInfo('Listo en %.1f s · %d teselas · zoom %d–%d'
                          % (result.seconds, result.tiles,
                             result.min_zoom, result.max_zoom))
        for path, count, size in result.outputs:
            feedback.pushInfo('  %s — %d teselas, %s'
                              % (os.path.basename(path), count, _human(size)))
        for warning in result.warnings:
            if hasattr(feedback, 'pushWarning'):
                feedback.pushWarning(warning)
            else:
                feedback.pushInfo(warning)
        feedback.pushInfo('')
        feedback.pushInfo('En FieldDraw: botón Importar → elige el archivo. '
                          'Aparece en el panel de capas, sobre los basemaps.')

        outputs = {}
        if pmtiles_path:
            outputs[self.PMTILES] = pmtiles_path
        if mbtiles_path:
            outputs[self.MBTILES] = mbtiles_path
        return outputs


def _with_suffix(path, suffix):
    """Processing puede entregar la ruta sin extensión o con otra."""
    if not path:
        return None
    if not path.lower().endswith(suffix):
        path = os.path.splitext(path)[0] + suffix
    return path


def _human(size):
    for unit in ('B', 'kB', 'MB', 'GB'):
        if size < 1024 or unit == 'GB':
            return '%.1f %s' % (size, unit) if unit != 'B' else '%d B' % size
        size /= 1024.0
    return '%.1f GB' % size
