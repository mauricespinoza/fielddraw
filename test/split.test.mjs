const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

// Igual que en hole.test.mjs: JSTS precargado en el global, para probar la
// geometría de verdad —la misma librería que corre en la app— desde Node.
const { createRequire } = await import('node:module');
globalThis.jsts = createRequire(import.meta.url)('../vendor/jsts.min.js');

const G = await import(BASE + 'geometryOps.js');

const L = (...c) => ({ type: 'LineString', coordinates: c });
const largo = (g) => {
  let d = 0;
  for (let i = 1; i < g.coordinates.length; i++) {
    d += Math.hypot(
      g.coordinates[i][0] - g.coordinates[i - 1][0],
      g.coordinates[i][1] - g.coordinates[i - 1][1],
    );
  }
  return d;
};

console.log('== cortar una línea ==');
{
  /*
   * El caso que estaba roto: dos líneas cruzándose en aspa. Con el filtro
   * anterior —quedarse con los trozos cuya diferencia con la original fuese
   * vacía— NINGUNO sobrevivía, ni siquiera los dos que sí eran de la línea, y
   * la herramienta contestaba "no cruzó nada" sobre un cruce evidente.
   */
  const diagonal = L([-71.4, -37.45], [-71.3, -37.35]);
  const aspa = await G.splitLine(diagonal, L([-71.4, -37.35], [-71.3, -37.45]));
  ok('un cruce oblicuo parte en dos', aspa && aspa.length === 2, String(aspa && aspa.length));
  ok('y los dos trozos son líneas', aspa.every((g) => g.type === 'LineString'));
  // Se conserva el largo: si sobraran trozos del cortador, sumaría de más.
  const suma = aspa.reduce((s, g) => s + largo(g), 0);
  ok('entre los dos suman la línea entera', Math.abs(suma - largo(diagonal)) < 1e-9, String(suma));

  const horizontal = L([-71.4, -37.4], [-71.3, -37.4]);
  const cruz = await G.splitLine(horizontal, L([-71.35, -37.45], [-71.35, -37.35]));
  ok('un cruce perpendicular parte en dos', cruz && cruz.length === 2, String(cruz && cruz.length));
  // Que salgan CUATRO es el otro fallo posible: colar los trozos del cortador.
  ok('sin colar los trozos del cortador', cruz.length === 2);

  const porVertice = await G.splitLine(
    L([-71.4, -37.4], [-71.35, -37.4], [-71.3, -37.4]),
    L([-71.35, -37.45], [-71.35, -37.35]),
  );
  ok('cortar justo sobre un vértice parte en dos', porVertice && porVertice.length === 2);

  const enT = await G.splitLine(horizontal, L([-71.35, -37.45], [-71.35, -37.4]));
  ok('una línea que termina encima también corta', enT && enT.length === 2);

  const dos = await G.splitLine(
    horizontal,
    L([-71.37, -37.45], [-71.37, -37.35], [-71.33, -37.35], [-71.33, -37.45]),
  );
  ok('dos cruces dejan tres pedazos', dos && dos.length === 3, String(dos && dos.length));

  // Una traza a pulso son cientos de vértices: es el caso de terreno, y el que
  // más se notaba fallando.
  const pulso = L(
    ...Array.from({ length: 200 }, (_, i) => [-71.4 + i * 0.0005, -37.4 + Math.sin(i / 9) * 0.002]),
  );
  const aPulso = await G.splitLine(pulso, L([-71.35, -37.45], [-71.35, -37.35]));
  ok('una línea a pulso se corta', aPulso && aPulso.length === 2, String(aPulso && aPulso.length));

  // En metros UTM las coordenadas son ~1e6: una tolerancia fija fallaría aquí
  // o en grados, y por eso es relativa al tamaño de la geometría.
  const utm = await G.splitLine(
    L([300000, 5900000], [310000, 5900000]),
    L([305000, 5895000], [305000, 5905000]),
  );
  ok('en coordenadas UTM también', utm && utm.length === 2, String(utm && utm.length));

  const casiTangente = await G.splitLine(
    horizontal,
    L([-71.45, -37.4001], [-71.25, -37.3999]),
  );
  ok('un cruce casi tangente corta', casiTangente && casiTangente.length === 2);
}

console.log('== cuándo NO hay que cortar ==');
{
  const horizontal = L([-71.4, -37.4], [-71.3, -37.4]);
  ok('sin cruce devuelve null', (await G.splitLine(horizontal, L([-71.4, -37.3], [-71.3, -37.3]))) === null);
  // Tocar un extremo no parte nada: quedaría un trozo y la línea entera.
  ok('tocar solo el extremo no corta',
     (await G.splitLine(horizontal, L([-71.4, -37.45], [-71.4, -37.35]))) === null);
}

console.log('== cortar un polígono ==');
{
  const cuadrado = {
    type: 'Polygon',
    coordinates: [[[-71.4, -37.45], [-71.3, -37.45], [-71.3, -37.35], [-71.4, -37.35], [-71.4, -37.45]]],
  };
  const recto = await G.splitPolygon(cuadrado, L([-71.45, -37.4], [-71.25, -37.4]));
  ok('un corte de lado a lado parte en dos', recto && recto.length === 2);
  const oblicuo = await G.splitPolygon(cuadrado, L([-71.45, -37.5], [-71.25, -37.3]));
  ok('un corte oblicuo también', oblicuo && oblicuo.length === 2);
  ok('un corte que no sale no parte nada',
     (await G.splitPolygon(cuadrado, L([-71.38, -37.4], [-71.36, -37.4]))) === null);

  // Un polígono con hueco conserva el hueco al partirse.
  const conHueco = {
    type: 'Polygon',
    coordinates: [
      cuadrado.coordinates[0],
      [[-71.37, -37.42], [-71.37, -37.38], [-71.33, -37.38], [-71.33, -37.42], [-71.37, -37.42]],
    ],
  };
  const partido = await G.splitPolygon(conHueco, L([-71.45, -37.44], [-71.25, -37.44]));
  ok('un polígono con hueco se parte', partido && partido.length === 2);
  ok('y el hueco sobrevive al corte',
     partido.some((g) => g.coordinates.length === 2), JSON.stringify(partido.map((g) => g.coordinates.length)));
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
