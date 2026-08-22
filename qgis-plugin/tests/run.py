#!/usr/bin/env python3
"""Corre todas las pruebas del plugin.

    python3 qgis-plugin/tests/run.py

Las de `test_export` necesitan GDAL y numpy —lo que trae QGIS— y se saltan
solas en un intérprete pelado. La prueba de compatibilidad con la librería
PMTiles de la app va aparte, porque es de Node:

    node qgis-plugin/tests/test_pmtiles_js.mjs
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import _harness  # noqa: E402

MODULES = ['test_grid', 'test_pmtiles', 'test_mbtiles', 'test_pyramid',
           'test_compat', 'test_qgis_compat', 'test_plugin_load', 'test_export']


def _has_numpy():
    try:
        __import__('numpy')
    except ImportError:
        return False
    return True


def main():
    tests = []
    for name in MODULES:
        module = __import__(name)
        if name == 'test_export' and not module.HAVE_GDAL:
            print('· se salta %s: este intérprete no trae osgeo/numpy' % name)
            continue
        if name == 'test_pyramid' and not _has_numpy():
            print('· se salta %s: este intérprete no trae numpy' % name)
            continue
        tests.extend(module.TESTS)
    return _harness.run(tests)


if __name__ == '__main__':
    raise SystemExit(main())
