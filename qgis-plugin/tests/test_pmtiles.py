"""Escritura de PMTiles v3.

Lo que se comprueba aquí es el formato binario: la cabecera byte a byte, el
directorio con sus varints y sus deltas, la deduplicación y el salto a
directorios hoja cuando hay muchas teselas. La comprobación de que el archivo
lo entiende la librería que usa FieldDraw está en `test_pmtiles_js.mjs`.
"""

import gzip
import json
import os
import struct
import tempfile

from _harness import check, close, equal, run

from fielddraw_tiles.core import grid
from fielddraw_tiles.core.pmtiles import (
    Entry, PMTilesReader, PMTilesWriter, TILETYPE_JPEG, TILETYPE_PNG,
    decode_varint, deserialize_directory, encode_varint, serialize_directory,
)


def tmp_path(suffix='.pmtiles'):
    handle, path = tempfile.mkstemp(suffix=suffix, prefix='fielddraw-test-')
    os.close(handle)
    os.remove(path)
    return path


def test_varint():
    for value in (0, 1, 127, 128, 300, 16383, 16384, 2 ** 31, 2 ** 53):
        data = encode_varint(value)
        equal(decode_varint(data, 0), (value, len(data)),
              'varint %d va y vuelve' % value)
    equal(encode_varint(0), b'\x00', 'el cero es un solo byte')
    equal(encode_varint(300), b'\xac\x02', '300 se codifica como en el spec')


def test_directorio():
    entries = [Entry(0, 0, 10, 1), Entry(1, 10, 20, 1), Entry(5, 100, 30, 2)]
    blob = serialize_directory(entries)
    back = deserialize_directory(blob)
    equal(len(back), 3, 'el directorio conserva las tres entradas')
    for original, restored in zip(entries, back):
        equal((restored.tile_id, restored.offset, restored.length, restored.run_length),
              (original.tile_id, original.offset, original.length, original.run_length),
              'la entrada %d va y vuelve' % original.tile_id)

    # La entrada contigua se guarda como offset 0 y ahorra bytes.
    contiguo = serialize_directory([Entry(0, 0, 10, 1), Entry(1, 10, 10, 1)])
    salteado = serialize_directory([Entry(0, 0, 10, 1), Entry(1, 5000, 10, 1)])
    check(len(contiguo) < len(salteado),
          'las teselas pegadas ocupan menos que las salteadas')


def test_archivo_minimo():
    path = tmp_path()
    try:
        writer = PMTilesWriter(path, TILETYPE_PNG, metadata={'name': 'prueba'})
        writer.add_tile(0, 0, 0, b'TESELA-RAIZ')
        size = writer.finalize(bounds=(-71.0, -34.0, -70.0, -33.0))

        equal(size, os.path.getsize(path), 'finalize devuelve el tamaño real')

        with open(path, 'rb') as fh:
            head = fh.read(127)
        equal(head[:7], b'PMTiles', 'el archivo empieza por el número mágico')
        equal(head[7], 3, 'la versión es la 3')

        reader = PMTilesReader(path)
        equal(reader.tile_type, TILETYPE_PNG, 'el tipo de tesela es PNG')
        equal(reader.min_zoom, 0, 'el zoom mínimo sale de las teselas escritas')
        equal(reader.max_zoom, 0, 'el zoom máximo sale de las teselas escritas')
        equal(reader.addressed_tiles, 1, 'hay una tesela direccionada')
        equal(reader.tile_entries, 1, 'hay una entrada de directorio')
        equal(reader.tile_contents, 1, 'hay un contenido distinto')
        close(reader.bounds[0], -71.0, 'la extensión oeste viaja en la cabecera', 1e-6)
        close(reader.bounds[3], -33.0, 'la extensión norte viaja en la cabecera', 1e-6)
        equal(reader.get(0, 0, 0), b'TESELA-RAIZ', 'la tesela se recupera intacta')
        equal(reader.get(1, 0, 0), None, 'una tesela que no existe devuelve None')

        meta = reader.metadata()
        equal(meta['name'], 'prueba', 'los metadatos guardan el nombre')
        check('bounds' in meta and 'center' in meta,
              'los metadatos incluyen extensión y centro')
    finally:
        os.path.exists(path) and os.remove(path)


def test_piramide_y_dedup():
    path = tmp_path()
    try:
        writer = PMTilesWriter(path, TILETYPE_JPEG)
        expected = {}
        # Tres niveles completos, con la mitad de las teselas repetidas.
        for z in (0, 1, 2):
            for x in range(1 << z):
                for y in range(1 << z):
                    data = b'REPETIDA' if (x + y) % 2 else ('z%dx%dy%d' % (z, x, y)).encode()
                    writer.add_tile(z, x, y, data)
                    expected[(z, x, y)] = data
        writer.finalize(bounds=(-180.0, -85.0, 180.0, 85.0))

        reader = PMTilesReader(path)
        equal(reader.addressed_tiles, 21, 'z0 + z1 + z2 son 21 teselas')
        check(reader.tile_contents < 21, 'las teselas repetidas se guardan una sola vez')
        equal(reader.min_zoom, 0, 'el zoom mínimo es 0')
        equal(reader.max_zoom, 2, 'el zoom máximo es 2')
        for (z, x, y), data in expected.items():
            equal(reader.get(z, x, y), data, 'la tesela %d/%d/%d se recupera' % (z, x, y))
    finally:
        os.path.exists(path) and os.remove(path)


def test_directorios_hoja():
    """Con muchas teselas la raíz no cabe y hay que repartir en hojas."""
    path = tmp_path()
    try:
        writer = PMTilesWriter(path, TILETYPE_PNG)
        z = 8
        muestras = []
        for x in range(0, 200):
            for y in range(0, 60):
                data = ('%d-%d' % (x, y)).encode() * 4
                writer.add_tile(z, x, y, data)
                if (x * 60 + y) % 977 == 0:
                    muestras.append(((z, x, y), data))
        writer.finalize(bounds=(-180.0, -85.0, 180.0, 85.0))

        reader = PMTilesReader(path)
        equal(reader.addressed_tiles, 200 * 60, 'están las 12.000 teselas')
        check(reader.leaf_length > 0, 'se escribieron directorios hoja')
        check(reader.root_length <= 16384, 'la raíz cabe en una petición de 16 kB')
        for (z, x, y), data in muestras:
            equal(reader.get(z, x, y), data,
                  'la tesela %d/%d/%d se encuentra pasando por las hojas' % (z, x, y))
    finally:
        os.path.exists(path) and os.remove(path)


def test_cabecera_completa():
    path = tmp_path()
    try:
        writer = PMTilesWriter(path, TILETYPE_PNG, metadata={'name': 'cabecera'})
        writer.add_tile(5, 10, 12, b'x' * 64)
        writer.finalize(bounds=(-72.5, -35.25, -70.25, -33.5))

        with open(path, 'rb') as fh:
            head = fh.read(127)
        (root_off, root_len, meta_off, meta_len,
         leaf_off, leaf_len, data_off, data_len) = struct.unpack('<QQQQQQQQ', head[8:72])
        equal(root_off, 127, 'la raíz empieza justo después de la cabecera')
        equal(meta_off, root_off + root_len, 'los metadatos siguen a la raíz')
        equal(leaf_off, meta_off + meta_len, 'las hojas siguen a los metadatos')
        equal(data_off, leaf_off + leaf_len, 'las teselas van al final')
        equal(data_len, 64, 'el bloque de teselas mide lo que se escribió')
        equal(data_off + data_len, os.path.getsize(path),
              'el archivo termina donde dice la cabecera')

        clustered, internal, tile_comp, tile_type, minz, maxz = struct.unpack(
            '<BBBBBB', head[96:102])
        equal(internal, 2, 'los directorios van comprimidos con gzip')
        equal(tile_comp, 1, 'las teselas raster no llevan compresión extra')
        equal(tile_type, 2, 'el tipo declarado es PNG')
        equal((minz, maxz), (5, 5), 'los zooms de la cabecera son los escritos')

        blob = gzip.decompress(open(path, 'rb').read()[meta_off:meta_off + meta_len])
        equal(json.loads(blob.decode())['name'], 'cabecera',
              'los metadatos son JSON gzipeado')
    finally:
        os.path.exists(path) and os.remove(path)


def test_orden_hilbert_en_el_directorio():
    """Las entradas del directorio van ordenadas por id de tesela."""
    path = tmp_path()
    try:
        writer = PMTilesWriter(path, TILETYPE_PNG)
        # A propósito en un orden que no es el de Hilbert.
        for x, y in ((1, 0), (0, 0), (1, 1), (0, 1)):
            writer.add_tile(1, x, y, ('%d%d' % (x, y)).encode())
        writer.finalize(bounds=(-180.0, -85.0, 180.0, 85.0))

        reader = PMTilesReader(path)
        entries = deserialize_directory(
            gzip.decompress(open(path, 'rb').read()[
                reader.root_offset:reader.root_offset + reader.root_length]))
        ids = [entry.tile_id for entry in entries]
        equal(ids, sorted(ids), 'el directorio queda ordenado por id')
        equal(ids, [grid.tile_id(1, 0, 0), grid.tile_id(1, 0, 1),
                    grid.tile_id(1, 1, 1), grid.tile_id(1, 1, 0)],
              'el orden es el de la curva de Hilbert')
        for x, y in ((0, 0), (0, 1), (1, 0), (1, 1)):
            equal(reader.get(1, x, y), ('%d%d' % (x, y)).encode(),
                  'la tesela 1/%d/%d se recupera pese al desorden de entrada' % (x, y))
    finally:
        os.path.exists(path) and os.remove(path)


def test_abortar():
    path = tmp_path()
    writer = PMTilesWriter(path, TILETYPE_PNG)
    writer.add_tile(0, 0, 0, b'algo')
    writer.abort()
    check(not os.path.exists(path), 'abortar no deja el archivo final')
    check(not os.path.exists(path + '.tiledata.tmp'),
          'abortar no deja el temporal de teselas')


TESTS = [test_varint, test_directorio, test_archivo_minimo, test_piramide_y_dedup,
         test_directorios_hoja, test_cabecera_completa,
         test_orden_hilbert_en_el_directorio, test_abortar]

if __name__ == '__main__':
    raise SystemExit(run(TESTS))
