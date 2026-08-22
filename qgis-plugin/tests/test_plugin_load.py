"""Carga el complemento con QGIS simulado.

Lo que prueba es acotado, y conviene decirlo: **no** prueba que el algoritmo
haga lo correcto —de eso se encargan las demás—, sino que el complemento
*carga*. Es decir, que `classFactory` devuelve el objeto, que `initGui` y
`unload` no revientan, que el proveedor se registra y que `initAlgorithm`
declara sus parámetros sin tropezar con un nombre de clase mal escrito. Son
justo los fallos que en QGIS aparecen como un diálogo rojo al arrancar, y los
únicos que se pueden cazar sin QGIS delante.

Corre en un subproceso a propósito: los módulos simulados se quedan pegados en
`sys.modules`, y `test_export` necesita el `osgeo` de verdad.
"""

import os
import subprocess
import sys

from _harness import check, equal, run

HERE = os.path.dirname(os.path.abspath(__file__))

CHILD = r'''
import sys, types

class Meta(type):
    def __getattr__(cls, name):
        if name.startswith('__'):
            raise AttributeError(name)
        return Stub()

class Stub(metaclass=Meta):
    """Se deja llamar, heredar y preguntar por cualquier atributo."""
    def __init__(self, *args, **kwargs):
        pass
    def __call__(self, *args, **kwargs):
        return Stub()
    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        return Stub()
    def __or__(self, other):
        return Stub()
    def __eq__(self, other):
        return False
    def __hash__(self):
        return id(self)

class FakeModule(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        return Stub

for name in ('qgis', 'qgis.core', 'qgis.gui', 'qgis.PyQt', 'qgis.PyQt.QtGui',
             'qgis.PyQt.QtCore', 'qgis.PyQt.QtWidgets', 'osgeo'):
    sys.modules[name] = FakeModule(name)
gdal = FakeModule('osgeo.gdal')
sys.modules['osgeo.gdal'] = gdal
sys.modules['osgeo'].gdal = gdal

sys.path.insert(0, sys.argv[1])

import fielddraw_tiles
import fielddraw_tiles.algorithm as algorithm
import fielddraw_tiles.provider as provider

plugin = fielddraw_tiles.classFactory(Stub())
print('classFactory:%s' % type(plugin).__name__)
plugin.initGui()
plugin.unload()
print('gui:ok')

registro = provider.FieldDrawProvider()
registro.loadAlgorithms()
print('provider:%s' % registro.id())

alg = algorithm.RasterToFieldDrawTiles()
alg.initAlgorithm()
print('algorithm:%s:%s' % (alg.name(), type(alg.createInstance()).__name__))
print('formats:%s' % ','.join(algorithm.FORMATS))
print('help:%d' % len(alg.shortHelpString()))
'''


def test_carga_del_complemento():
    root = os.path.dirname(HERE)
    proceso = subprocess.run(
        [sys.executable, '-c', CHILD, root],
        capture_output=True, text=True, cwd=HERE)

    if proceso.returncode != 0:
        check(False, 'el complemento carga sin errores')
        print(proceso.stderr.strip()[-2000:])
        return

    salida = dict(
        (linea.split(':', 1)[0], linea.split(':', 1)[1])
        for linea in proceso.stdout.strip().splitlines() if ':' in linea)

    equal(salida.get('classFactory'), 'FieldDrawTilesPlugin',
          'classFactory devuelve el complemento, que es lo que QGIS carga')
    equal(salida.get('gui'), 'ok', 'initGui y unload no revientan')
    equal(salida.get('provider'), 'fielddraw',
          'el proveedor se registra con el id que espera el botón')
    equal(salida.get('algorithm'), 'rastertofielddrawtiles:RasterToFieldDrawTiles',
          'el algoritmo declara su nombre y se puede clonar')
    equal(salida.get('formats'), 'auto,webp,jpeg,png,png8',
          'el desplegable de formatos ofrece los cinco, en orden')
    check(int(salida.get('help', 0)) > 500, 'la ayuda del algoritmo no está vacía')


def test_el_boton_llama_al_algoritmo_que_existe():
    """El id que abre el botón tiene que ser el que registra el proveedor."""
    with open(os.path.join(os.path.dirname(HERE), 'fielddraw_tiles', 'plugin.py'),
              encoding='utf-8') as fh:
        codigo = fh.read()
    check("execAlgorithmDialog('fielddraw:rastertofielddrawtiles'" in codigo,
          'el botón abre «fielddraw:rastertofielddrawtiles»')


TESTS = [test_carga_del_complemento, test_el_boton_llama_al_algoritmo_que_existe]

if __name__ == '__main__':
    raise SystemExit(run(TESTS))
