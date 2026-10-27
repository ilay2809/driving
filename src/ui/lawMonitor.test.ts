// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Violation, ViolationType } from '@/rules/violations';
import { VIOLATIONS } from '@/rules/violations';
import { CHIP_TTL, LawMonitor, MAX_VIOLATION_CHIPS, chipFor } from './lawMonitor';

function v(type: ViolationType, time = 0): Violation {
  return { type, severity: VIOLATIONS[type].severity, time, pos: [0, 0] };
}

describe('chipFor', () => {
  it('maps severities to TTLs and ignores non-praise info events', () => {
    expect(chipFor(v('SPEEDING_MINOR'), 1)?.ttl).toBe(CHIP_TTL.default);
    expect(chipFor(v('RED_LIGHT'), 1)?.ttl).toBe(CHIP_TTL.critical);
    expect(chipFor(v('GOOD_STOP'), 1)?.kind).toBe('praise');
    expect(chipFor(v('APPROACHING_CROSSING'), 1)).toBeNull();
    expect(chipFor(v('SPEED_LIMIT_CHANGED'), 1)).toBeNull();
    expect(chipFor(v('NO_INDICATOR_TURN'), 1)?.label).toBe(VIOLATIONS.NO_INDICATOR_TURN.label);
  });
});

describe('LawMonitor', () => {
  let lm: LawMonitor;
  beforeEach(() => {
    vi.useFakeTimers();
    lm = new LawMonitor();
    document.body.appendChild(lm.el);
  });
  afterEach(() => {
    lm.dispose();
    vi.useRealTimers();
  });

  it('shows a chip with the Hebrew label and fades it after 8 s', () => {
    lm.push(v('SPEEDING_MINOR'));
    const chip = lm.el.querySelector('.chip')!;
    expect(chip.textContent).toContain(VIOLATIONS.SPEEDING_MINOR.label);
    expect(chip.classList.contains('sev-minor')).toBe(true);
    vi.advanceTimersByTime(7_900);
    expect(lm.active).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(chip.classList.contains('leaving')).toBe(true);
    expect(lm.active).toHaveLength(0);
    vi.advanceTimersByTime(400);
    expect(lm.el.querySelector('.chip')).toBeNull();
  });

  it('keeps critical chips for 15 s with the critical class', () => {
    lm.push(v('RED_LIGHT'));
    const chip = lm.el.querySelector('.chip')!;
    expect(chip.classList.contains('sev-critical')).toBe(true);
    vi.advanceTimersByTime(9_000);
    expect(lm.active).toHaveLength(1);
    vi.advanceTimersByTime(6_500);
    expect(lm.el.querySelector('.chip')).toBeNull();
  });

  it('shows at most 4 violation chips, newest first, plus praise chips', () => {
    const types: ViolationType[] = ['SPEEDING_MINOR', 'NO_INDICATOR_TURN', 'TAILGATING', 'LANE_DEPARTURE', 'HARSH_BRAKING'];
    for (const t of types) lm.push(v(t));
    lm.push(v('GOOD_STOP'));
    const violations = lm.active.filter((c) => c.kind === 'violation');
    expect(violations).toHaveLength(MAX_VIOLATION_CHIPS);
    expect(violations[0]!.type).toBe('HARSH_BRAKING');
    expect(violations.some((c) => c.type === 'SPEEDING_MINOR')).toBe(false);
    const praise = lm.active.filter((c) => c.kind === 'praise');
    expect(praise).toHaveLength(1);
    expect(lm.el.querySelector('.chip.praise')!.textContent).toContain(VIOLATIONS.GOOD_STOP.label);
    expect(lm.el.firstElementChild!.classList.contains('praise')).toBe(true);
  });

  it('merges a repeated violation into one chip with a count and refreshed TTL', () => {
    lm.push(v('SPEEDING_MINOR'));
    vi.advanceTimersByTime(6_000);
    lm.push(v('SPEEDING_MINOR'));
    expect(lm.active).toHaveLength(1);
    expect(lm.active[0]!.count).toBe(2);
    expect(lm.el.querySelector('.chip')!.textContent).toContain('×2');
    vi.advanceTimersByTime(4_000);
    expect(lm.active).toHaveLength(1);
    vi.advanceTimersByTime(4_500);
    expect(lm.el.querySelector('.chip')).toBeNull();
  });

  it('can be hidden via settings', () => {
    lm.setVisible(false);
    expect(lm.el.hidden).toBe(true);
    lm.setVisible(true);
    expect(lm.el.hidden).toBe(false);
  });
});
