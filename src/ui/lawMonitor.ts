/**
 * Law monitor: stacked chips for recent 'violation' events (severity colour, label from
 * VIOLATIONS) and small praise chips for GOOD_* observations.
 *
 * Lifecycle (wall clock, setTimeout): a chip fades after CHIP_TTL.default seconds,
 * critical chips stay CHIP_TTL.critical seconds with a shake animation, praise chips
 * CHIP_TTL.praise seconds. At most MAX_VIOLATION_CHIPS violation chips are shown (oldest
 * dropped). A repeated violation of the same type refreshes its chip and shows a count.
 */
import { VIOLATIONS, type Severity, type Violation } from '@/rules/violations';
import { el, setText } from './dom';
import { icon, type IconName } from './icons';
import { HUD, SEVERITY_LABEL } from './strings.he';

export const CHIP_TTL = { default: 8, critical: 15, praise: 5 } as const;
export const MAX_VIOLATION_CHIPS = 4;
export const MAX_PRAISE_CHIPS = 2;
const LEAVE_MS = 350;

export interface ChipData {
  id: number;
  type: string;
  label: string;
  severity: Severity;
  kind: 'violation' | 'praise';
  /** Seconds the chip stays visible. */
  ttl: number;
  context?: string;
  count: number;
}

/** Pure: decide whether a violation becomes a chip and how long it lives. */
export function chipFor(v: Violation, id: number): ChipData | null {
  const info = VIOLATIONS[v.type as keyof typeof VIOLATIONS];
  const label = info?.label ?? String(v.type);
  const severity: Severity = v.severity ?? info?.severity ?? 'minor';
  if (severity === 'info') {
    if (!String(v.type).startsWith('GOOD_')) return null;
    return { id, type: v.type, label, severity, kind: 'praise', ttl: CHIP_TTL.praise, context: v.context, count: 1 };
  }
  return { id, type: v.type, label, severity, kind: 'violation', ttl: severity === 'critical' ? CHIP_TTL.critical : CHIP_TTL.default, context: v.context, count: 1 };
}

export function iconForViolation(type: string, severity: Severity): IconName {
  if (type.startsWith('GOOD_')) return 'thumbsUp';
  if (type.startsWith('PEDESTRIAN')) return 'pedestrian';
  if (type === 'RED_LIGHT' || type === 'AMBER_RUN' || type === 'RED_AMBER_START' || type === 'GREEN_NOT_MOVING') return 'signal';
  if (type.startsWith('STOP_')) return 'stop';
  if (type.startsWith('SPEEDING') || type === 'TOO_SLOW') return 'speedometer';
  if (type.startsWith('NO_INDICATOR') || type.startsWith('INDICATOR')) return 'indicatorRight';
  if (type.startsWith('NO_MIRROR') || type.startsWith('NO_SHOULDER')) return 'mirror';
  if (type === 'SEATBELT') return 'seatbelt';
  if (type === 'HANDBRAKE_ON') return 'handbrake';
  if (type === 'WRONG_GEAR') return 'gear';
  if (type.includes('PARKING')) return 'park';
  if (type === 'FAILED_TO_YIELD' || type === 'LEFT_TURN_NO_YIELD' || type === 'ROUNDABOUT_NO_YIELD') return 'giveWay';
  if (type === 'EXAMINER_INTERVENTION') return 'brake';
  if (type === 'COLLISION' || type === 'NEAR_MISS') return 'car';
  return severity === 'critical' ? 'warning' : 'info';
}

interface LiveChip {
  data: ChipData;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  leaveTimer?: ReturnType<typeof setTimeout>;
}

export class LawMonitor {
  readonly el: HTMLElement;
  private chips: LiveChip[] = [];
  private seq = 0;

  constructor() {
    this.el = el('div', { class: 'law-monitor', attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': HUD.lawMonitor } });
  }

  /** Visible chips, newest first. */
  get active(): ChipData[] {
    return this.chips.filter((c) => !c.leaveTimer).map((c) => c.data);
  }

  setVisible(visible: boolean): void {
    if (this.el.hidden === !visible) return;
    this.el.hidden = !visible;
  }

  push(v: Violation): ChipData | null {
    const data = chipFor(v, ++this.seq);
    if (!data) return null;
    // same type still visible → refresh instead of stacking
    const existing = this.chips.find((c) => c.data.type === data.type && !c.leaveTimer);
    if (existing) {
      existing.data.count++;
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => this.leave(existing), existing.data.ttl * 1000);
      this.render(existing);
      this.el.prepend(existing.el);
      return existing.data;
    }
    const node = el('div', { class: `chip ${data.kind === 'praise' ? 'praise' : 'sev-' + data.severity}`, attrs: { role: 'status', 'data-type': data.type } });
    const live: LiveChip = { data, el: node, timer: setTimeout(() => this.leave(live), data.ttl * 1000) };
    this.render(live);
    this.chips.unshift(live);
    this.el.prepend(node);
    this.enforceLimits();
    return data;
  }

  private render(c: LiveChip): void {
    const { data } = c;
    c.el.innerHTML = '';
    c.el.appendChild(icon(iconForViolation(data.type, data.severity), { size: 20 }));
    const label = el('span', { class: 'chip-label', text: data.count > 1 ? `${data.label} ×${data.count}` : data.label });
    c.el.appendChild(label);
    if (data.kind === 'violation') c.el.appendChild(el('span', { class: 'chip-sev', text: SEVERITY_LABEL[data.severity] ?? '' }));
    c.el.setAttribute('aria-label', `${data.kind === 'praise' ? HUD.lawMonitor : SEVERITY_LABEL[data.severity]}: ${data.label}`);
  }

  private enforceLimits(): void {
    const violations = this.chips.filter((c) => c.data.kind === 'violation' && !c.leaveTimer);
    for (const c of violations.slice(MAX_VIOLATION_CHIPS)) this.leave(c);
    const praise = this.chips.filter((c) => c.data.kind === 'praise' && !c.leaveTimer);
    for (const c of praise.slice(MAX_PRAISE_CHIPS)) this.leave(c);
  }

  private leave(c: LiveChip): void {
    if (c.leaveTimer) return;
    clearTimeout(c.timer);
    c.el.classList.add('leaving');
    c.leaveTimer = setTimeout(() => {
      c.el.remove();
      this.chips = this.chips.filter((x) => x !== c);
    }, LEAVE_MS);
  }

  clear(): void {
    for (const c of this.chips) {
      clearTimeout(c.timer);
      if (c.leaveTimer) clearTimeout(c.leaveTimer);
      c.el.remove();
    }
    this.chips = [];
  }

  dispose(): void {
    this.clear();
    setText(this.el, '');
  }
}
