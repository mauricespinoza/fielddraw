# FieldDraw — mapeo geológico en tablet, PC y teléfono

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
for f in logic draw stroke gpkg snapping edit vertex topology project ornaments strabo reshape dem structure shortcuts scale hole attrs split adopt thickness section planeTrace; do node test/$f.test.mjs; done
```

1226 comprobaciones sin dependencias: simplificación, simbología, estilo, store,
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
la tabla de atajos de teclado y el hover del ratón, los gestos de cámara del
ratón y la caché del trazo libre —que es lo que evita convertir el mismo punto
una vez por frame—, conversión escala↔zoom en ambos sentidos, lectura y escritura de escalas, resta de áreas con JSTS
—incluido el hueco que se convierte en anillo interior— y las regresiones de
los tres cuelgues: el gesto que termina fuera del mapa, el toque cuyo
`pointerup` se pierde y la tesela del DEM que no contesta nunca; y el visor de
atributos: qué campos se enseñan de una capa importada y de dónde sale su
título; el corte de líneas, incluido el cruce oblicuo que estaba roto; la
traducción de una carta ajena a elementos del dibujo; y el espesor
estratigráfico con su incertidumbre; el manteo aparente contra los casos donde
la respuesta se sabe de antemano, las intersecciones del corte, y las cabeceras
del shapefile releídas byte a byte; y la traza de un plano sobre la topografía
contra terrenos sintéticos con solución cerrada —plano horizontal, ladera a lo
largo del rumbo, quebrada que obliga a la V, plano vertical donde `tan 90°` no
existe, y el caso degenerado en que el terreno **es** el plano medido y hay
infinitos cortes en vez de uno.

Lo que necesita navegador —`DOMParser` para el QML, el wasm de sql.js y JSTS—
vive en `test/browser.html`: ábrela con el servidor corriendo en
`http://localhost:5174/test/browser.html`. Cubre el round-trip completo
exportar→importar, QML real de QGIS, un MBTiles fabricado al vuelo, las
operaciones de corte y unión, y la validación de todas las capas generadas
contra el style-spec de MapLibre —incluidos los símbolos de rumbo y manteo y
sus dieciséis imágenes.

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

### Publicar una versión nueva

`sw.js` cachea el HTML en **red primero** —siempre pide la última— pero los
módulos y el CSS en **caché primero**, con un refresco de fondo que solo se
nota en la carga SIGUIENTE. Eso significa que el shell nuevo puede llegar a
ejecutarse con los módulos VIEJOS durante toda una sesión, y en una PWA de
pantalla de inicio esa sesión puede durar semanas.

Lo único que fuerza a un navegador a siquiera comprobar si hay una versión
nueva es que **los bytes de `sw.js` cambien**: el registro compara el script
byte a byte, y si es idéntico al que ya tiene instalado, ni se molesta en
volver a pedir la lista de archivos. Por eso `sw.js` empieza con

```js
const VERSION = 'v13';
```

y **subir ese número es obligatorio en cada publicación que toque algo bajo
`src/` o `index.html`** — no opcional, no "si acaso": es lo único que le dice
al navegador que hay algo que traer. Publicar sin subirlo dejó una sesión
entera corriendo `mapView.js` y `ui.js` de dos versiones atrás contra un
`index.html` nuevo, con el resultado previsible de una app que en apariencia
"no hace nada": el HTML ya no tenía el elemento que el JS viejo buscaba.

Al añadir un archivo a `src/` también hay que sumarlo a la lista `SHELL` de
`sw.js`, o ese archivo nunca queda precacheado y falla en cuanto no hay señal.

Subida la versión, quien ya tenía la app abierta la recibe solo: `sw.js` toma
el control con `skipWaiting` + `clients.claim`, y `app.js` escucha
`controllerchange` y recarga la página una vez —comprobando que YA hubiera un
controlador antes de registrar, para no recargar de más en la primera visita,
donde no hace ninguna falta—.

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
| Guardar el perfil como figura (PNG/SVG) | ✅ se dibuja en el propio navegador |

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

#### Un solo icono para todo

El icono de la pestaña, el del manifest, el de *apple-touch-icon* y el que se
ve DENTRO de la app —arriba a la izquierda, junto al nombre— son el mismo
dibujo: un lápiz trazando una línea sobre una tablet, que es literalmente lo
que hace la app.

Antes eran dos. Los archivos de `icons/` traían un contacto turquesa con una
falla inversa, y la franja de la app llevaba su propio dibujo aparte: quien
instalaba la app veía un icono en el lanzador y otro al abrirla, y la pestaña
no se parecía a ninguno de los dos. Ahora manda el de la franja, que es el que
uno asocia con la app porque lo tiene delante todo el rato.

Vive en tres sitios, con las MISMAS coordenadas sobre una rejilla de 24×24:

| Archivo | Para qué | Cómo |
| --- | --- | --- |
| `index.html` → `svg.brand-logo` | la franja de la app | a mano |
| `icons/favicon.svg` | la pestaña del navegador | a mano, el mismo SVG |
| `icons/icon-180/192/512.png` | instalación y pantalla de inicio | `node tools/make-icons.mjs` |

El favicon va en vector y no como el PNG incrustado que había antes: a 16 px,
que es donde de verdad se mira, el navegador lo rasteriza a ese tamaño en vez
de reducir una imagen de 192. Los PNG salen del rasterizador propio de
`tools/make-icons.mjs` —no hay dependencias: se pinta el buffer RGBA a mano y
se empaqueta con el zlib de Node—, que trae las mismas coordenadas del SVG.
Cambiar el dibujo obliga a tocar los tres y volver a correr el generador.

## Modelo de interacción

| Acción | Gesto |
|---|---|
| Añadir vértice | toque |
| Trazo libre | mantener presionado ~0,3 s y arrastrar |
| Cerrar elemento | doble toque · toque con el dedo fuera del trazo · doble clic · clic derecho · Enter · botón **Listo** |
| Deshacer vértice | Retroceso, o botón **Deshacer** |
| Cancelar elemento | Esc, o botón **Descartar** |
| Navegar | dos dedos (siempre), o herramienta **Navegar** |
| Seleccionar | un toque con el dedo o un clic, **en cualquier herramienta**: uno a la vez |
| Seleccionar varios | `Shift` + clic sobre cada uno (PC) |
| Propiedades | **clic derecho**, o mantener pulsado ~1 s (dedo, ratón o lápiz), en cualquier herramienta y en 2D o 3D |
| Atributos de una capa importada | mantener pulsado ~1 s donde no haya dibujo propio |
| Cerrar la edición | tocar con el dedo fuera del trazo; también cierra paneles y menús |
| Deshacer | doble toque con **dos dedos** |
| Rehacer | doble toque con **tres dedos** |
| Continuar una línea | seleccionarla y pulsar `L` o **Línea**; o **Continue line** en el menú de propiedades |
| Editar nodos | seleccionar y pulsar **Edit nodes** en el menú de propiedades; o la herramienta **Edit Nodes** (`N`) |
| Mover un vértice | **Edit Nodes**, modo *Mover*, y arrastrar la manija |
| Insertar un vértice | **Edit Nodes** → *Añadir*, y tocar el borde; o arrastrar un punto medio |
| Borrar un vértice | **Edit Nodes** → *Borrar*, y tocar la manija; o doble toque en modo *Mover* |
| Cortar | seleccionar, luego **Cortar**: dibujar la línea, o tocar otro elemento |
| Unir | seleccionar dos o más y pulsar **Unir** |
| Compartir vértices | **Topología** (sobre la selección, o sobre todo el dibujo) |
| Redibujar un contorno | seleccionar, luego **Reshape**: trazar una línea que entre y salga |
| Quitar un área interior | **Hole**: dibujar el contorno de lo que sobra dentro del polígono |
| Editar una capa importada | botón **✎** de esa capa, en el panel de Capas |
| Espesor estratigráfico | seleccionar un dip, **Measure thickness from here**, y tocar la otra superficie |
| Quitar el dibujo del espesor | cerrar su aviso: la línea punteada y el punto auxiliar se van con él |
| Traza de un plano sobre el terreno | seleccionar un dip, **Retrieve trace from DEM intersection**, y decir cuántos km a cada lado |
| Perfil estructural | trazar un perfil y pulsar **Structural section** (con dips elegidos con el lazo, si se quieren solo esos) |
| Perfil topográfico | **Perfil** y trazar la línea; o seleccionar una línea y usar el menú de propiedades |
| Rumbo y manteo | **Dip**: un toque (brújula), tres toques (tres puntos) o trazar a lo largo del afloramiento |
| Relieve 3D | botón **3D**; Línea y Polígono siguen dibujando sobre él |
| Fijar la escala | botón **Scale** de la barra, píldora `1:…` abajo a la izquierda, o `K` |
| Decirle cuánto mide la pantalla | en el mismo panel: **This screen** |
| Ir a mi posición | botón **Locate** |
| Rotular los polígonos con su código | casilla en el panel de **Unidades** |
| Exportar la vista como lámina | **Proyecto → Export the map view…** (SVG, PNG o PDF) |

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

### Por qué el toque no puede colgar del `click` del navegador

En **Navegar** y en **Elegir** la selección iba por el evento `click` de
MapLibre, y ahí «en la tablet a veces no selecciona» tenía una causa exacta: ese
evento no es del programa. Lo **sintetiza el navegador** a partir del toque, y
solo si el dedo se movió menos que su propio umbral, que ronda los diez píxeles.
Medido en Chromium, un dedo que se corre doce píxeles no produce `click`
ninguno: ni se selecciona lo que hay debajo ni se deselecciona tocando afuera, y
no hay nada en pantalla que diga por qué. Doce píxeles es un dedo normal en una
tablet que se sujeta con la otra mano. Con el lápiz es peor todavía: MapLibre da
el gesto por arrastre a los **tres** píxeles.

El controlador de dibujo ya medía los toques sobre los eventos de puntero, con
umbrales pensados para un dedo —14 px y 900 ms— pero solo los atendía mientras
se estaba dibujando. Ahora los atiende siempre, y el lápiz entra por la misma
puerta que el dedo. El ratón se queda con el `click` del navegador: en
escritorio llega siempre, y duplicar el camino abriría dos veces el mismo
recuadro. El `click` tardío que el navegador sintetiza detrás de un toque ya
atendido se ignora durante medio segundo.

Seleccionar y deseleccionar comparten una sola función (`selectAt` en
`mapView.js`), para que el clic y el toque no puedan discrepar sobre qué hay
debajo.

Dos detalles del reconocimiento de gestos que cuestan de encontrar y que
explican fallos que parecen aleatorios:

- El gesto multitáctil cuenta **dedos, no punteros**. El Pencil apoyado es un
  puntero más, así que contarlo hacía que cualquier toque del dedo con el lápiz
  en la pantalla se descartara por parecer un gesto a dos manos: el dedo no
  seleccionaba, no cerraba y no abría el menú, justo en la situación en la que
  más se usa.
- En **Edit Nodes** el dedo sí se consume, aunque haya Pencil: sin eso no hay forma
  de agarrar una manija con el dedo. El precio es que ahí el paneo con un dedo
  no está disponible; se navega con dos, como en el resto de la app. **Elegir**
  ya no consume nada (ver abajo).

### Elegir no dibuja: señala

**Elegir** dejó de quedarse el puntero. Antes lo consumía para arrastrar un
lazo rectangular, y eso traía tres consecuencias que no se ven hasta que se usa
con ratón: arrastrar no desplazaba el mapa, el clic derecho no abría el menú
—el controlador lo interpretaba como «cerrar el elemento», y en Elegir no hay
ninguno— y cada clic **alternaba** la selección, de modo que señalar el segundo
contacto dejaba los dos marcados sin haberlo pedido.

Ahora:

- **Un clic selecciona uno**, y reemplaza lo que hubiera.
- **`Shift` + clic** alterna, que es como selecciona cualquier escritorio. Con
  varios marcados, el clic derecho abre el menú de propiedades de **todos**: es
  como se le cambia la certeza, la unidad o el tipo a media docena de una vez.
- **Arrastrar desplaza el mapa**, igual que en Navegar.
- **Clic derecho** abre el menú de lo que haya debajo. Si lo de debajo no está
  en la selección, manda lo señalado; si sí está, el menú es de la selección
  entera.

Con el dedo no hay `Shift`, así que en tablet la selección múltiple se arma
desde `Ctrl+A` o desde el propio menú; el toque limpio sigue seleccionando uno
y la pulsación sostenida sigue abriendo el menú.

### El clic derecho se decide al SOLTAR, no en el evento `contextmenu`

En PC el menú de propiedades salía unas veces sí y otras no. La causa de
fondo es que `contextmenu` no sirve para lo que se estaba usando. Medido en
Chrome 141, el orden real de un arrastre con el botón derecho es:

```
pointerdown → contextmenu → pointermove ×N → pointerup
```

El `contextmenu` llega **pegado al `pointerdown`, antes del primer
movimiento**. Cuando llega todavía no ha pasado nada, así que desde ahí es
imposible saber si el gesto va a ser un clic —y toca abrir el menú— o un giro
de cámara —y no toca nada—. Otros navegadores lo emiten al soltar, y ahí el
problema es el contrario: llega después de que el `pointerup` ya haya hecho su
trabajo. Cualquier cosa colgada de ese evento depende del navegador.

Encima había otras dos averías propias:

1. **Con una herramienta activa el clic derecho ni se planteaba abrir el
   menú.** `onContextMenu` miraba la HERRAMIENTA: con cualquiera que no fuera
   Navegar o Elegir, el botón derecho significaba «cerrar el elemento» y ahí
   se acababa, hubiera o no algo que cerrar. Con una línea seleccionada y
   **Edit Nodes** en la mano —justo cuando uno quiere el menú— no pasaba nada.
2. **Y además ponía un vértice.** `DrawController` se quedaba el `pointerdown`
   del botón derecho igual que el del izquierdo y arrancaba un gesto; el gesto
   seguía su curso y al soltar terminaba en `onVertex()`.

Lo que hay ahora:

- El botón secundario se aparta del camino del dibujo en el `pointerdown` y se
  sigue aparte (`this.secondary`). No se anula el evento, que es lo que
  mantiene el giro y el basculado con el botón derecho —los hace MapLibre.
- **La decisión se toma en el `pointerup`**, que es el único momento en que
  consta si el puntero se quedó quieto o recorrió la pantalla. Llega siempre,
  se suelte donde se suelte, porque ese manejador cuelga de la ventana y no
  del mapa. `contextmenu` queda reducido a lo único que sabe hacer bien:
  suprimir el menú nativo del navegador. Si llega sin un `pointerdown` detrás
  —la tecla Menú, Shift+F10— se atiende en el acto, que para eso no hay
  arrastre que esperar.
- **El umbral de movimiento del botón derecho son 26 px**, no los 10 px del
  arrastre normal. Al otro lado está girar la vista, que es un gesto largo y
  deliberado; un clic, en cambio, se corre solo — un ratón sensible en una
  pantalla 4K recorre más de diez píxeles mientras se aprieta el botón, y con
  el listón bajo el menú se perdía sin decir nada.
- Qué SIGNIFICA lo decide `mapView` mirando si hay un elemento **a medio
  trazar**, no qué herramienta está activa: con borrador lo cierra, como en
  QGIS; sin borrador no hay nada que cerrar y abre el menú.
- Sobre el mapa, `ui.js` ya no cierra paneles en el `contextmenu`: solo
  suprime el menú nativo. El `pointerdown` que lo precede ya cerró lo que
  hubiera abierto, y en un navegador que emita el `contextmenu` al soltar
  cerraría el menú que el `pointerup` acaba de abrir.

#### El «Guardar imagen como…» de Chrome, y por qué solo salía sobre los elementos

Quedaba un resto del mismo problema, y era el más desconcertante: al hacer
clic derecho sobre una línea o una medida —nunca sobre el mapa vacío— Chrome
abría SU menú, el del lienzo, con «Guardar imagen como…». La causa es una
diferencia de plataforma que no se ve desde Linux:

- En **Linux y macOS**, Chrome emite el `contextmenu` con el `mousedown`.
- En **Windows** lo emite al SOLTAR, después del `pointerup`.

Y en el `pointerup` es donde se abre el menú de propiedades. Así que en
Windows, cuando llegaba el `contextmenu`, lo que había bajo el puntero ya no
era el mapa: era **el propio menú**, que no cuelga de `map-host`. El manejador
de `ui.js` se iba por la rama de «esto viene de fuera del mapa», cerraba el
menú recién abierto y dejaba pasar el evento; el navegador, al construir el
suyo con el nuestro ya oculto, encontraba el lienzo debajo y ofrecía guardar
la imagen. Sobre el mapa vacío no pasaba nada de esto, porque ahí no se abre
ningún menú que se interponga.

Dos cambios, y hacen falta los dos:

1. **El menú nativo no aparece sobre la aplicación**, punto: ni sobre el mapa
   ni sobre lo que la aplicación pone encima. Ya no se pregunta de qué parte
   vino el evento. La única excepción son los campos de texto, donde el clic
   derecho es para copiar y pegar y no hay nada nuestro que ofrecer. De paso
   se quitó el `closeOverlays()` de ese manejador: cerrar ahí no hacía falta
   —el `pointerdown` ya cierra lo que hubiera abierto— y era justo lo que se
   llevaba por delante el menú del elemento.
2. **El menú ya no se coloca encima del cursor.** Se centraba sobre el toque y
   se bajaba 18 px, pero con el menú completo (320×460 px) eso lo dejaba sobre
   el puntero en cuanto no cabía hacia abajo y había que subirlo. Ahora se
   prueban las cuatro esquinas alrededor del cursor, empezando por abajo a la
   derecha; si ninguna cabe entera, se pega arriba y se aparta al lado con más
   sitio. Además de quitarle el suelo al problema anterior, evita que el
   siguiente clic —que uno suelta sin mirar— caiga sobre un botón del menú.

#### Mantener pulsado el botón primario también abre el menú

Como **redundancia** del clic derecho: si un navegador, un trackpad o una
configuración rara se lo comen, mantener el botón primario un segundo sobre
un elemento abre el mismo menú. No depende de ningún evento del sistema, solo
de que el puntero siga abajo y quieto. Es el gesto que el dedo ya tenía en
tablet, ahora también con ratón y con lápiz.

Se cede el paso donde ya había un gesto ocupando el sostenido:

- Con el **trazo libre por sostenido** (`hold`, que es lo de fábrica) en
  Línea y Polígono, a los 320 ms arranca el trazo y a partir de ahí se está
  dibujando: el menú no aparece a mitad del trazo. Con el trazo libre en
  `drag` o apagado, el sostenido sí abre el menú.
- En **Edit Nodes** el sostenido ya existía, del mismo segundo, montado sobre
  el arrastre de la manija.

Soltar después de un sostenido que abrió el menú **no deja un vértice**: sin
eso, consultar los atributos de un contacto sin salir de la herramienta Línea
dejaba un vértice suelto donde se consultó.

#### El radio de acierto: 16 px no bastan para una línea de dos

Lo otro que hacía que el clic derecho pareciera ir a ratos no era el evento
sino la puntería. Un contacto se dibuja con dos píxeles de ancho, y el radio
de selección de siempre —16 px— está pensado para el clic izquierdo, donde
fallar no cuesta nada: no pasa nada y se vuelve a hacer clic. En el clic
derecho fallar significa que el menú no sale, o peor, que sale el de la
selección anterior y parece que el programa hubiera entendido mal.

El menú busca ahora en **dos pasadas**: primero con el radio fino, para que
donde hay dos contactos juntos gane el que se está apuntando de verdad, y solo
si esa no encuentra nada, con `MENU_PICK_PX` = 30 px. Vale para las tres capas
—dibujo propio, spots de StraboSpot y capas importadas— y también para la
pulsación sostenida con el dedo, que entra por la misma puerta y agradece
todavía más el margen.

Comprobado en un Chromium de verdad, con la app corriendo, una línea dibujada
y una medida puesta: el clic derecho encima abre el menú; a 24 px del trazo
también, y seleccionando la línea; a 52 px no inventa nada; con **Edit Nodes**
activa abre el menú y no añade ningún vértice; un temblor de 15 px sigue
contando como clic; un arrastre de 175 px gira la vista sin abrir nada; y con
un elemento a medio trazar lo cierra en vez de abrir el menú. Lo mismo con el
relieve 3D puesto.

Y reproduciendo el orden de eventos de Windows —`contextmenu` después del
`pointerup`— sobre la línea y sobre la medida: el menú se abre, no tapa el
cursor, el menú nativo queda suprimido y el nuestro sigue abierto. En un
`<input>`, el del navegador sigue apareciendo.

## Escala de trabajo

Un mapa web se navega por **nivel de zoom**, que no significa nada
cartográficamente: z14 no es una escala, es una potencia de dos. Al levantar
geología eso no sirve. Cuánto detalle tiene sentido meter en un contacto, qué se
generaliza y qué no, depende de la escala de trabajo; y una memoria o una carta
se entrega **a** una escala. Un mapa levantado deslizando el zoom libremente sale
con el detalle repartido a capricho: un tramo digitalizado a 1:5.000 junto a otro
a 1:60.000, y ninguno de los dos es el mapa que se declaró.

Hay dos puertas al mismo panel (`K`): el botón **Scale** de la barra de
herramientas, que es donde se busca cuando lo que se quiere es fijar la escala
antes de empezar, y la píldora de abajo a la izquierda —justo bajo la barra
gráfica de MapLibre—, que además muestra la escala vigente. Dentro:

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
comunicarse. Es el valor de fábrica, y hay razones para dejarlo puesto.

#### Decirle a la app cuánto mide esta pantalla

El panel de la escala tiene una sección **This screen** para el caso contrario:
que el mapa mida lo que dice cuando se le pone una regla encima. Lo primero que
hace es enseñar lo que el dispositivo **sí** cuenta de sí mismo —la resolución en
píxeles CSS y cuántos píxeles del panel hay detrás de cada uno, `devicePixelRatio`—
porque esa parte no hay que preguntarla.

Lo que no cuenta ningún navegador, y no hay API que lo dé, es cuántos centímetros
mide el vidrio. Dos pantallas de 1920 × 1080, una de 13" y otra de 27", son
indistinguibles desde JavaScript y su píxel mide menos de la mitad en la primera.
Así que se pregunta **una sola cosa**, la diagonal, y de ahí sale todo:

    mm por píxel = diagonal en mm / diagonal en píxeles

porque los píxeles son cuadrados y la diagonal en píxeles sale de Pitágoras sobre
la resolución, que sí se lee. No hace falta el ancho ni la proporción. Hay tres
maneras de dársela, de la más cómoda a la más exacta:

1. **Una lista de tamaños estándar** —de 7,9" a 32", con el aparato típico al
   lado, porque nadie sabe de memoria la diagonal de su tablet pero todos saben
   cuál tienen—. Son diagonales y no resoluciones a propósito: la resolución ya
   se leyó del dispositivo, y un 15,6" es un 15,6" tenga la que tenga.
2. **La diagonal escrita a mano**, para lo que no esté en la lista.
3. **La barra de calibración**, que es la única que no se fía de la diagonal
   declarada: la barra dice cuántos milímetros mide con el píxel configurado, se
   le pone una regla de verdad encima y se escribe lo que marca. Es tan ancha
   como permite el panel para que un milímetro mal leído pese menos del uno por
   ciento.

Ejemplos, para ver que las cifras son las de las fichas técnicas y no las de la
propia fórmula: un portátil de 15,6" a 1920 × 1080 da 141 ppp, o sea 0,180 mm; un
iPad Pro de 11" da 264 ppp físicos y, como el navegador entrega píxeles CSS a 2×,
0,192 mm.

Las dos opciones son legítimas y excluyentes, y por eso el panel lo dice en voz
alta: **con 0,28 mm** el 1:25.000 de aquí es el 1:25.000 de QGIS, comparable
entre herramientas pero no medible con una regla; **con el tamaño real** el mapa
mide lo que dice y deja de coincidir con QGIS. Lo que importe para el trabajo.

#### Cómo se mide la escala, y qué pasa con el relieve

En planta la escala se **mide sobre el propio mapa** —dos puntos separados cien
píxeles y cuánto terreno hay entre ellos— en vez de despejarla del nivel de zoom.
Así no depende de la convención interna de MapLibre (teselas de 512 px, no de
256; usar la equivocada da un factor 2 de error).

Con el relieve 3D puesto esa vía deja de valer, y no es un detalle. `unproject`
con `setTerrain` activo devuelve el punto del **suelo**, no el del plano: sobre
una ladera, dos píxeles contiguos pueden estar a mucha más distancia en el
terreno que en el mapa. Lo medido pasa a ser el largo de la pendiente, y la
escala cartográfica es plana por definición. Eso rompía dos cosas a la vez: la
lectura saltaba al pasar sobre un cerro, y con la escala **fijada** el mapa se
descontrolaba —la corrección de `moveend` perseguía un número que ya no dependía
del zoom como 2⁻ᶻ, volvía a saltar, y en dos o tres rebotes el zoom se iba contra
su tope y ahí se quedaba clavado, con la rueda y el pellizco apagados por el
propio candado y sin manera de salir. Era el *"se queda pegado"*.

Con relieve se usa la fórmula del zoom, que es plana por construcción, corregida
por un factor aprendido en planta —donde las dos vías valen— para no tener que
suponer nada sobre el tamaño de tesela. Y la corrección de `moveend` lleva
candado contra la reentrada, porque `jumpTo` dispara `moveend` en el acto y de
forma síncrona: la corrección se estaba llamando a sí misma desde dentro de sí
misma.

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
| `N` | Edit Nodes — arrastrar los vértices de un elemento |
| `X` | Cortar |
| `R` | Reshape |
| `D` | Rumbo y manteo |
| `F` | Perfil topográfico |
| `S` · `T` | Snap · Follow trace |
| `C` | Rotar la certeza: observado → inferido → cubierto |
| `3` | Relieve 3D (Línea y Polígono siguen dibujando) |
| `G` | Centrar en mi posición |
| `M` · `Y` | Unir · Topología |
| `↑ ↓ ← →` | Mover la vista, sin soltar la herramienta |
| `Shift` + `↑ ↓ ← →` | Girar y bascular |
| `Shift` + clic | Añadir o quitar de la selección |
| `+` · `−` · `0` | Acercar · alejar · volver al norte y a la planta |
| `↵` · `⌫` | Cerrar el elemento · deshacer el último vértice |
| `Esc` | En cascada: cierra panel → descarta el elemento → vacía la selección → vuelve a Navegar |
| `Del` | Borrar lo seleccionado |
| `Ctrl+Z` · `Ctrl+Shift+Z` | Deshacer · rehacer |
| `Ctrl+A` | Seleccionar todo |
| `Shift+L` · `Shift+U` · `Shift+Y` · `Shift+B` | Capas · Unidades · Símbolos · StraboSpot |
| `K` | Escala de trabajo: elegir, fijar y calibrar la pantalla |
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

## La barra de herramientas no recorta: envuelve

Con veinte herramientas, la columna de la izquierda mide unos 1200 px de alto.
En una **tablet apaisada** —que es como se sujeta en terreno— el sitio
disponible son unos 700, y la barra llevaba `overflow-y: auto` con la barra de
desplazamiento escondida por CSS. El resultado, medido en iPad, iPad Air e iPad
Pro: **Escala, GPS, Hecho, Cancelar y Borrar quedaban debajo del borde**, sin
nada en pantalla que anunciara que la tira seguía.

Eso explica un síntoma que parecía otra cosa: «la herramienta Escala no abre al
tocarla». No es que no abriera; es que el botón no estaba donde se estaba
tocando. El mismo recorte pasaba en un monitor de 1080 px de alto.

Ahora la barra **envuelve en columnas**: se ensancha lo justo para que todas las
herramientas estén a la vista y a un toque. Un desplazamiento oculto no es una
alternativa — no se descubre. Como su ancho dejó de ser una constante, lo
publica en `--toolbar-w` y lo que cuelga a su derecha (la marca de la app) lo
lee de ahí y se retira cuando, medido, ya no cabe entre la barra y la fila de
botones de arriba.

## En un teléfono

La disposición de la app —barra de herramientas en columna a la izquierda,
paleta en otra columna a su lado, fila de botones arriba a la derecha— da por
hecha una pantalla grande. En un iPad y en un PC sobra sitio; en un teléfono no
hay ninguno de los dos supuestos:

- **En vertical falta ancho.** En 390 px, las dos columnas se llevan más de la
  mitad de la pantalla, y encima el borde izquierdo, que es por donde entra la
  mano a dibujar. La fila de nueve píldoras envuelve en tres líneas y se come
  otro tercio.
- **En apaisado falta alto.** Con 390 px de alto, la columna de veinte
  herramientas ni siquiera cabe: hay que desplazarla para llegar a **Perfil** o
  a **3D**.

Los dos casos se arreglan igual, y es la disposición de cualquier app de mapa
en un móvil: **los bordes de arriba y de abajo para los controles y todo el
centro para el mapa**.

    ┌─────────────────────────────────────┐
    │ Project  Layers  Units  Symbols  …  │   opciones      (se desliza)
    │                                     │
    │                MAPA                 │
    │                                     │
    │ Tap for the first vertex · press…   │   estado
    │ ↶ ↷ ✋ ╱ ⬠ ⬡ ∠ ▷ …                  │   herramientas  (se desliza)
    └─────────────────────────────────────┘

Todo lo de arriba y de abajo se **desliza** en vez de envolver: nueve píldoras
en tres filas tapan un tercio del mapa de forma **permanente**, mientras que
una sola fila que se arrastra solo cuesta el gesto de ir a buscarlas cuando
hacen falta.

Dentro de la misma tira de herramientas, al principio, van **deshacer y
rehacer del dibujo**. No existían: la barra ya trae un `Undo` que retira el
último **vértice** del trazo en curso y que está apagado el resto del tiempo, y
el deshacer del dibujo entero solo se alcanzaba con `Ctrl+Z` —que un teléfono
no tiene— o con el doble toque de dos dedos, que nadie descubre solo. Convertir
una línea en polígono y arrepentirse no tenía salida. Van ahí y no sueltos
sobre el mapa: la barra ya es el sitio al que se viene a buscar un control de
dibujo, y en tablet y PC —donde el atajo y el gesto ya alcanzan— se quedan
escondidos, sin ocupar el sitio de una herramienta.

La paleta cambia de sitio según qué escasee, que es lo único que no es
simétrico entre las dos orientaciones. En vertical sobra alto: va de hoja al
pie, con los grupos uno al lado del otro y un tope de 34 dvh —por encima de
eso, elegir el tipo de contacto dejaba sin sitio para dibujarlo—. En apaisado
sobra ancho: vuelve a ser la columna de 106 px de siempre, que en un móvil
tumbado es un 12 % de la pantalla, encajada entre la fila de arriba y la tira
de abajo.

Los iconos de la tira bajan de 24 a 19 px y los rótulos desaparecen del todo
por debajo de 520 px de alto: el icono ya identifica cada herramienta, el
`title` sigue ahí para el que dude, y con veinte botones esos pocos píxeles por
botón se notan sumados. Lo que se retira entero es el **diagnóstico del lápiz**
—presión, inclinación, altitud—, que es una ayuda para calibrar el Pencil y no
algo que se consulte en terreno, y la **marca** de la esquina, que ya se
escondía por debajo de 900 px.

Dos detalles que no se ven pero se notan:

- Los altos van medidos en **`dvh`, no en `vh`**. En un navegador móvil `100vh`
  es la ventana con la barra de direcciones retraída, que no es la que se ve al
  abrir: un panel calculado con `vh` nace más alto que la pantalla y deja su
  último botón fuera. La línea de `vh` se queda debajo como reserva para
  navegadores que no entiendan `dvh`.
- Los campos de texto pasan a **16 px**. iOS hace zoom solo al enfocar un campo
  de menos de 16 px y después deja el mapa desencuadrado sin que nada lo
  devuelva a su sitio.

Los umbrales —680 px de ancho, 520 px de alto— son de tamaño, no de aparato:
una ventana estrecha o baja en el PC recibe exactamente la misma disposición,
que es justamente donde sale barato probarla. Todo está en un solo sitio, al
final de `src/styles/app.css`, en tres bloques: **estrecho o bajo** (los
controles a los bordes), **estrecho** (paneles a ancho completo) y **bajo**
(sin rótulos).

### De paso

Dos fallos que solo se vieron al medir la pantalla entera y que no eran del
teléfono:

- **Ajustes no tenía tope de alto.** Es la lista más larga de la app y no cabe
  entera ni en el iPad en vertical: todo lo que va de *Origen de cotas* hacia
  abajo —incluido el botón de borrar el dibujo— quedaba fuera de la pantalla,
  sin barra de desplazamiento ni forma de llegar. Ahora los desplegables y
  Ajustes se topan contra la ventana y se desplazan.
- **La marca tapaba la fila de certeza.** El logotipo de la esquina empieza en
  los mismos 92 px y a la misma altura que la columna de la paleta, así que
  *Observado / Inferido / Cubierto* quedaba debajo del logo, visible a medias y
  sin poder pulsarse. Con la paleta abierta la marca se retira: una es un
  crédito y la otra decide cómo se dibuja la siguiente línea.

Y una tercera, de la misma medición: en la columna de 106 px la muestra del
trazo se llevaba 40 px y al nombre le quedaban 24, así que **Normal** se
dibujaba como *Norma*, cortado a media palabra y sin nada que avisara de que
faltaba texto. La muestra baja a 24 px y lo que aun así no quepa se corta con
puntos suspensivos.

Un cuarto, que no era de disposición sino de alcance: **no había forma de
deshacer sin teclado**. Está en la barra, con los botones nuevos. El deshacer
en sí estaba bien —convertir una línea en polígono y volver atrás devuelve la
línea con su geometría, su id y sus atributos intactos, y está cubierto en
`test/edit.test.mjs`—; lo que faltaba era poder pedirlo.
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

## Snapping y Follow trace

- **Snap** engancha a vértices y segmentos de todo lo visible: tu propio dibujo
  y las capas importadas. El vértice tiene prioridad sobre el segmento, como en
  QGIS. El marcador magenta muestra a qué se va a enganchar; es cuadrado sobre
  un vértice y una cruz sobre un segmento. El radio es configurable (4–32 px).
- **Follow trace** hace que el nuevo elemento siga el borde de uno existente:
  tocas un punto sobre otra geometría y el trazo recorre el camino más corto por su
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

### Guardar la traza como figura

Además del **CSV** con las cotas muestreadas, la hoja del perfil saca la
visualización en **PNG** y en **SVG**.

Lo que se guarda **no** es el SVG que está en pantalla, y el motivo es doble: ese
va con `preserveAspectRatio="none"` —se estira al alto que tenga la hoja, así que
fuera de su caja saldría deformado— y se pinta con clases de `app.css`, que en un
archivo suelto no existen; el resultado sería un gráfico sin color ni ejes. La
figura se vuelve a dibujar a 1200 × 560 con los estilos escritos en cada
elemento, así que se abre igual en Illustrator, en un navegador o dentro de un
Word. El PNG sale del mismo SVG, a 2×, de modo que las dos salidas no pueden
desalinearse.

La figura lleva lo que un informe necesita y un panel no: los **rótulos de los
extremos** con la letra del cuadrante hacia el que mira la traza —un perfil se
cita por sus extremos—, el resumen de longitud, cotas y desniveles, la
procedencia del dato con su resolución nominal, y la **exageración vertical**.

Esa última es la que la vuelve publicable. Un perfil dibujado para que quepa en
un recuadro casi nunca está a 1:1: unos kilómetros a lo largo contra unos
cientos de metros de desnivel dan, en un gráfico apaisado, factores de diez o de
veinte. En pantalla da igual, porque se lee la curva; en cuanto la figura sale a
un informe alguien va a medir un ángulo sobre ella, y rotularlo es la diferencia
entre una figura y una figura engañosa.

Sale en claro aunque la app se vea en oscuro: una figura guardada termina en un
informe, en una diapositiva o pegada en un Word, y ahí el fondo es blanco. Quien
la quiera oscura tiene el SVG, donde cambiar dos colores es trivial.

## Perfil estructural

El perfil topográfico dice por dónde va el terreno. El **estructural** añade lo
único que permite interpretarlo: con qué inclinación entra cada capa en el plano
del corte y dónde lo cruza cada contacto o falla. Se abre desde la hoja del
perfil, con el botón **Structural section**, y usa **esa misma traza**: la
topografía del corte y la del perfil tienen que ser la misma línea, y volver a
muestrear el DEM sería pedirle a la red lo que ya se tiene.

### Manteo aparente, que es de lo que va todo

Sobre un corte oblicuo, la inclinación que se ve **no** es el manteo medido:

    tan(δ_ap) = tan(δ) · cos(az_sección − dirección_de_manteo)

Es siempre menor que el real y se hace **cero** cuando el corte va a lo largo del
rumbo. Dibujar el manteo real sobre un corte oblicuo es el error clásico y
produce secciones que no cierran. Se usa el coseno **con signo** metido directo
en `atan`, de modo que salen a la vez la magnitud y hacia qué lado cae la capa;
es la misma fórmula, convención y signo que `core/apparent_dip.py` del plugin
**Structural Modeller**, para que una sección hecha aquí y otra hecha allá sobre
los mismos datos den lo mismo.

Una traza quebrada tiene **un azimut por tramo**, y el aparente de cada medida se
calcula con el del tramo donde cae. Usar el azimut medio daría un aparente
equivocado justo en las esquinas, que es donde el corte se quiebra porque cambia
la estructura.

### Qué se proyecta

- **Con selección** (el lazo de **Elegir**), las medidas seleccionadas y sin
  límite de distancia: quien eligió ya decidió qué le interesa.
- **Sin selección**, todas las que caigan a menos de 2 km del corte. Proyectar un
  manteo tomado a veinte kilómetros no es un dato, es un adorno que además
  desplaza la interpretación.

Cada medida lleva al lado **cuánto se estiró** su proyección, que es el dato
honesto: una medida a dos kilómetros del corte, dibujada sobre él, es una
extrapolación y quien mire la figura tiene derecho a saberlo. Las que quedan muy
achatadas —el corte casi paralelo a su rumbo— se dibujan **pálidas**: su aparente
ya no dice nada de la estructura, y verlo apagado evita interpretar una capa
horizontal donde lo que hay es una capa vista de canto.

Los ticks se dibujan con el ángulo que se **ve**, no con el aparente puro: la
exageración vertical deforma la geometría del corte y un tick al ángulo verdadero
quedaría descolgado de las capas dibujadas a su lado. El rótulo sí lleva el
aparente real.

### Intersecciones

Dónde corta el perfil a cada línea del dibujo, marcadas por omisión y
apagables una a una o en bloque. Un contacto plegado cruza el perfil en cada
charnela, y esas repeticiones son el dato, no un problema. El borde de un
polígono también cuenta: es donde está el contacto.

### Salidas

| Formato | Para qué |
|---|---|
| **SVG** | la figura, editable en Illustrator o Inkscape |
| **PNG** | rasterizado del mismo SVG al doble del tamaño en pantalla |
| **SHP 3D** | un ZIP con dos shapefiles para **Structural Modeller** |
| **Sketcher** | proyecto `.sketcher.json` para **StructuralSketcher** |

El **shapefile 3D** son dos capas dentro del mismo ZIP, porque el importador de
secciones del plugin solo lee líneas y los manteos son puntos:

- `…_lines`: `PolylineZ` con la topografía y una **semilla vertical** de 250 m
  por cada intersección marcada. Una semilla dice dónde corta la falla, no cómo
  sigue en profundidad; un tramo largo estaría afirmando una geometría que nadie
  midió. El campo `Type` lleva el tipo de FieldDraw tal cual —`thrust-fault` ya
  contiene `fault`— que es justo de lo que el plugin deduce la clase.
- `…_dips`: `PointZ` con `Strike`, `Dip`, `AppDip`, el azimut de la sección y el
  `Offset` de la proyección.

El **proyecto del Sketcher** es su documento `{app, version, section}` con las
líneas ya en coordenadas de sección `[s, z]` y los manteos como `{s, z, dip}`,
donde `dip` es el aparente convertido a su convención de edición: magnitud de 0 a
180 en sentido horario desde la horizontal, con el signo negativo marcando capa
invertida. Sin esa conversión, una capa que mantea al oeste llegaría dibujada al
este. La etiqueta de cada manteo conserva el rumbo y manteo **reales**.

Los dos formatos se comprobaron contra las herramientas de verdad y no contra la
especificación: los shapefiles los lee GDAL como `3D Line String` y `3D Point`
con sus Z y sus atributos, y el documento del Sketcher lo acepta su propio
`setDocument()` y lo dibuja.

## Vista 3D

El botón **3D** enciende terreno real —`setTerrain` sobre el mismo DEM— y el
dibujo se drapea solo sobre el relieve. La exageración vertical se ajusta en el
panel de Capas, donde también está el **sombreado** (hillshade), apagado por
omisión.

### Por qué el 3D iba lento, y qué se hizo

Encender el relieve dejaba la app casi inutilizable, y la causa no era dibujar
el terreno: era que **cada movimiento del ratón obligaba a MapLibre a rendear
la escena entera y a leer la GPU de forma sincrónica**.

Con `setTerrain` puesto, saber a qué punto del suelo apunta un píxel deja de
ser aritmética: hay que resolver contra qué triángulo de la malla choca el rayo.
MapLibre lo hace pintando la escena a un framebuffer auxiliar y leyéndolo con
`readPixels` — una lectura que vacía la tubería de render y bloquea el hilo
hasta que la tarjeta contesta. Cualquier cosa que pregunte «qué hay aquí»
dispara eso.

Medido en el escritorio, moviendo el ratón cuarenta veces:

| 40 movimientos del ratón, herramienta Línea | plano | 3D, antes | 3D, después |
|---|---|---|---|
| Lecturas sincrónicas de GPU | 0 | **1481** | **1** |
| Tiempo | 0,7 s | **6,6 s** | 2,6 s |

(Las lecturas son un recuento exacto y reproducible; los tiempos vienen de un
Chromium sin GPU, donde el relieve se rasteriza por software y el número
absoluto no dice mucho. Lo que se puede afirmar es la proporción y, sobre todo,
que las lecturas pasaron de treinta y siete por movimiento a una.)

De dónde salían las 1481 —unas 37 por movimiento— y qué se cambió:

- **Un `mouseenter`/`mouseleave` por capa pulsable**, nueve en total, solo para
  poner el cursor de mano. Es la forma que enseña la documentación de MapLibre,
  y lo que no dice es que cada par obliga a consultar lo renderizado **por
  separado** en cada movimiento. Ahora es **un solo `mousemove`** con una
  consulta, limitada a 20 Hz — y **ninguna** con el relieve puesto, donde aun
  una sola cuesta: quitando esa consulta, los mismos movimientos bajaron de
  14,6 s a 0,66 s. El cursor de mano es una cortesía; el mapa respondiendo, no.
- **El `mousemove` de hover llegaba a MapLibre incluso con una herramienta de
  dibujo activa**, donde no le sirve de nada: el `mousedown` siguiente lo va a
  consumir el controlador. Cada uno construía un `MapMouseEvent`, que calcula
  `lngLat` de inmediato, que es exactamente la lectura cara. Ahora se cortan en
  el propio controlador, y solo con relieve — en plano no hay nada que ahorrar.

Y dos cosas que se pedían de más, con relieve o sin él:

- **Las teselas del DEM se bajaban y decodificaban dos veces**: el relieve
  apuntaba a la URL de AWS y las curvas de nivel al protocolo de
  `maplibre-contour`, dos cachés independientes sobre el mismo archivo. Ahora
  las dos beben del protocolo compartido: se baja y se decodifica una vez.
- **El DEM se pedía hasta z15**, dos niveles por debajo del tamaño real del
  dato. A z13 cada píxel terrarium ya son ~19 m sobre un dato de ~30: z14 y z15
  no añaden un metro de detalle y multiplican por cuatro y por dieciséis las
  teselas. Topado en z13, que además es el número con el que ya se configuraba
  el generador de curvas — y esa coincidencia es lo que permite compartir la
  caché. Las curvas estaban topadas en 15 por el mismo descuido: a z14 y z15 el
  generador recorría cuatro y dieciséis veces la misma tesela para dibujar
  exactamente las mismas curvas.

Lo que queda es inherente: con la cámara inclinada el horizonte entra en el
encuadre, y eso multiplica por tres las teselas de todo —modelo, base y
curvas—. Medido: 16 teselas de DEM en planta contra 45 con el relieve puesto,
sin mover la vista.

### Digitalizar sobre el relieve

Con el relieve puesto se puede trazar **Línea** y **Polígono** y corregir con
**Edit Nodes**, avisando de que la calidad no es la misma. El resto
—Cortar, Reshape, Hole, perfil, rumbo y manteo— sigue deshabilitado, y no por
prudencia genérica: todas ellas dependen de tocar con exactitud un punto que se
va a convertir en un dato, y sobre terreno inclinado el punto que se toca y el
punto del terreno no coinciden como en planta. Encender el 3D con una de las
bloqueadas activa devuelve a **Navegar** y descarta lo que hubiera a medias; con
las tres permitidas en la mano no se toca nada, porque cambiar de vista no debe
tirar un contacto a medio trazar.

**Edit Nodes** entró a la lista de permitidas después que las otras dos, y por
un motivo concreto: mirando la ladera en 3D es justo cuando se ve que un
contacto quedó corrido, y tener que apagar el relieve, buscar el vértice en
planta y volver a encenderlo era el camino largo para algo que se estaba
señalando con el cursor. Además aquí el error de proyección se ve: la manija se
agarra donde se la ve dibujada, porque `map.project()` la coloca sobre el
terreno.

Arrastrar una manija sobre el relieve costaba lo que costaba dibujar antes de
la semilla: `moveVertexDrag` convertía el píxel con `unproject()` en CADA
fotograma del gesto —4,7 s por llamada, medido— y eso lo habría hecho
inservible. Ahora le pasa a `toLngLat()` dónde estaba el vértice en el
fotograma anterior, y la conversión se resuelve con `project()` sobre el DEM
que ya está en memoria. Lo mismo hace el modo *Añadir* con el vértice del que
arranca el segmento apuntado (`findInsertion` lo devuelve como `seed`).

#### El vértice se comprueba contra donde se repinta

«Menos precisión» es una cosa; «el vértice a un kilómetro» es otra, y esta
segunda podía pasar en silencio. Las dos direcciones de la proyección no se
resuelven igual: `project` consulta la cota en el DEM y es fiable, mientras que
`unproject` resuelve el relieve con el framebuffer de coordenadas y **ese camino
puede no estar** — si el búfer no llegó a dibujarse, MapLibre vuelve al plano
z = 0 sin avisar. Medido durante el desarrollo, con la cámara a 60° sobre
terreno de 3.000 m, un clic en mitad de la pantalla guardaba un punto que se
repintaba **700 px más arriba**, fuera de la ventana.

Ahora cada punto tocado se comprueba contra dónde se repinta, y solo se acepta
si vuelve a caer sobre el píxel que se tocó. Si `unproject` no acierta, se busca
el punto que sí: es una raíz de `project(x) − píxel = 0`, y Newton con la
jacobiana calculada por diferencias la encuentra, porque la semilla ya está
cerca y la superficie es suave. Y si ni eso cierra —el rayo dio en el cielo, o
el relieve de ese dispositivo no está en condiciones—, se **avisa una vez** y se
sigue con lo que haya: un aviso es recuperable, un contacto movido un kilómetro
sin decirlo no lo es. Sobre un risco visto de canto la solución puede no ser
única, porque el rayo corta la ladera dos veces; se devuelve la que está bajo el
cursor, que es todo lo que resuelve cualquier app 2,5D.

De paso desaparece un cuelgue real: un paso de Newton cerca del horizonte podía
salirse del mundo, y `map.project` no devuelve un valor raro ahí sino que
**lanza** («Invalid LngLat latitude value»), y la excepción subía por el
manejador de puntero y mataba el gesto entero.

Dibujar en 3D **cuesta**, y el motivo es concreto. `map.unproject` en planta es
aritmética; con terreno, MapLibre averigua qué punto del relieve hay bajo el
píxel leyendo el framebuffer de coordenadas con `gl.readPixels`, que obliga a la
GPU a terminar todo lo pendiente y devolver el resultado antes de seguir: cada
punto cuesta milisegundos. El trazo libre convertía el trazo ENTERO en cada
frame —N lecturas por frame, con N creciendo con el propio trazo—, así que a
doscientos puntos pedía más de diez mil lecturas por segundo y el navegador daba
la página por colgada. No era el relieve: era el bucle.

Ahora cada punto se convierte una sola vez (`src/stroke.js`), con el relieve
puesto se descartan los que no separan ni cuatro píxeles —el trazo se simplifica
igual al cerrarlo— y el suavizado se aplica en lng/lat en vez de generar cuatro
veces más puntos en pantalla y tener que convertirlos todos. El coste pasa de
crecer con el cuadrado del trazo a ser constante por punto.

### Mover la vista sin soltar la herramienta

En tablet esto ya estaba resuelto por el reparto de siempre: el Pencil dibuja y
los dedos desplazan, acercan y bascular. En un PC hay un solo puntero —el
arrastre ES el trazo, y el mapa ni siquiera ve el evento porque lo tragamos para
que no haga pan a la vez—, así que con el relieve puesto la vista se quedaba
congelada justo donde más falta hace girar para ver la ladera de frente. Con una
herramienta activa:

| Gesto | Acción |
|---|---|
| Botón central + arrastrar | Desplazar, como en QGIS |
| Rueda | Acercar y alejar |
| `↑ ↓ ← →` | Desplazar |
| `Shift` + `↑ ↓ ← →` | Girar y bascular |
| `+` `−` | Acercar y alejar |
| `0` | Volver al norte y a la planta |

En **Navegar** no cambia nada: ahí el ratón ya manda sobre el mapa entero
—arrastrar desplaza, el botón derecho gira y bascula— y `Shift`+clic sigue
añadiendo a la selección, que es justo lo que se habría roto si el controlador
se quedara el evento también ahí. Lo que sí se corrigió es que un giro con el
botón derecho terminaba abriendo el menú de propiedades: al soltar llega un
`contextmenu` igual, y ahora se distingue el arrastre del clic.

El teclado de MapLibre se apaga (`map.keyboard.disable()`): sus teclas son casi
las mismas, así que cada flecha desplazaba DOS veces en cuanto el foco estaba en
el lienzo — y solo entonces. La tabla de `src/shortcuts.js` vuelve a ser la
única fuente de verdad.

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

### Espesor estratigráfico

Con una medida seleccionada, **Measure thickness from here** en su menú de
propiedades arma el gesto: el siguiente toque en el mapa marca la otra
superficie que limita la unidad, y sale el espesor.

El espesor de una unidad **no** es la distancia que se mide en el mapa ni la
diferencia de cotas: es la distancia entre las dos superficies paralelas que la
limitan, o sea la componente del vector separación a lo largo de la **normal**
a la estratificación.

    e = |(p_techo − p_base) · n|

Sobre una capa de 30° de manteo, medir 500 m en planta y anotar 500 m de
espesor sobra en un factor dos. Es la misma fórmula y la misma convención de
normal que la herramienta *Dip to Thickness* de Structural Modeller, para que
un espesor medido en terreno y otro medido en gabinete sobre la misma carta se
puedan comparar.

La orientación sale de la medida seleccionada y no se vuelve a pedir: el
espesor se proyecta sobre la normal a **esa** capa, así que medirlo desde un
punto sin orientación no significaría nada.

Junto al número van las tres maneras en que un espesor puede ser correcto y aun
así no significar nada:

- **La oblicuidad**, el ángulo entre la separación y la normal. Cerca de 90° los
  dos puntos están casi en la misma superficie y el espesor es una diferencia
  pequeña entre números grandes.
- **La base**, si es menor que dos celdas del modelo: ahí las cotas traen más
  error que la medida.
- **El margen**, propagado por Monte Carlo desde el error vertical del DEM —las
  dos cotas, independientes— y desde la incertidumbre de la orientación: la
  suya propia si el manteo se calculó sobre el modelo, o el error típico de una
  lectura de brújula si se tomó a mano. Usar cero ahí daría una barra de error
  falsamente estrecha, que es la manera de mentir con una barra de error. El
  generador es determinista, así que volver a calcular el mismo espesor da el
  mismo margen.

También avisa cuando el segundo punto cae **por debajo** del plano del primero a
lo largo de la normal: o la capa está invertida, o se marcaron los dos puntos al
revés, y lo segundo es lo habitual.

### Traza de afloramiento desde el DEM

El problema inverso del resto de este módulo. En todo lo anterior se parte de
una traza y sale un plano; aquí se parte de un plano —una medida ya tomada— y
sale **dónde afloraría ese plano** a lo largo de unos kilómetros de rumbo.

Con una medida seleccionada, **Retrieve trace from DEM intersection** en su
menú de propiedades. Pide una sola cosa —cuántos kilómetros hacia cada lado del
punto, rotulados por el cuadrante al que va cada lado y no por un «adelante» y
un «atrás» que no significan nada en el cerro— y dibuja la traza punteada sobre
el mapa. Solo **después**, con la línea ya a la vista, pregunta qué es y ofrece
los mismos tipos y certezas de la paleta. Ese orden es deliberado: decidir que
un contacto es una falla antes de ver por dónde pasa es exactamente lo que no
se quiere.

Es la **regla de la V** de toda la vida, hecha sobre el modelo en vez de a ojo
sobre las curvas de nivel: un contacto de bajo manteo cruzando una quebrada
dibuja una V que apunta aguas arriba, y cuánto se abre depende del manteo y de
la pendiente del valle. A mano sobre una carta es lento y sistemáticamente
optimista.

#### La cuenta

En el sistema local con origen en la medida, `s` a lo largo del rumbo y `u` a
lo largo de la dirección de manteo, el plano baja `tan δ` por cada metro de `u`:

    z_plano(s, u) = z₀ − u · tan δ

La traza es donde el plano y el terreno se cortan, o sea el cero de

    g(s, u) = (z_DEM(s, u) − z₀) · cos δ + u · sen δ

que es lo mismo multiplicado por `cos δ`. Se escribe así por un caso concreto:
un plano **vertical**. Con la tangente, `tan 90°` es una división por cero; con
el seno y el coseno queda `g = u`, cuyo cero es `u = 0` — que es la respuesta
correcta, porque un plano vertical aflora recto siga el terreno lo que siga.

Para cada `s` se busca el cero en `u` abriendo en abanico a los dos lados de
donde cortó en la sección anterior, con paso creciente, y afinando por
bisección. Se toma **el más cercano**, no el primero: `g` puede tener varios
ceros —un plano aflora dos veces a los lados de una loma— y lo que se sigue es
UNA traza continua, no un salto entre ramas.

#### Lo que se niega a hacer

Por debajo de **3° de manteo** no traza, y no es una limitación técnica. Con el
plano casi horizontal la traza deja de seguir al rumbo y pasa a ser una curva
de nivel: a 1°, diez metros de desnivel la mueven 570 m de lado. Es el mismo
umbral bajo el que la app dibuja el símbolo horizontal sin tic, porque un
manteo así no declara dirección, y pedir «tantos km a cada lado del rumbo» ahí
no significaría nada.

Entre 3° y 10° traza, pero avisa de cuánto amplifica el error: el
desplazamiento lateral es el error vertical dividido por `tan δ`, así que a 5°
un metro mal leído en el DEM son once metros de traza mal puesta.

Y corta la traza cuando se sale del corredor de búsqueda —que crece con lo que
se pidió, con techo en 8 km— o cuando el modelo se queda sin cota. Corta y lo
dice, en vez de inventar el tramo que falta.

#### Lo que la traza es, y lo que no

Es una **predicción geométrica, no un dato**. Afirma que el plano medido en UN
punto sigue siendo plano y sigue teniendo la misma orientación hasta donde se
pidió. Eso es razonable a cientos de metros en una secuencia tranquila y falso
en cuanto hay un pliegue, una falla o un cambio de manteo.

Por eso entra al dibujo como una línea más —se edita, se mueve y se borra igual
que cualquier otra, y se deshace en un paso— y por eso se guarda de dónde
salió. En el proyecto `.fdproj.json` van los números enteros; en el GeoPackage,
las columnas `method` y `source` de `geol_lines`:

    Projected from 090/40 over 1.50 km on AWS Terrain Tiles — not walked

Quien abra la carta dentro de un año tiene derecho a distinguir un contacto
caminado de uno proyectado. En el mapa acabado son la misma línea negra.

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
generados a partir de la simbología.

`geol_lines` lleva además dos columnas de procedencia, `method` y `source`,
vacías en todo lo digitalizado a mano y rellenas en las trazas proyectadas
desde un manteo sobre el DEM (ver **Traza de afloramiento desde el DEM**): en
la carta acabada las dos son la misma línea negra, y esto es lo único que las
distingue. Al abrirlo en QGIS el mapa aparece ya
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

| Grupo | Color | Qué distingue a los tipos dentro del grupo |
|---|---|---|
| Fallas | azul `#0000ff` | el ornamento: dientes (inversa), tics con cuadrado (normal), pares de medias flechas (rumbo) |
| Pliegues | magenta `#ff00ff` | hacia dónde apuntan las flechas del eje |
| Contactos | negro `#000000` | — |
| Diques | rojo `#ff0000` | — |

El color dice el **grupo** y el ornamento dice el **tipo**. Antes cada tipo
tenía su color —cabalgamiento rojo, normal naranja, dextral morada— y eso
obligaba a recordar diez colores para leer un mapa; además es al revés de como
se publica, porque en una carta todas las fallas son del mismo color. Moviendo
la distinción al ornamento, el color queda libre para lo que hay que ver de un
vistazo. Son colores puros a propósito: sobre satelital, un rojo apagado y un
café se confunden, y con sol de frente esa diferencia desaparece del todo.
Todos son el valor de partida y el módulo de simbología los cambia uno a uno.

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

## Importar: qué entra y por dónde

El botón **Import** abre un cuadro que dice los formatos admitidos, en vez de
soltar el selector de archivos y dejar que uno lo averigüe. Van en dos grupos
porque hay algo que la app **no puede adivinar mirando el archivo**: un juego
de teselas PNG es idéntico sea un mapa base o un modelo de elevación, así que
cuál de los dos botones se pulsa **es** la respuesta.

| | Formatos |
|---|---|
| Dibujo y mapas | `.gpkg` · `.pmtiles` · `.mbtiles` |
| Modelo de elevación | `.pmtiles` · `.mbtiles`, con teselas **Terrain-RGB** |

### Qué formato de DEM conviene traer a terreno

**PMTiles con teselas Terrain-RGB**, y la respuesta no es de gusto sino de lo
que un navegador puede hacer sin ayuda:

- Es **un solo archivo** y se lee **por rangos**: se baja el pedazo que se está
  mirando y nada más. Un GeoTIFF —aunque sea COG— hay que abrirlo entero antes
  de poder leer una cota; en una tablet eso es la diferencia entre funcionar y
  quedarse sin memoria.
- Viene **piramidado**, que es justo lo que piden tanto el muestreo como el
  relieve: cada zoom con su nivel ya remuestreado.
- Sus teselas son **PNG Terrain-RGB**, el mismo empaquetado de metros que la
  app ya decodifica para el modelo de AWS. Ni un decodificador nuevo ni una
  dependencia más, que en un proyecto sin `node_modules` no es un detalle.
- Y la app **ya lo abre**: es el formato con el que se llevan los mapas base.

`.mbtiles` sirve igual salvo por una cosa que importa en tablet: es SQLite y se
carga entero en memoria. Para una zona de trabajo pequeña da lo mismo; para una
región, no.

Un GeoTIFF se convierte con GDAL, que ya está en cualquier instalación de QGIS:

```bash
gdalwarp -t_srs EPSG:3857 -r bilinear dem.tif dem3857.tif
gdal_translate -of PNG ...        # o, más directo:
rio rgbify -b -10000 -i 0.1 dem3857.tif dem-rgb.mbtiles   # rio-rgbify
pmtiles convert dem-rgb.mbtiles dem-rgb.pmtiles
```

Una vez cargado pasa a ser el **origen de cotas** de los perfiles, los ajustes
de plano, los espesores y las trazas proyectadas, y aparece como tercera opción
en **Ajustes → Elevation source**. Se comprueba al abrirlo: se lee una cota en
el centro de su cobertura y, si el número no es una cota plausible, se rechaza
en vez de cargarlo — un mapa base decodificado como Terrain-RGB daría manteos
calculados sobre el color de una imagen satelital.

**El relieve 3D y las curvas de nivel siguen usando el modelo de AWS.** Es una
limitación conocida, no un olvido: cambiarles la fuente en caliente obliga a
recomponer el estilo entero, y lo que decide la calidad de un número medido es
el muestreo, no el dibujo.

### De qué modelo salió cada número

Después de ajustar un plano —por tres puntos o sobre una traza— y después de
proyectar una traza, sale un cuadro que dice **con qué modelo se calculó y qué
resolución tiene**, y recomienda traer uno más fino. Antes esa resolución solo
aparecía como una línea suelta en el menú de propiedades, después, y si alguien
iba a buscarla.

Está ahí porque es el límite del resultado y no un detalle de fondo: un manteo
ajustado sobre una base más corta que dos celdas es ruido, y en una traza
proyectada cada metro de error vertical la mueve de lado ese metro dividido por
la tangente del manteo. Se puede callar para siempre —quien ya lo sabe no
necesita leerlo en cada medida—, pero sale por omisión, porque quien no lo sabe
está citando un número sin su letra pequeña.

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

La herramienta **Edit Nodes** muestra una manija por vértice y una más pequeña
en cada punto medio, y tiene tres modos, elegibles en la paleta:

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

## Exportar la vista del mapa como lámina

**Proyecto → Export the map view…** escribe lo que hay en pantalla como SVG,
PNG o PDF. No es una captura de pantalla: una imagen del mapa, sola, no dice
dónde está, ni a qué escala, ni hacia dónde, y esas tres cosas son la diferencia
entre una figura de una memoria y algo pegado en un documento. La lámina lleva:

- **Marco de cebra** con los cortes del graticulado y las coordenadas rotuladas
  en los cuatro bordes, que es como se lee una coordenada sobre el papel con una
  regla y nada más.
- **Escala gráfica**, que sobrevive a la fotocopia y al PDF reescalado, cosa que
  «1:25 000» no hace. Debajo va también el denominador.
- **Norte**, girado al revés que la cámara: con la vista girada, el norte del
  terreno aparece en pantalla a `-bearing`.
- **Título** opcional (se propone el nombre del proyecto) y un pie con el centro
  del encuadre y la fecha, que es lo que permite volver al mismo sitio meses
  después.

### El escalón del graticulado

Se elige el más grande que aún parta el encuadre en al menos tres tramos, de una
escalera de grados, minutos y segundos enteros: 10°, 5°, 2°, 1°, 30′, 20′, 15′,
10′, 5′, 2′, 1′, 30″, 20″, 15″, 10″, 5″, 2″, 1″. No hay escalones decimales a
propósito: un borde rotulado en grados decimales no se lee con la misma regla
que una libreta de terreno escrita en grados y minutos. A z11 salen cortes cada
2′; a z17, cada 5″; a z6, cada 2°.

Dónde corta cada línea no se calcula invirtiendo la proyección, sino muestreando
la longitud y la latitud a lo largo de los cuatro bordes cada cuatro píxeles y
buscando el cruce. Es lo que hace que funcione igual **con la vista girada**: el
borde superior de un mapa torcido no es una línea de latitud constante, y
cualquier fórmula cerrada tendría que tratar los dos casos por separado y podría
discrepar consigo misma.

### Se captura siempre en planta

Con la cámara basculada o con el relieve 3D puesto no hay **una** escala del
mapa —cada franja de la pantalla tiene la suya— ni un marco de coordenadas que
valga. Una lámina así mentiría en las dos cosas que la hacen un mapa. Así que si
hace falta se aplana, se captura y se devuelve la vista a como estaba; el aviso
lo dice. El giro **sí** se respeta: girar para alinear con una estructura es una
decisión del levantamiento, y para eso está la flecha del norte.

### Qué es vector y qué no

El mapa es una imagen en los tres formatos: lo rasteriza la GPU y no hay
vectores que sacar de ahí. Todo lo demás —marco, rótulos, escala gráfica y
norte— es vector en el SVG y en el PDF, así que la rotulación se puede retocar
en Illustrator o Inkscape sin volver a exportar.

Los tres formatos nacen de la **misma** lista de primitivas (`mapFrame.js`,
comprobable sin navegador), así que no pueden discrepar: el PNG es el SVG
rasterizado, y el PDF dibuja las mismas primitivas con su propio escritor.

Ese escritor (`pdf.js`, ~280 líneas, sin dependencias) usa Helvetica y
Helvetica-Bold, dos de las catorce fuentes que todo lector trae, con
`WinAnsiEncoding` y las tablas de anchos necesarias para centrar un rótulo. La
imagen del mapa va sin pérdida (`FlateDecode` sobre RGB crudo) mientras el
navegador traiga `CompressionStream` y la imagen no pase de doce megapíxeles;
por encima de eso cae a JPEG, que lo hace el navegador. Sin pérdida mientras se
pueda porque un contacto es una línea de dos píxeles sobre fondo oscuro, que es
justo donde el JPEG deja halos.

## Unidades geológicas

El botón **Unidades** abre el módulo donde se definen las unidades del mapa:
nombre, código abreviado y color. La paleta de polígonos pasa a listarlas, y al
digitalizar un polígono se le asocia la unidad activa.

Cada polígono guarda la unidad **denormalizada** en dos campos, `unit` y
`code`, que se exportan como texto en el GeoPackage. Renombrar una unidad
propaga el cambio a los polígonos que ya la usaban.

Si un polígono quedó sin unidad, o con la equivocada, se corrige seleccionándolo
y usando el menú de propiedades.

### Rotular los polígonos con su código

La casilla **Label the polygons with their code** enciende el rótulo sobre el
mapa. Viene apagada: mientras se levanta, el mapa está lleno de polígonos chicos
y a medio cerrar, y rotularlos todos tapa justo la geometría que se está
mirando.

Encendida, tampoco se rotulan todos, y ahí está el trabajo. Un mapa de terreno
tiene decenas de polígonos, muchos esquirlas de unos píxeles al zoom al que se
mira; un rótulo por polígono no es un mapa rotulado, es una mancha de texto con
códigos que no se sabe a cuál de los tres vecinos pertenecen. El reparto se
recalcula en cada encuadre con tres criterios, medidos los tres **en píxeles de
pantalla**, que es donde se lee:

1. **Que quepa.** El polígono necesita un hueco visible de al menos 52 px de
   lado y 3000 px² de superficie. Las dos condiciones y no solo el área: un
   dique o un nivel guía suman mucha superficie y no tienen sitio para una
   palabra en ninguna parte.
2. **Unos pocos.** De los que caben, los catorce mayores.
3. **Repartidos entre unidades.** Como mucho tres por unidad. Sin esto, un mapa
   con cuarenta polígonos de una formación y tres de otra gastaría todos los
   rótulos en la primera y dejaría muda a la segunda, que es la que hay que
   identificar.

Lo que sobre lo resuelve MapLibre, que antes de solapar dos etiquetas prefiere
no dibujar. La etiqueta cae en el **polo de inaccesibilidad** del polígono y no
en su centroide, así que en una unidad en forma de arco queda dentro y no fuera.

El texto sale del catálogo de unidades y no del atributo `code` del elemento,
por el mismo motivo que el color: renombrar un código se ve en el mapa en el
acto, sin tocar cada polígono.

Acercarse rotula más polígonos; alejarse los va soltando.

## Menú de propiedades

Mantener pulsado ~1 s sobre la selección abre un menú flotante con:

- **Edit Nodes**, lo primero de todo: un botón ancho que entra en modo *Mover*
  con las manijas de lo seleccionado ya visibles, y debajo los tres modos
  sueltos para ir directo a añadir o a borrar un vértice. Solo aparece si hay
  líneas o polígonos: una medida de rumbo y manteo es un punto y no tiene nodos.
- **Certeza**: observado, inferido o cubierto.
- **Unidad**, cuando hay polígonos en la selección.
- **Opacidad** por elemento, que se compone con la de la capa.
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

### Atributos de lo que no es tuyo

La misma pulsación sostenida, cuando debajo no hay dibujo propio, abre el
**visor de atributos** de lo que sí haya: un spot de StraboSpot o un elemento de
una capa importada de un GeoPackage. Se enseñan todos los campos de la tabla
—incluido `fid`, que es lo que permite volver a encontrar esa fila en QGIS— y el
elemento queda **resaltado en cian** en el mapa, el mismo color con el que se
marca la selección propia. Sin ese resalte, un GeoPackage con varios polígonos
contiguos no dice de cuál habla el recuadro.

El orden va de lo más específico a lo más general, y es deliberado:

1. **Lo propio**, seleccionado o bajo el dedo: abre el menú de propiedades, que
   además edita. Si hay dibujo encima de una capa importada, gana el dibujo: es
   lo único sobre lo que se puede actuar.
2. **Un spot de StraboSpot**: son símbolos pequeños, así que si uno cae sobre un
   polígono importado, el pequeño es al que se estaba apuntando.
3. **Un elemento de una capa importada**, en solo lectura.

Los dos últimos **no entran en la selección**. Esa lista alimenta borrar, cortar,
unir y mover vértices, y meter en ella algo que no está en el dibujo dejaría esas
herramientas apuntando a nada. Lo que aportaba la selección aquí —saber de cuál
de los tres polígonos contiguos se está leyendo— lo da el resalte.

El título busca un campo que NOMBRE al elemento antes de caer en el nombre de la
tabla: en una carta lo que identifica al polígono es su unidad, no que pertenezca
a `unidades_geologicas`. Se prueban `name`, `nombre`, `unidad`, `unit`, `label`,
`tipo`, `código`… sin distinguir mayúsculas ni acentos, porque una capa del
Sernageomin y otra de un paper no coinciden en nada de eso. El nombre de la capa
acompaña siempre: con dos GeoPackage abiertos hay que saber de cuál se lee.

El elemento se busca preguntando a lo **renderizado** (`queryRenderedFeatures`) y
no recorriendo la geometría a mano. Un GeoPackage de una carta trae decenas de
miles de elementos, y proyectar cada vértice de cada uno en cada pulsación
congelaría la app: el coste dependería del tamaño del archivo y no de lo que hay
en pantalla. De regalo, respeta lo que de verdad se ve — una capa apagada no
contesta. Como MapLibre devuelve la geometría recortada por tesela, la fuente
lleva `generateId` y con ese índice se recupera el elemento original completo,
que es el que se resalta; un GeoPackage no garantiza traer `fid`, así que no se
puede depender de sus atributos para esto.

### Editar una capa importada

Una capa de GeoPackage entra como **referencia**: se ve, se consulta, no se
toca. Eso está bien para un mapa de fondo, pero el trabajo real casi siempre es
continuar un mapa que ya existe. El botón **✎** de cada capa importada, en el
panel de Capas, la lleva **al dibujo**, y desde ahí funciona todo: nodos,
cortar, unir, reshape, huecos, deshacer, y sale en el proyecto y en el
GeoPackage junto al resto.

Es lo mismo que poner una capa en modo edición en QGIS, con una diferencia que
conviene decir en voz alta: el dibujo tiene **una** simbología, así que al
adoptar una capa se pierde su estilo QML. Deshacer la devuelve entera —capa,
elementos y unidades—, y para eso el historial admite instantáneas anchas: la
operación toca cuatro colecciones a la vez y deshacerla a medias dejaría el
proyecto en un estado que nunca existió.

La traducción de atributos ([`src/adopt.js`](src/adopt.js)) va en tres
escalones:

1. **Coincidencia exacta** con un id o una etiqueta de FieldDraw. Un GeoPackage
   exportado por la propia app vuelve a entrar idéntico, que es el caso que más
   se repite y el único donde acertar del todo es obligatorio: si el tipo se
   adivinara, el mapa cambiaría de simbología al ir y volver.
2. **Palabras**, en castellano y en inglés y sin acentos, porque una carta del
   Sernageomin y una capa de un paper no coinciden en nada. El orden importa:
   «falla inversa» tiene que caer en cabalgamiento y no en falla
   indiferenciada, así que `falla` a secas se prueba la última de su familia.
   Lo adivinado se cuenta y se dice, para poder revisarlo.
3. **Lo que quede** cae en contacto estratigráfico o unidad sedimentaria.

Dos cosas que hace por su cuenta y que son las que convierten una carta ajena en
un proyecto propio:

- **Crea las unidades**. Cada formación nombrada por la carta pasa a ser una
  unidad de FieldDraw, con su código y su color, editable en el panel de
  Unidades. Sin esto, veinte formaciones distintas entrarían todas como «unidad
  sedimentaria» y el mapa perdería justo aquello que lo hacía un mapa. Una
  unidad que ya existe con ese nombre se reutiliza en vez de duplicarse.
- **Explota lo multiparte**. El dibujo guarda líneas y polígonos simples;
  quedarse con la primera parte perdería el resto sin decirlo.

Los atributos del autor original que no son de FieldDraw se **conservan**:
perderlos al adoptar sería peor que no poder editar.

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

  Cuáles son «los de la original» se decide por el **punto a media longitud** de
  cada trozo y su distancia a la línea, con tolerancia relativa al tamaño de la
  geometría —las coordenadas pueden venir en grados o en metros UTM—. Antes se
  preguntaba si al restarle la original quedaba algo, y eso fallaba en el caso
  más común que hay: dos líneas cruzándose en aspa devolvían `difference` no
  vacía para los cuatro trozos, incluidos los dos que sí eran de la línea, así
  que no sobrevivía ninguno y la herramienta contestaba «no cruzó nada» sobre un
  cruce evidente. El punto de intersección que calcula el nodado no es
  exactamente representable, de modo que el trozo no queda como subconjunto
  exacto de la original y el predicado booleano dice que no; una distancia con
  tolerancia no tiene ese problema. Tampoco sirve `getInteriorPoint()` de JTS,
  que devuelve un **vértice** y en un trozo de dos puntos devuelve un extremo:
  justo el del cruce, que está sobre la otra línea, y entonces se colaban también
  los trozos del cortador.
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

- En **Navegar** y en **Elegir**, por el evento `click` nativo de MapLibre: las
  dos dejan el puntero al mapa, así que el evento llega intacto. Si el toque
  cae sobre un elemento del dibujo propio, ese manda; el spot solo se consulta
  cuando el toque quedó en vacío, y entonces la selección se limpia igual que
  con cualquier otro toque en vacío: un spot importado se lee, no se selecciona.
- Con el **dedo**, además, por el final del gesto observado, que es lo que
  permite que el toque funcione mientras el Pencil dibuja.

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

**Ver el Type de una línea o un polígono.** Un spot de StraboSpot no tiene una
propiedad `type`: lo que dice qué es una línea vive en `trace` y lo de un
polígono en `surface_feature`. La columna se arma de ahí, de lo general a lo
particular —`geologic structure fault thrust`—, para que al filtrar por tipo
todas las fallas queden juntas y el sentido de movimiento las separe dentro del
grupo. La unidad de un polígono sale de los tags del proyecto, igual que en
Estructuras. Antes se leía una propiedad `type` que ningún dataset real trae, y
las dos columnas salían vacías siempre.

## Subir el dibujo a StraboSpot

Siempre a un dataset **nuevo** del proyecto elegido: `POST /db/datasetspots/{id}`
reemplaza todos los spots del dataset de destino, así que escribir en uno
existente lo destruiría.

Lo que decide si un dato *se entiende* al otro lado no son sus atributos
sueltos, sino los tres objetos del modelo nativo por los que StraboSpot
categoriza y simboliza. Las equivalencias están en `src/strabo/mapping.js`, y se
comprobaron contra el código de la app oficial (StraboField, `src/assets/forms/`
y `src/modules/maps/symbology/`): los valores que se escriben son los `name` de
las listas del formulario, que es lo que se guarda, no sus etiquetas, que es lo
que se ve.

**Medidas → `orientation_data[]`.** Una medición planar con `strike`, `dip`,
`dip_direction` y su `feature_type`, que es lo que elige el símbolo:
`bedding`, `foliation`, `fault`, y `fracture` con `fracture_type: joint` para
las diaclasas. El símbolo lo rota StraboSpot con el rumbo, y una estratificación
invertida lleva `facing: overturned`, que es lo que le da su símbolo propio.

**Líneas → `trace{}`.** El color de la traza sale de `trace_type` y el patrón de
línea de `trace_quality`, que es exactamente la certeza de FieldDraw:
observado → `known`, inferido → `inferred`, cubierto → `concealed`. Los
contactos van bajo `contact` (negro) y las fallas y ejes de pliegue bajo
`geologic_struc` (rojo); un dique **no** es una estructura, es un contacto
intrusivo, y así lo dibuja la app.

**Polígonos → `surface_feature{}` + un tag del proyecto.** Un polígono no lleva
el nombre de su unidad: en StraboSpot el nombre y el color vienen de un tag de
tipo `geologic_unit` que apunta al spot. Por eso la subida escribe también los
tags —nombre, sigla en `unit_label_abbreviation`, color y litología— y sin ellos
el polígono llega anónimo y azul. Se puede desactivar con una casilla, porque es
la única escritura que toca el **proyecto** y no solo el dataset nuevo.

| FieldDraw | StraboSpot |
| --- | --- |
| Bedding · Foliation · Joint · Fault plane | `feature_type` `bedding` · `foliation` · `fracture` (+`fracture_type: joint`) · `fault` |
| Stratigraphic contact | `contact` + `depositional` + `stratigraphic` |
| Intrusive contact | `contact` + `intrusive` |
| Structural contact | `contact` + `other` (+ el término en `other_contact_type`) |
| Thrust · Normal · Dextral · Sinistral | `geologic_struc` + `fault` + `shear_sense` |
| Undifferentiated fault | `geologic_struc` + `fault`, sin `shear_sense` |
| Antiform · Synform | `fold_axial_tra` + `fold_type` `anticline` · `syncline` |
| Dyke | `contact` + `intrusive` + `dike` |
| Observado · Inferido · Cubierto | `trace_quality` `known` · `inferred` · `concealed` |
| Unidad de un polígono | tag `geologic_unit` + `surface_feature_type: rock_unit` |
| Zona de alteración | `surface_feature_type: other` («alteration zone») |

Cuatro decisiones que el dato no toma solo:

- **`quality` de una medición no se escribe nunca.** Es una escala 1–5 de cómo
  estaba expuesto y se midió el plano, y eso la app no lo sabe: la incertidumbre
  de un ajuste sobre el DEM mide otra cosa. Traducir una a la otra sería
  inventar una observación de terreno que nadie hizo.
- **Los ejes de pliegue suben como `anticline` / `syncline`**, que es lo que
  espera una carta publicada, aunque la paleta los llame antiforme y sinforme.
- **«Structural contact» sube como contacto**, no como estructura geológica: se
  cartografió un contacto, y el término exacto queda en `other_contact_type`.
  Clasificarlo como falla afirmaría algo que el dibujo no dice.
- **Rumbo, manteo y azimut se redondean a entero**, porque el formulario de
  StraboSpot los declara enteros. El valor exacto del ajuste no se pierde: viaja
  en el bloque `fielddraw` del spot, junto al método, las desviaciones estándar,
  el RMS, la base y la fuente del DEM. Un resumen legible de todo eso va además
  en las notas de la medición, que es lo único de esto que se ve al abrir el
  spot en StraboSpot.

**Los tags no se pisan.** `POST /db/project` reenvía el proyecto **entero**, así
que la subida lee el proyecto, le añade los tags y lo devuelve completo: lo que
no se mande se pierde. Una unidad que ya existía —mismo nombre— no se reescribe;
solo gana los polígonos nuevos. El color, la litología y la edad que alguien
haya afinado en StraboSpot valen más que los del catálogo local, y pisarlos en
cada subida sería destruir trabajo ajeno sin avisar.

Las dos escrituras se informan por separado a propósito: si los tags fallan, los
spots ya están arriba, y eso es una subida incompleta, no una fallida.

**Los ids son de 14 dígitos**, milisegundos por diez más un dígito aleatorio,
como los de la app oficial. Con esa fórmula solo caben diez ids por
milisegundo y una subida crea cientos en un bucle apretado, así que un contador
monótono garantiza que no se repitan sin salirse del formato: dos spots con el
mismo id serían uno solo al llegar.

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
- ✅ Snapping a vértice y segmento, y herramienta Follow trace.
- ✅ MBTiles y PMTiles, raster y vectorial.
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
- ✅ Modos de añadir y borrar vértices en la herramienta Edit Nodes, que se
  abre también desde el menú de propiedades y funciona con el relieve 3D puesto.
- ✅ Clic derecho fiable en PC: se resuelve al soltar —no en el `contextmenu`,
  cuyo momento depende del sistema operativo—, con radio de acierto holgado,
  sin dejar pasar el menú nativo del navegador y sin colocarse encima del
  cursor; abre el menú en cualquier herramienta y solo cierra el elemento
  cuando de verdad hay uno a medio trazar.
- ✅ Mantener pulsado el botón primario un segundo abre el mismo menú, como
  redundancia del clic derecho, con ratón y con lápiz.
- ✅ Un solo icono para la pestaña, la instalación y la franja de la app.
- ✅ Guardar y abrir proyectos (`.fdproj.json`).
- ✅ Autosave en localStorage y exportación a GeoJSON.
- ✅ PWA instalable: dependencias en `vendor/`, service worker con precache del
  app shell y caché de las teselas ya visitadas.
- ✅ StraboSpot: sesión, descarga de spots (Estructuras/Observación con la misma
  simbología que el plugin de QGIS), subida del dibujo como dataset nuevo —con
  las medidas como orientaciones planares, las líneas como trazas y las unidades
  como tags del proyecto—, ver atributos desde Navegar y desde Elegir, filtrar
  por tipo y tamaño de símbolo ajustable.
- ✅ Reshape de polígonos y líneas, sin dependencias.
- ✅ Botón de GPS para centrar el mapa en la posición propia.
- ✅ Perfiles topográficos sobre el DEM ya cacheado o sobre Copernicus vía
  OpenTopography, con gráfico interactivo ligado al mapa, exportación a CSV y la
  traza guardada como figura en PNG o SVG, con la exageración vertical rotulada.
- ✅ Relieve 3D y sombreado desde el mismo DEM, con Línea y Polígono dibujando
  sobre él: cada vértice se comprueba contra dónde se repinta, y si no cierra
  se avisa en vez de guardar un punto corrido en silencio.
- ✅ Rumbo y manteo por brújula, por tres puntos o ajustando un plano a una
  traza, con la incertidumbre propagada desde el error del DEM y los avisos de
  calidad al lado del número.
- ✅ Perfil estructural: manteos proyectados con manteo aparente, intersecciones
  con el dibujo, y salida a SVG, PNG, shapefile 3D para Structural Modeller y
  proyecto para StructuralSketcher.
- ✅ Adoptar una capa importada al dibujo, con las unidades creadas desde sus
  formaciones y todas las herramientas de edición disponibles sobre ella.
- ✅ Espesor estratigráfico verdadero entre una medida y un punto del mapa, con
  la incertidumbre propagada y los avisos de oblicuidad y base corta.
- ✅ Atributos de las capas importadas de un GeoPackage con la pulsación
  sostenida, con el elemento resaltado en el mapa.
- ✅ Escala de trabajo: botón propio en la barra, lectura 1:N, salto a una escala
  de mapeo y candado que la mantiene al desplazarse, con lista editable y el
  tamaño de la pantalla resuelto por diagonal, por tamaño estándar o con una
  regla de verdad sobre una barra de calibración.
- ✅ Quitar un área interior de un polígono, dejando un anillo interior real que
  sobrevive a la fusión con la unidad vecina.
- ✅ Barra de herramientas que envuelve en columnas en vez de recortar: en una
  tablet apaisada quedaban fuera de la pantalla Escala, GPS, Hecho, Cancelar y
  Borrar, sin barra de desplazamiento que lo anunciara.
- ✅ El toque del dedo y del lápiz seleccionan y deseleccionan en todas las
  herramientas, medidos sobre los eventos de puntero y no sobre el `click` que
  sintetiza el navegador, que con doce píxeles de deriva no llega a emitirse.
- ✅ Rótulo del código de la unidad sobre los polígonos, solo donde cabe, solo
  en unos pocos y repartido entre unidades.
- ✅ Exportar la vista del mapa como SVG, PNG o PDF con marco de cebra y
  coordenadas, escala gráfica y norte, siempre en planta y con el marco y la
  rotulación en vector.
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
