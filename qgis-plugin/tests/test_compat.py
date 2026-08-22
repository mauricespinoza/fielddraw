"""El plugin escribe para una app concreta: esta prueba vigila el contrato.

Si mañana FieldDraw cambia el tamaño de tesela, el umbral de aviso del
MBTiles o los formatos que acepta al importar, estas comprobaciones fallan
antes de que alguien se lleve al terreno un mapa que la app no sabe abrir.
"""

import os
import re

from _harness import check, equal, run

from fielddraw_tiles.core import grid
from fielddraw_tiles.core.mbtiles import MBTILES_WARN_BYTES
from fielddraw_tiles.core.pmtiles import TILETYPE_BY_FORMAT

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def leer(*partes):
    with open(os.path.join(REPO, *partes), encoding='utf-8') as fh:
        return fh.read()


def test_tamano_de_tesela():
    fuente = leer('src', 'tiles.js')
    check('tileSize: 256' in fuente,
          'la app pide fuentes raster de 256 px, que es lo que corta el plugin')
    equal(grid.TILE_SIZE, 256, 'el plugin corta teselas de 256 px')


def test_umbral_de_aviso_del_mbtiles():
    fuente = leer('src', 'tiles.js')
    match = re.search(r'MBTILES_WARN_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024', fuente)
    check(match is not None, 'la app declara un umbral de aviso para el MBTiles')
    if match:
        equal(MBTILES_WARN_BYTES, int(match.group(1)) * 1024 * 1024,
              'el plugin avisa en el mismo umbral que la app')


def test_volteo_de_fila():
    """La app calcula la fila TMS así; el plugin tiene que guardarla igual."""
    fuente = leer('src', 'tiles.js')
    check('const tmsY = (1 << z) - 1 - y;' in fuente,
          'la app convierte la fila XYZ a TMS al consultar')
    for z, y in ((0, 0), (3, 5), (14, 9000)):
        equal(grid.flip_row(z, y), (1 << z) - 1 - y,
              'el plugin usa la misma fórmula en z%d/%d' % (z, y))


def test_consulta_de_teselas():
    fuente = leer('src', 'tiles.js')
    check('FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?' in fuente,
          'la app consulta la tabla y las columnas que crea el plugin')
    check("SELECT name, value FROM metadata" in fuente,
          'la app lee la tabla metadata como pares nombre/valor')


def test_tipos_de_pmtiles_que_la_app_entiende():
    fuente = leer('src', 'tiles.js')
    match = re.search(r'PMTILES_KIND\s*=\s*\{([^}]*)\}', fuente)
    check(match is not None, 'la app mapea el tipo de tesela de PMTiles')
    if match:
        mapa = dict(re.findall(r'(\d+):\s*\'(\w+)\'', match.group(1)))
        for formato in ('png', 'jpg', 'webp'):
            tipo = str(TILETYPE_BY_FORMAT[formato])
            equal(mapa.get(tipo), 'raster',
                  'la app ve el tipo %s (%s) como raster' % (tipo, formato))


def test_extensiones_que_acepta_la_app():
    html = leer('index.html')
    check('.mbtiles' in html and '.pmtiles' in html,
          'el diálogo de importar acepta las dos extensiones que produce el plugin')
    fuente = leer('src', 'ui.js')
    check(".endsWith('.mbtiles')" in fuente and ".endsWith('.pmtiles')" in fuente,
          'la app decide por extensión, así que los nombres importan')


def test_las_teselas_raster_no_van_gzipeadas():
    """Solo las vectoriales se descomprimen: un raster gzipeado se vería roto."""
    fuente = leer('src', 'tiles.js')
    check("entry.tileKind === 'vector' ? maybeGunzip(bytes) : bytes" in fuente,
          'la app solo descomprime las teselas vectoriales')


TESTS = [test_tamano_de_tesela, test_umbral_de_aviso_del_mbtiles, test_volteo_de_fila,
         test_consulta_de_teselas, test_tipos_de_pmtiles_que_la_app_entiende,
         test_extensiones_que_acepta_la_app, test_las_teselas_raster_no_van_gzipeadas]

if __name__ == '__main__':
    raise SystemExit(run(TESTS))
