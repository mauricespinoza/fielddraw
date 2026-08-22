"""FieldDraw Tiles: raster de QGIS -> MBTiles / PMTiles para FieldDraw."""


def classFactory(iface):
    from .plugin import FieldDrawTilesPlugin
    return FieldDrawTilesPlugin(iface)
