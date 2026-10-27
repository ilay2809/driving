/**
 * Keyboard map as data, so the UI module can render a help overlay (F1) and a
 * settings page. Keys are `KeyboardEvent.code` values (physical keys — layout
 * independent, so a Hebrew keyboard layout works the same).
 *
 * Note on P/R/N/D: the gear-lever letters double as WASD steering/pedal keys, so the
 * lever letters are honoured only while the car is (nearly) stopped — which is the
 * only time P/R may engage anyway. While moving, Shift+↑/↓ cycles the lever.
 */
import { ACTION_LABELS_HE } from './strings.he';

export type InputAction =
  | 'throttle'
  | 'brake'
  | 'steer_left'
  | 'steer_right'
  | 'handbrake'
  | 'gear_P'
  | 'gear_R'
  | 'gear_N'
  | 'gear_D'
  | 'gear_up'
  | 'gear_down'
  | 'indicator_left'
  | 'indicator_right'
  | 'hazard'
  | 'lights'
  | 'wipers'
  | 'horn'
  | 'ignition'
  | 'seatbelt'
  | 'glance_left_mirror'
  | 'glance_rear_mirror'
  | 'glance_right_mirror'
  | 'shoulder_left'
  | 'shoulder_right'
  | 'free_look'
  | 'acknowledge'
  | 'pause'
  | 'help'
  | 'chase_camera';

export type KeyGroup = 'driving' | 'gear' | 'signals' | 'lights' | 'look' | 'system';

export interface KeyBinding {
  action: InputAction;
  /** KeyboardEvent.code values; "Shift+ArrowUp" means Shift held. "MouseDrag" is informational. */
  keys: string[];
  labelHe: string;
  group: KeyGroup;
  /** Held keys (pedals, horn) vs. taps. */
  hold: boolean;
  /** Only honoured while stopped (see note above). */
  whenStopped?: boolean;
}

const b = (action: InputAction, keys: string[], group: KeyGroup, hold = false, whenStopped?: boolean): KeyBinding => ({
  action,
  keys,
  labelHe: ACTION_LABELS_HE[action],
  group,
  hold,
  ...(whenStopped ? { whenStopped } : {}),
});

export const KEYMAP: readonly KeyBinding[] = [
  b('throttle', ['ArrowUp', 'KeyW'], 'driving', true),
  b('brake', ['ArrowDown', 'KeyS'], 'driving', true),
  b('steer_left', ['ArrowLeft', 'KeyA'], 'driving', true),
  b('steer_right', ['ArrowRight', 'KeyD'], 'driving', true),
  b('handbrake', ['Space'], 'driving'),
  b('gear_P', ['KeyP'], 'gear', false, true),
  b('gear_R', ['KeyR'], 'gear', false, true),
  b('gear_N', ['KeyN'], 'gear', false, true),
  b('gear_D', ['KeyD'], 'gear', false, true),
  b('gear_up', ['Shift+ArrowUp'], 'gear'),
  b('gear_down', ['Shift+ArrowDown'], 'gear'),
  b('indicator_left', ['KeyQ'], 'signals'),
  b('indicator_right', ['KeyE'], 'signals'),
  b('hazard', ['KeyX'], 'signals'),
  b('lights', ['KeyL'], 'lights'),
  b('wipers', ['KeyV'], 'lights'),
  b('horn', ['KeyH'], 'signals', true),
  b('ignition', ['KeyI'], 'driving'),
  b('seatbelt', ['KeyB'], 'driving'),
  b('glance_left_mirror', ['Digit1'], 'look'),
  b('glance_rear_mirror', ['Digit2'], 'look'),
  b('glance_right_mirror', ['Digit3'], 'look'),
  b('shoulder_left', ['KeyZ'], 'look'),
  b('shoulder_right', ['KeyC'], 'look'),
  b('free_look', ['MouseDrag'], 'look', true),
  b('acknowledge', ['Enter'], 'system'),
  b('pause', ['Escape'], 'system'),
  b('help', ['F1'], 'system'),
  b('chase_camera', ['F3'], 'look'),
];

/** code → actions bound to it (without modifier), for quick lookup. */
export const KEY_TO_ACTIONS: ReadonlyMap<string, InputAction[]> = (() => {
  const m = new Map<string, InputAction[]>();
  for (const kb of KEYMAP) {
    for (const k of kb.keys) {
      if (k.includes('+') || k === 'MouseDrag') continue;
      const list = m.get(k) ?? [];
      list.push(kb.action);
      m.set(k, list);
    }
  }
  return m;
})();

/** Keys the browser would otherwise act on (scrolling, quick-find…) while driving. */
export const PREVENT_DEFAULT_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F1', 'F3', 'Slash', 'Quote']);
