"""Grilla Web Mercator y numeración de teselas."""

from _harness import check, close, equal, raises, run

from fielddraw_tiles.core import grid


def test_conversion_lonlat():
    x, y = grid.lonlat_to_meters(0, 0)
    close(x, 0.0, 'el meridiano cero cae en x=0')
    close(y, 0.0, 'el ecuador cae en y=0')

    x, y = grid.lonlat_to_meters(180, grid.MAX_LATITUDE)
    close(x, grid.ORIGIN_SHIFT, 'lon 180 es el borde del mundo', 1e-6)
    close(y, grid.ORIGIN_SHIFT, 'la latitud de corte es el borde norte', 1e-3)

    # Santiago de Chile, ida y vuelta.
    lon, lat = -70.6483, -33.4569
    back = grid.meters_to_lonlat(*grid.lonlat_to_meters(lon, lat))
    close(back[0], lon, 'la longitud sobrevive al viaje de ida y vuelta', 1e-9)
    close(back[1], lat, 'la latitud sobrevive al viaje de ida y vuelta', 1e-9)

    check(grid.lonlat_to_meters(0, 89)[1] == grid.lonlat_to_meters(0, 86)[1],
          'la latitud se recorta al límite de Mercator')


def test_resolucion():
    close(grid.resolution(0), 156543.03392804097, 'z0 son ~156 km por píxel', 1e-6)
    close(grid.resolution(1), grid.resolution(0) / 2, 'cada nivel divide por dos', 1e-9)
    equal(grid.zoom_for_resolution(grid.resolution(14)), 14, 'la resolución de z14 da z14')
    equal(grid.zoom_for_resolution(0.5), 18, 'medio metro por píxel es z18')
    equal(grid.zoom_for_resolution(0), grid.MAX_ZOOM, 'resolución cero se topa con el máximo')


def test_extension_de_tesela():
    xmin, ymin, xmax, ymax = grid.tile_bounds_meters(0, 0, 0)
    close(xmin, -grid.ORIGIN_SHIFT, 'z0 empieza en el borde oeste')
    close(ymax, grid.ORIGIN_SHIFT, 'z0 termina en el borde norte')
    close(xmax - xmin, ymax - ymin, 'la tesela del mundo es cuadrada')

    # La fila 0 de XYZ es la del norte.
    norte = grid.tile_bounds_meters(1, 0, 0)
    sur = grid.tile_bounds_meters(1, 0, 1)
    check(norte[3] > sur[3], 'y=0 está más al norte que y=1')

    w, s, e, n = grid.tile_bounds_lonlat(0, 0, 0)
    close(w, -180.0, 'la tesela raíz llega a lon -180', 1e-9)
    close(e, 180.0, 'la tesela raíz llega a lon 180', 1e-9)


def test_rango_de_teselas():
    equal(grid.tile_range((-grid.ORIGIN_SHIFT, -grid.ORIGIN_SHIFT,
                           grid.ORIGIN_SHIFT, grid.ORIGIN_SHIFT), 0),
          (0, 0, 0, 0), 'el mundo entero es una sola tesela en z0')

    equal(grid.tile_range((-grid.ORIGIN_SHIFT, -grid.ORIGIN_SHIFT,
                           grid.ORIGIN_SHIFT, grid.ORIGIN_SHIFT), 1),
          (0, 0, 1, 1), 'el mundo entero son cuatro teselas en z1')

    # Cuadrante nororiental exacto: el borde no debe arrastrar la tesela vecina.
    equal(grid.tile_range((0, 0, grid.ORIGIN_SHIFT, grid.ORIGIN_SHIFT), 1),
          (1, 0, 1, 0), 'el borde exacto no suma una tesela de más')

    bounds = grid.tile_bounds_meters(10, 512, 300)
    equal(grid.tile_range(bounds, 10), (512, 300, 512, 300),
          'la extensión de una tesela devuelve esa misma tesela')

    dentro = (bounds[0] + 1, bounds[1] + 1, bounds[2] - 1, bounds[3] - 1)
    equal(grid.tile_range(dentro, 10), (512, 300, 512, 300),
          'una extensión contenida no se sale de la tesela')

    equal(grid.tile_range(dentro, 11), (1024, 600, 1025, 601),
          'la misma extensión son cuatro teselas un nivel más abajo')


def test_zoom_para_extension():
    bounds = grid.tile_bounds_meters(12, 1000, 2000)
    equal(grid.zoom_for_extent(bounds), 12,
          'una extensión de una tesela cabe entera en su nivel')
    dos = grid.tile_bounds_meters(12, 1000, 2000)
    tres = grid.tile_bounds_meters(12, 1001, 2000)
    juntas = (dos[0], dos[1], tres[2], tres[3])
    equal(grid.zoom_for_extent(juntas), 11, 'dos teselas vecinas caben en la de arriba')


def test_alineacion():
    bounds = (-7900000.0, -3970000.0, -7880000.0, -3950000.0)
    tiles, aligned = grid.align_to_grid(bounds, 14)
    x0, y0, x1, y1 = tiles
    check(aligned[0] <= bounds[0] and aligned[1] <= bounds[1],
          'la extensión alineada contiene la pedida por el suroeste')
    check(aligned[2] >= bounds[2] and aligned[3] >= bounds[3],
          'la extensión alineada contiene la pedida por el noreste')
    equal(grid.tile_range(aligned, 14), tiles,
          'la extensión alineada cubre exactamente su rango de teselas')

    span = grid.resolution(14) * 256
    close((aligned[2] - aligned[0]) / span, x1 - x0 + 1,
          'el ancho alineado es un número entero de teselas', 1e-6)
    close((aligned[3] - aligned[1]) / span, y1 - y0 + 1,
          'el alto alineado es un número entero de teselas', 1e-6)


def test_tms():
    equal(grid.flip_row(0, 0), 0, 'en z0 la única fila es la misma en TMS')
    equal(grid.flip_row(1, 0), 1, 'la fila norte de XYZ es la fila 1 de TMS')
    equal(grid.flip_row(1, 1), 0, 'la fila sur de XYZ es la fila 0 de TMS')
    for z in (2, 8, 14):
        for y in (0, 1, (1 << z) - 1):
            equal(grid.flip_row(z, grid.flip_row(z, y)), y,
                  'voltear dos veces la fila z%d/%d la deja igual' % (z, y))


def test_id_de_tesela_pmtiles():
    equal(grid.tile_id(0, 0, 0), 0, 'la tesela raíz es el id 0')
    equal([grid.tile_id(1, x, y) for x, y in ((0, 0), (0, 1), (1, 1), (1, 0))],
          [1, 2, 3, 4], 'z1 sigue el orden de Hilbert del spec de PMTiles')
    equal(grid.tile_id(2, 0, 0), 5, 'z2 empieza justo después de z1')
    equal(grid.tile_id(3, 0, 0), 21, 'z3 empieza en (4^3-1)/3 + ...')

    for i in range(0, 4096):
        z, x, y = grid.tile_id_to_zxy(i)
        check(grid.tile_id(z, x, y) == i, 'ida y vuelta del id %d' % i)

    # Cada nivel ocupa un tramo contiguo y sin huecos.
    for z in range(0, 6):
        ids = sorted(grid.tile_id(z, x, y)
                     for x in range(1 << z) for y in range(1 << z))
        equal(len(set(ids)), len(ids), 'los ids de z%d no se repiten' % z)
        equal(ids, list(range(ids[0], ids[0] + len(ids))),
              'los ids de z%d son consecutivos' % z)

    raises(lambda: grid.tile_id(1, 2, 0), 'una tesela fuera del nivel es un error')
    raises(lambda: grid.tile_id(-1, 0, 0), 'un zoom negativo es un error')


def test_recorte():
    huge = (-4e7, -4e7, 4e7, 4e7)
    clipped = grid.clip_bounds(huge)
    close(clipped[0], -grid.ORIGIN_SHIFT, 'el recorte topa con el borde oeste')
    close(clipped[3], grid.ORIGIN_SHIFT, 'el recorte topa con el borde norte')


TESTS = [test_conversion_lonlat, test_resolucion, test_extension_de_tesela,
         test_rango_de_teselas, test_zoom_para_extension, test_alineacion,
         test_tms, test_id_de_tesela_pmtiles, test_recorte]

if __name__ == '__main__':
    raise SystemExit(run(TESTS))
