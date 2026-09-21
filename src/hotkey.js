// Преобразование KeyboardEvent -> Electron accelerator и обратно в читаемый вид

const CODE_KEYS = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
};

// Возвращает { accel, key } — key === null, если нажаты только модификаторы
export function eventToAccelerator(e, isMac) {
  const mods = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (isMac && e.ctrlKey) mods.push('Control');
  if (!isMac && e.metaKey) mods.push('Command');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  let key = null;
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c;
  else if (CODE_KEYS[c]) key = CODE_KEYS[c];

  return { mods, key, accel: key ? [...mods, key].join('+') : null };
}

export function formatAccelerator(accel, isMac) {
  if (!accel) return '';
  const parts = accel.split('+');
  const key = parts.pop();
  const keyLabel = { Up: '↑', Down: '↓', Left: '←', Right: '→', Space: '␣', Enter: '↩', Backspace: '⌫', Delete: '⌦', Escape: '⎋', Tab: '⇥' }[key] || key;
  if (isMac) {
    const map = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' };
    return parts.map((p) => map[p] || p).join('') + keyLabel;
  }
  const map = { CommandOrControl: 'Ctrl', Command: 'Win', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  return [...parts.map((p) => map[p] || p), keyLabel].join('+');
}

export const hasStrongModifier = (mods) => mods.some((m) => m !== 'Shift');
