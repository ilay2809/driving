import { describe, expect, it } from 'vitest';
import { keyLabel, keymapHelp } from './keymapHelp';

describe('keymapHelp', () => {
  it('translates KeyboardEvent.code values into readable key labels', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Space')).toBe('רווח');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('F1')).toBe('F1');
    expect(keyLabel('Shift+ArrowDown')).toBe('Shift + ↓');
    expect(keyLabel('MouseDrag', { MouseDrag: 'גרירת עכבר' })).toBe('גרירת עכבר');
  });

  it('builds one help row per binding with all its keys', () => {
    const rows = keymapHelp([
      { keys: ['ArrowUp', 'KeyW'], labelHe: 'גז' },
      { keys: ['KeyZ'], labelHe: 'מבט מעבר לכתף שמאל' },
    ]);
    expect(rows).toEqual([
      { keys: ['↑', 'W'], action: 'גז' },
      { keys: ['Z'], action: 'מבט מעבר לכתף שמאל' },
    ]);
  });
});
