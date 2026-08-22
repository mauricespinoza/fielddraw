"""Escritor (y lector mínimo) de PMTiles v3.

Python puro, sin dependencias: no hace falta instalar la librería `pmtiles`
en el intérprete de QGIS, que en Windows es justo lo que no se puede pedir.

Formato, resumido (todo little-endian):

    | cabecera 127 B | directorio raíz | metadatos JSON | hojas | teselas |

El directorio es una lista de entradas ``(tile_id, offset, length,
run_length)`` ordenadas por ``tile_id`` y serializadas por columnas con
varints y deltas. Una entrada con ``run_length == 0`` no apunta a una tesela
sino a un directorio hoja, que es como el formato escala a millones de
teselas manteniendo la raíz por debajo de 16 KB (una sola petición de rango).

Referencia: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
"""

import gzip
import hashlib
import io
import json
import os
import shutil
import struct

from . import grid

MAGIC = b'PMTiles'
VERSION = 3
HEADER_BYTES = 127
#: La raíz debe caber en una sola petición de rango; el spec recomienda 16 KB.
MAX_ROOT_BYTES = 16384

COMPRESSION_UNKNOWN = 0
COMPRESSION_NONE = 1
COMPRESSION_GZIP = 2

TILETYPE_UNKNOWN = 0
TILETYPE_MVT = 1
TILETYPE_PNG = 2
TILETYPE_JPEG = 3
TILETYPE_WEBP = 4
TILETYPE_AVIF = 5

#: `src/tiles.js` mapea estos tipos a raster; MVT es el único vectorial.
TILETYPE_BY_FORMAT = {
    'png': TILETYPE_PNG,
    'jpg': TILETYPE_JPEG,
    'jpeg': TILETYPE_JPEG,
    'webp': TILETYPE_WEBP,
    'avif': TILETYPE_AVIF,
    'pbf': TILETYPE_MVT,
    'mvt': TILETYPE_MVT,
}


def encode_varint(value):
    if value < 0:
        raise ValueError('varint negativo')
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def decode_varint(buf, pos):
    result = 0
    shift = 0
    while True:
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


class Entry(object):
    __slots__ = ('tile_id', 'offset', 'length', 'run_length')

    def __init__(self, tile_id, offset, length, run_length=1):
        self.tile_id = tile_id
        self.offset = offset
        self.length = length
        self.run_length = run_length


def serialize_directory(entries):
    """Entradas ordenadas -> bytes del directorio (sin comprimir)."""
    buf = io.BytesIO()
    buf.write(encode_varint(len(entries)))

    last_id = 0
    for entry in entries:
        buf.write(encode_varint(entry.tile_id - last_id))
        last_id = entry.tile_id
    for entry in entries:
        buf.write(encode_varint(entry.run_length))
    for entry in entries:
        buf.write(encode_varint(entry.length))
    for i, entry in enumerate(entries):
        # 0 significa "va pegado a la entrada anterior": ahorra un varint por
        # tesela en el caso normal, que es el archivo escrito de corrido.
        if i > 0 and entry.offset == entries[i - 1].offset + entries[i - 1].length:
            buf.write(encode_varint(0))
        else:
            buf.write(encode_varint(entry.offset + 1))
    return buf.getvalue()


def deserialize_directory(data):
    entries = []
    pos = 0
    count, pos = decode_varint(data, pos)

    last_id = 0
    for _ in range(count):
        delta, pos = decode_varint(data, pos)
        last_id += delta
        entries.append(Entry(last_id, 0, 0, 0))
    for entry in entries:
        entry.run_length, pos = decode_varint(data, pos)
    for entry in entries:
        entry.length, pos = decode_varint(data, pos)
    for i, entry in enumerate(entries):
        raw, pos = decode_varint(data, pos)
        if raw == 0 and i > 0:
            entry.offset = entries[i - 1].offset + entries[i - 1].length
        else:
            entry.offset = raw - 1
    return entries


def _gzip(data):
    # mtime=0 para que el archivo sea reproducible byte a byte.
    return gzip.compress(data, 9, mtime=0)


def _e7(value):
    return int(round(value * 10000000))


def build_header(**kw):
    out = bytearray()
    out += struct.pack('<7sB', MAGIC, VERSION)
    out += struct.pack(
        '<QQQQQQQQ',
        kw['root_offset'], kw['root_length'],
        kw['metadata_offset'], kw['metadata_length'],
        kw['leaf_offset'], kw['leaf_length'],
        kw['data_offset'], kw['data_length'],
    )
    out += struct.pack(
        '<QQQ',
        kw['addressed_tiles'], kw['tile_entries'], kw['tile_contents'],
    )
    out += struct.pack(
        '<BBBBBB',
        1 if kw['clustered'] else 0,
        kw['internal_compression'], kw['tile_compression'], kw['tile_type'],
        kw['min_zoom'], kw['max_zoom'],
    )
    west, south, east, north = kw['bounds']
    out += struct.pack('<iiii', _e7(west), _e7(south), _e7(east), _e7(north))
    out += struct.pack('<B', kw['center_zoom'])
    out += struct.pack('<ii', _e7(kw['center_lon']), _e7(kw['center_lat']))
    assert len(out) == HEADER_BYTES, len(out)
    return bytes(out)


def optimize_directories(entries, max_root_bytes=MAX_ROOT_BYTES):
    """Reparte las entradas entre raíz y hojas.

    Devuelve ``(raiz_comprimida, hojas_comprimidas, num_hojas)``. Mientras
    quepan todas en la raíz no se escribe ninguna hoja, que es el caso de casi
    cualquier mapa de terreno.
    """
    root = _gzip(serialize_directory(entries))
    if len(root) <= max_root_bytes:
        return root, b'', 0

    leaf_size = 4096
    while True:
        root_entries = []
        leaves = io.BytesIO()
        count = 0
        for i in range(0, len(entries), leaf_size):
            chunk = entries[i:i + leaf_size]
            blob = _gzip(serialize_directory(chunk))
            offset = leaves.tell()
            leaves.write(blob)
            # run_length 0 = la entrada apunta a un directorio hoja.
            root_entries.append(Entry(chunk[0].tile_id, offset, len(blob), 0))
            count += 1
        root = _gzip(serialize_directory(root_entries))
        if len(root) <= max_root_bytes or leaf_size >= 2 ** 20:
            return root, leaves.getvalue(), count
        leaf_size *= 2


class PMTilesWriter(object):
    """Acumula teselas en un archivo temporal y arma el PMTiles al cerrar.

    Las teselas idénticas (típicamente el mar, o una zona de color plano) se
    guardan una sola vez: el directorio permite que varias entradas apunten al
    mismo offset.
    """

    def __init__(self, path, tile_type=TILETYPE_PNG,
                 tile_compression=COMPRESSION_NONE, metadata=None):
        self.path = path
        self.tile_type = tile_type
        self.tile_compression = tile_compression
        self.metadata = dict(metadata or {})

        self._tmp_path = path + '.tiledata.tmp'
        self._tmp = open(self._tmp_path, 'wb')
        self._entries = []
        self._by_hash = {}
        self._addressed = 0
        self._contents = 0
        self._offset = 0
        self._min_zoom = None
        self._max_zoom = None
        self._closed = False

    # -- escritura ---------------------------------------------------------

    def add_tile(self, z, x, y, data):
        if not data:
            return
        key = hashlib.blake2b(data, digest_size=16).digest()
        placed = self._by_hash.get(key)
        if placed is None:
            offset = self._offset
            self._tmp.write(data)
            self._offset += len(data)
            self._by_hash[key] = (offset, len(data))
            self._contents += 1
        else:
            offset, _ = placed
        self._entries.append(Entry(grid.tile_id(z, x, y), offset, len(data), 1))
        self._addressed += 1
        self._min_zoom = z if self._min_zoom is None else min(self._min_zoom, z)
        self._max_zoom = z if self._max_zoom is None else max(self._max_zoom, z)

    @property
    def tile_count(self):
        return self._addressed

    @property
    def data_bytes(self):
        return self._offset

    # -- cierre ------------------------------------------------------------

    def finalize(self, bounds=None, center=None, min_zoom=None, max_zoom=None):
        """Escribe el archivo final. Devuelve su tamaño en bytes."""
        if self._closed:
            raise RuntimeError('PMTilesWriter ya cerrado')
        self._tmp.close()
        self._closed = True

        entries = sorted(self._entries, key=lambda e: e.tile_id)
        merged = []
        for entry in entries:
            prev = merged[-1] if merged else None
            if (prev is not None
                    and prev.offset == entry.offset
                    and prev.length == entry.length
                    and prev.tile_id + prev.run_length == entry.tile_id):
                prev.run_length += 1
            else:
                merged.append(entry)

        root, leaves, _ = optimize_directories(merged)

        min_zoom = self._min_zoom if min_zoom is None else min_zoom
        max_zoom = self._max_zoom if max_zoom is None else max_zoom
        min_zoom = 0 if min_zoom is None else min_zoom
        max_zoom = 0 if max_zoom is None else max_zoom

        bounds = bounds or (-180.0, -85.0, 180.0, 85.0)
        if center is None:
            center = ((bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0)
        center_zoom = max(min_zoom, min(max_zoom, (min_zoom + max_zoom) // 2))

        meta = dict(self.metadata)
        meta.setdefault('bounds', ','.join('%.7f' % v for v in bounds))
        meta.setdefault('center', '%.7f,%.7f,%d' % (center[0], center[1], center_zoom))
        meta.setdefault('minzoom', str(min_zoom))
        meta.setdefault('maxzoom', str(max_zoom))
        metadata_blob = _gzip(json.dumps(meta, ensure_ascii=False,
                                         sort_keys=True).encode('utf-8'))

        root_offset = HEADER_BYTES
        metadata_offset = root_offset + len(root)
        leaf_offset = metadata_offset + len(metadata_blob)
        data_offset = leaf_offset + len(leaves)

        header = build_header(
            root_offset=root_offset, root_length=len(root),
            metadata_offset=metadata_offset, metadata_length=len(metadata_blob),
            leaf_offset=leaf_offset, leaf_length=len(leaves),
            data_offset=data_offset, data_length=self._offset,
            addressed_tiles=self._addressed,
            tile_entries=len(merged),
            tile_contents=self._contents,
            # Las teselas se escriben en orden de pirámide, no de Hilbert.
            clustered=False,
            internal_compression=COMPRESSION_GZIP,
            tile_compression=self.tile_compression,
            tile_type=self.tile_type,
            min_zoom=min_zoom, max_zoom=max_zoom,
            bounds=bounds,
            center_zoom=center_zoom,
            center_lon=center[0], center_lat=center[1],
        )

        with open(self.path, 'wb') as out:
            out.write(header)
            out.write(root)
            out.write(metadata_blob)
            out.write(leaves)
            with open(self._tmp_path, 'rb') as tmp:
                shutil.copyfileobj(tmp, out, 4 * 1024 * 1024)
        os.remove(self._tmp_path)
        return os.path.getsize(self.path)

    def abort(self):
        """Cierra y borra el temporal (cancelación o error)."""
        if not self._closed:
            self._closed = True
            try:
                self._tmp.close()
            except Exception:
                pass
        for path in (self._tmp_path,):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass


class PMTilesReader(object):
    """Lector mínimo, para comprobar lo que se escribió."""

    def __init__(self, path):
        self.path = path
        with open(path, 'rb') as fh:
            head = fh.read(HEADER_BYTES)
        if head[:7] != MAGIC or head[7] != VERSION:
            raise ValueError('no es un PMTiles v3')
        (self.root_offset, self.root_length,
         self.metadata_offset, self.metadata_length,
         self.leaf_offset, self.leaf_length,
         self.data_offset, self.data_length) = struct.unpack('<QQQQQQQQ', head[8:72])
        (self.addressed_tiles, self.tile_entries,
         self.tile_contents) = struct.unpack('<QQQ', head[72:96])
        (clustered, self.internal_compression, self.tile_compression,
         self.tile_type, self.min_zoom, self.max_zoom) = struct.unpack('<BBBBBB', head[96:102])
        self.clustered = bool(clustered)
        west, south, east, north = struct.unpack('<iiii', head[102:118])
        self.bounds = (west / 1e7, south / 1e7, east / 1e7, north / 1e7)
        self.center_zoom = head[118]
        lon, lat = struct.unpack('<ii', head[119:127])
        self.center = (lon / 1e7, lat / 1e7)

    def _read(self, offset, length):
        with open(self.path, 'rb') as fh:
            fh.seek(offset)
            return fh.read(length)

    def _decompress(self, data):
        return gzip.decompress(data) if self.internal_compression == COMPRESSION_GZIP else data

    def metadata(self):
        blob = self._decompress(self._read(self.metadata_offset, self.metadata_length))
        return json.loads(blob.decode('utf-8'))

    def _directory(self, offset, length):
        return deserialize_directory(self._decompress(self._read(offset, length)))

    def get(self, z, x, y):
        """Devuelve los bytes de la tesela, o ``None`` si no está."""
        target = grid.tile_id(z, x, y)
        offset, length = self.root_offset, self.root_length
        for _ in range(4):  # raíz + hasta 3 niveles de hojas
            entries = self._directory(offset, length)
            found = None
            for entry in entries:
                span = entry.run_length if entry.run_length > 0 else 1
                if entry.tile_id <= target < entry.tile_id + span:
                    found = entry
                    break
                if entry.run_length == 0 and entry.tile_id <= target:
                    found = entry
            if found is None:
                return None
            if found.run_length == 0:
                offset = self.leaf_offset + found.offset
                length = found.length
                continue
            return self._read(self.data_offset + found.offset, found.length)
        return None
