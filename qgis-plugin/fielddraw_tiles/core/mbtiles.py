"""Escritor de MBTiles 1.3 (SQLite), Python puro.

FieldDraw lee el archivo entero en memoria con sql.js, así que aquí importan
dos cosas: el esquema exacto que consulta `src/tiles.js` y que el archivo
salga lo más pequeño posible.

La consulta que hace la app es::

    SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?

con ``tile_row`` en **TMS** (fila 0 al sur). Y lee de `metadata` los campos
``name``, ``format``, ``minzoom``, ``maxzoom`` y ``bounds``.
"""

import os
import sqlite3

from . import grid

#: FieldDraw carga el MBTiles entero en memoria (sql.js no sabe leer por
#: rangos) y avisa por encima de este tamaño: `MBTILES_WARN_BYTES` en
#: `src/tiles.js`. Por encima de aquí, lo que hay que llevar a terreno es el
#: PMTiles.
MBTILES_WARN_BYTES = 250 * 1024 * 1024

SCHEMA = """
CREATE TABLE metadata (name text, value text);
CREATE TABLE tiles (
    zoom_level integer,
    tile_column integer,
    tile_row integer,
    tile_data blob
);
CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
CREATE UNIQUE INDEX name ON metadata (name);
"""


class MBTilesWriter(object):
    def __init__(self, path, metadata=None, batch=256):
        if os.path.exists(path):
            os.remove(path)
        self.path = path
        self.metadata = dict(metadata or {})
        self._batch = batch
        self._pending = []
        self._count = 0
        self._bytes = 0
        self._min_zoom = None
        self._max_zoom = None
        self._closed = False

        self._db = sqlite3.connect(path)
        self._db.execute('PRAGMA journal_mode=OFF')
        self._db.execute('PRAGMA synchronous=OFF')
        self._db.execute('PRAGMA page_size=4096')
        self._db.executescript(SCHEMA)
        self._db.commit()

    def add_tile(self, z, x, y, data):
        """Añade una tesela **XYZ**; la fila se voltea a TMS al guardarla."""
        if not data:
            return
        self._pending.append((z, x, grid.flip_row(z, y), sqlite3.Binary(data)))
        self._count += 1
        self._bytes += len(data)
        self._min_zoom = z if self._min_zoom is None else min(self._min_zoom, z)
        self._max_zoom = z if self._max_zoom is None else max(self._max_zoom, z)
        if len(self._pending) >= self._batch:
            self._flush()

    def _flush(self):
        if not self._pending:
            return
        self._db.executemany(
            'INSERT OR REPLACE INTO tiles '
            '(zoom_level, tile_column, tile_row, tile_data) VALUES (?,?,?,?)',
            self._pending,
        )
        self._db.commit()
        self._pending = []

    @property
    def tile_count(self):
        return self._count

    @property
    def data_bytes(self):
        return self._bytes

    def finalize(self, bounds=None, center=None, min_zoom=None, max_zoom=None):
        if self._closed:
            raise RuntimeError('MBTilesWriter ya cerrado')
        self._flush()

        min_zoom = self._min_zoom if min_zoom is None else min_zoom
        max_zoom = self._max_zoom if max_zoom is None else max_zoom
        min_zoom = 0 if min_zoom is None else min_zoom
        max_zoom = 0 if max_zoom is None else max_zoom

        meta = dict(self.metadata)
        meta.setdefault('name', os.path.splitext(os.path.basename(self.path))[0])
        meta.setdefault('format', 'png')
        meta.setdefault('type', 'overlay')
        meta.setdefault('version', '1.1')
        meta['minzoom'] = str(min_zoom)
        meta['maxzoom'] = str(max_zoom)
        if bounds:
            meta['bounds'] = ','.join('%.7f' % v for v in bounds)
            if center is None:
                center = ((bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0)
        if center is not None:
            zoom = max(min_zoom, min(max_zoom, (min_zoom + max_zoom) // 2))
            meta['center'] = '%.7f,%.7f,%d' % (center[0], center[1], zoom)

        self._db.executemany(
            'INSERT OR REPLACE INTO metadata (name, value) VALUES (?,?)',
            [(k, str(v)) for k, v in sorted(meta.items()) if v is not None],
        )
        self._db.commit()
        self._db.execute('PRAGMA optimize')
        self._db.close()
        self._closed = True
        return os.path.getsize(self.path)

    def abort(self):
        if self._closed:
            return
        self._closed = True
        self._pending = []
        try:
            self._db.close()
        except Exception:
            pass
        try:
            if os.path.exists(self.path):
                os.remove(self.path)
        except OSError:
            pass
