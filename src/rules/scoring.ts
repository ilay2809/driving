/**
 * Scoring of violations: counts by severity, points per SEVERITY_POINTS and the pass/fail
 * verdict per TEST_RUBRIC (fail on any critical, on too many majors or when the points
 * exceed the threshold). The examiner can also fail the candidate for an external reason
 * (e.g. a dual-brake intervention) via `failed(reason)`.
 */
import { HE } from './strings.he';
import { SEVERITY_POINTS, TEST_RUBRIC, type Severity, type Violation } from './violations';

export interface ScoreSummary {
  counts: Record<Severity, number>;
  points: number;
  passed: boolean;
  /** Hebrew reasons for failing (empty when passed). */
  failReasons: string[];
  /** Number of recorded violations (all severities). */
  total: number;
}

export interface Rubric {
  failPoints: number;
  maxMajor: number;
}

export class RulesScorer {
  readonly counts: Record<Severity, number> = { info: 0, minor: 0, major: 0, critical: 0 };
  points = 0;
  private externalReasons: string[] = [];

  constructor(public rubric: Rubric = TEST_RUBRIC) {}

  add(v: Violation): void {
    this.counts[v.severity]++;
    this.points += SEVERITY_POINTS[v.severity];
  }

  /** Fail for a reason outside the violation list (examiner intervention, abandoned test …). */
  failed(reason: string): void {
    if (!this.externalReasons.includes(reason)) this.externalReasons.push(reason);
  }

  get isFailed(): boolean {
    return !this.summary().passed;
  }

  summary(): ScoreSummary {
    const failReasons: string[] = [...this.externalReasons];
    if (this.counts.critical > 0) failReasons.push(HE.fail.critical);
    if (this.counts.major > this.rubric.maxMajor) failReasons.push(HE.fail.major);
    if (this.points > this.rubric.failPoints) failReasons.push(HE.fail.points);
    const total = this.counts.info + this.counts.minor + this.counts.major + this.counts.critical;
    return { counts: { ...this.counts }, points: this.points, passed: failReasons.length === 0, failReasons, total };
  }

  reset(): void {
    this.counts.info = 0;
    this.counts.minor = 0;
    this.counts.major = 0;
    this.counts.critical = 0;
    this.points = 0;
    this.externalReasons = [];
  }
}
