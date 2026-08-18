# FieldDraw — mapeo geológico en tablet

Prototipo de fase 1: basemaps web, curvas de nivel generadas en el cliente,
panel de capas con orden y transparencia, y digitalización con Apple Pencil
(vértice a vértice + trazo libre por long-press).

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
for f in logic draw gpkg snapping edit vertex topology project ornaments strabo; do node test/$f.test.mjs; done
```

453 comprobaciones sin dependencias: simplificación, simbología, estilo, store,
comportamiento del lápiz y de los dedos (con un DOM simulado),
WKB/GeoPackageBinary, parsers de color y de filtros de QGIS, índice de snapping,
camino más corto del trace, punto-en-polígono, selección, flujo de la línea de
corte, edición de vértices (mover, insertar, borrar, buscar el punto de
inserción y agrupar coincidentes), confirmación topológica, serialización de
proyectos, parámetros de los ornamentos, historial de deshacer/rehacer,
encadenado de líneas sueltas, extensión de líneas, el módulo de unidades y el
aplanado, la simbología, los filtros y el tamaño de símbolo de StraboSpot.

Lo que necesita navegador —`DOMParser` para el QML, el wasm de sql.js y JSTS—
vive en `test/browser.html`: ábrela con el servidor corriendo en
`http://localhost:5174/test/browser.html`. Cubre el round-trip completo
exportar→importar, QML real de QGIS, un MBTiles fabricado al vuelo, las
operaciones de corte y unión, y la validación de todas las capas generadas
contra el style-spec de MapLibre.

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

Un service worker no puede precachear un basemap mundial: son teselas
ilimitadas. Lo que hace es guardar en una caché aparte —con tope de 6000
teselas— todo lo que se haya mirado, así que la zona que revisaste antes de
salir sigue ahí. **Para cobertura garantizada en terreno, la respuesta es
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
| Continuar una línea | seleccionarla y elegir **Línea** |
| Mover un vértice | herramienta **Nodos**, modo *Mover*, y arrastrar la manija |
| Insertar un vértice | **Nodos** → *Añadir*, y tocar el borde; o arrastrar un punto medio |
| Borrar un vértice | **Nodos** → *Borrar*, y tocar la manija; o doble toque en modo *Mover* |
| Cortar | seleccionar, luego **Cortar**: dibujar la línea, o tocar otro elemento |
| Unir | seleccionar dos o más y pulsar **Unir** |
| Compartir vértices | **Topología** (sobre la selección, o sobre todo el dibujo) |

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

## GeoPackage

**Exportar** produce un `.gpkg` válido (SQLite con `application_id` GPKG,
geometrías en GeoPackageBinary + WKB, EPSG:4326) con dos tablas, `geol_lines` y
`geol_polygons`, y —lo importante— una tabla `layer_styles` con el QML y el SLD
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
| Dique | café `#6D4C41` |

Certeza: **observado** continua · **inferido** segmentada · **cubierto**
punteada.

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
- **Suavizar** (Chaikin) y **Simplificar** (Douglas-Peucker con tolerancia
  derivada del tamaño de la propia geometría, para que se comporte igual en un
  dique de 200 m que en un contacto de 20 km).
- **Borrar** la selección.

> Sobre la ambigüedad entre «mantener pulsado abre el menú» y «mantener pulsado
> edita nodos»: se resolvió con un solo gesto, el menú, y *Editar nodos* como su
> primera acción. Si prefieres que la pulsación larga salte directo a los nodos,
> es un cambio de una línea.

## Ornamentos de falla

Las fallas llevan su símbolo estructural: **dientes** en las inversas, **tics
con cuadrado** en las normales y **pares de medias flechas** en las de rumbo,
con el sentido correcto para dextral y sinestral. Una falla cubierta no los
lleva: no tiene expresión superficial que ornamentar.

Se dibujan como capas `symbol` con `symbol-placement: 'line'`, que reparte
iconos a lo largo del trazo y los rota con él; `icon-offset` desplaza en el
marco ya rotado, así que el ornamento queda siempre al mismo lado de la falla
sea cual sea su rumbo. Los iconos se generan en canvas ya coloreados, uno por
tipo, en vez de usar SDF: un SDF real necesita un campo de distancias y una
máscara alfa cruda se ve sucia al recolorearla.

### Simbología editable

El botón **Símbolos** abre el módulo donde se ajusta, por tipo de falla:

| Parámetro | Qué hace |
|---|---|
| Tamaño | escala el icono (0,4–2,5×); multiplica la rampa por zoom, no la reemplaza |
| Espaciado | separación entre símbolos a lo largo de la traza (10–200 px) |
| Posición | distancia perpendicular a la traza; el signo elige el lado (±14 px) |
| Zoom mínimo | por debajo no se dibuja, para que a escala regional la traza no sea una fila de símbolos |

Los cambios se aplican en caliente con `setLayoutProperty` en vez de recrear las
capas: es más barato y no parpadea mientras se arrastra un deslizador. Los
valores se guardan en localStorage y viajan dentro del proyecto.

### Flip

**Invertir símbolo**, en el menú de propiedades, pasa los dientes o los tics al
otro lado de la traza sin tener que redibujar la falla al revés — que es lo que
había que hacer antes cuando el bloque colgante quedaba del lado equivocado.

Se resuelve con dos capas por tipo, filtradas por el atributo `flip`, en vez de
con expresiones data-driven: espejar es cruzar la traza (`icon-offset` opuesto)
*y* girar 180°, y las dos cosas tienen que ir sincronizadas. Dos capas con
filtros mutuamente excluyentes son más fáciles de leer y de comprobar. En las
fallas de rumbo el flip no cambia el sentido del movimiento: para eso se cambia
el tipo de dextral a sinestral, que es un dato distinto, no una decisión de
dibujo.

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
2. Del resultado se conserva solo el **anillo exterior**: los huecos que queden
   se descartan.
3. Y se quitan los vértices colineales, que es lo que deja el borde común al
   desaparecer: una fila de nodos alineados que no aportan forma.

El paso 2 tiene un coste que conviene saber: si de verdad se querían unir dos
polígonos que **encierran un hueco real** —una ventana erosiva, un roof pendant
dentro de un plutón— ese hueco también se pierde. Para ese caso, unir y luego
recortar el hueco con **Cortar** da el resultado correcto.

Si las líneas **no se tocan**, no falla: se encadenan por sus extremos más
próximos, evaluando los cuatro emparejamientos posibles en cada paso e
invirtiendo o anteponiendo la pieza según convenga. El salto entre tramos queda
como un segmento recto, que es lo que uno dibujaría a mano para cerrar un
contacto partido. En polígonos disjuntos las piezas se guardan por separado,
porque el modelo de datos usa polígonos simples, no multiparte.

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

**Ver atributos.** Tocar un spot en modo **Navegar** abre un panel de solo
lectura con todos sus campos. Funciona por `queryRenderedFeatures` sobre las
capas de contenido (no las de etiqueta), y solo recibe el toque cuando ninguna
otra herramienta lo está reclamando — en la práctica, en Navegar, porque en
cualquier herramienta de dibujo o arrastre `DrawController` ya consume el
puntero antes de que llegue a MapLibre.

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

## Estado

- ✅ Basemaps, orden de capas y transparencia por capa.
- ✅ Curvas de nivel con intervalo por zoom.
- ✅ Línea y polígono vértice a vértice, trazo libre por long-press,
  simplificación Douglas-Peucker en píxeles y suavizado Chaikin.
- ✅ Tipos de línea por color, certeza por patrón.
- ✅ Cierre del elemento por doble toque, toque fuera, doble clic, clic derecho
  o Enter.
- ✅ Exportación a GeoPackage con `layer_styles` (QML + SLD).
- ✅ Importación de GeoPackage respetando la simbología QGIS.
- ✅ Snapping a vértice y segmento, y herramienta Trace.
- ✅ MBTiles y PMTiles, raster y vectorial.
- ✅ Selección por toque y por lazo rectangular; corte y unión con JSTS.
- ✅ Edición de vértices con edición topológica.
- ✅ Corte con una línea dibujada o con un elemento existente, sobre la selección.
- ✅ Unión de líneas no contiguas por sus extremos más próximos.
- ✅ Módulo de unidades geológicas, exportadas como `unit` y `code`.
- ✅ Menú de propiedades: unidad, certeza, opacidad, suavizado y borrado.
- ✅ Deshacer/rehacer con gestos de dos y tres dedos.
- ✅ Continuación de una línea existente desde su extremo más cercano.
- ✅ Ornamentos de falla: dientes, tics y medias flechas, con tamaño,
  espaciado y posición editables, y flip por elemento.
- ✅ Confirmación topológica: fusión de vértices y nodado, con tolerancia en metros.
- ✅ Modos de añadir y borrar vértices en la herramienta Nodos.
- ✅ Guardar y abrir proyectos (`.fdproj.json`).
- ✅ Autosave en localStorage y exportación a GeoJSON.
- ✅ PWA instalable: dependencias en `vendor/`, service worker con precache del
  app shell y caché de las teselas ya visitadas.
- ✅ StraboSpot: sesión, descarga de spots (Estructuras/Observación con la misma
  simbología que el plugin de QGIS), subida del dibujo como dataset nuevo, ver
  atributos, filtrar por tipo y tamaño de símbolo ajustable.
- 🚧 **Pendiente**: nodado automático de intersecciones al dibujar (hoy hay que
  pulsar **Topología**), subtipos por categoría, y descarga dirigida de un área
  de basemap para llevar al terreno (hoy se resuelve importando un PMTiles).

## Limitaciones conocidas del iPad

- Los iPad **solo-WiFi no tienen GPS**. Safari en iOS tampoco soporta Web
  Bluetooth, así que no se pueden usar receptores GNSS externos. Para terreno
  se necesita un iPad con celular.
- El doble-tap del Pencil 2 y el squeeze del Pencil Pro **no están expuestos**
  a la web. Presión e inclinación sí.
- La exportación usa `<a download>`, que en iPadOS guarda en Archivos.
