/**
 * Road-network topology: drivable OSM ways → roads between junction nodes.
 *
 *  1. keep drivable ways (see tags.ts), reverse oneway=-1 geometry
 *  2. junction nodes = way endpoints + nodes shared by ≥ 2 drivable ways (or used twice by one way)
 *  3. split ways at junction nodes
 *  4. snap junction nodes within `snapDist`, collapse fragments shorter than `minFragment`
 *  5. merge consecutive segments with identical attributes through degree-2 nodes
 *  6. simplify geometry (Douglas–Peucker), split closed loops so no road has from === to
 *
 * Road ids are `w<osmWayId>_<n>` (n = ordinal of the segment within the way), node ids `n<osmNodeId>`.
 */
import { dist2, polylineLength, type Projector, type Vec2 } from '@/world/geo';
import { bboxContains, dedupePoints, GridIndex, simplifyPolyline, type BBox } from '../geom';
import { attrsKey, reverseAttrs, wayAttrsOf, type UnknownCollector, type WayAttrs } from './attrs';
import type { SemNode, SemRoad } from './model';
import { semNodeId } from './model';
import type { OsmData } from './parse';

export interface NetworkOptions {
  snapDist: number;
  minFragment: number;
  simplifyTolerance: number;
  /** Roads without any point inside the area + this margin (m) are dropped. */
  clipMargin: number;
  /** Disconnected components with fewer roads than this are dropped (the largest is always kept). */
  minComponentRoads: number;
  /** Way ids removed before anything else (overrides.removeWays). */
  removeWays?: Set<number>;
  /** Extra geometric filter (e.g. "north of the river"); roads failing it are dropped before island pruning. */
  keepRoad?: (points: Vec2[]) => boolean;
}

export const DEFAULT_NETWORK_OPTIONS: NetworkOptions = { snapDist: 0.5, minFragment: 2, simplifyTolerance: 0.3, clipMargin: 30, minComponentRoads: 30 };

/** Union-find over string ids (node ids) for the island pruning. */
class UnionFindS {
  private parent = new Map<string, string>();
  find(x: string): string {
    let root = x;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    let cur = x;
    while (cur !== root) {
      const p = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = p;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

export interface NetworkResult {
  roads: SemRoad[];
  nodes: Map<string, SemNode>;
  nodeRep: Map<number, number>;
  interiorNodeRoad: Map<number, string>;
  stats: Record<string, number>;
}

interface Segment {
  id: string;
  wayIds: number[];
  nodeIds: number[];
  attrs: WayAttrs;
}

class UnionFind {
  private parent = new Map<number, number>();
  find(x: number): number {
    let root = x;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    // path compression
    let cur = x;
    while (cur !== root) {
      const p = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = p;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // the smaller id becomes the representative (deterministic)
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
  entries(): Map<number, number> {
    const out = new Map<number, number>();
    for (const k of this.parent.keys()) out.set(k, this.find(k));
    return out;
  }
}

export function buildNetwork(osm: OsmData, proj: Projector, area: BBox, unknown: UnknownCollector, options: Partial<NetworkOptions> = {}): NetworkResult {
  const opts = { ...DEFAULT_NETWORK_OPTIONS, ...options };
  const stats: Record<string, number> = {};
  const posCache = new Map<number, Vec2>();
  const pos = (id: number): Vec2 => {
    let p = posCache.get(id);
    if (!p) {
      const n = osm.nodes.get(id)!;
      p = proj.toWorld(n.lon, n.lat);
      posCache.set(id, p);
    }
    return p;
  };

  // ---- 1. drivable ways ------------------------------------------------------------
  interface DWay {
    id: number;
    nodes: number[];
    attrs: WayAttrs;
  }
  const ways: DWay[] = [];
  let excludedOutside = 0;
  let removed = 0;
  for (const w of osm.ways.values()) {
    if (!w.tags.highway) continue;
    if (opts.removeWays?.has(w.id)) {
      removed++;
      continue;
    }
    const parsed = wayAttrsOf(w.tags, unknown);
    if (!parsed) continue;
    let nodes = w.nodes.filter((id) => osm.nodes.has(id));
    if (nodes.length < 2) continue;
    if (!nodes.some((id) => bboxContains(area, pos(id)))) {
      excludedOutside++;
      continue;
    }
    if (parsed.reversed) nodes = nodes.slice().reverse();
    ways.push({ id: w.id, nodes, attrs: parsed.attrs });
  }
  stats.drivableWays = ways.length;
  stats.waysOutsideArea = excludedOutside;
  stats.waysRemovedByOverride = removed;

  // ---- 2. junction nodes ----------------------------------------------------------
  const usage = new Map<number, number>();
  for (const w of ways) for (const id of w.nodes) usage.set(id, (usage.get(id) ?? 0) + 1);
  const isJunction = new Set<number>();
  for (const w of ways) {
    isJunction.add(w.nodes[0]!);
    isJunction.add(w.nodes[w.nodes.length - 1]!);
    for (const id of w.nodes) if ((usage.get(id) ?? 0) >= 2) isJunction.add(id);
  }

  // ---- 3. split ----------------------------------------------------------------------
  let segments: Segment[] = [];
  for (const w of ways) {
    let start = 0;
    let n = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (isJunction.has(w.nodes[i]!)) {
        segments.push({ id: `w${w.id}_${n++}`, wayIds: [w.id], nodeIds: w.nodes.slice(start, i + 1), attrs: w.attrs });
        start = i;
      }
    }
  }
  stats.segmentsAfterSplit = segments.length;

  // ---- 4. snap + collapse ---------------------------------------------------------------
  const uf = new UnionFind();
  const grid = new GridIndex<number>(2);
  for (const id of isJunction) grid.insertPoint(pos(id), id);
  for (const id of isJunction) {
    const p = pos(id);
    for (const other of grid.query(p, opts.snapDist)) {
      if (other !== id && dist2(p, pos(other)) <= opts.snapDist) uf.union(id, other);
    }
  }
  const segLength = (s: Segment): number => polylineLength(s.nodeIds.map(pos));
  let collapsed = 0;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const s of segments) {
      const a = uf.find(s.nodeIds[0]!);
      const b = uf.find(s.nodeIds[s.nodeIds.length - 1]!);
      if (a !== b && segLength(s) < opts.minFragment) {
        uf.union(a, b);
        collapsed++;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const nodeRep = uf.entries();
  const rep = (id: number): number => nodeRep.get(id) ?? id;
  // rewrite endpoints to representatives; drop degenerate fragments
  segments = segments.filter((s) => {
    const first = rep(s.nodeIds[0]!);
    const last = rep(s.nodeIds[s.nodeIds.length - 1]!);
    s.nodeIds[0] = first;
    s.nodeIds[s.nodeIds.length - 1] = last;
    if (first === last && polylineLength(s.nodeIds.map(pos)) < Math.max(opts.minFragment, 6)) return false;
    return true;
  });
  stats.nodesSnapped = [...nodeRep.entries()].filter(([k, v]) => k !== v).length;
  stats.fragmentsCollapsed = collapsed;

  // ---- 5. merge through degree-2 nodes -----------------------------------------------------
  const segById = new Map(segments.map((s) => [s.id, s]));
  const ends = new Map<number, Set<string>>();
  const addEnd = (node: number, segId: string): void => {
    let set = ends.get(node);
    if (!set) {
      set = new Set();
      ends.set(node, set);
    }
    set.add(segId);
  };
  for (const s of segments) {
    addEnd(s.nodeIds[0]!, s.id);
    addEnd(s.nodeIds[s.nodeIds.length - 1]!, s.id);
  }
  let merged = 0;
  const queue = [...ends.keys()];
  while (queue.length > 0) {
    const node = queue.pop()!;
    const set = ends.get(node);
    if (!set || set.size !== 2) continue;
    const [idA, idB] = [...set] as [string, string];
    const A = segById.get(idA)!;
    const B = segById.get(idB)!;
    if (A === B) continue; // a loop touching itself
    const aStart = A.nodeIds[0] === node;
    const aEnd = A.nodeIds[A.nodeIds.length - 1] === node;
    const bStart = B.nodeIds[0] === node;
    const bEnd = B.nodeIds[B.nodeIds.length - 1] === node;
    if ((aStart && aEnd) || (bStart && bEnd)) continue; // loops
    // A two-way segment drawn "against" its neighbour can be flipped (geometry reversed,
    // directional attributes swapped); a oneway segment cannot.
    const flip = (s: Segment): Segment => ({ ...s, nodeIds: s.nodeIds.slice().reverse(), attrs: reverseAttrs(s.attrs) });
    let first: Segment;
    let second: Segment;
    if (aEnd && bStart) {
      first = A;
      second = B;
    } else if (bEnd && aStart) {
      first = B;
      second = A;
    } else if (aEnd && bEnd) {
      if (B.attrs.oneway) continue;
      first = A;
      second = flip(B);
    } else {
      if (A.attrs.oneway) continue;
      first = flip(A);
      second = B;
    }
    if (attrsKey(first.attrs) !== attrsKey(second.attrs)) continue;
    const farA = first.nodeIds[0]!;
    const farB = second.nodeIds[second.nodeIds.length - 1]!;
    if (farA === farB) continue; // would close a loop; keep the bend
    const mergedSeg: Segment = { id: first.id, wayIds: [...first.wayIds, ...second.wayIds], nodeIds: [...first.nodeIds, ...second.nodeIds.slice(1)], attrs: first.attrs };
    segById.delete(idA);
    segById.delete(idB);
    segById.set(mergedSeg.id, mergedSeg);
    ends.delete(node);
    for (const far of [farA, farB]) {
      const s = ends.get(far)!;
      s.delete(idA);
      s.delete(idB);
      s.add(mergedSeg.id);
    }
    merged++;
  }
  stats.segmentsMerged = merged;
  segments = [...segById.values()];

  // ---- 6. loops → two halves; geometry ------------------------------------------------------
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.nodeIds[0] === s.nodeIds[s.nodeIds.length - 1]) {
      if (s.nodeIds.length < 3) continue;
      const mid = Math.floor(s.nodeIds.length / 2);
      out.push({ id: s.id, wayIds: s.wayIds, nodeIds: s.nodeIds.slice(0, mid + 1), attrs: s.attrs });
      out.push({ id: `${s.id}b`, wayIds: s.wayIds, nodeIds: s.nodeIds.slice(mid), attrs: s.attrs });
      stats.loopsSplit = (stats.loopsSplit ?? 0) + 1;
    } else out.push(s);
  }

  let roads: SemRoad[] = [];
  let dropped = 0;
  for (const s of out) {
    const raw = s.nodeIds.map(pos);
    let pts = dedupePoints(raw, 0.05);
    pts = simplifyPolyline(pts, opts.simplifyTolerance);
    const length = polylineLength(pts);
    if (pts.length < 2 || length < opts.minFragment) {
      dropped++;
      continue;
    }
    const from = s.nodeIds[0]!;
    const to = s.nodeIds[s.nodeIds.length - 1]!;
    // endpoints must equal the node positions exactly
    pts[0] = pos(from);
    pts[pts.length - 1] = pos(to);
    const a = s.attrs;
    const road: SemRoad = {
      id: s.id,
      from: semNodeId(from),
      to: semNodeId(to),
      points: pts,
      cls: a.cls,
      name: a.name,
      nameEn: a.nameEn,
      oneway: a.oneway,
      lanesForward: a.lanesForward,
      lanesBackward: a.lanesBackward,
      laneWidth: a.laneWidth,
      maxSpeed: a.maxSpeed,
      turnLanesForward: a.turnLanesForward,
      turnLanesBackward: a.turnLanesBackward,
      busLaneForward: a.busLaneForward,
      busLaneBackward: a.busLaneBackward,
      kerbLeft: a.kerbLeft,
      kerbRight: a.kerbRight,
      zone: a.zone,
      sidewalkLeft: a.sidewalkLeft,
      sidewalkRight: a.sidewalkRight,
      bridge: a.bridge,
      tunnel: a.tunnel,
      lit: a.lit,
      roundabout: a.roundabout,
      osmWayIds: [...new Set(s.wayIds)],
      nodeIds: s.nodeIds,
      link: a.link,
      attrs: a,
      length,
    };
    roads.push(road);
  }
  stats.roadsDropped = dropped;

  // ---- 7. clip to the fetch area, prune islands --------------------------------------------
  // The OSM API returns whole ways, so roads can run far outside the area; everything
  // without a point inside (+ margin) goes, as do small components disconnected from
  // the main network (parking-lot leftovers, stubs cut by the extent).
  const before = roads.length;
  roads = roads.filter((r) => r.points.some((p) => bboxContains(area, p, opts.clipMargin)));
  stats.roadsOutsideArea = before - roads.length;
  if (opts.keepRoad) {
    const n = roads.length;
    roads = roads.filter((r) => opts.keepRoad!(r.points));
    stats.roadsOutsideClip = n - roads.length;
  }
  const comp = new UnionFindS();
  for (const r of roads) comp.union(r.from, r.to);
  const compSize = new Map<string, number>();
  for (const r of roads) {
    const c = comp.find(r.from);
    compSize.set(c, (compSize.get(c) ?? 0) + 1);
  }
  const largest = Math.max(0, ...compSize.values());
  const keep = new Set([...compSize.entries()].filter(([, n]) => n === largest || n >= opts.minComponentRoads).map(([c]) => c));
  const beforePrune = roads.length;
  roads = roads.filter((r) => keep.has(comp.find(r.from)));
  stats.roadsInIslandsDropped = beforePrune - roads.length;
  stats.roadComponentsKept = keep.size;
  // A one-way road ending at a node that other roads touch but nothing leaves (its
  // continuation was clipped away) is a useless sink: prune it back to the last junction
  // with an exit. Genuine one-way cul-de-sacs (nothing else at the end node) are kept.
  let sinksDropped = 0;
  for (let pass = 0; pass < 50; pass++) {
    const leaves = new Set<string>();
    const deg = new Map<string, number>();
    for (const r of roads) {
      leaves.add(r.from);
      if (!r.oneway) leaves.add(r.to);
      deg.set(r.from, (deg.get(r.from) ?? 0) + 1);
      deg.set(r.to, (deg.get(r.to) ?? 0) + 1);
    }
    const next = roads.filter((r) => !(r.oneway && !leaves.has(r.to) && (deg.get(r.to) ?? 0) >= 2));
    if (next.length === roads.length) break;
    sinksDropped += roads.length - next.length;
    roads = next;
  }
  stats.onewaySinksDropped = sinksDropped;
  roads.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const degree = new Map<number, number>();
  const interiorNodeRoad = new Map<number, string>();
  for (const road of roads) {
    const from = road.nodeIds[0]!;
    const to = road.nodeIds[road.nodeIds.length - 1]!;
    degree.set(from, (degree.get(from) ?? 0) + 1);
    degree.set(to, (degree.get(to) ?? 0) + 1);
    for (let i = 1; i < road.nodeIds.length - 1; i++) interiorNodeRoad.set(road.nodeIds[i]!, road.id);
  }

  const nodes = new Map<string, SemNode>();
  for (const [osmId, deg] of degree) {
    const id = semNodeId(osmId);
    nodes.set(id, { id, pos: pos(osmId), osmId, degree: deg, control: 'auto', tags: osm.nodes.get(osmId)?.tags });
  }
  stats.roads = roads.length;
  stats.nodes = nodes.size;
  return { roads, nodes, nodeRep, interiorNodeRoad, stats };
}
