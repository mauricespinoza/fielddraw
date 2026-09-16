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

export const APP_VERSION = '0.24.0';

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
