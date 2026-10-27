/**
 * TestScorer — the examiner's rubric: points per severity (SEVERITY_POINTS), fail on any
 * critical error, on more than `maxMajor` major errors or on more than `failPoints`
 * points. `verdict()` adds Hebrew reasons and a 2–3 sentence examiner summary
 * (strengths / weaknesses by category).
 */
import { SEVERITY_POINTS, TEST_RUBRIC, VIOLATIONS, type Severity, type Violation, type ViolationType } from '@/rules/violations';
import type { LineTable } from './lines';
import type { TestVerdict } from './types';

export type Rubric = { failPoints: number; maxMajor: number };

export type ViolationCategory = 'speed' | 'signals' | 'priority' | 'signalling' | 'lane' | 'control' | 'observation' | 'parking' | 'instructions';

export const CATEGORY_OF: Partial<Record<ViolationType, ViolationCategory>> = {
  SPEEDING_MINOR: 'speed',
  SPEEDING_MAJOR: 'speed',
  SPEEDING_CRITICAL: 'speed',
  TOO_SLOW: 'speed',
  HESITATION: 'speed',
  RED_LIGHT: 'signals',
  AMBER_RUN: 'signals',
  RED_AMBER_START: 'signals',
  GREEN_NOT_MOVING: 'signals',
  STOP_SIGN_NO_STOP: 'priority',
  STOP_SIGN_ROLLING: 'priority',
  STOP_LINE_OVERRUN: 'priority',
  FAILED_TO_YIELD: 'priority',
  ROUNDABOUT_NO_YIELD: 'priority',
  ROUNDABOUT_WRONG_LANE: 'lane',
  PEDESTRIAN_NOT_YIELDED: 'priority',
  PEDESTRIAN_NEAR_MISS: 'priority',
  LEFT_TURN_NO_YIELD: 'priority',
  NO_INDICATOR_TURN: 'signalling',
  NO_INDICATOR_LANE_CHANGE: 'signalling',
  INDICATOR_LATE: 'signalling',
  INDICATOR_LEFT_ON: 'signalling',
  WRONG_LANE_FOR_TURN: 'lane',
  WRONG_WAY: 'lane',
  NO_ENTRY: 'lane',
  BUS_LANE: 'lane',
  LANE_DEPARTURE: 'lane',
  SOLID_LINE_CROSSED: 'lane',
  CENTRE_LINE_CROSSED: 'lane',
  KERB_MOUNT: 'control',
  KERB_STRIKE: 'control',
  WIDE_TURN: 'lane',
  CUT_CORNER: 'lane',
  TAILGATING: 'control',
  HARSH_BRAKING: 'control',
  HARSH_ACCELERATION: 'control',
  COLLISION: 'control',
  NEAR_MISS: 'control',
  HANDBRAKE_ON: 'control',
  WRONG_GEAR: 'control',
  SEATBELT: 'control',
  ENGINE_OFF_ROLL: 'control',
  NO_MIRROR_CHECK: 'observation',
  NO_SHOULDER_CHECK: 'observation',
  ILLEGAL_STOP: 'parking',
  ILLEGAL_PARKING: 'parking',
  PARKING_TOO_FAR: 'parking',
  PARKING_ANGLE: 'parking',
  BLOCKING_JUNCTION: 'priority',
  MISSED_INSTRUCTION: 'instructions',
  WRONG_TURN: 'instructions',
  EXAMINER_INTERVENTION: 'control',
};

export const CATEGORIES: ViolationCategory[] = ['speed', 'signals', 'priority', 'signalling', 'lane', 'control', 'observation', 'parking', 'instructions'];

export class TestScorer {
  readonly violations: Violation[] = [];
  readonly rubric: Rubric;
  private readonly counts = new Map<ViolationType, number>();
  private pts = 0;
  private bySeverity: Record<Severity, number> = { info: 0, minor: 0, major: 0, critical: 0 };

  constructor(rubric: Rubric = TEST_RUBRIC) {
    this.rubric = rubric;
  }

  /** Record a violation (infos are kept for the list but score nothing). */
  record(v: Violation): void {
    this.violations.push(v);
    const severity = VIOLATIONS[v.type]?.severity ?? v.severity;
    this.bySeverity[severity]++;
    this.pts += SEVERITY_POINTS[severity];
    this.counts.set(v.type, (this.counts.get(v.type) ?? 0) + 1);
  }

  get points(): number {
    return this.pts;
  }
  get criticals(): number {
    return this.bySeverity.critical;
  }
  get majors(): number {
    return this.bySeverity.major;
  }
  get minors(): number {
    return this.bySeverity.minor;
  }
  get byType(): Partial<Record<ViolationType, number>> {
    return Object.fromEntries(this.counts) as Partial<Record<ViolationType, number>>;
  }
  get failed(): boolean {
    return this.criticals > 0 || this.majors > this.rubric.maxMajor || this.pts > this.rubric.failPoints;
  }

  /** Points per category (for the summary and the "weak points" UI). */
  pointsByCategory(): Record<ViolationCategory, number> {
    const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<ViolationCategory, number>;
    for (const v of this.violations) {
      const cat = CATEGORY_OF[v.type];
      if (!cat) continue;
      out[cat] += SEVERITY_POINTS[VIOLATIONS[v.type]?.severity ?? v.severity];
    }
    return out;
  }

  verdict(lines: LineTable): TestVerdict {
    const passed = !this.failed;
    const mainReasons: string[] = [];
    if (!passed) {
      const seen = new Set<ViolationType>();
      for (const v of this.violations) {
        if ((VIOLATIONS[v.type]?.severity ?? v.severity) !== 'critical' || seen.has(v.type)) continue;
        seen.add(v.type);
        mainReasons.push(lines.line('verdict.reason.critical', { label: VIOLATIONS[v.type]?.label ?? v.type }));
      }
      if (this.majors > this.rubric.maxMajor) mainReasons.push(lines.line('verdict.reason.majors', { n: this.majors, max: this.rubric.maxMajor }));
      if (this.pts > this.rubric.failPoints && this.criticals === 0) mainReasons.push(lines.line('verdict.reason.points', { points: this.pts, max: this.rubric.failPoints }));
    }
    return {
      passed,
      points: this.pts,
      byType: this.byType,
      mainReasons,
      examinerSummary: this.summary(lines, passed),
      majors: this.majors,
      criticals: this.criticals,
      minors: this.minors,
    };
  }

  private summary(lines: LineTable, passed: boolean): string {
    const byCat = this.pointsByCategory();
    const sentences: string[] = [lines.line(passed ? 'verdict.passed' : 'verdict.failed')];
    const weak = CATEGORIES.filter((c) => byCat[c] > 0).sort((a, b) => byCat[b] - byCat[a]);
    const strong = CATEGORIES.filter((c) => byCat[c] === 0 && c !== 'instructions');
    const join = lines.line('verdict.list_join');
    const name = (c: ViolationCategory) => lines.line(`verdict.category.${c}`);
    if (weak.length === 0) sentences.push(lines.line('verdict.clean'));
    else {
      if (strong.length > 0) sentences.push(lines.line('verdict.strengths', { list: strong.slice(0, 2).map(name).join(join) }));
      sentences.push(lines.line('verdict.weaknesses', { list: weak.slice(0, 2).map(name).join(join) }));
    }
    return sentences.slice(0, 3).join(' ');
  }
}
