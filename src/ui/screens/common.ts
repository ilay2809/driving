/**
 * Shared building blocks for screens: panel scaffold, header, score ring, form fields.
 */
import { button, el, type Child } from '../dom';
import { icon, type IconName } from '../icons';
import { COMMON } from '../strings.he';

let idSeq = 0;
export function uniqueId(prefix: string): string {
  return `${prefix}-${(++idSeq).toString(36)}`;
}

export interface PanelOptions {
  title: string;
  icon?: IconName;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'default';
  onClose?: () => void;
  className?: string;
  /** Label for the close button (default: סגור). */
  closeLabel?: string;
}

export function panel(opts: PanelOptions, ...children: Child[]): { el: HTMLElement; body: HTMLElement; closeBtn?: HTMLButtonElement } {
  const titleId = uniqueId('scr-title');
  const head = el('div', { class: 'screen-head' });
  const titleWrap = el('div');
  const h1 = el('h1', { id: titleId });
  if (opts.icon) h1.appendChild(icon(opts.icon, { size: 28 }));
  h1.appendChild(el('span', { text: opts.title }));
  titleWrap.appendChild(h1);
  if (opts.subtitle) titleWrap.appendChild(el('p', { class: 'screen-sub', text: opts.subtitle }));
  head.appendChild(titleWrap);
  let closeBtn: HTMLButtonElement | undefined;
  if (opts.onClose) {
    closeBtn = button('', opts.onClose, { variant: 'ghost', icon: 'close', class: 'screen-close', ariaLabel: opts.closeLabel ?? COMMON.close, iconOpts: { size: 22 } });
    head.appendChild(closeBtn);
  }
  const body = el('div', { class: 'screen-body' }, ...children);
  body.style.display = 'contents';
  const root = el('div', { class: `screen${opts.size && opts.size !== 'default' ? ' screen-' + opts.size : ''}${opts.className ? ' ' + opts.className : ''}`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' } }, head, body);
  return { el: root, body, closeBtn };
}

export function footer(...children: Child[]): HTMLElement {
  return el('div', { class: 'screen-foot' }, ...children);
}

export function section(title: string, iconName?: IconName, ...children: Child[]): HTMLElement {
  const h = el('h2');
  if (iconName) h.appendChild(icon(iconName, { size: 18 }));
  h.appendChild(el('span', { text: title }));
  return el('section', { class: 'section' }, h, ...children);
}

/** Circular score indicator (0..100). */
export function scoreRing(score: number, opts: { pass?: boolean; label?: string; mini?: boolean } = {}): HTMLElement {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, Math.round(score)));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<circle class="track" cx="60" cy="60" r="${r}"/><circle class="bar" cx="60" cy="60" r="${r}" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - pct / 100)).toFixed(1)}"/>`;
  const pass = opts.pass ?? pct >= 60;
  const wrap = el('div', { class: `score-ring${pass ? '' : ' fail'}${opts.mini ? ' score-mini' : ''}`, attrs: { role: 'img', 'aria-label': `${opts.label ?? COMMON.score} ${pct}` } }, svg, el('div', { class: 'score-text' }, el('div', { class: 'score-val num', text: String(pct) }), opts.mini ? null : el('div', { class: 'score-label', text: opts.label ?? COMMON.score })));
  return wrap;
}

export interface FieldOpts {
  hint?: string;
  value?: HTMLElement;
}

export function field(labelText: string, control: HTMLElement, opts: FieldOpts = {}): HTMLElement {
  const id = control.id || uniqueId('f');
  control.id = id;
  const labelEl = control.tagName === 'LABEL' || control.classList.contains('toggle') || control.classList.contains('seg') ? el('span', { class: 'field-label', text: labelText, attrs: { id: id + '-lbl' } }) : el('label', { text: labelText, attrs: { for: id } });
  if (labelEl.tagName === 'SPAN') control.setAttribute('aria-labelledby', id + '-lbl');
  const wrap = el('div', { class: 'field' }, labelEl, el('div', { class: 'control' }, control), opts.value ?? el('span'));
  if (opts.hint) wrap.appendChild(el('div', { class: 'field-hint', text: opts.hint }));
  return wrap;
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, labels?: { on: string; off: string }): HTMLElement {
  const input = el('input', { attrs: { type: 'checkbox', role: 'switch', 'aria-checked': String(checked) } });
  input.checked = checked;
  const state = el('span', { class: 'toggle-state', text: checked ? (labels?.on ?? COMMON.on) : (labels?.off ?? COMMON.off) });
  input.addEventListener('change', () => {
    input.setAttribute('aria-checked', String(input.checked));
    state.textContent = input.checked ? (labels?.on ?? COMMON.on) : (labels?.off ?? COMMON.off);
    onChange(input.checked);
  });
  return el('label', { class: 'toggle' }, input, el('span', { class: 'track' }), state);
}

export function slider(min: number, max: number, step: number, value: number, onInput: (v: number) => void, ariaLabel?: string): HTMLInputElement {
  const input = el('input', { attrs: { type: 'range', min, max, step, 'aria-label': ariaLabel } });
  input.value = String(value);
  input.addEventListener('input', () => onInput(Number(input.value)));
  return input;
}

export function select(options: { value: string; label: string }[], value: string, onChange: (v: string) => void, ariaLabel?: string): HTMLSelectElement {
  const sel = el('select', { attrs: { 'aria-label': ariaLabel } });
  for (const o of options) {
    const opt = el('option', { text: o.label, attrs: { value: o.value } });
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/** Segmented control (radio-like buttons). */
export function segmented(options: { value: string; label: string; icon?: IconName }[], value: string, onChange: (v: string) => void, ariaLabel?: string): HTMLElement {
  const wrap = el('div', { class: 'seg', attrs: { role: 'radiogroup', 'aria-label': ariaLabel, 'data-nav-group': '' } });
  const buttons: HTMLButtonElement[] = [];
  const setValue = (v: string) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === v));
  };
  for (const o of options) {
    const b = el('button', { attrs: { type: 'button', role: 'radio', 'aria-pressed': String(o.value === value), 'aria-checked': String(o.value === value) }, dataset: { value: o.value } });
    if (o.icon) b.appendChild(icon(o.icon, { size: 16 }));
    b.appendChild(el('span', { text: o.label }));
    b.addEventListener('click', () => {
      setValue(o.value);
      for (const x of buttons) x.setAttribute('aria-checked', String(x === b));
      onChange(o.value);
    });
    buttons.push(b);
    wrap.appendChild(b);
  }
  return wrap;
}

export function badge(text: string, kind: '' | 'ok' | 'warn' | 'danger' | 'accent' | 'major' = '', iconName?: IconName): HTMLElement {
  const b = el('span', { class: `badge${kind ? ' ' + kind : ''}` });
  if (iconName) b.appendChild(icon(iconName, { size: 13 }));
  b.appendChild(el('span', { text }));
  return b;
}
