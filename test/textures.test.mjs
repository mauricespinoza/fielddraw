import assert from 'node:assert/strict';
import {
  TEXTURES,
  TEXTURE_AUTO,
  TEXTURE_NONE,
  TEXTURE_SIZE,
  autoTextureFor,
  textureIdOfImage,
  textureImage,
  textureImageName,
  textureOf,
} from '../src/textures.js';
import { unitTextureStyle } from '../src/geologyStyle.js';

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log('ok -', name);
};

t('«andesita» lleva la textura porfídica, con o sin acentos y mayúsculas', () => {
  assert.equal(autoTextureFor('Andesita de Abanico'), 'porphyry-plag');
  assert.equal(autoTextureFor('ANDESÍTA basáltica'), 'porphyry-plag');
  assert.equal(autoTextureFor('Andesite flows'), 'porphyry-plag');
  assert.equal(autoTextureFor('Granodiorita'), null);
  assert.equal(autoTextureFor(''), null);
  assert.equal(autoTextureFor(undefined), null);
});

t('la elección del usuario manda sobre el nombre', () => {
  assert.equal(textureOf({ name: 'Andesita' }), 'porphyry-plag');
  assert.equal(textureOf({ name: 'Andesita', texture: TEXTURE_AUTO }), 'porphyry-plag');
  assert.equal(textureOf({ name: 'Andesita', texture: TEXTURE_NONE }), null);
  assert.equal(textureOf({ name: 'Dacita', texture: 'porphyry-plag' }), 'porphyry-plag');
  assert.equal(textureOf({ name: 'Dacita', texture: 'inexistente' }), null);
  assert.equal(textureOf(null), null);
});

t('la tesela es RGBA del tamaño declarado, con fondo transparente y cristales', () => {
  for (const { id } of TEXTURES) {
    const img = textureImage(id);
    assert.equal(img.width, TEXTURE_SIZE);
    assert.equal(img.height, TEXTURE_SIZE);
    assert.equal(img.data.length, TEXTURE_SIZE * TEXTURE_SIZE * 4);
    let opacos = 0;
    let vacios = 0;
    for (let i = 3; i < img.data.length; i += 4) {
      if (img.data[i] > 128) opacos++;
      if (img.data[i] === 0) vacios++;
    }
    const cobertura = opacos / (TEXTURE_SIZE * TEXTURE_SIZE);
    assert.ok(cobertura > 0.1 && cobertura < 0.45, `cobertura ${cobertura}`);
    assert.ok(vacios > img.data.length / 4 / 2, 'la masa fundamental queda transparente');
  }
});

t('la tesela es determinista y empalma sin costuras', () => {
  const a = textureImage('porphyry-plag');
  assert.equal(textureImage('porphyry-plag'), a);
  const alpha = (x, y) => a.data[(((y + TEXTURE_SIZE) % TEXTURE_SIZE) * TEXTURE_SIZE + ((x + TEXTURE_SIZE) % TEXTURE_SIZE)) * 4 + 3];
  // Si un cristal cruza el borde, la columna 0 y la última no pueden diferir
  // más de lo que difieren dos columnas contiguas cualesquiera.
  let corte = 0;
  let interior = 0;
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    corte += Math.abs(alpha(0, y) - alpha(-1, y));
    interior += Math.abs(alpha(100, y) - alpha(99, y));
  }
  assert.ok(corte < interior * 4 + 2000, `costura ${corte} vs ${interior}`);
});

t('los nombres de imagen van y vienen', () => {
  assert.equal(textureIdOfImage(textureImageName('porphyry-plag')), 'porphyry-plag');
  assert.equal(textureIdOfImage('texture-nada'), null);
  assert.equal(textureIdOfImage('structure-bedding'), null);
  assert.equal(textureIdOfImage(undefined), null);
});

t('el estilo del mapa solo pinta las unidades con textura', () => {
  const units = [
    { id: 'u1', name: 'Andesita', color: '#aaa' },
    { id: 'u2', name: 'Granito', color: '#bbb' },
    { id: 'u3', name: 'Granito porfídico', color: '#ccc', texture: 'porphyry-plag' },
    { id: 'u4', name: 'Andesita lavada', color: '#ddd', texture: TEXTURE_NONE },
  ];
  const { filter, pattern } = unitTextureStyle(units);
  assert.deepEqual(filter[2], ['in', ['get', 'type'], ['literal', ['u1', 'u3']]]);
  assert.equal(pattern[0], 'match');
  assert.ok(pattern.includes('u1') && pattern.includes('u3'));
  assert.ok(!pattern.includes('u2') && !pattern.includes('u4'));
});

t('sin ninguna unidad con textura la capa no deja pasar nada', () => {
  const { filter, pattern } = unitTextureStyle([{ id: 'u', name: 'Granito' }]);
  assert.deepEqual(filter[2], ['==', ['get', 'type'], '']);
  assert.equal(typeof pattern, 'string');
});

console.log(`${n} pruebas`);
