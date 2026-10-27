/**
 * RoadGraph — runtime index over a WorldFile: id maps, spatial lookup of lanes /
 * connectors / junctions, map-matching helpers and shortest-path routing.
 * Pure TypeScript (no THREE), usable in node tests.
 */
import { angleDiff, dist2, headingOf, pointAlong, projectOntoPolyline, type Vec2 } from './geo';
import type { Connector, Crossing, Junction, Lane, LaneKind, ParkingStrip, Road, Sign, SignalController, SignalGroup, SpawnPoint, WorldFile } from './schema';

export interface LaneMatch {
  lane: Lane;
  s: number;
  lateral: number;
  distance: number;
  /** Heading of the lane at s. */
  laneHeading: number;
  /** Signed heading error (car heading - lane heading), rad. */
  headingError: number;
}

export interface ConnectorMatch {
  connector: Connector;
  s: number;
  lateral: number;
  distance: number;
  pathHeading: number;
  headingError: number;
}

export interface PathResult {
  laneIds: string[];
  connectorIds: string[];
  length: number;
}

class Grid<T> {
  private cells = new Map<string, Set<T>>();
  constructor(public readonly size: number) {}
  private key(x: number, z: number): string {
    return `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
  }
  insert(p: Vec2, v: T): void {
    const k = this.key(p[0], p[1]);
    let set = this.cells.get(k);
    if (!set) {
      set = new Set();
      this.cells.set(k, set);
    }
    set.add(v);
  }
  insertPolyline(pts: Vec2[], v: T): void {
    const step = this.size / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const L = dist2(a, b);
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = 0; k <= n; k++) this.insert([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], v);
    }
    if (pts.length === 1) this.insert(pts[0]!, v);
  }
  query(p: Vec2, radius: number): Set<T> {
    const out = new Set<T>();
    const r = Math.ceil(radius / this.size);
    const cx = Math.floor(p[0] / this.size);
    const cz = Math.floor(p[1] / this.size);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const set = this.cells.get(`${cx + i},${cz + j}`);
        if (set) for (const v of set) out.add(v);
      }
    }
    return out;
  }
}

class MinHeap<T> {
  private a: { k: number; v: T }[] = [];
  get size(): number {
    return this.a.length;
  }
  push(k: number, v: T): void {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.k <= a[i]!.k) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): { k: number; v: T } | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.k < a[m]!.k) m = l;
        if (r < a.length && a[r]!.k < a[m]!.k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export class RoadGraph {
  readonly lanes = new Map<string, Lane>();
  readonly roads = new Map<string, Road>();
  readonly junctions = new Map<string, Junction>();
  readonly connectors = new Map<string, Connector>();
  readonly signals = new Map<string, SignalController>();
  readonly signalGroups = new Map<string, { group: SignalGroup; controller: SignalController }>();
  readonly crossings = new Map<string, Crossing>();
  readonly signs = new Map<string, Sign>();
  readonly spawnPoints = new Map<string, SpawnPoint>();
  readonly parkingByRoad = new Map<string, ParkingStrip[]>();
  readonly crossingsByLane = new Map<string, Crossing[]>();
  readonly signsByLane = new Map<string, Sign[]>();
  /** connector id -> signal group id (fast lookup). */
  readonly connectorSignalGroup = new Map<string, string>();

  private laneGrid = new Grid<string>(40);
  private connectorGrid = new Grid<string>(40);
  private junctionGrid = new Grid<string>(80);
  private crossingGrid = new Grid<string>(40);

  constructor(public readonly world: WorldFile) {
    for (const r of world.roads) this.roads.set(r.id, r);
    for (const l of world.lanes) {
      this.lanes.set(l.id, l);
      this.laneGrid.insertPolyline(l.centre, l.id);
    }
    for (const j of world.junctions) {
      this.junctions.set(j.id, j);
      this.junctionGrid.insert(j.position, j.id);
    }
    for (const c of world.connectors) {
      this.connectors.set(c.id, c);
      this.connectorGrid.insertPolyline(c.path, c.id);
      if (c.signalGroup) this.connectorSignalGroup.set(c.id, c.signalGroup);
    }
    for (const s of world.signals) {
      this.signals.set(s.id, s);
      for (const g of s.groups) this.signalGroups.set(g.id, { group: g, controller: s });
    }
    for (const c of world.crossings) {
      this.crossings.set(c.id, c);
      this.crossingGrid.insert(c.line[0], c.id);
      this.crossingGrid.insert(c.line[1], c.id);
      for (const laneId of c.laneIds) {
        const list = this.crossingsByLane.get(laneId) ?? [];
        list.push(c);
        this.crossingsByLane.set(laneId, list);
      }
    }
    for (const s of world.signs) {
      this.signs.set(s.id, s);
      for (const laneId of s.laneIds) {
        const list = this.signsByLane.get(laneId) ?? [];
        list.push(s);
        this.signsByLane.set(laneId, list);
      }
    }
    for (const sp of world.spawnPoints) this.spawnPoints.set(sp.id, sp);
    for (const p of world.parking) {
      const list = this.parkingByRoad.get(p.roadId) ?? [];
      list.push(p);
      this.parkingByRoad.set(p.roadId, list);
    }
  }

  lane(id: string): Lane {
    const l = this.lanes.get(id);
    if (!l) throw new Error(`unknown lane ${id}`);
    return l;
  }
  connector(id: string): Connector {
    const c = this.connectors.get(id);
    if (!c) throw new Error(`unknown connector ${id}`);
    return c;
  }
  junction(id: string): Junction {
    const j = this.junctions.get(id);
    if (!j) throw new Error(`unknown junction ${id}`);
    return j;
  }
  road(id: string): Road {
    const r = this.roads.get(id);
    if (!r) throw new Error(`unknown road ${id}`);
    return r;
  }

  /** Junction at the end of a lane, and the approach record for it. */
  approachOf(laneId: string): { junction: Junction; approach: Junction['approaches'][number] } | undefined {
    const lane = this.lanes.get(laneId);
    if (!lane) return undefined;
    const junction = this.junctions.get(lane.to);
    if (!junction) return undefined;
    const approach = junction.approaches.find((a) => a.laneIds.includes(laneId));
    return approach ? { junction, approach } : undefined;
  }

  connectorsFrom(laneId: string): Connector[] {
    return this.lane(laneId).next.map((id) => this.connector(id));
  }
  connectorsInto(laneId: string): Connector[] {
    return this.lane(laneId).prev.map((id) => this.connector(id));
  }

  /** Lanes parallel to `laneId` on the same road and direction (for lane changes), ordered left→right. */
  siblingLanes(laneId: string): Lane[] {
    const lane = this.lane(laneId);
    const road = this.road(lane.roadId);
    const ids = road.lanesForward.includes(laneId) ? road.lanesForward : road.lanesBackward;
    return ids.map((id) => this.lane(id));
  }

  /** Point and heading at arc-length s on a lane. */
  laneAt(laneId: string, s: number): { p: Vec2; h: number } {
    const r = pointAlong(this.lane(laneId).centre, s);
    return { p: r.p, h: r.h };
  }
  connectorAt(connectorId: string, s: number): { p: Vec2; h: number } {
    const r = pointAlong(this.connector(connectorId).path, s);
    return { p: r.p, h: r.h };
  }

  lanesWithin(pos: Vec2, radius: number, kinds?: LaneKind[]): Lane[] {
    const out: Lane[] = [];
    for (const id of this.laneGrid.query(pos, radius)) {
      const l = this.lane(id);
      if (kinds && !kinds.includes(l.kind)) continue;
      out.push(l);
    }
    return out;
  }

  junctionsWithin(pos: Vec2, radius: number): Junction[] {
    const out: Junction[] = [];
    for (const id of this.junctionGrid.query(pos, radius)) {
      const j = this.junction(id);
      if (dist2(j.position, pos) <= radius) out.push(j);
    }
    return out;
  }

  crossingsWithin(pos: Vec2, radius: number): Crossing[] {
    const out: Crossing[] = [];
    for (const id of this.crossingGrid.query(pos, radius)) {
      const c = this.crossings.get(id)!;
      const mid: Vec2 = [(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2];
      if (dist2(mid, pos) <= radius + c.width) out.push(c);
    }
    return out;
  }

  /**
   * Best lane for a position (and optionally a heading). Score = distance + heading penalty,
   * so a car on a two-way road matches the lane running in its direction.
   */
  nearestLane(pos: Vec2, opts: { heading?: number; maxDist?: number; kinds?: LaneKind[]; preferLaneId?: string } = {}): LaneMatch | undefined {
    const maxDist = opts.maxDist ?? 12;
    let best: LaneMatch | undefined;
    let bestScore = Infinity;
    for (const id of this.laneGrid.query(pos, maxDist)) {
      const lane = this.lane(id);
      if (opts.kinds && !opts.kinds.includes(lane.kind)) continue;
      const pr = projectOntoPolyline(lane.centre, pos);
      if (pr.distance > maxDist) continue;
      let score = pr.distance;
      let headingError = 0;
      if (opts.heading !== undefined) {
        headingError = angleDiff(pr.h, opts.heading);
        score += Math.abs(headingError) * 4; // 90° off ≈ 6 m penalty
      }
      if (opts.preferLaneId === id) score -= 1.0;
      if (score < bestScore) {
        bestScore = score;
        best = { lane, s: pr.s, lateral: pr.lateral, distance: pr.distance, laneHeading: pr.h, headingError };
      }
    }
    return best;
  }

  nearestConnector(pos: Vec2, opts: { heading?: number; maxDist?: number; junctionId?: string; fromLaneId?: string } = {}): ConnectorMatch | undefined {
    const maxDist = opts.maxDist ?? 8;
    let best: ConnectorMatch | undefined;
    let bestScore = Infinity;
    for (const id of this.connectorGrid.query(pos, maxDist)) {
      const c = this.connector(id);
      if (opts.junctionId && c.junctionId !== opts.junctionId) continue;
      if (opts.fromLaneId && c.fromLane !== opts.fromLaneId) continue;
      const pr = projectOntoPolyline(c.path, pos);
      if (pr.distance > maxDist) continue;
      let score = pr.distance;
      let headingError = 0;
      if (opts.heading !== undefined) {
        headingError = angleDiff(pr.h, opts.heading);
        score += Math.abs(headingError) * 3;
      }
      if (score < bestScore) {
        bestScore = score;
        best = { connector: c, s: pr.s, lateral: pr.lateral, distance: pr.distance, pathHeading: pr.h, headingError };
      }
    }
    return best;
  }

  /** True when the point lies inside the paved junction polygon. */
  insideJunction(pos: Vec2, junction: Junction): boolean {
    const poly = junction.polygon;
    if (!poly) return dist2(pos, junction.position) < 4;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a[1] > pos[1] !== b[1] > pos[1] && pos[0] < ((b[0] - a[0]) * (pos[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  /** Dijkstra over lanes + connectors. Cost = length (+ turn penalties for realistic routes). */
  findPath(fromLaneId: string, toLaneId: string, opts: { avoidKinds?: LaneKind[]; turnPenalty?: number } = {}): PathResult | undefined {
    if (fromLaneId === toLaneId) return { laneIds: [fromLaneId], connectorIds: [], length: this.lane(fromLaneId).length };
    const avoid = new Set(opts.avoidKinds ?? ['bus', 'bike', 'parking', 'shoulder']);
    const turnPenalty = opts.turnPenalty ?? 15;
    const dist = new Map<string, number>();
    const prev = new Map<string, { lane: string; conn: string }>();
    const heap = new MinHeap<string>();
    dist.set(fromLaneId, 0);
    heap.push(0, fromLaneId);
    while (heap.size > 0) {
      const { k, v: laneId } = heap.pop()!;
      if (k > (dist.get(laneId) ?? Infinity)) continue;
      if (laneId === toLaneId) break;
      const lane = this.lane(laneId);
      // lane changes to siblings are allowed mid-road at a small cost
      for (const sib of this.siblingLanes(laneId)) {
        if (sib.id === laneId || avoid.has(sib.kind)) continue;
        const nd = k + 5;
        if (nd < (dist.get(sib.id) ?? Infinity)) {
          dist.set(sib.id, nd);
          prev.set(sib.id, { lane: laneId, conn: '' });
          heap.push(nd, sib.id);
        }
      }
      for (const cid of lane.next) {
        const c = this.connector(cid);
        const next = this.lane(c.toLane);
        if (avoid.has(next.kind) && next.id !== toLaneId) continue;
        const penalty = c.turn === 'straight' ? 0 : c.turn === 'uturn' ? turnPenalty * 4 : c.turn.startsWith('slight') ? turnPenalty / 3 : turnPenalty;
        const nd = k + lane.length + c.length + penalty;
        if (nd < (dist.get(next.id) ?? Infinity)) {
          dist.set(next.id, nd);
          prev.set(next.id, { lane: laneId, conn: cid });
          heap.push(nd, next.id);
        }
      }
    }
    if (!dist.has(toLaneId)) return undefined;
    const laneIds: string[] = [toLaneId];
    const connectorIds: string[] = [];
    let cur = toLaneId;
    while (cur !== fromLaneId) {
      const p = prev.get(cur);
      if (!p) return undefined;
      if (p.conn) connectorIds.unshift(p.conn);
      laneIds.unshift(p.lane);
      cur = p.lane;
    }
    let length = 0;
    for (const id of laneIds) length += this.lane(id).length;
    for (const id of connectorIds) length += this.connector(id).length;
    return { laneIds, connectorIds, length };
  }

  /** Lanes that enter a junction (any approach). */
  incomingLanes(junctionId: string): Lane[] {
    return this.junction(junctionId).approaches.flatMap((a) => a.laneIds.map((id) => this.lane(id)));
  }

  /** Route through an ordered list of junctions starting from a lane; returns the concatenated path. */
  routeViaJunctions(startLaneId: string, junctionIds: string[]): PathResult | undefined {
    let laneIds: string[] = [startLaneId];
    let connectorIds: string[] = [];
    let length = this.lane(startLaneId).length;
    let cur = startLaneId;
    for (const jid of junctionIds) {
      const j = this.junction(jid);
      let best: PathResult | undefined;
      for (const a of j.approaches) {
        for (const laneId of a.laneIds) {
          const p = this.findPath(cur, laneId);
          if (p && (!best || p.length < best.length)) best = p;
        }
      }
      if (!best) return undefined;
      laneIds = laneIds.concat(best.laneIds.slice(1));
      connectorIds = connectorIds.concat(best.connectorIds);
      length += best.length - this.lane(cur).length;
      cur = laneIds[laneIds.length - 1]!;
    }
    return { laneIds, connectorIds, length };
  }

  /** Heading of the lane at its end (useful to spawn vehicles). */
  laneEndHeading(laneId: string): number {
    const c = this.lane(laneId).centre;
    return headingOf(c[c.length - 2]!, c[c.length - 1]!);
  }
}
