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

export const APP_VERSION = '0.26.0';

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
  ['Create · Line', 'Contactos, fallas, pliegues y diques. El tipo y la certeza —observado, inferido, cubierto— salen de la paleta.'],
  ['Create · Polygon', 'Unidades de mapa. Cada polígono lleva la unidad activa, con su color y su código.'],
  ['Create · Dip', 'Rumbo y manteo: con brújula, por tres puntos sobre el DEM, o ajustando un plano a una traza dibujada. Cada medida viaja con su incertidumbre.'],
  ['Select', 'Elegir con un toque, o arrastrar para el lazo rectangular. Mantener pulsado abre los atributos.'],
  ['Topology · Edit Nodes', 'Mover, añadir y borrar vértices de lo ya dibujado.'],
  ['Topology · Hole', 'Restar un área a un polígono y dejar un hueco.'],
  ['Topology · Split · Reshape', 'Cortar un elemento con una línea, o redibujar un tramo de su contorno.'],
  ['Topology · Snap · Follow trace', 'Enganchar a la geometría existente y recorrer el borde de otro elemento.'],
  ['Topology · Merge', 'Unir dos o más elementos seleccionados del mismo tipo de geometría en uno solo.'],
  ['Profile', 'Perfil topográfico de una traza, leído del modelo de elevación.'],
  ['3D', 'Relieve para mirar la ladera. Línea y Polígono siguen dibujando.'],
  ['Scale', 'Escala de trabajo: elegirla, fijar el mapa a ella y calibrar el tamaño real de la pantalla.'],
  ['Layers · Units · Symbols', 'Capas y su opacidad, catálogo de unidades y simbología de fallas y pliegues.'],
  ['Import · Export', 'GeoPackage, shapefile, GeoJSON y mapas offline (MBTiles/PMTiles); salida a GeoPackage con su QML.'],
  ['StraboSpot', 'Bajar spots de un dataset y subir el dibujo como dataset nuevo, en el modelo de datos nativo.'],
  ['Project', 'Guardar y abrir el trabajo, y exportar la vista como lámina en SVG, PNG o PDF.'],
];

/**
 * Registro de cambios, del más nuevo al más viejo. `items` son frases
 * completas: quien lo lee quiere saber qué cambió para él, no qué archivo se
 * tocó.
 */
export const CHANGELOG = [
  {
    version: '0.26.0',
    items: [
      'Nuevo: Import → «Download this area…» baja el recuadro que se está mirando y lo deja disponible sin señal, diciendo cuánto pesa ANTES de empezar, con progreso y con botón de cancelar. Va a una caché propia que no se poda nunca y que sobrevive a publicar versiones nuevas.',
      'El modelo de elevación se baja con holgura porque es dominio público y pesa poco: un área de 10 × 10 km son unos 5 MB y con eso quedan offline las curvas, el sombreado, el relieve 3D, los perfiles y los ajustes de plano. El panel abre con el basemap en «None» por eso mismo.',
      'Los basemaps de OpenStreetMap y OpenTopoMap NO se pueden bajar por adelantado, y la app lo dice en vez de hacerlo igual: sus políticas prohíben expresamente la descarga masiva y son servidores pagados con donaciones. Para cobertura garantizada de imagen, la vía sigue siendo convertir la zona a PMTiles e importarla.',
      'Los de Esri sí, con tope de 1500 teselas por área y con la atribución a la vista.',
      'Borrar un área libera sus teselas, salvo las que compartan con otra área guardada.',
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
