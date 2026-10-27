/**
 * Danger predictor — the "dual brake" of the instructor and the examiner.
 *
 * Each tick it looks a few seconds ahead and reports the first imminent conflict:
 *   red_signal  – red / red+amber / amber ahead, stop line within the stopping distance + 2 m,
 *                 speed > 15 km/h and the driver is not braking (brake < 0.2)
 *   pedestrian  – a pedestrian waiting at / crossing a crossing ahead within the stopping distance
 *   yield       – entering a stop / give-way / right-hand-rule / roundabout junction while an
 *                 agent with priority (on a yieldTo path) arrives within 1.5 s
 *   collision   – closing in on a leader (or anything in the car's path) with TTC < 1.2 s
 *
 * Stopping distance uses a brisk-but-normal deceleration (5 m/s²): when the driver has not
 * started braking by that point, a human instructor would already be on the pedal.
 */
import type { SimContext } from '@/core/sim';
import type { TrafficAgentState } from '@/core/types';
import { angleDiff, dist2, forwardOf, projectOntoPolyline, rightOf } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Crossing } from '@/world/schema';
import type { LineTable } from './lines';
import type { DangerPrediction } from './types';

export interface DangerOptions {
  /** Deceleration assumed for a comfortable-hard stop (m/s²). */
  brakingDecel?: number;
  /** Connector the player is expected to take at the next junction (from the navigator). */
  preferredConnectorId?: string;
  /** Minimum speed (m/s) below which no intervention is predicted. */
  minSpeed?: number;
}

const KMH15 = 15 / 3.6;

export function stoppingDistance(v: number, decel: number): number {
  return (v * v) / (2 * decel);
}

export function predictDanger(ctx: SimContext, graph: RoadGraph, lines: LineTable, opts: DangerOptions = {}): DangerPrediction | undefined {
  const v = ctx.player.speed;
  if (ctx.player.brake >= 0.2 || v <= (opts.minSpeed ?? 0.5)) return undefined;
  const a = opts.brakingDecel ?? 5;
  return redSignalDanger(ctx, graph, lines, v, a) ?? pedestrianDanger(ctx, graph, lines, v, a, opts) ?? yieldDanger(ctx, graph, lines, v, opts) ?? collisionDanger(ctx, lines, v);
}

function redSignalDanger(ctx: SimContext, graph: RoadGraph, lines: LineTable, v: number, a: number): DangerPrediction | undefined {
  const loc = ctx.localisation;
  if (!loc.laneId || loc.insideJunction || v < KMH15) return undefined;
  const ap = graph.approachOf(loc.laneId);
  if (!ap || ap.approach.control !== 'signals' || !ap.approach.signalGroup) return undefined;
  const state = ctx.signals.stateOf(ap.approach.signalGroup);
  if (state !== 'red' && state !== 'red_amber' && state !== 'amber') return undefined;
  const d = loc.distToLaneEnd - ctx.player.length / 2; // front of the car → stop line
  if (d < -2) return undefined; // already past the line (the judge reports RED_LIGHT)
  // amber: when a stop is physically impossible, continuing is the legal choice
  if (state === 'amber' && d < stoppingDistance(v, 7) + 1) return undefined;
  if (d < stoppingDistance(v, a) + 2) return { kind: 'red_signal', reason: lines.line('danger.reason.red_signal'), ttc: Math.max(0, d) / v, subject: ap.junction.id };
  return undefined;
}

/** Distance from the front of the car to a crossing along the player's path, or undefined when it is not ahead. */
export function distanceToCrossing(ctx: SimContext, graph: RoadGraph, crossing: Crossing, preferredConnectorId?: string): number | undefined {
  const loc = ctx.localisation;
  const half = ctx.player.length / 2;
  const mid: [number, number] = [(crossing.line[0][0] + crossing.line[1][0]) / 2, (crossing.line[0][1] + crossing.line[1][1]) / 2];
  if (loc.connectorId) {
    const c = graph.connectors.get(loc.connectorId);
    if (!c) return undefined;
    if (!c.crossings.includes(crossing.id)) return undefined;
    const pr = projectOntoPolyline(c.path, mid);
    if (pr.s < 0.1 && loc.s > 0.5) return undefined; // the entry crossing, already behind us
    if (pr.s >= c.length - 0.1) return c.length - loc.s + 1 + crossing.width / 2 - half; // exit crossing
    return pr.s - loc.s - half;
  }
  if (!loc.laneId) return undefined;
  const lane = graph.lanes.get(loc.laneId);
  if (!lane) return undefined;
  const onLane = (graph.crossingsByLane.get(lane.id) ?? []).some((x) => x.id === crossing.id);
  if (onLane) {
    const pr = projectOntoPolyline(lane.centre, mid);
    if (pr.s >= lane.length - 0.1) return loc.distToLaneEnd + 1 + crossing.width / 2 - half; // approach crossing beyond the stop line
    return pr.s - loc.s - half;
  }
  // exit-side crossing of the movement we are about to take
  const conns = preferredConnectorId ? [graph.connectors.get(preferredConnectorId)].filter((c): c is NonNullable<typeof c> => !!c) : graph.connectorsFrom(lane.id);
  for (const c of conns) {
    if (!c.crossings.includes(crossing.id)) continue;
    return loc.distToLaneEnd + c.length + 1 + crossing.width / 2 - half;
  }
  return undefined;
}

function pedestrianDanger(ctx: SimContext, graph: RoadGraph, lines: LineTable, v: number, a: number, opts: DangerOptions): DangerPrediction | undefined {
  if (v < 2) return undefined;
  let best: DangerPrediction | undefined;
  for (const agent of ctx.traffic) {
    if (agent.kind !== 'pedestrian' || !agent.crossingId) continue;
    if (agent.pedState !== 'crossing' && agent.pedState !== 'waiting') continue;
    const crossing = graph.crossings.get(agent.crossingId);
    if (!crossing) continue;
    const d = distanceToCrossing(ctx, graph, crossing, opts.preferredConnectorId);
    if (d === undefined || d < -crossing.width) continue;
    if (d < stoppingDistance(v, a) + 2) {
      const ttc = Math.max(0, d) / v;
      if (!best || ttc < best.ttc) best = { kind: 'pedestrian', reason: lines.line('danger.reason.pedestrian'), ttc, subject: agent.id };
    }
  }
  return best;
}

function yieldDanger(ctx: SimContext, graph: RoadGraph, lines: LineTable, v: number, opts: DangerOptions): DangerPrediction | undefined {
  const loc = ctx.localisation;
  if (!loc.laneId || loc.insideJunction || v < 1.5) return undefined;
  const ap = graph.approachOf(loc.laneId);
  if (!ap) return undefined;
  const control = ap.approach.control;
  if (control !== 'stop' && control !== 'give_way' && control !== 'right_hand_rule' && control !== 'roundabout_entry') return undefined;
  const d = loc.distToLaneEnd - ctx.player.length / 2;
  const tPlayer = Math.max(0, d) / v;
  if (tPlayer > 1.5) return undefined; // not yet entering
  const preferred = opts.preferredConnectorId ? graph.connectors.get(opts.preferredConnectorId) : undefined;
  const conns = preferred && preferred.fromLane === loc.laneId ? [preferred] : graph.connectorsFrom(loc.laneId);
  const yieldSet = new Set<string>();
  for (const c of conns) for (const id of c.yieldTo) yieldSet.add(id);
  if (yieldSet.size === 0) return undefined;
  const fromLanes = new Set<string>();
  for (const id of yieldSet) {
    const c = graph.connectors.get(id);
    if (c) fromLanes.add(c.fromLane);
  }
  const centre = ap.junction.position;
  let best: DangerPrediction | undefined;
  for (const agent of ctx.traffic) {
    if (agent.kind === 'pedestrian') continue;
    const onPath = !!agent.connectorId && yieldSet.has(agent.connectorId);
    const approaching = !onPath && !!agent.laneId && fromLanes.has(agent.laneId);
    if (!onPath && !approaching) continue;
    const toCentre: [number, number] = [centre[0] - agent.pos[0], centre[1] - agent.pos[1]];
    const dAgent = Math.hypot(toCentre[0], toCentre[1]);
    const f = forwardOf(agent.heading);
    const movingAway = toCentre[0] * f[0] + toCentre[1] * f[1] < 0 && dAgent > 8;
    if (movingAway) continue;
    const tAgent = onPath ? 0 : Math.max(0, dAgent - 8) / Math.max(agent.speed, 0.5);
    if (tAgent < 1.5) {
      const ttc = Math.min(tPlayer, tAgent);
      if (!best || ttc < best.ttc) best = { kind: 'yield', reason: lines.line('danger.reason.yield'), ttc, subject: agent.id };
    }
  }
  return best;
}

/** Leader / obstacle in the car's path: TTC from the geometry (works on lanes and connectors). */
function collisionDanger(ctx: SimContext, lines: LineTable, v: number): DangerPrediction | undefined {
  const p = ctx.player;
  const fwd = forwardOf(p.heading);
  const right = rightOf(p.heading);
  let best: DangerPrediction | undefined;
  for (const agent of ctx.traffic) {
    const relX = agent.pos[0] - p.pos[0];
    const relZ = agent.pos[1] - p.pos[1];
    const lon = relX * fwd[0] + relZ * fwd[1];
    const lat = relX * right[0] + relZ * right[1];
    const maxLon = agent.kind === 'pedestrian' ? 40 : 80;
    if (lon <= 0 || lon > maxLon) continue;
    if (Math.abs(lat) > (p.width + agent.width) / 2 + 0.4) continue;
    const dh = Math.abs(angleDiff(p.heading, agent.heading));
    if (dh > Math.PI / 3 && agent.speed > 1) continue; // crossing traffic: the yield logic
    const closing = v - agent.speed * Math.cos(dh);
    if (closing <= 0.3) continue;
    const gap = lon - p.length / 2 - agent.length / 2;
    const ttc = gap <= 0 ? 0 : gap / closing;
    if (ttc < 1.2 && (!best || ttc < best.ttc)) best = { kind: 'collision', reason: lines.line('danger.reason.collision'), ttc, subject: agent.id };
  }
  return best;
}

/** Nearest agent behind the player within `metres` on roughly the same heading (for the examiner's emergency stop). */
export function agentBehind(ctx: SimContext, metres: number): TrafficAgentState | undefined {
  const p = ctx.player;
  const fwd = forwardOf(p.heading);
  const right = rightOf(p.heading);
  let best: TrafficAgentState | undefined;
  let bestD = Infinity;
  for (const agent of ctx.traffic) {
    if (agent.kind === 'pedestrian') continue;
    const relX = agent.pos[0] - p.pos[0];
    const relZ = agent.pos[1] - p.pos[1];
    const lon = relX * fwd[0] + relZ * fwd[1];
    const lat = relX * right[0] + relZ * right[1];
    if (lon >= 0 || -lon > metres || Math.abs(lat) > 3) continue;
    if (Math.abs(angleDiff(p.heading, agent.heading)) > Math.PI / 3) continue;
    const d = dist2(agent.pos, p.pos);
    if (d < bestD) {
      bestD = d;
      best = agent;
    }
  }
  return best;
}
