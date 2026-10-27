/**
 * Spawning / despawning of NPCs around the player, and placement of scripted agents
 * requested by lessons (`coach:request`).
 *
 * Automatic spawns keep ≤ `density·60` vehicles within 350 m of the player (spawned on
 * lanes 120–350 m away, outside the player's view cone when possible) and
 * ≤ `pedestrians·40` pedestrians within 250 m. When the player is nowhere near the road
 * network (e.g. tests with a far-away parked player) the whole world is populated instead.
 */
import { angleDiff, dist2, forwardOf, rightOf, type Vec2 } from '@/world/geo';
import type { Crossing, Lane } from '@/world/schema';
import type { Frame } from './agents';
import { PED, SPAWN, VEHICLE_DIMS, VEHICLE_MIX, type VehicleKind } from './constants';
import type { Seg } from './network';
import { createPedestrianAgent, PedestrianAgent, placePedestrian } from './pedestrians';
import { obbGap } from './util';
import { createVehicleAgent, placeOnSegment, VehicleAgent } from './vehicles';

export interface Interest {
  centre: Vec2;
  /** True when the player is off the road network: no distance limits apply. */
  offWorld: boolean;
}

export interface SpawnHost {
  readonly frame: Frame;
  readonly vehicles: readonly VehicleAgent[];
  readonly pedestrians: readonly PedestrianAgent[];
  readonly interest: Interest;
  readonly scooterShare: number;
  nextVehicleId(): string;
  nextPedestrianId(): string;
  addVehicle(agent: VehicleAgent): void;
  addPedestrian(p: PedestrianAgent): void;
}

export type SpawnWhere = 'ahead' | 'behind' | 'oncoming' | 'from_right' | 'from_left' | 'inside_roundabout';

export interface SpawnVehicleOptions {
  where: SpawnWhere;
  distance?: number;
  speedKmh?: number;
  vehicle?: VehicleKind;
}

function inViewCone(frame: Frame, p: Vec2, maxDist: number): boolean {
  const pl = frame.player;
  if (!pl) return false;
  const d = dist2(pl.state.pos, p);
  if (d > maxDist) return false;
  const h = Math.atan2(p[1] - pl.state.pos[1], p[0] - pl.state.pos[0]);
  return Math.abs(angleDiff(pl.state.heading, h)) < SPAWN.viewConeHalfAngle;
}

/** No vehicle (or the player) too close to a candidate spawn slot. */
export function spawnSlotClear(host: SpawnHost, seg: Seg, s: number, length: number): boolean {
  const frame = host.frame;
  for (const e of frame.occ.get(seg.id)) {
    if (Math.abs(e.s - s) < (e.length + length) / 2 + SPAWN.clearance) return false;
  }
  if (seg.kind === 'lane') {
    if (s < 25) {
      for (const cid of seg.lane!.prev) {
        const c = frame.net.seg(cid);
        for (const e of frame.occ.get(cid)) if (c.length - e.s + s < (e.length + length) / 2 + SPAWN.clearance) return false;
      }
    }
    if (seg.length - s < 25) {
      for (const cid of seg.lane!.next) for (const e of frame.occ.get(cid)) if (seg.length - s + e.s < (e.length + length) / 2 + SPAWN.clearance) return false;
    }
  }
  const at = frame.net.at(seg, s);
  const obb = { pos: at.p, heading: at.h, length, width: 2.5 };
  for (const v of frame.vehiclesNear(at.p, 20)) if (obbGap(obb, v.obb) < 4) return false;
  if (frame.player && obbGap(obb, frame.player.obb) < 12) return false;
  return true;
}

function pickKind(host: SpawnHost): VehicleKind {
  const r = host.frame.rng();
  if (host.scooterShare > 0 && host.frame.rng() < host.scooterShare * 0.2) return host.frame.rng() < 0.5 ? 'scooter' : 'bicycle';
  if (r < VEHICLE_MIX.car) return 'car';
  if (r < VEHICLE_MIX.car + VEHICLE_MIX.bus) return host.frame.net.hasBusInfrastructure ? 'bus' : 'car';
  return 'truck';
}

/** Try to spawn one automatic vehicle. Returns the agent or undefined when no slot was found. */
export function spawnVehicleAuto(host: SpawnHost): VehicleAgent | undefined {
  const frame = host.frame;
  const kind = pickKind(host);
  const dims = VEHICLE_DIMS[kind];
  const busLanes = kind === 'bus' ? frame.net.world.lanes.filter((l) => frame.net.busRoads.has(l.roadId) && (l.kind === 'drive' || l.kind === 'bus')) : [];
  for (let attempt = 0; attempt < SPAWN.attempts; attempt++) {
    let lane: Lane | undefined;
    if (kind === 'bus' && busLanes.length > 0 && attempt < SPAWN.attempts - 4) lane = busLanes[Math.floor(frame.rng() * busLanes.length)];
    else lane = frame.net.randomDriveLane(frame.rng);
    if (!lane || lane.length < 2 * SPAWN.laneEndMargin + 10) continue;
    const s = SPAWN.laneEndMargin + frame.rng() * (lane.length - 2 * SPAWN.laneEndMargin);
    const seg = frame.net.seg(lane.id);
    const p = frame.net.at(seg, s).p;
    if (!host.interest.offWorld) {
      const d = dist2(p, host.interest.centre);
      if (d < SPAWN.vehicleMinDist || d > SPAWN.vehicleRadius) continue;
      if (attempt < SPAWN.attempts - 4 && inViewCone(frame, p, SPAWN.viewConeDistance)) continue;
    }
    if (!spawnSlotClear(host, seg, s, dims.length)) continue;
    const agent = createVehicleAgent(host.nextVehicleId(), kind, frame.rng, frame.time);
    // start a little below the limit; the IDM settles the speed quickly
    let speed = seg.vmax * 0.7;
    for (const e of frame.occ.get(seg.id)) if (e.s > s && e.s - s < 30) speed = Math.min(speed, e.speed);
    placeOnSegment(agent, seg, s, speed, frame);
    host.addVehicle(agent);
    return agent;
  }
  return undefined;
}

export function spawnPedestrianAuto(host: SpawnHost): PedestrianAgent | undefined {
  const frame = host.frame;
  for (let attempt = 0; attempt < SPAWN.attempts; attempt++) {
    const pt = frame.sidewalks.randomSidewalkPoint(frame.rng);
    if (!pt) return undefined;
    const p = frame.sidewalks.at(pt.edge, pt.t).p;
    if (!host.interest.offWorld) {
      const d = dist2(p, host.interest.centre);
      if (d < SPAWN.pedestrianMinDist || d > SPAWN.pedestrianRadius) continue;
      if (attempt < SPAWN.attempts - 4 && inViewCone(frame, p, SPAWN.pedViewConeDistance)) continue;
    }
    let tooClose = false;
    for (const other of frame.pedestriansNear(p, 3)) if (dist2(other.pos, p) < 1.5) tooClose = true;
    if (tooClose) continue;
    const ped = createPedestrianAgent(host.nextPedestrianId(), frame.rng, frame.time);
    placePedestrian(ped, pt.edge, pt.t, frame.rng() < 0.5 ? 1 : -1, frame);
    host.addPedestrian(ped);
    return ped;
  }
  return undefined;
}

/** Reference lane + s of the player for relative spawns (lane-based, else map-matched). */
function playerLaneRef(frame: Frame): { lane: Lane; s: number } | undefined {
  const pl = frame.player;
  if (!pl) return undefined;
  const slot = pl.slot;
  if (slot) {
    const lane = frame.graph.lanes.get(slot.segId);
    if (lane) return { lane, s: slot.s };
    const conn = frame.graph.connectors.get(slot.segId);
    if (conn) return { lane: frame.graph.lane(conn.toLane), s: -(conn.length - slot.s) };
  }
  const m = frame.graph.nearestLane(pl.state.pos, { heading: pl.state.heading, maxDist: 8 });
  return m ? { lane: m.lane, s: m.s } : undefined;
}

/** Walk `distance` metres forward along lanes/connectors (straight preferred) from (lane, s). */
function walkForward(frame: Frame, lane: Lane, s: number, distance: number): { seg: Seg; s: number } | undefined {
  let seg = frame.net.seg(lane.id);
  let pos = s + distance;
  for (let guard = 0; guard < 20; guard++) {
    if (pos < seg.length) return { seg, s: Math.max(0, pos) };
    pos -= seg.length;
    if (seg.kind === 'lane') {
      const conns = frame.graph.connectorsFrom(seg.id).filter((c) => frame.graph.lane(c.toLane).kind === 'drive');
      const straight = conns.find((c) => c.turn === 'straight') ?? conns.find((c) => c.turn !== 'uturn') ?? conns[0];
      if (!straight) return undefined;
      seg = frame.net.connSeg(straight);
    } else seg = frame.net.seg(seg.conn!.toLane);
  }
  return undefined;
}

/** Walk `distance` metres backward from (lane, s). */
function walkBackward(frame: Frame, lane: Lane, s: number, distance: number): { seg: Seg; s: number } | undefined {
  let seg = frame.net.seg(lane.id);
  let pos = s - distance;
  for (let guard = 0; guard < 20; guard++) {
    if (pos >= 0) return { seg, s: Math.min(pos, seg.length) };
    if (seg.kind === 'lane') {
      const conns = frame.graph.connectorsInto(seg.id).filter((c) => frame.graph.lane(c.fromLane).kind === 'drive');
      const straight = conns.find((c) => c.turn === 'straight') ?? conns.find((c) => c.turn !== 'uturn') ?? conns[0];
      if (!straight) return undefined;
      seg = frame.net.connSeg(straight);
    } else seg = frame.net.seg(seg.conn!.fromLane);
    pos += seg.length;
  }
  return undefined;
}

/** Spawn a vehicle relative to the player's lane / next junction (lesson requests). */
export function spawnVehicleRelative(host: SpawnHost, opts: SpawnVehicleOptions): VehicleAgent | undefined {
  const frame = host.frame;
  const ref = playerLaneRef(frame);
  if (!ref) return undefined;
  const kind: VehicleKind = opts.vehicle ?? 'car';
  const distance = opts.distance ?? 60;
  let target: { seg: Seg; s: number } | undefined;
  let speed: number | undefined = opts.speedKmh !== undefined ? opts.speedKmh / 3.6 : undefined;
  switch (opts.where) {
    case 'ahead':
      target = walkForward(frame, ref.lane, ref.s, distance);
      break;
    case 'behind':
      target = walkBackward(frame, ref.lane, ref.s, distance);
      break;
    case 'oncoming': {
      const road = frame.graph.road(ref.lane.roadId);
      const opposite = road.lanesForward.includes(ref.lane.id) ? road.lanesBackward : road.lanesForward;
      const oppLane = opposite[0] ? frame.graph.lane(opposite[0]) : undefined;
      if (!oppLane) return undefined;
      const ahead = walkForward(frame, ref.lane, ref.s, distance);
      if (!ahead) return undefined;
      const p = frame.net.at(ahead.seg, ahead.s).p;
      const seg = frame.net.seg(oppLane.id);
      const pr = frame.graph.nearestLane(p, { heading: frame.net.at(seg, 0).h, maxDist: 20, preferLaneId: oppLane.id });
      target = { seg: pr ? frame.net.seg(pr.lane.id) : seg, s: pr ? pr.s : seg.length / 2 };
      break;
    }
    case 'from_right':
    case 'from_left': {
      const ap = frame.graph.approachOf(ref.lane.id);
      if (!ap) return undefined;
      const want = opts.where === 'from_right' ? -Math.PI / 2 : Math.PI / 2;
      let best: { lane: Lane; score: number } | undefined;
      for (const a of ap.junction.approaches) {
        if (a.laneIds.includes(ref.lane.id)) continue;
        const diff = angleDiff(ap.approach.heading, a.heading);
        const score = Math.abs(angleDiff(diff, want));
        if (score > (50 * Math.PI) / 180) continue;
        const laneId = a.laneIds[a.laneIds.length - 1]!;
        const lane = frame.graph.lane(laneId);
        if (lane.kind !== 'drive') continue;
        if (!best || score < best.score) best = { lane, score };
      }
      if (!best) return undefined;
      target = walkBackward(frame, best.lane, best.lane.length, distance);
      break;
    }
    case 'inside_roundabout': {
      const ap = frame.graph.approachOf(ref.lane.id);
      const rb = ap?.junction.roundabout;
      if (!ap || !rb) return undefined;
      const entry = frame.graph.connectorsFrom(ref.lane.id).find((c) => c.yieldTo.length > 0);
      const ringConnId = entry?.yieldTo.find((id) => rb.ringLaneIds.includes(frame.graph.connector(id).toLane)) ?? entry?.yieldTo[0];
      const ringConn = ringConnId ? frame.graph.connector(ringConnId) : undefined;
      const ringLane = ringConn ? frame.graph.lane(ringConn.fromLane) : frame.graph.lane(rb.ringLaneIds[0]!);
      target = walkBackward(frame, ringLane, ringLane.length, Math.min(distance, 60));
      speed ??= frame.net.seg(ringLane.id).vmax;
      break;
    }
  }
  if (!target) return undefined;
  const dims = VEHICLE_DIMS[kind];
  const slot: { seg: Seg; s: number } = target;
  if (!spawnSlotClear(host, slot.seg, slot.s, dims.length)) {
    // nudge backwards a little to find a free slot
    let found = false;
    for (let k = 1; k <= 4 && !found; k++) {
      const s2: number = slot.s - k * (dims.length + 4);
      if (s2 >= 0 && spawnSlotClear(host, slot.seg, s2, dims.length)) {
        slot.s = s2;
        found = true;
      }
    }
    if (!found) return undefined;
  }
  const agent = createVehicleAgent(host.nextVehicleId(), kind, frame.rng, frame.time, { bad: false, siren: kind === 'emergency' });
  placeOnSegment(agent, slot.seg, slot.s, speed ?? slot.seg.vmax * 0.9, frame);
  host.addVehicle(agent);
  return agent;
}

/** Nearest crossing ahead of the player (within 160 m, roughly in its direction of travel). */
export function nearestCrossingAhead(frame: Frame): Crossing | undefined {
  const pl = frame.player;
  if (!pl) return undefined;
  const f = forwardOf(pl.state.heading);
  let best: { c: Crossing; d: number } | undefined;
  for (const c of frame.graph.crossingsWithin(pl.state.pos, 160)) {
    const mid: Vec2 = [(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2];
    const wx = mid[0] - pl.state.pos[0];
    const wz = mid[1] - pl.state.pos[1];
    const along = wx * f[0] + wz * f[1];
    const lateral = Math.abs(wx * f[1] - wz * f[0]);
    if (along < 3) continue;
    const onMyLane = pl.slot ? c.laneIds.includes(pl.slot.segId) : false;
    const score = along + lateral * 2 - (onMyLane ? 30 : 0);
    if (!best || score < best.d) best = { c, d: score };
  }
  return best?.c;
}

/** Spawn a scripted pedestrian at a crossing (lesson request). */
export function spawnScriptedPedestrian(host: SpawnHost, crossingId?: string): PedestrianAgent | undefined {
  const frame = host.frame;
  const crossing = crossingId ? frame.graph.crossings.get(crossingId) : nearestCrossingAhead(frame);
  if (!crossing) return undefined;
  const edge = frame.sidewalks.crossingEdges.get(crossing.id);
  if (!edge) return undefined;
  // start on the kerb nearest to the player's right-hand side (the driver's near kerb)
  let dir: 1 | -1 = -1;
  const pl = frame.player;
  if (pl) {
    const r = rightOf(pl.state.heading);
    const dotA = (crossing.line[0][0] - pl.state.pos[0]) * r[0] + (crossing.line[0][1] - pl.state.pos[1]) * r[1];
    const dotB = (crossing.line[1][0] - pl.state.pos[0]) * r[0] + (crossing.line[1][1] - pl.state.pos[1]) * r[1];
    dir = dotA > dotB ? 1 : -1;
  }
  const ped = createPedestrianAgent(host.nextPedestrianId(), frame.rng, frame.time, { jaywalker: false });
  placePedestrian(ped, edge, dir === 1 ? 0 : edge.length, dir, frame);
  ped.script = { crossingId: crossing.id, triggerDistance: PED.scriptedTriggerMin + frame.rng() * (PED.scriptedTriggerMax - PED.scriptedTriggerMin), released: !pl };
  ped.state.crossingId = crossing.id;
  host.addPedestrian(ped);
  return ped;
}
