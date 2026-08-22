# FieldDraw — mapeo geológico en tablet

Basemaps web, curvas de nivel generadas en el cliente, panel de capas con orden
y transparencia, y digitalización con Apple Pencil (vértice a vértice + trazo
libre por long-press). Sobre eso: perfiles topográficos leídos del DEM, relieve
3D como modo de visualización, y medidas de rumbo y manteo —manuales, por tres
puntos o ajustadas a una traza— con su incertidumbre declarada.

## Ejecutar

```bash
node serve.mjs 5174
```

Imprime la IP de la red local. Sirve para desarrollar y para probar en el iPad
estando en la misma red. Para usarla de verdad en terreno —desde cualquier
dispositivo y sin señal— hay que publicarla en un hosting con HTTPS: ver
**Publicar y usar sin señal**.

No hay bundler ni `node_modules`: el proyecto usa ESM nativo con un import map.
Es deliberado — `G:\Mi unidad` es Google Drive y npm falla ahí con `EPERM`
porque el sincronizador bloquea archivos.

Las dependencias ya no vienen de un CDN: viven en `vendor/`, versionadas junto
al código. Ver **Publicar y usar sin señal**.

## Pruebas

```bash
for f in logic draw gpkg snapping edit vertex topology project ornaments strabo reshape dem structure shortcuts scale hole; do node test/$f.test.mjs; done
```

882 comprobaciones sin dependencias: simplificación, simbología, estilo, store,
comportamiento del lápiz y de los dedos (con un DOM simulado),
WKB/GeoPackageBinary, parsers de color y de filtros de QGIS, índice de snapping,
camino más corto del trace, punto-en-polígono, selección, flujo de la línea de
corte, edición de vértices (mover, insertar, borrar, buscar el punto de
inserción y agrupar coincidentes), confirmación topológica, serialización de
proyectos, parámetros de los ornamentos, historial de deshacer/rehacer,
encadenado de líneas sueltas, extensión de líneas, el módulo de unidades y el
aplanado, la simbología, los filtros y el tamaño de símbolo de StraboSpot,
decodificación de teselas terrarium, muestreo y estadística de perfiles,
parseo de ASCII grid e interpolación bilineal, ajuste de plano por mínimos
cuadrados, propagación de la incertidumbre del manteo, los avisos de calidad,
la tabla de atajos de teclado y el hover del ratón, conversión escala↔zoom en
ambos sentidos, lectura y escritura de escalas, resta de áreas con JSTS
—incluido el hueco que se convierte en anillo interior— y las regresiones de
los tres cuelgues: el gesto que termina fuera del mapa, el toque cuyo
`pointerup` se pierde y la tesela del DEM que no contesta nunca.

Lo que necesita navegador —`DOMParser` para el QML, el wasm de sql.js y JSTS—
vive en `test/browser.html`: ábrela con el servidor corriendo en
`http://localhost:5174/test/browser.html`. Cubre el round-trip completo
exportar→importar, QML real de QGIS, un MBTiles fabricado al vuelo, las
operaciones de corte y unión, y la validación de todas las capas generadas
contra el style-spec de MapLibre —incluidos los símbolos de rumbo y manteo y
sus dieciséis imágenes.

El complemento de QGIS lleva su propia batería, en Python:

```bash
python3 qgis-plugin/tests/run.py
node qgis-plugin/tests/test_pmtiles_js.mjs
```

Más de 4.400 comprobaciones sobre la grilla Web Mercator, el volteo TMS, el
formato binario de PMTiles y el esquema del MBTiles —consultado con el mismo
SQL que usa `src/tiles.js`—. La de Node abre un PMTiles recién escrito con
**`vendor/pmtiles.js`, la misma librería que carga la app**, que es la única
forma de saber que el archivo se abrirá en terreno.

## Publicar y usar sin señal

La app es estática: son archivos, sin backend ni build. Se puede servir desde
cualquier hosting estático (GitHub Pages, Netlify, Cloudflare Pages) y todas las
rutas son relativas, así que funciona igual en la raíz de un dominio que en un
subdirectorio tipo `usuario.github.io/fielddraw/`.

**El modo offline exige HTTPS.** Un service worker solo se registra en un
contexto seguro —HTTPS o `localhost`—, así que servida por IP en la red local
(`http://192.168.x.x:5174`) la app funciona pero *sin* offline: el navegador no
deja instalarlo sobre http. No es un fallo de la app; es la plataforma. Publicada
en un hosting con HTTPS, el offline se activa solo.

### Dependencias en `vendor/`

Todo lo externo está copiado al repo: MapLibre, maplibre-contour, PMTiles,
proj4, JSTS, sql.js (con su `.wasm`) y los glyphs de las etiquetas de curvas.
Son ~2,5 MB.

Se usan los builds **UMD**, no los ESM del CDN, y el motivo importa: un bundle de
esm.sh o de jsdelivr no es un archivo único, sino un módulo que a su vez importa
rutas del propio CDN. Copiarlo deja imports colgando contra un origen que en
terreno no existe. El UMD sí es autocontenido y el service worker puede
precachearlo entero. `index.html` carga los dos que hacen falta al arranque como
scripts clásicos —que corren antes que los `type="module"`, diferidos— y el
import map apunta a los puentes de `vendor/esm/`, que solo reexportan el global.
Las pesadas (JSTS, sql.js, PMTiles) se siguen pidiendo bajo demanda, ahora desde
`vendor/`.

### Qué funciona sin señal y qué no

| | Sin señal |
|---|---|
| Abrir la app, dibujar, editar, topología | ✅ |
| Proyectos, GeoPackage, GeoJSON | ✅ (todo es local) |
| Cortar y unir (JSTS), importar GPKG (sql.js) | ✅ |
| Mapas offline PMTiles/MBTiles importados | ✅ |
| Basemaps (Esri, OSM, OpenTopoMap) | ⚠️ solo lo ya visitado |
| Curvas de nivel (DEM de AWS) | ⚠️ solo lo ya visitado |
| Perfiles y rumbo/manteo sobre el DEM de AWS | ⚠️ solo lo ya visitado |
| Perfiles vía OpenTopography (Copernicus) | ❌ necesita red y clave |
| Relieve 3D y sombreado | ⚠️ solo lo ya visitado; fuera de eso se ve plano |

Un service worker no puede precachear un basemap mundial: son teselas
ilimitadas. Lo que hace es guardar en una caché aparte —con tope de 6000
teselas— todo lo que se haya mirado, así que la zona que revisaste antes de
salir sigue ahí.

Esa caché se sirve **primero**, antes que la red, y se refresca por detrás. Una
tesela z/x/y no cambia nunca, así que preguntarle a la red no aportaba nada y sí
costaba: con media barra de señal el `fetch` no falla, se queda esperando, y
mientras tanto no se pinta lo que ya estaba descargado. Ver
[Por qué la app se quedaba colgada](#por-qué-la-app-se-quedaba-colgada). **Para cobertura garantizada en terreno, la respuesta es
importar un PMTiles de la zona**, que es justo para lo que está esa función.

### Instalar en la tablet

Con la app publicada en HTTPS: abrirla en Safari y usar **Compartir → Añadir a
pantalla de inicio**. A partir de ahí abre a pantalla completa y arranca desde la
caché, con o sin red. El `manifest.webmanifest` le da nombre, icono y color; los
iconos se regeneran con `node tools/make-icons.mjs`.

Al publicar una versión nueva hay que subir `VERSION` en `sw.js`: es lo que
invalida la caché vieja y hace que las tablets se actualicen en la siguiente
carga.

## Modelo de interacción

| Acción | Gesto |
|---|---|
| Añadir vértice | toque |
| Trazo libre | mantener presionado ~0,3 s y arrastrar |
| Cerrar elemento | doble toque · toque con el dedo fuera del trazo · doble clic · clic derecho · Enter · botón **Listo** |
| Deshacer vértice | Retroceso, o botón **Deshacer** |
| Cancelar elemento | Esc, o botón **Descartar** |
| Navegar | dos dedos (siempre), o herramienta **Navegar** |
| Seleccionar | un toque con el dedo, **en cualquier herramienta** |
| Seleccionar varios | **Elegir** + arrastrar: lazo rectangular, entra lo que quede encerrado |
| Propiedades | mantener pulsado ~1 s, en cualquier herramienta |
| Cerrar la edición | tocar con el dedo fuera del trazo; también cierra paneles y menús |
| Deshacer | doble toque con **dos dedos** |
| Rehacer | doble toque con **tres dedos** |
| Continuar una línea | seleccionarla y pulsar `L` o **Línea**; o **Continue line** en el menú de propiedades |
| Mover un vértice | herramienta **Nodos**, modo *Mover*, y arrastrar la manija |
| Insertar un vértice | **Nodos** → *Añadir*, y tocar el borde; o arrastrar un punto medio |
| Borrar un vértice | **Nodos** → *Borrar*, y tocar la manija; o doble toque en modo *Mover* |
| Cortar | seleccionar, luego **Cortar**: dibujar la línea, o tocar otro elemento |
| Unir | seleccionar dos o más y pulsar **Unir** |
| Compartir vértices | **Topología** (sobre la selección, o sobre todo el dibujo) |
| Redibujar un contorno | seleccionar, luego **Reshape**: trazar una línea que entre y salga |
| Quitar un área interior | **Hole**: dibujar el contorno de lo que sobra dentro del polígono |
| Perfil topográfico | **Perfil** y trazar la línea; o seleccionar una línea y usar el menú de propiedades |
| Rumbo y manteo | **Dip**: un toque (brújula), tres toques (tres puntos) o trazar a lo largo del afloramiento |
| Relieve 3D | botón **3D**; con él puesto no se digitaliza |
| Fijar la escala | píldora `1:…` abajo a la izquierda, o `K` |
| Ir a mi posición | botón **Locate** |

Los gestos multitáctiles usan umbrales de tiempo holgados a propósito. Con el
mapa renderizando, el hilo principal se satura y el `pointerup` puede llegar
cientos de milisegundos después del `pointerdown` aunque el dedo apenas haya
tocado: medido, un toque instantáneo reportó 690 ms. Un umbral de 400 ms
descartaba toques perfectamente válidos.

Cuando el Pencil está dibujando, el dedo no añade vértices pero sí cierra el
elemento: un toque limpio a más de 36 px del trazo lo da por terminado, y un
doble toque lo cierra esté donde esté. Arrastrar o hacer pinch nunca cierra
nada, para no perder un trazo al reencuadrar el mapa.

Sin nada en construcción, ese mismo toque **selecciona** el elemento que haya
debajo, sea cual sea la herramienta activa: mientras el lápiz dibuja, el dedo es
lo que se tiene libre para señalar. Y mantenerlo pulsado ~1 s abre el menú de
propiedades, también en cualquier herramienta, incluida **Navegar**.

Dos detalles del reconocimiento de gestos que cuestan de encontrar y que
explican fallos que parecen aleatorios:

- El gesto multitáctil cuenta **dedos, no punteros**. El Pencil apoyado es un
  puntero más, así que contarlo hacía que cualquier toque del dedo con el lápiz
  en la pantalla se descartara por parecer un gesto a dos manos: el dedo no
  seleccionaba, no cerraba y no abría el menú, justo en la situación en la que
  más se usa.
- En **Elegir** y **Nodos** el dedo sí se consume, aunque haya Pencil: sin eso
  no hay forma de arrastrar el lazo ni de agarrar una manija con el dedo. El
  precio es que en esas dos herramientas el paneo con un dedo no está
  disponible; se navega con dos, como en el resto de la app.

## Escala de trabajo

Un mapa web se navega por **nivel de zoom**, que no significa nada
cartográficamente: z14 no es una escala, es una potencia de dos. Al levantar
geología eso no sirve. Cuánto detalle tiene sentido meter en un contacto, qué se
generaliza y qué no, depende de la escala de trabajo; y una memoria o una carta
se entrega **a** una escala. Un mapa levantado deslizando el zoom libremente sale
con el detalle repartido a capricho: un tramo digitalizado a 1:5.000 junto a otro
a 1:60.000, y ninguno de los dos es el mapa que se declaró.

La píldora de abajo a la izquierda —justo bajo la barra gráfica de MapLibre—
muestra la escala vigente y abre la lista (`K`):

- **Tocar una escala** lleva el mapa a ella.
- **El candado** la fija: el mapa se desplaza pero no hace zoom. Se apagan los
  gestos cuyo único efecto es el zoom —rueda, pellizco y caja—; el teclado se
  deja en paz, porque en MapLibre las flechas y el `+`/`-` son el mismo
  manejador y apagarlo costaría el paneo por teclado a cambio de nada. Lo que no
  pasa por los gestos —los botones de la brújula, el `+`/`-`, cualquier zoom por
  programa— se corrige al terminar el movimiento. Mientras dura, el giro a dos
  dedos queda apagado junto con el pellizco: MapLibre los sirve el mismo
  manejador y no admite apagar solo el zoom.
- **La escala se mantiene al desplazarse**, no solo el zoom. El denominador
  depende del coseno de la latitud, así que un paneo norte-sur la corre sola: en
  Ñuble-Biobío, un grado son cerca de un 1,5 %. Fijada, el zoom se reajusta para
  compensarlo. Por debajo de medio por ciento no se toca nada: corregir ahí sería
  un temblor, no una corrección.
- **Fijar sin elegir** toma la escala que se está viendo y la redondea a una de
  mapeo. Fijar un 1:37.412 sería fijar el accidente de dónde quedó el zoom. El
  redondeo se hace en logaritmo y no en resta, porque una escala es una razón:
  1:37.400 está a un factor 1,50 de 1:25.000 y a 1:1,34 de 1:50.000, así que la
  que se le parece es la segunda aunque restando salga la primera.

La lista de fábrica es 1:1.000, 2.500, 5.000, 10.000, 25.000, 50.000, 100.000 y
250.000 —las de las series topográficas y de las cartas del Sernageomin—, y es
**editable**: se añaden escalas escritas a mano (`1:12 500`, `12500` o `25k`, todo
vale) y se quitan con la ✕ de cada una. Viaja en el proyecto, junto con el
candado.

### El píxel, que es la parte incómoda

Una escala relaciona una distancia del terreno con una distancia **física** sobre
el mapa. En papel eso está definido; en una pantalla no, porque el navegador no
expone el tamaño real de sus píxeles. Un mismo "1:25.000" en un monitor y en un
iPad no mide lo mismo con una regla encima.

La convención —de la OGC, y lo que usan QGIS, OpenLayers y ArcGIS— es suponer un
píxel de **0,28 mm** (~90,7 ppp). No es el píxel de ninguna pantalla concreta,
pero es el mismo supuesto que hace el resto del gremio: un 1:25.000 de FieldDraw
es el mismo 1:25.000 que vería QGIS, y eso es lo que hace que la cifra sirva para
comunicarse. Quien además quiera que cuadre con una regla sobre **su** pantalla
tiene el valor configurable en la misma lista.

La escala se **mide sobre el propio mapa** —dos puntos separados cien píxeles y
cuánto terreno hay entre ellos— en vez de despejarla del nivel de zoom. Así no
depende de la convención interna de MapLibre (teselas de 512 px, no de 256; usar
la equivocada da un factor 2 de error) y sigue siendo correcta con la cámara
inclinada, donde la escala ya no es la misma en toda la pantalla y la del centro
es la única que se puede declarar.

## Desde un PC

La app nació para tablet, y ese diseño desde un escritorio se vuelve lento:
cambiar de herramienta obliga a ir hasta la barra y volver, cientos de veces por
sesión. Sin renunciar a nada del modelo táctil, con teclado y ratón:

- **Atajos de teclado** para todo lo que se usa seguido. La tabla vive en
  `src/shortcuts.js` y es la **única** fuente de verdad: de ella salen el
  despachador, la ayuda que abre `?` y los tooltips de la barra. Así no puede
  pasar que la ayuda anuncie una tecla que ya no hace nada, que es como estas
  listas se pudren.
- **Clic fuera y clic secundario cierran** cualquier panel. En tablet eso ya lo
  resolvía cualquier toque en el mapa; desde un PC se pulsa un botón de la barra
  superior o el borde de la ventana y el panel se quedaba abierto tapando el
  mapa.
- **El ratón previsualiza el enganche.** Antes solo lo hacía el Pencil, que
  flota sobre la pantalla y reporta posición sin tocar. Con ratón no había
  ninguna previsualización: el snapping era un salto a ciegas que solo se veía
  después de hacer clic. El anillo de hover sigue siendo solo del lápiz — con
  ratón el propio cursor ya dice dónde está.
- **En Navegar, un clic selecciona.** El camino táctil (`onFingerTap`) solo
  existe para punteros `touch` no consumidos, así que con ratón nunca se
  disparaba y había que entrar a **Elegir** para señalar cualquier cosa.
  **Shift+clic** añade a la selección.
- Cursor de mano sobre lo que responde al clic, y resalte al pasar por encima de
  botones y chips (solo con `hover: hover`, para no dejar estados pegados en
  táctil).

Las teclas se ignoran mientras se escribe en un campo: sin eso, teclear "Lava"
en el nombre de una unidad cambiaría a la herramienta Línea a mitad de palabra. La
única excepción es `Esc`, que primero suelta el foco del campo y en la segunda
pulsación cierra el panel — sin ella, con el cursor dentro de la clave de
OpenTopography no había forma de cerrar Ajustes con el teclado.
Y solo se le roban al navegador las combinaciones que él también usa
(`Ctrl+S`, `Ctrl+Z`, `Ctrl+A`…); quitarle `Ctrl+P` sin necesitarlo sería una
grosería.

| Tecla | Acción |
|---|---|
| `H` | Navegar |
| `V` | Elegir |
| `L` | Línea — con una línea seleccionada, la **continúa** |
| `P` | Polígono |
| `O` | Hole — restar un área a un polígono |
| `N` | Nodos (vértices) |
| `X` | Cortar |
| `R` | Reshape |
| `D` | Rumbo y manteo |
| `F` | Perfil topográfico |
| `S` · `T` | Snap · Trace |
| `C` | Rotar la certeza: observado → inferido → cubierto |
| `3` | Relieve 3D |
| `G` | Centrar en mi posición |
| `M` · `Y` | Unir · Topología |
| `↵` · `⌫` | Cerrar el elemento · deshacer el último vértice |
| `Esc` | En cascada: cierra panel → descarta el elemento → vacía la selección → vuelve a Navegar |
| `Del` | Borrar lo seleccionado |
| `Ctrl+Z` · `Ctrl+Shift+Z` | Deshacer · rehacer |
| `Ctrl+A` | Seleccionar todo |
| `Shift+L` · `Shift+U` · `Shift+Y` · `Shift+B` | Capas · Unidades · Símbolos · StraboSpot |
| `K` | Escala de trabajo (elegir y fijar) |
| `Ctrl+,` | Ajustes |
| `Ctrl+S` · `Ctrl+O` · `Ctrl+E` | Guardar proyecto · abrir · exportar GeoPackage |
| `?` · `F1` | Esta lista |

`Esc` va en cascada de lo más superficial a lo más profundo a propósito:
pulsarlo varias veces desanda el estado sin sorpresas. Un solo `Esc` no debería
descartar un trazo de veinte vértices solo porque había un panel abierto.

En macOS el modificador es ⌘ y se normaliza al mismo combo, así que no hay dos
tablas que mantener. Los símbolos ignoran `Shift` deliberadamente: en un teclado
español `?` ya se escribe con `Shift`, y registrarlo como `Shift+?` lo haría
inalcanzable en un teclado inglés.

## Continuar una línea

Seleccionar una línea y activar **Línea** no empieza otra: **continúa esa**, por
el extremo más cercano al primer clic, heredando su tipo, certeza y demás
atributos. Al cerrar vuelve como un solo elemento, no como dos trozos pegados.

Tres formas de llegar:

1. Seleccionar la línea (clic en **Navegar**, o con **Elegir**) y pulsar `L`.
2. Seleccionar la línea y pulsar el botón **Línea** de la barra.
3. Mantener pulsado sobre la línea → **Continue line** en el menú de
   propiedades.

Mientras está armada, la barra de estado lo dice y **los dos extremos de la
línea aparecen marcados** en el mapa: el clic siguiente decide por cuál se
sigue, así que apuntando a uno u otro se elige el sentido.

Esto funcionaba desde el principio pero era invisible, y además fallaba en el
caso más frecuente: **si ya se estaba en la herramienta Línea**, seleccionar
otra línea no la marcaba —había que volver a pulsar el botón— y el clic
siguiente empezaba una línea nueva. Cartografiando no se sale de Línea para
nada, así que ese era justo el camino que uno recorre. Ahora la marca se rearma
con cada cambio de selección, salvo si hay un trazo a medias: ahí la selección
no debe secuestrar lo que se está dibujando.

Se desarma sola al vaciar la selección, al seleccionar dos elementos (es
ambiguo por cuál seguir), con un polígono (no tiene extremos) y al borrar la
línea marcada.

## Snapping y trace

- **Snap** engancha a vértices y segmentos de todo lo visible: tu propio dibujo
  y las capas importadas. El vértice tiene prioridad sobre el segmento, como en
  QGIS. El marcador magenta muestra a qué se va a enganchar; es cuadrado sobre
  un vértice y una cruz sobre un segmento. El radio es configurable (4–32 px).
- **Trace** hace que el nuevo elemento siga el borde de uno existente: tocas un
  punto sobre otra geometría y el trazo recorre el camino más corto por su
  contorno hasta el toque anterior, en vez de saltar en línea recta. Por debajo
  es un Dijkstra sobre el grafo de segmentos visibles, con nodos temporales
  insertados donde el snap cae en medio de un segmento — el mismo enfoque que
  usa QGIS. Con el Pencil en hover se previsualiza el camino antes de tocar.
- Dos features quedan conectadas en el grafo cuando **comparten un vértice**.
  Los cruces sin vértice común no se nodan solos, así que para trazar a través
  de una intersección hay que materializarla antes con **Topología**.
- Los extremos de un trazo a mano alzada también se enganchan: es donde importa
  que el contacto cierre exacto contra la geometría vecina.
- El **radio del trace** es propio y se ajusta en Ajustes (6–60 px, 22 por
  omisión). Va aparte del radio de enganche porque son cosas distintas: clavar
  un vértice sobre otro pide precisión, agarrar el borde que se va a seguir pide
  holgura. Si el trace "no engancha", este es el número que hay que subir.

Dos fallos del trace que estaban y ya no:

- **El ancla caducaba.** El punto desde el que se traza se guardaba como
  resultado de snap, que incluye el *índice* del segmento enganchado. Ese índice
  se invalida cada vez que se reconstruye el índice espacial —o sea, en cada
  vértice nuevo y en cada paneo— y pasaba a apuntar a un segmento cualquiera:
  de ahí que el trace funcionara al empezar un polígono y luego trazara desde el
  extremo contrario o dejara de funcionar. Ahora el ancla se guarda en lng/lat y
  se vuelve a enganchar contra el índice vigente, que no caduca.
- **El propio borrador era transitable.** El elemento en construcción está en el
  índice de snapping para poder cerrarlo sobre su primer vértice, pero entraba
  también al grafo, así que el camino más corto podía devolverse por el trazo ya
  dibujado en vez de seguir el borde. Ahora sus segmentos se marcan y el grafo
  los ignora.

## Perfiles topográficos

Con **Perfil** se traza una línea —a toques o a mano alzada, con el mismo gesto
que cualquier otra— y la app lee la cota del DEM a lo largo de ella. También se
puede perfilar una línea **ya dibujada**: seleccionarla, mantener pulsado y
usar *Topographic profile* en el menú de propiedades. Ese es el caso frecuente,
porque el corte que interesa suele ser justo un contacto o una falla que ya se
cartografió, y volver a trazarlo a mano introduciría un error propio.

El gráfico se dibuja en una hoja inferior que **no** se cierra al tocar el mapa,
a diferencia del resto de los paneles: se mira la curva mientras se navega. Al
arrastrar sobre él, la muestra señalada se marca también en el mapa, que es lo
que permite ver qué quiebre del perfil cae sobre qué contacto. **CSV** descarga
distancia, coordenadas y cota de cada muestra.

### De dónde salen las cotas

| Fuente | Resolución | CORS | Sin señal |
|---|---|---|---|
| AWS Terrain Tiles (terrarium) | ~30 m | `Allow-Origin: *` | ✅ sobre lo ya cacheado |
| Copernicus vía OpenTopography | 30 / 90 m | `Allow-Origin: *` | ❌ |
| Copernicus 30 en S3 (`copernicus-dem-30m`) | 30 m | ❌ preflight 403 | — |

La opción por omisión es la primera y no es pereza: son las **mismas** teselas
que ya alimentan las curvas de nivel, así que el service worker las tiene
cacheadas y un perfil sobre una zona que se miró antes de salir se calcula sin
red. Además responden `Access-Control-Allow-Origin: *`, sin lo cual el canvas
quedaría contaminado y `getImageData` no podría leer las alturas.

El bucket de Copernicus en S3 se descartó tras comprobarlo: admite lecturas por
rango —contesta 206— pero no manda cabeceras CORS y su preflight responde 403,
así que el navegador no puede leerlo sin un proxy propio. Un proxy convertiría
FieldDraw en una app con backend, que es lo contrario de lo que la hace
publicable en cualquier hosting estático y usable en terreno. La vía limpia es
**OpenTopography**, que sí manda CORS; el precio es una clave gratuita y
depender de la red. Se pide en formato `AAIGrid` —el ASCII grid de ESRI— y no
GeoTIFF a propósito: es texto plano y evita meter una librería de GeoTIFF de
varios cientos de KB en `vendor/` para leer un recorte que cabe en memoria.

La clave se guarda en `localStorage` y **no** viaja dentro del `.fdproj.json`:
un proyecto se manda por correo o se sube a un repositorio como cualquier otro
archivo del trabajo, y una credencial personal no tiene por qué ir ahí.

### Lo que el perfil no puede decir

La nota bajo el gráfico declara siempre la fuente, su resolución nominal y el
paso de muestreo, porque un perfil sin eso invita a leer detalle que el dato no
tiene: sobre un DEM de 30 m, un escalón de 40 m de ancho no existe. Subir el
número de muestras suaviza la curva, no añade información.

Los desniveles acumulados ignoran los saltos por debajo del error vertical del
modelo (5 m). Sin ese filtro, un perfil sobre terreno llano acumularía cientos
de metros de "subida" que solo son ruido. Y el eje vertical tiene un span mínimo
de 20 m por el mismo motivo: estirar 3 m de ruido hasta llenar el gráfico lo
haría parecer relieve.

Un tramo sin dato **corta** la curva en vez de saltarlo con una recta: unir los
dos extremos de un hueco dibujaría una ladera que nadie midió.

## Vista 3D

El botón **3D** enciende terreno real —`setTerrain` sobre el mismo DEM— y el
dibujo se drapea solo sobre el relieve. La exageración vertical se ajusta en el
panel de Capas, donde también está el **sombreado** (hillshade), apagado por
omisión.

Es un modo de **visualización**, y por eso con él puesto las herramientas de
dibujo quedan deshabilitadas. No es una limitación técnica: sobre terreno
inclinado, el punto que se toca y el punto del terreno dejan de coincidir como
en planta, así que digitalizar en 3D produce geometría desplazada sin que se
note al momento. Activarlo devuelve a **Navegar** y descarta lo que hubiera a
medias; apagarlo devuelve el dibujo.

Al encenderlo se **comprueba que quedó puesto**. `setTerrain` no siempre lanza
cuando no puede: en un contexto WebGL sin las extensiones que necesita vuelve sin
terreno y sin excepción, y entonces el botón quedaba encendido sobre un mapa
plano y con el dibujo bloqueado —el peor de los dos mundos, y sin nada que lo
explicara. Ahora se consulta `getTerrain()` después de ponerlo y, si no está, se
revierte con el motivo.

Dos advertencias honestas: el terreno sube bastante el coste de render, así que
conviene probarlo en la tablet real antes de darlo por bueno; y necesita las
teselas DEM, de modo que fuera de lo ya cacheado el relieve se ve plano.

*Street View no está y no va a estar*: la API de Google es de pago y sus
términos prohíben este uso, y las alternativas libres (Mapillary, KartaView)
tienen cobertura prácticamente nula en la cordillera de Ñuble y Biobío, además
de exigir red — o sea, no funcionarían justo en terreno.

## Rumbo y manteo

**Dip** es la primera herramienta que produce geometría de **punto**: hasta
aquí el modelo eran líneas y polígonos. Tres métodos, que se eligen en la
paleta:

| Método | Gesto | De dónde sale el número |
|---|---|---|
| **Manual** | un toque | de tu brújula; los valores se escriben en la paleta y se corrigen en el menú de propiedades |
| **Tres puntos** | tres toques sobre la misma superficie | el problema clásico: tres cotas del DEM definen un plano exacto |
| **Ajuste a traza** | dibujar (o trazar a mano alzada) a lo largo del afloramiento | mínimos cuadrados sobre todos los nodos, muestreados en el DEM |

Se usa la **regla de la mano derecha**: el manteo cae 90° en sentido horario
desde el rumbo. Es la misma convención con la que ya se rotan por `Strike` los
símbolos importados de StraboSpot, así que un afloramiento propio y uno ajeno
se leen igual, aquí y en QGIS.

El símbolo cambia solo según el manteo: por debajo de 3°, el de **horizontal**
—círculo con cruz, sin tic— porque un manteo tan bajo medido sobre un DEM de
30 m no puede afirmar una dirección; por encima de 87°, el de **vertical**, con
tic a los dos lados. La estratificación admite además **invertida**, que le pone
un gancho al tic.

### La parte que importa: cuánto vale el número

La matemática es trivial. Lo que no lo es —y es la razón de que `structure.js`
sea más largo de lo que parece necesario— es decir cuánta confianza merece el
resultado.

Sobre un DEM de 30 m con varios metros de error vertical, un manteo medido en
una base de 100 m puede equivocarse en varios grados; en una base de 30 m, en
decenas. Entregar "32°" sin más sería falsa precisión. Por eso cada medida
calculada sobre el modelo viaja con:

- **±rumbo y ±manteo**, propagados por Monte Carlo desde el error vertical del
  DEM. Se hace por simulación y no por derivadas porque el manteo es
  `atan(|∇z|)`, que deja de ser lineal cerca de la horizontal — justo donde el
  problema es peor, en las capas de bajo ángulo. El generador es determinista:
  la misma entrada da siempre el mismo margen, o el número dejaría de ser
  comprobable.
- **La base**: su longitud y, sobre todo, su anchura transversal. Si los puntos
  quedan casi alineados, el plano puede pivotar sobre esa recta y el manteo no
  está determinado, por muy limpio que salga el ajuste.
- **El RMS** de los residuos, que delata cuándo los puntos sencillamente no
  están sobre un mismo plano: superficie plegada, fallada, o la traza se salió
  del contacto.

Y avisa, en texto y no en un número escondido, cuando la base es más corta que
dos celdas del DEM, cuando los puntos están casi alineados, cuando la
incertidumbre pasa de 10°, o cuando el manteo es menor que su propio error —o
sea, cuando no se puede distinguir de horizontal. Con puntos **exactamente**
alineados no se entrega ninguna medida: se explica por qué.

Corregir a mano el rumbo o el manteo de una medida calculada la marca como
*editada* y **retira** las barras de error: eran del ajuste, y mantenerlas
afirmaría una precisión que el número escrito a mano ya no tiene.

### Exportación

Las medidas salen en una tercera tabla del GeoPackage, `geol_points`, con los
campos de calidad al lado del dato (`strike_sd`, `dip_sd`, `rms_m`, `n_points`,
`base_m`, `spread_m`, `dem_source`) — no solo en pantalla: un manteo sacado de
un DEM sin su incertidumbre termina citado como si fuera de brújula, y en QGIS
ya no queda forma de saber cuál era cuál. El QML que se escribe en
`layer_styles` arma el símbolo con dos marcadores de línea y una rotación por
dato aplicada al **símbolo** entero —no a cada capa, que giraría cada trazo
sobre su propio centro y dejaría el tic apuntando a cualquier lado.

También se suben a StraboSpot como spots de punto, con `Type`, `Strike` y `Dip`
en los nombres que espera el plugin de QGIS, más los campos de calidad.

> El round-trip exportar→importar de `geol_points` está cubierto por
> `test/browser.html`, pero el QML no se ha abierto en una instalación real de
> QGIS: conviene comprobar ahí la rotación por dato la primera vez que se
> exporte.

## GeoPackage

**Exportar** produce un `.gpkg` válido (SQLite con `application_id` GPKG,
geometrías en GeoPackageBinary + WKB, EPSG:4326) con tres tablas —`geol_lines`,
`geol_polygons` y `geol_points` (las medidas de rumbo y manteo)— y —lo
importante— una tabla `layer_styles` con el QML y el SLD
generados a partir de la simbología. Al abrirlo en QGIS el mapa aparece ya
simbolizado, con una regla por combinación tipo × certeza presente en los datos.

**Importar** lee cualquier GeoPackage: geometrías (incluidas Multi\*, 3D y
big-endian), atributos y el estilo QGIS de cada tabla. Del QML se interpretan
los renderers `singleSymbol`, `categorizedSymbol`, `graduatedSymbol` y
`RuleRenderer`, tanto en formato `<Option>` (QGIS 3.x) como en el antiguo
`<prop k= v=>`, incluida la cola `rgb:` que QGIS 3.30+ añade a los colores.

Como `line-dasharray` no admite expresiones data-driven en MapLibre, cada patrón
de guiones se emite como una capa aparte; y como en QGIS gana la primera regla
que hace match, a cada regla se le resta el filtro de las anteriores para que
queden mutuamente excluyentes.

Si el GeoPackage viene en otro CRS se intenta reproyectar con proj4 a partir del
WKT de `gpkg_spatial_ref_sys`; si no se puede, se avisa en pantalla en vez de
cargar la capa en el lugar equivocado sin decir nada.

Lo que **no** se interpreta todavía: pilas de varias capas de símbolo (los
ornamentos geológicos —dientes de cabalgamiento, ticks de falla normal— se
aplanan a su capa base), marcadores SVG, y propiedades data-defined.

**Con Apple Pencil presente, el lápiz siempre dibuja y los dedos siempre
navegan.** No hay que cambiar de modo, y el rechazo de palma sale gratis: la
palma genera eventos `touch`, que en ese caso nunca dibujan. Sin Pencil, el
dedo dibuja (se puede desactivar en Ajustes).

El panel superior izquierdo muestra en vivo el tipo de puntero, la presión, la
inclinación y cuántas muestras coalescidas llegan por evento. Sirve para
comprobar en el iPad real qué expone Safari antes de construir nada encima.

## Simbología

Provisional, según lo acordado: el **tipo** se codifica en color y la
**certeza** en el patrón de línea.

| Tipo | Color |
|---|---|
| Falla inversa / cabalgamiento | rojo `#D32F2F` |
| Falla normal | naranja `#F57C00` |
| Falla dextral | morado `#7B1FA2` |
| Falla sinestral | verde azulado `#00838F` |
| Falla indiferenciada | gris azulado `#546E7A` |
| Contacto estratigráfico | casi negro `#212121` |
| Contacto intrusivo | magenta `#C2185B` |
| Contacto estructural | verde `#2E7D32` |
| Antiforme / Sinforme | magenta `#ff00ff` |
| Dique | café `#6D4C41` |

Certeza: **observado** continua · **inferido** segmentada · **cubierto**
punteada.

El halo blanco que despega la traza del satélite solo lo llevan las líneas
**continuas**. En una segmentada o punteada el halo es un segundo patrón de
guiones por detrás del primero, más ancho, que nunca calza: los guiones blancos
asoman entre los del trazo y emborronan justo el patrón de certeza que hay que
distinguir a ojo. Una línea segmentada ya se separa del fondo por su ritmo. Los ejes de pliegue son la excepción: **solo observados** (ver
*Pliegues*).

El color de los tipos que llevan ornamento —las cuatro fallas y los dos
pliegues— se puede cambiar desde el módulo de simbología; el resto sale de esta
tabla (ver *Color editable*).

Nota técnica: `line-dasharray` no admite expresiones data-driven en MapLibre,
así que hay una capa por patrón de certeza, filtrada por atributo. El color sí
es data-driven con una expresión `match`.

## Basemaps

Esri (satélite, topográfico, terreno, sombreado), OpenTopoMap y OSM. Todos sin
token y con atribución.

**Google Satellite queda deliberadamente fuera**: el endpoint `mt1.google.com/vt`
funciona y es lo que usa QuickMapServices, pero incumple los Términos de
Servicio de Google. Esri World Imagery cubre bien Chile. Alternativas
legítimas si hace falta más resolución: Sentinel-2 cloudless de EOX, o
Mapbox/Bing con API key.

Las curvas de nivel se generan **en el cliente** con `maplibre-contour` a
partir de teselas terrain-RGB de AWS (dominio público). Eso permite elegir el
intervalo y funcionar offline, en vez de depender de un servicio de curvas.

## Mapas offline: MBTiles y PMTiles

Ambos entran por el mismo botón **Importar** y aparecen en el panel de capas,
sobre los basemaps y bajo el dibujo, con su orden y su transparencia.

La diferencia importante es cómo se leen:

- **PMTiles** está diseñado para lecturas por rango, así que se sirve haciendo
  `blob.slice()` sobre el archivo local. Un mapa de varios GB funciona sin
  cargar nada en memoria. **Es el formato recomendado para terreno.**
- **MBTiles** es SQLite y sql.js solo opera en memoria, así que hay que cargar
  el archivo entero. Va bien hasta unos cientos de MB; por encima de 250 MB la
  app avisa antes de abrirlo y sugiere convertirlo a PMTiles.

Se detecta solo si el set es raster o vectorial. Las teselas vectoriales vienen
gzipeadas y se descomprimen con `DecompressionStream`. Ojo con el detalle que
más quebraderos da: MBTiles indexa las filas en **TMS** (la fila 0 es la del
sur), al revés que el esquema XYZ que pide MapLibre.

Un `.mbtiles` vectorial no trae con qué simbolizarse, así que se pinta con un
estilo genérico tipo inspector: una capa por geometría y color estable derivado
del nombre de cada capa fuente.

### Fabricar los mapas: complemento de QGIS

En `qgis-plugin/` vive **FieldDraw Tiles**, un complemento que convierte
cualquier capa ráster de QGIS —una ortofoto, una carta escaneada, un DEM
simbolizado— en los dos formatos que entran por **Importar**. Sale como
algoritmo de Processing, así que también corre en lote y dentro de un modelo.

No necesita `gdal2tiles`, ni `tippecanoe`, ni la utilidad `pmtiles`: escribe
los dos contenedores con las librerías que QGIS ya trae. Corta teselas de
**256 px en EPSG:3857** —que es lo que la app pide— y elige el formato de
imagen tesela a tesela para que el archivo que se lleva a terreno pese lo
menos posible: JPEG en el interior opaco, WebP en los bordes con
transparencia, y las teselas totalmente vacías ni se guardan. Sobre una
ortofoto de prueba eso son 0,63 MB donde todo en PNG serían 9,5.

Se instala descargando [`qgis-plugin/fielddraw_tiles.zip`](qgis-plugin/fielddraw_tiles.zip)
y usando **Complementos → Administrar e instalar complementos → Instalar a
partir de ZIP**. Instrucciones, opciones y medidas en
[`qgis-plugin/README.md`](qgis-plugin/README.md).

## Edición de vértices y edición topológica

La herramienta **Nodos** muestra una manija por vértice y una más pequeña en
cada punto medio, y tiene tres modos, elegibles en la paleta:

- **Mover**: arrastrar una manija mueve el vértice; arrastrar un punto medio
  inserta uno nuevo y lo lleva consigo; un doble toque sobre una manija la borra.
- **Añadir**: un toque sobre el borde inserta un vértice ahí y lo deja agarrado,
  para colocarlo en el mismo gesto. El vértice cae **sobre** la línea, no donde
  se tocó, así que no deforma la geometría al insertarlo.
- **Borrar**: un toque sobre una manija la elimina, sin doble toque.

Si hay elementos seleccionados solo se editan esos; si no, todo el dibujo. Los
vértices se enganchan al snapping mientras se mueven, y mover, insertar o borrar
son operaciones deshacibles.

La casilla **Edición topológica** (en Ajustes, activada por defecto) es la que
evita el trabajo de rehacer el polígono vecino: cuando dos polígonos contiguos
comparten físicamente los vértices de su borde común, mover o borrar uno los
aplica a todos a la vez, así que el borde no se abre nunca. Los vértices
compartidos se dibujan en **magenta** para que se vea de antemano cuáles se van
a mover en bloque.

Dos detalles que no son obvios y que están cubiertos por pruebas:

- La exclusión del snapping durante el arrastre usa **siempre** el grupo de
  vértices coincidentes, aunque la topología esté apagada. Si no, el vértice
  del vecino que ocupa el mismo punto atraería al que se está moviendo y sería
  imposible separarlos.
- Un borrado que dejaría la geometría degenerada (una línea con menos de dos
  puntos, un anillo con menos de tres) se omite y se avisa, en vez de destruir
  la geometría del vecino.

## Reshape

**Reshape** redibuja un tramo del contorno de un elemento trazando una línea
nueva, como la herramienta homónima de QGIS. Exige seleccionar antes qué se
redibuja, por lo mismo que Cortar: el gesto es una línea cualquiera sobre el
mapa y, sin acotar, afectaría de golpe a todo lo que cruce.

La línea tiene que **entrar y salir** de la geometría. Entre el primer y el
último cruce quedan dos candidatos —cada uno de los dos arcos del contorno,
cerrado con el tramo dibujado— y se queda el de **mayor área**. Esa regla, que
suena arbitraria, es la que hace que la herramienta responda como uno espera en
los dos usos reales:

- Trazando **por fuera** y volviendo a entrar, los candidatos son "el polígono
  entero más la panza" y "solo la panza": gana el primero, o sea el polígono
  **crece**.
- Trazando **de lado a lado**, los candidatos son los dos trozos en que queda
  partido: gana el mayor, o sea se **recorta** el pequeño, que es justo el lado
  que uno acaba de dejar fuera al trazar.

Solo toca el anillo exterior: reformar un hueco es otra operación, y mezclarlas
haría impredecible un gesto que ya es ambiguo de por sí. En una línea abierta no
hay nada que elegir — se sustituye el tramo entre los dos cruces y se conservan
las dos puntas.

Va sin JSTS: es geometría propia (`src/reshape.js`) sobre las coordenadas, lo
que además evita descargar 500 KB en terreno. El motivo de fondo es que el
algoritmo necesita saber *por dónde* del contorno pasa la línea —una posición a
lo largo del anillo, no solo un conjunto de puntos de corte— y eso es justo lo
que las operaciones booleanas pierden.

## Confirmación topológica

El botón **Topología** hace que los elementos contiguos compartan físicamente
todos los vértices de su borde común. Trabaja sobre la selección, o sobre todo
el dibujo si no hay ninguna, y es una sola operación en el historial.

Son las dos pasadas de «Snap geometries to layer» de QGIS:

1. **Fusión.** Los vértices a menos de la tolerancia se agrupan y se llevan al
   centroide del grupo. Dos polígonos dibujados a ojo dejan de tener dos
   vértices casi iguales y pasan a tener uno solo, repetido en ambos.
2. **Nodado.** Un vértice que cae *sobre* el segmento del vecino se inserta en
   ese segmento. Es el caso del polígono digitalizado con más detalle que su
   vecino: el borde coincide a la vista pero no comparte nodos, y sin esta
   pasada cualquier edición topológica posterior abre un gap.

La tolerancia va en **metros de terreno** (Ajustes, 0,5–50 m, 5 por omisión), no
en píxeles: es una propiedad del dato, no de cómo se esté mirando el mapa. Por
debajo, todo ocurre en un plano local en metros —equirectangular alrededor de la
latitud media del dato— para que la tolerancia valga lo mismo en x que en y.

Una geometría que quedaría degenerada (una línea con menos de dos puntos, un
anillo con menos de tres) se deja como estaba y se avisa, en vez de destruirla.
Y si no hay nada que cambiar, no se toca el historial: la operación es
idempotente y lo dice.

## Proyectos

El botón **Proyecto** guarda y abre un `.fdproj.json` con el dibujo, las
unidades, la simbología y los ajustes de digitalización. Al abrirlo se restaura
todo, incluidos los deslizadores de Ajustes, y el historial se corta: deshacer no
debe llevar de vuelta al proyecto anterior.

No van dentro las capas importadas ni los mapas offline. Son archivos de cientos
de MB que viven en Archivos o en Drive, y meterlos convertiría un proyecto de 40
KB en uno de varios GB; se vuelven a abrir con **Importar**, que es el mismo
gesto de siempre.

El formato lleva un `features` que es una lista de features GeoJSON, así que un
proyecto se puede inspeccionar con cualquier herramienta. Al revés también
funciona: si se le da un GeoJSON pelado, carga la geometría (asignando ids a lo
que no los traiga) y avisa de que no era un proyecto.

El autosave en localStorage sigue como estaba, para no perder el trabajo si se
cierra Safari; el proyecto es para llevárselo, versionarlo o pasarlo a otro
equipo.

## Unidades geológicas

El botón **Unidades** abre el módulo donde se definen las unidades del mapa:
nombre, código abreviado y color. La paleta de polígonos pasa a listarlas, y al
digitalizar un polígono se le asocia la unidad activa.

Cada polígono guarda la unidad **denormalizada** en dos campos, `unit` y
`code`, que se exportan como texto en el GeoPackage. Renombrar una unidad
propaga el cambio a los polígonos que ya la usaban.

Si un polígono quedó sin unidad, o con la equivocada, se corrige seleccionándolo
y usando el menú de propiedades.

## Menú de propiedades

Mantener pulsado ~1 s sobre la selección abre un menú flotante con:

- **Editar nodos**, que salta a la herramienta de vértices ya acotada a lo
  seleccionado.
- **Certeza**: observado, inferido o cubierto.
- **Unidad**, cuando hay polígonos en la selección.
- **Opacidad** por elemento, que se compone con la de la capa.
- **Vértices**: los tres modos de la herramienta Nodos, ya acotados a lo
  seleccionado, para ir directo a añadir o a borrar un vértice.
- **Invertir símbolo**, cuando hay fallas con ornamento en la selección.
- **A polígono**, cuando hay líneas en la selección: las cierra y las convierte
  en una unidad (ver *De línea a polígono*).
- **Suavizar** (Chaikin) y **Simplificar** (Douglas-Peucker con tolerancia
  derivada del tamaño de la propia geometría, para que se comporte igual en un
  dique de 200 m que en un contacto de 20 km).
- **Borrar** la selección.

> Sobre la ambigüedad entre «mantener pulsado abre el menú» y «mantener pulsado
> edita nodos»: se resolvió con un solo gesto, el menú, y *Editar nodos* como su
> primera acción. Si prefieres que la pulsación larga salte directo a los nodos,
> es un cambio de una línea.

## Ornamentos de falla y de pliegue

Las fallas llevan su símbolo estructural: **dientes** en las inversas, **tics
con cuadrado** en las normales y **pares de medias flechas** en las de rumbo,
con el sentido correcto para dextral y sinestral. Una falla cubierta no los
lleva: no tiene expresión superficial que ornamentar. Los ejes de pliegue llevan
**flechas perpendiculares** al eje, divergentes o convergentes.

Se dibujan como capas `symbol` con `symbol-placement: 'line'`, que reparte
iconos a lo largo del trazo y los rota con él; `icon-offset` desplaza en el
marco ya rotado, así que el ornamento queda siempre al mismo lado de la falla
sea cual sea su rumbo. Los iconos se generan en canvas ya coloreados, uno por
tipo, en vez de usar SDF: un SDF real necesita un campo de distancias y una
máscara alfa cruda se ve sucia al recolorearla.

### Simbología editable

El botón **Símbolos** abre el módulo donde se ajusta, por tipo de falla y de
pliegue:

| Parámetro | Qué hace |
|---|---|
| Color | repinta la traza y su ornamento; parte del catálogo y se guarda con el proyecto |
| Tamaño | escala el icono (0,4–2,5×); multiplica la rampa por zoom, no la reemplaza |
| Espaciado | separación entre símbolos a lo largo de la traza (10–200 px) |
| Posición | distancia perpendicular a la traza; el signo elige el lado (±14 px). No se ofrece en los pliegues: su símbolo va a caballo del eje |
| Zoom mínimo | por debajo no se dibuja, para que a escala regional la traza no sea una fila de símbolos |

Los cambios se aplican en caliente con `setLayoutProperty` en vez de recrear las
capas: es más barato y no parpadea mientras se arrastra un deslizador. Los
valores se guardan en localStorage y viajan dentro del proyecto.

### Flip

**Invertir símbolo**, en el menú de propiedades, **refleja el ornamento como en
un espejo cuyo eje es la propia traza**: los dientes o los tics pasan al otro
lado sin tener que redibujar la falla al revés — que es lo que había que hacer
antes cuando el bloque colgante quedaba del lado equivocado.

Se resuelve con dos capas por tipo, filtradas por el atributo `flip`, en vez de
con expresiones data-driven: `icon-offset` e `icon-rotate` sí admiten
expresiones, pero tienen que ir sincronizados, y dos capas con filtros
mutuamente excluyentes son más fáciles de leer y de comprobar.

La reflexión la hace **`icon-rotate: 180` ella sola**, y por eso las dos capas
llevan el **mismo** `icon-offset`. MapLibre hornea el offset en las esquinas del
quad del icono (`shapeIcon`) y recién después les aplica la matriz de
`icon-rotate` (`getIconQuads`), así que el giro arrastra también el
desplazamiento: 180° dejan el símbolo al otro lado de la traza, a la misma
distancia. Negar además el offset —que es lo que parece natural, y lo que hacía
la primera versión— lo devolvía al lado de partida, y el flip terminaba dando
vuelta el diente **sin cambiarlo de bloque**.

Que girar 180° equivalga a reflejar depende de que el icono sea simétrico
respecto de su eje vertical, y los cuatro lo son: el diente y el tic por
construcción, y el par de medias flechas porque su simetría es justamente de
180°. En las fallas de rumbo eso es además lo que corresponde: el flip no cambia
el sentido del movimiento —reflejar de verdad un par dextral daría uno
sinestral, que es otra falla— y para eso se cambia el tipo, que es un dato
distinto, no una decisión de dibujo.

### Pliegues

Los ejes de pliegue se cartografían con dos tipos propios, en su grupo
**Folds** de la paleta: **antiforme** y **sinforme**.

El ornamento son dos flechas perpendiculares al eje, una a cada lado, que es lo
que distingue uno de otro: **divergentes** en el antiforme —los flancos manteen
alejándose de la charnela— y **convergentes** en el sinforme. A diferencia del
de una falla, el símbolo va a caballo del eje (`icon-offset` 0, mitad a cada
lado), y de ahí salen dos consecuencias:

- **No se ofrece flip.** Las flechas son simétricas respecto del eje, así que
  reflejarlas devuelve el mismo dibujo — y un antiforme no pasa a ser sinforme
  por haberlo digitalizado al revés. El botón del menú de propiedades solo
  cuenta las fallas, y `flipSelectedOrnament` tampoco los toca.
- **No se ofrece el deslizador de Posición.** Desplazar el símbolo hacia un
  lado rompe lo que significa.

**Solo se mapean como observados.** El eje se traza donde se ve el cierre o
donde lo obligan los manteos medidos; "inferido" y "cubierto" no son grados de
certeza que se le apliquen a un eje, y ofrecerlos solo produce datos que después
nadie sabe interpretar. La restricción se aplica en tres sitios, no solo en la
UI:

- Elegir Antiforme o Sinforme baja la certeza activa a observado.
- Al cerrar el elemento, `finishDraft` la reajusta según el tipo definitivo, que
  puede venir heredado si se estaba continuando una línea.
- `updateSelectedProps` la filtra por elemento: en una selección mixta, poner
  "inferido" afecta a los contactos y deja los ejes como estaban.
- Y `parseProject` la normaliza al abrir, para que tampoco entre por un proyecto
  ajeno o por un GeoPackage.

En la paleta los dos chips que no aplican se ven pero no se pueden pulsar, con
la razón en el tooltip: esconderlos dejaría al usuario preguntándose adónde se
fueron.

### Color editable

La muestra de color de cada fila del módulo es a la vez el selector: se toca y
se abre la rueda del sistema. Repinta **la traza y su ornamento**, en caliente.

El magenta `#ff00ff` de los pliegues es solo el valor de partida — sobre imagen
satelital no se confunde con ningún contacto ni falla, que es lo que se le pide
a un eje. Los dos pliegues arrancan del mismo color a propósito: lo que
distingue un antiforme de un sinforme son las flechas, no el color.

El color vive en el mismo objeto que el resto de los parámetros del ornamento,
así que se guarda en localStorage y viaja dentro del proyecto sin código nuevo.
Tres detalles que sí hicieron falta:

- La expresión `line-color` pasa a construirse a demanda (`lineColorExpr`) y
  mapView la reaplica con `setPaintProperty`, igual que ya hacía con el relleno
  de las unidades.
- Los iconos están rasterizados en canvas **ya coloreados**, así que un cambio
  de color obliga a redibujarlos. Se sustituyen con `updateImage`, que conserva
  el nombre —quitar y volver a añadir la imagen deja las capas parpadeando— y
  solo se toca el tipo que cambió, porque esto corre en cada evento `input` del
  selector mientras se arrastra por la rueda.
- El QML y el SLD que se exportan dentro del GeoPackage llevan el color
  efectivo, no el del catálogo: lo que se abre en QGIS tiene que verse como lo
  que se dejó en la tablet.

Solo son editables los tipos que aparecen en el módulo, que son los que llevan
ornamento. Los contactos y el dique salen siempre del catálogo.

## Deshacer y rehacer

Historial de hasta 60 pasos sobre el conjunto de elementos. Guarda referencias
al array, no copias: como cada mutación crea un array nuevo, un snapshot cuesta
lo que una referencia. Cargar un proyecto corta el historial, para no poder
deshacer hacia la sesión anterior.

## Cortar y unir

Emulan la digitalización avanzada de QGIS, sobre JSTS (el port JavaScript de
JTS). Son ~600 KB que solo se descargan la primera vez que se usa una de las
dos herramientas.

**Cortar exige seleccionar antes qué se corta.** Aplicarlo a todo el mapa por
omisión era demasiado destructivo para un gesto tan fácil de disparar; si no hay
selección, la app avisa en vez de cortar.

**Cortar** admite dos cuchillas, elegibles en Ajustes:

- **Una línea que dibujo**: se traza en rojo —el color avisa de que la
  operación es destructiva— y al cerrarla parte todo lo que cruce.
- **Un elemento que ya existe**: se toca una línea o un polígono del mapa y se
  usa como cortador. Un polígono corta por su **borde**, que es lo que permite
  recortar un contacto contra el límite de una unidad ya digitalizada. El
  cortador nunca se corta a sí mismo.

Si hay elementos seleccionados, el corte afecta solo a esos. Las piezas heredan
tipo, certeza y demás atributos del elemento original.

- Líneas: se hace `union` con la línea de corte, que noda ambas geometrías en
  sus intersecciones, y se conservan los trozos que pertenecen a la original.
- Polígonos: receta clásica de JTS — se unen los anillos con la línea de corte,
  se poligoniza el resultado y se descartan las piezas que caen fuera del
  polígono de partida. Los huecos se respetan.

**Unir** trabaja sobre la selección: `LineMerger` para líneas contiguas y
`union` para polígonos. No deja mezclar líneas con polígonos.

Al unir polígonos se fuerza que el resultado quede **limpio por dentro**:

1. Primero se aplica la confirmación topológica a la selección. Dos bordes que
   no coincidían al milímetro producirían slivers, y un sliver es exactamente un
   hueco interior en la unión; snapear antes es más barato que limpiar después.
2. De los anillos interiores que queden se descartan los **slivers** y se
   conservan los **huecos de verdad**. Se distinguen por la forma y no por el
   tamaño: un sliver es el hilo largo y fino que dejan dos bordes que no
   coincidían, y un hueco cartografiado es compacto. La medida es la compacidad
   de Polsby-Popper (4π·área/perímetro²), que vale 1 en un círculo y tiende a 0
   en una astilla; por debajo de 0,02 el anillo es un hilo. Un stock chico y un
   sliver enorme existen los dos, así que el área no serviría para separarlos.
3. Y se quitan los vértices colineales, que es lo que deja el borde común al
   desaparecer: una fila de nodos alineados que no aportan forma.

Antes el paso 2 tiraba **todos** los anillos interiores, y con ellos las ventanas
erosivas y los roof pendants; desde que existe **Hole**, un anillo interior puede
ser un dato cartografiado y no un artefacto, así que fusionar una unidad con su
vecina ya no lo borra.

Si las líneas **no se tocan**, no falla: se encadenan por sus extremos más
próximos, evaluando los cuatro emparejamientos posibles en cada paso e
invirtiendo o anteponiendo la pieza según convenga. El salto entre tramos queda
como un segmento recto, que es lo que uno dibujaría a mano para cerrar un
contacto partido. En polígonos disjuntos las piezas se guardan por separado,
porque el modelo de datos usa polígonos simples, no multiparte.

### Quitar un área interior

**Hole** resta un área a un polígono: se dibuja el contorno de lo que sobra y al
cerrarlo desaparece de la unidad. Es la operación para una ventana erosiva, una
laguna, un roof pendant o un stock que atraviesa la unidad en la que se está
mapeando.

Lo que queda **no es un contorno recortado, es un anillo interior de verdad**: un
polígono GeoJSON con dos anillos, que el GeoPackage guarda como tal y QGIS abre
como un polígono con hueco. Los atributos —unidad, certeza, opacidad— se heredan
sin tocar nada.

A qué afecta:

- **Con selección**, a los polígonos seleccionados y a nadie más.
- **Sin selección**, solo si hay **exactamente uno** que contenga el área. Ahí no
  hay ambigüedad posible y pedir que se seleccione primero sería un paso de más
  en terreno. Si acaban solapando dos, se detiene y lo pide: restarle el mismo
  hueco a todo lo que se solape borraría área de unidades que nadie nombró.

Los dos casos en que el resultado no es un hueco se dicen en vez de dejarlos
pasar:

- **El área atraviesa el polígono de lado a lado**: entonces no deja un hueco,
  lo parte en dos. Es un resultado legítimo —el mismo que daría Cortar— pero no
  es el que se pidió, así que la app dice cuántas piezas salieron.
- **El área cubre el polígono entero**: no se borra nada. Hacer desaparecer un
  elemento sin avisar es la peor respuesta posible a un trazo que se pasó de
  largo.

Un contorno dibujado a pulso que se cruza a sí mismo tampoco falla: se normaliza
con `buffer(0)` antes de restar, igual que en Unir.

Todo va al historial en un solo paso: **deshacer** devuelve el polígono entero.

### De línea a polígono

**A polígono**, en el menú de propiedades, cierra las líneas seleccionadas y las
convierte en una unidad. Es la operación que faltaba para el orden natural del
trabajo: en terreno se digitalizan primero los contactos y las fallas, y recién
después se decide qué área encierran.

- **Una línea**: se cierra el anillo sobre su primer vértice.
- **Varias**: se encadenan antes por sus extremos más próximos (el mismo
  `chainLines` de Unir), porque el borde de una unidad casi nunca es un solo
  trazo sino un contacto más una falla más otro contacto. El resultado es **un**
  polígono, no uno por trazo, y el salto entre pieza y pieza queda como un
  segmento recto.

El polígono nace con la **unidad activa de la paleta** —una línea no tiene
unidad de la que heredarla— y conserva la certeza y la opacidad de la primera
línea. `flip` se descarta: es del ornamento de la falla y no significa nada en
un polígono. Las líneas de origen desaparecen; es una conversión, no una copia,
y como cualquier otra edición se deshace con un solo paso.

Hacen falta **tres vértices distintos**: dos no encierran área. Los puntos
repetidos seguidos —de los que un trazo a pulso deja de sobra— se descartan
antes de contar, y una línea que ya venía cerrada no duplica su primer vértice.
No se valida la autointersección: cerrar un trazo que se cruza a sí mismo da un
polígono inválido, igual que dibujarlo a mano con la herramienta Polígono.

## StraboSpot

El botón **StraboSpot** abre un panel con sesión, proyecto, dataset, descarga
de spots y subida del dibujo como dataset nuevo (`src/strabo/`).

**Sesión.** HTTP Basic con el correo como usuario. Las credenciales viven
**solo en memoria**, nunca en localStorage: dejarlas escritas en el disco de
una tablet que va a terreno no compensa el ahorro de volver a escribirlas.

**Descarga.** Los spots se aplanan a **Estructuras** y **Observación**, con las
mismas columnas y en el mismo orden que produce el plugin de QGIS
`Strabo_to_Spots`, replicando dos detalles suyos que no son obvios:

- La estría de una falla no es un elemento suelto de `orientation_data`: viene
  anidada en `associated_orientation`, dentro de la propia medición planar. Leer
  solo el primer nivel deja `Trend`/`Plunge` vacíos en todas las fallas.
- `Type` se arma comparando `planar === "fault"` **sin normalizar mayúsculas**,
  igual que el plugin: es lo que decide contra qué SVG categoriza la simbología,
  y "corregir" la comparación cambiaría esas categorías.

La simbología de Estructuras usa los mismos SVG del plugin (`vendor/strabo-svg/`,
copiados de ahí), rotados por `Strike` con `icon-rotation-alignment: map`; la de
Observación categoriza por `Process`.

**Ver atributos.** Tocar un spot abre un panel de solo lectura con **todos** sus
campos, en el orden de las columnas del plugin: nombre, fecha, unidad y a
continuación las **anotaciones de terreno** (`Notes`), antes que las
coordenadas y la medición. Los campos vacíos se muestran igual, con un guion, en
vez de desaparecer: que un dato falte también es información.

Los campos que se leen como texto corrido —`Notes`, `Structure notes`,
`Sample Description`— van a ancho completo debajo de su etiqueta y no
apretados en la columna derecha, donde un párrafo de libreta quedaba en una tira
ilegible.

Funciona por `queryRenderedFeatures` sobre las capas de contenido (no las de
etiqueta), consultando un **recuadro de ±10 px** y no el píxel exacto: los
símbolos estructurales son chicos y en terreno se tocan con el dedo.

El toque entra por dos puertas, porque una sola no alcanzaba:

- En **Navegar**, por el evento `click` nativo de MapLibre.
- En **Elegir**, desde el propio final del gesto: esa herramienta arrastra el
  lazo, así que `DrawController` consume el puntero y el `click` de MapLibre
  no llega nunca. Sin esto, tocar un spot con la herramienta con la que uno
  naturalmente lo intenta no hacía absolutamente nada. Si el toque cae sobre un
  elemento del dibujo propio, ese manda; el spot solo se consulta cuando el
  toque quedó en vacío, y entonces la selección se limpia igual que con
  cualquier otro toque en vacío: un spot importado se lee, no se selecciona.

**Filtrar por tipo.** El panel construye, para cada categoría con datos
(Estructuras por `Type`, Observación por `Process`, Líneas/Polígonos por
`Type`), una lista de casillas con los valores presentes en el dataset y cuántos
elementos trae cada uno. Se aplica con `setFilter` de MapLibre, sin volver a
pedir nada a la API. El filtro de tipo se **combina** con el filtro de geometría
que ya tenía `strabo-lines-fill` (que separa el relleno de polígono del trazo de
línea) en vez de reemplazarlo, y al marcar todas las casillas se vuelve a "sin
filtro": así un dataset nuevo con valores distintos no hereda una lista que ya
no tiene sentido.

**Tamaño de símbolo.** Dos deslizadores (0,4–3×) escalan el icono de Estructuras
y el punto de Observación, en caliente y sin recrear capas. Se guardan en
localStorage, aparte de los ornamentos de falla del dibujo propio: son símbolos
ajenos, y agrandarlos para verlos mejor no debería tocar la simbología del mapa
que se está construyendo.

**Subida.** Siempre a un dataset **nuevo**: `POST /db/datasetspots/{id}`
reemplaza todos los spots del dataset de destino, así que escribir en uno
existente lo destruiría. Las líneas y polígonos del dibujo se convierten en
spots con las columnas del plugin (`Name`, `Date`, `Unit`, `Notes`, `Type`,
`Field`, `Geologist`).

Un detalle de la API que costó encontrar: StraboSpot responde **406** ante
cualquier petición con `Accept: application/json`, aunque JSON sea justo lo que
devuelve. El cliente no manda esa cabecera —comprobado con curl aislando cabecera
por cabecera contra el servidor real— y por eso el plugin de QGIS, que tampoco la
manda, nunca se topó con esto.

## Por qué la app se quedaba colgada

Se reportaban tres síntomas que parecían tres fallos distintos —el 3D no
arrancaba, los perfiles no se generaban, el dedo dejaba de seleccionar— y eran
cuatro defectos, ninguno en la función que fallaba a la vista.

**1. Teselas: red primero.** El service worker pedía cada tesela a la red y solo
usaba la caché si el `fetch` fallaba. Con señal débil —lo normal en terreno— el
`fetch` no falla: se queda esperando en un socket muerto durante minutos. Como
por ahí pasan el basemap, las curvas, el sombreado, el relieve 3D y las cotas del
perfil, todo se detenía a la vez aunque estuviera ya descargado. Ahora es **caché
primero** con refresco por detrás: una tesela z/x/y no cambia nunca, así que
pedirla a la red no aportaba nada. La red solo se espera cuando no hay copia, y
con plazo.

**2. Teselas del DEM sin plazo.** El muestreador de cotas usa `Image`, que no
trae temporizador: si no llegan ni `onload` ni `onerror`, la promesa **no se
resuelve nunca**. El perfil las espera todas con `Promise.all`, así que se quedaba
calculando para siempre y con él bloqueada la herramienta, porque la bandera de
"ocupado" tampoco bajaba. Ahora hay plazo de 12 s, un fallo caduca a los 20 s
—volver con señal recuperada reintenta— y una segunda petición mientras hay una
en curso lo dice en vez de no hacer nada. OpenTopography lleva su propio plazo de
45 s con `AbortController`.

**3. Un gesto que termina fuera del mapa.** Mientras se dibuja, el controlador
detiene todos los eventos de touch y ratón del mapa —MapLibre no usa Pointer
Events y esa es la única forma de que no haga pan a la vez—, y levanta esa
bandera al recibir el `pointerup`. El `pointerup` estaba colgado del contenedor
del mapa, así que se perdía si el dedo o el lápiz se levantaban fuera de él:
sobre un panel recién abierto, por el borde de la pantalla, o si
`setPointerCapture` había sido rechazado. La bandera se quedaba puesta **para
siempre** y el mapa dejaba de responder a todo. Ahora el fin de gesto se escucha
en la **ventana**, donde llega siempre.

**4. El dedo fantasma.** Mismo origen: un `pointerup` perdido dejaba un puntero
registrado que ya no estaba en la pantalla. El controlador cuenta dedos para
distinguir un trazo de un gesto de navegación, así que con un fantasma en la
cuenta **cada** toque siguiente se tomaba por el segundo dedo de un gesto a dos
manos: el dedo dejaba de seleccionar, de cerrar el elemento y de abrir el menú, y
nada lo anunciaba. Ahora el primer contacto de un gesto nuevo (`isPrimary`) purga
lo que haya quedado, y perder el foco de la ventana o cambiar de app también
limpia.

Y uno más, que no colgaba pero hacía perder actualizaciones: **la notificación
del store no era reentrante**. Un suscriptor que cambiaba el estado desde dentro
de la notificación pisaba la lista de "qué cambió" a mitad del recorrido, y los
suscriptores que aún no habían corrido preguntaban por la clave equivocada. Era
la vía por la que un aviso nacido en el mapa —revertir el relieve 3D cuando el
dispositivo no puede con él— dejaba la barra y el panel mostrando un estado que
ya no era. Ahora los cambios encadenados se emiten en una ronda aparte, con un
corte a las 24 rondas por si dos suscriptores se contestan el uno al otro, que
congelaría el hilo principal sin ningún error.

Las cinco cosas tienen prueba de regresión.

## Estado

- ✅ Basemaps, orden de capas y transparencia por capa.
- ✅ Curvas de nivel con intervalo por zoom.
- ✅ Línea y polígono vértice a vértice, trazo libre por long-press,
  simplificación Douglas-Peucker en píxeles y suavizado Chaikin.
- ✅ Tipos de línea por color, certeza por patrón.
- ✅ Ejes de pliegue: antiforme y sinforme, en magenta y solo como observados.
- ✅ Cierre del elemento por doble toque, toque fuera, doble clic, clic derecho
  o Enter.
- ✅ Exportación a GeoPackage con `layer_styles` (QML + SLD).
- ✅ Importación de GeoPackage respetando la simbología QGIS.
- ✅ Snapping a vértice y segmento, y herramienta Trace.
- ✅ MBTiles y PMTiles, raster y vectorial.
- ✅ Complemento de QGIS que convierte rásteres en los MBTiles y PMTiles que
  la app importa, eligiendo el formato de cada tesela para que pesen poco.
- ✅ Selección por toque y por lazo rectangular; corte y unión con JSTS.
- ✅ Edición de vértices con edición topológica.
- ✅ Corte con una línea dibujada o con un elemento existente, sobre la selección.
- ✅ Unión de líneas no contiguas por sus extremos más próximos.
- ✅ Conversión de línea a polígono, encadenando varias líneas en un solo borde.
- ✅ Módulo de unidades geológicas, exportadas como `unit` y `code`.
- ✅ Menú de propiedades: unidad, certeza, opacidad, suavizado y borrado.
- ✅ Deshacer/rehacer con gestos de dos y tres dedos.
- ✅ Continuación de una línea existente desde su extremo más cercano, con los
  extremos marcados en el mapa y rearme al cambiar la selección.
- ✅ Atajos de teclado con ayuda integrada (`?`), cierre por clic fuera o clic
  secundario, previsualización de enganche con ratón y selección con clic en
  Navegar.
- ✅ Ornamentos de falla y de pliegue: dientes, tics, medias flechas y flechas
  de eje, con color, tamaño, espaciado y posición editables, y flip por
  elemento (reflejo especular respecto de la traza) en las fallas.
- ✅ Confirmación topológica: fusión de vértices y nodado, con tolerancia en metros.
- ✅ Modos de añadir y borrar vértices en la herramienta Nodos.
- ✅ Guardar y abrir proyectos (`.fdproj.json`).
- ✅ Autosave en localStorage y exportación a GeoJSON.
- ✅ PWA instalable: dependencias en `vendor/`, service worker con precache del
  app shell y caché de las teselas ya visitadas.
- ✅ StraboSpot: sesión, descarga de spots (Estructuras/Observación con la misma
  simbología que el plugin de QGIS), subida del dibujo como dataset nuevo, ver
  atributos desde Navegar y desde Elegir, filtrar por tipo y tamaño de símbolo
  ajustable.
- ✅ Reshape de polígonos y líneas, sin dependencias.
- ✅ Botón de GPS para centrar el mapa en la posición propia.
- ✅ Perfiles topográficos sobre el DEM ya cacheado o sobre Copernicus vía
  OpenTopography, con gráfico interactivo ligado al mapa y exportación a CSV.
- ✅ Relieve 3D y sombreado desde el mismo DEM, como modo de visualización con
  el dibujo bloqueado.
- ✅ Rumbo y manteo por brújula, por tres puntos o ajustando un plano a una
  traza, con la incertidumbre propagada desde el error del DEM y los avisos de
  calidad al lado del número.
- ✅ Escala de trabajo: lectura 1:N, salto a una escala de mapeo y candado que la
  mantiene al desplazarse, con lista editable y píxel de pantalla configurable.
- ✅ Quitar un área interior de un polígono, dejando un anillo interior real que
  sobrevive a la fusión con la unidad vecina.
- 🚧 **Pendiente**: nodado automático de intersecciones al dibujar (hoy hay que
  pulsar **Topología**), subtipos por categoría, descarga dirigida de un área
  de basemap para llevar al terreno (hoy se resuelve importando un PMTiles), y
  lineaciones (hoy solo hay superficies planares: rumbo y manteo, sin cabeceo).

## Limitaciones conocidas del iPad

- Los iPad **solo-WiFi no tienen GPS**. Safari en iOS tampoco soporta Web
  Bluetooth, así que no se pueden usar receptores GNSS externos. Para terreno
  se necesita un iPad con celular.
- El doble-tap del Pencil 2 y el squeeze del Pencil Pro **no están expuestos**
  a la web. Presión e inclinación sí.
- La exportación usa `<a download>`, que en iPadOS guarda en Archivos.
