/**
 * Subtitles bar (bottom centre): speaker + text from 'coach:say' until 'coach:said'
 * (+ linger). Lesson hints stack above the bar. A "לחץ ? להסבר" prompt appears when the
 * coach is idle in lessons (configurable).
 */
import type { SpeechRequest } from '@/core/events';
import { el, setHidden, setText, toggleClass } from './dom';
import { icon, isIconName, type IconName } from './icons';
import { SPEAKER, SUBTITLES } from './strings.he';

export const DEFAULT_LINGER_S = 1.2;
const LEAVE_MS = 300;
/** A 'coach:said' that arrives up to this long BEFORE its 'coach:say' (sync drop) suppresses it. */
const SAID_BEFORE_SAY_MS = 1500;
const MAX_HINTS = 3;

export class Subtitles {
  readonly el: HTMLElement;
  private hintsEl: HTMLElement;
  private bar: HTMLElement;
  private speakerEl: HTMLElement;
  private textEl: HTMLElement;
  private promptEl: HTMLElement;
  private queue: SpeechRequest[] = [];
  private shown: SpeechRequest | null = null;
  private lingerTimer?: ReturnType<typeof setTimeout>;
  private leaveTimer?: ReturnType<typeof setTimeout>;
  private recentlySaid = new Map<string, number>();
  private enabled = true;
  private idlePrompt = false;
  private hintTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    this.hintsEl = el('div', { class: 'hints', attrs: { 'aria-live': 'polite' } });
    this.speakerEl = el('div', { class: 'subtitle-speaker' });
    this.textEl = el('div', { class: 'subtitle-text' });
    this.bar = el('div', { class: 'subtitle-bar', attrs: { role: 'status', 'aria-live': 'assertive' } }, this.speakerEl, this.textEl);
    this.bar.hidden = true;
    this.promptEl = el('div', { class: 'hint-prompt' }, el('span', { text: SUBTITLES.hintPrompt }));
    this.promptEl.hidden = true;
    this.el = el('div', { class: 'ui-subtitles' }, this.hintsEl, this.bar, this.promptEl);
    this.el.style.pointerEvents = 'none';
  }

  get current(): SpeechRequest | null {
    return this.shown;
  }

  get visible(): boolean {
    return !this.bar.hidden && !this.bar.classList.contains('leaving');
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) {
      this.clearTimers();
      this.bar.hidden = true;
      this.bar.classList.remove('leaving');
    } else if (this.shown) {
      this.bar.hidden = false;
    }
    this.refreshPrompt();
  }

  setIdlePrompt(on: boolean): void {
    if (this.idlePrompt === on) return;
    this.idlePrompt = on;
    this.refreshPrompt();
  }

  say(req: SpeechRequest): void {
    const saidAt = this.recentlySaid.get(req.id);
    if (saidAt !== undefined && Date.now() - saidAt < SAID_BEFORE_SAY_MS) {
      this.recentlySaid.delete(req.id);
      return;
    }
    this.queue = this.queue.filter((q) => q.id !== req.id);
    this.queue.push(req);
    this.show(req);
  }

  said(id: string): void {
    const now = Date.now();
    this.recentlySaid.set(id, now);
    for (const [k, t] of this.recentlySaid) if (now - t > 10_000) this.recentlySaid.delete(k);
    this.queue = this.queue.filter((q) => q.id !== id);
    if (this.shown?.id !== id) return;
    const linger = (this.shown.linger ?? DEFAULT_LINGER_S) * 1000;
    this.clearTimers();
    this.lingerTimer = setTimeout(() => {
      const next = this.queue[this.queue.length - 1];
      if (next) this.show(next);
      else this.hide();
    }, linger);
  }

  /** Lesson hint shown above the bar for `seconds`. */
  hint(text: string, iconName?: string, seconds = 6): HTMLElement {
    const name: IconName = iconName && isIconName(iconName) ? iconName : 'info';
    const node = el('div', { class: 'hint glass', attrs: { role: 'status' } }, icon(name, { size: 20 }), el('span', { text }));
    this.hintsEl.appendChild(node);
    while (this.hintsEl.children.length > MAX_HINTS) this.hintsEl.firstElementChild?.remove();
    const t = setTimeout(() => {
      node.classList.add('leaving');
      const t2 = setTimeout(() => {
        node.remove();
        this.hintTimers.delete(t2);
      }, LEAVE_MS);
      this.hintTimers.add(t2);
      this.hintTimers.delete(t);
    }, seconds * 1000);
    this.hintTimers.add(t);
    return node;
  }

  /** Remove the lesson hints (a new step started). */
  clearHints(): void {
    for (const t of this.hintTimers) clearTimeout(t);
    this.hintTimers.clear();
    this.hintsEl.replaceChildren();
  }

  clear(): void {
    this.clearTimers();
    this.queue = [];
    this.shown = null;
    this.bar.hidden = true;
    this.bar.classList.remove('leaving');
    this.refreshPrompt();
  }

  private show(req: SpeechRequest): void {
    this.clearTimers();
    this.shown = req;
    this.bar.classList.remove('leaving', 'who-instructor', 'who-examiner', 'who-system', 'priority-0', 'priority-1', 'priority-2', 'priority-3');
    this.bar.classList.add(`who-${req.who}`, `priority-${req.priority}`);
    setText(this.speakerEl, SPEAKER[req.who] ?? req.who);
    setText(this.textEl, req.text);
    toggleClass(this.bar, 'long', req.text.length > 90);
    if (this.enabled) setHidden(this.bar, false);
    this.refreshPrompt();
  }

  private hide(): void {
    if (this.bar.hidden) {
      this.shown = null;
      this.refreshPrompt();
      return;
    }
    this.bar.classList.add('leaving');
    this.leaveTimer = setTimeout(() => {
      this.bar.hidden = true;
      this.bar.classList.remove('leaving');
      this.shown = null;
      this.refreshPrompt();
    }, LEAVE_MS);
  }

  private refreshPrompt(): void {
    setHidden(this.promptEl, !(this.idlePrompt && !this.shown));
  }

  private clearTimers(): void {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.lingerTimer = undefined;
    this.leaveTimer = undefined;
  }

  dispose(): void {
    this.clearTimers();
    for (const t of this.hintTimers) clearTimeout(t);
    this.el.remove();
  }
}
