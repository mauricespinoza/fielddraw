/**
 * Trazo libre: de pantalla a lng/lat sin pagar dos veces por el mismo punto.
 *
 * En planta, `map.unproject` es aritmética y da igual llamarla mil veces. Con
 * el relieve 3D puesto NO lo es: MapLibre averigua qué punto del terreno hay
 * bajo el píxel leyendo el framebuffer de coordenadas con `gl.readPixels`, lo
 * que obliga a la GPU a terminar todo lo pendiente y devolver el resultado
 * antes de seguir. Cada punto cuesta milisegundos.
 *
 * Convertir el trazo ENTERO en cada frame —que es lo que se hacía— pedía N
 * lecturas por frame, con N creciendo con el propio trazo: a doscientos puntos
 * son más de diez mil lecturas por segundo, y el navegador da la página por
 * colgada. Ese era el cuelgue al digitalizar en 3D, y no el relieve en sí.
 *
 * Aquí cada punto se convierte UNA vez. Con el relieve puesto se descartan
 * además los que no separan ni unos pocos píxeles: el trazo se simplifica
 * igual al cerrarlo, así que no se pierde nada que fuera a sobrevivir.
 */

/**
 * @param {(p: number[]) => number[]} toLngLat  conversión de un punto suelto
 */
export function createStrokeBuffer(toLngLat) {
  /** Puntos convertidos, en pantalla y en lng/lat, en paralelo. */
  let screen = [];
  let lngLat = [];
  /** Cuántos puntos del trazo crudo se han mirado ya. */
  let seen = 0;

  return {
    get screen() {
      return screen;
    },
    get lngLat() {
      return lngLat;
    },

    reset() {
      screen = [];
      lngLat = [];
      seen = 0;
    },

    /**
     * Convierte lo que haya llegado nuevo y devuelve el trazo en lng/lat.
     *
     * @param {number[][]} points  trazo crudo COMPLETO, tal como lo acumula el
     *   controlador; de él solo se mira la cola que aún no se ha visto
     * @param {number} step  separación mínima en px entre puntos convertidos
     */
    push(points, step = 0) {
      // El vaciado con que el controlador anuncia el fin del trazo no borra la
      // caché: `onStrokeEnd` llega justo después y todavía la necesita.
      if (points.length === 0) return lngLat;
      // Un trazo más corto que lo ya visto es otro trazo.
      if (points.length < seen) this.reset();
      for (let i = seen; i < points.length; i++) {
        const p = points[i];
        const previo = screen[screen.length - 1];
        if (previo && Math.hypot(p[0] - previo[0], p[1] - previo[1]) < step) continue;
        screen.push(p);
        lngLat.push(toLngLat(p));
      }
      seen = points.length;
      return lngLat;
    },

    /**
     * El trazo ya simplificado, en lng/lat.
     *
     * Lo que salga de la caché no se vuelve a convertir. Los extremos sí
     * pueden venir movidos por el enganche, y esos se convierten: son dos
     * lecturas, no doscientas.
     */
    coordsFor(processed) {
      const cache = new Map();
      for (let i = 0; i < screen.length; i++) {
        cache.set(`${screen[i][0]},${screen[i][1]}`, lngLat[i]);
      }
      return processed.map((p) => cache.get(`${p[0]},${p[1]}`) || toLngLat(p));
    },
  };
}
