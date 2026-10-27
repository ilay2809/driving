/**
 * HUD: instrument cluster (bottom right), speed-limit sign + law monitor (left),
 * navigation banner + mirror glances + toasts (top centre), coach presence (top right).
 * `update(ctx)` diffs against the last rendered values so DOM writes only happen on change.
 */
import type { SimContext } from '@/core/sim';
import type { GlanceTarget, Lights } from '@/core/types';
import { el, replayClass, setHidden, setText, toggleClass } from './dom';
import { kmh } from './format';
import { icon, type IconName } from './icons';
import { LawMonitor } from './lawMonitor';
import { NavBanner } from './navBanner';
import { HUD, INTERVENTION, MANEUVER, MANEUVER_STATUS, PRESENCE, INSTRUCTOR_NAME } from './strings.he';
import type { CoachPresence } from './types';

export const RPM_MAX = 6500;
/** Over-limit tolerance before the speed readout turns red (km/h). */
export const OVER_LIMIT_TOLERANCE = 3;

export interface HudSnapshot {
  speed: number;
  gear: string;
  rpm: number;
  indicator: string;
  lights: Lights;
  seatbeltWarn: boolean;
  seatbeltBlink: boolean;
  handbrake: boolean;
  limit: number;
  over: boolean;
  paused: boolean;
}

export function snapshotOf(ctx: SimContext): HudSnapshot {
  const p = ctx.player;
  const speed = kmh(p.speed);
  const moving = Math.abs(p.speed) > 0.5;
  const limit = Math.round(ctx.localisation.speedLimit || 50);
  return {
    speed,
    gear: p.gear,
    rpm: Math.round(Math.min(1, Math.max(0, p.rpm / RPM_MAX)) * 100),
    indicator: p.indicator,
    lights: p.lights,
    seatbeltWarn: !p.seatbelt,
    seatbeltBlink: !p.seatbelt && moving,
    handbrake: p.handbrake,
    limit,
    over: speed > limit + OVER_LIMIT_TOLERANCE,
    paused: ctx.paused,
  };
}

class Tell {
  readonly el: HTMLElement;
  constructor(cls: string, iconName: IconName, label: string) {
    this.el = el('span', { class: `tell ${cls}`, attrs: { role: 'img', 'aria-label': label, title: label } }, icon(iconName, { size: 24 }));
  }
  set(on: boolean, extra?: string): void {
    toggleClass(this.el, 'on', on);
    if (extra !== undefined) this.el.dataset.state = extra;
    this.el.setAttribute('aria-hidden', on ? 'false' : 'true');
  }
}

export class Hud {
  readonly el: HTMLElement;
  readonly regions: { tl: HTMLElement; tc: HTMLElement; tr: HTMLElement; br: HTMLElement; bl: HTMLElement };
  readonly lawMonitor = new LawMonitor();
  readonly navBanner = new NavBanner();

  private speedSign: HTMLElement;
  private speedSignNum: HTMLElement;
  private speedNum: HTMLElement;
  private rpmFill: HTMLElement;
  private gears: Record<string, HTMLElement> = {};
  private tells: { left: Tell; right: Tell; hazard: Tell; lights: Tell; seatbelt: Tell; handbrake: Tell };
  private lightsIcons: Record<string, SVGSVGElement>;
  private mirrors: Record<'left' | 'rear' | 'right', HTMLElement>;
  private mirrorTimers: Partial<Record<'left' | 'rear' | 'right', ReturnType<typeof setTimeout>>> = {};
  private coachBadge: HTMLElement;
  private coachBadgeText: HTMLElement;
  private coachBadgeIcon: HTMLElement;
  private stepEl: HTMLElement;
  private pausedEl: HTMLElement;
  private maneuverEl: HTMLElement;
  private maneuverText: HTMLElement;
  private maneuverStatus: HTMLElement;
  private maneuverTimer?: ReturnType<typeof setTimeout>;
  private vignette: HTMLElement;
  private banner?: HTMLElement;
  private bannerTimer?: ReturnType<typeof setTimeout>;
  private highlightTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private last?: HudSnapshot;
  private presence: CoachPresence = 'none';

  constructor() {
    // --- top left: speed limit sign + law monitor
    this.speedSignNum = el('span', { class: 'num', text: '50' });
    this.speedSign = el('div', { class: 'speed-sign', attrs: { role: 'img', 'aria-label': HUD.speedLimitAria(50) } }, this.speedSignNum);
    const tl = el('div', { class: 'hud-tl' }, this.speedSign, this.lawMonitor.el);

    // --- top centre: nav banner, manoeuvre card, mirror row, toasts
    this.maneuverText = el('span', { class: 'maneuver-text' });
    this.maneuverStatus = el('span', { class: 'maneuver-status' });
    this.maneuverEl = el('div', { class: 'maneuver-card glass', attrs: { role: 'status' } }, icon('examiner', { size: 20 }), this.maneuverText, this.maneuverStatus);
    this.maneuverEl.hidden = true;
    this.mirrors = {
      left: el('span', { class: 'mirror-ind left', attrs: { role: 'img', 'aria-label': HUD.mirrors.left, title: HUD.mirrors.left } }, icon('mirror', { size: 16 })),
      rear: el('span', { class: 'mirror-ind rear', attrs: { role: 'img', 'aria-label': HUD.mirrors.rear, title: HUD.mirrors.rear } }, icon('mirror', { size: 18 })),
      right: el('span', { class: 'mirror-ind right', attrs: { role: 'img', 'aria-label': HUD.mirrors.right, title: HUD.mirrors.right } }, icon('mirror', { size: 16 })),
    };
    const mirrorRow = el('div', { class: 'mirror-row' }, this.mirrors.left, this.mirrors.rear, this.mirrors.right);
    const tc = el('div', { class: 'hud-tc' }, this.navBanner.el, this.maneuverEl, mirrorRow);

    // --- top right: coach badge, lesson step, paused
    this.coachBadgeIcon = el('span', { class: 'coach-badge-icon' }, icon('car', { size: 22 }));
    this.coachBadgeText = el('span', { text: PRESENCE.none });
    this.coachBadge = el('div', { class: 'coach-badge glass presence-none', attrs: { role: 'status' } }, this.coachBadgeIcon, this.coachBadgeText);
    this.stepEl = el('div', { class: 'lesson-step glass' });
    this.stepEl.hidden = true;
    this.pausedEl = el('div', { class: 'paused-badge glass', attrs: { role: 'status' } }, icon('pause', { size: 16 }), el('span', { text: HUD.paused }));
    this.pausedEl.hidden = true;
    const tr = el('div', { class: 'hud-tr' }, this.coachBadge, this.stepEl, this.pausedEl);

    // --- bottom right: instrument cluster
    this.speedNum = el('span', { class: 'speed-num', text: '0', attrs: { 'aria-label': HUD.speedAria } });
    this.rpmFill = el('i', { class: 'rpm-fill' });
    const gearsEl = el('div', { class: 'gears', attrs: { role: 'group', 'aria-label': HUD.gears } });
    for (const g of ['P', 'R', 'N', 'D']) {
      const gel = el('span', { class: `gear gear-${g}`, text: g, attrs: { 'aria-label': HUD.gearAria(g) } });
      this.gears[g] = gel;
      gearsEl.appendChild(gel);
    }
    this.tells = {
      left: new Tell('indicator left', 'indicatorLeft', HUD.indicatorLeft),
      hazard: new Tell('hazard', 'hazard', HUD.hazard),
      right: new Tell('indicator right', 'indicatorRight', HUD.indicatorRight),
      lights: new Tell('lights', 'lightsLow', HUD.lights.low ?? ''),
      seatbelt: new Tell('seatbelt', 'seatbelt', HUD.seatbelt),
      handbrake: new Tell('handbrake', 'handbrake', HUD.handbrake),
    };
    this.lightsIcons = { low: icon('lightsLow', { size: 24 }), high: icon('lightsHigh', { size: 24 }), parking: icon('lightsParking', { size: 24 }) };
    const tells = el('div', { class: 'tells' }, this.tells.left.el, this.tells.hazard.el, this.tells.right.el, this.tells.lights.el, this.tells.seatbelt.el, this.tells.handbrake.el);
    const cluster = el(
      'div',
      { class: 'cluster glass', attrs: { role: 'group', 'aria-label': 'לוח מחוונים' } },
      el('div', { class: 'cluster-speed' }, this.speedNum, el('span', { class: 'speed-unit', text: HUD.kmh })),
      el('div', { class: 'rpm-bar', attrs: { role: 'meter', 'aria-label': HUD.rpm, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 } }, this.rpmFill),
      gearsEl,
      tells,
    );
    const br = el('div', { class: 'hud-br' }, cluster);

    // --- bottom left: minimap slot (filled by UISystem)
    const bl = el('div', { class: 'hud-bl' });

    this.vignette = el('div', { class: 'vignette', attrs: { 'aria-hidden': 'true' } });

    this.regions = { tl, tc, tr, br, bl };
    this.el = el('div', { class: 'ui-hud' }, tl, tc, tr, br, bl, this.vignette);
    this.el.style.pointerEvents = 'none';
    this.setGear('P');
  }

  // ------------------------------------------------------------ per frame
  /** `elapsed` = wall seconds since the previous refresh (defaults to the frame dt). */
  update(ctx: SimContext, elapsed = ctx.dt): void {
    const s = snapshotOf(ctx);
    const l = this.last;
    if (!l || l.speed !== s.speed) setText(this.speedNum, String(s.speed));
    if (!l || l.over !== s.over) {
      toggleClass(this.speedNum, 'over', s.over);
      toggleClass(this.speedSign, 'over', s.over);
    }
    if (!l || l.rpm !== s.rpm) {
      this.rpmFill.style.width = `${s.rpm}%`;
      this.rpmFill.parentElement?.setAttribute('aria-valuenow', String(s.rpm));
    }
    if (!l || l.gear !== s.gear) this.setGear(s.gear);
    if (!l || l.indicator !== s.indicator) {
      this.tells.left.set(s.indicator === 'left' || s.indicator === 'hazard');
      this.tells.right.set(s.indicator === 'right' || s.indicator === 'hazard');
      this.tells.hazard.set(s.indicator === 'hazard');
    }
    if (!l || l.lights !== s.lights) this.setLights(s.lights);
    if (!l || l.seatbeltWarn !== s.seatbeltWarn || l.seatbeltBlink !== s.seatbeltBlink) {
      this.tells.seatbelt.set(s.seatbeltWarn);
      toggleClass(this.tells.seatbelt.el, 'moving', s.seatbeltBlink);
    }
    if (!l || l.handbrake !== s.handbrake) this.tells.handbrake.set(s.handbrake);
    if (!l || l.limit !== s.limit) this.setSpeedLimit(s.limit, !!l);
    if (!l || l.paused !== s.paused) setHidden(this.pausedEl, !s.paused);
    this.last = s;
    this.navBanner.update(ctx, elapsed);
  }

  private setGear(gear: string): void {
    for (const [g, node] of Object.entries(this.gears)) {
      const on = g === gear;
      toggleClass(node, 'on', on);
      node.setAttribute('aria-current', on ? 'true' : 'false');
    }
  }

  private setLights(lights: Lights): void {
    const t = this.tells.lights;
    t.el.classList.remove('low', 'high', 'parking');
    if (lights === 'off') {
      t.set(false);
      return;
    }
    const svg = this.lightsIcons[lights];
    if (svg) {
      t.el.innerHTML = '';
      t.el.appendChild(svg);
    }
    t.el.classList.add(lights);
    t.el.setAttribute('aria-label', HUD.lights[lights] ?? '');
    t.set(true);
  }

  setSpeedLimit(limit: number, pulse = true): void {
    setText(this.speedSignNum, String(limit));
    this.speedSign.setAttribute('aria-label', HUD.speedLimitAria(limit));
    if (pulse) replayClass(this.speedSign, 'pulse');
  }

  get speedLimitText(): string {
    return this.speedSignNum.textContent ?? '';
  }

  // ------------------------------------------------------------- events
  glance(target: GlanceTarget): void {
    const key = target === 'left_mirror' || target === 'left_shoulder' ? 'left' : target === 'right_mirror' || target === 'right_shoulder' ? 'right' : target === 'rear_mirror' ? 'rear' : undefined;
    if (!key) return;
    const node = this.mirrors[key];
    const shoulder = target.endsWith('shoulder');
    node.classList.add('lit');
    toggleClass(node, 'shoulder', shoulder);
    const prev = this.mirrorTimers[key];
    if (prev) clearTimeout(prev);
    this.mirrorTimers[key] = setTimeout(() => node.classList.remove('lit', 'shoulder'), 900);
  }

  setPresence(presence: CoachPresence, name?: string): void {
    this.presence = presence;
    this.coachBadge.classList.remove('presence-instructor', 'presence-examiner', 'presence-none');
    this.coachBadge.classList.add(`presence-${presence}`);
    const text = presence === 'instructor' && name ? `${PRESENCE.instructor.split(' — ')[0]} — ${name}` : PRESENCE[presence];
    setText(this.coachBadgeText, text);
    this.coachBadgeIcon.innerHTML = '';
    this.coachBadgeIcon.appendChild(icon(presence === 'instructor' ? 'instructor' : presence === 'examiner' ? 'examiner' : 'car', { size: 22 }));
  }

  get currentPresence(): CoachPresence {
    return this.presence;
  }

  setStep(index: number, total: number, title?: string): void {
    if (total <= 0) {
      setHidden(this.stepEl, true);
      return;
    }
    setText(this.stepEl, title ? `${HUD.step(index, total)} — ${title}` : HUD.step(index, total));
    setHidden(this.stepEl, false);
  }

  clearStep(): void {
    setHidden(this.stepEl, true);
  }

  setManeuver(kind: string, text: string, status: 'requested' | 'completed' | 'failed'): void {
    if (this.maneuverTimer) clearTimeout(this.maneuverTimer);
    setText(this.maneuverText, MANEUVER[kind] ?? text);
    setText(this.maneuverStatus, MANEUVER_STATUS[status] ?? status);
    this.maneuverEl.classList.remove('requested', 'completed', 'failed');
    this.maneuverEl.classList.add(status);
    setHidden(this.maneuverEl, false);
    if (status !== 'requested') this.maneuverTimer = setTimeout(() => setHidden(this.maneuverEl, true), 4000);
  }

  flashVignette(): void {
    replayClass(this.vignette, 'flash');
  }

  /** Big short banner for examiner / instructor interventions. */
  intervention(kind: 'brake' | 'wheel'): void {
    this.flashVignette();
    const who = this.presence === 'examiner' ? INTERVENTION.examiner : INTERVENTION.instructor;
    this.showBanner(who[kind], 'brake', 2600);
  }

  showBanner(text: string, iconName: IconName, ms: number): void {
    this.banner?.remove();
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    const b = el('div', { class: 'intervention-banner', attrs: { role: 'alert' } }, icon(iconName, { size: 34 }), el('span', { text }));
    this.el.appendChild(b);
    this.banner = b;
    this.bannerTimer = setTimeout(() => {
      b.classList.add('leaving');
      setTimeout(() => b.remove(), 500);
    }, ms);
  }

  /** 'lesson:highlight' targets that live in the HUD. Returns false for 3D targets. */
  highlight(target: string, seconds: number): boolean {
    const nodes: HTMLElement[] = [];
    switch (target) {
      case 'indicator':
        nodes.push(this.tells.left.el, this.tells.right.el);
        break;
      case 'gear':
        nodes.push(...Object.values(this.gears));
        break;
      case 'speedometer':
        nodes.push(this.speedNum);
        break;
      case 'mirror_left':
        nodes.push(this.mirrors.left);
        break;
      case 'mirror_right':
        nodes.push(this.mirrors.right);
        break;
      case 'mirror_rear':
        nodes.push(this.mirrors.rear);
        break;
      case 'seatbelt':
        nodes.push(this.tells.seatbelt.el);
        break;
      case 'handbrake':
        nodes.push(this.tells.handbrake.el);
        break;
      default:
        return false;
    }
    for (const n of nodes) {
      n.classList.add('hud-highlight');
      const prev = this.highlightTimers.get(n);
      if (prev) clearTimeout(prev);
      this.highlightTimers.set(n, setTimeout(() => n.classList.remove('hud-highlight'), seconds * 1000));
    }
    return true;
  }

  dispose(): void {
    this.lawMonitor.dispose();
    for (const t of Object.values(this.mirrorTimers)) if (t) clearTimeout(t);
    for (const t of this.highlightTimers.values()) clearTimeout(t);
    if (this.maneuverTimer) clearTimeout(this.maneuverTimer);
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.el.remove();
  }
}

export { INSTRUCTOR_NAME };
