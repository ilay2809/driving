/**
 * Turns a key map (as data: `KeyboardEvent.code` values + Hebrew labels) into the rows
 * of the F1 help table. Pure, so the vehicle module's KEYMAP can be rendered without the
 * UI module importing it.
 */
import { KEY_CODE_LABELS } from './strings.he';
import type { KeymapEntry } from './types';

export interface KeyBindingLike {
  keys: readonly string[];
  labelHe: string;
}

/** 'KeyW' → 'W', 'Digit1' → '1', 'ArrowUp' → '↑', 'Shift+ArrowUp' → 'Shift + ↑'. */
export function keyLabel(code: string, labels: Record<string, string> = {}): string {
  const parts = code.split('+').map((part) => {
    const p = part.trim();
    if (labels[p]) return labels[p]!;
    if (KEY_CODE_LABELS[p]) return KEY_CODE_LABELS[p]!;
    const m = /^(?:Key|Digit)(\w)$/.exec(p);
    if (m) return m[1]!.toUpperCase();
    return p;
  });
  return parts.join(' + ');
}

/** Help rows in key-map order (one row per binding). */
export function keymapHelp(bindings: readonly KeyBindingLike[], labels: Record<string, string> = {}): KeymapEntry[] {
  return bindings.map((b) => ({ keys: b.keys.map((k) => keyLabel(k, labels)), action: b.labelHe }));
}
