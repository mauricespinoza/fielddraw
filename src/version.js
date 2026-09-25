/**
 * Versión de la app y registro de cambios.
 *
 * Vive en su propio módulo y no incrustado en el HTML del panel «About»
 * porque son datos, no maquetado: quien publica una versión toca esta lista y
 * nada más, y el panel se dibuja solo. Es también lo que se le pide a alguien
 * que reporta un fallo desde terreno —«¿qué versión te dice About?»—, así que
 * tiene que ser un dato exacto y no un número escrito a mano en dos sitios.
 *
 * `APP_VERSION` no es lo mismo que el `VERSION` de `sw.js`: aquel es la clave
 * de la caché del service worker, que cambia cada vez que se republica aunque
 * no cambie nada visible. Este numera lo que el usuario SÍ nota.
 */

export const APP_VERSION = '0.41.0';

/** Beta: el formato de proyecto y la subida a StraboSpot todavía se mueven. */
export const APP_STAGE = 'beta';

export const APP_AUTHOR = 'Mauricio Espinoza';
export const APP_ORG = 'Universidad de Concepción';
export const APP_CONTACT = 'mauricespinoza@udec.cl';

/**
 * Qué hace cada herramienta, en una línea.
 *
 * Es lo que se lee la primera vez que se abre la app sin nadie al lado que la
 * explique, así que cada entrada dice para QUÉ sirve y no cómo está hecha.
 */
export const APP_TOOLS = [
  ['Create · Line', 'Contacts, faults, folds, dykes — type and certainty come from the palette.'],
  ['Create · Polygon', 'Map units. Each polygon carries the active unit, colour and code.'],
  ['Create · Dip', 'Strike/dip by compass, 3 points on the DEM, a drawn plane, live phone sensors, or digitised.'],
  ['Create · Control', 'Observation points: choose tap or GPS, then fill in unit, sample ID, description, purpose and notes. Date and time are stamped for you; the colour follows the unit, the icon and label are yours to pick.'],
  ['Stereogram', 'Schmidt net of selected dips, with a mean vector, error cone, lasso, and a beta (fold) axis.'],
  ['Select', 'Tap to pick one, or drag a lasso — freehand or rectangle — to touch several at once.'],
  ['Topology · Edit Nodes', 'Move, add or delete vertices of existing features.'],
  ['Topology · Hole', 'Subtract an area from a polygon, leaving a hole.'],
  ['Topology · Split · Reshape', 'Cut a feature with a line, or redraw part of its outline.'],
  ['Topology · Snap · Follow trace', 'Snap to existing geometry, or trace along another feature.'],
  ['Topology · Merge', 'Merge two or more selected features of the same geometry type.'],
  ['Profile', 'Topographic profile of a line, from the elevation model.'],
  ['3D', 'Terrain relief to read the slope. Line and Polygon still draw.'],
  ['Scale', 'Pick a working scale, snap the map to it, calibrate the screen.'],
  ['Layers · Units · Symbols', 'Layer visibility, the unit catalogue, and line styling.'],
  ['Import · Export', 'GeoPackage, Shapefile, GeoJSON, offline maps (MBTiles/PMTiles).'],
  ['StraboSpot', "Download a dataset's spots, or upload the drawing as a new one."],
  ['Project', 'Save/open the project, export the map as an SVG/PNG/PDF sheet.'],
];

/**
 * Registro de cambios, del más nuevo al más viejo. `items` son frases
 * completas: quien lo lee quiere saber qué cambió para él, no qué archivo se
 * tocó.
 */
export const CHANGELOG = [
  {
    version: '0.41.0',
    highlights: [
      'A line measured as a rake keeps the rake as the measured value; the measurement menu and the exports also give its trend and plunge.',
    ],
    items: [
      'Línea medida como rake: el rake queda como el dato medido y trend/plunge se calculan de él y del plano. Si después se corrige el rumbo o el manteo, la línea sigue al plano con el mismo rake. El menú de la medida dice cómo se midió («Measured as rake» / «Measured as trend/plunge»), deja editar ese valor y muestra el otro ya calculado.',
      'Exportación: el GeoPackage escribe siempre line_trend, line_plunge y rake, más la columna nueva line_input (rake, trend o edge) y la línea en el rótulo («Striae 19→024 (rake 30°)»). StraboSpot recibe trend, plunge y rake, con rake_calculated = no cuando se midió como rake. Al reimportar el GeoPackage se recupera el rake como dato.',
    ],
  },
  {
    version: '0.40.0',
    highlights: [
      'Device plane + line: the plane comes from the back of the phone and the line (striae, L₁) from its long edge, read in the same sample.',
      'The stereogram plots each line as a square; faults with a sense of slip get an arrow showing how the hanging wall moves.',
      'The line can be typed as a rake: it is converted to trend and plunge on the measured plane.',
    ],
    items: [
      'Método Device con «+ Str» o «+ L₁»: el plano sale del dorso del teléfono apoyado sobre la superficie (su normal, el eje +Z) y la línea del canto largo (eje +Y), alineado con la estría o la lineación. La línea se promedia en la misma tanda que el plano, se proyecta sobre él y se anota hacia abajo; su dispersión viaja como Line spread. El panel Device muestra la línea en vivo.',
      'Estereograma: cada línea se dibuja como un cuadrado del color de su superficie, con su propia casilla («Lines»). En una falla con sentido de movimiento, una flecha sobre la estría indica hacia dónde se mueve el bloque colgante (convención de Angelier: hacia afuera en una normal, hacia el centro en una inversa, casi tangente al primitivo en una de rumbo).',
      'Rake → trend/plunge: en la paleta se elige escribir la línea como T/P o como Rake (0–180° desde el rumbo RHR), y en el menú de la medida el rake también se edita; en ambos casos se traduce a trend y plunge con el plano de la medida.',
    ],
  },
  {
    version: '0.39.0',
    highlights: [
      'Plane + line: fault planes (Flt) can carry their striae and foliation (S₁) its lineation L₁, as trend/plunge; the rake is computed and a line that falls off its plane is flagged.',
      'Every structural measurement has Notes and a Quality rating from 1 to 5.',
      'Observation points: a much larger Notes box that grows with the text; on a computer, drag its corner to resize it.',
      'Stereogram ▸ Compass: no needle — the compass rose turns so N stays on true north, and the strike of the top of the device from north is shown.',
    ],
    items: [
      'Plano + línea: al elegir Flt o S₁ la paleta ofrece «+ Striae» o «+ Lineation L₁» con Trend y Plunge; la línea se guarda en la misma medida (lineTrend, linePlunge) con su rake desde el rumbo RHR. También se agrega, edita o quita desde el menú de la medida, que avisa si la línea se sale más de 10° del plano. Viaja al GeoPackage (line_type, line_trend, line_plunge, rake) y a StraboSpot como `associated_orientation` lineal del plano, y vuelve de ambos.',
      'Cada medida estructural tiene Notes y Quality 1–5 en su menú; la calidad también se elige en la paleta antes de medir. Quality va al GeoPackage (columna quality) y a StraboSpot como el `quality` de la medición; si no se califica, no se inventa.',
      'Puntos de observación: el recuadro de Notes es mucho más alto y crece con el texto para leer la nota de corrido; en pantalla grande tiene esquina para estirarlo en alto y ancho, y la paleta se ensancha con él.',
      'Pestaña Compass del Stereograma: sin aguja. La rosa de puntos cardinales (con NE, SE, SW, NW y grados cada 30°) gira en pantalla manteniendo la N en el norte real, con los rótulos derechos; una marca fija arriba señala el borde superior del teléfono y debajo se lee su rumbo desde el norte.',
    ],
  },
  {
    version: '0.38.0',
    highlights: [
      'Line symbology is set per group — one colour and width for all contacts, all faults, all folds — with ornaments tuned by family instead of type by type.',
      'Observation points can use a circle, square, triangle, diamond, star, pentagon or cross; the fill still follows the unit, and the icon travels to QGIS.',
      'Placing an observation point now asks first: tap the map or use the GPS. The form opens after, full screen on a phone, and the point is only created when you save it.',
    ],
    items: [
      'Panel de simbología: los once tipos de línea se ajustan por grupo (contactos, fallas, pliegues, diques) con un solo color y un solo grosor; los ornamentos, por familia —ticks de inversa y normal, medias flechas de rumbo, flechas de pliegue— con un único zoom mínimo por grupo. El proyecto sigue guardando cada tipo, así que nada cambia al abrir uno anterior.',
      'Puntos de observación con icono a elección (círculo, cuadrado, triángulo, rombo, estrella, pentágono, cruz), dibujados como SDF para conservar el relleno de la unidad y el borde morado de lo adoptado. El QML y el SLD del GeoPackage usan la misma forma.',
      'Colocar un punto: primero se elige tocar el mapa o usar el GPS (si no hay posición, enciende el seguimiento y espera); luego se abre el formulario, a pantalla completa en el teléfono. Un segundo toque mueve el marcador; el punto solo se crea con «Save point».',
    ],
  },
  {
    version: '0.37.0',
    highlights: [
      'With several features selected, a list shows them all by name; tap one to keep only that one.',
      'Device method: tap the compass to stop the measurement, tap again to resume.',
      'StraboSpot fault lines with no sense of slip come in as undifferentiated faults, and go back up as plain faults.',
      'The logo on the main screen now carries the app name.',
    ],
    items: [
      'Con más de un elemento seleccionado aparece una lista con cada uno —tipo, certeza, unidad o rumbo/manteo— y un toque deja seleccionado solo ese. Sirve para lo apilado (un contacto sobre el borde de un polígono, dos medidas en el mismo afloramiento) y para depurar un rectángulo de selección. La ✕ la cierra conservando todo lo seleccionado.',
      'Método Device: un toque sobre la brújula detiene la medida en ese instante —la lectura queda fija, con un marco de acento— para poder separar el teléfono de la roca y guardarla con calma; otro toque la reanuda. Tras guardar, la siguiente medida arranca en vivo.',
      'Las trazas de falla de StraboSpot sin sentido de movimiento —sin `shear_sense`, con «unknown», o con la traza aplanada en el spot en vez de en su objeto `trace`— entran como falla indiferenciada; antes, la forma aplanada llegaba sin tipo y caía en contacto. La indiferenciada sube como falla sin sentido.',
      'El logo de la pantalla principal lleva el nombre de la app a su derecha: «Field» liviano y «Draw» firme en el turquesa del icono. Si no cabe, se retira primero el nombre y después el logo.',
    ],
  },
  {
    version: '0.36.0',
    highlights: [
      'Fixed: zooming repeatedly in 3D could freeze the map for minutes.',
      'Fault lines: change the fault type (Thrust, Normal, Dextral, Sinistral, Undifferentiated) from the line menu.',
      'GeoPackage: new fault_type column on lines and fault_sense column on measurements, read back on import.',
      'The white halo of fault and fold ornaments now merges with the line halo instead of drawing over the line.',
    ],
    items: [
      'Corregido el congelamiento al hacer zoom repetidas veces en la vista 3D. Con relieve, MapLibre resuelve cada paso de pantalla al terreno leyendo la GPU de forma sincrónica (`readPixels`), y lo hacía varias veces por cuadro: la barra de escala, el ancla del zoom, cada movimiento del puntero y el reajuste del centro al terminar cada paso. Medido: entre 2 y 11 s de bloqueo por paso de rueda, casi todo dentro de esa lectura. Ahora esas llamadas se contestan con el rayo contra el plano a la cota del centro, sin GPU; la lectura de verdad queda solo para lo que la app necesita exacto —el punto donde se pone un vértice—, que además se sigue refinando contra el DEM.',
      'Las líneas de falla conservan el tipo con que se dibujaron (Thrust, Normal, Dextral, Sinistral, Undifferentiated) y ahora se puede cambiar desde su menú de línea, sin redibujarlas; certeza, flip y geometría se mantienen. Solo se ofrecen tipos de falla: convertir un contacto en falla se hace con la paleta.',
      'GeoPackage: columna `fault_type` en `geol_lines` (vacía en lo que no es falla) y columna `fault_sense` en `geol_points` (Normal, Inverse, Left-lateral, Right-lateral en los planos de falla). Al importar un GeoPackage, las dos se leen de vuelta.',
      'El halo blanco de los ornamentos —dientes, bolas, medias flechas y flechas de pliegue— ya no se pinta encima de la línea: va en una capa propia por debajo de la traza, con la misma opacidad que su halo, así que el blanco envuelve solo por fuera al conjunto línea + símbolo.',
    ],
  },
  {
    version: '0.35.0',
    highlights: [
      'Opening a project moves the map to where its features are.',
      'StraboSpot geologic-unit tags now fill the Unit of imported measurements, and go back up with them.',
      'Bedding (S₀), foliation (S₁) and fault planes (Flt) have their own symbols; Flt asks Normal, Inverse, Left- or Right-lateral and draws it.',
      'Fault ornaments (teeth, balls, half-arrows, fold arrows) get the same white halo as the trace; strike-slip arrows have an adjustable separation.',
      'Pick the zoom from which dip values are written next to their symbols.',
      'Stereogram ▸ Compass: the needle stays fixed and the dial turns, so N always points to true north.',
    ],
    items: [
      'Al abrir un proyecto —o al restaurar el de la sesión anterior— el mapa encuadra lo que trae, en vez de quedarse mirando la zona del proyecto anterior o el centro fijo de arranque.',
      'Los tags `geologic_unit` de StraboSpot llenan el campo Unit de las MEDIDAS importadas, enlazadas al catálogo de unidades igual que los puntos de control; antes solo quedaba el nombre como texto suelto. Solo cuentan los tags de unidad: un tag «Outcrop» ya no puede colarse como unidad. Al subir, una medida con unidad sale con su tag, aunque venga de una adopción anterior que guardó solo el nombre.',
      'Símbolos propios para cada superficie: S₀ con el tic de siempre, S₁ con un triángulo relleno hacia el manteo (cuadrado con cruz si es horizontal), y Flt con trazo grueso y el ornamento de su cinemática: bola en la normal, diente en la inversa y medias flechas desfasadas en las de rumbo. Al elegir Flt se pregunta el tipo, y viaja a StraboSpot como `fault_or_sz_type` (y vuelve de allá).',
      'Los ornamentos de las trazas —dientes, bolas, medias flechas y flechas de pliegue— llevan el mismo halo blanco que la línea, para que la cinemática se lea sobre la ortofoto. En las fallas de rumbo se ajusta además la separación de las medias flechas respecto de la traza (Symbology ▸ Separation).',
      'El zoom desde el que se escribe el manteo junto a cada símbolo se elige en Symbology (antes fijo en 13).',
      'Stereogram ▸ Compass: la aguja queda fija hacia lo alto de la pantalla y lo que gira es el marco, de modo que su N queda sobre el norte real mientras se gira el teléfono.',
    ],
  },
  {
    version: '0.34.0',
    highlights: [
      'Control points get a Name field — the station or outcrop, for a point with no sample to name it by.',
      'The Create ▸ Control panel is bigger and laid out top to bottom, with a proper multi-line box for Notes.',
      'Place a control point at your current GPS position, not only by tapping the map.',
      'A visible Done button closes the point, both while placing one and while editing an existing one.',
      'Control point label and size settings moved to the Symbology panel, next to the dip symbols.',
    ],
    items: [
      'Puntos de control: nuevo campo Name, el nombre del PUNTO —la estación, el afloramiento— y no el de la muestra. Sube a StraboSpot como el `name` del spot (antes se usaba el código de muestra, o un número si no había ninguno), y es la opción de rótulo que hacía falta para un punto sin muestra: antes no tenía cómo llamarse.',
      'El panel de Create ▸ Control se agranda y pasa de los 106 px de siempre a una columna propia, más ancha, diagramada de arriba hacia abajo: Name, Sample ID, Sample Description, Unit, Purpose, Notes y Placement, cada uno en su fila.',
      'Notes deja de ser una sola línea y pasa a un cuadro de varias, con más espacio: la litología es prosa —«granodiorita de bt, grano medio, equigranular»— y recortarla a una línea obligaba a escribir la mitad y confiar en la memoria para el resto.',
      'Se puede colocar un punto de control en la posición actual del GPS, además de tocando el mapa: el botón «Place at GPS position» usa la última posición de Locate, igual que ya hacía el método Device para rumbo y manteo.',
      'Un botón Done, ancho y siempre a la vista, cierra la sesión de anotar un punto nuevo (vuelve a Elegir) y cierra la edición de uno ya puesto (el mismo menú de propiedades de siempre, con Done arriba del todo).',
      'El tamaño del símbolo, el zoom mínimo y qué campo lo rotula en el mapa —antes en la propia paleta de crear— pasan al panel de Symbology, junto a los mismos ajustes de las medidas de rumbo y manteo: es una preferencia de PANTALLA y no un dato del punto, y no tenía por qué preguntarse en cada uno.',
    ],
  },
  {
    version: '0.33.0',
    highlights: [
      'New Create ▸ Control tool: control points with unit, sample ID, description, sampling purpose and notes.',
      'The date and time of capture are stamped when you place the point and written out on export — never typed by hand.',
      'Control points are coloured by their unit, and you choose what the map label shows (sample ID, unit, purpose…).',
      'They export as a GeoPackage layer with its QGIS symbology, and as a CSV for the spreadsheet.',
      'StraboSpot observations and samples now come in as control points, and go back up as native samples.',
      'Fixed: exporting a GeoPackage failed outright — the points table was missing a column it was writing.',
    ],
    items: [
      'Nueva herramienta Create ▸ Control: puntos de control con Unit, Sample ID, Sample Description, Purpose y Notes. La litología va en las notas y no en un campo propio: es prosa, y el modelo de muestra de StraboSpot no tiene dónde ponerla.',
      'El propósito del muestreo es una lista cerrada con los valores de StraboSpot (`main_sampling_purpose`), no texto libre: el valor viaja tal cual a su formulario, y uno escrito a mano llega allá como un campo vacío.',
      'La fecha y la hora de toma se sellan solas al colocar el punto y se escriben al exportar, en la hora local del equipo; en el GeoPackage viaja además la misma marca en ISO/UTC. No se piden nunca: copiar a mano lo que el reloj ya sabe, y encima al volver del terreno, es la forma más fácil de equivocarse.',
      'El código de muestra, la descripción y las notas se vacían al colocar cada punto; la unidad y el propósito se quedan puestos para el siguiente. Heredar el código en silencio produce dos muestras que en el laboratorio ya no se pueden separar.',
      'Los puntos se dibujan del color de su unidad —el mismo catálogo que pinta los polígonos— y el rótulo del mapa se elige en la paleta: Sample ID, unidad, código, propósito, notas o ninguno.',
      'Exportación a GeoPackage en su propia capa `geol_control_points`, con estilo QGIS categorizado por unidad y etiquetado por el campo elegido, y exportación a CSV (con BOM, para que Excel no rompa los acentos) desde Ajustes.',
      'Las observaciones y muestras que se bajan de StraboSpot entran ahora como puntos de control —con su código, descripción, propósito y la fecha en que se tomaron— en vez de quedarse en una capa de solo consulta. Las mediciones siguen entrando como mediciones; las fotos no se importan.',
      'Un punto de control sube a StraboSpot como muestra nativa: Sample ID alimenta su «Sample Specific ID/Name», la descripción su homóloga, el propósito su lista, y la unidad el tag `geologic_unit`. La fecha de recolección es la de la toma, no la de la subida. Lo que nadie observó —tipo de material, grado de meteorización, si estaba in situ— se deja vacío en vez de rellenarlo con su valor más frecuente.',
      'Corregido un fallo que rompía la exportación a GeoPackage ENTERA: la tabla de medidas escribía una columna (`pole_sd`) que su esquema no declaraba, y sqlite rechaza la sentencia al prepararla aunque no haya ni una fila que escribir, así que no se descargaba ningún archivo. Un test nuevo compara esquema e inserciones tabla por tabla para que no vuelva a pasar.',
    ],
  },
  {
    version: '0.32.0',
    // Resumen corto en inglés para el panel About — ver la nota junto a
    // `ABOUT_DETAILED_RELEASES` en `ui.js` sobre por qué es un campo aparte
    // y no una traducción de `items`.
    highlights: [
      'Redesigned toolbar icons (Units, Symbols, Stereogram, StraboSpot, Settings), 10% bigger.',
      'StraboSpot sign-in remembers the last email on this device.',
      'Compass tab: just the heading from north, smoothed for a steady reading.',
      'Stereogram: mean vector now shows its 95% error cone; the lasso drives Mean vector and a new Beta (fold) axis; About shows the app logo.',
      'Settings panel: fixed text overflowing its boxes, and trimmed throughout.',
    ],
    items: [
      'Los iconos de la barra superior se rediseñan (Units, Symbols, Stereogram, StraboSpot) y el de Ajustes pasa a ser un engranaje de verdad; los diez crecen un 10%. El icono de atajos de teclado solo se ve en PC (con ratón y hover).',
      'El login de StraboSpot suma «Remember me»: guarda el correo —nunca la contraseña— en este dispositivo y lo rellena solo la próxima vez.',
      'La pestaña Compass del estereograma deja de reusar la lectura de rumbo/manteo pensada para apoyar el teléfono contra una roca: ahora es una brújula de verdad, solo el ángulo desde el norte al que apunta el teléfono, con la lectura suavizada (media móvil circular) para que no tiemble con cada muestra del magnetómetro.',
      'El vector medio del estereograma dibuja su cono de confianza al 95% (Fisher). El lazo pasa a controlar directamente de qué polos se promedia —con algo marcado, Mean vector y el nuevo Beta axis (eje de pliegue, por el método de los autovalores) se calculan solo con esos—.',
      'El panel About enseña el logo de la app; solo las últimas dos versiones traen el detalle completo de sus cambios, el resto se resume a una línea.',
      'La marca de la app en la franja superior se reduce al logo, un poco más grande: la autoría y la universidad viven solo en About, sin repetirse encima del mapa.',
      'El panel de Ajustes tenía varias filas cuyo texto se pintaba fuera de su caja, montado sobre la fila siguiente —un contenedor flex con `min-height` no crecía para un segundo hijo—; corregido, y el texto de todo el panel se recorta a la mitad.',
    ],
  },
  {
    version: '0.31.0',
    highlights: [
      'Placing a measurement no longer re-asks its type and unit — that now happens beforehand, in the palette.',
      'Digitize sets strike with a single drag, like drawing with a ruler.',
      "Stereogram gets a Mean vector checkbox: the cluster's average strike/dip, with a concentration figure.",
      'The Device method settles on a reading faster, without accepting a noisier one.',
      'The live compass needle now looks like a real compass needle.',
    ],
    items: [
      'El cuadro de tipo y unidad que se abría al colocar una medida se retira: el tipo de superficie y la unidad ya se eligen en la paleta ANTES de tocar el mapa, y preguntarlos otra vez apenas nace la medida era la misma pregunta dos veces, no dos preguntas. Corregirlos después sigue siendo cosa del menú de propiedades (mantener pulsado sobre la medida).',
      'Se quita «Dyke margin» del catálogo de superficies medibles: un dique es un cuerpo, no una superficie suelta, y ya se cartografía como tal —con su propia traza y, si hace falta, su propia unidad—. Tratarlo además como un quinto tipo de medida puntual duplicaba la pregunta que la traza o el polígono ya contestan.',
      'Digitize cambia otra vez de gesto: la traza de rumbo se dibuja con UN arrastre —el punto donde baja el dedo es el primer extremo— en vez de con dos toques, como se traza una línea con una regla. El palito del manteo, además, se dibuja SIEMPRE ortogonal al rumbo por más que el dedo se vaya de lado, y arrastrar al lado contrario del que ya se había elegido voltea el rumbo guardado 180° para que `dipAzimuth = rumbo + 90` siga cumpliéndose siempre, como en cualquier otro método.',
      'El estereograma suma una casilla «Mean vector»: el promedio de los polos que se están mirando, con su rumbo y manteo (regla de la mano derecha) y una cifra de qué tan apretado está el cúmulo. Se dibuja con una mira propia —círculo magenta con una cruz blanca— para que nunca se confunda con un polo de verdad.',
      'El método Device se da por listo bastante antes que antes, sin aceptar una lectura más ruidosa: la ventana de muestras baja de 2 a 1 segundo. La demora no la ponía cuántas muestras hacían falta —el sensor entrega de sobra en un puñado de milisegundos— sino cuánto tiempo seguido tenía que verse quieto: acortar la ventana acorta exactamente eso, sin tocar el umbral de dispersión que decide si la lectura es buena.',
      'La brújula en vivo —panel Device y pestaña Compass del estereograma— se dibuja como una aguja de verdad: un rombo partido en dos mitades de color, la punta hacia la dirección de manteo. Antes dibujaba el mismo símbolo de rumbo y manteo que va en el mapa, que sobre un disco graduado se leía como una brújula mal calibrada y no como una brújula.',
    ],
  },
  {
    version: '0.30.0',
    items: [
      'Colocar una medida devuelve la herramienta a Elegir: el toque siguiente ya no crea otra sin querer, y la medida recién puesta queda seleccionada para corregirla.',
      'Se deja de preguntar el tipo de superficie en dos sitios a la vez. Al crear la medida solo queda el cuadro de tipo y unidad, y baja al PIE de la pantalla —apoyado sobre la barra de herramientas— para contestarlo con el pulgar sin soltar el teléfono. Encabeza con el rumbo y el manteo que se acaban de anotar, para poder desmentirlos ahí mismo y no en casa.',
      'El método Device ya no salta en superficies subverticales, que es justo donde más se usa. Eran tres fallos encadenados: la normal del teléfono se iba al hemisferio de abajo y el rumbo saltaba 180° entre dos lecturas de la misma pared; el promedio se hacía sobre ángulos en vez de sobre vectores, y promediar 0° y 180° no da nada; y en iOS el rumbo de la brújula se traducía con la fórmula del teléfono tumbado cuando ya estaba de pie, con otros 180° de error.',
      'En iOS, además, apoyar el teléfono en vertical contra una pared deja al magnetómetro sin poder decir dónde está el norte: ahora la app FIJA el norte mientras el teléfono está nivelado y lo mantiene con el giroscopio mientras se apoya, en vez de entregar un rumbo inventado. Si nunca se niveló, lo pide en vez de callarlo.',
      'La lectura llega con rechazo de atípicos —un clavo o la hebilla del cinturón metían una muestra disparatada— y no se da por buena hasta que el teléfono está de verdad quieto: el botón lo dice y la dispersión medida viaja con el dato al GeoPackage.',
      'La brújula se ve en tonos claros, que es lo único que se lee al sol, con el número grande y rotulado Strike (RHR) / Dip: un «120/45» a secas no dice si esos 120 son rumbo o dirección de manteo, y las dos lecturas difieren en 90°. Debajo, hacia dónde mantea. Antes el número quedaba fuera del lienzo y no se veía en ninguna parte.',
      'El estereograma dibuja ahora la RED DE SCHMIDT de verdad —círculos máximos y menores cada 10°— en vez de circunferencias concéntricas con seis radios, que era un papel polar y no una red: sobre aquello no se podía rotar un dato, ni leer la intersección de dos planos, ni sacar un eje de pliegue.',
      'Y dibuja los planos además de los polos, cada familia con su casilla para apagarla: con cinco medidas se miran los ciclogramas y con cien los polos. Los polos se agrandan a 7 px, que era lo que costaba distinguirlos de un cruce de la propia red.',
      'La red va sobre papel claro: al sol una malla de líneas finas sobre fondo oscuro no se ve, y el SVG y el PNG exportados ya salen con el fondo que van a tener en una memoria.',
      'Digitize cambia de gesto: puestos los dos extremos de la traza de rumbo aparece un palito vertical de guía y arrastrar hacia un lado lo convierte en el manteo, con el número grande en pantalla mientras dura el gesto. Soltar el dedo lo CONGELA, no lo guarda: se puede volver a arrastrar cuantas veces haga falta para afinarlo, y solo Done —ya con el manteo puesto— lo convierte en la medida. Antes un solo arrastre decidía todo de una vez, sin poder corregirlo antes de soltarlo.',
    ],
  },
  {
    version: '0.29.0',
    items: [
      'Nueva pestaña Stereogram, arriba junto a Layers y Symbols: red estereográfica equiareal de los manteos seleccionados en el mapa —o de todos, si no hay selección—, coloreada por tipo de superficie. Un lazo propio sobre la red marca un cúmulo de polos y lo puede volver a seleccionar en el mapa. Exporta a SVG y PNG, y copia la imagen al portapapeles. Su pestaña Compass enseña la brújula en vivo del teléfono, de referencia, sin anotar nada.',
      'Nuevo método de medida: Create → Dip → Digitize levanta rumbo y manteo de un símbolo dibujado en el mapa —por ejemplo, en una carta geológica escaneada e importada—: dos toques marcan la traza del rumbo y un arrastre hacia un lado fija la dirección y la magnitud del manteo. La medida queda en el punto medio de los dos toques.',
      'El método Device cambia de flujo: en vez de tocar el mapa, se ve una brújula en vivo con el rumbo, el manteo y su error, y el botón Done ancla la medida en la posición del GPS —no donde caiga el dedo—. Por eso exige el GPS activo: sin posición no hay dónde ponerla, y lo avisa con un cuadro propio en vez de dejarlo fallar en silencio.',
      'Al colocar una medida —cualquiera sea el método— se abre solo un cuadro compacto para confirmar el tipo de superficie y la unidad, anclado arriba a la derecha para no taparle nunca Done/Cancelar/Borrar a la columna de la esquina, que era el fallo que se reportó con el método manual.',
    ],
  },
  {
    version: '0.28.0',
    items: [
      'Nuevo método de medida: Create → Dip → Device lee rumbo y manteo en vivo del giroscopio y el magnetómetro del teléfono, apoyando el dorso contra la superficie. La incertidumbre no es una cifra de catálogo: sale de cuánto varían entre sí las muestras tomadas mientras el teléfono está apoyado, igual que la de un plano ajustado al DEM.',
      'Se agrega el tipo «Dyke margin» a las superficies medibles, en el mismo rojo que la traza de un dique.',
      'Elegido el método de una medida, el panel se esconde para dejarle sitio al mapa —antes solo pasaba al elegir tipo de línea o de polígono—.',
      'La unidad geológica de una medida se elige en un menú desplegable en vez de una fila de chips, para no empujar el resto del panel fuera de la pantalla.',
      'Se quita de la barra de herramientas el botón de deshacer el último vértice: quedaba redundante con el Deshacer general de la esquina. El atajo de teclado (Backspace) sigue funcionando.',
    ],
  },
  {
    version: '0.27.0',
    items: [
      'Nuevo: Import → «Download this area…» baja el recuadro que se está mirando y lo deja disponible sin señal, diciendo cuánto pesa ANTES de empezar, con progreso y con botón de cancelar. Va a una caché propia que no se poda nunca y que sobrevive a publicar versiones nuevas.',
      'El modelo de elevación se baja con holgura porque es dominio público y pesa poco: un área de 10 × 10 km son unos 5 MB y con eso quedan offline las curvas, el sombreado, el relieve 3D, los perfiles y los ajustes de plano. El panel abre con el basemap en «None» por eso mismo.',
      'Los basemaps de OpenStreetMap y OpenTopoMap NO se pueden bajar por adelantado, y la app lo dice en vez de hacerlo igual: sus políticas prohíben expresamente la descarga masiva y son servidores pagados con donaciones. Para cobertura garantizada de imagen, la vía sigue siendo convertir la zona a PMTiles e importarla.',
      'Los de Esri sí, con tope de 1500 teselas por área y con la atribución a la vista.',
      'Borrar un área libera sus teselas, salvo las que compartan con otra área guardada.',
    ],
  },
  {
    version: '0.26.0',
    items: [
      'El lazo de Elegir se dibuja a mano alzada, que es lo de fábrica; el rectángulo sigue disponible en Ajustes.',
      'Elegir con el lazo ya no exige envolver el elemento entero: basta con rozarlo.',
      'Las cruces de cerrar de los paneles son cuadrados rojos con el aspa blanca: se ven y se aciertan con el dedo.',
      'La simbología de línea cubre también los contactos, y todo tipo de línea tiene color y grosor editables.',
      'El panel de capas reparte el dibujo en Unidades, Fallas y Medidas, y anida los fondos bajo su propia cabecera.',
      'Al bajar un dataset de StraboSpot se pregunta si se quiere editar: adoptarlo traduce su simbología —una falla inversa entra como cabalgamiento, la calidad de la traza como certeza, los tags de unidad como unidades— y lo deja editable.',
      'Lo adoptado de StraboSpot se dibuja de un color único, configurable en Símbolos, para distinguirlo de lo cartografiado aquí.',
    ],
  },
  {
    version: '0.25.5',
    items: [
      'Se arregla exportar a GeoPackage con al menos una medida de rumbo/manteo en el proyecto: la tabla de puntos no tenía las columnas de unidad que la propia exportación intentaba llenar, y la app fallaba en vez de entregar el archivo. Cualquier proyecto con medidas quedaba sin poder exportar desde que existe la unidad en la medida.',
      'La suite de pruebas de navegador (`test/browser.html`) vuelve a llegar al final: un fallo suelto de esa misma tabla la cortaba a la mitad en silencio, y una sección que depende de un CDN externo hacía lo mismo con todo lo que viene después si no hay red hasta ella. Las dos quedan aisladas para que un fallo no tape a los demás.',
    ],
  },
  {
    version: '0.25.4',
    items: [
      'Los mapas offline (.pmtiles/.mbtiles) y el modelo de elevación importados vuelven solos al abrir la app: hasta ahora se perdían al recargar y había que ir a buscarlos otra vez a Archivos antes de poder trabajar.',
      'Quitar un mapa del panel de capas lo borra también de lo guardado, y cargar un modelo de elevación nuevo reemplaza al anterior en vez de acumularlo.',
      'Lo que no vuelve es el orden ni la opacidad que tuvieran en el panel: eso es del proyecto, no del archivo, así que cada mapa reaparece con sus valores por omisión.',
    ],
  },
  {
    version: '0.25.3',
    items: [
      'El modelo de elevación propio (Import → Elevation model) ya alimenta el sombreado y el relieve 3D, no solo los perfiles y los ajustes de plano: antes esos dos seguían leyendo de AWS aunque hubiera un DEM cargado y con más señal en terreno del que la app usaba.',
      'Las curvas de nivel, por ahora, siguen leyendo de AWS pase lo que pase: la librería que las genera no deja sustituir de dónde lee sus teselas.',
    ],
  },
  {
    version: '0.25.2',
    items: [
      'La caché de basemaps y DEM ya no se borra al publicar una versión nueva: antes llevaba el número de versión en el nombre, así que un arreglo cualquiera de interfaz tiraba de un plumazo los cientos de MB que alguien había precargado la noche antes de salir a terreno.',
      'La app pide almacenamiento persistente al navegador, para que esa misma caché no la evicte el sistema bajo presión de disco ni, en Safari fuera de pantalla de inicio, por no abrirse en una semana.',
    ],
  },
  {
    version: '0.25.1',
    items: [
      'Borrar se esconde salvo con algo elegido con Elegir: mostrarlo cada vez que el proyecto tiene features guardadas lo dejaba a la vista todo el rato, igual que Deshacer y Rehacer, que es justo lo que no debía.',
      'En teléfono, dos dedos ya no bascula la vista en 3D con Elegir puesto, igual que ya no la giran: solo desplazan y hacen zoom.',
    ],
  },
  {
    version: '0.25.0',
    items: [
      'Merge se muda a Topology, junto a las demás herramientas que trabajan sobre la selección; su volante ya no recorta con una barra de desplazamiento, se ve entero.',
      'En teléfono, dos dedos ya no giran la vista: con Elegir puesto, arrastrarlos desplaza y separarlos hace zoom, como el pellizco de siempre.',
      'En teléfono, la tira de herramientas baja hasta el borde de abajo: ya no reserva sitio para una barra de estado que se fue arriba.',
      'Deshacer y Rehacer se quedan siempre a la vista en su columna; Hecho, Cancelar y Borrar solo aparecen cuando hay algo a medio trazar o ya guardado.',
    ],
  },
  {
    version: '0.24.0',
    items: [
      'Deshacer, Rehacer, Hecho, Cancelar y Borrar se van de la barra de herramientas a su propia columna: arriba a la derecha en PC, abajo a la derecha en tablet, abajo a la izquierda sobre la tira en teléfono.',
      'En teléfono, la escala gráfica se muda arriba a la izquierda y la numérica arriba a la derecha; el mensaje de estado y el contador de elementos, que ya no cabían abajo, se retiran.',
      'En teléfono, elegir un tipo de línea o de polígono en la paleta la cierra sola: en PC y tablet se queda abierta.',
      'Elegir ya no se ve con la manito de Navegar: es una flecha, como en cualquier programa de escritorio.',
      'El botón central del ratón desplaza la vista también con Elegir puesto, no solo mientras se dibuja.',
    ],
  },
  {
    version: '0.23.0',
    items: [
      'Los grupos Create y Topology se despliegan también en teléfono: antes la tira de abajo recortaba el menú y parecía que el botón no hacía nada.',
      'Topology ya no se queda marcado en verde solo porque Snap o Follow trace estén encendidos.',
      'Vuelve el lazo rectangular: con Elegir, arrastrar encierra y selecciona; un toque simple sigue eligiendo de a uno.',
      'Este panel.',
    ],
  },
  {
    version: '0.22.0',
    items: [
      'Los botones de la barra se agrupan en Create y Topology, que se abren al lado como en Illustrator.',
      'Una medida de rumbo y manteo puede llevar unidad geológica, igual que un polígono.',
      'Al subir a StraboSpot, el error del ajuste sobre el DEM (σ, RMS, base) va en las notas del spot.',
      'Se retira el diagnóstico del lápiz (presión, inclinación) de la pantalla.',
    ],
  },
  {
    version: '0.21.0',
    items: [
      'Exportar la vista del mapa como lámina: marco con coordenadas, escala gráfica y norte, en SVG, PNG o PDF.',
      'Rotular los polígonos con el código de su unidad, solo donde cabe y repartido entre unidades.',
      'En tablet, todas las herramientas quedan a la vista: la barra envuelve en columnas en vez de recortarse.',
    ],
  },
  {
    version: '0.20.0',
    items: [
      'Subida a StraboSpot en su modelo nativo: las medidas llegan como orientaciones planares, las líneas como trazas y las unidades como tags del proyecto.',
      'Clic derecho y pulsación sostenida abren el menú de atributos en cualquier herramienta.',
      'Dibujar sobre el relieve 3D deja de trabarse.',
    ],
  },
  {
    version: '0.19.0',
    items: [
      'Perfiles estructurales: proyectar manteos a una sección con su manteo aparente.',
      'Espesor estratigráfico medido desde una medida y el DEM.',
      'Traza de afloramiento: proyectar un plano medido sobre el terreno.',
    ],
  },
];
