#!/usr/bin/env python3
"""Fabrica los archivos de prueba que leen `test_pmtiles_js.mjs` y `test_mbtiles.py`.

Las teselas no son imágenes de verdad: llevan un texto reconocible, que es lo
que hace falta para comprobar que el contenedor devuelve exactamente lo que se
guardó, en la tesela correcta.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fielddraw_tiles.core.mbtiles import MBTilesWriter
from fielddraw_tiles.core.pmtiles import PMTilesWriter, TILETYPE_PNG

#: Zona de prueba: un trozo de la costa de Chile central.
BOUNDS = (-71.75, -33.75, -71.25, -33.25)
MIN_ZOOM, MAX_ZOOM = 8, 12


def payload(z, x, y):
    return ('tesela|%d|%d|%d|' % (z, x, y)).encode() + bytes([z & 0xFF, x & 0xFF, y & 0xFF])


def tiles():
    """Pirámide sobre la extensión de prueba, sin las teselas 'vacías'."""
    from fielddraw_tiles.core import grid
    bounds_m = grid.lonlat_to_meters(BOUNDS[0], BOUNDS[1]) + \
        grid.lonlat_to_meters(BOUNDS[2], BOUNDS[3])
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        x0, y0, x1, y1 = grid.tile_range(bounds_m, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                # Una de cada siete se deja fuera, como un hueco sin datos.
                if (x * 31 + y) % 7 == 3:
                    continue
                yield z, x, y, payload(z, x, y)


def build(directory):
    pmtiles_path = os.path.join(directory, 'fixture.pmtiles')
    mbtiles_path = os.path.join(directory, 'fixture.mbtiles')
    meta = {'name': 'Prueba FieldDraw', 'format': 'png', 'type': 'overlay'}

    pm = PMTilesWriter(pmtiles_path, TILETYPE_PNG, metadata=dict(meta))
    mb = MBTilesWriter(mbtiles_path, dict(meta))
    count = 0
    for z, x, y, data in tiles():
        pm.add_tile(z, x, y, data)
        mb.add_tile(z, x, y, data)
        count += 1
    center = ((BOUNDS[0] + BOUNDS[2]) / 2, (BOUNDS[1] + BOUNDS[3]) / 2)
    pm.finalize(BOUNDS, center, MIN_ZOOM, MAX_ZOOM)
    mb.finalize(BOUNDS, center, MIN_ZOOM, MAX_ZOOM)
    return pmtiles_path, mbtiles_path, count


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else '.'
    paths = build(target)
    print('%s\n%s\n%d' % paths)
