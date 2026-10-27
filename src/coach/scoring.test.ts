import { describe, expect, it } from 'vitest';
import type { Violation, ViolationType } from '@/rules/violations';
import { VIOLATIONS } from '@/rules/violations';
import { LineTable } from './lines';
import { TestScorer } from './scoring';

const lines = new LineTable(1);
const v = (type: ViolationType, time = 0): Violation => ({ type, severity: VIOLATIONS[type].severity, time, pos: [0, 0] });

describe('TestScorer', () => {
  it('passes a clean drive with a positive summary', () => {
    const s = new TestScorer();
    s.record(v('GOOD_STOP'));
    const verdict = s.verdict(lines);
    expect(verdict.passed).toBe(true);
    expect(verdict.points).toBe(0);
    expect(verdict.mainReasons).toEqual([]);
    expect(verdict.examinerSummary).toContain('עברת');
    expect(verdict.examinerSummary).toContain('כל הכבוד');
  });

  it('fails on any critical violation and names it', () => {
    const s = new TestScorer();
    s.record(v('NO_INDICATOR_TURN'));
    s.record(v('RED_LIGHT'));
    const verdict = s.verdict(lines);
    expect(verdict.passed).toBe(false);
    expect(verdict.criticals).toBe(1);
    expect(verdict.mainReasons[0]).toContain(VIOLATIONS.RED_LIGHT.label);
    expect(verdict.byType.RED_LIGHT).toBe(1);
    expect(verdict.byType.NO_INDICATOR_TURN).toBe(1);
    expect(verdict.examinerSummary).toContain('לא עברת');
    expect(verdict.examinerSummary).toContain('יש לשפר');
  });

  it('fails on too many majors or too many points, and passes just under the thresholds', () => {
    const majors = new TestScorer();
    for (let i = 0; i < 3; i++) majors.record(v('AMBER_RUN', i * 20));
    expect(majors.failed).toBe(true);
    expect(majors.verdict(lines).mainReasons.some((r) => r.includes('3'))).toBe(true);
    const points = new TestScorer();
    for (let i = 0; i < 13; i++) points.record(v('LANE_DEPARTURE', i * 10));
    expect(points.points).toBe(13);
    const pv = points.verdict(lines);
    expect(pv.passed).toBe(false);
    expect(pv.mainReasons.some((r) => r.includes('13'))).toBe(true);
    const ok = new TestScorer();
    ok.record(v('AMBER_RUN'));
    ok.record(v('AMBER_RUN', 5));
    for (let i = 0; i < 4; i++) ok.record(v('TAILGATING', 20 + i * 15));
    expect(ok.points).toBe(12);
    expect(ok.verdict(lines).passed).toBe(true);
    const custom = new TestScorer({ failPoints: 5, maxMajor: 0 });
    custom.record(v('AMBER_RUN'));
    expect(custom.failed).toBe(true);
  });

  it('summarises strengths and weaknesses by category', () => {
    const s = new TestScorer();
    s.record(v('SPEEDING_MAJOR'));
    s.record(v('SPEEDING_MINOR', 30));
    s.record(v('NO_MIRROR_CHECK', 40));
    const cats = s.pointsByCategory();
    expect(cats.speed).toBe(5);
    expect(cats.observation).toBe(1);
    expect(cats.priority).toBe(0);
    const summary = s.verdict(lines).examinerSummary;
    expect(summary).toContain(lines.line('verdict.category.speed'));
    expect(summary).toContain('נקודות חוזק');
    expect((summary.match(/\.(\s|$)/g) ?? []).length).toBeLessThanOrEqual(3);
  });
});
