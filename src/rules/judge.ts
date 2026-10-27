/**
 * Judge — the rules engine. Runs every detector each tick, applies the per-type cooldown
 * from VIOLATIONS, fills in time / position / Hebrew context and publishes `violation`
 * events on the bus. Keeps `history` and a RulesScorer for the examiner / result sheet.
 *
 * What the Judge expects from the other modules (fields of SimContext it reads):
 *  - ctx.player (VehicleState from the vehicle module): pos, heading, speed (signed), accel,
 *    indicator, gear, handbrake, engineOn, seatbelt, length, width. Nothing else.
 *  - ctx.localisation — written by the Localiser (src/rules/localiser.ts), which must run
 *    BEFORE the Judge in the frame loop.
 *  - ctx.traffic (TrafficAgentState[] from the traffic module): kind, pos, heading, speed,
 *    length, width, laneId / connectorId / s (used for leaders and yielding conflicts — when
 *    `s` is missing the agent is projected onto its lane), crossingId + pedState for
 *    pedestrians, disturbedByPlayer for yielding.
 *  - ctx.signals (SignalStateProvider): stateOf(group) for approaches / pedestrian crossings and
 *    stateForConnector(id) to ignore conflicts whose movement is on red.
 *  - ctx.world.props (bus stops) and the RoadGraph for everything static.
 *  - ctx.time / ctx.dt for all timing; ctx.coachPresent (unless overridden in the options).
 *  - Bus events: 'input:glance' (mirror / shoulder checks) and 'vehicle:collision'.
 *
 * Nothing in here depends on THREE or Rapier; the whole engine runs in node tests with
 * scripted drives (src/rules/scripted.ts).
 */
import type { EventBus } from '@/core/events';
import type { SimContext, System } from '@/core/sim';
import type { GlanceEvent } from '@/core/types';
import type { Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { CollisionEvent, Detector, JudgeApi, ReportOptions } from './api';
import { DistanceDetector } from './detectors/distance';
import { InstructionsDetector, type ExpectedTurn } from './detectors/instructions';
import { LanesDetector } from './detectors/lanes';
import { ParkingDetector, parkingReport, type ParkingReport } from './detectors/parking';
import { PedestriansDetector } from './detectors/pedestrians';
import { SignallingDetector } from './detectors/signalling';
import { SignalsDetector } from './detectors/signals';
import { SpeedDetector } from './detectors/speed';
import { StopSignDetector } from './detectors/stopSign';
import { VehicleDetector } from './detectors/vehicle';
import { YieldingDetector } from './detectors/yielding';
import { currentApproach, upcomingCrossings, type ApproachInfo, type CrossingAhead } from './localiser';
import { RulesScorer, type ScoreSummary } from './scoring';
import { atJunction, atStreet, junctionDisplayName } from './strings.he';
import { STOPPED_MPS } from './thresholds';
import { VIOLATIONS, type Violation, type ViolationType } from './violations';

export interface JudgeOptions {
  /** Force the coach-present flag (otherwise ctx.coachPresent is used each tick). */
  coachPresent?: boolean;
  /** Replace the default detector set (tests / lessons that want a subset). */
  detectors?: Detector[];
}

const GLANCE_MEMORY_S = 30;

export class Judge implements System, JudgeApi {
  readonly name = 'judge';
  readonly history: Violation[] = [];
  readonly scorer = new RulesScorer();
  readonly detectors: Detector[];
  readonly instructions: InstructionsDetector;

  time = 0;
  dt = 0;
  odometer = 0;
  stoppedFor = 0;
  collisions: CollisionEvent[] = [];

  private pendingCollisions: CollisionEvent[] = [];
  private glances: GlanceEvent[] = [];
  private lastEmit = new Map<ViolationType, number>();
  private ctx?: SimContext;
  private tick = 0;
  private approachTick = -1;
  private approachValue?: ApproachInfo;
  private readonly offs: (() => void)[] = [];

  constructor(
    public readonly graph: RoadGraph,
    public readonly bus: EventBus,
    private readonly opts: JudgeOptions = {},
  ) {
    this.offs.push(bus.on('input:glance', (g) => this.glances.push(g)));
    this.offs.push(bus.on('vehicle:collision', (c) => this.pendingCollisions.push(c)));
    this.instructions = new InstructionsDetector();
    this.detectors = opts.detectors ?? [
      new SpeedDetector(),
      new SignalsDetector(),
      new StopSignDetector(),
      new YieldingDetector(),
      new PedestriansDetector(),
      new SignallingDetector(),
      new LanesDetector(),
      new DistanceDetector(),
      new VehicleDetector(),
      new ParkingDetector(),
      this.instructions,
    ];
  }

  get coachPresent(): boolean {
    return this.opts.coachPresent ?? this.ctx?.coachPresent ?? true;
  }

  update(ctx: SimContext): void {
    this.ctx = ctx;
    this.time = ctx.time;
    this.dt = ctx.dt;
    this.tick++;
    this.odometer += Math.abs(ctx.player.speed) * ctx.dt;
    this.stoppedFor = Math.abs(ctx.player.speed) < STOPPED_MPS ? this.stoppedFor + ctx.dt : 0;
    this.collisions = this.pendingCollisions;
    this.pendingCollisions = [];
    if (this.glances.length > 0 && this.glances[0]!.time < this.time - GLANCE_MEMORY_S) this.glances = this.glances.filter((g) => g.time >= this.time - GLANCE_MEMORY_S);
    for (const d of this.detectors) d.update(ctx, this);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  /** Forget everything (new lesson / test). */
  reset(): void {
    this.history.length = 0;
    this.scorer.reset();
    this.lastEmit.clear();
    this.glances = [];
    this.pendingCollisions = [];
    this.collisions = [];
    this.odometer = 0;
    this.stoppedFor = 0;
    this.approachTick = -1;
    for (const d of this.detectors) d.reset?.();
  }

  summary(): ScoreSummary {
    return this.scorer.summary();
  }

  get lastViolation(): Violation | undefined {
    return this.history[this.history.length - 1];
  }

  violationsSince(time: number): Violation[] {
    return this.history.filter((v) => v.time >= time);
  }

  // ---- instruction expectations (navigator / examiner) ------------------------------------

  /** The player was told how to leave `junctionId`; a different movement → WRONG_TURN. */
  setExpectedTurn(junctionId: string, turn: ExpectedTurn | null): void {
    this.instructions.setExpectedTurn(junctionId, turn);
  }
  /** The player was told to stop within `radius` m of `pos`; driving past by > 30 m → MISSED_INSTRUCTION. */
  setExpectedStop(pos: Vec2, radius = 8): void {
    this.instructions.setExpectedStop(pos, radius);
  }
  clearExpectedStop(): void {
    this.instructions.clearExpectedStop();
  }

  /** Where the car stands relative to the kerb and the parking rules (for lessons / the examiner). */
  parkingReport(ctx: SimContext = this.ctx!): ParkingReport | undefined {
    return parkingReport(this.graph, ctx);
  }

  // ---- JudgeApi ----------------------------------------------------------------------------

  approach(): ApproachInfo | undefined {
    if (!this.ctx) return undefined;
    if (this.approachTick !== this.tick) {
      this.approachTick = this.tick;
      this.approachValue = currentApproach(this.graph, this.ctx);
    }
    return this.approachValue;
  }

  crossingsAhead(within: number): CrossingAhead[] {
    return this.ctx ? upcomingCrossings(this.graph, this.ctx, within) : [];
  }

  report(type: ViolationType, opts: ReportOptions = {}): Violation | undefined {
    const info = VIOLATIONS[type];
    if (info.severity === 'info' && type.startsWith('APPROACHING_') && !this.coachPresent) return undefined;
    const t = opts.time ?? this.time;
    const last = this.lastEmit.get(type);
    if (last !== undefined && t - last < info.cooldown) return undefined;
    this.lastEmit.set(type, t);
    const p = this.ctx?.player.pos;
    const pos: [number, number] = opts.pos ? [opts.pos[0], opts.pos[1]] : p ? [p[0], p[1]] : [0, 0];
    const v: Violation = { type, severity: opts.severity ?? info.severity, time: t, pos };
    if (opts.details) v.details = opts.details;
    const context = opts.context ?? this.hereContext();
    if (context) v.context = context;
    this.history.push(v);
    this.scorer.add(v);
    this.bus.emit('violation', v);
    return v;
  }

  hereContext(): string | undefined {
    const loc = this.ctx?.localisation;
    if (!loc) return undefined;
    if (loc.connectorId) return this.junctionContext(this.graph.connectors.get(loc.connectorId)?.junctionId);
    if (loc.insideJunction && loc.junctionId) return this.junctionContext(loc.junctionId);
    return this.streetContext(loc.laneId);
  }

  streetContext(laneId: string | undefined): string | undefined {
    if (!laneId) return undefined;
    const lane = this.graph.lanes.get(laneId);
    const road = lane ? this.graph.roads.get(lane.roadId) : undefined;
    return road?.name ? atStreet(road.name) : undefined;
  }

  junctionContext(junctionId: string | undefined): string | undefined {
    if (!junctionId) return undefined;
    const j = this.graph.junctions.get(junctionId);
    if (!j) return undefined;
    const name = junctionDisplayName(j, (id) => this.graph.roads.get(id));
    return name ? atJunction(name) : undefined;
  }

  glancesWithin(seconds: number): GlanceEvent[] {
    const from = this.time - seconds;
    return this.glances.filter((g) => g.time >= from && g.time <= this.time + 1e-9);
  }
}
