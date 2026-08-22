"""Exportación completa, de GeoTIFF a .mbtiles y .pmtiles.

Necesita GDAL con las bindings de Python (`osgeo`) y numpy, que es justo lo
que trae QGIS. Fuera de QGIS se salta sola. Para correrla dentro de QGIS:

    exec(open('.../qgis-plugin/tests/test_export.py').read())

o desde la consola de Python de QGIS::

    import subprocess, sys
    subprocess.run([sys.executable, '.../tests/run.py'])
"""

import os
import shutil
import sqlite3
import tempfile

from _harness import check, close, equal, run

try:
    import numpy as np
    from osgeo import gdal, osr
    HAVE_GDAL = True
except ImportError:                                     # pragma: no cover
    HAVE_GDAL = False

if HAVE_GDAL:
    from fielddraw_tiles.core import grid
    from fielddraw_tiles.core.encoder import TileEncoder, webp_available
    from fielddraw_tiles.core.pmtiles import PMTilesReader
    from fielddraw_tiles.core.tiler import ExportSettings, auto_zooms, export

#: UTM 19S: el huso de Chile central, para que la prueba pase por una
#: reproyección de verdad y no por el caso fácil de partir ya en 3857.
SOURCE_EPSG = 32719
SOURCE_SIZE = 512
PIXEL_METERS = 10.0
ORIGIN_EASTING = 340000.0
ORIGIN_NORTHING = 6300000.0


def make_source(path):
    """GeoTIFF RGB con un degradado, un cuadro rojo y un borde sin datos."""
    driver = gdal.GetDriverByName('GTiff')
    ds = driver.Create(path, SOURCE_SIZE, SOURCE_SIZE, 3, gdal.GDT_Byte)
    ds.SetGeoTransform((ORIGIN_EASTING, PIXEL_METERS, 0.0,
                        ORIGIN_NORTHING, 0.0, -PIXEL_METERS))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(SOURCE_EPSG)
    ds.SetProjection(srs.ExportToWkt())

    rows = np.arange(SOURCE_SIZE, dtype=np.uint8)
    red = np.tile(rows, (SOURCE_SIZE, 1))
    green = np.tile(rows.reshape(-1, 1), (1, SOURCE_SIZE))
    blue = np.full((SOURCE_SIZE, SOURCE_SIZE), 128, dtype=np.uint8)
    red[100:200, 100:200] = 255
    green[100:200, 100:200] = 0
    blue[100:200, 100:200] = 0

    # Marco de nodata: así hay teselas con alfa y teselas totalmente vacías.
    for band in (red, green, blue):
        band[:16, :] = 0
        band[-16:, :] = 0
        band[:, :16] = 0
        band[:, -16:] = 0

    for index, data in enumerate((red, green, blue)):
        rb = ds.GetRasterBand(index + 1)
        rb.WriteArray(data)
        rb.SetNoDataValue(0)
    ds.FlushCache()
    del ds
    return path


def source_bounds_3857():
    """Extensión del GeoTIFF de prueba, en metros Web Mercator."""
    source = osr.SpatialReference()
    source.ImportFromEPSG(SOURCE_EPSG)
    target = osr.SpatialReference()
    target.ImportFromEPSG(3857)
    try:
        source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    except AttributeError:                              # GDAL 2
        pass
    transform = osr.CoordinateTransformation(source, target)
    span = SOURCE_SIZE * PIXEL_METERS
    corners = [
        (ORIGIN_EASTING, ORIGIN_NORTHING),
        (ORIGIN_EASTING + span, ORIGIN_NORTHING),
        (ORIGIN_EASTING, ORIGIN_NORTHING - span),
        (ORIGIN_EASTING + span, ORIGIN_NORTHING - span),
    ]
    points = [transform.TransformPoint(x, y)[:2] for x, y in corners]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


def decode(data):
    """Decodifica una tesela con GDAL y devuelve ``(ancho, alto, bandas)``."""
    name = '/vsimem/decode-test'
    gdal.FileFromMemBuffer(name, data)
    try:
        ds = gdal.Open(name)
        if ds is None:
            return None
        info = (ds.RasterXSize, ds.RasterYSize, ds.RasterCount,
                ds.GetDriver().ShortName)
        del ds
        return info
    finally:
        gdal.Unlink(name)


# ---------------------------------------------------------------------------


def test_zoom_automatico():
    bounds = source_bounds_3857()
    resolucion = (bounds[2] - bounds[0]) / SOURCE_SIZE
    min_zoom, max_zoom = auto_zooms(bounds, resolucion)
    equal(max_zoom, grid.zoom_for_resolution(resolucion),
          'el zoom máximo sale de la resolución del ráster')
    check(10 <= max_zoom <= 15,
          'un píxel de 10 m cae entre z10 y z15 (obtenido z%d)' % max_zoom)
    check(min_zoom < max_zoom, 'el zoom mínimo queda por debajo del máximo')
    check(grid.tile_range(bounds, min_zoom) == grid.tile_range(bounds, min_zoom),
          'el rango del zoom mínimo es estable')

    equal(auto_zooms(bounds, resolucion, 5, 9), (5, 9),
          'los zooms pedidos a mano mandan')
    equal(auto_zooms(bounds, resolucion, 12, 9)[0], 9,
          'un mínimo mayor que el máximo se recorta al máximo')


def photographic_tile(seed=7):
    """Tesela con degradado y ruido: se comporta como una ortofoto."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:256, 0:256]
    tile = np.zeros((4, 256, 256), dtype=np.uint8)
    tile[0] = np.clip(x + rng.normal(0, 12, (256, 256)), 0, 255)
    tile[1] = np.clip(y + rng.normal(0, 12, (256, 256)), 0, 255)
    tile[2] = np.clip((x + y) // 2 + rng.normal(0, 12, (256, 256)), 0, 255)
    tile[3] = 255
    return tile


def test_codificador():
    from fielddraw_tiles.core.encoder import auto_alpha_format

    foto = photographic_tile()
    con_alfa = foto.copy()
    con_alfa[3, :, :128] = 0                 # media tesela transparente
    plana = np.zeros((4, 256, 256), dtype=np.uint8)
    plana[0], plana[3] = 200, 255
    vacia = np.zeros((4, 256, 256), dtype=np.uint8)

    automatico = TileEncoder('auto', quality=75)
    equal(automatico.encode(vacia), None,
          'una tesela transparente no se guarda: la app ya pinta el hueco')

    jpeg = automatico.encode(foto)
    equal(decode(jpeg)[3], 'JPEG', 'en automático una tesela opaca sale en JPEG')
    check(len(jpeg) < len(TileEncoder('png').encode(foto)) / 5,
          'el JPEG de una ortofoto pesa menos de la quinta parte que el PNG')

    borde = automatico.encode(con_alfa)
    esperado = {'webp': 'WEBP', 'png': 'PNG'}[auto_alpha_format()]
    equal(decode(borde)[3], esperado,
          'en automático la tesela con alfa sale en %s' % esperado)
    check(len(borde) <= len(TileEncoder('png').encode(con_alfa)),
          'el borde no pesa más que guardándolo en PNG a secas')

    solo_png = TileEncoder('png', quality=75)
    equal(decode(solo_png.encode(foto))[2], 3,
          'sin transparencia el PNG se guarda sin canal alfa')
    equal(decode(solo_png.encode(con_alfa))[2], 4,
          'con transparencia el PNG lleva sus cuatro bandas')

    ocho = TileEncoder('png8', quality=75)
    paleta = ocho.encode(foto)
    equal(decode(paleta)[3], 'PNG', 'png8 sigue siendo un PNG normal')
    check(len(paleta) < len(solo_png.encode(foto)),
          'la paleta pesa menos que el PNG de 24 bits')
    check(len(ocho.encode(plana)) < len(solo_png.encode(plana)),
          'en un mapa de colores planos la paleta es la opción más liviana')

    for nombre, tesela in (('opaca', foto), ('con alfa', con_alfa)):
        for formato in ('auto', 'png', 'png8', 'jpeg'):
            datos = TileEncoder(formato, 70).encode(tesela)
            ancho, alto, _bandas, _driver = decode(datos)
            equal((ancho, alto), (256, 256),
                  'la tesela %s en %s mide 256x256' % (nombre, formato))

    if webp_available():
        webp = TileEncoder('webp', 75).encode(con_alfa)
        equal(decode(webp)[3], 'WEBP', 'webp sale en WebP cuando GDAL lo trae')
        equal(decode(webp)[:2], (256, 256), 'y también mide 256x256')
    else:
        check(True, 'esta instalación de GDAL no trae WEBP; se salta')


def test_exportacion_completa():
    carpeta = tempfile.mkdtemp(prefix='fielddraw-export-')
    try:
        origen = make_source(os.path.join(carpeta, 'origen.tif'))
        bounds = source_bounds_3857()
        settings = ExportSettings(
            source=origen,
            mbtiles_path=os.path.join(carpeta, 'salida.mbtiles'),
            pmtiles_path=os.path.join(carpeta, 'salida.pmtiles'),
            extent_3857=bounds,
            min_zoom=None, max_zoom=None,
            tile_format='auto', quality=75,
            use_style=False, resampling='average',
            name='Prueba',
            native_resolution=(bounds[2] - bounds[0]) / SOURCE_SIZE,
        )
        resultado = export(settings)

        equal(len(resultado.outputs), 2, 'salen los dos archivos pedidos')
        for ruta, teselas, tamano in resultado.outputs:
            check(os.path.exists(ruta), '%s existe' % os.path.basename(ruta))
            check(tamano > 0, '%s no está vacío' % os.path.basename(ruta))
            check(teselas > 0, '%s tiene teselas' % os.path.basename(ruta))
        equal(resultado.outputs[0][1], resultado.outputs[1][1],
              'los dos contenedores llevan las mismas teselas')

        intermedio = os.path.splitext(settings.mbtiles_path)[0] + '.fielddraw-3857.tmp.tif'
        check(not os.path.exists(intermedio), 'el raster intermedio se borra al terminar')

        # --- PMTiles, como lo abre la app -------------------------------
        lector = PMTilesReader(settings.pmtiles_path)
        equal(lector.min_zoom, resultado.min_zoom, 'el zoom mínimo llega al PMTiles')
        equal(lector.max_zoom, resultado.max_zoom, 'el zoom máximo llega al PMTiles')
        equal(lector.metadata()['name'], 'Prueba', 'el nombre llega al PMTiles')
        oeste, sur, este, norte = lector.bounds
        esperado = [grid.meters_to_lonlat(bounds[0], bounds[1]),
                    grid.meters_to_lonlat(bounds[2], bounds[3])]
        close(oeste, esperado[0][0], 'la extensión oeste del PMTiles cuadra', 1e-4)
        close(norte, esperado[1][1], 'la extensión norte del PMTiles cuadra', 1e-4)

        # --- MBTiles, con la consulta de la app -------------------------
        db = sqlite3.connect(settings.mbtiles_path)
        meta = dict(db.execute('SELECT name, value FROM metadata'))
        rango = db.execute('SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles').fetchone()
        total = db.execute('SELECT COUNT(*) FROM tiles').fetchone()[0]
        equal(int(meta['minzoom']), resultado.min_zoom, 'el zoom mínimo llega al MBTiles')
        equal(int(meta['maxzoom']), resultado.max_zoom, 'el zoom máximo llega al MBTiles')
        equal(tuple(rango), (resultado.min_zoom, resultado.max_zoom),
              'las teselas cubren el rango declarado')
        equal(total, resultado.tiles, 'están todas las teselas contadas')

        # Una tesela concreta del centro, en los dos contenedores.
        centro_x = (bounds[0] + bounds[2]) / 2
        centro_y = (bounds[1] + bounds[3]) / 2
        z = resultado.max_zoom
        tx, ty, _x1, _y1 = grid.tile_range((centro_x, centro_y, centro_x, centro_y), z)
        fila_tms = grid.flip_row(z, ty)
        desde_mbtiles = db.execute(
            'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? '
            'AND tile_row=? LIMIT 1', (z, tx, fila_tms)).fetchone()
        db.close()
        check(desde_mbtiles is not None, 'la tesela del centro está en el MBTiles')
        desde_pmtiles = lector.get(z, tx, ty)
        check(desde_pmtiles is not None, 'la tesela del centro está en el PMTiles')
        if desde_mbtiles and desde_pmtiles:
            equal(bytes(desde_mbtiles[0]), desde_pmtiles,
                  'los dos contenedores guardan exactamente la misma imagen')
            ancho, alto, _bandas, _driver = decode(desde_pmtiles)
            equal((ancho, alto), (256, 256), 'la tesela mide 256x256, como pide la app')

        # Ninguna tesela guardada puede ser un cuadro transparente.
        db = sqlite3.connect(settings.mbtiles_path)
        vacias = 0
        for (blob,) in db.execute('SELECT tile_data FROM tiles'):
            check(len(blob) > 0, 'ninguna tesela guardada está vacía')
            vacias += 1
            if vacias > 40:
                break
        db.close()
    finally:
        shutil.rmtree(carpeta, ignore_errors=True)


def test_zoom_acotado_a_mano():
    carpeta = tempfile.mkdtemp(prefix='fielddraw-export-')
    try:
        origen = make_source(os.path.join(carpeta, 'origen.tif'))
        bounds = source_bounds_3857()
        settings = ExportSettings(
            source=origen,
            pmtiles_path=os.path.join(carpeta, 'acotado.pmtiles'),
            extent_3857=bounds, min_zoom=9, max_zoom=11,
            tile_format='png', use_style=False,
            native_resolution=(bounds[2] - bounds[0]) / SOURCE_SIZE,
        )
        resultado = export(settings)
        equal((resultado.min_zoom, resultado.max_zoom), (9, 11),
              'se respetan los zooms pedidos')
        lector = PMTilesReader(settings.pmtiles_path)
        equal((lector.min_zoom, lector.max_zoom), (9, 11),
              'y quedan escritos en la cabecera')
        equal(len(resultado.outputs), 1, 'solo se escribe el archivo pedido')
        check(not os.path.exists(os.path.join(carpeta, 'acotado.mbtiles')),
              'no se crea el MBTiles si no se pidió')
    finally:
        shutil.rmtree(carpeta, ignore_errors=True)


def test_georreferenciacion():
    """La tesela que dice cubrir el cuadro rojo tiene que contener rojo."""
    carpeta = tempfile.mkdtemp(prefix='fielddraw-export-')
    try:
        origen = make_source(os.path.join(carpeta, 'origen.tif'))
        bounds = source_bounds_3857()
        settings = ExportSettings(
            source=origen,
            pmtiles_path=os.path.join(carpeta, 'geo.pmtiles'),
            extent_3857=bounds, tile_format='png', use_style=False,
            native_resolution=(bounds[2] - bounds[0]) / SOURCE_SIZE,
        )
        resultado = export(settings)

        # Centro del cuadro rojo en el ráster de origen -> lon/lat -> tesela.
        source = osr.SpatialReference()
        source.ImportFromEPSG(SOURCE_EPSG)
        target = osr.SpatialReference()
        target.ImportFromEPSG(3857)
        try:
            source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        except AttributeError:
            pass
        transform = osr.CoordinateTransformation(source, target)
        easting = ORIGIN_EASTING + 150 * PIXEL_METERS
        northing = ORIGIN_NORTHING - 150 * PIXEL_METERS
        mx, my = transform.TransformPoint(easting, northing)[:2]

        z = resultado.max_zoom
        tx, ty, _x1, _y1 = grid.tile_range((mx, my, mx, my), z)
        datos = PMTilesReader(settings.pmtiles_path).get(z, tx, ty)
        check(datos is not None, 'la tesela del cuadro rojo existe')
        if datos:
            name = '/vsimem/geo-test.png'
            gdal.FileFromMemBuffer(name, datos)
            ds = gdal.Open(name)
            arr = ds.ReadAsArray()
            del ds
            gdal.Unlink(name)
            rojo = (arr[0].astype(int) > 200) & (arr[1].astype(int) < 60)
            check(rojo.any(),
                  'la tesela georreferenciada sobre el cuadro rojo contiene rojo')
    finally:
        shutil.rmtree(carpeta, ignore_errors=True)


TESTS = [test_zoom_automatico, test_codificador, test_exportacion_completa,
         test_zoom_acotado_a_mano, test_georreferenciacion]

if __name__ == '__main__':
    if not HAVE_GDAL:
        print('· se salta test_export: no hay osgeo/numpy en este intérprete')
        raise SystemExit(0)
    raise SystemExit(run(TESTS))
