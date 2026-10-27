/** Persistent user settings (localStorage) with safe defaults. */
import { DEFAULT_SETTINGS, type Settings } from './sim';

const KEY = 'driving-sim-il:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota — ignore */
  }
}
