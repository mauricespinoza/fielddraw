"""Proveedor de Processing del plugin."""

import os

from qgis.PyQt.QtGui import QIcon
from qgis.core import QgsProcessingProvider

from .algorithm import RasterToFieldDrawTiles

PLUGIN_DIR = os.path.dirname(__file__)


class FieldDrawProvider(QgsProcessingProvider):
    def id(self):
        return 'fielddraw'

    def name(self):
        return 'FieldDraw'

    def longName(self):
        return 'FieldDraw Tiles'

    def icon(self):
        return QIcon(os.path.join(PLUGIN_DIR, 'icon.svg'))

    def loadAlgorithms(self):
        self.addAlgorithm(RasterToFieldDrawTiles())
