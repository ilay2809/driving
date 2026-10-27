/**
 * Keyboard ergonomics for screens: Tab trapping, arrow-key roving focus inside
 * `[data-nav-group]` containers (geometry based; index based when layout is unknown),
 * and initial focus.
 */
import { focusables } from './dom';

export function focusFirst(container: HTMLElement, preferred?: HTMLElement | null): void {
  const all = focusables(container);
  // prefer a real control over the header's close button
  const first = all.find((n) => !n.classList.contains('screen-close')) ?? all[0];
  const target = (preferred && preferred.isConnected ? preferred : null) ?? container.querySelector<HTMLElement>('[data-autofocus]') ?? first ?? container;
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
}

/** Keep Tab / Shift+Tab inside the container. Returns true when handled. */
export function trapTab(container: HTMLElement, e: KeyboardEvent): boolean {
  if (e.key !== 'Tab') return false;
  const items = focusables(container);
  if (items.length === 0) {
    e.preventDefault();
    return true;
  }
  const active = document.activeElement as HTMLElement | null;
  const idx = active ? items.indexOf(active) : -1;
  let next: HTMLElement | undefined;
  if (e.shiftKey) next = idx <= 0 ? items[items.length - 1] : items[idx - 1];
  else next = idx === -1 || idx >= items.length - 1 ? items[0] : items[idx + 1];
  if (next) {
    e.preventDefault();
    next.focus();
    return true;
  }
  return false;
}

type Dir = 'up' | 'down' | 'left' | 'right';

function dirOf(key: string): Dir | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

/**
 * Move focus with arrow keys between focusable items of the nearest `[data-nav-group]`.
 * Falls back to DOM order when the layout has no geometry (e.g. jsdom): down/left = next,
 * up/right = previous (RTL: the next item sits to the left).
 */
export function rovingArrows(e: KeyboardEvent): boolean {
  const dir = dirOf(e.key);
  if (!dir) return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (active instanceof HTMLInputElement && (active.type === 'range' || active.type === 'text' || active.type === 'search')) return false;
  if (active instanceof HTMLSelectElement) return false;
  const group = active.closest<HTMLElement>('[data-nav-group]');
  if (!group) return false;
  const items = focusables(group).filter((n) => n.closest('[data-nav-group]') === group);
  if (items.length < 2) return false;
  const idx = items.indexOf(active);
  if (idx === -1) return false;
  const rects = items.map((n) => n.getBoundingClientRect());
  const hasGeometry = rects.some((r) => r.width > 0 || r.height > 0);
  let target: HTMLElement | undefined;
  if (!hasGeometry) {
    const delta = dir === 'down' || dir === 'left' ? 1 : -1;
    target = items[(idx + delta + items.length) % items.length];
  } else {
    const cur = rects[idx]!;
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;
    let best = Infinity;
    items.forEach((n, i) => {
      if (i === idx) return;
      const r = rects[i]!;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      let ok = false;
      let score = 0;
      switch (dir) {
        case 'down':
          ok = dy > 4;
          score = dy + Math.abs(dx) * 0.5;
          break;
        case 'up':
          ok = dy < -4;
          score = -dy + Math.abs(dx) * 0.5;
          break;
        case 'left':
          ok = dx < -4;
          score = -dx + Math.abs(dy) * 2;
          break;
        case 'right':
          ok = dx > 4;
          score = dx + Math.abs(dy) * 2;
          break;
      }
      if (ok && score < best) {
        best = score;
        target = n;
      }
    });
    if (!target && (dir === 'left' || dir === 'right')) {
      // wrap within DOM order for horizontal moves (RTL: left = next)
      const delta = dir === 'left' ? 1 : -1;
      target = items[(idx + delta + items.length) % items.length];
    }
  }
  if (!target) return false;
  e.preventDefault();
  target.focus();
  return true;
}
