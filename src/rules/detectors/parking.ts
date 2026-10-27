/**
 * Stopping and parking (תקנה 72). After 3 s standing still: on a pedestrian crossing or at a
 * bus stop → ILLEGAL_STOP. Once parked (P, or handbrake with the engine off): kerb marking of
 * the parking strip at this spot, distance from junctions (12 m) and crossings (12 m before),
 * bus stops, parking against the traffic direction → ILLEGAL_PARKING; otherwise the quality
 * checks: ≤ 0.4 m from the kerb, parallel within 8° → GOOD_PARKING.
 * `parkingReport()` exposes the same assessment for lessons and the examiner.
 */
import type { SimContext } from '@/core/sim';
import { dist2, projectOntoPolyline } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Crossing, KerbMarking, ParkingStrip, Prop, WorldFile } from '@/world/schema';
import type { Detector, JudgeApi } from '../api';
import { aheadOf, axisOf, carriagewayEdges, frontBumper, lateralOf, midpoint, radToDeg, rearBumper, roadLateral, segmentDistance, type Body } from '../geometry';
import { laneAlong } from '../localiser';
import { HE } from '../strings.he';
import { PARKING as T } from '../thresholds';

export interface ParkingReport {
  legal: boolean;
  /** Hebrew reasons why parking here is illegal (empty when legal). */
  reasons: string[];
  /** Distance from the car's side to the kerb it stands against (m). */
  kerbDistance: number;
  /** Angle between the car and the lane (degrees, signed). */
  angleDeg: number;
  /** Which side of the car faces the kerb. */
  side: 'left' | 'right';
  kerb: KerbMarking;
  strip?: ParkingStrip;
  laneId: string;
}

const busStopCache = new WeakMap<WorldFile, Prop[]>();

function busStops(world: WorldFile): Prop[] {
  let list = busStopCache.get(world);
  if (!list) {
    list = world.props.filter((p) => p.kind === 'bus_stop');
    busStopCache.set(world, list);
  }
  return list;
}

function isRealJunction(kind: string): boolean {
  return kind === 'junction' || kind === 'roundabout';
}

/** The car body overlaps the crossing band. */
export function carOnCrossing(body: Body, c: Crossing): boolean {
  const [a, b] = axisOf(body);
  return segmentDistance(a, b, c.line[0], c.line[1]) <= c.width / 2;
}

/** A bus stop within 12 m along the road on the side the car stands on. */
export function busStopNear(graph: RoadGraph, ctx: SimContext, laneId: string): Prop | undefined {
  const lane = graph.lanes.get(laneId);
  if (!lane) return undefined;
  const road = graph.road(lane.roadId);
  const p = ctx.player;
  const sibs = graph.siblingLanes(lane.id);
  const rightmost = lane.index === sibs.length - 1;
  const leftmost = lane.index === 0;
  for (const prop of busStops(ctx.world)) {
    if (dist2(prop.pos, p.pos) > T.BUS_STOP_M + 8) continue;
    const along = aheadOf(p, prop.pos);
    const lat = lateralOf(p, prop.pos);
    if (Math.abs(along) > T.BUS_STOP_M || Math.abs(lat) > 8) continue;
    const sameSide = lat > 0 ? rightmost : road.oneway && leftmost;
    if (sameSide) return prop;
  }
  return undefined;
}

export function parkingReport(graph: RoadGraph, ctx: SimContext): ParkingReport | undefined {
  const loc = ctx.localisation;
  if (!loc.laneId) return undefined;
  const lane = graph.lanes.get(loc.laneId);
  if (!lane) return undefined;
  const road = graph.road(lane.roadId);
  const p = ctx.player;
  const rl = roadLateral(road, p.pos);
  const e = carriagewayEdges(road);
  const fwd = road.lanesForward.includes(lane.id);
  const hw = p.width / 2;
  const rightDist = fwd ? e.right - (rl + hw) : rl - hw - e.left;
  const leftDist = fwd ? rl - hw - e.left : e.right - (rl + hw);
  const side: 'left' | 'right' = rightDist <= leftDist ? 'right' : 'left';
  const kerbDistance = side === 'right' ? rightDist : leftDist;
  const roadSide: 'left' | 'right' = (side === 'right') === fwd ? 'right' : 'left';
  const sRoad = projectOntoPolyline(road.centre, p.pos).s;
  const strip = (graph.parkingByRoad.get(road.id) ?? []).find((ps) => ps.side === roadSide && sRoad >= ps.s0 && sRoad <= ps.s1);
  const kerb: KerbMarking = strip?.kerb ?? (roadSide === 'right' ? road.kerbRight : road.kerbLeft);
  const reasons: string[] = [];
  const kerbReason = HE.kerb[kerb];
  if (kerbReason) reasons.push(kerbReason);
  if (side === 'left' && !road.oneway) reasons.push(HE.wrongSide);
  const front = laneAlong(lane, frontBumper(p));
  const rear = laneAlong(lane, rearBumper(p));
  const toJ = graph.junctions.get(lane.to);
  const fromJ = graph.junctions.get(lane.from);
  if ((toJ && isRealJunction(toJ.kind) && lane.length - front < T.JUNCTION_M) || (fromJ && isRealJunction(fromJ.kind) && rear < T.JUNCTION_M)) reasons.push(HE.nearJunction);
  for (const c of graph.crossingsByLane.get(lane.id) ?? []) {
    const sc = laneAlong(lane, midpoint(c.line[0], c.line[1]));
    const near = sc - c.width / 2;
    const far = sc + c.width / 2;
    if (front > near && rear < far) {
      reasons.push(HE.onCrossing);
      continue;
    }
    const gap = near - front;
    if (gap >= 0 && gap < T.CROSSING_M) reasons.push(HE.nearCrossing);
  }
  const busReason = HE.kerb.red_yellow!;
  if (!reasons.includes(busReason) && busStopNear(graph, ctx, lane.id)) reasons.push(busReason);
  return { legal: reasons.length === 0, reasons, kerbDistance, angleDeg: radToDeg(loc.headingError), side, kerb, strip, laneId: lane.id };
}

export class ParkingDetector implements Detector {
  readonly name = 'parking';
  private stopChecked = false;
  private parkingChecked = false;
  private checkedOdo = 0;

  reset(): void {
    this.stopChecked = false;
    this.parkingChecked = false;
    this.checkedOdo = 0;
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const p = ctx.player;
    if (api.stoppedFor >= T.STOPPED_S) {
      if (!this.stopChecked) {
        this.stopChecked = true;
        this.checkedOdo = api.odometer;
        this.checkIllegalStop(ctx, api);
      }
      const parkedState = p.gear === 'P' || (p.handbrake && !p.engineOn);
      if (parkedState && !this.parkingChecked) {
        this.parkingChecked = true;
        this.checkedOdo = api.odometer;
        this.evaluateParking(ctx, api);
      }
    } else if (api.odometer - this.checkedOdo > T.REARM_MOVE_M) {
      this.stopChecked = false;
      this.parkingChecked = false;
    }
  }

  private checkIllegalStop(ctx: SimContext, api: JudgeApi): void {
    const loc = ctx.localisation;
    if (loc.insideJunction || loc.connectorId || !loc.laneId) return;
    const g = api.graph;
    const p = ctx.player;
    const ap = api.approach();
    for (const c of g.crossingsWithin(p.pos, 12)) {
      // waiting at a controlled line that has a crossing just past it: the stop-line overrun rule applies
      if (ap && c.junctionId === ap.junction.id && ap.distToStopLine < 8 && ap.approach.control !== 'priority' && ap.approach.control !== 'none') continue;
      if (carOnCrossing(p, c)) {
        api.report('ILLEGAL_STOP', { context: HE.onCrossing, details: { crossing: c.id } });
        return;
      }
    }
    const stop = busStopNear(g, ctx, loc.laneId);
    if (stop) api.report('ILLEGAL_STOP', { context: HE.atBusStop, details: { busStop: stop.name ?? '' } });
  }

  private evaluateParking(ctx: SimContext, api: JudgeApi): void {
    const rep = parkingReport(api.graph, ctx);
    if (!rep) return;
    const details = { kerbDistance: Math.round(rep.kerbDistance * 100) / 100, angleDeg: Math.round(rep.angleDeg * 10) / 10, side: rep.side, kerb: rep.kerb };
    if (!rep.legal) api.report('ILLEGAL_PARKING', { context: rep.reasons[0], details: { ...details, reasons: rep.reasons.join('; ') } });
    else if (rep.kerbDistance > T.KERB_MAX_M) api.report('PARKING_TOO_FAR', { details });
    else if (Math.abs(rep.angleDeg) > T.ANGLE_MAX_DEG) api.report('PARKING_ANGLE', { details });
    else api.report('GOOD_PARKING', { details });
  }
}
