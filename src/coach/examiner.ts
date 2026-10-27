/**
 * Examiner — conducts the practical test ("טסט").
 *
 *  - formal greeting, then route instructions through the Navigator (who='examiner', terse)
 *  - records every violation in the TestScorer; silent on minor errors, "שים לב למהירות" once
 *  - requests manoeuvres at places chosen from the graph along the route:
 *      pull_over      quiet residential lane, legal kerb, > 15 m from junctions / crossings
 *      reverse        right after a completed kerb stop (≥ 12 m straight back, |drift| < 0.8 m)
 *      uturn          wide two-way street with a dashed centre line
 *      parallel_park  a parallel parking strip with bays or ≥ 7 m of legal kerb; when the
 *                     traffic module has no parked cars it is asked to place two stationary
 *                     cars ('coach:request' spawn_vehicle × 2, speedKmh 0) to form the gap
 *      emergency_stop straight quiet lane, nobody within 40 m behind: "כשאומר 'עצור'…" then
 *                     "עצור!" — completed when decel > 6 m/s² within 1 s
 *  - intervention (same predictor as the instructor): 'coach:intervention' + an
 *    EXAMINER_INTERVENTION violation (critical) → the test is failed; the candidate drives to
 *    the end of the street, then "המבחן הסתיים."
 *  - end of test: destination reached, 30 min elapsed or a critical failure →
 *    'test:finished' {passed, points, violations, durationSec} with the verdict available
 *    through `verdict`.
 *
 * Note: the examiner emits 'test:started' itself when it begins (first update).
 */
import type { EventBus } from '@/core/events';
import { createRng, type SimContext, type System } from '@/core/sim';
import { angleDiff, dist2, rightOf, type Vec2 } from '@/world/geo';
import type { PathResult, RoadGraph } from '@/world/graph';
import type { Lane, ParkingStrip, RoadClass } from '@/world/schema';
import type { Violation, ViolationType } from '@/rules/violations';
import { agentBehind, predictDanger } from './danger';
import type { DialogueManager } from './dialogue';
import type { Navigator } from './navigator';
import { ParkingMonitor, kerbLegality, legalKerbStretches } from './parking';
import { RouteModel, type RouteSegment } from './routeModel';
import { TestScorer, type Rubric } from './scoring';
import type { ManeuverKind, ParkingReporter, TestVerdict } from './types';

export interface ExaminerOptions {
  route: PathResult;
  routeId?: string;
  rubric?: Rubric;
  /** Manoeuvres to request (in preference order); default: all five. */
  maneuvers?: ManeuverKind[];
  maxManeuvers?: number;
  seed?: number;
  /** Maximum test duration in seconds (default 30 min). */
  maxDurationSec?: number;
  interventions?: boolean;
  /** Arc-length on the last lane where the route ends. */
  endS?: number;
}

export type ExaminerPhase = 'idle' | 'running' | 'failing' | 'finished';

export interface PlannedManeuver {
  kind: ManeuverKind;
  laneId: string;
  /** Segment index of the lane on the route. */
  segmentIndex: number;
  /** Lane arc-length at which the request is made. */
  triggerS: number;
  /** For parallel parking: the strip. */
  strip?: ParkingStrip;
  /** Legal kerb stretch (pull_over). */
  stretch?: { s0: number; s1: number };
}

interface ActiveManeuver {
  plan: PlannedManeuver;
  startedAt: number;
  startPos: Vec2;
  startHeading: number;
  stage: 'requested' | 'prepare' | 'go';
  reversed: number;
  maxDrift: number;
  goAt?: number;
  goSaidAt?: number;
  minAccel: number;
  forwardSinceStart: number;
}

const QUIET: Set<RoadClass> = new Set(['residential', 'living_street', 'unclassified', 'tertiary', 'service']);
const DEFAULT_MANEUVERS: ManeuverKind[] = ['pull_over', 'reverse', 'parallel_park', 'uturn', 'emergency_stop'];
const MIN_SPACING_M = 120;
const INTERVENTION_INTERVAL = 4;

export class Examiner implements System {
  readonly name = 'examiner';
  readonly scorer: TestScorer;
  readonly plan: PlannedManeuver[] = [];
  private phase: ExaminerPhase = 'idle';
  private readonly route: RouteModel;
  private readonly routeId: string;
  private readonly rng: () => number;
  private readonly maxDuration: number;
  private readonly interventionsEnabled: boolean;
  private readonly parking: ParkingMonitor;
  private startTime = 0;
  private lastCtx?: SimContext;
  private active?: ActiveManeuver;
  private planCursor = 0;
  private lastManeuverEnd = -Infinity;
  private speedingNoted = false;
  private lastInterventionAt = -Infinity;
  private failAt?: number;
  private failLane?: string;
  private finishedVerdict?: TestVerdict;
  private finishReason?: 'destination' | 'timeout' | 'failed';
  private readonly offs: (() => void)[] = [];
  private lastInterventionViolationAt = -Infinity;

  constructor(
    private readonly bus: EventBus,
    private readonly dialogue: DialogueManager,
    private readonly graph: RoadGraph,
    private readonly navigator: Navigator,
    private readonly opts: ExaminerOptions,
  ) {
    this.scorer = new TestScorer(opts.rubric);
    this.route = new RouteModel(graph, opts.route, { endS: opts.endS });
    this.routeId = opts.routeId ?? 'custom';
    this.rng = createRng(opts.seed ?? 7);
    this.maxDuration = opts.maxDurationSec ?? 30 * 60;
    this.interventionsEnabled = opts.interventions ?? true;
    this.parking = new ParkingMonitor(graph, dialogue.lines);
    this.plan = this.planManeuvers(opts.maneuvers ?? DEFAULT_MANEUVERS, opts.maxManeuvers ?? 4);
    this.offs.push(bus.on('violation', (v) => this.onViolation(v)));
    this.offs.push(
      navigator.onDeviation((d) => {
        if (this.phase !== 'running' && this.phase !== 'failing') return;
        if (this.active) return; // deviations during a manoeuvre (U-turn) are expected
        this.emitViolation('WRONG_TURN', `${d.junctionId}`);
      }),
    );
  }

  // ---- public API ------------------------------------------------------------------

  get state(): ExaminerPhase {
    return this.phase;
  }
  get verdict(): TestVerdict | undefined {
    return this.finishedVerdict;
  }
  get reason(): string | undefined {
    return this.finishReason;
  }
  get activeManeuver(): ManeuverKind | undefined {
    return this.active?.plan.kind;
  }
  get elapsed(): number {
    return this.lastCtx ? this.lastCtx.time - this.startTime : 0;
  }
  get routeModel(): RouteModel {
    return this.route;
  }

  setParkingReporter(fn: ParkingReporter | undefined): void {
    this.parking.setReporter(fn);
  }

  /** Abort the test without a verdict (menu / reset). */
  abort(): void {
    this.phase = 'finished';
    this.navigator.setOverride(null);
    this.navigator.setRoute(null);
  }

  update(ctx: SimContext): void {
    this.lastCtx = ctx;
    if (this.phase === 'idle') this.start(ctx);
    if (this.is('finished') || ctx.paused) return;
    const report = this.parking.update(ctx);
    if (this.interventionsEnabled) this.checkDanger(ctx);
    if (this.is('running')) {
      if (this.active) this.progressManeuver(ctx, report);
      else this.maybeRequestManeuver(ctx);
    }
    if (this.is('running') && !this.active && this.navigator.atDestination) {
      this.finish(ctx, 'destination');
      return;
    }
    if (!this.is('finished') && ctx.time - this.startTime >= this.maxDuration) {
      this.finish(ctx, 'timeout');
      return;
    }
    if (this.is('failing') && this.failAt !== undefined) {
      const left = ctx.localisation.laneId !== undefined && ctx.localisation.laneId !== this.failLane && !ctx.localisation.insideJunction;
      const stoppedLongEnough = report.stoppedFor >= 2 && ctx.time - this.failAt > 5;
      if (left || stoppedLongEnough || ctx.time - this.failAt > 60) this.finish(ctx, 'failed');
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  /** Phase test as a method so that `finish()` calls inside `update` do not fight TS narrowing. */
  private is(phase: ExaminerPhase): boolean {
    return this.phase === phase;
  }

  // ---- lifecycle ----------------------------------------------------------------------

  private start(ctx: SimContext): void {
    this.phase = 'running';
    this.startTime = ctx.time;
    this.dialogue.sayLine('examiner.greeting', undefined, { priority: 2, key: 'examiner.greeting', cooldown: 60 });
    this.navigator.setRoute(this.opts.route, { speak: true, who: 'examiner', endS: this.opts.endS });
    this.bus.emit('test:started', { routeId: this.routeId });
  }

  private finish(ctx: SimContext, reason: 'destination' | 'timeout' | 'failed'): void {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    this.finishReason = reason;
    if (this.active) this.endManeuver('failed', ctx, false);
    this.navigator.setOverride({ kind: 'pull_over', text: this.dialogue.lines.line('nav.hud.pull_over') });
    this.dialogue.sayLine(reason === 'timeout' ? 'examiner.timeout' : 'examiner.finished.pull_over', undefined, { priority: 2 });
    const verdict = this.scorer.verdict(this.dialogue.lines);
    this.finishedVerdict = verdict;
    this.bus.emit('test:finished', { passed: verdict.passed, points: verdict.points, violations: [...this.scorer.violations], durationSec: ctx.time - this.startTime });
  }

  private beginFailing(ctx: SimContext): void {
    if (this.phase !== 'running') return;
    this.phase = 'failing';
    this.failAt = ctx.time;
    this.failLane = ctx.localisation.laneId;
    if (this.active) this.endManeuver('failed', ctx, false);
    this.dialogue.sayLine('examiner.failed_continue', undefined, { priority: 2, key: 'examiner.failed_continue', cooldown: 30 });
  }

  // ---- violations ----------------------------------------------------------------------

  private onViolation(v: Violation): void {
    if (this.phase !== 'running' && this.phase !== 'failing') return;
    if (v.type === 'EXAMINER_INTERVENTION') {
      // our own emission (or the rules module echoing the intervention): count once per second
      if (v.time - this.lastInterventionViolationAt < 1) return;
      this.lastInterventionViolationAt = v.time;
    }
    this.scorer.record(v);
    if (v.type.startsWith('SPEEDING_') && !this.speedingNoted) {
      this.speedingNoted = true;
      this.dialogue.sayLine('examiner.speeding', undefined, { priority: 1, key: 'examiner.speeding', cooldown: 60 });
    }
    if (v.severity === 'critical' && this.lastCtx) this.beginFailing(this.lastCtx);
  }

  private emitViolation(type: ViolationType, context?: string): void {
    const ctx = this.lastCtx;
    if (!ctx) return;
    const severity = type === 'EXAMINER_INTERVENTION' ? 'critical' : type === 'MISSED_INSTRUCTION' || type === 'WRONG_TURN' ? 'minor' : 'minor';
    this.bus.emit('violation', { type, severity, time: ctx.time, pos: [ctx.player.pos[0], ctx.player.pos[1]], context });
  }

  // ---- interventions ----------------------------------------------------------------------

  private checkDanger(ctx: SimContext): void {
    if (ctx.time - this.lastInterventionAt < INTERVENTION_INTERVAL) return;
    const preferred = ctx.localisation.laneId ? this.navigator.expectedConnectorFrom(ctx.localisation.laneId)?.id : undefined;
    const danger = predictDanger(ctx, this.graph, this.dialogue.lines, { preferredConnectorId: preferred });
    if (!danger) return;
    this.lastInterventionAt = ctx.time;
    this.bus.emit('coach:intervention', { kind: 'brake', reason: danger.reason, time: ctx.time });
    this.dialogue.sayLine('examiner.intervention', undefined, { priority: 3, key: 'examiner.intervention', cooldown: 2 });
    this.emitViolation('EXAMINER_INTERVENTION', danger.reason);
  }

  // ---- manoeuvre planning ---------------------------------------------------------------

  private planManeuvers(kinds: ManeuverKind[], max: number): PlannedManeuver[] {
    const plan: PlannedManeuver[] = [];
    const wanted = kinds.filter((k) => k !== 'reverse' && k !== 'hill_start');
    const withReverse = kinds.includes('reverse');
    const lanes = this.route.laneSegments();
    let lastEnd = -Infinity;
    for (let i = 1; i < lanes.length - 1; i++) {
      if (plan.length >= max) break;
      const seg = lanes[i]!;
      if (seg.start < lastEnd + MIN_SPACING_M) continue;
      const lane = this.graph.lane(seg.id);
      const road = this.graph.road(lane.roadId);
      for (const kind of wanted) {
        if (plan.some((p) => p.kind === kind)) continue;
        const planned = this.tryPlace(kind, seg, lane, road.cls, withReverse && !plan.some((p) => p.kind === 'reverse'));
        if (!planned) continue;
        plan.push(...planned);
        lastEnd = seg.start + seg.length;
        break;
      }
    }
    return plan;
  }

  private tryPlace(kind: ManeuverKind, seg: RouteSegment, lane: Lane, cls: RoadClass, withReverse: boolean): PlannedManeuver[] | undefined {
    const quiet = QUIET.has(cls);
    switch (kind) {
      case 'pull_over': {
        if (!quiet || lane.rightLine !== 'kerb') return undefined;
        const need = withReverse ? 35 : 25;
        const stretch = legalKerbStretches(this.graph, lane.id).map((s) => ({ s0: Math.max(s.s0, 15), s1: Math.min(s.s1, lane.length - 15) })).find((s) => s.s1 - s.s0 >= need);
        if (!stretch) return undefined;
        const base: PlannedManeuver = { kind, laneId: lane.id, segmentIndex: seg.index, triggerS: Math.max(2, stretch.s0 - 25), stretch };
        return withReverse ? [base, { kind: 'reverse', laneId: lane.id, segmentIndex: seg.index, triggerS: base.triggerS, stretch }] : [base];
      }
      case 'parallel_park': {
        if (lane.rightLine !== 'kerb') return undefined;
        const road = this.graph.road(lane.roadId);
        const forward = road.lanesForward.includes(lane.id);
        const side = forward ? 'right' : 'left';
        for (const strip of this.graph.parkingByRoad.get(road.id) ?? []) {
          if (strip.side !== side || strip.layout !== 'parallel') continue;
          if (strip.kerb === 'red_white' || strip.kerb === 'red_yellow' || strip.kerb === 'disabled' || strip.kerb === 'loading') continue;
          if (strip.bays.length === 0 && strip.s1 - strip.s0 < 7) continue;
          // road s → lane s (lanes run opposite to the road for backward lanes)
          // usable part of the strip: ≥ 12 m from both junctions, at least a car length + 2.6 m
          const laneS0 = Math.max(12, this.laneSFromRoadS(lane, forward ? strip.s0 : strip.s1));
          const laneS1 = Math.min(lane.length - 12, this.laneSFromRoadS(lane, forward ? strip.s1 : strip.s0));
          if (laneS1 - laneS0 < 7) continue;
          return [{ kind, laneId: lane.id, segmentIndex: seg.index, triggerS: Math.max(2, laneS0 - 30), strip, stretch: { s0: laneS0, s1: laneS1 } }];
        }
        return undefined;
      }
      case 'uturn': {
        const road = this.graph.road(lane.roadId);
        if (!quiet || road.oneway || road.lanesBackward.length === 0) return undefined;
        const wide = road.width >= 9 || road.lanesForward.length + road.lanesBackward.length >= 3;
        if (!wide || lane.length < 60) return undefined;
        const leftLine = this.graph.lane(road.lanesForward[0]!).leftLine;
        if (leftLine === 'solid' || leftLine === 'double_solid' || leftLine === 'solid_dashed') return undefined;
        return [{ kind, laneId: lane.id, segmentIndex: seg.index, triggerS: 15 }];
      }
      case 'emergency_stop': {
        if (!quiet || lane.length < 80 || !this.isStraight(lane)) return undefined;
        const crossings = this.graph.crossingsByLane.get(lane.id) ?? [];
        if (crossings.length > 0) return undefined;
        return [{ kind, laneId: lane.id, segmentIndex: seg.index, triggerS: 8 }];
      }
      default:
        return undefined;
    }
  }

  private laneSFromRoadS(lane: Lane, roadS: number): number {
    const road = this.graph.road(lane.roadId);
    const pt = road.centre;
    // walk the road centre to the point at roadS, then project onto the lane
    let acc = 0;
    let p: Vec2 = pt[pt.length - 1]!;
    for (let i = 1; i < pt.length; i++) {
      const a = pt[i - 1]!;
      const b = pt[i]!;
      const L = dist2(a, b);
      if (acc + L >= roadS) {
        const t = L > 0 ? (roadS - acc) / L : 0;
        p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        break;
      }
      acc += L;
    }
    let best = 0;
    let bestD = Infinity;
    let s = 0;
    for (let i = 1; i < lane.centre.length; i++) {
      const a = lane.centre[i - 1]!;
      const b = lane.centre[i]!;
      const L = dist2(a, b);
      const n = Math.max(1, Math.ceil(L));
      for (let k = 0; k <= n; k++) {
        const q: Vec2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const d = dist2(q, p);
        if (d < bestD) {
          bestD = d;
          best = s + (L * k) / n;
        }
      }
      s += L;
    }
    return best;
  }

  private isStraight(lane: Lane): boolean {
    const c = lane.centre;
    const h0 = Math.atan2(c[1]![1] - c[0]![1], c[1]![0] - c[0]![0]);
    for (let i = 2; i < c.length; i++) {
      const h = Math.atan2(c[i]![1] - c[i - 1]![1], c[i]![0] - c[i - 1]![0]);
      if (Math.abs(angleDiff(h0, h)) > (10 * Math.PI) / 180) return false;
    }
    return true;
  }

  // ---- manoeuvre execution -----------------------------------------------------------------

  private maybeRequestManeuver(ctx: SimContext): void {
    const next = this.plan[this.planCursor];
    if (!next) return;
    const loc = ctx.localisation;
    if (loc.laneId !== next.laneId) {
      // passed the planned lane without triggering? skip it
      const idx = this.navigator.routeModel?.locate(loc)?.index;
      if (idx !== undefined && idx > next.segmentIndex) this.planCursor++;
      return;
    }
    if (loc.s < next.triggerS) return;
    if (ctx.time - this.lastManeuverEnd < 6) return;
    if (next.kind === 'emergency_stop' && (ctx.player.speed < 20 / 3.6 || agentBehind(ctx, 40))) {
      if (loc.distToLaneEnd < 45) this.planCursor++; // no chance left on this lane
      return;
    }
    if (next.kind === 'reverse') {
      this.planCursor++; // reverse is only requested right after a completed kerb stop
      return;
    }
    this.request(next, ctx);
  }

  private request(plan: PlannedManeuver, ctx: SimContext): void {
    this.planCursor = this.plan.indexOf(plan) + 1;
    this.active = { plan, startedAt: ctx.time, startPos: [ctx.player.pos[0], ctx.player.pos[1]], startHeading: ctx.player.heading, stage: 'requested', reversed: 0, maxDrift: 0, minAccel: 0, forwardSinceStart: 0 };
    const lines = this.dialogue.lines;
    let text: string;
    switch (plan.kind) {
      case 'emergency_stop':
        text = lines.line('examiner.maneuver.emergency_stop.prepare');
        this.active.stage = 'prepare';
        // "עצור!" follows 2–5 s later (seeded), while the lane still has room to stop
        this.active.goAt = ctx.time + 2 + this.rng() * 3;
        this.navigator.setOverride({ kind: 'straight', text: lines.line('nav.hud.straight') });
        break;
      case 'parallel_park':
        text = lines.line('examiner.maneuver.parallel_park');
        this.navigator.setOverride({ kind: 'park', text });
        if (!plan.strip || plan.strip.bays.length === 0) this.requestParkedCars(ctx, plan);
        break;
      case 'uturn':
        text = lines.line('examiner.maneuver.uturn');
        this.navigator.setOverride({ kind: 'uturn', text: lines.line('nav.hud.uturn') });
        break;
      case 'reverse':
        text = lines.line('examiner.maneuver.reverse');
        this.navigator.setOverride({ kind: 'reverse', text });
        break;
      default:
        text = lines.line('examiner.maneuver.pull_over');
        this.navigator.setOverride({ kind: 'pull_over', text: lines.line('nav.hud.pull_over') });
    }
    this.dialogue.say({ who: 'examiner', text, priority: 2, key: `examiner.maneuver.${plan.kind}`, cooldown: 5 });
    this.bus.emit('examiner:maneuver', { kind: plan.kind, text, status: 'requested' });
  }

  /** Ask the traffic module for two stationary cars at the kerb ahead, leaving a ~7 m gap between them. */
  private requestParkedCars(ctx: SimContext, plan: PlannedManeuver): void {
    const ahead = Math.max(12, (plan.stretch?.s0 ?? ctx.localisation.s + 20) - ctx.localisation.s);
    const carLength = 4.4;
    const gap = 7;
    for (const distance of [ahead, ahead + carLength + gap]) {
      this.bus.emit('coach:request', { kind: 'spawn_vehicle', payload: { where: 'ahead', distance: Math.round(distance), speedKmh: 0, vehicle: 'car', parked: true, side: 'right', laneId: plan.laneId } });
    }
  }

  private progressManeuver(ctx: SimContext, report: { stopped: boolean; stoppedFor: number; legal: boolean; kerbDistance?: number; angleDeg?: number; parked: boolean }): void {
    const a = this.active!;
    const p = a.plan;
    const loc = ctx.localisation;
    const elapsed = ctx.time - a.startedAt;
    const leftLane = loc.laneId !== undefined && loc.laneId !== p.laneId && !loc.insideJunction;
    switch (p.kind) {
      case 'pull_over': {
        if (report.stopped && report.stoppedFor >= 1.5) {
          if (report.legal) {
            // a reverse planned at the same spot follows immediately ("סע לאחור…" instead of "המשך בנסיעה")
            const rev = this.plan[this.planCursor];
            const chain = !!rev && rev.kind === 'reverse' && rev.laneId === p.laneId;
            this.endManeuver('completed', ctx, !chain);
            if (chain) this.request(rev, ctx);
          } else this.endManeuver('failed', ctx, true);
          return;
        }
        if (leftLane || loc.distToLaneEnd < 5 || elapsed > 90) this.miss(ctx);
        return;
      }
      case 'reverse': {
        const v = ctx.player.speed;
        if (v < -0.05) {
          a.reversed += -v * ctx.dt;
          const rel: Vec2 = [ctx.player.pos[0] - a.startPos[0], ctx.player.pos[1] - a.startPos[1]];
          const r = rightOf(a.startHeading);
          const drift = Math.abs(rel[0] * r[0] + rel[1] * r[1]);
          a.maxDrift = Math.max(a.maxDrift, drift);
        } else if (v > 0.05) a.forwardSinceStart += v * ctx.dt;
        if (a.maxDrift >= 0.8) {
          this.endManeuver('failed', ctx, true);
          return;
        }
        if (a.reversed >= 12) {
          this.endManeuver('completed', ctx, true);
          return;
        }
        if (a.forwardSinceStart > 8 || elapsed > 90) this.miss(ctx);
        return;
      }
      case 'uturn': {
        const turned = Math.abs(angleDiff(a.startHeading, ctx.player.heading)) > (150 * Math.PI) / 180;
        const startRoad = this.graph.lane(p.laneId).roadId;
        const onOpposite = !!loc.laneId && loc.laneId !== p.laneId && this.graph.lane(loc.laneId).roadId === startRoad;
        if (turned && onOpposite && Math.abs(ctx.player.speed) >= 0) {
          this.endManeuver('completed', ctx, true);
          this.navigator.reroute({ silent: true });
          return;
        }
        const wentElsewhere = !!loc.laneId && this.graph.lane(loc.laneId).roadId !== startRoad;
        if (wentElsewhere || elapsed > 90) {
          this.miss(ctx);
          this.navigator.reroute({ silent: true });
        }
        return;
      }
      case 'parallel_park': {
        const inStrip = p.stretch ? loc.laneId === p.laneId && loc.s >= p.stretch.s0 - 1 && loc.s <= p.stretch.s1 + 1 : loc.laneId === p.laneId;
        if (report.stopped && report.stoppedFor >= 2 && inStrip && report.legal && (report.kerbDistance ?? 0) <= 0.5 && (report.angleDeg ?? 0) <= 10) {
          this.endManeuver('completed', ctx, true);
          return;
        }
        const passed = loc.laneId === p.laneId && p.stretch !== undefined && loc.s > p.stretch.s1 + 25;
        if (leftLane || passed || elapsed > 150) this.miss(ctx);
        return;
      }
      case 'emergency_stop': {
        if (a.stage === 'prepare') {
          if (ctx.time >= (a.goAt ?? 0)) {
            if (ctx.player.speed >= 20 / 3.6 && !agentBehind(ctx, 40) && loc.distToLaneEnd > 25) {
              a.stage = 'go';
              a.goSaidAt = ctx.time;
              a.minAccel = 0;
              this.dialogue.sayLine('examiner.maneuver.emergency_stop.go', undefined, { priority: 3 });
            } else if (loc.distToLaneEnd < 25 || leftLane || elapsed > 40) {
              // no safe opportunity on this lane: cancel quietly
              this.navigator.setOverride(null);
              this.active = undefined;
              this.lastManeuverEnd = ctx.time;
            }
          }
          return;
        }
        a.minAccel = Math.min(a.minAccel, ctx.player.accel);
        const since = ctx.time - (a.goSaidAt ?? ctx.time);
        if (a.minAccel <= -6) {
          this.endManeuver('completed', ctx, true);
          return;
        }
        if (since > 1.0) this.endManeuver('failed', ctx, true);
        return;
      }
      default:
        this.endManeuver('failed', ctx, false);
    }
  }

  private miss(ctx: SimContext): void {
    this.emitViolation('MISSED_INSTRUCTION', this.active?.plan.kind);
    this.dialogue.sayLine('examiner.maneuver.missed', undefined, { priority: 1, key: 'examiner.maneuver.missed', cooldown: 10 });
    this.endManeuver('failed', ctx, false);
  }

  private endManeuver(status: 'completed' | 'failed', ctx: SimContext, speak: boolean): void {
    const a = this.active;
    if (!a) return;
    this.active = undefined;
    this.lastManeuverEnd = ctx.time;
    this.navigator.setOverride(null);
    const key = `examiner.maneuver.${a.plan.kind}.${status === 'completed' ? 'done' : 'failed'}`;
    const text = this.dialogue.lines.line(key);
    if (speak) this.dialogue.say({ who: 'examiner', text, priority: 2 });
    this.bus.emit('examiner:maneuver', { kind: a.plan.kind, text, status });
    if (a.plan.kind === 'uturn' && status === 'failed') this.navigator.reroute({ silent: true });
  }
}

/** Helper for tests / tools: is the lane position a legal kerb stop? */
export function legalKerbAt(graph: RoadGraph, laneId: string, s: number): boolean {
  return kerbLegality(graph, graph.lane(laneId), s).legal;
}
