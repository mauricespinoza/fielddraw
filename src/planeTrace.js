/**
 * Traza de afloramiento de un plano sobre la topografía.
 *
 * El problema inverso del que resuelve `structure.js`. Allí se parte de una
 * traza dibujada y se calcula el plano; aquí se parte de un plano —una medida
 * de rumbo y manteo ya tomada— y se calcula **dónde saldría ese plano en
 * superficie** si siguiera siendo el mismo a lo largo de unos kilómetros.
 *
 * Es la regla de la V de toda la vida, hecha con el DEM en vez de a ojo sobre
 * las curvas de nivel: un contacto de bajo manteo cruzando una quebrada dibuja
 * una V que apunta aguas arriba, y cuánto se abre esa V depende del manteo y
 * de la pendiente del valle. Calcularla a mano sobre una carta es lento y
 * sistemáticamente optimista; calcularla sobre el modelo tarda un segundo y se
 * puede comprobar caminando.
 *
 * Lo que la traza **es** y lo que **no**: es una predicción geométrica, no un
 * dato. Afirma que el plano medido en UN punto sigue siendo plano y sigue
 * teniendo la misma orientación hasta donde se pidió. Eso es cierto a cientos
 * de metros en una secuencia tranquila y falso en cuanto hay un pliegue, una
 * falla o un cambio de manteo. Por eso la traza se entrega como una línea más
 * del dibujo, que se edita y se borra como cualquier otra, y no como un
 * resultado con autoridad propia.
 *
 * ---
 *
 * La matemática, en el sistema local (s, u) con origen en el punto de la
 * medida: `s` corre a lo largo del **rumbo** y `u` a lo largo de la
 * **dirección de manteo**, los dos en metros sobre el plano del mapa.
 *
 * El plano pasa por el punto y baja `tan δ` por cada metro de `u`:
 *
 *     z_plano(s, u) = z₀ − u · tan δ
 *
 * La traza es donde el plano y el terreno se cortan, o sea el cero de
 *
 *     g(s, u) = (z_DEM(s, u) − z₀) · cos δ + u · sen δ
 *
 * que es la ecuación de arriba multiplicada por `cos δ`. Se escribe así y no
 * con la tangente por un caso concreto: un plano **vertical**. Con `tan 90°`
 * la primera forma es una división por cero, mientras que la segunda queda en
 * `g = u`, cuyo cero es `u = 0` — que es exactamente la respuesta correcta,
 * porque un plano vertical aflora en línea recta siga el terreno lo que siga.
 *
 * Para cada `s` se busca el cero de `g` en `u`. Se toma **el más cercano al
 * anterior**, no el primero ni el más chico: `g` puede tener varios ceros —un
 * plano aflora dos veces a los lados de una loma— y lo que se quiere es
 * seguir UNA traza continua, no saltar entre ramas.
 */

const DEG = Math.PI / 180;

/** Los mismos de `structure.js`: la app trabaja en equirectangular local. */
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320;

/**
 * Por debajo de este manteo no se traza, y no es una limitación técnica.
 *
 * Con el plano casi horizontal la traza deja de seguir al rumbo y pasa a ser
 * una **curva de nivel**: a 1° de manteo, 10 m de desnivel mueven la traza
 * 570 m de lado. Ahí el rumbo ya no orienta nada —es el mismo umbral bajo el
 * que la app dibuja el símbolo horizontal, sin tick, porque un manteo así no
 * declara dirección— y pedir "tantos km hacia cada lado del rumbo" no
 * significaría nada.
 */
export const MIN_TRACE_DIP_DEG = 3;

/** Tope por lado, en km. Más allá la hipótesis de plano único es indefendible. */
export const MAX_TRACE_KM = 20;

/** Lo que se ofrece de partida: el orden de magnitud de un afloramiento. */
export const DEFAULT_TRACE_KM = 1;

const norm360 = (d) => ((d % 360) + 360) % 360;

/**
 * Cuánto se puede alejar la traza de la recta del rumbo antes de darla por
 * perdida. Se ata a lo que se pidió trazar: buscar un cruce a diez kilómetros
 * de la línea cuando se pidió medio kilómetro de traza no encuentra la misma
 * capa, encuentra otra ladera.
 */
export function corridorFor(backKm, forwardKm) {
  return Math.min(8000, Math.max(750, (backKm + forwardKm) * 1000));
}

/**
 * Traza el afloramiento del plano a lo largo del rumbo.
 *
 * @param {object} opts
 * @param {[number,number]} opts.origin  punto de la medida, [lng, lat]
 * @param {number} opts.strike           rumbo en grados (regla de la mano derecha)
 * @param {number} opts.dip              manteo en grados
 * @param {number} [opts.dipAzimuth]     dirección de manteo; si falta, rumbo+90
 * @param {number} opts.backKm           km hacia el lado opuesto al rumbo
 * @param {number} opts.forwardKm        km hacia el rumbo
 * @param {(lng:number, lat:number) => Promise<number|null>} opts.elevationAt
 * @param {number} [opts.resolution]     celda nominal del DEM, en metros
 * @param {number} [opts.maxOffsetM]     ancho del corredor de búsqueda
 * @param {number} [opts.maxPointsPerSide]
 * @param {number} [opts.toleranceM]     cuándo se da un cero por encontrado
 */
export async function traceFromPlane({
  origin,
  strike,
  dip,
  dipAzimuth,
  backKm = DEFAULT_TRACE_KM,
  forwardKm = DEFAULT_TRACE_KM,
  elevationAt,
  resolution = 30,
  maxOffsetM,
  maxPointsPerSide = 400,
  toleranceM = 0.25,
} = {}) {
  const fail = (reason) => ({ ok: false, reason, coords: [], warnings: [] });

  if (!Array.isArray(origin) || !Number.isFinite(origin[0]) || !Number.isFinite(origin[1])) {
    return fail('That measurement has no position to trace from.');
  }
  if (typeof elevationAt !== 'function') return fail('No elevation source available.');

  const manteo = Number(dip);
  if (!Number.isFinite(manteo)) return fail('That measurement has no dip to trace from.');
  if (manteo < MIN_TRACE_DIP_DEG) {
    return fail(
      `A ${manteo.toFixed(0)}° dip is too flat to trace along strike: below ${MIN_TRACE_DIP_DEG}° the plane outcrops along a contour line, not along its strike, and the strike no longer points anywhere. Draw it as a contour instead.`,
    );
  }

  const atras = Math.max(0, Math.min(MAX_TRACE_KM, Number(backKm) || 0));
  const adelante = Math.max(0, Math.min(MAX_TRACE_KM, Number(forwardKm) || 0));
  if (atras + adelante <= 0) return fail('Ask for some distance to either side of the point.');

  /*
   * La dirección de manteo manda sobre el rumbo cuando las dos vienen en la
   * medida: es la que usa el símbolo dibujado, así que la traza sale del mismo
   * plano que se está viendo en pantalla. El rumbo se recalcula desde ella
   * para que las dos no puedan discrepar a mitad de cuenta.
   */
  const az = Number.isFinite(Number(dipAzimuth))
    ? norm360(Number(dipAzimuth))
    : norm360(Number(strike) + 90);
  const rumbo = norm360(az - 90);

  const sS = Math.sin(rumbo * DEG);
  const cS = Math.cos(rumbo * DEG);
  const sA = Math.sin(az * DEG);
  const cA = Math.cos(az * DEG);
  const sD = Math.sin(manteo * DEG);
  const cD = Math.cos(manteo * DEG);

  const lat0 = origin[1];
  const mPorGradoLng = M_PER_DEG_LNG * Math.max(Math.cos(lat0 * DEG), 1e-6);
  const aLngLat = (e, n) => [origin[0] + e / mPorGradoLng, lat0 + n / M_PER_DEG_LAT];
  const puntoDe = (s, u) => aLngLat(s * sS + u * sA, s * cS + u * cA);

  const z0 = await elevationAt(origin[0], origin[1]);
  if (!Number.isFinite(z0)) {
    return fail('The DEM has no elevation at that point, so there is no plane to project.');
  }

  /*
   * El paso a lo largo del rumbo. Media celda del modelo es el detalle máximo
   * que el dato aguanta: por debajo se estaría interpolando y la V de una
   * quebrada no saldría ni más fina ni más cierta. El presupuesto de puntos es
   * lo que evita que pedir veinte kilómetros dispare decenas de miles de
   * lecturas.
   */
  const largoMax = Math.max(atras, adelante) * 1000;
  const paso = Math.max(resolution / 2, largoMax / maxPointsPerSide);
  const corredor = Number.isFinite(Number(maxOffsetM))
    ? Number(maxOffsetM)
    : corridorFor(atras, adelante);
  const sonda0 = Math.max(5, resolution / 4);

  let lecturas = 1;
  const gEn = async (s, u) => {
    lecturas++;
    const [lng, lat] = puntoDe(s, u);
    const z = await elevationAt(lng, lat);
    return Number.isFinite(z) ? (z - z0) * cD + u * sD : null;
  };

  /** Bisección entre dos sondas de signo opuesto. Siempre converge. */
  const bisecar = async (s, a, ga, b) => {
    let lo = a;
    let glo = ga;
    let hi = b;
    for (let i = 0; i < 40 && Math.abs(hi - lo) > toleranceM; i++) {
      const mid = (lo + hi) / 2;
      const gm = await gEn(s, mid);
      if (gm === null) return null;
      if (Math.sign(gm) === Math.sign(glo)) {
        lo = mid;
        glo = gm;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) / 2;
  };

  /**
   * Dónde corta el plano al terreno en esta sección, partiendo de donde cortó
   * en la anterior.
   *
   * Se abre en abanico a los DOS lados de la semilla a la vez y con paso
   * creciente: el cruce casi siempre está a unos metros —la traza es continua—
   * pero en una quebrada profunda puede irse cientos, y una búsqueda lineal
   * capaz de llegar hasta allí costaría cien lecturas en el caso normal. Al
   * alternar lado se devuelve el cruce **más cercano**, que es el que
   * pertenece a esta misma traza y no a la rama de la ladera siguiente.
   */
  const resolverU = async (s, semilla) => {
    const g0 = await gEn(s, semilla);
    if (g0 === null) return null;
    if (Math.abs(g0) <= toleranceM) return semilla;

    const previo = [
      { u: semilla, g: g0 },
      { u: semilla, g: g0 },
    ];
    let d = sonda0;
    while (d <= corredor * 2) {
      for (let k = 0; k < 2; k++) {
        const u = semilla + (k === 0 ? d : -d);
        if (Math.abs(u) > corredor) continue;
        const g = await gEn(s, u);
        if (g === null) {
          previo[k] = { u, g: null };
          continue;
        }
        if (Math.abs(g) <= toleranceM) return u;
        const p = previo[k];
        if (p.g !== null && Math.sign(g) !== Math.sign(p.g)) {
          const raiz = await bisecar(s, p.u, p.g, u);
          if (raiz !== null) return raiz;
        }
        previo[k] = { u, g };
      }
      d *= 1.7;
    }
    return null;
  };

  const warnings = [];
  let desvioMax = 0;

  const lado = async (dir, km) => {
    const salida = [];
    const n = Math.round((km * 1000) / paso);
    let u = 0;
    for (let i = 1; i <= n; i++) {
      const s = dir * i * paso;
      const siguiente = await resolverU(s, u);
      if (siguiente === null) {
        warnings.push(
          `The trace leaves the ${Math.round(corredor)} m search corridor ${fmtKm(Math.abs(s))} ${dir > 0 ? 'along' : 'against'} strike; it is cut there. A gentler dip or rougher ground needs a longer run to stay on the same surface.`,
        );
        break;
      }
      u = siguiente;
      desvioMax = Math.max(desvioMax, Math.abs(u));
      salida.push(puntoDe(s, u));
    }
    return salida;
  };

  const atrasPts = await lado(-1, atras);
  const adelantePts = await lado(1, adelante);
  const coords = [...atrasPts.reverse(), [origin[0], origin[1]], ...adelantePts];

  if (coords.length < 2) {
    return fail(
      'The plane and the ground do not meet anywhere near that point, so there is no trace to draw.',
    );
  }

  /*
   * Un manteo suave amplifica cualquier error del modelo: el desplazamiento
   * lateral de la traza es el error vertical dividido por `tan δ`, así que a
   * 5° un metro mal leído en el DEM son once metros de traza mal puesta.
   */
  if (manteo < 10) {
    warnings.push(
      `At ${manteo.toFixed(0)}° the trace is very sensitive to the DEM: every metre of vertical error moves it ${Math.round(1 / Math.tan(manteo * DEG))} m sideways.`,
    );
  }

  return {
    ok: true,
    coords,
    warnings,
    strike: rumbo,
    dipAzimuth: az,
    dip: manteo,
    elevation: z0,
    stats: {
      step: paso,
      corridor: corredor,
      maxOffset: desvioMax,
      samples: lecturas,
      points: coords.length,
      backKm: atras,
      forwardKm: adelante,
    },
  };
}

function fmtKm(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
