/**
 * Transient system toasts (top centre, under the navigation banner).
 */
import { el } from './dom';
import { icon, type IconName } from './icons';
import type { ToastKind } from './types';

const MAX_TOASTS = 3;
const LEAVE_MS = 300;
const KIND_ICON: Record<ToastKind, IconName> = { info: 'info', ok: 'check', warn: 'warning', danger: 'warning' };

export class Toasts {
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly container: HTMLElement) {}

  show(text: string, kind: ToastKind = 'info', seconds = 4, iconName?: IconName): HTMLElement {
    const node = el('div', { class: `toast glass kind-${kind}`, attrs: { role: kind === 'danger' ? 'alert' : 'status' } }, icon(iconName ?? KIND_ICON[kind], { size: 20 }), el('span', { text }));
    this.container.appendChild(node);
    while (this.container.children.length > MAX_TOASTS) this.container.firstElementChild?.remove();
    const t = setTimeout(() => {
      node.classList.add('leaving');
      const t2 = setTimeout(() => {
        node.remove();
        this.timers.delete(t2);
      }, LEAVE_MS);
      this.timers.add(t2);
      this.timers.delete(t);
    }, Math.max(0.5, seconds) * 1000);
    this.timers.add(t);
    return node;
  }

  get count(): number {
    return this.container.children.length;
  }

  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.container.innerHTML = '';
  }
}
