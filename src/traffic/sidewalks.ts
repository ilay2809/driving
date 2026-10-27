/**
 * SidewalkNetwork — a walkable graph for pedestrians derived from the road network:
 *   • one sidewalk polyline per road side (road centre offset by width/2 + 1.2 m),
 *   • nodes at junction corners and at the sidewalk ends of every crossing,
 *   • "corner" edges joining the sidewalks of adjacent arms around a junction,
 *   • "crossing" edges across the carriageway: [sidewalk node, kerb, far kerb, far node],
 *     with the kerb stand points 0.5 m from the carriageway edge.
 * Pure TypeScript, built once per world.
 */
import { slicePolyline } from '@/world/builder';
import { angleDiff, dist2, headingOf, offsetPolyline, polylineLength, projectOntoPolyline, wrapAngle, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Road, WorldFile } from '@/world/schema';
import { PED } from './constants';
import { clamp } from './util';

export type Side = 'L' | 'R';

export interface PedNode {
  id: number;
  pos: Vec2;
  edges: PedEdge[];
}

export interface PedEdge {
  id: number;
  a: PedNode;
  b: PedNode;
  pts: Vec2[];
  /** Cumulative arc-length per point. */
  cum: number[];
  length: number;
  kind: 'sidewalk' | 'corner' | 'crossing';
  roadId?: string;
  side?: Side;
  /** Arc-length range along the road centre covered by a sidewalk edge. */
  s0?: number;
  s1?: number;
  crossing?: {
    id: string;
    /** Arc-lengths along `pts` (from a) where the kerb stand points are. */
    sA: number;
    sB: number;
  };
}

export class SidewalkNetwork {
  readonly nodes: PedNode[] = [];
  readonly edges: PedEdge[] = [];
  readonly sidewalkEdges: PedEdge[] = [];
  /** Cumulative lengths of `sidewalkEdges` for weighted random picks. */
  private sidewalkCum: number[] = [];
  /** `${roadId}:${side}` → sidewalk edges sorted by s0. */
  readonly byRoadSide = new Map<string, PedEdge[]>();
  /** crossingId → crossing edge (a = left-side node, b = right-side node, relative to the road's forward direction). */
  readonly crossingEdges = new Map<string, PedEdge>();
  readonly sidePolylines = new Map<string, Vec2[]>();

  constructor(
    readonly world: WorldFile,
    readonly graph: RoadGraph,
  ) {
    this.build();
  }

  private newNode(pos: Vec2): PedNode {
    const n: PedNode = { id: this.nodes.length, pos, edges: [] };
    this.nodes.push(n);
    return n;
  }

  private newEdge(a: PedNode, b: PedNode, pts: Vec2[], kind: PedEdge['kind'], extra: Partial<PedEdge> = {}): PedEdge | undefined {
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist2(pts[i - 1]!, pts[i]!));
    const length = cum[cum.length - 1]!;
    if (length < 0.05) return undefined;
    const e: PedEdge = { id: this.edges.length, a, b, pts, cum, length, kind, ...extra };
    this.edges.push(e);
    a.edges.push(e);
    b.edges.push(e);
    return e;
  }

  private build(): void {
    const corners = new Map<string, { road: Road; end: 'from' | 'to'; nodes: PedNode[]; outward: number }[]>();
    // roundabout rings: the inner side is the island — not walkable
    const ringRoads = new Set<string>();
    for (const j of this.world.junctions) for (const id of j.roundabout?.ringLaneIds ?? []) ringRoads.add(this.graph.lane(id).roadId);
    for (const road of this.world.roads) {
      const fwd = road.lanesForward[0] ? this.graph.lane(road.lanesForward[0]) : undefined;
      if (!fwd) continue;
      const centreLen = road.length;
      const sFrom = projectOntoPolyline(road.centre, fwd.centre[0]!).s;
      const sTo = projectOntoPolyline(road.centre, fwd.centre[fwd.centre.length - 1]!).s;
      const sides: { side: Side; pts: Vec2[] }[] = [];
      if (road.sidewalkLeft && !ringRoads.has(road.id)) sides.push({ side: 'L', pts: offsetPolyline(road.centre, -(road.width / 2 + PED.sidewalkOffset)) });
      if (road.sidewalkRight) sides.push({ side: 'R', pts: offsetPolyline(road.centre, road.width / 2 + PED.sidewalkOffset) });
      const crossings = this.world.crossings.filter((c) => c.roadId === road.id);
      const crossingNodes = new Map<string, Partial<Record<Side, PedNode>>>();
      for (const { side, pts } of sides) {
        this.sidePolylines.set(`${road.id}:${side}`, pts);
        const sideLen = polylineLength(pts);
        const scale = centreLen > 0 ? sideLen / centreLen : 1;
        const stops: { s: number; node: PedNode; crossingId?: string }[] = [];
        const at = (s: number): Vec2 => {
          const r = this.pointAlongPts(pts, clamp(s * scale, 0, sideLen));
          return r;
        };
        const nFrom = this.newNode(at(sFrom));
        const nTo = this.newNode(at(sTo));
        stops.push({ s: sFrom, node: nFrom }, { s: sTo, node: nTo });
        for (const c of crossings) {
          const mid: Vec2 = [(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2];
          const s = projectOntoPolyline(road.centre, mid).s;
          const node = this.newNode(at(s));
          stops.push({ s, node, crossingId: c.id });
          const rec = crossingNodes.get(c.id) ?? {};
          rec[side] = node;
          crossingNodes.set(c.id, rec);
        }
        stops.sort((p, q) => p.s - q.s);
        const list: PedEdge[] = [];
        for (let i = 1; i < stops.length; i++) {
          const p = stops[i - 1]!;
          const q = stops[i]!;
          if (q.s - p.s < 0.2) {
            // merge coincident nodes (crossing right at a corner): reuse the earlier node
            this.mergeNode(q.node, p.node);
            q.node = p.node;
            continue;
          }
          const seg = slicePolyline(pts, p.s * scale, q.s * scale);
          const e = this.newEdge(p.node, q.node, seg, 'sidewalk', { roadId: road.id, side, s0: p.s, s1: q.s });
          if (e) list.push(e);
        }
        this.byRoadSide.set(`${road.id}:${side}`, list);
        const endFrom = stops[0]!.node;
        const endTo = stops[stops.length - 1]!.node;
        const hFrom = headingOf(road.centre[0]!, this.pointAlongPts(road.centre, Math.min(5, centreLen)));
        const hTo = headingOf(this.pointAlongPts(road.centre, Math.max(0, centreLen - 5)), road.centre[road.centre.length - 1]!);
        const addCorner = (nodeId: string, end: 'from' | 'to', node: PedNode, outward: number) => {
          const list2 = corners.get(nodeId) ?? [];
          let rec = list2.find((r) => r.road === road && r.end === end);
          if (!rec) {
            rec = { road, end, nodes: [], outward };
            list2.push(rec);
          }
          rec.nodes.push(node);
          corners.set(nodeId, list2);
        };
        addCorner(road.from, 'from', endFrom, hFrom);
        addCorner(road.to, 'to', endTo, hTo + Math.PI);
      }
      // crossing edges
      for (const c of crossings) {
        const rec = crossingNodes.get(c.id);
        if (!rec?.L || !rec?.R) continue;
        const mid: Vec2 = [(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2];
        const kerb = (end: Vec2): Vec2 => {
          const d = dist2(end, mid);
          const ux = d > 0 ? (end[0] - mid[0]) / d : 0;
          const uz = d > 0 ? (end[1] - mid[1]) / d : 0;
          // the crossing line ends 0.3 m beyond the carriageway edge; stand 0.5 m from the edge
          const extra = PED.kerbStand - 0.3;
          return [end[0] + ux * extra, end[1] + uz * extra];
        };
        const kA = kerb(c.line[0]);
        const kB = kerb(c.line[1]);
        const pts: Vec2[] = [rec.L.pos, kA, kB, rec.R.pos];
        const sA = dist2(rec.L.pos, kA);
        const sB = sA + dist2(kA, kB);
        const e = this.newEdge(rec.L, rec.R, pts, 'crossing', { roadId: road.id, crossing: { id: c.id, sA, sB } });
        if (e) this.crossingEdges.set(c.id, e);
      }
    }
    // junction corners
    for (const [junctionId, arms] of corners) {
      if (arms.length === 0) continue;
      if (arms.length === 1) {
        const a = arms[0]!;
        if (a.nodes.length === 2) this.newEdge(a.nodes[0]!, a.nodes[1]!, [a.nodes[0]!.pos, a.nodes[1]!.pos], 'corner');
        continue;
      }
      // Arms sorted by outward angle; consecutive arms share the block corner in the sector
      // between them: the counter-clockwise (increasing angle) corner of the first arm and the
      // clockwise corner of the second. Two-arm nodes connect both sides.
      for (const a of arms) a.outward = wrapAngle(a.outward);
      arms.sort((p, q) => p.outward - q.outward);
      const centre = this.graph.junctions.get(junctionId)?.position;
      const sideOf = (arm: (typeof arms)[number], ccw: boolean): PedNode | undefined => {
        if (!centre) return arm.nodes[0];
        let best: PedNode | undefined;
        let bestA = -Infinity;
        for (const n of arm.nodes) {
          const dir = headingOf(centre, n.pos);
          const a = angleDiff(arm.outward, dir) * (ccw ? 1 : -1);
          if (a > bestA) {
            bestA = a;
            best = n;
          }
        }
        return best;
      };
      for (let i = 0; i < arms.length; i++) {
        const j = (i + 1) % arms.length;
        if (i === j) continue;
        const x = sideOf(arms[i]!, true);
        const y = sideOf(arms[j]!, false);
        if (!x || !y || x === y) continue;
        const d = dist2(x.pos, y.pos);
        if (d > 60) continue;
        if (d < 0.2) this.mergeNode(y, x);
        else if (!x.edges.some((e) => (e.a === x && e.b === y) || (e.a === y && e.b === x))) this.newEdge(x, y, [x.pos, y.pos], 'corner');
      }
    }
    for (const e of this.edges) if (e.kind === 'sidewalk') this.sidewalkEdges.push(e);
    let acc = 0;
    for (const e of this.sidewalkEdges) {
      acc += e.length;
      this.sidewalkCum.push(acc);
    }
  }

  /** Re-point the edges of `from` to `into` (node merge). */
  private mergeNode(from: PedNode, into: PedNode): void {
    if (from === into) return;
    for (const e of from.edges) {
      if (e.a === from) e.a = into;
      if (e.b === from) e.b = into;
      if (!into.edges.includes(e)) into.edges.push(e);
    }
    from.edges = [];
  }

  private pointAlongPts(pts: Vec2[], s: number): Vec2 {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const L = dist2(a, b);
      if (s <= acc + L || i === pts.length - 1) {
        const t = L > 0 ? clamp((s - acc) / L, 0, 1) : 0;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      acc += L;
    }
    return pts[pts.length - 1]!;
  }

  /** Point and heading at arc-length t (from a) along an edge. */
  at(edge: PedEdge, t: number): { p: Vec2; h: number } {
    const tt = clamp(t, 0, edge.length);
    const cum = edge.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < tt) i++;
    const a = edge.pts[i - 1]!;
    const b = edge.pts[i]!;
    const L = cum[i]! - cum[i - 1]!;
    const u = L > 0 ? (tt - cum[i - 1]!) / L : 0;
    return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], h: headingOf(a, b) };
  }

  /** Length-weighted random point on a sidewalk edge. */
  randomSidewalkPoint(rng: () => number): { edge: PedEdge; t: number } | undefined {
    const total = this.sidewalkCum[this.sidewalkCum.length - 1];
    if (!total) return undefined;
    const x = rng() * total;
    let lo = 0;
    let hi = this.sidewalkCum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sidewalkCum[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    const edge = this.sidewalkEdges[lo]!;
    return { edge, t: rng() * edge.length };
  }

  /** Nearest edge (any kind) to a point. */
  nearestEdge(pos: Vec2, maxDist = 20): { edge: PedEdge; t: number; dist: number } | undefined {
    let best: { edge: PedEdge; t: number; dist: number } | undefined;
    for (const e of this.edges) {
      if (dist2(e.a.pos, pos) > maxDist + e.length && dist2(e.b.pos, pos) > maxDist + e.length) continue;
      const pr = projectOntoPolyline(e.pts, pos);
      if (pr.distance <= maxDist && (!best || pr.distance < best.dist)) best = { edge: e, t: pr.s, dist: pr.distance };
    }
    return best;
  }

  /** Sidewalk edge of the opposite side of a road covering arc-length s (for jaywalking). */
  oppositeSidewalk(roadId: string, side: Side, s: number): { edge: PedEdge; t: number } | undefined {
    const list = this.byRoadSide.get(`${roadId}:${side === 'L' ? 'R' : 'L'}`);
    if (!list) return undefined;
    for (const e of list) {
      if (s >= e.s0! && s <= e.s1!) {
        const frac = e.s1! > e.s0! ? (s - e.s0!) / (e.s1! - e.s0!) : 0;
        return { edge: e, t: frac * e.length };
      }
    }
    return undefined;
  }

  /** Signed angle helper exposed for consumers that orient pedestrians at the kerb. */
  static facing(from: Vec2, to: Vec2): number {
    return headingOf(from, to);
  }

  static turn(a: number, b: number): number {
    return angleDiff(a, b);
  }
}
