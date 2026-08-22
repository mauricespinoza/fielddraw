#!/usr/bin/env python3
"""Genera `fielddraw_tiles/icon.png` a partir de `icon.svg`, sin dependencias.

QGIS pide un PNG en `metadata.txt` para el gestor de complementos. El dibujo
es el mismo que el del SVG: una cuadrícula de teselas sobre el fondo oscuro de
FieldDraw, con la tesela superior izquierda rellena.
"""

import os
import struct
import zlib

SIZE = 96
BG = (13, 17, 23)          # --bg de la app
ACCENT = (45, 212, 191)    # --accent
DIM = (45, 212, 191, 110)


def rounded(x, y, size, radius):
    """¿El píxel está dentro de un cuadrado de esquinas redondeadas?"""
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def blend(dst, src, alpha):
    return tuple(int(round(s * alpha + d * (1 - alpha))) for d, s in zip(dst, src))


def build():
    pixels = [[(0, 0, 0, 0)] * SIZE for _ in range(SIZE)]
    radius = SIZE // 5

    for y in range(SIZE):
        for x in range(SIZE):
            if rounded(x + 0.5, y + 0.5, SIZE, radius):
                pixels[y][x] = BG + (255,)

    # Cuadrícula 2x2 de teselas.
    margin = SIZE // 6
    gap = max(2, SIZE // 24)
    cell = (SIZE - 2 * margin - gap) // 2
    stroke = max(2, SIZE // 20)

    for row in range(2):
        for col in range(2):
            x0 = margin + col * (cell + gap)
            y0 = margin + row * (cell + gap)
            filled = (row, col) == (0, 0)
            for y in range(y0, y0 + cell):
                for x in range(x0, x0 + cell):
                    if not (0 <= x < SIZE and 0 <= y < SIZE):
                        continue
                    edge = (x < x0 + stroke or x >= x0 + cell - stroke
                            or y < y0 + stroke or y >= y0 + cell - stroke)
                    base = pixels[y][x][:3]
                    if filled:
                        pixels[y][x] = ACCENT + (255,)
                    elif edge:
                        pixels[y][x] = blend(base, DIM[:3], DIM[3] / 255.0) + (255,)
    return pixels


def write_png(path, pixels):
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filtro None
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        payload = tag + data
        return (struct.pack('>I', len(data)) + payload
                + struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as fh:
        fh.write(png)


if __name__ == '__main__':
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          '..', 'fielddraw_tiles', 'icon.png')
    write_png(os.path.normpath(target), build())
    print('escrito', os.path.normpath(target))
