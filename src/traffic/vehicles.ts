/**
 * NPC vehicles: lane following with the Intelligent Driver Model, junction rules
 * (signals, stop, give way / right-hand rule / roundabout / left turns, box blocking),
 * pedestrian priority, MOBIL-lite lane changes, buses dwelling at bus stops.
 *
 * Positions are (segment, s) along a path of lanes/connectors that is extended
 * incrementally (seeded random turn choice at every junction). All distances in the
 * behaviour code are measured along the path from the vehicle centre.
 *
 * Obstacle model: every constraint (leader, stop line, pedestrian, player, bus stop…)
 * is expressed as an IDM gap + approach rate, the acceleration is the minimum over all
 * of them, and the binding constraint tells us why the vehicle brakes (for the rules
 * engine: `disturbedByPlayer`, `holdReason`).
 */
import type { Indicator } from '@/core/types';
import { forwardOf, kmhToMps, projectOntoPolyline, rightOf, type Vec2 } from '@/world/geo';
import { SIGNAL_TIMING, type Connector, type Lane, type Turn } from '@/world/schema';
import type { Frame, HoldReason, OccEntry, TrafficAgentView } from './agents';
import { BAD_DRIVER_EXTRA_KMH, BAD_DRIVER_SHARE, BUS, EDGE_RIDING_KINDS, EDGE_RIDING_MARGIN, IDM, JUNCTION, KIND_SPEED_CAP_KMH, LANE_CHANGE, LOOKAHEAD_DECEL, PED, SPEED_FACTOR, VEHICLE_DIMS, type VehicleKind } from './constants';
import { canStopWithin, idmAcceleration, speedAllowedAt, type DriverParams } from './idm';
import type { Seg } from './network';
import type { PedestrianAgent } from './pedestrians';
import { clamp, obbGap, pick, smoothstep, type Obb } from './util';

export interface DriverProfile extends DriverParams {
  bad: boolean;
  /** Multiplier on the legal limit (good drivers 0.95..1.1; bad drivers add +15 km/h instead). */
  speedFactor: number;
}

interface Obstacle {
  /** IDM gap (m). */
  gap: number;
  /** Distance along the path from the vehicle centre to the obstacle's near boundary (m). */
  d: number;
  /** Approach rate v − v_obstacle (m/s). */
  dv: number;
  reason: HoldReason;
  byPlayer: boolean;
  /** Fixed point (stop line etc.) rather than a moving vehicle. */
  static: boolean;
}

export interface LaneChangeState {
  from: string;
  to: string;
  t0: number;
  dir: 'left' | 'right';
}

export interface BusStopState {
  laneId: string;
  s: number;
  dwell: number;
  arrivedAt?: number;
  done: boolean;
}

export class VehicleAgent {
  readonly state: TrafficAgentView;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  path: Seg[] = [];
  idx = 0;
  s = 0;
  v = 0;
  a = 0;
  pos: Vec2 = [0, 0];
  heading = 0;
  /** Velocity vector (m/s). */
  vel: Vec2 = [0, 0];
  /** Lateral offset from the segment centre (+ right) during lane changes. */
  lateral = 0;
  lateralStart = 0;
  lateralT0 = -Infinity;
  /** Extra lateral pull-in at bus stops. */
  busPull = 0;
  laneChange?: LaneChangeState;
  targetLaneId?: string;
  lastLaneChange = -Infinity;
  indicator: Indicator = 'off';
  useIndicatorTurn = true;
  useIndicatorLane = true;
  stopSignStoppedSince?: number;
  stopSignDone = false;
  amberDecision?: 'stop' | 'go';
  waitingSince?: number;
  /** Set during the frame when a stop-line hold is active (the lane end must not be crossed). */
  hold = false;
  /** Gap accepted at this lane end: the vehicle is entering the junction and no longer re-evaluates. */
  committed = false;
  holdReason?: HoldReason;
  yielding = false;
  busStop?: BusStopState;
  servedStops = new Set<string>();
  disturbedByPlayer = false;
  nearMissWithPlayer = false;
  siren = false;
  /** Seconds spent stuck at the end of a path without continuation (despawn candidate). */
  stuckSeconds = 0;
  /** Colour index for the renderer (0..7 cars, palette per kind). */
  readonly colour: number;
  /** Path sample cache for corridor checks (rebuilt each frame). */
  private samples: { p: Vec2; d: number; h: number }[] = [];
  private samplesTime = NaN;

  constructor(
    readonly id: string,
    readonly kind: VehicleKind,
    readonly driver: DriverProfile,
    colour: number,
    readonly spawnTime: number,
  ) {
    const dims = VEHICLE_DIMS[kind];
    this.length = dims.length;
    this.width = dims.width;
    this.height = dims.height;
    this.colour = colour;
    this.state = { id, kind, pos: [0, 0], heading: 0, speed: 0, length: this.length, width: this.width };
  }

  get seg(): Seg {
    return this.path[this.idx]!;
  }

  get obb(): Obb {
    return { pos: this.pos, heading: this.heading, length: this.length, width: this.width };
  }

  get nextConnector(): Connector | undefined {
    const next = this.path[this.idx + 1];
    return next?.kind === 'connector' ? next.conn : undefined;
  }

  /** Does the planned path go through `segId` within the next few segments? */
  plansThrough(segId: string): boolean {
    for (let k = this.idx; k < Math.min(this.path.length, this.idx + 5); k++) if (this.path[k]!.id === segId) return true;
    return false;
  }

  /** Long vehicles (buses, trucks) swing over neighbouring lanes in tight turns. */
  get isLong(): boolean {
    return this.length > 6;
  }

  occEntry(): OccEntry {
    const waiting = this.v < JUNCTION.stoppedSpeed && this.holdReason !== undefined;
    return { agent: this, s: this.s, speed: this.v, length: this.length, width: this.width, waiting, waitingSince: waiting ? this.waitingSince : undefined };
  }

  /** Sampled points along the path ahead (from the front bumper), every 1.5 m up to `maxDist`. */
  pathSamples(time: number, maxDist: number): { p: Vec2; d: number; h: number }[] {
    if (this.samplesTime === time && this.samples.length > 0 && this.samples[this.samples.length - 1]!.d >= maxDist - 1.5) return this.samples;
    const out: { p: Vec2; d: number; h: number }[] = [];
    const step = 1.5;
    let dAcc = 0; // distance from my centre to the start of the current segment slice
    let target = this.length / 2 + 0.2;
    for (let k = this.idx; k < this.path.length; k++) {
      const seg = this.path[k]!;
      const sFrom = k === this.idx ? this.s : 0;
      const pts = seg.pts;
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const segStartD = dAcc + acc - sFrom; // distance from my centre to point a
        const segEndD = segStartD + L;
        const h = Math.atan2(b[1] - a[1], b[0] - a[0]);
        while (target <= segEndD + 1e-9) {
          if (target >= segStartD - 1e-9) {
            const t = L > 0 ? (target - segStartD) / L : 0;
            out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: target, h });
          }
          target += step;
          if (target > maxDist) break;
        }
        acc += L;
        if (target > maxDist) break;
      }
      if (target > maxDist) break;
      dAcc += seg.length - sFrom;
    }
    this.samples = out;
    this.samplesTime = time;
    return out;
  }
}

export function createDriverProfile(rng: () => number, opts: { bad?: boolean } = {}): DriverProfile {
  const bad = opts.bad ?? rng() < BAD_DRIVER_SHARE;
  const speedFactor = bad ? 1 : SPEED_FACTOR.min + rng() * (SPEED_FACTOR.max - SPEED_FACTOR.min);
  return { aMax: IDM.aMax, b: IDM.b, s0: IDM.s0, T: bad ? IDM.TBad : IDM.T, bad, speedFactor };
}

export function createVehicleAgent(id: string, kind: VehicleKind, rng: () => number, time: number, opts: { bad?: boolean; siren?: boolean } = {}): VehicleAgent {
  const driver = createDriverProfile(rng, opts);
  const colour = Math.floor(rng() * 8);
  const agent = new VehicleAgent(id, kind, driver, colour, time);
  agent.siren = !!opts.siren;
  agent.useIndicatorTurn = !driver.bad || rng() < 0.5;
  agent.useIndicatorLane = !driver.bad || rng() < 0.5;
  return agent;
}

// ---------------------------------------------------------------------------------
// Turn selection / path building
// ---------------------------------------------------------------------------------

const isLeftTurn = (t: Turn): boolean => t === 'left' || t === 'sharp_left' || t === 'uturn';
const isRightTurn = (t: Turn): boolean => t === 'right' || t === 'sharp_right';
const isStraight = (t: Turn): boolean => t === 'straight' || t === 'slight_left' || t === 'slight_right' || t === 'merge_left' || t === 'merge_right';
const turnClass = (t: Turn): 'straight' | 'left' | 'right' | 'uturn' => (isStraight(t) ? 'straight' : isLeftTurn(t) ? (t === 'uturn' ? 'uturn' : 'left') : 'right');

function laneAllowedFor(agent: VehicleAgent, lane: Lane): boolean {
  if (lane.kind === 'drive') return true;
  if (lane.kind === 'bus') return agent.kind === 'bus' || agent.kind === 'emergency';
  return false;
}

function connectorAllowed(agent: VehicleAgent, c: Connector, frame: Frame): boolean {
  return laneAllowedFor(agent, frame.graph.lane(c.toLane));
}

/** Long vehicles keep away from tight corners when they have a choice. */
function preferComfortable(agent: VehicleAgent, cands: Connector[], frame: Frame): Connector[] {
  if (!agent.isLong) return cands;
  const easy = cands.filter((c) => !frame.net.connSeg(c).tight);
  return easy.length > 0 ? easy : cands;
}

/**
 * Pick the next connector among candidates: straight with probability 0.5 (when available),
 * otherwise uniform among the non-U-turn classes; U-turns only when nothing else exists.
 * Buses prefer connectors leading into roads with bus infrastructure.
 */
function chooseConnector(agent: VehicleAgent, cands: Connector[], frame: Frame, currentLaneId?: string): Connector | undefined {
  if (cands.length === 0) return undefined;
  const classes = new Map<ReturnType<typeof turnClass>, Connector[]>();
  for (const c of cands) {
    const k = turnClass(c.turn);
    const list = classes.get(k) ?? [];
    list.push(c);
    classes.set(k, list);
  }
  const nonU = Array.from(classes.keys()).filter((k) => k !== 'uturn');
  let cls: ReturnType<typeof turnClass>;
  if (nonU.length === 0) cls = 'uturn';
  else if (classes.has('straight') && frame.rng() < 0.5) cls = 'straight';
  else cls = pick(frame.rng, nonU)!;
  if (agent.kind === 'bus' && frame.net.hasBusInfrastructure && frame.rng() < 0.7) {
    const busCls = nonU.filter((k) => classes.get(k)!.some((c) => frame.net.busRoads.has(frame.graph.lane(c.toLane).roadId)));
    if (busCls.length > 0) cls = pick(frame.rng, busCls)!;
  }
  let list = classes.get(cls)!;
  if (currentLaneId) {
    const own = list.filter((c) => c.fromLane === currentLaneId);
    if (own.length > 0) list = own;
    else {
      // nearest sibling lane (fewest lane changes)
      const sibs = frame.graph.siblingLanes(currentLaneId).map((l) => l.id);
      const idx = sibs.indexOf(currentLaneId);
      let best = Infinity;
      for (const c of list) best = Math.min(best, Math.abs(sibs.indexOf(c.fromLane) - idx));
      list = list.filter((c) => Math.abs(sibs.indexOf(c.fromLane) - idx) === best);
    }
  }
  return pick(frame.rng, list);
}

function pushConnector(agent: VehicleAgent, c: Connector, frame: Frame): void {
  agent.path.push(frame.net.connSeg(c));
  agent.path.push(frame.net.seg(c.toLane));
}

/**
 * Choose the turn at the end of `lane` among the connectors of the lane and its siblings
 * (own lane preferred when the chosen turn class is available from it). A connector from a
 * sibling lane implies a lane change before the junction.
 */
function planTurnFromLane(agent: VehicleAgent, lane: Lane, frame: Frame): Connector | undefined {
  const cands: Connector[] = [];
  for (const sib of frame.graph.siblingLanes(lane.id)) {
    if (!laneAllowedFor(agent, sib)) continue;
    for (const c of frame.graph.connectorsFrom(sib.id)) if (connectorAllowed(agent, c, frame)) cands.push(c);
  }
  return chooseConnector(agent, preferComfortable(agent, cands, frame), frame, lane.id);
}

/**
 * Extend the path so that ≥ 150 m / 3 segments lie ahead. Turns are decided when the path is
 * extended and then kept (other vehicles read our plan to judge conflicts), so a plan made here
 * may require a lane change that `planLaneAtEntry` schedules on arrival.
 */
export function ensurePath(agent: VehicleAgent, frame: Frame): void {
  for (let guard = 0; guard < 12; guard++) {
    let ahead = -agent.s;
    for (let k = agent.idx; k < agent.path.length; k++) ahead += agent.path[k]!.length;
    if (ahead >= 150 && agent.path.length - agent.idx >= 3) return;
    const last = agent.path[agent.path.length - 1]!;
    if (last.kind === 'connector') {
      agent.path.push(frame.net.seg(last.conn!.toLane));
      continue;
    }
    const c = planTurnFromLane(agent, last.lane!, frame);
    if (!c) return; // dead end without continuation: the vehicle stops at the path end
    pushConnector(agent, c, frame);
  }
}

/** Called when the agent starts on / enters a lane: choose the turn, maybe plan a lane change, bus stops. */
export function planLaneAtEntry(agent: VehicleAgent, frame: Frame): void {
  const seg = agent.seg;
  if (seg.kind !== 'lane') return;
  const lane = seg.lane!;
  agent.targetLaneId = undefined;
  agent.stopSignDone = false;
  agent.stopSignStoppedSince = undefined;
  agent.amberDecision = undefined;
  agent.waitingSince = undefined;
  agent.hold = false;
  agent.committed = false;
  agent.useIndicatorTurn = !agent.driver.bad || frame.rng() < 0.5;

  const siblings = frame.graph.siblingLanes(lane.id);
  const sibIds = siblings.map((l) => l.id);
  const dEnd = lane.length - agent.s;
  const ownLaneChoice = () => chooseConnector(agent, preferComfortable(agent, frame.graph.connectorsFrom(lane.id).filter((c) => connectorAllowed(agent, c, frame)), frame), frame, lane.id);
  const pre = agent.path[agent.idx + 1];
  let chosen: Connector | undefined = pre?.kind === 'connector' ? pre.conn : undefined;
  let keep = chosen !== undefined;
  if (!chosen) chosen = planTurnFromLane(agent, lane, frame);
  if (chosen && chosen.fromLane !== lane.id) {
    const steps = Math.abs(sibIds.indexOf(chosen.fromLane) - sibIds.indexOf(lane.id));
    if (dEnd >= LANE_CHANGE.planDistance + 15 * steps && steps <= 2) agent.targetLaneId = chosen.fromLane;
    else {
      chosen = ownLaneChoice();
      keep = false;
    }
  }
  // buses: serve the bus stop of this road (on whichever sibling lane it lies)
  agent.busStop = undefined;
  if (agent.kind === 'bus') {
    for (const sib of siblings) {
      const stop = frame.net.busStops.get(sib.id);
      if (!stop || agent.servedStops.has(sib.id)) continue;
      if (stop.s < agent.s + 10 && sib.id === lane.id) continue; // already past it
      agent.busStop = { laneId: sib.id, s: stop.s, dwell: BUS.dwellMin + frame.rng() * (BUS.dwellMax - BUS.dwellMin), done: false };
      if (sib.id !== lane.id && dEnd >= LANE_CHANGE.planDistance) {
        agent.targetLaneId = sib.id;
        if (chosen && chosen.fromLane !== sib.id) {
          chosen = chooseConnector(agent, preferComfortable(agent, frame.graph.connectorsFrom(sib.id).filter((c) => connectorAllowed(agent, c, frame)), frame), frame, sib.id) ?? chosen;
          keep = false;
        }
      }
      break;
    }
  }
  if (!keep) {
    agent.path.length = agent.idx + 1;
    if (chosen) pushConnector(agent, chosen, frame);
  }
  ensurePath(agent, frame);
}

/** Put an agent on a segment (spawn). */
export function placeOnSegment(agent: VehicleAgent, seg: Seg, s: number, speed: number, frame: Frame): void {
  agent.path = [seg];
  agent.idx = 0;
  agent.s = clamp(s, 0, Math.max(0, seg.length - 0.1));
  agent.v = Math.max(0, speed);
  agent.lateral = 0;
  agent.lateralStart = 0;
  agent.laneChange = undefined;
  if (seg.kind === 'lane') planLaneAtEntry(agent, frame);
  else ensurePath(agent, frame);
  updatePose(agent, frame);
  writeState(agent, frame);
}

function replanFromCurrentLane(agent: VehicleAgent, frame: Frame, preferRoadId?: string): void {
  const seg = agent.seg;
  agent.path.length = agent.idx + 1;
  agent.targetLaneId = undefined;
  if (seg.kind !== 'lane') {
    ensurePath(agent, frame);
    return;
  }
  const cands = preferComfortable(agent, frame.graph.connectorsFrom(seg.id).filter((c) => connectorAllowed(agent, c, frame)), frame);
  let chosen: Connector | undefined;
  if (preferRoadId) {
    const same = cands.filter((c) => frame.graph.lane(c.toLane).roadId === preferRoadId);
    chosen = pick(frame.rng, same);
  }
  chosen ??= chooseConnector(agent, cands, frame, seg.id);
  if (chosen) pushConnector(agent, chosen, frame);
  ensurePath(agent, frame);
}

// ---------------------------------------------------------------------------------
// Lane changes
// ---------------------------------------------------------------------------------

function canCrossLine(lane: Lane, dir: 'left' | 'right'): boolean {
  const line = dir === 'left' ? lane.leftLine : lane.rightLine;
  return line === 'dashed' || line === 'dashed_solid' || line === 'none';
}

function nearestAheadOnLane(agent: VehicleAgent, laneId: string, s: number, frame: Frame): OccEntry | undefined {
  for (const e of frame.occ.get(laneId)) {
    if (e.agent === agent) continue;
    if (e.s > s) return e;
  }
  return undefined;
}

function laneChangeSafe(agent: VehicleAgent, target: Lane, frame: Frame, urgent: boolean): boolean {
  const pr = projectOntoPolyline(target.centre, agent.pos);
  const sT = pr.s;
  let leader: OccEntry | undefined;
  let follower: OccEntry | undefined;
  for (const e of frame.occ.get(target.id)) {
    if (e.agent === agent) continue;
    if (e.s >= sT) {
      leader = e;
      break;
    }
    follower = e;
  }
  const v0 = Math.max(agent.v, 1);
  if (leader) {
    const gap = leader.s - sT - leader.length / 2 - agent.length / 2;
    if (gap < 2) return false;
    if (idmAcceleration(agent.v, v0, gap, agent.v - leader.speed, agent.driver) < -LANE_CHANGE.ownSafeDecel) return false;
  }
  if (follower) {
    const gap = sT - follower.s - follower.length / 2 - agent.length / 2;
    if (gap < 2) return false;
    const T = follower.agent?.driver.T ?? IDM.T;
    const af = idmAcceleration(follower.speed, Math.max(follower.speed, 1) + 1, gap, follower.speed - agent.v, { aMax: IDM.aMax, b: IDM.b, s0: IDM.s0, T });
    if (af < -(urgent ? 3.5 : LANE_CHANGE.safeDecel)) return false;
  }
  if (sT < 20) {
    for (const cid of target.prev) {
      const cseg = frame.net.seg(cid);
      for (const e of frame.occ.get(cid)) {
        if (e.agent === agent) continue;
        const gap = cseg.length - e.s + sT - e.length / 2 - agent.length / 2;
        if (gap < 8) return false;
      }
    }
  }
  return true;
}

function startLaneChange(agent: VehicleAgent, target: Lane, dir: 'left' | 'right', frame: Frame, mandatory: boolean): void {
  const cur = agent.seg;
  const pr = projectOntoPolyline(target.centre, agent.pos);
  const preferRoad = agent.nextConnector ? frame.graph.lane(agent.nextConnector.toLane).roadId : undefined;
  agent.path[agent.idx] = frame.net.seg(target.id);
  agent.s = clamp(pr.s, 0, target.length - 0.1);
  agent.lateral = pr.lateral + agent.busPull; // keep the rendered position continuous
  agent.lateralStart = agent.lateral;
  agent.lateralT0 = frame.time;
  agent.laneChange = { from: cur.id, to: target.id, t0: frame.time, dir };
  agent.lastLaneChange = frame.time;
  agent.useIndicatorLane = !agent.driver.bad || frame.rng() < 0.5;
  if (!mandatory || agent.targetLaneId === target.id || !agent.targetLaneId) {
    const nextConn = agent.nextConnector;
    if (!nextConn || nextConn.fromLane !== target.id) replanFromCurrentLane(agent, frame, preferRoad);
    else agent.targetLaneId = undefined;
  }
  if (agent.busStop && agent.busStop.laneId === target.id) agent.targetLaneId = undefined;
}

function updateLaneChange(agent: VehicleAgent, frame: Frame): void {
  const seg = agent.seg;
  if (seg.kind !== 'lane') return;
  const lane = seg.lane!;
  if (agent.laneChange) {
    if (frame.time - agent.laneChange.t0 >= LANE_CHANGE.duration) {
      agent.laneChange = undefined;
      agent.lateral = 0;
      agent.lateralStart = 0;
    }
    return;
  }
  const dEnd = lane.length - agent.s;
  const siblings = frame.graph.siblingLanes(lane.id);
  const i = siblings.findIndex((l) => l.id === lane.id);
  // mandatory: reach the lane of the planned turn / bus stop
  if (agent.targetLaneId && agent.targetLaneId !== lane.id) {
    const ti = siblings.findIndex((l) => l.id === agent.targetLaneId);
    if (ti < 0) {
      agent.targetLaneId = undefined;
      return;
    }
    if (dEnd < LANE_CHANGE.abortDistance) {
      replanFromCurrentLane(agent, frame);
      return;
    }
    const dir: 'left' | 'right' = ti < i ? 'left' : 'right';
    const next = siblings[dir === 'left' ? i - 1 : i + 1];
    if (!next || !laneAllowedFor(agent, next) || !canCrossLine(lane, dir)) {
      replanFromCurrentLane(agent, frame);
      return;
    }
    if (agent.s < 5) return;
    if (laneChangeSafe(agent, next, frame, dEnd < 80)) startLaneChange(agent, next, dir, frame, true);
    return;
  }
  // discretionary changes
  if (frame.time - agent.lastLaneChange < LANE_CHANGE.cooldown) return;
  if (dEnd < LANE_CHANGE.planDistance + 20 || agent.s < 10 || siblings.length < 2) return;
  if (agent.kind === 'bus' && agent.busStop && !agent.busStop.done) return;
  const nextConn = agent.nextConnector;
  const exitRoad = nextConn ? frame.graph.lane(nextConn.toLane).roadId : undefined;
  const turnAvailableFrom = (l: Lane): boolean => !exitRoad || frame.graph.connectorsFrom(l.id).some((c) => frame.graph.lane(c.toLane).roadId === exitRoad && connectorAllowed(agent, c, frame));
  const leader = nearestAheadOnLane(agent, lane.id, agent.s, frame);
  const v0 = seg.vmax * agent.driver.speedFactor;
  if (leader && i > 0) {
    const gap = leader.s - agent.s - leader.length / 2 - agent.length / 2;
    if (gap < LANE_CHANGE.overtakeGap && leader.speed < v0 - LANE_CHANGE.overtakeSpeedDiff) {
      const left = siblings[i - 1]!;
      if (laneAllowedFor(agent, left) && canCrossLine(lane, 'left') && turnAvailableFrom(left) && laneChangeSafe(agent, left, frame, false)) {
        const aNow = idmAcceleration(agent.v, v0, gap, agent.v - leader.speed, agent.driver);
        const lead2 = nearestAheadOnLane(agent, left.id, projectOntoPolyline(left.centre, agent.pos).s, frame);
        const aNew = lead2 ? idmAcceleration(agent.v, v0, lead2.s - projectOntoPolyline(left.centre, agent.pos).s - lead2.length / 2 - agent.length / 2, agent.v - lead2.speed, agent.driver) : idmAcceleration(agent.v, v0, Infinity, 0, agent.driver);
        if (aNew - aNow > LANE_CHANGE.incentive) {
          startLaneChange(agent, left, 'left', frame, false);
          return;
        }
      }
    }
  }
  if (i < siblings.length - 1) {
    const right = siblings[i + 1]!;
    if (laneAllowedFor(agent, right) && canCrossLine(lane, 'right') && turnAvailableFrom(right)) {
      const sR = projectOntoPolyline(right.centre, agent.pos).s;
      const leadR = nearestAheadOnLane(agent, right.id, sR, frame);
      const free = !leadR || leadR.s - sR > LANE_CHANGE.keepRightGap || leadR.speed >= v0 - 1;
      if (free && laneChangeSafe(agent, right, frame, false)) startLaneChange(agent, right, 'right', frame, false);
    }
  }
}

// ---------------------------------------------------------------------------------
// Desired speed
// ---------------------------------------------------------------------------------

function capOf(agent: VehicleAgent, seg: Seg): number {
  const kindCap = KIND_SPEED_CAP_KMH[agent.kind];
  let v = seg.vmax;
  if (seg.kind === 'lane') v = v * agent.driver.speedFactor + (agent.driver.bad ? kmhToMps(BAD_DRIVER_EXTRA_KMH) : 0);
  else if (agent.driver.bad) v *= 1.1;
  if (kindCap !== undefined) v = Math.min(v, kmhToMps(kindCap));
  return v;
}

function desiredSpeed(agent: VehicleAgent, frame: Frame): number {
  const seg = agent.seg;
  let v0 = capOf(agent, seg);
  let dist = seg.length - agent.s;
  for (let k = agent.idx + 1; k < agent.path.length && dist < 100; k++) {
    const sg = agent.path[k]!;
    const c = capOf(agent, sg);
    if (c < v0) v0 = Math.min(v0, speedAllowedAt(c, dist, LOOKAHEAD_DECEL));
    dist += sg.length;
  }
  if (seg.kind === 'lane') {
    const ctrl = frame.net.approachOf(seg.id)?.approach.control;
    const dEnd = seg.length - agent.s;
    if (ctrl === 'give_way' || ctrl === 'roundabout_entry') v0 = Math.min(v0, speedAllowedAt(kmhToMps(15), dEnd, LOOKAHEAD_DECEL));
    else if (ctrl === 'right_hand_rule') v0 = Math.min(v0, speedAllowedAt(kmhToMps(25), dEnd, LOOKAHEAD_DECEL));
    else if (ctrl === 'stop') v0 = Math.min(v0, speedAllowedAt(kmhToMps(10), dEnd, LOOKAHEAD_DECEL));
  }
  return Math.max(v0, 1.0);
}

// ---------------------------------------------------------------------------------
// Obstacles
// ---------------------------------------------------------------------------------

/** IDM gap for a point where the FRONT BUMPER should come to rest, `x` metres ahead of the centre. */
function staticGap(agent: VehicleAgent, x: number): number {
  return x - agent.length / 2 + agent.driver.s0;
}

/** Connectors leaving the same lane share their first metres: a vehicle there is a leader too. */
const DIVERGE_SHARED = 7;

function leaderObstacle(agent: VehicleAgent, frame: Frame, out: Obstacle[]): void {
  let dist = 0;
  let best: { D: number; e: OccEntry } | undefined;
  const consider = (D: number, e: OccEntry) => {
    if (!best || D < best.D) best = { D, e };
  };
  for (let k = agent.idx; k < agent.path.length && dist < JUNCTION.leaderHorizon; k++) {
    const seg = agent.path[k]!;
    const sFrom = k === agent.idx ? agent.s : 0;
    for (const e of frame.occ.get(seg.id)) {
      if (e.agent === agent) continue;
      if (k === agent.idx && e.s <= sFrom) continue;
      consider(dist + (e.s - sFrom), e);
      break; // sorted by s: the first one ahead is the nearest on this segment
    }
    // sibling connectors diverging from the same lane
    const fromLane = seg.kind === 'connector' ? seg.conn!.fromLane : undefined;
    if (fromLane && (k > agent.idx || sFrom < DIVERGE_SHARED)) {
      for (const cid of frame.graph.lane(fromLane).next) {
        if (cid === seg.id) continue;
        for (const e of frame.occ.get(cid)) {
          if (e.agent === agent || e.s >= DIVERGE_SHARED) continue;
          if (k === agent.idx && e.s <= sFrom) continue;
          consider(dist + (e.s - sFrom), e);
        }
      }
    }
    if (best) break;
    dist += seg.length - sFrom;
  }
  if (best) {
    const { D, e } = best;
    out.push({ gap: D - e.length / 2 - agent.length / 2, d: D - e.length / 2, dv: agent.v - e.speed, reason: e.player ? 'player' : 'leader', byPlayer: !!e.player, static: e.speed < JUNCTION.stoppedSpeed });
  }
}

interface YieldResult {
  conflict: boolean;
  npc: boolean;
  player: boolean;
  inside: boolean;
  /** Every conflict is a vehicle inside the box that itself yields to us (we have priority). */
  onlyJuniorsInside: boolean;
  allStationary: boolean;
}

/**
 * Gap acceptance at a junction: anyone on a yieldTo connector, or approaching one within the
 * TTC horizon (3.5 s, extended by the time we still need to reach the line so that the
 * decision anticipates our own arrival instead of being taken while straddling the line)?
 *
 * Vehicles standing at their own line count as "about to go" unless they are held by
 * something and junior to us (they started waiting after we did): seniority makes exactly one
 * of several mutually waiting vehicles proceed first. A senior that has been stuck for a long
 * time (held by a pedestrian, a queue…) is ignored.
 */
export function yieldConflicts(agent: VehicleAgent, conn: Connector, frame: Frame, horizon: number = JUNCTION.ttcHorizon, feeders = true): YieldResult {
  const res: YieldResult = { conflict: false, npc: false, player: false, inside: false, onlyJuniorsInside: true, allStationary: true };
  const note = (e: OccEntry, inside: boolean, junior = false) => {
    res.conflict = true;
    if (e.player) res.player = true;
    else res.npc = true;
    if (inside) res.inside = true;
    if (!inside || !junior) res.onlyJuniorsInside = false;
    if (e.speed >= JUNCTION.stoppedSpeed) res.allStationary = false;
  };
  // Inside the box: first come, first served — nobody enters while a vehicle is on a connector
  // that crosses ours, whichever of the two has priority (prevents mutual geometric blocking).
  for (const xId of frame.net.crossingConnectors(conn.id)) {
    const xseg = frame.net.seg(xId);
    const junior = !conn.yieldTo.includes(xId); // that movement yields to ours
    for (const e of frame.occ.get(xId)) {
      if (e.agent === agent) continue;
      if (xseg.length - e.s < e.length / 2 - 0.5 && !e.player) continue; // practically out of the connector
      note(e, true, junior && !e.player);
    }
  }
  if (!feeders) return res;
  for (const yId of conn.yieldTo) {
    const ySig = frame.signals.stateForConnector(yId);
    if (ySig === 'red' || ySig === 'red_amber') continue;
    for (const up of frame.net.upstream(yId, JUNCTION.upstreamReach)) {
      for (const e of frame.occ.get(up.seg.id)) {
        if (e.agent === agent) continue;
        if (e.agent && !e.agent.plansThrough(yId)) continue;
        const d = up.seg.length - e.s + up.offset; // centre to the conflict entry
        if (d < -1) continue;
        if (e.speed > 0.5 || !e.waiting) {
          // a slow / stopped vehicle that is not held may well accelerate: assume at least a share of the segment's speed
          if (d / Math.max(e.speed, up.seg.vmax * 0.4) < horizon) note(e, false);
        } else if (d - e.length / 2 < 4) {
          if (e.player) note(e, false);
          else if (e.waitingSince !== undefined && frame.time - e.waitingSince <= JUNCTION.stuckSeconds && isSenior(e, agent)) note(e, false);
        }
      }
    }
  }
  return res;
}

/** Did `e` start waiting before `me` (ties broken by id)? Vehicles that are not waiting yet are junior to everyone. */
function isSenior(e: OccEntry, me: VehicleAgent): boolean {
  const mine = me.waitingSince;
  const theirs = e.waitingSince;
  if (theirs === undefined) return false;
  if (mine === undefined) return true;
  if (theirs !== mine) return theirs < mine;
  return (e.agent?.id ?? '') < me.id;
}

function exitBlocked(agent: VehicleAgent, conn: Connector, frame: Frame): 'npc' | 'player' | undefined {
  const need = agent.length + 3;
  for (const e of frame.occ.get(conn.id)) {
    if (e.agent === agent) continue;
    if (e.speed < 1 && conn.length - e.s < need) return e.player ? 'player' : 'npc';
  }
  for (const e of frame.occ.get(conn.toLane)) {
    if (e.agent === agent) continue;
    if (e.speed < 1 && e.s - e.length / 2 < need) return e.player ? 'player' : 'npc';
    break; // sorted: the first entry is the nearest to the junction
  }
  return undefined;
}

function junctionObstacle(agent: VehicleAgent, frame: Frame, out: Obstacle[]): void {
  const seg = agent.seg;
  if (seg.kind !== 'lane') return;
  const lane = seg.lane!;
  const dEnd = seg.length - agent.s;
  const next = agent.path[agent.idx + 1];
  const conn = next?.kind === 'connector' ? next.conn : undefined;
  if (!next) {
    out.push({ gap: staticGap(agent, dEnd - JUNCTION.stopLineGap), d: dEnd, dv: agent.v, reason: 'path_end', byPlayer: false, static: true });
    return;
  }
  if (dEnd > JUNCTION.decisionDistance) return;
  const ap = frame.net.approachOf(lane.id);
  if (!ap) return;
  const v = agent.v;
  let hold: HoldReason | undefined;
  let byPlayer = false;
  let yielding = false;

  const groupId = conn?.signalGroup ?? ap.approach.signalGroup;
  const sgState = groupId ? frame.signals.stateOf(groupId) : undefined;
  if (groupId && sgState) {
    switch (sgState) {
      case 'red':
      case 'red_amber': {
        const stoppable = canStopWithin(v, Math.max(0, dEnd - JUNCTION.stopLineGap), JUNCTION.redEmergencyDecel);
        if (stoppable || dEnd > 12 || v < 1.5) hold = 'red';
        break;
      }
      case 'amber': {
        if (agent.amberDecision === 'go' && dEnd / Math.max(v, 1) < frame.signals.timeToChange(groupId) - 0.2) break;
        if (agent.amberDecision !== 'stop') agent.amberDecision = canStopWithin(v, Math.max(0, dEnd - JUNCTION.stopLineGap), JUNCTION.amberStopDecel) ? 'stop' : 'go';
        if (agent.amberDecision === 'stop') hold = 'amber';
        break;
      }
      case 'flashing_green': {
        if (!agent.amberDecision) {
          const tRed = frame.signals.timeToChange(groupId) + SIGNAL_TIMING.amber;
          const tReach = dEnd / Math.max(v, 1);
          if (tReach > tRed - 0.2 && canStopWithin(v, Math.max(0, dEnd - JUNCTION.stopLineGap), IDM.b + 1)) agent.amberDecision = 'stop';
          else if (tReach <= tRed - 0.2) agent.amberDecision = 'go';
        }
        if (agent.amberDecision === 'stop') hold = 'amber';
        break;
      }
      case 'green':
        agent.amberDecision = undefined;
        break;
      default:
        break; // flashing_amber / off: behave like an unsignalised junction (yield rules below)
    }
  }

  const control = ap.approach.control;
  if (!hold && control === 'stop') {
    if (!agent.stopSignDone) {
      if (v < JUNCTION.stoppedSpeed && dEnd - agent.length / 2 < 3.5) {
        if (agent.stopSignStoppedSince === undefined) agent.stopSignStoppedSince = frame.time;
        if (frame.time - agent.stopSignStoppedSince >= JUNCTION.stopSignSeconds) agent.stopSignDone = true;
        else hold = 'stop_sign';
      } else hold = 'stop_sign';
    }
  }

  const signalAllowsGo = !sgState || sgState === 'green' || sgState === 'flashing_green' || sgState === 'amber' || sgState === 'flashing_amber' || sgState === 'off';
  const frontToLine = dEnd - agent.length / 2;
  const waited = agent.waitingSince !== undefined ? frame.time - agent.waitingSince : 0;
  // The vehicle may still hold until its centre reaches the line (a nose that crept over the line
  // while following a leader can still stop); beyond that it is inside and keeps going.
  const beforeLine = dEnd > 0.3;
  if (!hold && conn && beforeLine && (conn.yieldTo.length > 0 || frame.net.crossingConnectors(conn.id).length > 0) && signalAllowsGo && dEnd < 60) {
    // Committed vehicles no longer wait for approaching traffic (the gap was accepted), but never
    // poke their nose into a junction while a priority vehicle is physically inside it.
    // Approaching traffic is re-checked until the nose reaches the line (a committed vehicle only
    // stops re-evaluating the corner / box rules); vehicles physically inside always count.
    const eta = Math.max(0, frontToLine - JUNCTION.stopLineGap) / Math.max(v, 0.5);
    const c = yieldConflicts(agent, conn, frame, JUNCTION.ttcHorizon + Math.min(3, eta), true);
    // A priority vehicle that cannot stop comfortably any more keeps going: the junior vehicle
    // inside the box is the one that has to wait for it (it entered against its yield duty).
    const cannotStop = c.onlyJuniorsInside && !canStopWithin(v, Math.max(0, frontToLine - JUNCTION.stopLineGap), IDM.b + 1);
    if (c.conflict && !cannotStop) {
      // last resort (e.g. the player parked at a priority line): go after a long wait
      const deadlock = c.allStationary && !c.inside && waited > JUNCTION.deadlockSeconds;
      if (!deadlock) {
        hold = 'yield';
        yielding = true;
        byPlayer = c.player && !c.npc;
      }
    }
  }
  if (!hold && conn && beforeLine && !agent.committed && signalAllowsGo && dEnd < 40) {
    // tight corners: a long vehicle swings over the neighbouring lanes, so it waits for an empty
    // junction, and nobody enters while a long vehicle is turning in a tight corner.
    if (tightCornerConflict(agent, conn, frame) && waited <= JUNCTION.deadlockSeconds * 2) {
      hold = 'yield';
      yielding = true;
    }
  }
  if (!hold && conn && beforeLine && dEnd < 30) {
    // Box blocking: never enter a junction that cannot be cleared — a queue at the exit, or a
    // stationary vehicle / pedestrian anywhere inside the junction region on our path.
    const b = exitBlocked(agent, conn, frame);
    if (b) {
      hold = 'exit_blocked';
      byPlayer = b === 'player';
    } else {
      const region = dEnd + conn.length + agent.length + 2;
      for (const o of out) {
        if (!o.static || o.reason === 'path_end') continue;
        if (o.d > dEnd - 1 && o.d < region) {
          hold = 'exit_blocked';
          byPlayer = o.byPlayer;
          break;
        }
      }
    }
  }
  agent.yielding = yielding;
  if (hold) {
    agent.hold = true;
    out.push({ gap: staticGap(agent, dEnd - JUNCTION.stopLineGap), d: dEnd, dv: v, reason: hold, byPlayer, static: true });
  } else if (conn && frontToLine < JUNCTION.commitDistance) {
    agent.committed = true; // gap accepted: enter without re-evaluating while straddling the line
  }
}

/** Mutual exclusion for long vehicles in tight corners (see junctionObstacle). */
function tightCornerConflict(agent: VehicleAgent, conn: Connector, frame: Frame): boolean {
  const junction = frame.graph.junctions.get(conn.junctionId);
  if (!junction) return false;
  const mySeg = frame.net.connSeg(conn);
  const myTight = agent.isLong && mySeg.tight;
  for (const cid of junction.connectors) {
    if (cid === conn.id) continue;
    const other = frame.graph.connector(cid);
    if (other.fromLane === conn.fromLane) continue;
    const oseg = frame.net.seg(cid);
    for (const e of frame.occ.get(cid)) {
      if (e.agent === agent) continue;
      if (oseg.length - e.s < 1.0) continue; // leaving
      if (myTight) return true;
      if (e.length > 6 && oseg.tight) return true;
    }
    if (myTight) {
      // vehicles about to enter the corner from the other arm(s) while we would still be turning
      const window = Math.max(JUNCTION.longVehicleCornerWindow, Math.sqrt((2 * (mySeg.length + agent.length)) / agent.driver.aMax) + 1);
      for (const up of frame.net.upstream(cid, 50)) {
        for (const e of frame.occ.get(up.seg.id)) {
          if (e.agent === agent || !e.agent?.plansThrough(cid)) continue;
          const d = up.seg.length - e.s + up.offset - e.length / 2;
          if (e.speed > 0.5 && d / Math.max(e.speed, up.seg.vmax * 0.4) < window) return true;
        }
      }
    }
  }
  return false;
}

/** Has the pedestrian already cleared the lane the agent is driving on (and is moving away)? */
function pedestrianPastLane(p: PedestrianAgent, line: [Vec2, Vec2], lanePoint: Vec2, laneWidth: number): boolean {
  const ax = line[1][0] - line[0][0];
  const az = line[1][1] - line[0][1];
  const L2 = ax * ax + az * az;
  if (L2 < 1e-6) return false;
  const u = (q: Vec2) => ((q[0] - line[0][0]) * ax + (q[1] - line[0][1]) * az) / L2;
  const uLane = u(lanePoint);
  const uPed = u(p.pos);
  const L = Math.sqrt(L2);
  const dir = p.crossDir;
  return (uPed - uLane) * dir * L > laneWidth / 2 + 1.0;
}

function crossingObstacles(agent: VehicleAgent, frame: Frame, out: Obstacle[]): void {
  let dist = 0;
  for (let k = agent.idx; k < agent.path.length && dist < JUNCTION.leaderHorizon; k++) {
    const seg = agent.path[k]!;
    const sFrom = k === agent.idx ? agent.s : 0;
    for (const sc of seg.crossings) {
      const D = dist + sc.s - sFrom;
      if (D < -sc.crossing.width / 2) continue;
      const peds = frame.pedsByCrossing.get(sc.crossing.id);
      if (!peds || peds.length === 0) continue;
      const signalised = !!sc.crossing.signalGroup;
      const laneWidth = seg.lane?.width ?? 3.2;
      const lanePoint = frame.net.at(seg, sc.s).p;
      let must = false;
      for (const p of peds) {
        if (p.state.pedState === 'crossing') {
          if (!pedestrianPastLane(p, sc.crossing.line, lanePoint, laneWidth)) must = true;
        } else if (p.state.pedState === 'waiting' && !signalised) must = true;
        if (must) break;
      }
      if (must) {
        out.push({ gap: staticGap(agent, D - sc.crossing.width / 2 - 1.0), d: D - sc.crossing.width / 2, dv: agent.v, reason: 'pedestrian', byPlayer: false, static: true });
        if (D - sc.crossing.width / 2 - 1.0 - agent.length / 2 < 3) agent.hold = agent.hold || seg.kind === 'lane' && D > seg.length - sFrom - 6;
      }
    }
    dist += seg.length - sFrom;
  }
}

function pointInObb(p: Vec2, o: Obb, margin: number): boolean {
  const dx = p[0] - o.pos[0];
  const dz = p[1] - o.pos[1];
  const c = Math.cos(o.heading);
  const s = Math.sin(o.heading);
  const lx = dx * c + dz * s;
  const ly = -dx * s + dz * c;
  return Math.abs(lx) <= o.length / 2 + margin && Math.abs(ly) <= o.width / 2 + margin;
}

function corridorObstacles(agent: VehicleAgent, frame: Frame, out: Obstacle[]): void {
  const samples = agent.pathSamples(frame.time, JUNCTION.leaderHorizon);
  const half = agent.width / 2;
  // the player (any orientation, anywhere on our path)
  const pl = frame.player;
  if (pl) {
    const margin = half + 0.25;
    for (const smp of samples) {
      if (pointInObb(smp.p, pl.obb, margin)) {
        const fwd = forwardOf(smp.h);
        const vAlong = pl.vel[0] * fwd[0] + pl.vel[1] * fwd[1];
        out.push({ gap: smp.d - agent.length / 2, d: smp.d, dv: agent.v - vAlong, reason: 'player', byPlayer: true, static: Math.abs(pl.state.speed) < JUNCTION.stoppedSpeed });
        break;
      }
    }
  }
  // pedestrians physically inside the corridor (jaywalkers, crossing pedestrians)
  const peds = frame.pedestriansNear(agent.pos, PED.corridorLookahead + 5);
  if (peds.length > 0) {
    const r = half + PED.corridorClearance;
    const r2 = r * r;
    outer: for (const smp of samples) {
      if (smp.d > PED.corridorLookahead) break;
      for (const p of peds) {
        const dx = p.pos[0] - smp.p[0];
        const dz = p.pos[1] - smp.p[1];
        if (dx * dx + dz * dz <= r2) {
          out.push({ gap: staticGap(agent, smp.d - 1.5), d: smp.d, dv: agent.v, reason: 'pedestrian', byPlayer: false, static: true });
          break outer;
        }
      }
    }
  }
  // other vehicles crossing / merging into our path (not necessarily on our lanes)
  const others = frame.vehiclesNear(agent.pos, 36);
  if (others.length > 1) {
    const margin = half + 0.2;
    outer2: for (const smp of samples) {
      if (smp.d > 32) break;
      for (const o of others) {
        if (o === agent) continue;
        if (pointInObb(smp.p, o.obb, margin)) {
          const fwd = forwardOf(smp.h);
          const vAlong = o.vel[0] * fwd[0] + o.vel[1] * fwd[1];
          out.push({ gap: smp.d - agent.length / 2, d: smp.d, dv: agent.v - vAlong, reason: 'obstacle', byPlayer: false, static: o.v < JUNCTION.stoppedSpeed });
          break outer2;
        }
      }
    }
  }
}

function busStopObstacle(agent: VehicleAgent, frame: Frame, out: Obstacle[]): void {
  const bs = agent.busStop;
  if (!bs || bs.done || agent.kind !== 'bus') return;
  const seg = agent.seg;
  if (seg.id !== bs.laneId) {
    if (seg.kind === 'connector' || (seg.kind === 'lane' && seg.lane!.roadId !== frame.graph.lane(bs.laneId).roadId)) {
      bs.done = true; // left the road without serving the stop
    }
    return;
  }
  const x = bs.s + BUS.frontOffset - agent.s;
  if (x - agent.length / 2 < -1.5) {
    bs.done = true;
    agent.servedStops.add(bs.laneId);
    return;
  }
  if (agent.v < JUNCTION.stoppedSpeed && x - agent.length / 2 < 1.5) {
    if (bs.arrivedAt === undefined) bs.arrivedAt = frame.time;
    if (frame.time - bs.arrivedAt >= bs.dwell) {
      bs.done = true;
      agent.servedStops.add(bs.laneId);
      return;
    }
  }
  out.push({ gap: staticGap(agent, x), d: x, dv: agent.v, reason: 'bus_stop', byPlayer: false, static: true });
}

// ---------------------------------------------------------------------------------
// Frame update
// ---------------------------------------------------------------------------------

export function updateVehicle(agent: VehicleAgent, frame: Frame): void {
  const { dt } = frame;
  agent.disturbedByPlayer = false;
  agent.nearMissWithPlayer = false;
  agent.hold = false;
  agent.holdReason = undefined;
  agent.yielding = false;
  ensurePath(agent, frame);
  if (agent.seg.kind === 'lane') updateLaneChange(agent, frame);

  const v0 = desiredSpeed(agent, frame);
  const obstacles: Obstacle[] = [];
  leaderObstacle(agent, frame, obstacles);
  crossingObstacles(agent, frame, obstacles);
  corridorObstacles(agent, frame, obstacles);
  junctionObstacle(agent, frame, obstacles); // after the geometric ones: it reads them for box blocking
  busStopObstacle(agent, frame, obstacles);

  const aFree = idmAcceleration(agent.v, v0, Infinity, 0, agent.driver);
  let a = aFree;
  let binding: Obstacle | undefined;
  for (const o of obstacles) {
    const ai = idmAcceleration(agent.v, v0, o.gap, o.dv, agent.driver);
    if (ai < a) {
      a = ai;
      binding = o;
    }
  }
  agent.a = a;
  if (binding && a < aFree - 0.05) agent.holdReason = binding.reason;
  if (binding?.byPlayer && a < -IDM.bDisturbed) agent.disturbedByPlayer = true;

  let vNew = Math.max(0, agent.v + a * dt);
  if (binding?.static && binding.gap - agent.driver.s0 < 0.35 && vNew < 0.6) vNew = 0;
  const waiting = vNew < JUNCTION.stoppedSpeed && !!binding && binding.static;
  if (waiting) {
    if (agent.waitingSince === undefined) agent.waitingSince = frame.time;
  } else agent.waitingSince = undefined;
  agent.v = vNew;
  agent.s += vNew * dt;
  advance(agent, frame);
  updatePose(agent, frame);
  updateIndicator(agent, frame);
  if (frame.player) {
    const gap = obbGap(agent.obb, frame.player.obb);
    if (gap < 1.0 && (Math.abs(frame.player.state.speed) > 1 || agent.v > 1)) agent.nearMissWithPlayer = true;
  }
  writeState(agent, frame);
}

function advance(agent: VehicleAgent, frame: Frame): void {
  for (let guard = 0; guard < 6; guard++) {
    const seg = agent.seg;
    if (agent.s < seg.length) break;
    if (seg.kind === 'lane') {
      if (agent.hold) {
        agent.s = Math.min(agent.s, seg.length - 0.3);
        agent.v = 0;
        break;
      }
      let next = agent.path[agent.idx + 1];
      if (next?.kind === 'connector' && next.conn!.fromLane !== seg.id) {
        replanFromCurrentLane(agent, frame);
        next = agent.path[agent.idx + 1];
      }
      if (!next) {
        agent.s = seg.length;
        agent.v = 0;
        agent.stuckSeconds += frame.dt;
        break;
      }
    }
    agent.s -= seg.length;
    agent.idx++;
    const entered = agent.seg;
    if (entered.kind === 'connector') {
      frame.occ.add(entered.id, agent.occEntry());
      agent.stopSignDone = false;
      agent.stopSignStoppedSince = undefined;
      agent.amberDecision = undefined;
      agent.waitingSince = undefined;
      agent.laneChange = undefined;
      agent.lateral = 0;
      agent.targetLaneId = undefined;
    } else {
      agent.laneChange = undefined;
      agent.lateral = 0;
      planLaneAtEntry(agent, frame);
      frame.occ.add(entered.id, agent.occEntry());
    }
  }
  if (agent.idx > 1) {
    agent.path.splice(0, agent.idx - 1);
    agent.idx = 1;
  }
}

function updatePose(agent: VehicleAgent, frame: Frame): void {
  const seg = agent.seg;
  const at = frame.net.at(seg, agent.s);
  // lane-change lateral interpolation
  let dLat = 0;
  if (agent.laneChange) {
    const t = (frame.time - agent.lateralT0) / LANE_CHANGE.duration;
    const k = smoothstep(t);
    const prev = agent.lateral;
    agent.lateral = agent.lateralStart * (1 - k);
    dLat = frame.dt > 0 ? (agent.lateral - prev) / frame.dt : 0;
  }
  // bus pull-in near the stop
  let pullTarget = 0;
  if (agent.kind === 'bus' && agent.busStop && !agent.busStop.done && seg.id === agent.busStop.laneId) {
    const d = agent.busStop.s - agent.s;
    if (d < 25) pullTarget = Math.max(0, seg.lane!.width / 2 - agent.width / 2 - 0.15);
  }
  const pullRate = 0.35 * frame.dt;
  agent.busPull += clamp(pullTarget - agent.busPull, -pullRate, pullRate);
  let edge = 0;
  if (EDGE_RIDING_KINDS.has(agent.kind) && seg.kind === 'lane') edge = Math.max(0, seg.lane!.width / 2 - agent.width / 2 - EDGE_RIDING_MARGIN);
  const lat = agent.lateral + agent.busPull + edge;
  const r = rightOf(at.h);
  agent.pos = [at.p[0] + r[0] * lat, at.p[1] + r[1] * lat];
  const yaw = agent.laneChange ? Math.atan2(dLat, Math.max(agent.v, 2)) : 0;
  agent.heading = at.h + clamp(yaw, -0.25, 0.25);
  const f = forwardOf(agent.heading);
  agent.vel = [f[0] * agent.v, f[1] * agent.v];
}

function updateIndicator(agent: VehicleAgent, frame: Frame): void {
  let ind: Indicator = 'off';
  const seg = agent.seg;
  if (agent.kind === 'bus' && agent.busStop && !agent.busStop.done && agent.busStop.arrivedAt !== undefined) ind = 'hazard';
  else if (agent.laneChange) ind = agent.useIndicatorLane ? agent.laneChange.dir : 'off';
  else if (seg.kind === 'connector') {
    const t = seg.conn!.turn;
    if (agent.useIndicatorTurn) ind = isLeftTurn(t) ? 'left' : isRightTurn(t) ? 'right' : 'off';
  } else {
    const next = agent.nextConnector;
    const dEnd = seg.length - agent.s;
    if (next && dEnd < 30 && agent.useIndicatorTurn) ind = isLeftTurn(next.turn) ? 'left' : isRightTurn(next.turn) ? 'right' : 'off';
    else if (agent.targetLaneId && agent.targetLaneId !== seg.id && agent.useIndicatorLane && dEnd < LANE_CHANGE.planDistance + 20) {
      const sibs = frame.graph.siblingLanes(seg.id).map((l) => l.id);
      ind = sibs.indexOf(agent.targetLaneId) < sibs.indexOf(seg.id) ? 'left' : 'right';
    }
  }
  agent.indicator = ind;
}

function writeState(agent: VehicleAgent, _frame: Frame): void {
  const st = agent.state;
  const seg = agent.seg;
  st.pos = [agent.pos[0], agent.pos[1]];
  st.heading = agent.heading;
  st.speed = agent.v;
  st.laneId = seg.kind === 'lane' ? seg.id : undefined;
  st.connectorId = seg.kind === 'connector' ? seg.id : undefined;
  st.s = agent.s;
  st.indicator = agent.indicator;
  st.disturbedByPlayer = agent.disturbedByPlayer;
  st.nearMissWithPlayer = agent.nearMissWithPlayer;
  st.waiting = agent.v < JUNCTION.stoppedSpeed && agent.holdReason !== undefined;
  st.yielding = agent.yielding;
  st.braking = agent.a < -1;
  st.holdReason = agent.holdReason;
  st.badDriver = agent.driver.bad;
  st.laneChangeTo = agent.laneChange?.to;
  st.siren = agent.siren || undefined;
}
