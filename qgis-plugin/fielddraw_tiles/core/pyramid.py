"""Construcción de la pirámide de teselas a partir de un raster alineado.

La idea de todo el módulo: el raster de entrada ya está reproyectado a
EPSG:3857 y **alineado a la grilla de teselas del zoom máximo**, así que cada
tesela de ese nivel es una ventana exacta de 256x256 píxeles —sin remuestreo
ni redondeos— y los niveles de arriba se arman promediando los cuatro hijos.

Se recorre en profundidad: cada tesela se codifica y se entrega en cuanto está
lista, y en memoria nunca hay más de cuatro teselas por nivel de profundidad
(unos pocos MB), da igual el tamaño del raster.
"""

import numpy as np

TILE_SIZE = 256


class Cancelled(Exception):
    """El usuario canceló la exportación."""


def blank_tile(tile_size=TILE_SIZE):
    return np.zeros((4, tile_size, tile_size), dtype=np.uint8)


def is_empty(tile):
    """Una tesela sin un solo píxel opaco no se guarda.

    FieldDraw ya responde con un PNG transparente cuando falta una tesela
    (`readMbtilesTile` en `src/tiles.js`), así que guardar los huecos solo
    engordaría el archivo.
    """
    return tile is None or not tile[3].any()


def combine_children(children, tile_size=TILE_SIZE):
    """Cuatro hijos ``[NO, NE, SO, SE]`` -> la tesela padre, o ``None``.

    El promedio se hace sobre el color **premultiplicado** por el alfa: si no,
    los píxeles transparentes (que suelen ser negros) tiñen de oscuro el borde
    del raster al subir de nivel.
    """
    if all(child is None for child in children):
        return None

    big = np.zeros((4, tile_size * 2, tile_size * 2), dtype=np.uint8)
    for index, child in enumerate(children):
        if child is None:
            continue
        row = (index // 2) * tile_size
        col = (index % 2) * tile_size
        big[:, row:row + tile_size, col:col + tile_size] = child

    alpha = big[3].astype(np.uint32)
    premul = big[:3].astype(np.uint32) * alpha[np.newaxis, :, :]

    shape = (tile_size, 2, tile_size, 2)
    alpha_sum = alpha.reshape(shape).sum(axis=(1, 3))
    premul_sum = premul.reshape((3,) + shape).sum(axis=(2, 4))

    out = np.zeros((4, tile_size, tile_size), dtype=np.uint8)
    safe = np.maximum(alpha_sum, 1)
    rgb = (premul_sum + safe // 2) // safe
    out[:3] = np.where(alpha_sum > 0, rgb, 0).astype(np.uint8)
    out[3] = ((alpha_sum + 2) // 4).astype(np.uint8)
    return out


class PyramidBuilder(object):
    """Recorre el cuadrante que cubre el raster y emite cada tesela una vez.

    :param read_base: ``f(x, y) -> ndarray(4, 256, 256) | None`` para el zoom
        máximo.
    :param emit: ``f(z, x, y, tile)`` con la tesela ya construida.
    :param base_range: ``(x0, y0, x1, y1)`` de teselas del zoom máximo.
    """

    def __init__(self, read_base, emit, base_range, min_zoom, max_zoom,
                 tile_size=TILE_SIZE, is_cancelled=None, on_progress=None):
        self.read_base = read_base
        self.emit = emit
        self.base_range = base_range
        self.min_zoom = min_zoom
        self.max_zoom = max_zoom
        self.tile_size = tile_size
        self.is_cancelled = is_cancelled or (lambda: False)
        self.on_progress = on_progress or (lambda done, total: None)
        x0, y0, x1, y1 = base_range
        self.total_base = (x1 - x0 + 1) * (y1 - y0 + 1)
        self.done_base = 0
        self.emitted = 0

    def _covers_data(self, z, x, y):
        """¿El subárbol de esta tesela toca alguna tesela con datos?"""
        factor = 1 << (self.max_zoom - z)
        x0, y0, x1, y1 = self.base_range
        return not (x * factor > x1 or (x + 1) * factor - 1 < x0
                    or y * factor > y1 or (y + 1) * factor - 1 < y0)

    def _build(self, z, x, y):
        if self.is_cancelled():
            raise Cancelled()
        if not self._covers_data(z, x, y):
            return None

        if z == self.max_zoom:
            tile = self.read_base(x, y)
            self.done_base += 1
            if self.done_base % 16 == 0 or self.done_base == self.total_base:
                self.on_progress(self.done_base, self.total_base)
        else:
            children = [
                self._build(z + 1, x * 2 + dx, y * 2 + dy)
                for dy in (0, 1) for dx in (0, 1)
            ]
            tile = combine_children(children, self.tile_size)

        if is_empty(tile):
            return None
        self.emit(z, x, y, tile)
        self.emitted += 1
        return tile

    def run(self):
        """Construye desde ``min_zoom`` hacia abajo. Devuelve teselas emitidas."""
        shift = self.max_zoom - self.min_zoom
        x0, y0, x1, y1 = self.base_range
        for x in range(x0 >> shift, (x1 >> shift) + 1):
            for y in range(y0 >> shift, (y1 >> shift) + 1):
                self._build(self.min_zoom, x, y)
        self.on_progress(self.total_base, self.total_base)
        return self.emitted
