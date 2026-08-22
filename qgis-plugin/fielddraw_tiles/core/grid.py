"""Grilla Web Mercator (EPSG:3857) y numeración de teselas.

Todo el módulo es Python puro: no importa GDAL ni QGIS, así que se puede
probar fuera de QGIS. Las convenciones son las que exige FieldDraw:

- Teselas de **256 px** (`src/tiles.js` fija `tileSize: 256` para las fuentes
  raster; con 512 el mapa saldría al doble de escala).
- Esquema **XYZ** (fila 0 al norte) para MapLibre y para PMTiles.
- MBTiles guarda la fila en **TMS** (fila 0 al sur): `flip_row()` convierte.
"""

import math

TILE_SIZE = 256

EARTH_RADIUS = 6378137.0
ORIGIN_SHIFT = math.pi * EARTH_RADIUS  # 20037508.342789244
#: Latitud donde Web Mercator se corta para que el mundo sea cuadrado.
MAX_LATITUDE = 85.05112877980659

#: Zoom máximo admitido. Más allá la resolución (< 4 cm/px) no aporta nada.
MAX_ZOOM = 24


def resolution(zoom, tile_size=TILE_SIZE):
    """Metros por píxel en el ecuador para un nivel de zoom."""
    return (2.0 * ORIGIN_SHIFT) / (tile_size * (2 ** zoom))


def lonlat_to_meters(lon, lat):
    """Grados WGS84 -> metros EPSG:3857."""
    lat = max(-MAX_LATITUDE, min(MAX_LATITUDE, lat))
    x = lon * ORIGIN_SHIFT / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) * EARTH_RADIUS
    return x, y


def meters_to_lonlat(x, y):
    """Metros EPSG:3857 -> grados WGS84."""
    lon = x / ORIGIN_SHIFT * 180.0
    lat = math.degrees(2.0 * math.atan(math.exp(y / EARTH_RADIUS)) - math.pi / 2.0)
    return lon, lat


def tile_bounds_meters(z, x, y):
    """Extensión (xmin, ymin, xmax, ymax) en metros de una tesela XYZ."""
    span = 2.0 * ORIGIN_SHIFT / (2 ** z)
    xmin = -ORIGIN_SHIFT + x * span
    ymax = ORIGIN_SHIFT - y * span
    return (xmin, ymax - span, xmin + span, ymax)


def tile_bounds_lonlat(z, x, y):
    xmin, ymin, xmax, ymax = tile_bounds_meters(z, x, y)
    w, s = meters_to_lonlat(xmin, ymin)
    e, n = meters_to_lonlat(xmax, ymax)
    return (w, s, e, n)


#: Un borde que cae a menos de una millonésima de tesela de la línea de la
#: grilla es esa línea: sin este ajuste, el error de coma flotante al calcular
#: los bordes hace aparecer una fila o columna de teselas vacías de más.
GRID_EPSILON = 1e-6


def _snap(value):
    nearest = round(value)
    return float(nearest) if abs(value - nearest) < GRID_EPSILON else value


def tile_range(bounds_m, z):
    """Teselas XYZ que intersectan una extensión en metros.

    Devuelve ``(x0, y0, x1, y1)`` inclusivo. El borde superior/derecho se
    trata como abierto: una extensión que termina justo en el límite de una
    tesela no arrastra la siguiente.
    """
    xmin, ymin, xmax, ymax = bounds_m
    span = 2.0 * ORIGIN_SHIFT / (2 ** z)
    n = 2 ** z

    def col(v, upper):
        t = _snap((v + ORIGIN_SHIFT) / span)
        t = math.ceil(t) - 1 if upper else math.floor(t)
        return int(min(n - 1, max(0, t)))

    def row(v, upper):
        t = _snap((ORIGIN_SHIFT - v) / span)
        t = math.ceil(t) - 1 if upper else math.floor(t)
        return int(min(n - 1, max(0, t)))

    x0 = col(xmin, False)
    x1 = col(xmax, True)
    y0 = row(ymax, False)   # ymax es la fila más al norte -> y menor
    y1 = row(ymin, True)
    return (x0, y0, max(x0, x1), max(y0, y1))


def zoom_for_resolution(res, tile_size=TILE_SIZE):
    """Zoom cuya resolución se acerca más a ``res`` metros por píxel."""
    if res <= 0:
        return MAX_ZOOM
    z = math.log2((2.0 * ORIGIN_SHIFT) / (tile_size * res))
    return int(max(0, min(MAX_ZOOM, round(z))))


def zoom_for_extent(bounds_m, tile_size=TILE_SIZE):
    """Zoom más alto en que la extensión completa cabe en una sola tesela."""
    xmin, ymin, xmax, ymax = bounds_m
    size = max(xmax - xmin, ymax - ymin)
    if size <= 0:
        return 0
    for z in range(0, MAX_ZOOM + 1):
        x0, y0, x1, y1 = tile_range(bounds_m, z)
        if x1 > x0 or y1 > y0:
            return max(0, z - 1)
    return MAX_ZOOM


def flip_row(z, y):
    """XYZ <-> TMS. Es involutiva: aplicarla dos veces devuelve el original."""
    return (1 << z) - 1 - y


def clip_bounds(bounds_m):
    """Recorta una extensión al mundo Web Mercator."""
    xmin, ymin, xmax, ymax = bounds_m
    return (
        max(-ORIGIN_SHIFT, xmin),
        max(-ORIGIN_SHIFT, ymin),
        min(ORIGIN_SHIFT, xmax),
        min(ORIGIN_SHIFT, ymax),
    )


def align_to_grid(bounds_m, z):
    """Expande la extensión hasta los bordes de las teselas del nivel ``z``.

    Alinear el raster reproyectado a la grilla es lo que permite después
    recortar cada tesela como una ventana entera de 256x256 píxeles, sin
    remuestreo ni redondeos: los bordes de las teselas caen exactamente sobre
    los bordes de los bloques del GeoTIFF.
    """
    x0, y0, x1, y1 = tile_range(bounds_m, z)
    xmin = tile_bounds_meters(z, x0, y0)[0]
    ymax = tile_bounds_meters(z, x0, y0)[3]
    xmax = tile_bounds_meters(z, x1, y1)[2]
    ymin = tile_bounds_meters(z, x1, y1)[1]
    return (x0, y0, x1, y1), (xmin, ymin, xmax, ymax)


# --------------------------------------------------------------------------
# Identificador de tesela de PMTiles (curva de Hilbert)
# --------------------------------------------------------------------------

def tile_id(z, x, y):
    """``(z, x, y)`` -> id de tesela PMTiles v3.

    Los niveles se apilan (``(4^z - 1) / 3`` teselas por debajo) y dentro de
    cada nivel el orden es la curva de Hilbert, que mantiene juntas en el
    archivo las teselas vecinas en el mapa.
    """
    if z < 0 or z > 31:
        raise ValueError('zoom fuera de rango: %r' % (z,))
    n = 1 << z
    if not (0 <= x < n and 0 <= y < n):
        raise ValueError('tesela fuera del nivel %d: %r,%r' % (z, x, y))

    acc = ((1 << (z * 2)) - 1) // 3
    d = 0
    s = n >> 1
    while s > 0:
        rx = 1 if (x & s) > 0 else 0
        ry = 1 if (y & s) > 0 else 0
        d += s * s * ((3 * rx) ^ ry)
        # Rotar el cuadrante.
        if ry == 0:
            if rx == 1:
                x = s - 1 - x
                y = s - 1 - y
            x, y = y, x
        s >>= 1
    return acc + d


def tile_id_to_zxy(i):
    """Inversa de :func:`tile_id`. Existe sobre todo para poder probarla."""
    if i < 0:
        raise ValueError('id negativo')
    acc = 0
    z = 0
    while True:
        num = (1 << (z * 2))
        if i < acc + num:
            break
        acc += num
        z += 1
        if z > 31:
            raise ValueError('id fuera de rango')

    d = i - acc
    x = y = 0
    s = 1
    n = 1 << z
    while s < n:
        rx = 1 & (d >> 1)
        ry = 1 & (d ^ rx)
        if ry == 0:
            if rx == 1:
                x = s - 1 - x
                y = s - 1 - y
            x, y = y, x
        x += s * rx
        y += s * ry
        d >>= 2
        s <<= 1
    return z, x, y
