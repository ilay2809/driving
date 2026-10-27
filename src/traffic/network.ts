/**
 * TrafficNetwork — cached, traffic-oriented view over the RoadGraph:
 *   • `Seg` = a lane or a connector as a drivable segment (polyline, length, speed cap);
 *   • crossings located along each segment (arc-length of the crossing line);
 *   • bus stops projected onto lanes;
 *   • upstream search (which segments feed into a connector, with distances);
 *   • lane sampling for the spawner.
 * Pure TypeScript, built once per world.
 */
import { angleDiff, headingOf, kmhToMps, pointAlong, projectOntoPolyline, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Connector, Crossing, Junction, Lane, Road, WorldFile } from '@/world/schema';
import { BUS } from './constants';
import { polylineCrossingS } from './util';

export interface SegCrossing {
  crossing: Crossing;
  /** Arc-length along the segment where the crossing line is crossed. */
  s: number;
}

export interface Seg {
  kind: 'lane' | 'connector';
  id: string;
  pts: Vec2[];
  length: number;
  /** Speed cap of the segment (m/s): legal limit for lanes, advisory speed for connectors. */
  vmax: number;
  lane?: Lane;
  conn?: Connector;
  crossings: SegCrossing[];
  /** Connectors: total heading change along the path (rad). */
  deflection: number;
  /** Connectors: a sharp turn in little space (long vehicles swing over neighbouring lanes here). */
  tight: boolean;
}

export interface Upstream {
  seg: Seg;
  /** Distance from the END of `seg` to the start of the queried segment. */
  offset: number;
}

export interface BusStopOnLane {
  laneId: string;
  /** Arc-length along the lane where the stop (prop) projects. */
  s: number;
  /** Lateral offset of the prop from the lane centre (positive = right). */
  lateral: number;
  name?: string;
}

/** Total absolute heading change along a path (rad). */
export function pathDeflection(path: Vec2[]): number {
  if (path.length < 3) return 0;
  let total = 0;
  let prev = headingOf(path[0]!, path[1]!);
  for (let i = 2; i < path.length; i++) {
    const h = headingOf(path[i - 1]!, path[i]!);
    total += Math.abs(angleDiff(prev, h));
    prev = h;
  }
  return total;
}

/** Speed cap (m/s) from the total heading change along a path: sharp bends are taken slowly even when the world calls them "straight". */
export function curvatureSpeedCap(path: Vec2[]): number {
  const deg = (pathDeflection(path) * 180) / Math.PI;
  if (deg < 20) return Infinity;
  if (deg < 50) return kmhToMps(30);
  return kmhToMps(20);
}

const EMPTY_IDS: readonly string[] = Object.freeze([]);

export class TrafficNetwork {
  private segs = new Map<string, Seg>();
  private upstreamCache = new Map<string, Upstream[]>();
  private crossingSegCache = new Map<string, { seg: Seg; s: number }[]>();
  /** connector id → connectors whose paths cross it (yieldTo in either direction). */
  private crossingConns = new Map<string, string[]>();
  /** laneId → bus stop on that lane (nearest lane on the prop's left, i.e. the prop on the lane's right). */
  readonly busStops = new Map<string, BusStopOnLane>();
  /** Lanes that have a bus stop or are bus lanes (roads where buses are plausible). */
  readonly busRoads = new Set<string>();
  readonly driveLanes: Lane[];
  /** Cumulative lengths of `driveLanes` (for length-weighted random picks). */
  readonly driveLaneCum: number[];
  readonly hasBusInfrastructure: boolean;

  constructor(
    readonly world: WorldFile,
    readonly graph: RoadGraph,
  ) {
    this.driveLanes = world.lanes.filter((l) => l.kind === 'drive');
    this.driveLaneCum = [];
    let acc = 0;
    for (const l of this.driveLanes) {
      acc += l.length;
      this.driveLaneCum.push(acc);
    }
    for (const p of world.props) {
      if (p.kind !== 'bus_stop') continue;
      // the lane whose right-hand side the prop is on (lateral > 0, within a few metres of the kerb);
      // a stop that only has a lane on its other side (single one-way lane) is served from that lane.
      let best: BusStopOnLane | undefined;
      let bestScore = Infinity;
      for (const lane of graph.lanesWithin(p.pos, 12)) {
        if (lane.kind !== 'drive' && lane.kind !== 'bus') continue;
        if (p.roadId && lane.roadId !== p.roadId) continue;
        const pr = projectOntoPolyline(lane.centre, p.pos);
        if (Math.abs(pr.lateral) > lane.width / 2 + BUS.stopSearchLateral) continue;
        if (pr.s < 8 || pr.s > lane.length - 8) continue;
        const score = pr.distance + (pr.lateral > 0 ? 0 : 20);
        if (score < bestScore) {
          bestScore = score;
          best = { laneId: lane.id, s: pr.s, lateral: pr.lateral, name: p.name };
        }
      }
      if (best) {
        this.busStops.set(best.laneId, best);
        this.busRoads.add(graph.lane(best.laneId).roadId);
      }
    }
    for (const l of world.lanes) if (l.kind === 'bus') this.busRoads.add(l.roadId);
    this.hasBusInfrastructure = this.busRoads.size > 0;
    for (const c of world.connectors) {
      for (const y of c.yieldTo) {
        const a = this.crossingConns.get(c.id) ?? [];
        if (!a.includes(y)) a.push(y);
        this.crossingConns.set(c.id, a);
        const b = this.crossingConns.get(y) ?? [];
        if (!b.includes(c.id)) b.push(c.id);
        this.crossingConns.set(y, b);
      }
    }
  }

  /** Connectors whose movement conflicts with `connectorId` (the symmetric closure of yieldTo). */
  crossingConnectors(connectorId: string): readonly string[] {
    return this.crossingConns.get(connectorId) ?? EMPTY_IDS;
  }

  seg(id: string): Seg {
    let s = this.segs.get(id);
    if (s) return s;
    const lane = this.graph.lanes.get(id);
    if (lane) {
      s = { kind: 'lane', id, pts: lane.centre, length: lane.length, vmax: kmhToMps(lane.maxSpeed), lane, crossings: [], deflection: 0, tight: false };
      for (const c of this.graph.crossingsByLane.get(id) ?? []) {
        const sc = polylineCrossingS(lane.centre, c.line[0], c.line[1]);
        if (sc !== undefined) s.crossings.push({ crossing: c, s: sc });
      }
    } else {
      const conn = this.graph.connector(id);
      const deflection = pathDeflection(conn.path);
      s = { kind: 'connector', id, pts: conn.path, length: conn.length, vmax: Math.min(kmhToMps(conn.maxSpeed), curvatureSpeedCap(conn.path)), conn, crossings: [], deflection, tight: deflection > Math.PI / 4 && conn.length < 9 };
      const seen = new Set<string>();
      for (const cid of conn.crossings) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        const c = this.graph.crossings.get(cid);
        if (!c) continue;
        const sc = polylineCrossingS(conn.path, c.line[0], c.line[1]);
        if (sc !== undefined) s.crossings.push({ crossing: c, s: sc });
      }
    }
    s.crossings.sort((a, b) => a.s - b.s);
    this.segs.set(id, s);
    return s;
  }

  laneSeg(lane: Lane): Seg {
    return this.seg(lane.id);
  }
  connSeg(conn: Connector): Seg {
    return this.seg(conn.id);
  }

  roadOfLane(laneId: string): Road {
    return this.graph.road(this.graph.lane(laneId).roadId);
  }

  approachOf(laneId: string): { junction: Junction; approach: Junction['approaches'][number] } | undefined {
    return this.graph.approachOf(laneId);
  }

  /** Point and heading at arc-length s along a segment (clamped). */
  at(seg: Seg, s: number): { p: Vec2; h: number } {
    const r = pointAlong(seg.pts, s);
    return { p: r.p, h: r.h };
  }

  /**
   * Segments that feed into `segId` (a connector's fromLane and, transitively, the connectors
   * and lanes before it) up to `reach` metres upstream of its start.
   */
  upstream(segId: string, reach: number): Upstream[] {
    const key = `${segId}|${reach}`;
    const cached = this.upstreamCache.get(key);
    if (cached) return cached;
    const out: Upstream[] = [];
    const seen = new Set<string>();
    const queue: { id: string; offset: number }[] = [];
    const start = this.seg(segId);
    const push = (id: string, offset: number) => {
      if (seen.has(id) || offset > reach) return;
      seen.add(id);
      queue.push({ id, offset });
    };
    if (start.kind === 'connector') push(start.conn!.fromLane, 0);
    else for (const cid of start.lane!.prev) push(cid, 0);
    while (queue.length > 0) {
      const { id, offset } = queue.shift()!;
      const seg = this.seg(id);
      out.push({ seg, offset });
      const nextOffset = offset + seg.length;
      if (seg.kind === 'connector') push(seg.conn!.fromLane, nextOffset);
      else for (const cid of seg.lane!.prev) push(cid, nextOffset);
    }
    this.upstreamCache.set(key, out);
    return out;
  }

  /** Segments (lanes and connectors) that pass over a crossing, with the arc-length of the crossing line. */
  segmentsCrossing(crossingId: string): { seg: Seg; s: number }[] {
    const cached = this.crossingSegCache.get(crossingId);
    if (cached) return cached;
    const out: { seg: Seg; s: number }[] = [];
    const cr = this.graph.crossings.get(crossingId);
    if (cr) {
      const ids = new Set<string>(cr.laneIds);
      for (const c of this.world.connectors) if (c.crossings.includes(crossingId)) ids.add(c.id);
      for (const id of ids) {
        if (!this.graph.lanes.has(id) && !this.graph.connectors.has(id)) continue;
        const seg = this.seg(id);
        const sc = seg.crossings.find((x) => x.crossing.id === crossingId);
        if (sc) out.push({ seg, s: sc.s });
      }
    }
    this.crossingSegCache.set(crossingId, out);
    return out;
  }

  /** Length-weighted random drive lane. */
  randomDriveLane(rng: () => number): Lane | undefined {
    const total = this.driveLaneCum[this.driveLaneCum.length - 1];
    if (!total) return undefined;
    const x = rng() * total;
    let lo = 0;
    let hi = this.driveLaneCum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.driveLaneCum[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return this.driveLanes[lo];
  }

  /** "Quiet street": narrow residential road where jaywalking is plausible. */
  isQuietRoad(road: Road): boolean {
    return (road.cls === 'residential' || road.cls === 'living_street' || road.cls === 'service' || road.cls === 'unclassified') && road.lanesForward.length + road.lanesBackward.length <= 2;
  }
}
