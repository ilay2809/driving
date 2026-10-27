/**
 * Pedestrians: walk the sidewalk network, wait at crossings until it is safe
 * (pedestrian signal green at signalised crossings; otherwise no vehicle within the
 * TTC horizon or a vehicle that has stopped for them), cross, continue. A few of them
 * jaywalk across quiet streets. "Scripted" pedestrians (lesson requests) stand on the
 * sidewalk next to a crossing and step to the kerb when the player gets close.
 */
import { forwardOf, headingOf, projectOntoPolyline, wrapAngle, type Vec2 } from '@/world/geo';
import type { Crossing } from '@/world/schema';
import type { Frame, TrafficAgentView } from './agents';
import { PED } from './constants';
import type { PedEdge } from './sidewalks';
import { clamp, obbGap, pick } from './util';

export interface JaywalkState {
  from: Vec2;
  to: Vec2;
  roadId: string;
  target: { edge: PedEdge; t: number; dir: 1 | -1 };
  progress: number;
  phase: 'waiting' | 'crossing';
  startedAt: number;
}

export interface PedScript {
  crossingId: string;
  /** The pedestrian steps to the kerb when the player is this close to the crossing (m). */
  triggerDistance: number;
  released: boolean;
}

export class PedestrianAgent {
  readonly state: TrafficAgentView;
  pos: Vec2 = [0, 0];
  heading = 0;
  /** Current speed (m/s) — 0 while waiting. */
  speed = 0;
  edge?: PedEdge;
  dir: 1 | -1 = 1;
  /** Arc-length along the edge from node a. */
  t = 0;
  prevEdge?: PedEdge;
  crossingStarted = false;
  /** +1 = crossing from line[0] (left kerb) towards line[1] (right kerb), −1 the other way. */
  crossDir: 1 | -1 = 1;
  waitSince?: number;
  jaywalk?: JaywalkState;
  script?: PedScript;
  nearMissWithPlayer = false;
  bobPhase = 0;
  readonly colour: number;

  constructor(
    readonly id: string,
    readonly walkSpeed: number,
    readonly jaywalker: boolean,
    colour: number,
    readonly spawnTime: number,
  ) {
    this.colour = colour;
    this.state = { id, kind: 'pedestrian', pos: [0, 0], heading: 0, speed: 0, length: PED.length, width: PED.width, pedState: 'walking' };
  }

  get crossingId(): string | undefined {
    return this.state.crossingId;
  }

  get pedState(): 'waiting' | 'crossing' | 'walking' {
    return this.state.pedState ?? 'walking';
  }
}

export function createPedestrianAgent(id: string, rng: () => number, time: number, opts: { jaywalker?: boolean } = {}): PedestrianAgent {
  const walk = PED.walkMin + rng() * (PED.walkMax - PED.walkMin);
  const jay = opts.jaywalker ?? rng() < PED.jaywalkerShare;
  const colour = Math.floor(rng() * 6);
  const p = new PedestrianAgent(id, walk, jay, colour, time);
  p.bobPhase = rng() * Math.PI * 2;
  return p;
}

/** Put a pedestrian on an edge at arc-length t walking in direction dir. */
export function placePedestrian(p: PedestrianAgent, edge: PedEdge, t: number, dir: 1 | -1, frame: Frame): void {
  p.edge = edge;
  p.dir = dir;
  p.t = clamp(t, 0, edge.length);
  p.crossingStarted = false;
  p.jaywalk = undefined;
  p.prevEdge = undefined;
  const at = frame.sidewalks.at(edge, p.t);
  p.pos = at.p;
  p.heading = dir === 1 ? at.h : wrapAngle(at.h + Math.PI);
  p.speed = 0;
  p.state.pedState = 'walking';
  p.state.crossingId = undefined;
  writePedState(p);
}

/**
 * Is it safe for a pedestrian to step onto a crossing now?
 * Per lane: no vehicle arriving within the TTC horizon, unless one has stopped for us
 * (speed < 0.5 m/s within 15 m before the crossing). Vehicles on the crossing block it.
 * The player is checked geometrically (works without a localiser).
 */
export function crossingSafe(cr: Crossing, frame: Frame): boolean {
  for (const { seg, s } of frame.net.segmentsCrossing(cr.id)) {
    if (!laneSafe(frame, seg.id, s)) return false;
    if (seg.kind === 'connector') {
      // a car at the stop line about to turn across the crossing
      const lane = frame.net.seg(seg.conn!.fromLane);
      if (!laneSafe(frame, lane.id, lane.length + s, (e) => !e.agent || e.agent.plansThrough(seg.id))) return false;
    }
  }
  const pl = frame.player;
  if (pl) {
    const mid: Vec2 = [(cr.line[0][0] + cr.line[1][0]) / 2, (cr.line[0][1] + cr.line[1][1]) / 2];
    if (!playerSafeFor(frame, mid, Math.hypot(cr.line[1][0] - cr.line[0][0], cr.line[1][1] - cr.line[0][1]) / 2, cr.width)) return false;
  }
  return true;
}

function laneSafe(frame: Frame, segId: string, sLine: number, filter?: (e: { agent?: { plansThrough(id: string): boolean } }) => boolean): boolean {
  for (const e of frame.occ.get(segId)) {
    if (filter && !filter(e)) continue;
    const d = sLine - e.s - e.length / 2; // front bumper to the crossing line
    if (d < -(e.length + 2)) continue; // already past
    if (d < 0.3) return false; // on the crossing
    if (e.speed < PED.stoppedSpeed) {
      if (d < PED.stoppedDistance) return true; // stopped for us: this lane is blocked by a courteous vehicle
      continue;
    }
    if (d / e.speed < PED.ttcHorizon) return false;
  }
  return true;
}

/** Geometric check of the player against a crossing point (centre, half-length across the road). */
function playerSafeFor(frame: Frame, centre: Vec2, halfLen: number, width: number): boolean {
  const pl = frame.player!;
  const f = forwardOf(pl.state.heading);
  const wx = centre[0] - pl.state.pos[0];
  const wz = centre[1] - pl.state.pos[1];
  const along = wx * f[0] + wz * f[1];
  const lateral = Math.abs(wx * f[1] - wz * f[0]);
  if (lateral > halfLen + 1.5) return true;
  const speed = Math.abs(pl.state.speed);
  const d = along - pl.state.length / 2;
  if (Math.abs(along) < pl.state.length / 2 + width / 2) return false; // standing on it
  if (along < 0) return true; // passed
  if (speed < PED.stoppedSpeed) return d < PED.stoppedDistance || d > 40;
  return d / speed >= PED.ttcHorizon;
}

/** Safety check for a jaywalker crossing from `from` to `to` on road `roadId`. */
function jaywalkSafe(from: Vec2, roadId: string, frame: Frame): boolean {
  const road = frame.graph.road(roadId);
  for (const laneId of [...road.lanesForward, ...road.lanesBackward]) {
    const lane = frame.graph.lane(laneId);
    const pr = projectOntoPolyline(lane.centre, from);
    if (pr.distance > road.width / 2 + 3) continue;
    if (!laneSafe(frame, laneId, pr.s)) return false;
  }
  if (frame.player && !playerSafeFor(frame, from, road.width / 2 + 1, 2)) return false;
  return true;
}

function chooseNextEdge(p: PedestrianAgent, frame: Frame): void {
  const e = p.edge!;
  const node = p.dir === 1 ? e.b : e.a;
  const options = node.edges.filter((x) => x !== e);
  let next = options.length > 0 ? pick(frame.rng, options)! : e;
  // avoid immediately re-crossing the same crossing back and forth
  if (next.kind === 'crossing' && e.kind === 'crossing' && options.length > 1) next = pick(frame.rng, options.filter((x) => x.kind !== 'crossing'))!;
  p.prevEdge = e;
  p.edge = next;
  p.dir = next.a === node ? 1 : -1;
  p.t = p.dir === 1 ? 0 : next.length;
  p.crossingStarted = false;
  p.waitSince = undefined;
  p.state.crossingId = undefined;
}

function moveAlong(p: PedestrianAgent, dist: number): void {
  p.t += p.dir * dist;
}

export function updatePedestrian(p: PedestrianAgent, frame: Frame): void {
  p.nearMissWithPlayer = false;
  if (p.jaywalk) {
    updateJaywalk(p, frame);
    writePedState(p);
    return;
  }
  const e = p.edge;
  if (!e) return;
  const dt = frame.dt;
  let state: 'waiting' | 'crossing' | 'walking' = 'walking';
  let speed = p.walkSpeed;
  let progress: number | undefined;

  if (e.kind === 'crossing' && e.crossing) {
    const c = e.crossing;
    const startKerb = p.dir === 1 ? c.sA : c.sB;
    const endKerb = p.dir === 1 ? c.sB : c.sA;
    const before = p.dir === 1 ? p.t < startKerb - 1e-6 : p.t > startKerb + 1e-6;
    const onCrossing = p.dir === 1 ? p.t >= startKerb - 1e-6 && p.t < endKerb : p.t <= startKerb + 1e-6 && p.t > endKerb;
    p.state.crossingId = c.id;
    if (before && !p.crossingStarted) {
      // scripted pedestrians hold on the sidewalk until the player approaches
      if (p.script && !p.script.released) {
        const cr = frame.graph.crossings.get(c.id);
        const pl = frame.player;
        if (cr && pl) {
          const mid: Vec2 = [(cr.line[0][0] + cr.line[1][0]) / 2, (cr.line[0][1] + cr.line[1][1]) / 2];
          const f = forwardOf(pl.state.heading);
          const along = (mid[0] - pl.state.pos[0]) * f[0] + (mid[1] - pl.state.pos[1]) * f[1];
          const dist = Math.hypot(mid[0] - pl.state.pos[0], mid[1] - pl.state.pos[1]);
          if (dist <= p.script.triggerDistance || along < 0) p.script.released = true;
        } else p.script.released = true;
        if (!p.script.released) {
          p.speed = 0;
          const at = frame.sidewalks.at(e, p.t);
          p.pos = at.p;
          p.heading = kerbFacing(e, p.dir);
          p.state.pedState = 'walking';
          writePedState(p);
          return;
        }
      }
      const remaining = Math.abs(startKerb - p.t);
      const step = Math.min(remaining, speed * dt);
      moveAlong(p, step);
      if (Math.abs(startKerb - p.t) < 1e-6) p.t = startKerb;
    } else if (!p.crossingStarted) {
      p.t = startKerb;
      state = 'waiting';
      speed = 0;
      if (p.waitSince === undefined) p.waitSince = frame.time;
      const cr = frame.graph.crossings.get(c.id);
      let ok = true;
      if (cr?.signalGroup) ok = frame.signals.stateOf(cr.signalGroup) === 'green';
      if (ok && cr) ok = crossingSafe(cr, frame);
      if (ok) {
        p.crossingStarted = true;
        p.crossDir = p.dir;
        p.waitSince = undefined;
        state = 'crossing';
        speed = PED.crossSpeed;
      }
    } else if (onCrossing) {
      state = 'crossing';
      speed = PED.crossSpeed;
      moveAlong(p, speed * dt);
      const span = Math.abs(endKerb - startKerb);
      progress = span > 0 ? clamp(Math.abs(p.t - startKerb) / span, 0, 1) : 1;
    } else {
      moveAlong(p, speed * dt);
      p.state.crossingId = undefined;
    }
  } else {
    moveAlong(p, speed * dt);
    p.state.crossingId = undefined;
    // jaywalking on quiet streets
    if (p.jaywalker && e.kind === 'sidewalk' && e.roadId && e.side && frame.rng() < 0.004) {
      const road = frame.graph.road(e.roadId);
      if (frame.net.isQuietRoad(road) && e.s0 !== undefined && e.s1 !== undefined) {
        const frac = e.length > 0 ? p.t / e.length : 0;
        const s = e.s0 + (e.s1 - e.s0) * frac;
        const opp = frame.sidewalks.oppositeSidewalk(e.roadId, e.side, s);
        if (opp) {
          const from = frame.sidewalks.at(e, p.t).p;
          const to = frame.sidewalks.at(opp.edge, opp.t).p;
          p.jaywalk = { from, to, roadId: e.roadId, target: { edge: opp.edge, t: opp.t, dir: frame.rng() < 0.5 ? 1 : -1 }, progress: 0, phase: 'waiting', startedAt: frame.time };
        }
      }
    }
  }
  // reached the end of the edge?
  if ((p.dir === 1 && p.t >= e.length - 1e-6) || (p.dir === -1 && p.t <= 1e-6)) chooseNextEdge(p, frame);

  const cur = p.edge!;
  const at = frame.sidewalks.at(cur, p.t);
  p.pos = at.p;
  if (state === 'waiting') p.heading = kerbFacing(cur, p.dir);
  else p.heading = p.dir === 1 ? at.h : wrapAngle(at.h + Math.PI);
  p.speed = speed;
  p.bobPhase += speed * dt * 4;
  p.state.pedState = state;
  p.state.crossingProgress = progress;
  if (frame.player) {
    const gap = obbGap({ pos: p.pos, heading: p.heading, length: PED.length, width: PED.width }, frame.player.obb);
    if (gap < 1.0 && Math.abs(frame.player.state.speed) > 1) p.nearMissWithPlayer = true;
  }
  writePedState(p);
}

/** Facing direction across the road from the kerb of a crossing edge. */
function kerbFacing(e: PedEdge, dir: 1 | -1): number {
  if (e.kind !== 'crossing' || !e.crossing) return 0;
  const kA = e.pts[1]!;
  const kB = e.pts[2]!;
  return dir === 1 ? headingOf(kA, kB) : headingOf(kB, kA);
}

function updateJaywalk(p: PedestrianAgent, frame: Frame): void {
  const j = p.jaywalk!;
  const L = Math.hypot(j.to[0] - j.from[0], j.to[1] - j.from[1]);
  p.heading = headingOf(j.from, j.to);
  if (j.phase === 'waiting') {
    p.speed = 0;
    p.state.pedState = 'waiting';
    p.state.crossingId = undefined;
    p.state.jaywalking = true;
    if (frame.time - j.startedAt > 20) {
      // gave up: continue on the sidewalk
      p.jaywalk = undefined;
      p.state.jaywalking = undefined;
      return;
    }
    if (jaywalkSafe(j.from, j.roadId, frame)) j.phase = 'crossing';
    return;
  }
  j.progress += (PED.crossSpeed * frame.dt) / Math.max(L, 0.1);
  p.speed = PED.crossSpeed;
  p.state.pedState = 'crossing';
  p.state.jaywalking = true;
  p.state.crossingProgress = clamp(j.progress, 0, 1);
  p.bobPhase += PED.crossSpeed * frame.dt * 4;
  if (j.progress >= 1) {
    const { edge, t, dir } = j.target;
    p.edge = edge;
    p.dir = dir;
    p.t = t;
    p.jaywalk = undefined;
    p.state.jaywalking = undefined;
    p.state.crossingProgress = undefined;
    p.state.pedState = 'walking';
    p.pos = frame.sidewalks.at(edge, t).p;
    return;
  }
  p.pos = [j.from[0] + (j.to[0] - j.from[0]) * j.progress, j.from[1] + (j.to[1] - j.from[1]) * j.progress];
  if (frame.player) {
    const gap = obbGap({ pos: p.pos, heading: p.heading, length: PED.length, width: PED.width }, frame.player.obb);
    if (gap < 1.0 && Math.abs(frame.player.state.speed) > 1) p.nearMissWithPlayer = true;
  }
}

function writePedState(p: PedestrianAgent): void {
  const st = p.state;
  st.pos = [p.pos[0], p.pos[1]];
  st.heading = p.heading;
  st.speed = p.speed;
  st.nearMissWithPlayer = p.nearMissWithPlayer;
  st.waiting = st.pedState === 'waiting';
}

/** Seconds a pedestrian has been waiting at its current kerb (0 when not waiting). */
export function waitingSeconds(p: PedestrianAgent, time: number): number {
  return p.waitSince === undefined ? 0 : time - p.waitSince;
}
