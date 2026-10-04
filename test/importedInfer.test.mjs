import { inferLineStyle } from '../src/importedInfer.js';

let fails = 0;
const ok = (n, c) => { if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n}`); } };
const f = (props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });

const st = inferLineStyle([
  f({ tipo: 'Falla inversa', certeza: 'inferido' }),
  f({ tipo: 'Falla inversa', certeza: 'observado' }),
  f({ tipo: 'Contacto', certeza: 'observado' }),
]);
ok('hay estilo', !!st && st.field === 'tipo');
ok('una regla por tipo y certeza', st.rules.length === 3);
const inf = st.rules.find((r) => r.symbol.dash);
ok('el inferido va a rayas', !!inf);
ok('falla y contacto con colores distintos', new Set(st.rules.map((r) => r.symbol.color)).size === 2);
ok('sin campo de tipo: nada', inferLineStyle([f({ fid: 1, longitud: 3 })]) === null);
ok('tipo irreconocible: nada', inferLineStyle([f({ type: 'zzz' })]) === null);
process.exit(fails ? 1 : 0);
