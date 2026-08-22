"""Construcción de la pirámide: promedio de los hijos y recorrido del árbol."""

import numpy as np

from _harness import check, equal, run

from fielddraw_tiles.core.pyramid import (
    Cancelled, PyramidBuilder, blank_tile, combine_children, is_empty,
)

SIZE = 4  # teselas diminutas: la lógica es la misma y se lee mejor


def solid(r, g, b, a=255, size=SIZE):
    tile = np.zeros((4, size, size), dtype=np.uint8)
    tile[0], tile[1], tile[2], tile[3] = r, g, b, a
    return tile


def test_vacias():
    check(is_empty(None), 'una tesela que no existe está vacía')
    check(is_empty(blank_tile(SIZE)), 'una tesela sin alfa está vacía')
    check(not is_empty(solid(1, 2, 3)), 'una tesela opaca no está vacía')
    semi = blank_tile(SIZE)
    semi[3, 0, 0] = 1
    check(not is_empty(semi), 'un solo píxel con alfa 1 ya cuenta')


def test_cada_hijo_en_su_cuadrante():
    """El orden de los hijos es [NO, NE, SO, SE], el mismo que usa el recorrido."""
    hijos = [solid(10, 10, 10), solid(100, 100, 100),
             solid(200, 200, 200), solid(250, 250, 250)]
    padre = combine_children(hijos, SIZE)
    equal(padre.shape, (4, SIZE, SIZE), 'el padre mide lo mismo que un hijo')
    equal(int(padre[3, 0, 0]), 255, 'cuatro hijos opacos dan un padre opaco')

    mitad = SIZE // 2
    esquinas = {
        'noroeste': (0, 0, 10), 'noreste': (0, mitad, 100),
        'suroeste': (mitad, 0, 200), 'sureste': (mitad, mitad, 250),
    }
    for nombre, (fila, columna, valor) in esquinas.items():
        equal(int(padre[0, fila, columna]), valor,
              'el hijo del %s ocupa su cuadrante' % nombre)


def test_promedio_dentro_del_hijo():
    """Cada píxel del padre es el promedio de un bloque 2x2 de su hijo."""
    hijo = solid(0, 0, 0)
    hijo[0, 0, 0], hijo[0, 0, 1] = 0, 100
    hijo[0, 1, 0], hijo[0, 1, 1] = 200, 255
    padre = combine_children([hijo, None, None, None], SIZE)
    equal(int(padre[0, 0, 0]), round((0 + 100 + 200 + 255) / 4),
          'el píxel del padre promedia los cuatro que lo forman')


def test_un_solo_hijo():
    padre = combine_children([solid(10, 20, 30), None, None, None], SIZE)
    equal(int(padre[0, 0, 0]), 10, 'el cuadrante del hijo conserva su color')
    equal(int(padre[3, 0, 0]), 255, 'y su opacidad')
    mitad = SIZE // 2
    equal(int(padre[3, mitad, mitad]), 0, 'los cuadrantes sin hijo quedan vacíos')
    equal(combine_children([None] * 4, SIZE), None,
          'sin ningún hijo no hay padre')


def test_el_alfa_no_ensucia_el_color():
    """Sin premultiplicar, el negro transparente oscurecería el borde."""
    opaco = solid(255, 0, 0, 255)
    transparente = solid(0, 0, 0, 0)      # negro, pero invisible
    padre = combine_children([opaco, transparente, transparente, transparente], SIZE)
    equal(int(padre[0, 0, 0]), 255, 'el rojo se mantiene puro en el borde')
    equal(int(padre[1, 0, 0]), 0, 'sin verde de más')
    equal(int(padre[3, 0, 0]), 255, 'el cuadrante opaco sigue opaco')

    mezcla = combine_children([opaco, opaco, transparente, transparente], SIZE)
    fila_sur = SIZE // 2
    equal(int(mezcla[3, fila_sur, 0]), 0, 'la mitad transparente sigue vacía')
    equal(int(mezcla[0, 0, 0]), 255, 'la mitad opaca sigue roja')


def test_alfa_parcial():
    medio = solid(200, 200, 200, 128)
    padre = combine_children([medio] * 4, SIZE)
    equal(int(padre[3, 0, 0]), 128, 'el alfa se promedia igual que el color')
    equal(int(padre[0, 0, 0]), 200, 'el color no se altera con alfa uniforme')


class Recolector(object):
    """Un raster de mentira: 4x3 teselas base, con un hueco."""

    def __init__(self, x0=6, y0=10, x1=9, y1=12, hueco=(7, 11)):
        self.base_range = (x0, y0, x1, y1)
        self.hueco = hueco
        self.leidas = []
        self.emitidas = []

    def read(self, x, y):
        self.leidas.append((x, y))
        if (x, y) == self.hueco:
            return None
        return solid(x % 256, y % 256, 128)

    def emit(self, z, x, y, tile):
        self.emitidas.append((z, x, y))


def test_recorrido_del_arbol():
    datos = Recolector()
    builder = PyramidBuilder(datos.read, datos.emit, datos.base_range,
                             min_zoom=10, max_zoom=14, tile_size=SIZE)
    emitidas = builder.run()

    x0, y0, x1, y1 = datos.base_range
    base = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    equal(sorted(datos.leidas), sorted(base),
          'se lee exactamente el rango de teselas base, ni una más')

    emitidas_base = [(x, y) for (z, x, y) in datos.emitidas if z == 14]
    equal(sorted(emitidas_base), sorted(t for t in base if t != datos.hueco),
          'se emiten todas las teselas base menos el hueco')

    equal(len(datos.emitidas), emitidas, 'run() devuelve cuántas emitió')
    equal(len(set(datos.emitidas)), len(datos.emitidas),
          'ninguna tesela se emite dos veces')

    niveles = sorted({z for (z, _x, _y) in datos.emitidas})
    equal(niveles, [10, 11, 12, 13, 14], 'están todos los niveles pedidos')

    # Cada padre emitido tiene que cubrir alguna tesela base con datos.
    for z, x, y in datos.emitidas:
        factor = 1 << (14 - z)
        cubre = [(bx, by) for bx, by in base
                 if x * factor <= bx < (x + 1) * factor
                 and y * factor <= by < (y + 1) * factor
                 and (bx, by) != datos.hueco]
        check(bool(cubre), 'la tesela %d/%d/%d cubre datos de verdad' % (z, x, y))

    # Un solo abuelo en el nivel mínimo: el rango cabe holgado en una tesela z10.
    raiz = [t for t in datos.emitidas if t[0] == 10]
    equal(len(raiz), 1, 'el nivel mínimo se resuelve en una sola tesela')


def test_todo_vacio_no_emite_nada():
    datos = Recolector()
    datos.read = lambda x, y: None
    builder = PyramidBuilder(datos.read, datos.emit, datos.base_range, 12, 14, SIZE)
    equal(builder.run(), 0, 'un raster sin datos no genera teselas')
    equal(datos.emitidas, [], 'y no emite ninguna')


def test_progreso_y_cancelacion():
    datos = Recolector()
    avances = []
    builder = PyramidBuilder(datos.read, datos.emit, datos.base_range, 12, 14, SIZE,
                             on_progress=lambda done, total: avances.append((done, total)))
    builder.run()
    equal(avances[-1], (12, 12), 'el progreso termina en el total de teselas base')

    datos2 = Recolector()
    cancelado = PyramidBuilder(datos2.read, datos2.emit, datos2.base_range, 12, 14,
                               SIZE, is_cancelled=lambda: True)
    try:
        cancelado.run()
        check(False, 'cancelar debería interrumpir la construcción')
    except Cancelled:
        check(True, 'cancelar interrumpe la construcción')
    equal(datos2.emitidas, [], 'una construcción cancelada no emite nada')


def test_tamano_real_de_tesela():
    """La misma lógica con las teselas de 256 px que usa FieldDraw."""
    hijos = [np.full((4, 256, 256), 60, dtype=np.uint8) for _ in range(4)]
    padre = combine_children(hijos, 256)
    equal(padre.shape, (4, 256, 256), 'el padre de cuatro teselas de 256 mide 256')
    check(bool((padre == 60).all()), 'cuatro hijos iguales dan un padre idéntico')


TESTS = [test_vacias, test_cada_hijo_en_su_cuadrante,
         test_promedio_dentro_del_hijo, test_un_solo_hijo,
         test_el_alfa_no_ensucia_el_color, test_alfa_parcial,
         test_recorrido_del_arbol, test_todo_vacio_no_emite_nada,
         test_progreso_y_cancelacion, test_tamano_real_de_tesela]

if __name__ == '__main__':
    raise SystemExit(run(TESTS))
