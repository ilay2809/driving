/**
 * Junction controls: traffic signals, stop / give-way signs, priority roads,
 * turn restrictions and pedestrian crossings — derived from OSM nodes/relations and
 * cross-checked with the municipal "signalised junctions" layer.
 */
import { classifyTurn, type BuildCrossing, type BuildSign } from '@/world/builder';
import { angleDiff, dist2, headingOf, pointAlong, projectOntoPolyline, wrapAngle, type Vec2 } from '@/world/geo';
import type { ControlKind, Turn } from '@/world/schema';
import { GridIndex } from '../geom';
import type { TlvData } from '../tlv';
import type { SemanticModel, SemNode, SemRoad } from './model';
import type { OsmData, Tags } from './parse';
import { ALL_TURNS, crossingKindOf } from './tags';

export const SIGNAL_APPROACH_DIST = 30;
export const SIGN_APPROACH_DIST = 40;
export const TLV_SIGNAL_MATCH_DIST = 25;
export const MAIN_AXIS_MATCH_DIST = 12;

export type NodeLocation = { kind: 'junction'; node: SemNode } | { kind: 'interior'; road: SemRoad; s: number } | undefined;

/** Where an OSM node ended up in the network. */
export function locateOsmNode(model: SemanticModel, osmNodeId: number, pos: Vec2): NodeLocation {
  const rep = model.nodeRep.get(osmNodeId) ?? osmNodeId;
  const node = model.nodes.get(`n${rep}`);
  if (node) return { kind: 'junction', node };
  const roadId = model.interiorNodeRoad.get(osmNodeId);
  if (!roadId) return undefined;
  const road = model.roadById.get(roadId);
  if (!road) return undefined;
  return { kind: 'interior', road, s: projectOntoPolyline(road.points, pos).s };
}

/** Roads touching a node (built once per model). */
export function roadsByNode(model: SemanticModel): Map<string, SemRoad[]> {
  const m = new Map<string, SemRoad[]>();
  for (const r of model.roads) {
    for (const id of [r.from, r.to]) {
      const list = m.get(id);
      if (list) list.push(r);
      else m.set(id, [r]);
    }
  }
  return m;
}

/** Heading of the traffic arriving at the given end of a road. */
export function arrivalHeading(road: SemRoad, end: 'from' | 'to'): number {
  const p = road.points;
  if (end === 'to') return headingOf(p[p.length - 2]!, p[p.length - 1]!);
  return wrapAngle(headingOf(p[0]!, p[1]!) + Math.PI);
}

/** Heading of the traffic leaving a node along a road. */
export function departureHeading(road: SemRoad, end: 'from' | 'to'): number {
  return wrapAngle(arrivalHeading(road, end) + Math.PI);
}

/**
 * Junction nodes (degree ≥ 3) reachable within `maxDist` metres from a start point on
 * the network, walking only through bends / merges (degree ≤ 2 nodes).
 */
function junctionsWithin(model: SemanticModel, byNode: Map<string, SemRoad[]>, starts: { nodeId: string; dist: number }[], maxDist: number): SemNode[] {
  const found = new Map<string, SemNode>();
  const best = new Map<string, number>();
  const queue = starts.slice();
  while (queue.length > 0) {
    const { nodeId, dist } = queue.shift()!;
    if (dist > maxDist) continue;
    if ((best.get(nodeId) ?? Infinity) <= dist) continue;
    best.set(nodeId, dist);
    const node = model.nodes.get(nodeId);
    if (!node) continue;
    if (node.degree >= 3) {
      found.set(nodeId, node);
      continue;
    }
    for (const r of byNode.get(nodeId) ?? []) {
      const other = r.from === nodeId ? r.to : r.from;
      queue.push({ nodeId: other, dist: dist + r.length });
    }
  }
  return [...found.values()];
}

function startsFor(loc: NodeLocation, direction: 'forward' | 'backward' | undefined): { nodeId: string; dist: number }[] {
  if (!loc) return [];
  if (loc.kind === 'junction') return [{ nodeId: loc.node.id, dist: 0 }];
  const out: { nodeId: string; dist: number }[] = [];
  if (direction !== 'backward') out.push({ nodeId: loc.road.to, dist: loc.road.length - loc.s });
  if (direction !== 'forward') out.push({ nodeId: loc.road.from, dist: loc.s });
  return out;
}

export function applySignals(model: SemanticModel, osm: OsmData, tlv: TlvData): void {
  const byNode = roadsByNode(model);
  let fromNodes = 0;
  let fromApproach = 0;
  let unplaced = 0;
  for (const n of osm.nodes.values()) {
    if (n.tags?.highway !== 'traffic_signals') continue;
    const pos = model.proj.toWorld(n.lon, n.lat);
    const loc = locateOsmNode(model, n.id, pos);
    if (!loc) continue;
    if (loc.kind === 'junction' && loc.node.degree >= 3) {
      loc.node.control = 'signals';
      fromNodes++;
      continue;
    }
    const dir = n.tags['traffic_signals:direction'];
    const found = junctionsWithin(model, byNode, startsFor(loc, dir === 'forward' || dir === 'backward' ? dir : undefined), SIGNAL_APPROACH_DIST);
    if (found.length === 0) {
      unplaced++;
      continue;
    }
    for (const j of found) j.control = 'signals';
    fromApproach++;
  }
  model.stats.signalsFromJunctionNodes = fromNodes;
  model.stats.signalsFromApproachNodes = fromApproach;
  model.stats.signalNodesUnplaced = unplaced;

  // municipal cross-check
  const grid = new GridIndex<SemNode>(50);
  for (const n of model.nodes.values()) if (n.degree >= 3) grid.insertPoint(n.pos, n);
  let tlvAdded = 0;
  let tlvMatched = 0;
  const unmatched: string[] = [];
  for (const s of tlv.signalized) {
    let any = false;
    for (const n of grid.query(s.pos, TLV_SIGNAL_MATCH_DIST)) {
      if (dist2(n.pos, s.pos) > TLV_SIGNAL_MATCH_DIST) continue;
      any = true;
      if (n.control !== 'signals') {
        n.control = 'signals';
        tlvAdded++;
      }
      if (!n.name && s.name) n.name = s.name;
    }
    if (any) tlvMatched++;
    else {
      const ll = model.proj.toLonLat(s.pos[0], s.pos[1]);
      unmatched.push(`${s.name ?? '?'} @ ${ll.lon.toFixed(5)},${ll.lat.toFixed(5)}`);
    }
  }
  model.stats.tlvSignalisedMatched = tlvMatched;
  model.stats.tlvSignalisedUnmatched = unmatched.length;
  model.stats.signalsAddedFromTlv = tlvAdded;
  if (unmatched.length > 0) model.todos.push(`${unmatched.length} municipal signalised junctions had no OSM junction within ${TLV_SIGNAL_MATCH_DIST} m (outside the drivable network, south of the river, or mid-block pedestrian signals): ${unmatched.join('; ')}`);
}

/** Walk from a road end through degree-2 nodes to the first real junction (≤ maxDist). */
function approachAt(model: SemanticModel, byNode: Map<string, SemRoad[]>, road: SemRoad, end: 'from' | 'to', dist: number, maxDist: number): { road: SemRoad; end: 'from' | 'to' } | undefined {
  let cur = road;
  let curEnd = end;
  let d = dist;
  for (let hops = 0; hops < 6; hops++) {
    if (d > maxDist) return undefined;
    const nodeId = curEnd === 'to' ? cur.to : cur.from;
    const node = model.nodes.get(nodeId);
    if (!node) return undefined;
    if (node.degree >= 3) return { road: cur, end: curEnd };
    if (node.degree < 2) return undefined;
    const next = (byNode.get(nodeId) ?? []).find((r) => r !== cur);
    if (!next) return undefined;
    // continue along `next` away from this node
    if (next.from === nodeId) {
      cur = next;
      curEnd = 'to';
    } else {
      if (next.oneway) return undefined; // cannot arrive at a oneway road's start against traffic
      cur = next;
      curEnd = 'from';
    }
    d += cur.length;
  }
  return undefined;
}

export function applyStopAndGiveWay(model: SemanticModel, osm: OsmData): void {
  const byNode = roadsByNode(model);
  let applied = 0;
  let skipped = 0;
  for (const n of osm.nodes.values()) {
    const hw = n.tags?.highway;
    if (hw !== 'stop' && hw !== 'give_way') continue;
    const control: ControlKind = hw === 'stop' ? 'stop' : 'give_way';
    const pos = model.proj.toWorld(n.lon, n.lat);
    const loc = locateOsmNode(model, n.id, pos);
    if (!loc) continue;
    const dir = n.tags?.direction;
    const candidates: { road: SemRoad; end: 'from' | 'to'; dist: number }[] = [];
    if (loc.kind === 'interior') {
      if (dir !== 'backward') candidates.push({ road: loc.road, end: 'to', dist: loc.road.length - loc.s });
      if (dir !== 'forward' && !loc.road.oneway) candidates.push({ road: loc.road, end: 'from', dist: loc.s });
    } else if (loc.node.degree <= 2) {
      for (const r of byNode.get(loc.node.id) ?? []) {
        if (r.to === loc.node.id) candidates.push({ road: r, end: 'to', dist: 0 });
        else if (!r.oneway) candidates.push({ road: r, end: 'from', dist: 0 });
      }
    } else {
      skipped++; // placed on the junction node itself: the approach is unknown
      continue;
    }
    candidates.sort((a, b) => a.dist - b.dist);
    let done = false;
    for (const c of candidates) {
      const ap = approachAt(model, byNode, c.road, c.end, c.dist, SIGN_APPROACH_DIST);
      if (!ap) continue;
      if (ap.end === 'to') ap.road.controlAtTo = control;
      else ap.road.controlAtFrom = control;
      done = true;
      applied++;
      break;
    }
    if (!done) skipped++;
  }
  model.stats.stopGiveWayApplied = applied;
  model.stats.stopGiveWaySkipped = skipped;
  if (skipped > 0) model.todos.push(`${skipped} stop/give-way nodes could not be attached to an approach (on the junction node itself, or > ${SIGN_APPROACH_DIST} m from a junction).`);
}

export function applyPriorityRoads(model: SemanticModel, tlv: TlvData): void {
  const grid = new GridIndex<{ a: Vec2; b: Vec2; h: number }>(50);
  for (const axis of tlv.mainAxes) {
    for (let i = 1; i < axis.points.length; i++) {
      const a = axis.points[i - 1]!;
      const b = axis.points[i]!;
      grid.insertPolyline([a, b], { a, b, h: headingOf(a, b) });
    }
  }
  let byClass = 0;
  let byAxis = 0;
  for (const r of model.roads) {
    if (r.cls === 'motorway' || r.cls === 'trunk' || r.cls === 'primary' || r.cls === 'secondary' || r.cls === 'tertiary') {
      r.priorityRoad = true;
      byClass++;
      continue;
    }
    if (r.cls === 'service' || r.roundabout) continue;
    const mid = pointAlong(r.points, r.length / 2);
    for (const seg of grid.query(mid.p, MAIN_AXIS_MATCH_DIST)) {
      const pr = projectOntoPolyline([seg.a, seg.b], mid.p);
      if (pr.distance > MAIN_AXIS_MATCH_DIST) continue;
      const dh = Math.abs(angleDiff(seg.h, mid.h));
      if (Math.min(dh, Math.PI - dh) > (25 * Math.PI) / 180) continue;
      r.priorityRoad = true;
      byAxis++;
      break;
    }
  }
  model.stats.priorityRoadsByClass = byClass;
  model.stats.priorityRoadsByTlvAxis = byAxis;
}

const RESTRICTION_SIGN: Record<string, string | undefined> = { no_left_turn: '429', no_right_turn: '428', no_u_turn: '430', no_straight_on: undefined };

function turnFamily(t: Turn): Turn[] {
  if (t === 'left') return ['left', 'sharp_left'];
  if (t === 'right') return ['right', 'sharp_right'];
  return [t];
}

/** Turn restrictions (type=restriction relations, via node) → per-lane allowed turns + 428/429/430 signs. */
export function applyTurnRestrictions(model: SemanticModel, osm: OsmData): void {
  const roadsByWay = new Map<number, SemRoad[]>();
  for (const r of model.roads) {
    for (const w of r.osmWayIds) {
      const list = roadsByWay.get(w);
      if (list) list.push(r);
      else roadsByWay.set(w, [r]);
    }
  }
  let applied = 0;
  let skipped = 0;
  for (const rel of osm.relations.values()) {
    if (rel.tags.type !== 'restriction') continue;
    const kind = rel.tags.restriction ?? rel.tags['restriction:motorcar'];
    if (!kind) continue;
    if (rel.tags.except && /motorcar|motor_vehicle/.test(rel.tags.except)) continue;
    const from = rel.members.find((m) => m.role === 'from' && m.type === 'way');
    const to = rel.members.find((m) => m.role === 'to' && m.type === 'way');
    const via = rel.members.find((m) => m.role === 'via');
    if (!from || !to || !via || via.type !== 'node') {
      skipped++;
      continue;
    }
    const viaId = `n${model.nodeRep.get(via.ref) ?? via.ref}`;
    const viaNode = model.nodes.get(viaId);
    if (!viaNode) {
      skipped++;
      continue;
    }
    const fromCands = (roadsByWay.get(from.ref) ?? []).flatMap((r): { road: SemRoad; end: 'from' | 'to' }[] => {
      const out: { road: SemRoad; end: 'from' | 'to' }[] = [];
      if (r.to === viaId) out.push({ road: r, end: 'to' });
      if (r.from === viaId && !r.oneway) out.push({ road: r, end: 'from' });
      return out;
    });
    const toCands = (roadsByWay.get(to.ref) ?? []).flatMap((r): { road: SemRoad; end: 'from' | 'to' }[] => {
      const out: { road: SemRoad; end: 'from' | 'to' }[] = [];
      if (r.from === viaId) out.push({ road: r, end: 'from' });
      if (r.to === viaId && !r.oneway) out.push({ road: r, end: 'to' });
      return out;
    });
    // a from/to way that continues on both sides of the via node is ambiguous (mapping error)
    if (fromCands.length !== 1 || toCands.length !== 1) {
      skipped++;
      continue;
    }
    const f = fromCands[0]!;
    const t = toCands[0]!;
    const turn = classifyTurn(arrivalHeading(f.road, f.end), departureHeading(t.road, t.end));
    const laneCount = f.end === 'to' ? f.road.lanesForward : f.road.lanesBackward;
    if (laneCount < 1) {
      skipped++;
      continue;
    }
    const current = (f.end === 'to' ? f.road.turnLanesForward : f.road.turnLanesBackward) ?? Array.from({ length: laneCount }, () => null as Turn[] | null);
    const family = turnFamily(turn);
    const updated = current.map((lane) => {
      const allowed = lane ?? ALL_TURNS.slice();
      if (kind.startsWith('only_')) return turn === 'straight' ? ['straight' as Turn] : [...new Set([...family])];
      const next = allowed.filter((x) => !family.includes(x));
      // never leave a lane without any movement (contradictory data)
      return next.length > 0 ? next : allowed;
    });
    if (f.end === 'to') f.road.turnLanesForward = updated;
    else f.road.turnLanesBackward = updated;
    const code = RESTRICTION_SIGN[kind];
    if (code) {
      const s = f.end === 'to' ? Math.max(0, f.road.length - 12) : Math.min(f.road.length, 12);
      model.signs.push({ id: `sg_rel${rel.id}`, code, roadId: f.road.id, s, direction: f.end === 'to' ? 'forward' : 'backward' });
    }
    applied++;
  }
  model.stats.turnRestrictionsApplied = applied;
  model.stats.turnRestrictionsSkipped = skipped;
  if (skipped > 0) model.todos.push(`${skipped} turn restrictions skipped (via way, members outside the network, or ambiguous from-way).`);
}

/** Same leniency rules as the builder's turnAllowed (kept in sync by the semantics tests). */
function turnAllowed(allowed: Turn[] | null, turn: Turn): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (allowed.includes(turn)) return true;
  if ((turn === 'slight_left' || turn === 'slight_right') && allowed.includes('straight')) return true;
  if (turn === 'slight_left' && allowed.includes('left')) return true;
  if (turn === 'slight_right' && allowed.includes('right')) return true;
  if (turn === 'sharp_left' && allowed.includes('left')) return true;
  if (turn === 'sharp_right' && allowed.includes('right')) return true;
  if (turn === 'uturn' && allowed.includes('left')) return true;
  return false;
}
const isLeft = (t: Turn) => t === 'left' || t === 'slight_left' || t === 'sharp_left' || t === 'uturn';
const isRight = (t: Turn) => t === 'right' || t === 'slight_right' || t === 'sharp_right';

/**
 * Make turn-lane data consistent with the topology the builder will see:
 *  - turn lanes on a way that ends at a bend / merge (the OSM way was split before the
 *    junction) are moved onto the continuing road, or dropped when the lane count differs;
 *  - lanes whose allowed turns match no exit at their junction are relaxed (unrestricted);
 *  - lanes that would get no connector under the builder's lane-position rules (e.g. the
 *    right lane of a two-lane one-way street whose only exit is a left turn) are given the
 *    turns that exist there.
 * Without this, ~100 lanes end without any connector.
 */
export function sanitiseTurnLanes(model: SemanticModel): void {
  const byNode = roadsByNode(model);
  let propagated = 0;
  let dropped = 0;
  let relaxed = 0;
  let assigned = 0;
  const work: { road: SemRoad; dir: 'forward' | 'backward' }[] = [];
  for (const r of model.roads) {
    if (r.turnLanesForward) work.push({ road: r, dir: 'forward' });
    if (r.turnLanesBackward) work.push({ road: r, dir: 'backward' });
  }
  while (work.length > 0) {
    const { road, dir } = work.pop()!;
    const lanes = dir === 'forward' ? road.turnLanesForward : road.turnLanesBackward;
    if (!lanes) continue;
    const endId = dir === 'forward' ? road.to : road.from;
    const node = model.nodes.get(endId);
    if (!node || node.degree >= 3) continue;
    if (dir === 'forward') road.turnLanesForward = undefined;
    else road.turnLanesBackward = undefined;
    const next = node.degree === 2 ? (byNode.get(endId) ?? []).find((q) => q !== road) : undefined;
    if (!next) {
      dropped++;
      continue;
    }
    let nextDir: 'forward' | 'backward';
    if (next.from === endId) nextDir = 'forward';
    else if (!next.oneway) nextDir = 'backward';
    else {
      dropped++;
      continue;
    }
    const count = nextDir === 'forward' ? next.lanesForward : next.lanesBackward;
    const existing = nextDir === 'forward' ? next.turnLanesForward : next.turnLanesBackward;
    if (count !== lanes.length || existing || next.roundabout) {
      dropped++;
      continue;
    }
    if (nextDir === 'forward') next.turnLanesForward = lanes;
    else next.turnLanesBackward = lanes;
    propagated++;
    work.push({ road: next, dir: nextDir });
  }

  for (const road of model.roads) {
    for (const dir of ['forward', 'backward'] as const) {
      const n = dir === 'forward' ? road.lanesForward : road.lanesBackward;
      if (n === 0) continue;
      const end = dir === 'forward' ? 'to' : 'from';
      const endId = dir === 'forward' ? road.to : road.from;
      const node = model.nodes.get(endId);
      if (!node || node.degree < 3) continue;
      const arrH = arrivalHeading(road, end);
      const exits: Turn[] = [];
      for (const q of byNode.get(endId) ?? []) {
        if (q === road) continue;
        if (q.from === endId) exits.push(classifyTurn(arrH, departureHeading(q, 'from')));
        if (q.to === endId && !q.oneway) exits.push(classifyTurn(arrH, departureHeading(q, 'to')));
      }
      const real = exits.filter((t) => t !== 'uturn');
      if (real.length === 0) continue;
      const current = (dir === 'forward' ? road.turnLanesForward : road.turnLanesBackward) ?? null;
      const next: (Turn[] | null)[] = Array.from({ length: n }, (_, i) => current?.[i] ?? null);
      let changed = false;
      const feasible = (i: number, allowed: Turn[] | null): boolean =>
        real.some((t) => {
          if (!turnAllowed(allowed, t)) return false;
          if (t === 'straight' || t === 'slight_left' || t === 'slight_right') return true;
          if (isRight(t)) return i === n - 1 || (allowed?.some(isRight) ?? false);
          return i === 0 || (allowed?.some(isLeft) ?? false);
        });
      for (let i = 0; i < n; i++) {
        if (feasible(i, next[i]!)) continue;
        if (next[i] && feasible(i, null)) {
          next[i] = null;
          relaxed++;
        } else {
          next[i] = [...new Set(real)];
          assigned++;
        }
        changed = true;
      }
      if (changed) {
        const value = next.every((x) => x === null) ? undefined : next;
        if (dir === 'forward') road.turnLanesForward = value;
        else road.turnLanesBackward = value;
      }
    }
  }
  model.stats.turnLanesPropagated = propagated;
  model.stats.turnLanesDropped = dropped;
  model.stats.turnLanesRelaxed = relaxed;
  model.stats.turnLanesAssigned = assigned;
}

export interface CrossingExtraction {
  midBlock: BuildCrossing[];
}

/** highway=crossing nodes → BuildCrossing (s along the road they sit on). */
export function extractCrossings(model: SemanticModel, osm: OsmData): CrossingExtraction {
  const byNode = roadsByNode(model);
  let skippedKind = 0;
  let onJunction = 0;
  const midBlock: BuildCrossing[] = [];
  const seen = new Set<string>();
  for (const n of osm.nodes.values()) {
    const tags: Tags | undefined = n.tags;
    if (!tags || tags.highway !== 'crossing') continue;
    const ck = crossingKindOf(tags);
    if (!ck) {
      skippedKind++;
      continue;
    }
    const pos = model.proj.toWorld(n.lon, n.lat);
    const loc = locateOsmNode(model, n.id, pos);
    if (!loc) continue;
    let roadId: string;
    let s: number;
    if (loc.kind === 'interior') {
      roadId = loc.road.id;
      s = loc.s;
    } else {
      if (loc.node.degree >= 3) {
        onJunction++;
        continue;
      }
      const r = (byNode.get(loc.node.id) ?? [])[0];
      if (!r) continue;
      roadId = r.id;
      s = r.from === loc.node.id ? 0 : r.length;
    }
    const key = `${roadId}@${s.toFixed(0)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const road = model.roadById.get(roadId)!;
    const c: BuildCrossing = { id: `c${n.id}`, roadId, s, kind: ck.kind, refuge: ck.refuge };
    model.crossings.push(c);
    const setback = ((road.lanesForward + road.lanesBackward) * 3.3) / 2 + 1 + 8;
    if (s > setback && road.length - s > setback) midBlock.push(c);
  }
  model.stats.crossings = model.crossings.length;
  model.stats.crossingsMidBlock = midBlock.length;
  model.stats.crossingNodesSkippedByKind = skippedKind;
  model.stats.crossingNodesOnJunctionNode = onJunction;
  if (onJunction > 0) model.todos.push(`${onJunction} crossing nodes sit exactly on a junction node and were dropped (the builder cannot attach a crossing to a node).`);
  return { midBlock };
}

/** Junction names from the streets that meet there (TLV names for signalised junctions win). */
export function nameJunctions(model: SemanticModel): void {
  const byNode = roadsByNode(model);
  for (const n of model.nodes.values()) {
    if (n.name || n.degree < 3) continue;
    const roads = (byNode.get(n.id) ?? []).slice().sort((a, b) => rank(b) - rank(a));
    const names: string[] = [];
    for (const r of roads) {
      if (r.name && !names.includes(r.name)) names.push(r.name);
      if (names.length === 2) break;
    }
    if (names.length === 2) n.name = `${names[0]} / ${names[1]}`;
    else if (names.length === 1 && roads.length >= 3) n.name = names[0];
  }
}

const RANK: Record<string, number> = { motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, unclassified: 4, residential: 3, living_street: 2, service: 1, pedestrian: 0 };
function rank(r: SemRoad): number {
  return RANK[r.cls] ?? 0;
}

/** Sign helper used by several modules: a sign placed `s` metres along a road for one direction. */
export function sign(code: string, road: SemRoad, s: number, direction: 'forward' | 'backward', value?: number | string, id?: string): BuildSign {
  return { id, code, roadId: road.id, s: Math.max(0, Math.min(road.length, s)), direction, value };
}
