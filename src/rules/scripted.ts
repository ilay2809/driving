/**
 * Test helpers (also for other modules' tests): scripted drives along lane / connector paths
 * with a piecewise-linear speed profile, scripted traffic agents, a SimContext with a
 * settable signal stub, and `runDrive` which ticks localiser + judge and collects violations.
 *
 * Notes for scenario authors
 *  - Positions are the car CENTRE; the stop line is at lane.length, so to stop with the front
 *    bumper 1 m before it use atS = sOf(lane, lane.length - 1 - carLength / 2).
 *  - Speed is linear in S between profile points. To avoid HARSH_BRAKING, decelerate over at
 *    least v² / 5.5 m (≈ 35 m from 50 km/h). A point with `hold` stops the car there for
 *    `hold` seconds (speed 0), then the profile continues.
 *  - Events fire once when S (or time) reaches them: indicator, gear, glances (emitted as
 *    'input:glance'), lateral offset (optionally ramped over `over` metres), heading offset.
 */
import { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS, defaultVehicleState, emptyLocalisation, type SignalStateProvider, type SimContext } from '@/core/sim';
import type { AgentKind, Gear, GlanceTarget, Indicator, TrafficAgentState, VehicleState } from '@/core/types';
import { angleDiff, dist2, kmhToMps, pointAlong, polylineLength, rightOf, wrapAngle, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { SignalState, WorldFile } from '@/world/schema';
import { degToRad } from './geometry';
import { Judge, type JudgeOptions } from './judge';
import { Localiser } from './localiser';
import type { Violation } from './violations';

export type PathSegment = string | Vec2[];

export interface SpeedPoint {
  /** Arc length along the whole path (m). */
  atS: number;
  speedKmh: number;
  /** Stop here for this many seconds (speed 0), then continue. */
  hold?: number;
}

export interface DriveEvent {
  atS?: number;
  atTime?: number;
  indicator?: Indicator;
  glance?: GlanceTarget;
  gear?: Gear;
  handbrake?: boolean;
  seatbelt?: boolean;
  engineOn?: boolean;
  horn?: boolean;
  /** New lateral offset from the path (m, + = right) … */
  lateral?: number;
  /** … reached gradually over this many metres (default: instantly). */
  over?: number;
  /** Heading offset relative to the path direction (degrees, + = clockwise/right). */
  headingDeg?: number;
  apply?: (v: VehicleState) => void;
}

export interface ScriptedDriveOptions {
  profile: SpeedPoint[];
  events?: DriveEvent[];
  startS?: number;
  endS?: number;
  lateral?: number;
  vehicle?: Partial<VehicleState>;
  /** Floor for the effective speed so the car always reaches the next profile point (default 1.8 km/h). */
  minSpeedKmh?: number;
}

export interface PathSegmentInfo {
  id?: string;
  start: number;
  length: number;
}

interface BuiltPath {
  points: Vec2[];
  segments: PathSegmentInfo[];
  length: number;
}

function buildPath(graph: RoadGraph | undefined, path: PathSegment[]): BuiltPath {
  const points: Vec2[] = [];
  const segments: PathSegmentInfo[] = [];
  let acc = 0;
  for (const seg of path) {
    let pts: Vec2[];
    let id: string | undefined;
    if (typeof seg === 'string') {
      if (!graph) throw new Error('a RoadGraph is required for named path segments');
      const lane = graph.lanes.get(seg);
      const conn = lane ? undefined : graph.connectors.get(seg);
      if (!lane && !conn) throw new Error(`unknown lane / connector ${seg}`);
      pts = lane ? lane.centre : conn!.path;
      id = seg;
    } else pts = seg;
    let start: number | undefined;
    for (const p of pts) {
      const last = points[points.length - 1];
      if (last) {
        const d = dist2(last, p);
        if (d < 1e-6) {
          if (start === undefined) start = acc;
          continue;
        }
        acc += d;
      }
      points.push([p[0], p[1]]);
      if (start === undefined) start = acc;
    }
    segments.push({ id, start: start ?? acc, length: polylineLength(pts) });
  }
  if (points.length < 2) throw new Error('path needs at least two points');
  return { points, segments, length: polylineLength(points) };
}

function segmentAt(segments: PathSegmentInfo[], S: number): { id?: string; s: number } | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (S >= seg.start - 1e-9) return { id: seg.id, s: S - seg.start };
  }
  return undefined;
}

export class ScriptedDrive {
  readonly points: Vec2[];
  readonly segments: PathSegmentInfo[];
  readonly length: number;
  readonly state: VehicleState;
  readonly profile: SpeedPoint[];
  readonly events: DriveEvent[];
  /** Arc length of the car centre along the path. */
  S: number;
  time = 0;
  done = false;
  private readonly endS: number;
  private readonly minSpeed: number;
  private holdUntil?: number;
  private heldPoints = new Set<number>();
  private fired = new Set<number>();
  private lateral: number;
  private ramp?: { from: number; to: number; s0: number; s1: number };
  private headingOffset = 0;
  private prevHeading?: number;

  constructor(graph: RoadGraph | undefined, path: PathSegment[], opts: ScriptedDriveOptions) {
    const built = buildPath(graph, path);
    this.points = built.points;
    this.segments = built.segments;
    this.length = built.length;
    this.endS = Math.min(opts.endS ?? this.length, this.length);
    if (opts.profile.length === 0) throw new Error('profile needs at least one point');
    this.profile = [...opts.profile].sort((a, b) => a.atS - b.atS);
    this.events = opts.events ?? [];
    this.minSpeed = kmhToMps(opts.minSpeedKmh ?? 1.8);
    this.S = opts.startS ?? 0;
    this.lateral = opts.lateral ?? 0;
    const at = pointAlong(this.points, this.S);
    this.state = { ...defaultVehicleState(this.posAt(at), at.h), seatbelt: true, engineOn: true, gear: 'D', handbrake: false, ...opts.vehicle };
    this.state.speed = this.speedAt(this.S);
    this.prevHeading = this.state.heading;
  }

  /** Global S for a local arc length on a named segment. */
  sOf(segmentId: string, localS = 0): number {
    const seg = this.segments.find((s) => s.id === segmentId);
    if (!seg) throw new Error(`segment ${segmentId} is not part of the path`);
    return seg.start + localS;
  }

  segmentAt(S = this.S): { id?: string; s: number } | undefined {
    return segmentAt(this.segments, S);
  }

  speedAt(S: number): number {
    const pr = this.profile;
    const first = pr[0]!;
    if (S <= first.atS) return kmhToMps(first.speedKmh);
    for (let i = 1; i < pr.length; i++) {
      const a = pr[i - 1]!;
      const b = pr[i]!;
      if (S <= b.atS) {
        const t = (S - a.atS) / Math.max(1e-9, b.atS - a.atS);
        return kmhToMps(a.speedKmh + (b.speedKmh - a.speedKmh) * t);
      }
    }
    return kmhToMps(pr[pr.length - 1]!.speedKmh);
  }

  private posAt(at: { p: Vec2; h: number }): Vec2 {
    const r = rightOf(at.h);
    return [at.p[0] + r[0] * this.lateral, at.p[1] + r[1] * this.lateral];
  }

  step(dt: number, bus?: EventBus): VehicleState {
    this.time += dt;
    const st = this.state;
    const prevSpeed = st.speed;
    let v = 0;
    if (this.holdUntil !== undefined && this.time >= this.holdUntil - 1e-9) this.holdUntil = undefined;
    if (this.holdUntil === undefined && !this.done) {
      v = Math.max(this.speedAt(this.S), this.minSpeed);
      let dS = v * dt;
      const hp = this.profile.findIndex((pt, i) => (pt.hold ?? 0) > 0 && !this.heldPoints.has(i) && pt.atS >= this.S - 1e-9);
      if (hp >= 0) {
        const pt = this.profile[hp]!;
        if (this.S + dS >= pt.atS) {
          dS = Math.max(0, pt.atS - this.S);
          this.heldPoints.add(hp);
          this.holdUntil = this.time + pt.hold!;
          v = 0;
        }
      }
      this.S += dS;
      if (this.S >= this.endS) {
        this.S = this.endS;
        this.done = true;
      }
      if (this.ramp) {
        const r = this.ramp;
        if (this.S >= r.s1) {
          this.lateral = r.to;
          this.ramp = undefined;
        } else {
          const t = Math.max(0, Math.min(1, (this.S - r.s0) / Math.max(1e-9, r.s1 - r.s0)));
          this.lateral = r.from + (r.to - r.from) * t;
        }
      }
    }
    const at = pointAlong(this.points, this.S);
    const heading = wrapAngle(at.h + this.headingOffset);
    st.pos = this.posAt(at);
    st.heading = heading;
    st.speed = v;
    st.accel = (v - prevSpeed) / dt;
    st.yawRate = this.prevHeading === undefined ? 0 : angleDiff(this.prevHeading, heading) / dt;
    st.throttle = v > prevSpeed + 1e-6 ? 0.3 : 0;
    st.brake = v < prevSpeed - 1e-6 ? 0.3 : 0;
    this.prevHeading = heading;
    this.fireEvents(bus);
    return st;
  }

  private fireEvents(bus?: EventBus): void {
    this.events.forEach((e, i) => {
      if (this.fired.has(i)) return;
      const due = (e.atS !== undefined && this.S >= e.atS - 1e-9) || (e.atTime !== undefined && this.time >= e.atTime - 1e-9);
      if (!due) return;
      this.fired.add(i);
      this.applyEvent(e, bus);
    });
  }

  private applyEvent(e: DriveEvent, bus?: EventBus): void {
    const st = this.state;
    if (e.indicator !== undefined) {
      st.indicator = e.indicator;
      bus?.emit('vehicle:indicator', { indicator: e.indicator, time: this.time });
    }
    if (e.gear !== undefined) {
      st.gear = e.gear;
      bus?.emit('vehicle:gear', { gear: e.gear, time: this.time });
    }
    if (e.handbrake !== undefined) st.handbrake = e.handbrake;
    if (e.seatbelt !== undefined) st.seatbelt = e.seatbelt;
    if (e.engineOn !== undefined) st.engineOn = e.engineOn;
    if (e.horn !== undefined) {
      st.horn = e.horn;
      if (e.horn) bus?.emit('vehicle:horn', { time: this.time });
    }
    if (e.glance) bus?.emit('input:glance', { target: e.glance, time: this.time });
    if (e.lateral !== undefined) {
      if (e.over && e.over > 0) this.ramp = { from: this.lateral, to: e.lateral, s0: this.S, s1: this.S + e.over };
      else {
        this.lateral = e.lateral;
        this.ramp = undefined;
      }
    }
    if (e.headingDeg !== undefined) this.headingOffset = degToRad(e.headingDeg);
    e.apply?.(st);
  }
}

export interface ScriptedAgentOptions {
  id: string;
  kind?: AgentKind;
  speedKmh: number;
  /** Start position along the path (m). */
  startS?: number;
  length?: number;
  width?: number;
  indicator?: Indicator;
  /** Keep driving past the end of the path along the last heading (default: stop at the end). */
  continuePastEnd?: boolean;
}

/** A traffic agent moving at constant speed along lanes / connectors. */
export class ScriptedAgent {
  readonly state: TrafficAgentState;
  readonly points: Vec2[];
  readonly segments: PathSegmentInfo[];
  readonly length: number;
  readonly speed: number;
  S: number;
  private readonly continuePastEnd: boolean;

  constructor(
    private readonly graph: RoadGraph,
    path: PathSegment[],
    opts: ScriptedAgentOptions,
  ) {
    const built = buildPath(graph, path);
    this.points = built.points;
    this.segments = built.segments;
    this.length = built.length;
    this.speed = kmhToMps(opts.speedKmh);
    this.S = opts.startS ?? 0;
    this.continuePastEnd = opts.continuePastEnd ?? false;
    this.state = { id: opts.id, kind: opts.kind ?? 'car', pos: [0, 0], heading: 0, speed: this.speed, length: opts.length ?? 4.4, width: opts.width ?? 1.8, indicator: opts.indicator };
    this.place();
  }

  step(dt: number): void {
    this.S += this.speed * dt;
    this.place();
  }

  /** Move the agent to a given arc length and refresh its state. */
  moveTo(S: number): void {
    this.S = S;
    this.place();
  }

  private place(): void {
    const st = this.state;
    const at = pointAlong(this.points, Math.min(this.S, this.length));
    if (this.S > this.length && this.continuePastEnd) {
      const extra = this.S - this.length;
      st.pos = [at.p[0] + Math.cos(at.h) * extra, at.p[1] + Math.sin(at.h) * extra];
      st.heading = at.h;
      st.speed = this.speed;
      st.laneId = undefined;
      st.connectorId = undefined;
      st.s = undefined;
      return;
    }
    if (this.S > this.length) this.S = this.length;
    st.pos = [at.p[0], at.p[1]];
    st.heading = at.h;
    st.speed = this.S >= this.length ? 0 : this.speed;
    const seg = segmentAt(this.segments, this.S);
    if (seg?.id) {
      const isConn = this.graph.connectors.has(seg.id);
      st.connectorId = isConn ? seg.id : undefined;
      st.laneId = isConn ? undefined : seg.id;
      st.s = seg.s;
    } else {
      st.connectorId = undefined;
      st.laneId = undefined;
      st.s = undefined;
    }
  }
}

/** Signal provider with states set by the test (default green for every group). */
export class StubSignals implements SignalStateProvider {
  readonly states = new Map<string, SignalState>();
  private readonly overrides = new Map<string, SignalState>();
  defaultState: SignalState = 'green';

  constructor(private readonly graph: RoadGraph) {}

  set(groupId: string, state: SignalState): void {
    this.states.set(groupId, state);
  }
  setAll(state: SignalState): void {
    this.states.clear();
    this.defaultState = state;
  }
  stateOf(groupId: string): SignalState {
    return this.overrides.get(groupId) ?? this.states.get(groupId) ?? this.defaultState;
  }
  stateForConnector(connectorId: string): SignalState | undefined {
    const g = this.graph.connectorSignalGroup.get(connectorId);
    return g ? this.stateOf(g) : undefined;
  }
  stateForCrossing(crossingId: string): SignalState | undefined {
    const c = this.graph.crossings.get(crossingId);
    return c?.signalGroup ? this.stateOf(c.signalGroup) : undefined;
  }
  timeToChange(): number {
    return Infinity;
  }
  override(groupId: string, state: SignalState | undefined): void {
    if (state === undefined) this.overrides.delete(groupId);
    else this.overrides.set(groupId, state);
  }
}

export interface TestContext extends SimContext {
  signals: StubSignals;
  traffic: TrafficAgentState[];
  localiser: Localiser;
}

export type TestContextOverrides = Partial<Omit<SimContext, 'player' | 'signals' | 'traffic'>> & {
  player?: Partial<VehicleState>;
  traffic?: TrafficAgentState[];
};

export function makeTestContext(world: WorldFile, graph: RoadGraph, overrides: TestContextOverrides = {}): TestContext {
  const { player: playerOverrides, ...rest } = overrides;
  const player: VehicleState = { ...defaultVehicleState([0, 0], 0), seatbelt: true, engineOn: true, gear: 'D', handbrake: false, ...playerOverrides };
  const ctx: TestContext = {
    time: 0,
    dt: 1 / 30,
    mode: 'lesson',
    world,
    graph,
    bus: new EventBus(),
    player,
    localisation: emptyLocalisation(),
    traffic: [],
    signals: new StubSignals(graph),
    env: { time: 0, hour: 10, weather: 'clear', wetRoad: false },
    settings: { ...DEFAULT_SETTINGS },
    coachPresent: true,
    timeScale: 1,
    paused: false,
    localiser: new Localiser(graph),
  };
  Object.assign(ctx, rest);
  return ctx;
}

export interface RunOptions {
  dt?: number;
  maxSeconds?: number;
  agents?: ScriptedAgent[];
  /** Called every tick before localiser + judge run (set signals, move traffic, …). */
  onTick?: (ctx: TestContext, drive: ScriptedDrive) => void;
  /** Extra seconds to keep ticking after the drive finished (e.g. to let a stop be judged). */
  tailSeconds?: number;
}

/** Equipment fields a ScriptedDrive starts with unless its `vehicle` option says otherwise. */
const DRIVE_EQUIPMENT_DEFAULTS: Pick<VehicleState, 'seatbelt' | 'engineOn' | 'gear' | 'handbrake' | 'indicator' | 'lights' | 'wipers' | 'length' | 'width' | 'wheelbase'> = {
  seatbelt: true,
  engineOn: true,
  gear: 'D',
  handbrake: false,
  indicator: 'off',
  lights: 'off',
  wipers: false,
  length: 4.4,
  width: 1.8,
  wheelbase: 2.6,
};

/**
 * Tick the drive, the localiser and the judge until the drive is done; returns the violations in order.
 * `ctx.player` becomes the drive's state object. Equipment set on the context's player (seat belt,
 * gear, engine …) carries over unless the drive's `vehicle` option set that field itself.
 */
export function runDrive(ctx: TestContext, drive: ScriptedDrive, judge: Judge, opts: number | RunOptions = 1 / 30): Violation[] {
  const o: RunOptions = typeof opts === 'number' ? { dt: opts } : opts;
  const dt = o.dt ?? 1 / 30;
  const max = o.maxSeconds ?? 300;
  const out: Violation[] = [];
  const off = ctx.bus.on('violation', (v) => out.push(v));
  for (const a of o.agents ?? []) if (!ctx.traffic.includes(a.state)) ctx.traffic.push(a.state);
  if (ctx.player !== drive.state) {
    const st = drive.state as unknown as Record<string, unknown>;
    const from = ctx.player as unknown as Record<string, unknown>;
    for (const [k, def] of Object.entries(DRIVE_EQUIPMENT_DEFAULTS)) if (st[k] === def && from[k] !== def) st[k] = from[k];
  }
  ctx.player = drive.state;
  let elapsed = 0;
  let tail = o.tailSeconds ?? 0;
  while (elapsed < max) {
    if (drive.done) {
      if (tail <= 0) break;
      tail -= dt;
    }
    ctx.dt = dt;
    ctx.time += dt;
    elapsed += dt;
    drive.step(dt, ctx.bus);
    for (const a of o.agents ?? []) a.step(dt);
    o.onTick?.(ctx, drive);
    ctx.localiser.update(ctx);
    judge.update(ctx);
  }
  off();
  return out;
}

/** Violation types in order (test convenience). */
export function typesOf(vs: Violation[]): string[] {
  return vs.map((v) => v.type);
}

/** Violations that are not informational. */
export function nonInfo(vs: Violation[]): Violation[] {
  return vs.filter((v) => v.severity !== 'info');
}

export interface ScenarioOptions extends ScriptedDriveOptions {
  run?: RunOptions;
  judge?: JudgeOptions;
  ctx?: TestContextOverrides;
  /** Called before the drive starts (set signals, add traffic, set expectations …). */
  setup?: (ctx: TestContext, judge: Judge, drive: ScriptedDrive) => void;
}

export interface ScenarioResult {
  ctx: TestContext;
  judge: Judge;
  drive: ScriptedDrive;
  violations: Violation[];
  /** All violation types in order. */
  types: string[];
  /** Non-informational violation types in order. */
  nonInfo: string[];
}

/** Build a context + judge + drive for `path` on `world`, run it and collect the violations. */
export function runScenario(world: WorldFile, graph: RoadGraph, path: PathSegment[], opts: ScenarioOptions): ScenarioResult {
  const { run, judge: judgeOpts, ctx: ctxOverrides, setup, ...driveOpts } = opts;
  const ctx = makeTestContext(world, graph, ctxOverrides);
  const judge = new Judge(graph, ctx.bus, judgeOpts);
  const drive = new ScriptedDrive(graph, path, driveOpts);
  setup?.(ctx, judge, drive);
  const violations = runDrive(ctx, drive, judge, run);
  return { ctx, judge, drive, violations, types: typesOf(violations), nonInfo: typesOf(nonInfo(violations)) };
}

/** Seconds until a drive with these options first comes to a stop (for timing scripted traffic). */
export function timeToFirstStop(graph: RoadGraph, path: PathSegment[], opts: ScriptedDriveOptions, dt = 1 / 30, maxSeconds = 120): number {
  const probe = new ScriptedDrive(graph, path, opts);
  let t = 0;
  while (t < maxSeconds && !probe.done) {
    probe.step(dt);
    t += dt;
    if (probe.state.speed === 0) return t;
  }
  return t;
}
