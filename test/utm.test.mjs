const BASE = '../src/';
let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};
const cerca = (a, b, tol) => Math.abs(a - b) <= tol;

const { toUTM, formatUTM, formatLat, formatLon, zonaUTM, bandaUTM } = await import(BASE + 'utm.js');

console.log('== lat/long -> UTM (WGS84) ==');

// Meridiano central del huso 18 (75°W) en el ecuador: 500000 E, 0 N.
let u = toUTM(0, -75);
ok('ecuador sobre el meridiano central: 500000 E', cerca(u.easting, 500000, 1e-3), `${u.easting}`);
ok('ecuador sobre el meridiano central: 0 N', cerca(u.northing, 0, 1e-3), `${u.northing}`);
ok('huso 18', u.zone === 18);

// Meridiano central a 45°N: la distancia meridiana al ecuador es
// M = 4 984 944,378 m en el elipsoide WGS84, y el norte UTM es k0 · M.
u = toUTM(45, -75);
ok('45°N, meridiano central: este 500000', cerca(u.easting, 500000, 1e-3));
ok('45°N, meridiano central: norte k0·M = 4982950,400', cerca(u.northing, 4984944.378 * 0.9996, 0.01), `${u.northing}`);

// Concepción, Chile (36,827°S 73,050°W) cae en el huso 18 H.
u = toUTM(-36.827, -73.0503);
ok('Concepción: huso 18, banda H', u.zone === 18 && u.band === 'H', `${u.zone}${u.band}`);
ok('Concepción: hemisferio sur', u.south === true);
ok('Concepción: este ~ 673 km', u.easting > 660000 && u.easting < 690000, `${u.easting}`);
ok('Concepción: norte ~ 5 922 km (falso norte sumado)', u.northing > 5.9e6 && u.northing < 5.95e6, `${u.northing}`);
ok('formato: 18H este norte', /^18H \d{6} \d{7}$/.test(formatUTM(u)), formatUTM(u));

// Simetría: el mismo punto en el norte y en el sur difiere por el falso norte.
const n = toUTM(36.827, -73.0503);
const s = toUTM(-36.827, -73.0503);
ok('simetría N/S: mismo este', cerca(n.easting, s.easting, 1e-6));
ok('simetría N/S: norte difiere en 10 000 000', cerca(n.northing + s.northing, 10000000, 1e-3));

console.log('== husos y bandas ==');
ok('Noruega se corre al 32V', zonaUTM(60, 5) === 32);
ok('Svalbard usa 33X', zonaUTM(78, 15) === 33);
ok('lon 180 queda en el huso 60', zonaUTM(0, 180) === 60);
ok('banda: -80 es C', bandaUTM(-80) === 'C');
ok('banda: 84 es X', bandaUTM(84) === 'X');
ok('banda: sin I ni O', !'CDEFGHJKLMNPQRSTUVWX'.includes('I') && !'CDEFGHJKLMNPQRSTUVWX'.includes('O'));

console.log('== bordes y texto ==');
ok('polos: sin UTM', toUTM(85, 0) === null && toUTM(-81, 0) === null);
ok('NaN: sin UTM', toUTM(NaN, 0) === null);
ok('latitud sur con letra S', formatLat(-36.827) === '36.827000° S');
ok('longitud oeste con letra W', formatLon(-73.0503) === '73.050300° W');
ok('latitud norte con letra N', formatLat(10) === '10.000000° N');

if (fails) {
  console.log(`\n${fails} FALLAN`);
  process.exit(1);
}
console.log('\ntodo bien');
