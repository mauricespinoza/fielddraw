# FieldDraw Tiles — complemento de QGIS

Convierte cualquier capa ráster de QGIS —una ortofoto, una carta geológica
escaneada, un modelo de elevación simbolizado, un hillshade— en **MBTiles** y
**PMTiles** que [FieldDraw](../README.md) abre desde su botón **Importar**.

No necesita `gdal2tiles`, ni `tippecanoe`, ni la utilidad `pmtiles`, ni una
conexión: todo se hace con GDAL y las librerías que QGIS ya trae. En Windows
eso importa, porque es donde instalar herramientas de línea de comandos
geoespaciales se convierte en una tarde perdida.

## Instalar

El ZIP listo para instalar va en el repo:
**[`fielddraw_tiles.zip`](fielddraw_tiles.zip)** (29 kB).

Descárgalo y, en QGIS, **Complementos → Administrar e instalar complementos →
Instalar a partir de ZIP → …**. Aparece un botón nuevo en la barra de
herramientas y la entrada **Ráster → FieldDraw**.

Si tocas el código, se reconstruye con:

```bash
python3 qgis-plugin/tools/package.py
```

El ZIP es reproducible —entradas ordenadas, fecha y permisos fijos—, así que
reconstruirlo sin cambiar nada da un archivo idéntico byte a byte y no ensucia
el historial.

Para desarrollar, sale más a cuenta enlazar la carpeta directamente en el
perfil de QGIS y usar el complemento *Plugin Reloader*:

| Sistema | Carpeta de complementos |
|---|---|
| Linux | `~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/` |
| macOS | `~/Library/Application Support/QGIS/QGIS3/profiles/default/python/plugins/` |
| Windows | `%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\` |

```bash
ln -s "$PWD/qgis-plugin/fielddraw_tiles" ~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/
```

Requiere QGIS 3.16 o posterior.

## Usar

Con una capa ráster seleccionada, el botón de la barra de herramientas (o
**Ráster → FieldDraw → Ráster a teselas para FieldDraw…**) abre el diálogo. Es
un algoritmo de Processing corriente, así que también está en la caja de
herramientas como `fielddraw:rastertofielddrawtiles`, se puede correr en lote
sobre muchos rásteres a la vez y se puede meter dentro de un modelo.

Desde la consola de Python de QGIS:

```python
import processing
processing.run('fielddraw:rastertofielddrawtiles', {
    'INPUT': 'ortofoto.tif',
    'PMTILES': '/ruta/salida.pmtiles',
    'MAX_ZOOM': -1,          # -1 = según la resolución del ráster
    'TILE_FORMAT': 0,        # 0 = automático
})
```

Lo que sale es directo: se copia el `.pmtiles` al iPad (o al teléfono) y se
abre en FieldDraw con **Importar**. Aparece en el panel de capas, sobre los
basemaps y bajo el dibujo, con su orden y su transparencia.

## Qué formato llevar a terreno

**PMTiles.** FieldDraw lo lee por rangos del archivo, así que un mapa de
varios GB funciona sin cargar nada en memoria. El MBTiles es SQLite y sql.js
solo opera en memoria: hay que cargarlo entero, y por encima de 250 MB la app
avisa antes de abrirlo. El complemento repite ese aviso al terminar.

Los dos se pueden pedir a la vez; se cortan en una sola pasada.

## Que salga liviano

El desplegable de **formato de las teselas** es el que más pesa en el
resultado. Estas son medidas reales sobre una ortofoto sintética de 2400×2400
px a 1 m/px, exportada de zoom 9 a 17 (155 teselas):

| Formato | Tamaño | Notas |
|---|---|---|
| **Automático** | **0,63 MB** | JPEG donde es opaco, WebP donde hay alfa |
| WebP | 0,44 MB | el más liviano; Safari 14+, Chrome, Firefox |
| PNG 8 bits | 3,94 MB | sin pérdida de color solo si el ráster es plano |
| PNG 24/32 bits | 9,53 MB | sin pérdida, 15 veces más pesado |

Tesela a tesela la diferencia es todavía más clara:

| Contenido de la tesela | JPEG | WebP | PNG 8 | PNG 32 |
|---|---|---|---|---|
| Ortofoto, opaca | **9,8 kB** | 11,6 kB | 46 kB | 147 kB |
| Ortofoto, mitad transparente | — | **5,2 kB** | 28 kB | 170 kB |
| Color plano (carta clasificada) | 671 B | 248 B | **156 B** | 565 B |

De ahí las reglas del modo automático:

- **Tesela opaca → JPEG.** Es el interior del ráster, que es casi todo.
- **Tesela con transparencia → WebP** (PNG si esta instalación de GDAL no trae
  el controlador WEBP). Son los bordes, y en PNG cuestan treinta veces más.
- **Tesela totalmente transparente → no se guarda.** FieldDraw ya responde con
  un PNG transparente cuando no encuentra una tesela, así que un hueco
  guardado es peso muerto.
- **Tesela opaca en PNG → sin canal alfa.** Un cuarto del archivo, ahorrado.

Si el ráster es de **colores planos** —una carta geológica clasificada, un
mapa de unidades— entonces `PNG 8 bits` gana a todo: cuantiza a 256 colores
con paleta y suele quedar en la mitad o menos, sin cambio visible. Ojo con que
binariza la transparencia: un píxel es opaco o no lo es, sin medias tintas.

Lo otro que engorda el archivo es el rango de zoom. Cada nivel de más
multiplica por cuatro el número de teselas: exportar hasta z19 «por si acaso»
cuando el ráster es de 5 m/px no añade un solo detalle y multiplica el peso
por dieciséis. Por eso el zoom máximo por defecto es **automático**, calculado
desde la resolución real del ráster.

### ¿Se pueden mezclar formatos dentro de un mismo archivo?

Sí, y es a propósito. MapLibre decodifica cada tesela por su contenido —lo
envuelve en un `Blob` y lo pasa a `createImageBitmap()`, que mira los bytes,
no la extensión ni el `Content-Type`—, así que un archivo con teselas JPEG y
WebP mezcladas se pinta igual de bien. El campo `format` de los metadatos solo
lo usa FieldDraw para decidir si el set es raster o vectorial.

Quien prefiera no mezclar tiene los formatos sueltos en el mismo desplegable.

## Las otras opciones

- **Extensión**: por defecto, toda la capa. Acotarla a lo que de verdad se va
  a recorrer es la forma más efectiva de que el archivo entre en la tablet.
- **Usar la simbología de la capa** (activado): renderiza pasando por el
  `QgsRasterPipe`, así que el mapa sale **como se ve en QGIS**: la paleta de
  un DEM, un hillshade, una clasificación por unidades. Desactivarlo exporta
  los valores originales del archivo con `gdal.Warp`, que es lo que quieres
  para una ortofoto RGB. Si el renderizado falla, se cae solo al camino de
  GDAL.
- **Calidad** (75): solo afecta a JPEG y WebP. Por debajo de 60 empiezan a
  verse los bloques en los contactos geológicos.
- **Remuestreo** (avanzado): solo cuando no se usa la simbología de QGIS.
  `average` es lo correcto para una ortofoto; `nearest` para un ráster de
  categorías, donde promediar inventa clases que no existen.
- **Nombre** y **atribución** (avanzado): el nombre es el que FieldDraw pone
  en el panel de capas.

## Cómo funciona por dentro

```
capa ráster (cualquier CRS)
      │  render.py — una sola reproyección a EPSG:3857, con la extensión
      │              alineada a la grilla de teselas del zoom máximo
      ▼
GeoTIFF intermedio RGBA, con bloques de 256×256
      │  pyramid.py — recorrido en profundidad del cuadrante
      ▼
teselas 256×256 ──► encoder.py ──► mbtiles.py / pmtiles.py
```

Las tres decisiones que sostienen todo lo demás:

1. **Se reproyecta una vez, alineado a la grilla.** La extensión del GeoTIFF
   intermedio coincide exactamente con los bordes de las teselas del zoom
   máximo, y sus bloques miden 256×256. Así cada tesela es un recorte entero
   —leer una tesela es leer un bloque— y no hay ni interpolación de más ni
   bordes movidos medio píxel. Reproyectar por tesela, que es lo fácil, deja
   costuras visibles entre teselas vecinas.

2. **Los niveles de arriba se arman promediando los cuatro hijos**, no
   volviendo a leer el ráster. El promedio va sobre el color premultiplicado
   por el alfa: si no, los píxeles transparentes —que suelen ser negros—
   tiñen de oscuro el borde del mapa al alejarse.

3. **El recorrido es en profundidad.** Cada tesela se codifica y se entrega en
   cuanto está lista, y en memoria nunca hay más de cuatro teselas por nivel:
   unos pocos MB, da igual si el ráster es de 200 MB o de 20 GB. Lo que sí
   crece con el ráster es el GeoTIFF intermedio, que se escribe junto al
   archivo de salida y se borra al terminar.

El detalle que más quebraderos da está en `mbtiles.py`: **MBTiles indexa las
filas en TMS** (la fila 0 es la del sur), al revés que el esquema XYZ que pide
MapLibre. PMTiles, en cambio, ordena sus teselas por una curva de Hilbert
sobre el mismo esquema XYZ, para que las teselas vecinas en el mapa queden
juntas en el archivo y una petición de rango traiga varias de una vez.

## Pruebas

```bash
python3 qgis-plugin/tests/run.py
node qgis-plugin/tests/test_pmtiles_js.mjs
```

Más de 4.500 comprobaciones sin dependencias: la grilla Web Mercator y el
volteo TMS, los ids de Hilbert y su inversa, el formato binario de PMTiles
—varints, deltas, cabecera byte a byte, directorios hoja, deduplicación—, el
esquema y los metadatos del MBTiles consultados **con el mismo SQL que usa la
app**, el promediado de la pirámide y el recorrido del árbol con sus huecos y
su cancelación.

`test_plugin_load.py` carga el complemento con QGIS simulado, en un
subproceso. Lo que prueba es acotado y conviene decirlo: no que el algoritmo
haga lo correcto, sino que *carga* —`classFactory`, `initGui`, el registro del
proveedor y la declaración de parámetros—, que son los fallos que en QGIS
aparecen como un diálogo rojo al arrancar y los únicos que se pueden cazar sin
QGIS delante.

`test_export.py` hace la exportación completa de un GeoTIFF en UTM 19S a los
dos contenedores y comprueba, entre otras cosas, que la tesela que dice cubrir
un cuadro rojo contenga rojo. Necesita GDAL y numpy, o sea QGIS; en un
intérprete pelado se salta sola.

`test_pmtiles_js.mjs` es la prueba que de verdad importa: abre un PMTiles
recién escrito con **`vendor/pmtiles.js`, la misma librería que carga
FieldDraw**, y verifica la cabecera, los metadatos y las teselas de cinco
niveles una por una. Que el archivo pase el lector de `core/pmtiles.py` solo
demuestra que sé leer lo que escribí; que lo abra esa librería demuestra que
lo abrirá el iPad en terreno.

Y `test_compat.py` vigila el contrato con la app: si mañana FieldDraw cambia
el tamaño de tesela, el umbral de aviso del MBTiles, el volteo de fila o las
extensiones que acepta al importar, las pruebas fallan antes de que alguien se
lleve al terreno un mapa que la app no sabe abrir.

## Si algo sale mal

- **«No module named osgeo»** al correr las pruebas fuera de QGIS: es
  esperado; esas pruebas se saltan solas. Dentro de QGIS están todas.
- **«GDAL no trae el controlador WEBP»**: elige *Automático*, PNG o JPEG. El
  modo automático detecta la ausencia y usa PNG para los bordes.
- **Se queda sin memoria o sin disco**: baja un nivel el zoom máximo. El
  GeoTIFF intermedio se divide por cuatro. Se escribe junto al archivo de
  salida, así que elegir un destino con sitio ayuda.
- **El mapa sale en blanco y negro o con colores raros**: la capa se está
  exportando sin simbología. Activa *Usar la simbología de la capa*.
- **El MBTiles pesa más que el PMTiles** con las mismas teselas: es normal,
  son las páginas y el índice de SQLite. Otra razón para llevar el PMTiles.
