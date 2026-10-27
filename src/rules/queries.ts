/**
 * Traffic queries used by several detectors: who is ahead of the player on its path, who
 * conflicts with a movement through a junction, which pedestrians are at a crossing.
 * Pure functions over SimContext + RoadGraph.
 */
import type { SimContext } from '@/core/sim';
import type { AgentKind, TrafficAgentState } from '@/core/types';
import { angleDiff, dist2, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Connector } from '@/world/schema';
import { aheadOf, alongPolyline, frontBumper, lateralOf } from './geometry';

export const VEHICLE_KINDS: ReadonlySet<AgentKind> = new Set<AgentKind>(['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'scooter', 'emergency']);

export function isVehicle(a: TrafficAgentState): boolean {
  return VEHICLE_KINDS.has(a.kind);
}

/** Arc length of an agent along its lane / connector (projects when `s` is absent). */
export function agentS(graph: RoadGraph, a: TrafficAgentState): number | undefined {
  if (a.s !== undefined) return a.s;
  if (a.connectorId) {
    const c = graph.connectors.get(a.connectorId);
    if (c) return alongPolyline(c.path, a.pos, c.length).s;
  }
  if (a.laneId) {
    const l = graph.lanes.get(a.laneId);
    if (l) return alongPolyline(l.centre, a.pos, l.length).s;
  }
  return undefined;
}

export interface AgentAhead {
  agent: TrafficAgentState;
  /** Distance from the player's front bumper to the agent's nearest point, along the player's heading. */
  ahead: number;
  lateral: number;
}

/**
 * Agents in a corridor ahead of the player (geometric, lane-independent): within `within` m
 * of the front bumper along the heading and |lateral| ≤ lateralTol.
 */
export function agentsAhead(ctx: SimContext, within: number, lateralTol = 2.5, filter?: (a: TrafficAgentState) => boolean): AgentAhead[] {
  const p = ctx.player;
  const front = frontBumper(p);
  const probe = { pos: front, heading: p.heading };
  const out: AgentAhead[] = [];
  for (const a of ctx.traffic) {
    if (filter && !filter(a)) continue;
    const along = aheadOf(probe, a.pos) - a.length / 2;
    const lat = lateralOf(probe, a.pos);
    if (along < -a.length || along > within) continue;
    if (Math.abs(lat) > lateralTol + a.width / 2) continue;
    out.push({ agent: a, ahead: Math.max(0, along), lateral: lat });
  }
  out.sort((x, y) => x.ahead - y.ahead);
  return out;
}

export interface Leader {
  agent: TrafficAgentState;
  /** Bumper-to-bumper gap along the path (m). */
  gap: number;
}

/**
 * Nearest vehicle ahead on the player's lane / connector, or on the next connector(s) and lane.
 * Path-based (uses laneId / connectorId of the agents), so vehicles in the adjacent lane are ignored.
 */
export function leaderAhead(graph: RoadGraph, ctx: SimContext, maxGap = 60): Leader | undefined {
  const loc = ctx.localisation;
  const p = ctx.player;
  const sFront = loc.s + p.length / 2;
  let best: Leader | undefined;
  const consider = (a: TrafficAgentState, gap: number) => {
    if (gap < 0 || gap > maxGap) return;
    if (!best || gap < best.gap) best = { agent: a, gap };
  };
  const onSegment = (segId: string, isConn: boolean, offset: number) => {
    for (const a of ctx.traffic) {
      if (!isVehicle(a)) continue;
      const match = isConn ? a.connectorId === segId : a.laneId === segId && !a.connectorId;
      if (!match) continue;
      const s = agentS(graph, a);
      if (s === undefined) continue;
      consider(a, offset + s - a.length / 2);
    }
  };
  if (loc.connectorId) {
    const c = graph.connectors.get(loc.connectorId);
    if (!c) return undefined;
    onSegment(c.id, true, -sFront);
    onSegment(c.toLane, false, c.length - sFront);
    return best;
  }
  if (loc.laneId) {
    const lane = graph.lanes.get(loc.laneId);
    if (!lane) return undefined;
    onSegment(lane.id, false, -sFront);
    if (best) return best;
    const rest = lane.length - sFront;
    for (const cid of lane.next) {
      const c = graph.connectors.get(cid);
      if (!c) continue;
      onSegment(c.id, true, rest);
      onSegment(c.toLane, false, rest + c.length);
    }
  }
  return best;
}

export interface Conflict {
  agent: TrafficAgentState;
  /** The priority connector the agent is on / about to enter. */
  via: Connector;
  /** Seconds until the agent reaches the junction (0 when already inside). */
  ttc: number;
  /** The agent comes from the approach opposite to the player's (relevant for left turns). */
  oncoming: boolean;
}

/**
 * Agents that have priority over `connector`: on one of its `yieldTo` connectors, or on the
 * feeding lane of such a connector with time-to-junction below `ttcLimit` and moving.
 */
export function conflictAgents(graph: RoadGraph, ctx: SimContext, connector: Connector, ttcLimit: number, minSpeed = 1, traffic: readonly TrafficAgentState[] = ctx.traffic): Conflict[] {
  const out: Conflict[] = [];
  const myLane = graph.lanes.get(connector.fromLane);
  const myHeading = myLane ? graph.laneEndHeading(myLane.id) : ctx.player.heading;
  const seen = new Set<string>();
  for (const cid of connector.yieldTo) {
    const c = graph.connectors.get(cid);
    if (!c) continue;
    const feed = graph.lanes.get(c.fromLane);
    const oncoming = feed ? Math.abs(angleDiff(graph.laneEndHeading(feed.id), myHeading)) > (Math.PI * 120) / 180 : false;
    for (const a of traffic) {
      if (!isVehicle(a) || seen.has(a.id)) continue;
      if (a.connectorId === cid) {
        out.push({ agent: a, via: c, ttc: 0, oncoming });
        seen.add(a.id);
        continue;
      }
      if (feed && a.laneId === feed.id && !a.connectorId) {
        const s = agentS(graph, a);
        if (s === undefined) continue;
        const remaining = feed.length - s;
        if (remaining < 0) continue;
        if (a.speed <= minSpeed) continue;
        const ttc = remaining / a.speed;
        if (ttc < ttcLimit) {
          out.push({ agent: a, via: c, ttc, oncoming });
          seen.add(a.id);
        }
      }
    }
  }
  out.sort((x, y) => x.ttc - y.ttc);
  return out;
}

/** Pedestrians at a crossing in the given states (default: waiting or crossing). */
export function pedestriansAtCrossing(ctx: SimContext, crossingId: string, states: ReadonlyArray<'waiting' | 'crossing' | 'walking'> = ['waiting', 'crossing']): TrafficAgentState[] {
  const out: TrafficAgentState[] = [];
  for (const a of ctx.traffic) {
    if (a.kind !== 'pedestrian' || a.crossingId !== crossingId) continue;
    if (a.pedState && !states.includes(a.pedState)) continue;
    if (!a.pedState && !states.includes('walking')) continue;
    out.push(a);
  }
  return out;
}

/** Pedestrians within `radius` of either end of a crossing line (or anywhere along it). */
export function pedestriansNearLine(ctx: SimContext, line: [Vec2, Vec2], radius: number): TrafficAgentState[] {
  const out: TrafficAgentState[] = [];
  for (const a of ctx.traffic) {
    if (a.kind !== 'pedestrian') continue;
    if (dist2(a.pos, line[0]) <= radius || dist2(a.pos, line[1]) <= radius) out.push(a);
  }
  return out;
}

/** Vehicles whose lane / connector is `segId`, with their arc length. */
export function vehiclesOn(graph: RoadGraph, ctx: SimContext, segId: string): { agent: TrafficAgentState; s: number }[] {
  const out: { agent: TrafficAgentState; s: number }[] = [];
  for (const a of ctx.traffic) {
    if (!isVehicle(a)) continue;
    if (a.connectorId !== segId && !(a.laneId === segId && !a.connectorId)) continue;
    const s = agentS(graph, a);
    if (s !== undefined) out.push({ agent: a, s });
  }
  return out;
}
