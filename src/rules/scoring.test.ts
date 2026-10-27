import { describe, expect, it } from 'vitest';
import { RulesScorer } from './scoring';
import type { Severity, Violation } from './violations';

const v = (severity: Severity): Violation => ({ type: 'LANE_DEPARTURE', severity, time: 0, pos: [0, 0] });

describe('RulesScorer', () => {
  it('counts, scores and passes a clean drive', () => {
    const s = new RulesScorer();
    s.add(v('info'));
    s.add(v('minor'));
    s.add(v('minor'));
    s.add(v('major'));
    const sum = s.summary();
    expect(sum.counts).toEqual({ info: 1, minor: 2, major: 1, critical: 0 });
    expect(sum.points).toBe(6);
    expect(sum.total).toBe(4);
    expect(sum.passed).toBe(true);
    expect(sum.failReasons).toEqual([]);
    expect(s.isFailed).toBe(false);
  });

  it('fails on a critical, on too many majors or on too many points', () => {
    const a = new RulesScorer();
    a.add(v('critical'));
    expect(a.summary().passed).toBe(false);
    expect(a.summary().failReasons.length).toBeGreaterThan(0);
    const b = new RulesScorer();
    b.add(v('major'));
    b.add(v('major'));
    expect(b.summary().passed).toBe(true);
    b.add(v('major'));
    expect(b.summary().passed).toBe(false); // 3 majors > maxMajor 2 (and 12 points is still allowed)
    const c = new RulesScorer();
    for (let i = 0; i < 13; i++) c.add(v('minor'));
    expect(c.summary().points).toBe(13);
    expect(c.summary().passed).toBe(false);
  });

  it('supports an external failure reason and reset', () => {
    const s = new RulesScorer();
    s.failed('התערבות הבוחן');
    s.failed('התערבות הבוחן');
    expect(s.summary().passed).toBe(false);
    expect(s.summary().failReasons).toEqual(['התערבות הבוחן']);
    s.reset();
    expect(s.summary().passed).toBe(true);
    expect(s.points).toBe(0);
  });
});
