"""Codificación de cada tesela a PNG / JPEG / WebP con GDAL.

El objetivo es que los archivos salgan **livianos** sin perder compatibilidad
con lo que FieldDraw sabe pintar (`raster` de MapLibre, decodificado por el
navegador). De ahí las cuatro decisiones del módulo:

1. Una tesela totalmente transparente no se guarda: es un hueco, y la app ya
   devuelve un PNG transparente cuando no encuentra la tesela.
2. Una tesela totalmente opaca no necesita canal alfa: en PNG se guardan tres
   bandas en vez de cuatro (~25% menos) y en modo automático se guarda como
   JPEG, que para una ortofoto es entre cinco y diez veces más pequeño.
3. El modo automático mezcla formatos dentro del mismo archivo: JPEG en el
   interior opaco y WebP —o PNG si GDAL no trae WebP— en los bordes con alfa.
   MapLibre decodifica cada tesela por su contenido, no por el `format`
   declarado, así que la mezcla le da igual a la app. La diferencia no es
   cosmética: una tesela de borde de una ortofoto pesa ~170 kB en PNG y ~5 kB
   en WebP, y en un ráster grande los bordes son cientos de teselas.
4. `png8` cuantiza a 256 colores con paleta: para un mapa geológico de colores
   planos suele bajar el tamaño a la mitad o menos sin cambio visible.
"""

import threading

import numpy as np

from osgeo import gdal

# Ojo: aquí NO se llama a `gdal.UseExceptions()`. Es un ajuste global del
# proceso, y un complemento no tiene por qué cambiarle el comportamiento de
# GDAL al resto de QGIS. En vez de eso se comprueba cada retorno.

#: Formatos ofrecidos al usuario, en el mismo orden que el desplegable.
FORMATS = ('auto', 'webp', 'jpeg', 'png', 'png8')

FORMAT_LABELS = {
    'auto': 'Automático: JPEG donde es opaco, WebP/PNG donde hay transparencia',
    'webp': 'WebP (el más liviano; Safari 14+, Chrome, Firefox)',
    'jpeg': 'JPEG (sin transparencia)',
    'png': 'PNG 24/32 bits (sin pérdida)',
    'png8': 'PNG 8 bits con paleta (mapas de colores planos)',
}

#: Lo que se declara en `metadata.format` (MBTiles) y en el tipo de PMTiles.
CONTAINER_FORMAT = {
    'auto': 'jpg', 'webp': 'webp', 'jpeg': 'jpg', 'png': 'png', 'png8': 'png',
}

_counter = 0
_counter_lock = threading.Lock()


def _vsi_name(ext):
    global _counter
    with _counter_lock:
        _counter += 1
        return '/vsimem/fielddraw_tile_%d.%s' % (_counter, ext)


def webp_available():
    return gdal.GetDriverByName('WEBP') is not None


def auto_alpha_format():
    """Qué usa el modo automático para las teselas con transparencia."""
    return 'webp' if webp_available() else 'png'


def _mem_dataset(bands):
    height, width = bands[0].shape
    ds = gdal.GetDriverByName('MEM').Create('', width, height, len(bands), gdal.GDT_Byte)
    interp = [gdal.GCI_RedBand, gdal.GCI_GreenBand, gdal.GCI_BlueBand, gdal.GCI_AlphaBand]
    for index, array in enumerate(bands):
        band = ds.GetRasterBand(index + 1)
        band.WriteArray(np.ascontiguousarray(array))
        band.SetColorInterpretation(interp[index])
    return ds


def _create_copy(driver_name, ds, ext, options):
    path = _vsi_name(ext)
    driver = gdal.GetDriverByName(driver_name)
    if driver is None:
        raise RuntimeError('GDAL no trae el controlador %s' % driver_name)
    out = driver.CreateCopy(path, ds, strict=0, options=options)
    if out is None:
        raise RuntimeError('%s no pudo codificar la tesela: %s'
                           % (driver_name, gdal.GetLastErrorMsg()))
    out.FlushCache()
    del out
    try:
        handle = gdal.VSIFOpenL(path, 'rb')
        gdal.VSIFSeekL(handle, 0, 2)
        size = gdal.VSIFTellL(handle)
        gdal.VSIFSeekL(handle, 0, 0)
        data = gdal.VSIFReadL(1, size, handle)
        gdal.VSIFCloseL(handle)
    finally:
        gdal.Unlink(path)
    return bytes(data)


def composite_over(tile, background):
    """Aplana RGBA sobre un color de fondo. Devuelve tres bandas uint8."""
    alpha = tile[3].astype(np.uint16)
    out = []
    for index in range(3):
        fg = tile[index].astype(np.uint16)
        bg = np.uint16(background[index])
        out.append(((fg * alpha + bg * (255 - alpha) + 127) // 255).astype(np.uint8))
    return out


class TileEncoder(object):
    def __init__(self, fmt='auto', quality=75, background=(255, 255, 255),
                 alpha_threshold=128):
        if fmt not in FORMATS:
            raise ValueError('formato desconocido: %r' % (fmt,))
        if fmt == 'webp' and not webp_available():
            raise RuntimeError(
                'Esta instalación de GDAL no trae el controlador WEBP. '
                'Elige «Automático», PNG o JPEG.')
        self.fmt = fmt
        #: En modo automático, con qué se guardan las teselas con alfa.
        self.alpha_format = auto_alpha_format() if fmt == 'auto' else fmt
        self.quality = int(max(1, min(100, quality)))
        self.background = background
        self.alpha_threshold = alpha_threshold

    @property
    def container_format(self):
        return CONTAINER_FORMAT[self.fmt]

    def encode(self, tile):
        """``ndarray(4, alto, ancho)`` -> bytes, o ``None`` si sobra."""
        alpha = tile[3]
        if not alpha.any():
            return None
        opaque = bool(alpha.min() == 255)

        fmt = self.fmt
        if fmt == 'auto':
            fmt = 'jpeg' if opaque else self.alpha_format

        if fmt == 'jpeg':
            return self._jpeg(tile)
        if fmt == 'webp':
            return self._webp(tile, opaque)
        if fmt == 'png8':
            return self._png8(tile, opaque)
        return self._png(tile, opaque)

    # -- por formato -------------------------------------------------------

    def _jpeg(self, tile):
        ds = _mem_dataset(composite_over(tile, self.background))
        return _create_copy('JPEG', ds, 'jpg', ['QUALITY=%d' % self.quality])

    def _webp(self, tile, opaque):
        bands = list(tile[:3]) if opaque else list(tile)
        ds = _mem_dataset(bands)
        return _create_copy('WEBP', ds, 'webp', ['QUALITY=%d' % self.quality])

    def _png(self, tile, opaque):
        # Sin transparencia el canal alfa es un cuarto del archivo tirado.
        bands = list(tile[:3]) if opaque else list(tile)
        ds = _mem_dataset(bands)
        return _create_copy('PNG', ds, 'png', ['ZLEVEL=9'])

    def _png8(self, tile, opaque):
        """Cuantiza a paleta. El alfa se binariza contra el umbral."""
        rgb = list(tile[:3]) if opaque else composite_over(tile, self.background)
        source = _mem_dataset(rgb)
        colors = 256 if opaque else 255
        table = gdal.ColorTable()
        bands = [source.GetRasterBand(i + 1) for i in range(3)]
        if gdal.ComputeMedianCutPCT(bands[0], bands[1], bands[2], colors, table) != 0:
            raise RuntimeError('GDAL no pudo calcular la paleta: %s'
                               % gdal.GetLastErrorMsg())

        target = gdal.GetDriverByName('MEM').Create('', tile.shape[2], tile.shape[1],
                                                    1, gdal.GDT_Byte)
        target_band = target.GetRasterBand(1)
        if gdal.DitherRGB2PCT(bands[0], bands[1], bands[2], target_band, table) != 0:
            raise RuntimeError('GDAL no pudo cuantizar la tesela: %s'
                               % gdal.GetLastErrorMsg())

        if not opaque:
            # El índice 255 queda libre y se reserva para el hueco.
            table.SetColorEntry(255, (0, 0, 0, 0))
            indexes = target_band.ReadAsArray()
            indexes[tile[3] < self.alpha_threshold] = 255
            target_band.WriteArray(indexes)
        target_band.SetRasterColorTable(table)
        target_band.SetColorInterpretation(gdal.GCI_PaletteIndex)
        return _create_copy('PNG', target, 'png', ['ZLEVEL=9'])
