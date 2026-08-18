const BASE = '../src/';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

const S = await import(BASE + 'shortcuts.js');

/** Evento de teclado mínimo, con los modificadores apagados por omisión. */
const ev = (key, mods = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

console.log('== combos ==');
ok('una letra suelta', S.eventCombo(ev('v')) === 'v');
ok('la mayúscula se normaliza', S.eventCombo(ev('V')) === 'v');
ok('Ctrl se llama mod', S.eventCombo(ev('z', { ctrlKey: true })) === 'mod+z');
// En macOS el modificador es ⌘: se normaliza al mismo combo para no tener que
// duplicar cada entrada de la tabla.
ok('Cmd también es mod', S.eventCombo(ev('z', { metaKey: true })) === 'mod+z');
ok('el orden de los modificadores es estable',
  S.eventCombo(ev('z', { ctrlKey: true, shiftKey: true })) === 'mod+shift+z');
ok('teclas nombradas en minúscula', S.eventCombo(ev('Escape')) === 'escape');
ok('Enter', S.eventCombo(ev('Enter')) === 'enter');
ok('el espacio tiene nombre', S.eventCombo(ev(' ')) === 'space');

/*
 * Los símbolos ignoran Shift a propósito. En un teclado español `?` YA se
 * escribe con Shift; registrarlo como `shift+?` lo haría inalcanzable en un
 * teclado inglés, donde el mismo símbolo sale de otra combinación. `e.key` ya
 * trae el símbolo final, sea cual sea la distribución.
 */
ok('un símbolo no arrastra shift', S.eventCombo(ev('?', { shiftKey: true })) === '?');
ok('pero una letra sí', S.eventCombo(ev('L', { shiftKey: true })) === 'shift+l');
ok('y un dígito también', S.eventCombo(ev('3', { shiftKey: true })) === 'shift+3');
ok('la coma con Ctrl', S.eventCombo(ev(',', { ctrlKey: true })) === 'mod+,');

console.log('== resolución de atajos ==');
ok('V selecciona', S.shortcutFor(ev('v')) === 'tool-select');
ok('L es la línea', S.shortcutFor(ev('l')) === 'tool-line');
ok('Shift+L es el panel de capas', S.shortcutFor(ev('L', { shiftKey: true })) === 'panel-layers');
ok('Ctrl+Z deshace', S.shortcutFor(ev('z', { ctrlKey: true })) === 'undo');
ok('Ctrl+Shift+Z rehace', S.shortcutFor(ev('z', { ctrlKey: true, shiftKey: true })) === 'redo');
ok('Ctrl+Y también rehace', S.shortcutFor(ev('y', { ctrlKey: true })) === 'redo');
// Y sin Ctrl, la misma tecla es otra cosa: los modificadores discriminan.
ok('Y a secas es la topología', S.shortcutFor(ev('y')) === 'topology');
ok('? abre la ayuda', S.shortcutFor(ev('?', { shiftKey: true })) === 'help');
ok('F1 también', S.shortcutFor(ev('F1')) === 'help');
ok('una tecla sin asignar devuelve null', S.shortcutFor(ev('ñ')) === null);
ok('una letra asignada con un modificador que no toca no dispara',
  S.shortcutFor(ev('v', { altKey: true })) === null);

console.log('== integridad de la tabla ==');
const combos = S.SHORTCUTS.flatMap((s) => s.keys);
ok('no hay combos repetidos', new Set(combos).size === combos.length,
  combos.filter((c, i) => combos.indexOf(c) !== i).join(', '));
const ids = S.SHORTCUTS.map((s) => s.id);
ok('no hay acciones repetidas', new Set(ids).size === ids.length);
ok('todas las acciones tienen etiqueta', S.SHORTCUTS.every((s) => s.label && s.label.length > 3));
ok('todas caen en un grupo conocido',
  S.SHORTCUTS.every((s) => S.SHORTCUT_GROUPS.includes(s.group)),
  S.SHORTCUTS.filter((s) => !S.SHORTCUT_GROUPS.includes(s.group)).map((s) => s.group).join(', '));
ok('todos los grupos tienen al menos una entrada',
  S.SHORTCUT_GROUPS.every((g) => S.SHORTCUTS.some((s) => s.group === g)));
// Cada combo declarado tiene que resolver a su propia acción: es lo que
// garantiza que la ayuda no anuncie una tecla que el despachador ignora.
ok('cada combo de la tabla resuelve a su acción',
  S.SHORTCUTS.every((s) => s.keys.every((k) => S.shortcutFor(comboToEvent(k)) === s.id)));

/** Reconstruye un evento a partir de un combo, para el ida y vuelta. */
function comboToEvent(combo) {
  const partes = combo.split('+');
  const key = partes[partes.length - 1];
  return ev(key, {
    ctrlKey: partes.includes('mod'),
    altKey: partes.includes('alt'),
    shiftKey: partes.includes('shift'),
  });
}

console.log('== teclas que se le roban al navegador ==');
// Solo las que el navegador también usa. Quitarle `mod+p` (imprimir) o `v`
// cuando no hace falta sería una grosería con el usuario.
ok('Ctrl+S se intercepta', S.consumesDefault('project-save'));
ok('Ctrl+Z se intercepta', S.consumesDefault('undo'));
ok('Ctrl+A se intercepta', S.consumesDefault('select-all'));
ok('cambiar de herramienta NO se intercepta', !S.consumesDefault('tool-line'));
ok('Enter NO se intercepta', !S.consumesDefault('finish'));

console.log('== campos de texto ==');
// Sin esto, escribir "Lava" en el nombre de una unidad cambiaría a la
// herramienta Línea a mitad de palabra.
ok('un input se queda el teclado', S.isTyping({ tagName: 'INPUT' }));
ok('un textarea también', S.isTyping({ tagName: 'TEXTAREA' }));
ok('un select también', S.isTyping({ tagName: 'SELECT' }));
ok('un contenteditable también', S.isTyping({ tagName: 'DIV', isContentEditable: true }));
ok('un botón no', !S.isTyping({ tagName: 'BUTTON' }));
ok('sin elemento no', !S.isTyping(null));

console.log('== etiquetas ==');
ok('Ctrl en Windows', S.comboLabel('mod+s', false) === 'Ctrl+S');
ok('⌘ en Mac', S.comboLabel('mod+s', true) === '⌘S');
ok('Escape se abrevia', S.comboLabel('escape') === 'Esc');
ok('las teclas de edición usan símbolo', S.comboLabel('backspace') === '⌫');
ok('la letra va en mayúscula', S.comboLabel('v') === 'V');
ok('labelsFor devuelve todos los combos', S.labelsFor('redo').length === 2);
ok('labelsFor de algo inexistente no revienta', S.labelsFor('no-existe').length === 0);

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
