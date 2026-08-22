#!/usr/bin/env python3
"""Arma el ZIP instalable del plugin.

    python3 qgis-plugin/tools/package.py

Deja `qgis-plugin/dist/fielddraw_tiles-<versión>.zip`, que se instala en QGIS
con **Complementos → Administrar e instalar complementos → Instalar a partir
de ZIP**. La versión sale de `metadata.txt`, que es la única fuente.
"""

import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PACKAGE = 'fielddraw_tiles'
SOURCE = os.path.join(ROOT, PACKAGE)
DIST = os.path.join(ROOT, 'dist')

#: Lo que no tiene por qué viajar dentro del complemento.
SKIP_DIRS = {'__pycache__', '.git'}
SKIP_SUFFIXES = ('.pyc', '.pyo', '.orig', '.rej', '~')


def version():
    with open(os.path.join(SOURCE, 'metadata.txt'), encoding='utf-8') as fh:
        match = re.search(r'^version\s*=\s*(.+)$', fh.read(), re.MULTILINE)
    if not match:
        raise SystemExit('metadata.txt no declara version')
    return match.group(1).strip()


def files():
    for folder, dirnames, filenames in os.walk(SOURCE):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for filename in sorted(filenames):
            if filename.endswith(SKIP_SUFFIXES):
                continue
            path = os.path.join(folder, filename)
            yield path, os.path.join(PACKAGE, os.path.relpath(path, SOURCE))


def main():
    os.makedirs(DIST, exist_ok=True)
    target = os.path.join(DIST, '%s-%s.zip' % (PACKAGE, version()))
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        count = 0
        for path, name in files():
            # Fecha fija: el mismo código produce el mismo ZIP.
            info = zipfile.ZipInfo(name.replace(os.sep, '/'), (2024, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(path, 'rb') as fh:
                archive.writestr(info, fh.read())
            count += 1
    print('%s\n%d archivos, %.1f kB' % (target, count, os.path.getsize(target) / 1024))
    return target


if __name__ == '__main__':
    main()
