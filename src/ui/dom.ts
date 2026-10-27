/**
 * Tiny DOM helpers (no framework). All UI markup is built with these.
 */
import { icon, type IconName, type IconOptions } from './icons';

export type Child = Node | string | null | undefined | false | Child[];

export interface ElProps {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  style?: Partial<CSSStyleDeclaration>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
  dataset?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === undefined || v === false) continue;
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (props.style) Object.assign(node.style, props.style);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  if (props.on) {
    for (const [name, handler] of Object.entries(props.on)) {
      if (handler) node.addEventListener(name, handler as EventListener);
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) {
      append(parent, c);
      continue;
    }
    parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function toggleClass(node: Element, cls: string, on: boolean): void {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

/** Re-trigger a CSS animation class (remove → reflow → add). */
export function replayClass(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

export interface ButtonOpts {
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  icon?: IconName;
  iconOpts?: IconOptions;
  class?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Keyboard hint shown as a small kbd badge. */
  kbd?: string;
}

export function button(label: string, onClick: (ev: MouseEvent) => void, opts: ButtonOpts = {}): HTMLButtonElement {
  const b = el('button', { class: `btn btn-${opts.variant ?? 'default'}${opts.class ? ' ' + opts.class : ''}`, attrs: { type: 'button', 'aria-label': opts.ariaLabel, disabled: opts.disabled } });
  if (opts.icon) b.appendChild(icon(opts.icon, { size: 18, ...opts.iconOpts }));
  b.appendChild(el('span', { class: 'btn-label', text: label }));
  if (opts.kbd) b.appendChild(el('kbd', { class: 'btn-kbd', text: opts.kbd }));
  b.addEventListener('click', onClick);
  return b;
}

export function kbd(text: string): HTMLElement {
  return el('kbd', { class: 'kbd', text });
}

/** Escape text for innerHTML templates. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Vite base URL ('/' in dev and tests, '/<repo>/' on GitHub Pages). */
export function baseUrl(): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return base.endsWith('/') ? base : base + '/';
}

/** Focusable elements inside a container, in DOM order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((n) => !n.hidden && !n.closest('[hidden]') && n.getAttribute('aria-hidden') !== 'true');
}
