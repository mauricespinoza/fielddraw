"""Registro del plugin en QGIS.

Toda la lógica vive en el algoritmo de Processing: así se puede usar desde la
caja de herramientas, en lote sobre muchos rásteres y dentro de un modelo. El
botón de la barra y la entrada de menú solo abren su diálogo.
"""

import os

from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QMessageBox
from qgis.core import QgsApplication

from .provider import FieldDrawProvider
from .qgis_compat import QAction, RASTER_LAYER_TYPE

PLUGIN_DIR = os.path.dirname(__file__)
MENU = '&FieldDraw'


class FieldDrawTilesPlugin(object):
    def __init__(self, iface):
        self.iface = iface
        self.provider = None
        self.action = None

    def initProcessing(self):
        self.provider = FieldDrawProvider()
        QgsApplication.processingRegistry().addProvider(self.provider)

    def initGui(self):
        self.initProcessing()
        self.action = QAction(
            QIcon(os.path.join(PLUGIN_DIR, 'icon.svg')),
            'Ráster a teselas para FieldDraw…',
            self.iface.mainWindow())
        self.action.setToolTip('Convierte un ráster en MBTiles y PMTiles '
                               'para cargar en FieldDraw')
        self.action.triggered.connect(self.run)
        self.iface.addPluginToRasterMenu(MENU, self.action)
        self.iface.addToolBarIcon(self.action)

    def unload(self):
        if self.provider is not None:
            QgsApplication.processingRegistry().removeProvider(self.provider)
            self.provider = None
        if self.action is not None:
            self.iface.removePluginRasterMenu(MENU, self.action)
            self.iface.removeToolBarIcon(self.action)
            self.action = None

    def run(self):
        try:
            from processing import execAlgorithmDialog
        except ImportError:
            QMessageBox.warning(
                self.iface.mainWindow(), 'FieldDraw Tiles',
                'Hace falta el complemento «Processing», que viene con QGIS. '
                'Actívalo en Complementos → Administrar e instalar complementos '
                '→ Instalados.')
            return

        layer = self.iface.activeLayer()
        params = {}
        try:
            if layer is not None and layer.type() == RASTER_LAYER_TYPE:
                params['INPUT'] = layer
        except Exception:
            pass
        execAlgorithmDialog('fielddraw:rastertofielddrawtiles', params)
