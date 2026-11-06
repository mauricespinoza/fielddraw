/**
 * Declinación magnética del WMM2025 (src/geomag.js).
 *
 * Los valores de referencia son declinaciones conocidas de mediados de 2025,
 * con ±0,3° de tolerancia: lo que se comprueba es que el desarrollo en
 * armónicos esté bien armado (signos, normalización de Schmidt, paso de
 * geodésica a geocéntrica) —un error ahí se va a grados o decenas de
 * grados—, no el modelo en sí.
 */
const G = await import('../src/geomag.js');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

console.log('== WMM2025: declinación ==');
const fecha = new Date(Date.UTC(2025, 6, 1));
for (const [nombre, lat, lon, esperado] of [
  ['Boulder', 40.015, -105.27, 7.8],
  ['Londres', 51.5, -0.13, 1.0],
  ['Tokio', 35.68, 139.69, -7.9],
  ['Sídney', -33.87, 151.21, 12.8],
  ['São Paulo', -23.55, -46.63, -21.8],
  ['Punta Arenas', -53.16, -70.9, 12.6],
]) {
  const d = G.magneticDeclination(lat, lon, 0, fecha);
  ok(`${nombre}: ${esperado}°`, Math.abs(d - esperado) <= 0.3, `${d.toFixed(2)}`);
}

const f = G.geomagneticField(-36.83, -73.05, 0, fecha);
const F = Math.hypot(f.X, f.Y, f.Z);
ok('Concepción: intensidad total ~24 µT (anomalía del Atlántico Sur)', F > 22000 && F < 27000, `${F}`);
ok('Concepción: inclinación hacia arriba (hemisferio sur)', f.inclination < -30 && f.inclination > -45, `${f.inclination}`);
ok('dentro del período de validez', f.valid === true);
ok('fuera de validez se marca', G.geomagneticField(-36.83, -73.05, 0, new Date(Date.UTC(2031, 0, 1))).valid === false);

// La variación secular mueve la declinación despacio: décimas por año.
const d25 = G.magneticDeclination(-36.83, -73.05, 0, new Date(Date.UTC(2025, 0, 1)));
const d29 = G.magneticDeclination(-36.83, -73.05, 0, new Date(Date.UTC(2029, 0, 1)));
ok('variación secular de décimas de grado por año', Math.abs(d29 - d25) < 2 && Math.abs(d29 - d25) > 0.01, `${d25} -> ${d29}`);

console.log('== formato ==');
ok('Este', G.formatDeclination(4.56) === '4.6° E');
ok('Oeste', G.formatDeclination(-21.84) === '21.8° W');
ok('sin dato', G.formatDeclination(NaN) === '—');

console.log('== preferencia y posición ==');
ok('sin posición: NaN', Number.isNaN(G.declinationHere()));
ok('sin posición: no corrige', G.activeDeclination() === 0);
G.noteDeclinationPosition(-53.16, -70.9);
ok('con posición: corrige', Math.abs(G.activeDeclination() - G.declinationHere()) < 1e-12 && G.activeDeclination() > 10);
G.setTrueNorth(false);
ok('norte magnético: no corrige', G.activeDeclination() === 0);
G.setTrueNorth(true);

console.log(fails ? `\n${fails} FALLADAS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
