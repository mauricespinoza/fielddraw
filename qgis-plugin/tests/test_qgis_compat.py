"""El puente de compatibilidad QGIS 3 / QGIS 4 (`fielddraw_tiles/qgis_compat.py`).

No hay manera de instalar aquí un QGIS 3.16 de verdad y un QGIS 4 de verdad
para comprobar contra los dos. Lo que sí se puede probar sin QGIS delante es
el propio algoritmo de resolución: que `_first()` prueba las formas en el
orden correcto, que se queda con la primera que existe, y que si ninguna
existe falla con un error claro en vez de colarse con `None`.

Cada prueba levanta un `qgis.core` de mentira con la forma de una versión
concreta de QGIS y comprueba qué valor queda en cada constante. Va en un
subproceso porque los módulos falsos se quedan pegados en `sys.modules`.
"""

import os
import subprocess
import sys

from _harness import check, equal, run

HERE = os.path.dirname(os.path.abspath(__file__))

#: Cada plantilla arma un `qgis.core.Qgis` / `QgsProcessingParameterNumber` /
#: `QgsProcessingParameterDefinition` / `QgsMapLayer` con la forma de una
#: versión concreta, y deja que `qgis_compat` resuelva sobre eso.
CHILD = r'''
import sys, types

FORMA = sys.argv[2]

class Sentinel:
    """Un valor reconocible: si aparece en la salida, es que se resolvió
    a través de esta ruta y no de otra."""
    def __init__(self, nombre):
        self.nombre = nombre
    def __repr__(self):
        return self.nombre

ENTERO = Sentinel('entero')
AVANZADO = Sentinel('avanzado')
RASTER = Sentinel('raster')


class Vacio(object):
    """Una clase sin el atributo pedido: forzar el `AttributeError`."""
    pass


class ModuloFalso(types.ModuleType):
    pass


def instalar(qgis_core, qtgui_tiene_qaction):
    sys.modules['qgis'] = ModuloFalso('qgis')
    sys.modules['qgis.core'] = qgis_core
    sys.modules['qgis'].core = qgis_core

    pyqt = ModuloFalso('qgis.PyQt')
    sys.modules['qgis.PyQt'] = pyqt
    sys.modules['qgis'].PyQt = pyqt

    class QAction(object):
        pass

    qtgui = ModuloFalso('qgis.PyQt.QtGui')
    qtgui.QIcon = object
    if qtgui_tiene_qaction:
        qtgui.QAction = QAction
    sys.modules['qgis.PyQt.QtGui'] = qtgui
    pyqt.QtGui = qtgui

    qtwidgets = ModuloFalso('qgis.PyQt.QtWidgets')
    if not qtgui_tiene_qaction:
        qtwidgets.QAction = QAction
    qtwidgets.QMessageBox = object
    sys.modules['qgis.PyQt.QtWidgets'] = qtwidgets
    pyqt.QtWidgets = qtwidgets

    return QAction


def armar_qgis_core(forma):
    core = ModuloFalso('qgis.core')

    if forma == 'plano':
        # QGIS 3.16: todo suelto en la clase, sin `Qgis.*` centralizado.
        class QgsProcessingParameterNumber(object):
            Integer = ENTERO
        class QgsProcessingParameterDefinition(object):
            FlagAdvanced = AVANZADO
        class QgsMapLayer(object):
            RasterLayer = RASTER
        class Qgis(object):
            pass  # sin los enums centralizados todavía

    elif forma == 'anidado':
        # Etapa intermedia: enum anidado bajo `.Type` / `.Flag` / `.LayerType`.
        class _Type(object):
            Integer = ENTERO
        class QgsProcessingParameterNumber(object):
            Type = _Type
        class _Flag(object):
            FlagAdvanced = AVANZADO
        class QgsProcessingParameterDefinition(object):
            Flag = _Flag
        class _LayerType(object):
            RasterLayer = RASTER
        class QgsMapLayer(object):
            LayerType = _LayerType
        class Qgis(object):
            pass

    elif forma == 'centralizado':
        # QGIS 4: todo bajo `Qgis`, con el nombre del miembro de capa
        # cambiado de `RasterLayer` a `Raster`.
        class _NumberType(object):
            Integer = ENTERO
        class _ParamFlag(object):
            FlagAdvanced = AVANZADO
        class _LayerType(object):
            Raster = RASTER
        class Qgis(object):
            ProcessingNumberParameterType = _NumberType
            ProcessingParameterFlag = _ParamFlag
            LayerType = _LayerType
        class QgsProcessingParameterNumber(Vacio):
            pass
        class QgsProcessingParameterDefinition(Vacio):
            pass
        class QgsMapLayer(Vacio):
            pass

    elif forma == 'nada':
        # Ninguna de las tres formas: tiene que fallar, no devolver None.
        class Qgis(object):
            pass
        class QgsProcessingParameterNumber(Vacio):
            pass
        class QgsProcessingParameterDefinition(Vacio):
            pass
        class QgsMapLayer(Vacio):
            pass

    else:
        raise SystemExit('forma desconocida: %r' % forma)

    core.Qgis = Qgis
    core.QgsMapLayer = QgsMapLayer
    core.QgsProcessingParameterDefinition = QgsProcessingParameterDefinition
    core.QgsProcessingParameterNumber = QgsProcessingParameterNumber
    return core


qtgui_tiene_qaction = (FORMA == 'centralizado')  # el caso "QGIS 4" también prueba el QAction
QActionEsperada = instalar(armar_qgis_core(FORMA), qtgui_tiene_qaction)

sys.path.insert(0, sys.argv[1])

if FORMA == 'nada':
    try:
        import fielddraw_tiles.qgis_compat  # noqa: F401
    except AttributeError as exc:
        print('fallo:%s' % exc)
    else:
        print('fallo:NO SE LANZO')
else:
    import fielddraw_tiles.qgis_compat as compat
    print('entero:%r' % (compat.PROCESSING_INTEGER is ENTERO))
    print('avanzado:%r' % (compat.PARAMETER_FLAG_ADVANCED is AVANZADO))
    print('raster:%r' % (compat.RASTER_LAYER_TYPE is RASTER))
    print('qaction:%r' % (compat.QAction is QActionEsperada))
'''


def _run(forma):
    root = os.path.dirname(HERE)
    proceso = subprocess.run(
        [sys.executable, '-c', CHILD, root, forma],
        capture_output=True, text=True, cwd=HERE)
    if proceso.returncode != 0:
        return None, proceso.stderr
    salida = {}
    for linea in proceso.stdout.strip().splitlines():
        if ':' not in linea:
            continue
        clave, valor = linea.split(':', 1)
        salida[clave] = valor
    return salida, proceso.stderr


def test_forma_plana_de_qgis_316():
    salida, err = _run('plano')
    check(salida is not None, 'la forma «plana» (QGIS 3.16) carga sin errores: %s' % err)
    if salida:
        equal(salida.get('entero'), 'True', 'PROCESSING_INTEGER sale del acceso plano')
        equal(salida.get('avanzado'), 'True', 'PARAMETER_FLAG_ADVANCED sale del acceso plano')
        equal(salida.get('raster'), 'True', 'RASTER_LAYER_TYPE sale del acceso plano')


def test_forma_anidada_intermedia():
    salida, err = _run('anidado')
    check(salida is not None, 'la forma anidada (`.Type`/`.Flag`/`.LayerType`) carga: %s' % err)
    if salida:
        equal(salida.get('entero'), 'True', 'PROCESSING_INTEGER sale del enum anidado')
        equal(salida.get('avanzado'), 'True', 'PARAMETER_FLAG_ADVANCED sale del enum anidado')
        equal(salida.get('raster'), 'True', 'RASTER_LAYER_TYPE sale del enum anidado')


def test_forma_centralizada_qgis4():
    salida, err = _run('centralizado')
    check(salida is not None, 'la forma centralizada (QGIS 4, bajo `Qgis`) carga: %s' % err)
    if salida:
        equal(salida.get('entero'), 'True',
              'PROCESSING_INTEGER sale de Qgis.ProcessingNumberParameterType')
        equal(salida.get('avanzado'), 'True',
              'PARAMETER_FLAG_ADVANCED sale de Qgis.ProcessingParameterFlag')
        equal(salida.get('raster'), 'True',
              'RASTER_LAYER_TYPE sale de Qgis.LayerType.Raster pese al nombre distinto')
        equal(salida.get('qaction'), 'True',
              'QAction se importa desde QtGui cuando es ahí donde vive (Qt6)')


def test_sin_ninguna_forma_conocida_falla_claro():
    """Si ninguna de las tres rutas existe, tiene que fallar alto y claro."""
    salida, err = _run('nada')
    check(salida is not None, 'el proceso corre (aunque falle la importación): %s' % err)
    if salida:
        check('fallo' in salida,
              'se reporta un AttributeError en vez de colarse con None')
        check(salida.get('fallo') != 'NO SE LANZO',
              'con las tres rutas ausentes, `qgis_compat` no se importa en silencio')


TESTS = [test_forma_plana_de_qgis_316, test_forma_anidada_intermedia,
         test_forma_centralizada_qgis4, test_sin_ninguna_forma_conocida_falla_claro]

if __name__ == '__main__':
    raise SystemExit(run(TESTS))
