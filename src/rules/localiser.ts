/**
 * Localiser — map-matches the player to the lane network every tick and fills
 * `ctx.localisation` in place. Pure TypeScript (no THREE), deterministic.
 *
 * Matching strategy
 *  - If the car centre is inside a junction polygon (the previous lane's end junction, the
 *    previous connector's junction or any junction within 25 m) and a connector of that
 *    junction passes within 3 m → connector mode (`connectorId`, `junctionId`, `insideJunction`).
 *    The connector matched last tick is kept unless another one scores clearly better, and
 *    connectors leaving the previous lane are preferred.
 *  - Otherwise lane mode: `graph.nearestLane` with heading preference and a bonus for the lane
 *    matched last tick (or the exit lane of the connector just left). A lane on another road
 *    only takes over when the car is physically on it (< 1 m) or has really left the old one.
 *  - `wrongWay`: against a one-way lane (|heading error| > 110° while moving forward), or on a
 *    two-way road physically on the half that belongs to the opposite direction (matched by
 *    heading to a lane of one direction while the centre is beyond the road centre line).
 *    Needs 1 s of continuous evidence.
 *  - `onKerb`: car centre more than 0.6 m beyond the carriageway edge (computed from the road's
 *    width and lane layout), not inside a junction, with 0.5 s on/off hysteresis.
 *
 * Helpers for the detectors (also exported as free functions taking the graph):
 *  - currentApproach(ctx): junction/approach of the lane the player is on (or came from, when
 *    on a connector) with the distance from the FRONT bumper to the stop line (negative = past).
 *  - upcomingCrossings(ctx, within): crossings ahead on the lane / connector ordered by distance.
 */
import type { SimContext, System } from '@/core/sim';
import type { Localisation } from '@/core/types';
import { angleDiff, projectOntoPolyline, type Vec2 } from '@/world/geo';
import type { ConnectorMatch, LaneMatch, RoadGraph } from '@/world/graph';
import type { Approach, Connector, Crossing, Junction, Lane } from '@/world/schema';
import { alongPolyline, carriagewayEdges, degToRad, frontBumper, midpoint, roadLateral } from './geometry';
import { LOCALISER as T } from './thresholds';

export interface ApproachInfo {
  junction: Junction;
  approach: Approach;
  /** The approach lane the player is on, or came from when already on a connector. */
  laneId: string;
  lane: Lane;
  /** Along-lane distance from the car's front bumper to the stop line (m); negative = past it. */
  distToStopLine: number;
  stopLine?: [Vec2, Vec2];
  onConnector: boolean;
  connector?: Connector;
}

export interface CrossingAhead {
  crossing: Crossing;
  /** Distance from the front bumper to the NEAR edge of the crossing band (m, may be negative while on it). */
  distance: number;
  /** Distance from the front bumper to the crossing's centre line. */
  distanceToLine: number;
  onConnector: boolean;
}

const WRONG_WAY_HEADING = degToRad(T.WRONG_WAY_HEADING_DEG);
const CONNECTOR_MAX_HEADING = degToRad(100);

function laneMatchFrom(lane: Lane, pos: Vec2, heading: number): LaneMatch {
  const pr = projectOntoPolyline(lane.centre, pos);
  return { lane, s: pr.s, lateral: pr.lateral, distance: pr.distance, laneHeading: pr.h, headingError: angleDiff(pr.h, heading) };
}

function connectorMatchFrom(c: Connector, pos: Vec2, heading: number): ConnectorMatch {
  const pr = projectOntoPolyline(c.path, pos);
  return { connector: c, s: pr.s, lateral: pr.lateral, distance: pr.distance, pathHeading: pr.h, headingError: angleDiff(pr.h, heading) };
}

function connectorScore(m: ConnectorMatch): number {
  return m.distance + Math.abs(m.headingError) * 3;
}

export class Localiser implements System {
  readonly name = 'localiser';
  private prevLaneId?: string;
  private prevConnectorId?: string;
  private wrongWayTimer = 0;
  private kerbOnTimer = 0;
  private kerbOffTimer = 0;
  private kerb = false;

  constructor(public readonly graph: RoadGraph) {}

  reset(): void {
    this.prevLaneId = undefined;
    this.prevConnectorId = undefined;
    this.wrongWayTimer = 0;
    this.kerbOnTimer = 0;
    this.kerbOffTimer = 0;
    this.kerb = false;
  }

  update(ctx: SimContext): void {
    const g = this.graph;
    const loc = ctx.localisation;
    const p = ctx.player;
    const dt = ctx.dt;
    const prevLane = this.prevLaneId ? g.lanes.get(this.prevLaneId) : undefined;
    const prevConn = this.prevConnectorId ? g.connectors.get(this.prevConnectorId) : undefined;

    // ---- 1. inside a junction polygon? ---------------------------------------------------
    const candidates: Junction[] = [];
    const addJ = (id: string | undefined) => {
      if (!id) return;
      const j = g.junctions.get(id);
      if (j && !candidates.includes(j)) candidates.push(j);
    };
    addJ(prevConn?.junctionId);
    addJ(prevLane?.to);
    for (const j of g.junctionsWithin(p.pos, T.JUNCTION_SEARCH_M)) if (!candidates.includes(j)) candidates.push(j);
    let inside: Junction | undefined;
    for (const j of candidates) {
      if (g.insideJunction(p.pos, j)) {
        inside = j;
        break;
      }
    }

    // ---- 2. connector match -------------------------------------------------------------
    let conn: ConnectorMatch | undefined;
    if (inside) {
      let kept: ConnectorMatch | undefined;
      if (prevConn && prevConn.junctionId === inside.id) {
        const m = connectorMatchFrom(prevConn, p.pos, p.heading);
        if (m.distance <= T.CONNECTOR_MATCH_M && Math.abs(m.headingError) < CONNECTOR_MAX_HEADING) kept = m;
      }
      let best: ConnectorMatch | undefined;
      if (prevLane && prevLane.to === inside.id) best = g.nearestConnector(p.pos, { heading: p.heading, maxDist: T.CONNECTOR_MATCH_M, junctionId: inside.id, fromLaneId: prevLane.id });
      if (!best && kept) best = g.nearestConnector(p.pos, { heading: p.heading, maxDist: T.CONNECTOR_MATCH_M, junctionId: inside.id, fromLaneId: kept.connector.fromLane });
      if (!best) best = g.nearestConnector(p.pos, { heading: p.heading, maxDist: T.CONNECTOR_MATCH_M, junctionId: inside.id });
      if (kept && best && best.connector !== kept.connector) {
        // stickiness: only switch when the alternative is clearly better
        conn = connectorScore(best) + T.CONNECTOR_SWITCH_MARGIN_M < connectorScore(kept) ? best : kept;
      } else conn = best ?? kept;
    }

    loc.insideJunction = !!inside;
    loc.junctionId = inside?.id;

    if (conn) {
      const c = conn.connector;
      const fromLane = g.lanes.get(c.fromLane);
      const toLane = g.lanes.get(c.toLane);
      loc.connectorId = c.id;
      loc.laneId = undefined;
      loc.roadId = undefined;
      loc.junctionId = c.junctionId;
      loc.s = conn.s;
      loc.lateral = conn.lateral;
      loc.headingError = conn.headingError;
      loc.distToLaneEnd = c.length - conn.s + (toLane?.length ?? 0);
      loc.nextJunctionId = c.junctionId;
      loc.speedLimit = fromLane?.maxSpeed ?? loc.speedLimit;
      this.wrongWayTimer = 0;
      loc.wrongWay = false;
      this.setKerb(false, dt, loc);
      this.prevConnectorId = c.id;
      // remember the connector's origin lane so that leaving the junction prefers its exit lane
      this.prevLaneId = c.fromLane;
      return;
    }

    // ---- 3. lane match ------------------------------------------------------------------
    const prefer = prevConn ? prevConn.toLane : prevLane?.id;
    let m = g.nearestLane(p.pos, { heading: p.heading, preferLaneId: prefer, maxDist: T.LANE_MAX_DIST_M });
    if (prevConn && m && m.lane.id !== prevConn.toLane) {
      // just left a junction: snap to the exit lane while physically on it
      const exit = g.lanes.get(prevConn.toLane);
      if (exit) {
        const em = laneMatchFrom(exit, p.pos, p.heading);
        if (em.distance <= T.STICKY_PREV_LANE_M && Math.abs(em.headingError) < Math.PI / 2 && m.distance >= T.SWITCH_LANE_MIN_M) m = em;
      }
    } else if (!prevConn && prevLane && m && m.lane.id !== prevLane.id && m.lane.roadId !== prevLane.roadId) {
      // a lane of another road only takes over when the car is physically on it or has left the old one
      const pm = laneMatchFrom(prevLane, p.pos, p.heading);
      if (pm.distance <= T.STICKY_PREV_LANE_M && m.distance >= T.SWITCH_LANE_MIN_M) m = pm;
    }

    loc.connectorId = undefined;
    this.prevConnectorId = undefined;
    if (!m) {
      loc.laneId = undefined;
      loc.roadId = undefined;
      loc.s = 0;
      loc.lateral = 0;
      loc.headingError = 0;
      loc.distToLaneEnd = Infinity;
      loc.nextJunctionId = undefined;
      loc.wrongWay = false;
      this.wrongWayTimer = 0;
      this.setKerb(false, dt, loc);
      this.prevLaneId = undefined;
      return;
    }
    const lane = m.lane;
    const road = g.roads.get(lane.roadId);
    loc.laneId = lane.id;
    loc.roadId = lane.roadId;
    loc.s = m.s;
    loc.lateral = m.lateral;
    loc.headingError = m.headingError;
    loc.distToLaneEnd = Math.max(0, lane.length - m.s);
    loc.nextJunctionId = lane.to;
    loc.speedLimit = lane.maxSpeed;
    this.prevLaneId = lane.id;

    // ---- 4. wrong way (1 s hysteresis) ----------------------------------------------------
    let wrong = false;
    if (road && p.speed > T.WRONG_WAY_MIN_SPEED_MPS) {
      if (Math.abs(m.headingError) > WRONG_WAY_HEADING) wrong = true;
      else if (!road.oneway && road.lanesBackward.length > 0) {
        const rl = roadLateral(road, p.pos);
        const forward = road.lanesForward.includes(lane.id);
        wrong = forward ? rl < -T.OPPOSITE_SIDE_M : rl > T.OPPOSITE_SIDE_M;
      }
    }
    this.wrongWayTimer = wrong ? this.wrongWayTimer + dt : 0;
    loc.wrongWay = wrong && this.wrongWayTimer >= T.WRONG_WAY_S;

    // ---- 5. on kerb (0.5 s hysteresis) ----------------------------------------------------
    let kerb = false;
    if (road && !inside) {
      const rl = roadLateral(road, p.pos);
      const e = carriagewayEdges(road);
      kerb = rl > e.right + T.KERB_BEYOND_M || rl < e.left - T.KERB_BEYOND_M;
    }
    this.setKerb(kerb, dt, loc);
  }

  private setKerb(cond: boolean, dt: number, loc: Localisation): void {
    if (cond) {
      this.kerbOnTimer += dt;
      this.kerbOffTimer = 0;
      if (this.kerbOnTimer >= T.KERB_S) this.kerb = true;
    } else {
      this.kerbOffTimer += dt;
      this.kerbOnTimer = 0;
      if (this.kerbOffTimer >= T.KERB_S) this.kerb = false;
    }
    loc.onKerb = this.kerb;
  }

  currentApproach(ctx: SimContext): ApproachInfo | undefined {
    return currentApproach(this.graph, ctx);
  }
  upcomingCrossings(ctx: SimContext, within: number): CrossingAhead[] {
    return upcomingCrossings(this.graph, ctx, within);
  }
  distanceToStopLine(ctx: SimContext): number | undefined {
    return distanceToStopLine(this.graph, ctx);
  }
}

/** Along-lane position of a point, extrapolated past the lane ends. */
export function laneAlong(lane: Lane, point: Vec2): number {
  return alongPolyline(lane.centre, point, lane.length).s;
}

/**
 * Junction + approach for the lane the player is on (or the origin lane of the connector it is on).
 * `distToStopLine` is measured along the lane from the front bumper; the builder places stop lines
 * exactly at lane ends, so the line is at s = lane.length (= connector s 0).
 */
export function currentApproach(graph: RoadGraph, ctx: SimContext): ApproachInfo | undefined {
  const loc = ctx.localisation;
  let laneId: string | undefined;
  let connector: Connector | undefined;
  if (loc.connectorId) {
    connector = graph.connectors.get(loc.connectorId);
    laneId = connector?.fromLane;
  } else laneId = loc.laneId;
  if (!laneId) return undefined;
  const ap = graph.approachOf(laneId);
  if (!ap) return undefined;
  const lane = graph.lane(laneId);
  const half = ctx.player.length / 2;
  let dist: number;
  if (connector) dist = -(loc.s + half);
  else dist = lane.length - laneAlong(lane, frontBumper(ctx.player));
  return { junction: ap.junction, approach: ap.approach, laneId, lane, distToStopLine: dist, stopLine: ap.approach.stopLine, onConnector: !!connector, connector };
}

export function distanceToStopLine(graph: RoadGraph, ctx: SimContext): number | undefined {
  return currentApproach(graph, ctx)?.distToStopLine;
}

/** Crossings ahead of the front bumper within `within` m, nearest first. */
export function upcomingCrossings(graph: RoadGraph, ctx: SimContext, within: number): CrossingAhead[] {
  const loc = ctx.localisation;
  const front = frontBumper(ctx.player);
  const out: CrossingAhead[] = [];
  const seen = new Set<string>();
  const push = (c: Crossing, distanceToLine: number, onConnector: boolean) => {
    if (seen.has(c.id)) return;
    const distance = distanceToLine - c.width / 2;
    if (distanceToLine < -c.width / 2 || distance > within) return;
    seen.add(c.id);
    out.push({ crossing: c, distance, distanceToLine, onConnector });
  };
  if (loc.connectorId) {
    const conn = graph.connectors.get(loc.connectorId);
    if (conn) {
      const sFront = alongPolyline(conn.path, front, conn.length).s;
      for (const cid of conn.crossings) {
        const c = graph.crossings.get(cid);
        if (!c) continue;
        const s = alongPolyline(conn.path, midpoint(c.line[0], c.line[1]), conn.length).s;
        push(c, s - sFront, true);
      }
      const exit = graph.lanes.get(conn.toLane);
      if (exit) {
        const rest = conn.length - sFront;
        for (const c of graph.crossingsByLane.get(exit.id) ?? []) {
          const s = laneAlong(exit, midpoint(c.line[0], c.line[1]));
          if (s < 0) continue; // the junction's own crossing, already counted via the connector
          push(c, rest + s, false);
        }
      }
    }
  } else if (loc.laneId) {
    const lane = graph.lanes.get(loc.laneId);
    if (lane) {
      const sFront = laneAlong(lane, front);
      for (const c of graph.crossingsByLane.get(lane.id) ?? []) {
        const s = laneAlong(lane, midpoint(c.line[0], c.line[1]));
        push(c, s - sFront, false);
      }
    }
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}
