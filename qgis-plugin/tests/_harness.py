"""Mini arnés de pruebas, sin dependencias.

Mismo espíritu que los `test/*.test.mjs` de la app: cuentan comprobaciones y
fallan ruidosamente, sin framework.
"""

import os
import sys
import traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

_checks = 0
_failures = []


def check(condition, label):
    global _checks
    _checks += 1
    if not condition:
        _failures.append(label)
        print('  FALLA  %s' % label)


def equal(actual, expected, label):
    check(actual == expected, '%s (esperado %r, obtenido %r)' % (label, expected, actual))


def close(actual, expected, label, tolerance=1e-6):
    check(abs(actual - expected) <= tolerance,
          '%s (esperado %r ± %g, obtenido %r)' % (label, expected, tolerance, actual))


def raises(fn, label):
    try:
        fn()
    except Exception:
        check(True, label)
        return
    check(False, '%s (no lanzó excepción)' % label)


def run(tests):
    for test in tests:
        print('· %s' % test.__name__)
        try:
            test()
        except Exception:
            _failures.append(test.__name__)
            traceback.print_exc()
    return report()


def report():
    print('')
    if _failures:
        print('%d de %d comprobaciones fallaron:' % (len(_failures), _checks))
        for failure in _failures:
            print('  - %s' % failure)
        return 1
    print('%d comprobaciones OK' % _checks)
    return 0
