/**
 * RouteModel — geometry of a PathResult: the ordered lane / connector segments with
 * cumulative distances, point lookup along the route and map-matching of a
 * Localisation onto the route. Shared by the navigator (instructions), the examiner
 * (manoeuvre placement) and the tests (auto-driver).
 *
 * `RoadGraph.findPath` may put two sibling lanes next to each other without a
 * connector (a lane change). Such lanes overlap: the second starts where the first
 * starts, so distances stay monotonic along the direction of travel.
 */
import { dist2, headingOf, pointAlong, type Vec2 } from '@/world/geo';
import type { Localisation } from '@/core/types';
import type { PathResult, RoadGraph } from '@/world/graph';

export interface RouteSegment {
  kind: 'lane' | 'connector';
  id: string;
  /** Distance along the route at which the segment starts (m). */
  start: number;
  length: number;
  pts: Vec2[];
  /** Index in `segments`. */
  index: number;
}

export interface RouteLocation {
  index: number;
  /** Distance along the route (m). */
  dist: number;
  /** True when the segment itself is part of the route (false: inferred from a neighbouring connector). */
  exact: boolean;
}

export class RouteModel {
  readonly segments: RouteSegment[] = [];
  readonly length: number;
  /** Lane id the route ends on. */
  readonly destinationLaneId: string;
  /** Arc-length on the last lane where the route ends (lane end when unset). */
  readonly endS: number | undefined;

  constructor(
    readonly graph: RoadGraph,
    readonly path: PathResult,
    opts: { endS?: number } = {},
  ) {
    const lanes = path.laneIds;
    if (lanes.length === 0) throw new Error('empty path');
    let ci = 0;
    let prevLane: RouteSegment | undefined;
    let cursor = 0;
    for (let i = 0; i < lanes.length; i++) {
      const laneId = lanes[i]!;
      const lane = graph.lane(laneId);
      let start = cursor;
      if (prevLane) {
        const cid = path.connectorIds[ci];
        const conn = cid ? graph.connectors.get(cid) : undefined;
        if (conn && conn.fromLane === prevLane.id && conn.toLane === laneId) {
          ci++;
          const seg: RouteSegment = { kind: 'connector', id: conn.id, start: prevLane.start + prevLane.length, length: conn.length, pts: conn.path, index: this.segments.length };
          this.segments.push(seg);
          start = seg.start + seg.length;
        } else {
          // lane change: siblings overlap
          start = prevLane.start;
        }
      }
      let pts = lane.centre;
      let length = lane.length;
      if (i === lanes.length - 1 && opts.endS !== undefined && opts.endS < lane.length) {
        length = Math.max(0.5, opts.endS);
        pts = truncate(lane.centre, length);
      }
      const seg: RouteSegment = { kind: 'lane', id: laneId, start, length, pts, index: this.segments.length };
      this.segments.push(seg);
      prevLane = seg;
      cursor = start + length;
    }
    this.length = cursor;
    this.destinationLaneId = lanes[lanes.length - 1]!;
    this.endS = opts.endS;
  }

  /** End point and heading of the route. */
  get end(): { p: Vec2; h: number } {
    const last = this.segments[this.segments.length - 1]!;
    const pts = last.pts;
    const p = pts[pts.length - 1]!;
    const q = pts[Math.max(0, pts.length - 2)]!;
    return { p, h: headingOf(q, p) };
  }

  get start(): { p: Vec2; h: number } {
    const first = this.segments[0]!;
    return { p: first.pts[0]!, h: headingOf(first.pts[0]!, first.pts[1]!) };
  }

  /** Segment index for a lane / connector id, preferring the occurrence at or after `hint`. */
  indexOf(kind: 'lane' | 'connector', id: string, hint = 0): number {
    let best = -1;
    for (const s of this.segments) {
      if (s.kind !== kind || s.id !== id) continue;
      if (s.index >= hint) return s.index;
      best = s.index;
    }
    return best;
  }

  /** Position / heading at route distance d (clamped). After a lane change the later sibling is used. */
  pointAt(d: number): { p: Vec2; h: number; segment: RouteSegment } {
    d = Math.max(0, Math.min(this.length, d));
    let seg = this.segments[0]!;
    for (const s of this.segments) if (s.start <= d) seg = s;
    const r = pointAlong(seg.pts, d - seg.start);
    return { p: r.p, h: r.h, segment: seg };
  }

  /**
   * Map a Localisation onto the route. A connector that is not on the route but whose
   * from-lane is (the player just left a route lane into a junction) counts as the end
   * of that lane; one whose to-lane is the route start counts as "before the start".
   */
  locate(loc: Localisation, hint = 0): RouteLocation | undefined {
    if (loc.connectorId) {
      const i = this.indexOf('connector', loc.connectorId, hint);
      if (i >= 0) {
        const s = this.segments[i]!;
        return { index: i, dist: s.start + Math.min(loc.s, s.length), exact: true };
      }
    }
    if (loc.laneId) {
      const i = this.indexOf('lane', loc.laneId, hint);
      if (i >= 0) {
        const s = this.segments[i]!;
        return { index: i, dist: s.start + Math.min(Math.max(0, loc.s), s.length), exact: true };
      }
    }
    if (loc.connectorId) {
      const conn = this.graph.connectors.get(loc.connectorId);
      if (conn) {
        const k = this.indexOf('lane', conn.fromLane, hint);
        if (k >= 0) {
          const s = this.segments[k]!;
          return { index: k, dist: s.start + s.length, exact: false };
        }
        const first = this.segments[0]!;
        if (first.kind === 'lane' && first.id === conn.toLane) return { index: 0, dist: -(conn.length - loc.s), exact: false };
      }
    }
    return undefined;
  }

  /** Connector segments after (and excluding) segment index `from`. */
  connectorsAfter(from: number): RouteSegment[] {
    return this.segments.filter((s) => s.kind === 'connector' && s.index > from);
  }

  laneSegments(): RouteSegment[] {
    return this.segments.filter((s) => s.kind === 'lane');
  }

  /** Euclidean distance from a point to the route end. */
  distanceToEnd(p: Vec2): number {
    return dist2(p, this.end.p);
  }
}

function truncate(pts: Vec2[], length: number): Vec2[] {
  const out: Vec2[] = [pts[0]!];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = dist2(pts[i - 1]!, pts[i]!);
    if (acc + L >= length) {
      out.push(pointAlong(pts, length).p);
      return out;
    }
    acc += L;
    out.push(pts[i]!);
  }
  return out;
}
