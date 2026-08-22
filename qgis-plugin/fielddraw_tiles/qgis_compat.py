"""Puente de compatibilidad QGIS 3 / QGIS 4.

QGIS 4 pasó de Qt5 a Qt6, y de paso reordenó varios enums de Processing: lo
que en QGIS 3 vivía suelto en la clase —`QgsProcessingParameterNumber.Integer`—
se agrupó primero bajo un enum anidado —`QgsProcessingParameterNumber.Type.Integer`—
y las versiones más nuevas lo centralizan en `Qgis`
—`Qgis.ProcessingNumberParameterType.Integer`—. `QAction` además se mudó de
`QtWidgets` a `QtGui`.

Este complemento declara `qgisMinimumVersion=3.16`, así que tiene que
funcionar con cualquiera de las tres formas. En vez de apostar por una,
`_first()` las prueba en orden y se queda con la primera que exista en esta
instalación de QGIS.
"""

from qgis.core import (
    Qgis,
    QgsMapLayer,
    QgsProcessingParameterDefinition,
    QgsProcessingParameterNumber,
)

try:
    from qgis.PyQt.QtGui import QAction          # Qt6 (QGIS 4): QAction vive aquí
except ImportError:                               # pragma: no cover
    from qgis.PyQt.QtWidgets import QAction       # Qt5 (QGIS 3)


def _first(*getters):
    """Devuelve el primer valor que no lance `AttributeError`."""
    for getter in getters:
        try:
            value = getter()
        except AttributeError:
            continue
        if value is not None:
            return value
    raise AttributeError('ninguna de las formas conocidas de este enum '
                         'existe en esta versión de QGIS')


#: `QgsProcessingParameterNumber.Integer`, en su forma vigente.
PROCESSING_INTEGER = _first(
    lambda: Qgis.ProcessingNumberParameterType.Integer,
    lambda: QgsProcessingParameterNumber.Type.Integer,
    lambda: QgsProcessingParameterNumber.Integer,
)

#: `QgsProcessingParameterDefinition.FlagAdvanced`, en su forma vigente.
PARAMETER_FLAG_ADVANCED = _first(
    lambda: Qgis.ProcessingParameterFlag.FlagAdvanced,
    lambda: QgsProcessingParameterDefinition.Flag.FlagAdvanced,
    lambda: QgsProcessingParameterDefinition.FlagAdvanced,
)

#: El tipo «capa ráster» de `QgsMapLayer.type()`. El nombre del miembro
#: también cambió, de `RasterLayer` a `Raster`, así que no basta con anidar
#: el mismo nombre bajo un contenedor distinto.
RASTER_LAYER_TYPE = _first(
    lambda: Qgis.LayerType.Raster,
    lambda: QgsMapLayer.LayerType.RasterLayer,
    lambda: QgsMapLayer.RasterLayer,
)

__all__ = ['QAction', 'PROCESSING_INTEGER', 'PARAMETER_FLAG_ADVANCED', 'RASTER_LAYER_TYPE']
