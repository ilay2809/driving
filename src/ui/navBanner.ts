/**
 * Navigation banner (top centre): arrow by instruction kind + "בעוד 120 מ׳" + street name,
 * with a progress hint that fills as the car approaches the manoeuvre point.
 *
 * The distance shown is the event's distance minus the distance the car has travelled
 * since the event, so the banner stays truthful even if the navigator only emits when the
 * instruction changes.
 */
import type { NavInstruction } from '@/core/events';
import type { SimContext } from '@/core/sim';
import { dist2, type Vec2 } from '@/world/geo';
import { el, replayClass, setHidden, setText, toggleClass } from './dom';
import { formatNavDistance } from './format';
import { icon, navIcon, type IconName } from './icons';
import { NAV } from './strings.he';

export const NAV_NOW_THRESHOLD_M = 15;
/** Seconds after the manoeuvre point was passed before the banner hides itself. */
export const NAV_HIDE_AFTER_S = 6;

export interface NavDisplay {
  main: string;
  distance: string;
  street: string;
  exit: string;
  icon: IconName;
  /** 0..1 of the way from the announcement to the manoeuvre point. */
  progress: number;
  urgent: boolean;
}

/** Pure: compute what the banner shows for an instruction and the remaining distance. */
export function navDisplay(instr: NavInstruction, remaining: number, startDistance: number): NavDisplay {
  const kindLabel = NAV.kinds[instr.kind];
  const main = kindLabel ?? instr.text;
  const exit = instr.kind === 'roundabout_exit' && instr.exitNumber ? NAV.exitNumber(instr.exitNumber) : '';
  const progress = startDistance > 0 ? Math.min(1, Math.max(0, 1 - remaining / startDistance)) : 1;
  return {
    main,
    distance: formatNavDistance(remaining, NAV_NOW_THRESHOLD_M),
    street: instr.streetName ?? '',
    exit,
    icon: navIcon(instr.kind),
    progress,
    urgent: remaining < NAV_NOW_THRESHOLD_M,
  };
}

function sameInstruction(a: NavInstruction, b: NavInstruction): boolean {
  return a.kind === b.kind && a.junctionId === b.junctionId && a.exitNumber === b.exitNumber && a.streetName === b.streetName;
}

export class NavBanner {
  readonly el: HTMLElement;
  private iconEl: HTMLElement;
  private mainEl: HTMLElement;
  private distEl: HTMLElement;
  private streetEl: HTMLElement;
  private exitEl: HTMLElement;
  private barEl: HTMLElement;
  private current?: NavInstruction;
  private startDistance = 0;
  private travelled = 0;
  private lastPos?: Vec2;
  private passedFor = 0;
  private lastIcon?: IconName;
  private lastRender?: string;

  constructor() {
    this.iconEl = el('div', { class: 'nav-icon' });
    this.mainEl = el('div', { class: 'nav-main' });
    this.distEl = el('span', { class: 'nav-dist num' });
    this.streetEl = el('span', { class: 'nav-street' });
    this.exitEl = el('span', { class: 'nav-exit' });
    this.barEl = el('i');
    this.el = el(
      'div',
      { class: 'nav-banner glass', attrs: { role: 'status', 'aria-live': 'polite' } },
      this.iconEl,
      el('div', { class: 'nav-text' }, el('div', { class: 'nav-main-row' }, this.mainEl), el('div', { class: 'nav-sub' }, this.distEl, this.exitEl, this.streetEl)),
      el('div', { class: 'nav-progress' }, this.barEl),
    );
    this.el.hidden = true;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  set(instr: NavInstruction): void {
    const isNew = !this.current || !sameInstruction(this.current, instr) || instr.distance > this.remaining() + 25;
    this.current = instr;
    this.travelled = 0;
    this.passedFor = 0;
    if (isNew) {
      this.startDistance = Math.max(instr.distance, 1);
      replayClass(this.el, 'nav-banner');
    }
    setHidden(this.el, false);
    this.render();
  }

  clear(): void {
    this.current = undefined;
    this.lastRender = undefined;
    setHidden(this.el, true);
  }

  remaining(): number {
    return this.current ? Math.max(0, this.current.distance - this.travelled) : 0;
  }

  /** Per refresh: integrate the distance driven since the last instruction. */
  update(ctx: SimContext, elapsed = ctx.dt): void {
    const pos = ctx.player.pos;
    if (this.lastPos && this.current) {
      const d = dist2(this.lastPos, pos);
      if (d < 30) this.travelled += d; // ignore teleports
      if (this.remaining() <= 0 && !ctx.paused) {
        this.passedFor += elapsed;
        if (this.passedFor > NAV_HIDE_AFTER_S) this.clear();
      }
    }
    this.lastPos = [pos[0], pos[1]];
    if (this.current) this.render();
  }

  private render(): void {
    if (!this.current) return;
    const d = navDisplay(this.current, this.remaining(), this.startDistance);
    const key = `${d.main}|${d.distance}|${d.street}|${d.exit}|${d.icon}|${Math.round(d.progress * 50)}|${d.urgent}`;
    if (key === this.lastRender) return;
    this.lastRender = key;
    if (this.lastIcon !== d.icon) {
      this.iconEl.innerHTML = '';
      this.iconEl.appendChild(icon(d.icon, { size: 30 }));
      this.lastIcon = d.icon;
    }
    setText(this.mainEl, d.main);
    setText(this.distEl, d.distance);
    setText(this.exitEl, d.exit);
    setText(this.streetEl, d.street);
    this.barEl.style.width = `${Math.round(d.progress * 100)}%`;
    toggleClass(this.el, 'urgent', d.urgent);
  }
}
