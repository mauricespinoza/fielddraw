/**
 * Tiempo de marcha sobre un tramo del perfil.
 *
 * Reglas estándar de montañismo, sin DOM ni store para poder probarlas:
 *
 *  - Naismith: una velocidad horizontal más un recargo por cada metro que se
 *    SUBE (5 km/h y 1 h por cada 600 m de ascenso, en su versión clásica).
 *  - Langmuir: corrige la BAJADA. En pendientes suaves (5°–12°) se camina más
 *    rápido que en plano y se descuentan 10 min por cada 300 m de descenso; en
 *    pendientes fuertes (>12°) se frena para no caerse y se SUMAN 10 min por
 *    cada 300 m. En menos de 5° no hay corrección.
 *
 * Por eso el tiempo NO es simétrico: ida y vuelta por el mismo tramo no
 * demoran lo mismo. Subir siempre cuesta más que el plano; bajar cuesta menos
 * si es suave y más si es empinado.
 *
 * Los tres niveles escalan los parámetros de Naismith: quien camina con menos
 * fondo hace menos km/h y sube más lento.
 */

export const LEVELS = {
  amateur: { id: 'amateur', label: 'Amateur', speed: 4, ascent: 400, color: '#22c55e' },
  normal: { id: 'normal', label: 'Normal', speed: 5, ascent: 600, color: '#f59e0b' },
  expert: { id: 'expert', label: 'Expert', speed: 6, ascent: 800, color: '#a855f7' },
};

export const LEVEL_IDS = Object.keys(LEVELS);

/** Langmuir: minutos por cada 300 m de bajada. */
const LANGMUIR_MIN_PER_300M = 10;
const GENTLE_MIN_DEG = 5;
const STEEP_MIN_DEG = 12;

/** Interpola la cota en `s`; NaN en un hueco o fuera del perfil. */
export function elevationInterp(samples, s) {
  if (!samples || samples.length === 0) return NaN;
  let prev = null;
  for (const m of samples) {
    if (!Number.isFinite(m.elevation)) {
      prev = null;
      continue;
    }
    if (m.distance === s) return m.elevation;
    if (prev && prev.distance < s && m.distance > s) {
      const u = (s - prev.distance) / (m.distance - prev.distance);
      return prev.elevation + u * (m.elevation - prev.elevation);
    }
    prev = m;
  }
  return NaN;
}

/** Minutos para un tramo horizontal `d` (m) con desnivel `dz` (m, + sube). */
export function legMinutes(d, dz, level) {
  const L = LEVELS[level] || LEVELS.normal;
  const plano = (d / 1000 / L.speed) * 60;
  if (dz >= 0) return plano + (dz / L.ascent) * 60;
  const baja = -dz;
  const grados = (Math.atan2(baja, d) * 180) / Math.PI;
  let t = plano;
  if (grados >= STEEP_MIN_DEG) t += (baja / 300) * LANGMUIR_MIN_PER_300M;
  else if (grados >= GENTLE_MIN_DEG) t -= (baja / 300) * LANGMUIR_MIN_PER_300M;
  // Nunca más de dos veces más rápido que en plano: la regla es lineal y en
  // un tramo muy suelto y corto se iría a cero o negativo.
  return Math.max(t, plano * 0.5);
}

/**
 * Tiempo, distancia y desnivel de caminar de `from` a `to` (posiciones `s` a
 * lo largo del perfil, en metros; `to < from` es caminar hacia atrás).
 *
 * Se integra sobre las muestras del perfil, con los extremos interpolados. Un
 * hueco sin cota en medio hace el resultado `null`: no se inventa el tiempo.
 */
export function walkingTime(samples, from, to, level = 'normal') {
  if (!Array.isArray(samples) || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const dir = to >= from ? 1 : -1;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  if (hi - lo <= 0) return { minutes: 0, distance: 0, ascent: 0, descent: 0 };

  const zLo = elevationInterp(samples, lo);
  const zHi = elevationInterp(samples, hi);
  if (!Number.isFinite(zLo) || !Number.isFinite(zHi)) return null;

  const pts = [{ distance: lo, elevation: zLo }];
  for (const m of samples) {
    if (m.distance > lo && m.distance < hi) {
      if (!Number.isFinite(m.elevation)) return null;
      pts.push({ distance: m.distance, elevation: m.elevation });
    }
  }
  pts.push({ distance: hi, elevation: zHi });
  if (dir < 0) pts.reverse();

  let minutes = 0;
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.abs(pts[i].distance - pts[i - 1].distance);
    const dz = pts[i].elevation - pts[i - 1].elevation;
    if (d <= 0) continue;
    minutes += legMinutes(d, dz, level);
    if (dz > 0) ascent += dz;
    else descent -= dz;
  }
  return { minutes, distance: hi - lo, ascent, descent };
}

/** "1 h 25 min" / "42 min" / "<1 min". */
export function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const total = Math.round(minutes);
  if (total < 1) return '<1 min';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
