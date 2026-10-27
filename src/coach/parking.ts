/**
 * Kerb-stop / parking assessment.
 *
 * The rules module owns the authoritative parking detector; the examiner and the lesson
 * runner accept it through `setParkingReporter`. When none is wired (tests, early
 * integration) `estimateParking` derives a report from the localisation and the graph:
 * kerb markings (parking strips / road kerb), 12 m junction rule, crossings, no-stopping
 * signs (432/433/434), sidewalk, and the kerb distance / angle from the lane geometry.
 *
 * `kerbLegality` is the pure legality check at a lane position; the examiner samples it
 * along the route to find places for "עצור בצד" and parallel parking.
 */
import type { SimContext } from '@/core/sim';
import { dist2, projectOntoPolyline, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { KerbMarking, Lane, ParkingStrip } from '@/world/schema';
import type { LineTable } from './lines';
import type { ParkingReport, ParkingReporter } from './types';

const NO_PARKING_SIGNS = new Set(['432', '433', '434']);
const ILLEGAL_KERBS = new Set<KerbMarking>(['red_white', 'red_yellow', 'disabled', 'loading']);

export interface KerbLegality {
  legal: boolean;
  /** Line keys (parking.reason.*) — resolved to Hebrew by the caller. */
  reasonKeys: string[];
  kerb: KerbMarking;
  strip?: ParkingStrip;
  /** Road-side of the travel-right kerb ('right' for forward lanes). */
  roadSide: 'right' | 'left';
  roadS: number;
}

/** Legality of stopping at the kerb from `lane` at arc-length `s` (position `pos`, which defaults to the lane centre). */
export function kerbLegality(graph: RoadGraph, lane: Lane, s: number, pos?: Vec2, opts: { onKerb?: boolean; carLength?: number } = {}): KerbLegality {
  const road = graph.road(lane.roadId);
  const p = pos ?? graph.laneAt(lane.id, s).p;
  const reasonKeys: string[] = [];
  if (lane.rightLine !== 'kerb') reasonKeys.push('parking.reason.not_kerb_lane');
  if (opts.onKerb) reasonKeys.push('parking.reason.sidewalk');
  const forward = road.lanesForward.includes(lane.id);
  const roadSide: 'right' | 'left' = forward ? 'right' : 'left';
  let kerb: KerbMarking = forward ? road.kerbRight : road.kerbLeft;
  let strip: ParkingStrip | undefined;
  const roadS = projectOntoPolyline(road.centre, p).s;
  for (const st of graph.parkingByRoad.get(road.id) ?? []) {
    if (st.side !== roadSide || roadS < st.s0 || roadS > st.s1) continue;
    kerb = st.kerb;
    strip = st;
  }
  if (ILLEGAL_KERBS.has(kerb)) reasonKeys.push(`parking.reason.${kerb}`);
  const fromJ = graph.junctions.get(lane.from);
  const toJ = graph.junctions.get(lane.to);
  const real = (k: string | undefined) => k === 'junction' || k === 'roundabout';
  const distToEnd = lane.length - s;
  if ((s < 10 && real(fromJ?.kind)) || (distToEnd < 10 && real(toJ?.kind))) reasonKeys.push('parking.reason.junction');
  const carLength = opts.carLength ?? 4.4;
  for (const c of graph.crossingsByLane.get(lane.id) ?? []) {
    const mid: Vec2 = [(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2];
    const rel = projectOntoPolyline(lane.centre, mid).s - s;
    if (rel > -c.width - carLength / 2 && rel < 12) {
      reasonKeys.push('parking.reason.crossing');
      break;
    }
  }
  for (const sign of graph.signsByLane.get(lane.id) ?? []) {
    if (!NO_PARKING_SIGNS.has(sign.code)) continue;
    if (s >= projectOntoPolyline(lane.centre, sign.pos).s - 1) {
      reasonKeys.push('parking.reason.sign');
      break;
    }
  }
  return { legal: reasonKeys.length === 0, reasonKeys: [...new Set(reasonKeys)], kerb, strip, roadSide, roadS };
}

/** Contiguous legal kerb stretches [s0, s1] along a lane, sampled every `step` metres. */
export function legalKerbStretches(graph: RoadGraph, laneId: string, step = 5): { s0: number; s1: number }[] {
  const lane = graph.lane(laneId);
  const out: { s0: number; s1: number }[] = [];
  let cur: { s0: number; s1: number } | undefined;
  for (let s = 0; s <= lane.length; s += step) {
    const ok = kerbLegality(graph, lane, s).legal;
    if (ok) {
      if (!cur) cur = { s0: s, s1: s };
      else cur.s1 = s;
    } else if (cur) {
      out.push(cur);
      cur = undefined;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function estimateParking(ctx: SimContext, graph: RoadGraph, lines: LineTable, stopped: boolean, stoppedFor: number): ParkingReport {
  const loc = ctx.localisation;
  const p = ctx.player;
  const parked = stopped && stoppedFor >= 1 && (p.gear === 'P' || p.handbrake);
  if (loc.insideJunction || !loc.laneId || !graph.lanes.has(loc.laneId)) {
    const reasons = [lines.line(loc.insideJunction ? 'parking.reason.in_junction' : 'parking.reason.unknown')];
    return { stopped, stoppedFor, parked, legal: false, reasons, laneId: loc.laneId };
  }
  const lane = graph.lane(loc.laneId);
  const leg = kerbLegality(graph, lane, loc.s, p.pos, { onKerb: loc.onKerb, carLength: p.length });
  let bayId: string | undefined;
  leg.strip?.bays.forEach((b, i) => {
    if (dist2(b.pos, p.pos) < 2.5) bayId = `${leg.strip!.id}:${i}`;
  });
  const kerbLane = lane.rightLine === 'kerb';
  const kerbDistance = kerbLane ? Math.max(0, lane.width / 2 - loc.lateral - p.width / 2) : undefined;
  const angleDeg = (Math.abs(loc.headingError) * 180) / Math.PI;
  return { stopped, stoppedFor, parked, kerbDistance, angleDeg, legal: leg.legal, reasons: leg.reasonKeys.map((k) => lines.line(k)), bayId, laneId: lane.id };
}

/** Tracks how long the car has been stationary and produces the current ParkingReport. */
export class ParkingMonitor {
  private stoppedSince?: number;
  private reporter?: ParkingReporter;
  private last?: ParkingReport;

  constructor(
    private readonly graph: RoadGraph,
    private readonly lines: LineTable,
    reporter?: ParkingReporter,
  ) {
    this.reporter = reporter;
  }

  setReporter(fn: ParkingReporter | undefined): void {
    this.reporter = fn;
  }

  get report(): ParkingReport | undefined {
    return this.last;
  }

  update(ctx: SimContext): ParkingReport {
    const stopped = Math.abs(ctx.player.speed) < 0.15;
    if (stopped) {
      if (this.stoppedSince === undefined) this.stoppedSince = ctx.time;
    } else this.stoppedSince = undefined;
    const stoppedFor = stopped && this.stoppedSince !== undefined ? ctx.time - this.stoppedSince : 0;
    let report: ParkingReport | undefined;
    if (this.reporter) {
      const r = this.reporter(ctx);
      if (r) report = { ...r, stopped: r.stopped ?? stopped, stoppedFor: r.stoppedFor || stoppedFor, reasons: r.reasons ?? [] };
    }
    if (!report) report = estimateParking(ctx, this.graph, this.lines, stopped, stoppedFor);
    this.last = report;
    return report;
  }
}
