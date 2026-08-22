const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const T = await import(BASE + 'thickness.js');

const P = (x, y, z) => ({ x, y, z });

console.log('== la normal a la capa ==');
{
  // Horizontal: la normal apunta al cenit.
  const h = T.normalFromStrikeDip(0, 0);
  ok('una capa horizontal tiene normal vertical', cerca(h[2], 1) && cerca(h[0], 0, 1e-9));
  // Vertical con rumbo N-S: la normal es horizontal y mira al Este, que es
  // hacia donde mantea (rumbo + 90).
  const v = T.normalFromStrikeDip(0, 90);
  ok('una capa vertical N-S tiene normal al Este', cerca(v[0], 1) && cerca(v[2], 0, 1e-9));
  const e = T.normalFromStrikeDip(90, 90);
  ok('con rumbo E-W la normal mira al Sur', cerca(e[1], -1) && cerca(e[0], 0, 1e-9));
  ok('la normal es unitaria',
     cerca(Math.hypot(...T.normalFromStrikeDip(37, 41)), 1));
}

console.log('== el espesor no es la distancia ==');
{
  /*
   * Los tres casos que separan el espesor verdadero de lo que se mide sin
   * pensar. Sobre una capa de 30°, medir 100 m en planta y anotar 100 m de
   * espesor sobra en un factor dos.
   */
  const horizontal = T.thicknessFromENU(P(0, 0, 0), P(100, 0, 50), 0, 0);
  ok('en capa horizontal el espesor es la diferencia de cotas',
     cerca(horizontal.thickness, 50), String(horizontal.thickness));
  ok('y NO la distancia recorrida', !cerca(horizontal.thickness, horizontal.separation));

  const vertical = T.thicknessFromENU(P(0, 0, 0), P(100, 0, 0), 0, 90);
  ok('en capa vertical es la distancia perpendicular al rumbo',
     cerca(vertical.thickness, 100));

  const treinta = T.thicknessFromENU(P(0, 0, 0), P(100, 0, 0), 0, 30);
  ok('a 30° de manteo, 100 m en planta son 50 m de espesor',
     cerca(treinta.thickness, 100 * Math.sin(30 * Math.PI / 180), 1e-9),
     String(treinta.thickness));

  // Caminar a lo largo del rumbo no gana espesor: se sigue en la misma capa.
  const rumbo = T.thicknessFromENU(P(0, 0, 0), P(0, 500, 0), 0, 45);
  ok('recorrer el rumbo no da espesor', cerca(rumbo.thickness, 0, 1e-9), String(rumbo.thickness));
  ok('y se avisa de que están en la misma capa', rumbo.obliquity > 89);
}

console.log('== lo que acompaña al número ==');
{
  const r = T.thicknessFromENU(P(0, 0, 0), P(100, 0, 50), 0, 30);
  ok('la distancia en planta', cerca(r.mapDistance, 100));
  ok('la diferencia de cotas', cerca(r.elevationDiff, 50));
  ok('la separación recta', cerca(r.separation, Math.hypot(100, 50)));
  ok('la oblicuidad está entre 0 y 180', r.obliquity >= 0 && r.obliquity <= 180);

  // El «techo» por debajo del plano de la base: o la capa está invertida, o se
  // marcaron los dos puntos al revés. Lo segundo es lo habitual.
  const alReves = T.thicknessFromENU(P(100, 0, 0), P(0, 0, 0), 0, 30);
  ok('se detecta el par invertido', alReves.overturned === true);
  ok('pero el espesor sigue siendo positivo', alReves.thickness > 0);
  ok('y el firmado guarda el signo', alReves.signedThickness < 0);
}

console.log('== incertidumbre ==');
{
  const base = P(0, 0, 0);
  const techo = P(100, 0, 50);
  const a = T.propagateThickness(base, techo, 0, 30);
  const b = T.propagateThickness(base, techo, 0, 30);
  // Volver a calcular el mismo espesor tiene que dar el mismo margen, o el
  // número deja de ser citable.
  ok('el margen es reproducible', a.sd === b.sd, `${a.sd} vs ${b.sd}`);
  ok('y es un número', Number.isFinite(a.sd) && a.sd > 0, String(a.sd));

  // Con más error vertical, más incertidumbre. Es la comprobación de que el
  // Monte Carlo está propagando de verdad y no devolviendo una constante.
  const flojo = T.propagateThickness(base, techo, 0, 30, { sigmaZ: 20 });
  ok('más error en el DEM da más incertidumbre', flojo.sd > a.sd, `${flojo.sd} vs ${a.sd}`);

  const sinDudaAngular = T.propagateThickness(base, techo, 0, 30, { sigmaStrike: 0, sigmaDip: 0 });
  ok('sin duda en la orientación, menos incertidumbre', sinDudaAngular.sd < a.sd);
}

console.log('== avisos ==');
{
  const casiEnLaCapa = T.thicknessWarnings({
    thickness: 2, obliquity: 88, separation: 500, sd: 6, resolution: 30, overturned: false,
  });
  ok('avisa cuando los puntos están casi en la misma capa',
     casiEnLaCapa.some((w) => w.includes('bedding plane')));
  ok('y cuando el margen se come el espesor',
     casiEnLaCapa.some((w) => w.includes('order of magnitude')));

  const corto = T.thicknessWarnings({
    thickness: 100, obliquity: 10, separation: 40, sd: 5, resolution: 30, overturned: false,
  });
  ok('avisa de una base menor que dos celdas del modelo',
     corto.some((w) => w.includes('cells')));

  const bueno = T.thicknessWarnings({
    thickness: 400, obliquity: 12, separation: 500, sd: 8, resolution: 30, overturned: false,
  });
  ok('una medida buena no lleva avisos', bueno.length === 0, bueno.join(' | '));

  ok('el par invertido se avisa',
     T.thicknessWarnings({ thickness: 10, obliquity: 5, separation: 100, sd: 1, resolution: 30, overturned: true })
       .some((w) => w.includes('overturned')));
}

console.log('== la medida completa ==');
{
  const r = T.measureThickness({
    base: { lngLat: [-71.4, -37.4], elevation: 1000 },
    top: { lngLat: [-71.399, -37.4], elevation: 1050 },
    strike: 0,
    dip: 30,
    resolution: 30,
  });
  ok('devuelve ok', r.ok === true);
  ok('con espesor positivo', r.thickness > 0);
  ok('con su margen', Number.isFinite(r.sd));
  ok('y con la orientación usada', r.strike === 0 && r.dip === 30);

  // Sin cota no hay espesor: inventarla sería peor que no dar el número.
  const sinCota = T.measureThickness({
    base: { lngLat: [-71.4, -37.4], elevation: null },
    top: { lngLat: [-71.399, -37.4], elevation: 1050 },
    strike: 0, dip: 30,
  });
  ok('sin cota se niega', sinCota.ok === false && sinCota.reason.includes('elevation'));

  const sinOrientacion = T.measureThickness({
    base: { lngLat: [-71.4, -37.4], elevation: 1000 },
    top: { lngLat: [-71.399, -37.4], elevation: 1050 },
    strike: NaN, dip: 30,
  });
  ok('sin orientación se niega', sinOrientacion.ok === false);
  ok('sin dos puntos se niega', T.measureThickness({ base: null, top: null }).ok === false);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
