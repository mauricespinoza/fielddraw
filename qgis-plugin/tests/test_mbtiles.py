"""Escritura de MBTiles 1.3.

Las consultas de estas pruebas son, literalmente, las que hace `src/tiles.js`:
si pasan aquí, la app encuentra las teselas donde las busca.
"""

import os
import sqlite3
import tempfile

from _harness import check, close, equal, run

from fielddraw_tiles.core.mbtiles import MBTilesWriter


def tmp_path():
    handle, path = tempfile.mkstemp(suffix='.mbtiles', prefix='fielddraw-test-')
    os.close(handle)
    os.remove(path)
    return path


def read_metadata(path):
    """`SELECT name, value FROM metadata`, igual que `openMbtiles()`."""
    db = sqlite3.connect(path)
    try:
        return dict(db.execute('SELECT name, value FROM metadata'))
    finally:
        db.close()


def read_tile(path, z, x, y):
    """La consulta de `readMbtilesTile()`, con el volteo de fila incluido."""
    db = sqlite3.connect(path)
    try:
        tms_y = (1 << z) - 1 - y
        row = db.execute(
            'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? '
            'AND tile_row=? LIMIT 1', (z, x, tms_y)).fetchone()
        return bytes(row[0]) if row else None
    finally:
        db.close()


def test_esquema():
    path = tmp_path()
    try:
        writer = MBTilesWriter(path)
        writer.add_tile(0, 0, 0, b'raiz')
        writer.finalize((-180.0, -85.0, 180.0, 85.0))

        db = sqlite3.connect(path)
        tables = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        db.close()
        check('tiles' in tables, 'existe la tabla tiles')
        check('metadata' in tables, 'existe la tabla metadata')
    finally:
        os.path.exists(path) and os.remove(path)


def test_filas_en_tms():
    """El detalle que más quebraderos da: MBTiles indexa al revés que XYZ."""
    path = tmp_path()
    try:
        writer = MBTilesWriter(path)
        writer.add_tile(1, 0, 0, b'noroeste')   # XYZ: y=0 es el norte
        writer.add_tile(1, 0, 1, b'suroeste')
        writer.finalize((-180.0, -85.0, 180.0, 85.0))

        db = sqlite3.connect(path)
        filas = dict(db.execute(
            'SELECT tile_row, tile_data FROM tiles WHERE zoom_level=1 AND tile_column=0'))
        db.close()
        equal(bytes(filas[1]), b'noroeste', 'la tesela norte se guarda en la fila TMS 1')
        equal(bytes(filas[0]), b'suroeste', 'la tesela sur se guarda en la fila TMS 0')

        equal(read_tile(path, 1, 0, 0), b'noroeste',
              'la app pide la tesela norte y recibe la del norte')
        equal(read_tile(path, 1, 0, 1), b'suroeste',
              'la app pide la tesela sur y recibe la del sur')
    finally:
        os.path.exists(path) and os.remove(path)


def test_metadatos_que_lee_la_app():
    path = tmp_path()
    try:
        writer = MBTilesWriter(path, {'name': 'Carta geológica', 'format': 'jpg',
                                      'attribution': 'Sernageomin'})
        for z in range(10, 13):
            writer.add_tile(z, 1, 1, b'x')
        bounds = (-71.75, -33.75, -71.25, -33.25)
        writer.finalize(bounds, None, 10, 12)

        meta = read_metadata(path)
        equal(meta['name'], 'Carta geológica', 'el nombre va al panel de capas')
        equal(meta['format'], 'jpg', 'el formato distingue raster de vectorial')
        equal(meta['minzoom'], '10', 'el zoom mínimo queda escrito')
        equal(meta['maxzoom'], '12', 'el zoom máximo queda escrito')
        equal(meta['attribution'], 'Sernageomin', 'la atribución queda escrita')

        # `parseBounds()` parte por comas y espera cuatro números.
        partes = [float(v) for v in meta['bounds'].split(',')]
        equal(len(partes), 4, 'la extensión son cuatro números separados por comas')
        for got, want in zip(partes, bounds):
            close(got, want, 'la extensión coincide con la pedida', 1e-6)
        equal(len(meta['center'].split(',')), 3,
              'el centro son tres números: lon, lat y zoom')
    finally:
        os.path.exists(path) and os.remove(path)


def test_zoom_deducido_de_las_teselas():
    """Si no se pasan zooms, salen de lo que se escribió."""
    path = tmp_path()
    try:
        writer = MBTilesWriter(path)
        writer.add_tile(7, 1, 1, b'a')
        writer.add_tile(11, 40, 40, b'b')
        writer.finalize((-71.0, -34.0, -70.0, -33.0))
        meta = read_metadata(path)
        equal(meta['minzoom'], '7', 'el zoom mínimo se deduce de las teselas')
        equal(meta['maxzoom'], '11', 'el zoom máximo se deduce de las teselas')
    finally:
        os.path.exists(path) and os.remove(path)


def test_piramide_completa():
    path = tmp_path()
    try:
        writer = MBTilesWriter(path, batch=8)
        escritas = {}
        for z in range(0, 6):
            for x in range(0, min(4, 1 << z)):
                for y in range(0, min(4, 1 << z)):
                    data = ('%d/%d/%d' % (z, x, y)).encode()
                    writer.add_tile(z, x, y, data)
                    escritas[(z, x, y)] = data
        writer.finalize((-180.0, -85.0, 180.0, 85.0))

        db = sqlite3.connect(path)
        total = db.execute('SELECT COUNT(*) FROM tiles').fetchone()[0]
        rango = db.execute('SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles').fetchone()
        db.close()
        equal(total, len(escritas), 'están todas las teselas y ninguna de más')
        equal(tuple(rango), (0, 5), 'el rango de zoom del respaldo coincide')

        for (z, x, y), data in escritas.items():
            equal(read_tile(path, z, x, y), data,
                  'la tesela %d/%d/%d vuelve entera' % (z, x, y))
    finally:
        os.path.exists(path) and os.remove(path)


def test_teselas_vacias_y_repetidas():
    path = tmp_path()
    try:
        writer = MBTilesWriter(path)
        writer.add_tile(2, 0, 0, b'')          # vacía: no se guarda
        writer.add_tile(2, 0, 1, None)         # tampoco
        writer.add_tile(2, 1, 1, b'buena')
        writer.add_tile(2, 1, 1, b'reemplazo')  # misma celda, gana la última
        writer.finalize((-180.0, -85.0, 180.0, 85.0))

        db = sqlite3.connect(path)
        total = db.execute('SELECT COUNT(*) FROM tiles').fetchone()[0]
        db.close()
        equal(total, 1, 'las teselas vacías no ocupan sitio')
        equal(read_tile(path, 2, 1, 1), b'reemplazo',
              'reescribir una celda no duplica la fila')
        equal(read_tile(path, 2, 0, 0), None,
              'una tesela que no está devuelve nada, y la app pinta el hueco')
    finally:
        os.path.exists(path) and os.remove(path)


def test_abortar():
    path = tmp_path()
    writer = MBTilesWriter(path)
    writer.add_tile(0, 0, 0, b'algo')
    writer.abort()
    check(not os.path.exists(path), 'abortar borra el archivo a medias')


TESTS = [test_esquema, test_filas_en_tms, test_metadatos_que_lee_la_app,
         test_zoom_deducido_de_las_teselas, test_piramide_completa,
         test_teselas_vacias_y_repetidas, test_abortar]

if __name__ == '__main__':
    raise SystemExit(run(TESTS))
