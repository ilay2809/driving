/**
 * Loading screen: progress bar + label + rotating Hebrew tips about Israeli traffic rules.
 */
import { el, setHidden, setText } from './dom';
import { icon } from './icons';
import { COMMON, LOADING } from './strings.he';

const TIP_INTERVAL_MS = 5000;

export class LoadingScreen {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private labelEl: HTMLElement;
  private tipEl: HTMLElement;
  private tipIndex = 0;
  private tipTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.bar = el('i');
    this.labelEl = el('div', { class: 'loading-label', text: COMMON.loading });
    this.tipEl = el('span');
    this.el = el(
      'div',
      { class: 'ui-loading', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': LOADING.title, 'aria-busy': 'true' } },
      el(
        'div',
        { class: 'loading-box' },
        el('div', { class: 'menu-logo' }, icon('car', { size: 38 })),
        el('h1', { text: LOADING.title }),
        el('div', { class: 'loading-progress', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 } }, this.bar),
        this.labelEl,
        el('div', { class: 'loading-tip' }, el('b', { text: LOADING.tipLabel }), this.tipEl),
      ),
    );
    this.el.hidden = true;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /** progress 0..1 (null hides the screen). */
  set(progress: number | null, label?: string): void {
    if (progress === null) {
      this.hide();
      return;
    }
    const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    this.bar.style.width = `${pct}%`;
    this.bar.parentElement?.setAttribute('aria-valuenow', String(pct));
    if (label !== undefined) setText(this.labelEl, label);
    if (this.el.hidden) {
      setHidden(this.el, false);
      this.startTips();
    }
  }

  hide(): void {
    setHidden(this.el, true);
    if (this.tipTimer) clearInterval(this.tipTimer);
    this.tipTimer = undefined;
  }

  private startTips(): void {
    this.showTip();
    if (this.tipTimer) clearInterval(this.tipTimer);
    this.tipTimer = setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % LOADING.tips.length;
      this.showTip();
    }, TIP_INTERVAL_MS);
  }

  private showTip(): void {
    setText(this.tipEl, LOADING.tips[this.tipIndex] ?? '');
  }

  dispose(): void {
    this.hide();
    this.el.remove();
  }
}
