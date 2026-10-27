/**
 * Validation report for a built WorldFile: dangling lanes, lanes unreachable from the
 * largest strongly-connected component, over-sized junctions, degenerate roads,
 * duplicate ids, invalid routes and spawn points without a lane.
 */
import { RoadGraph } from '@/world/graph';
import type { WorldFile } from '@/world/schema';

export interface ValidationReport {
  danglingLanes: string[];
  unreachableLanes: number;
  unreachableLaneIds: string[];
  /** Why lanes are outside the main component: cut by the data extent, one-way sources/sinks, or genuinely isolated. */
  unreachableByCategory: { edge: number; onewaySourceOrSink: number; interior: number };
  interiorUnreachableLaneIds: string[];
  largestSccLanes: number;
  bigJunctions: { id: string; arms: number }[];
  zeroLengthRoads: string[];
  duplicateIds: string[];
  invalidRoutes: { id: string; reason: string }[];
  spawnsWithoutLane: string[];
  spawnsWithUnknownLane: string[];
  /** Everything above as one-line messages (empty = clean). */
  problems: string[];
}

/** Tarjan's SCC over the lane graph (edges = connectors), iterative to survive deep graphs. */
export function laneSccs(world: WorldFile): Map<string, number> {
  const next = new Map<string, string[]>();
  const connToLane = new Map<string, string>();
  for (const c of world.connectors) connToLane.set(c.id, c.toLane);
  for (const l of world.lanes) next.set(l.id, l.next.map((cid) => connToLane.get(cid)!).filter((x) => x !== undefined));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comp = new Map<string, number>();
  let idx = 0;
  let compId = 0;
  for (const start of next.keys()) {
    if (index.has(start)) continue;
    const work: { v: string; i: number }[] = [{ v: start, i: 0 }];
    index.set(start, idx);
    low.set(start, idx);
    idx++;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const top = work[work.length - 1]!;
      const succ = next.get(top.v) ?? [];
      if (top.i < succ.length) {
        const w = succ[top.i++]!;
        if (!index.has(w)) {
          index.set(w, idx);
          low.set(w, idx);
          idx++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, index.get(w)!));
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1]!.v;
          low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!));
        }
        if (low.get(top.v) === index.get(top.v)) {
          for (;;) {
            const w = stack.pop()!;
            onStack.delete(w);
            comp.set(w, compId);
            if (w === top.v) break;
          }
          compId++;
        }
      }
    }
  }
  return comp;
}

export interface ValidateOptions {
  /** Extent of the source data (metres); lanes touching its edge are reported as 'edge'. */
  area?: { minX: number; minZ: number; maxX: number; maxZ: number };
  edgeMargin?: number;
}

export function validateWorld(world: WorldFile, opts: ValidateOptions = {}): ValidationReport {
  const g = new RoadGraph(world);
  const area = opts.area ?? world.bbox;
  const margin = opts.edgeMargin ?? 80;
  const nearEdge = (p: [number, number]) => p[0] < area.minX + margin || p[0] > area.maxX - margin || p[1] < area.minZ + margin || p[1] > area.maxZ - margin;
  const problems: string[] = [];
  const danglingLanes: string[] = [];
  for (const l of world.lanes) {
    if (l.next.length > 0) continue;
    const j = g.junctions.get(l.to);
    if (j && j.kind !== 'dead_end') danglingLanes.push(l.id);
  }
  // SCC over drive lanes only (bus / parking lanes are not part of the car network)
  const comp = laneSccs(world);
  const sizes = new Map<number, number>();
  for (const l of world.lanes) {
    if (l.kind !== 'drive') continue;
    const c = comp.get(l.id)!;
    sizes.set(c, (sizes.get(c) ?? 0) + 1);
  }
  let largest = -1;
  let largestSize = 0;
  for (const [c, n] of sizes) {
    if (n > largestSize) {
      largestSize = n;
      largest = c;
    }
  }
  const unreachableLaneIds = world.lanes.filter((l) => l.kind === 'drive' && comp.get(l.id) !== largest).map((l) => l.id);
  // Categorise by the weakly-connected group of unreachable roads: a one-way chain that
  // leads to the data extent is 'edge' as a whole, not just its last lane.
  const unreachableByCategory = { edge: 0, onewaySourceOrSink: 0, interior: 0 };
  const interiorUnreachableLaneIds: string[] = [];
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const unreachableRoads = new Set(unreachableLaneIds.map((id) => g.lane(id).roadId));
  for (const rid of unreachableRoads) {
    const r = g.road(rid);
    if (!parent.has(r.from)) parent.set(r.from, r.from);
    if (!parent.has(r.to)) parent.set(r.to, r.to);
    union(r.from, r.to);
  }
  const groupTouchesEdge = new Map<string, boolean>();
  const groupHasSourceOrSink = new Map<string, boolean>();
  for (const id of unreachableLaneIds) {
    const l = g.lane(id);
    const road = g.road(l.roadId);
    const grp = find(road.from);
    if (road.centre.some(nearEdge)) groupTouchesEdge.set(grp, true);
    if (road.oneway && (l.next.length === 0 || l.prev.length === 0)) groupHasSourceOrSink.set(grp, true);
  }
  for (const id of unreachableLaneIds) {
    const road = g.road(g.lane(id).roadId);
    const grp = find(road.from);
    if (groupTouchesEdge.get(grp)) unreachableByCategory.edge++;
    else if (groupHasSourceOrSink.get(grp)) unreachableByCategory.onewaySourceOrSink++;
    else {
      unreachableByCategory.interior++;
      interiorUnreachableLaneIds.push(id);
    }
  }
  const bigJunctions = world.junctions
    .map((j) => ({ id: j.id, arms: new Set([...j.approaches.map((a) => a.roadId), ...j.exits.map((e) => e.roadId)]).size }))
    .filter((x) => x.arms > 6);
  const zeroLengthRoads = world.roads.filter((r) => r.length < 0.5).map((r) => r.id);
  const duplicateIds: string[] = [];
  const check = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) duplicateIds.push(`${kind}:${id}`);
      seen.add(id);
    }
  };
  check('road', world.roads.map((r) => r.id));
  check('lane', world.lanes.map((l) => l.id));
  check('junction', world.junctions.map((j) => j.id));
  check('connector', world.connectors.map((c) => c.id));
  check('crossing', world.crossings.map((c) => c.id));
  check('sign', world.signs.map((s) => s.id));
  check('building', world.buildings.map((b) => b.id));
  check('area', world.areas.map((a) => a.id));
  check('parking', world.parking.map((p) => p.id));
  check('spawn', world.spawnPoints.map((s) => s.id));
  check('route', world.routes.map((r) => r.id));
  const invalidRoutes: { id: string; reason: string }[] = [];
  for (const r of world.routes) {
    const sp = g.spawnPoints.get(r.spawnId);
    if (!sp) {
      invalidRoutes.push({ id: r.id, reason: `unknown spawn ${r.spawnId}` });
      continue;
    }
    if (!sp.laneId) {
      invalidRoutes.push({ id: r.id, reason: `spawn ${r.spawnId} has no laneId` });
      continue;
    }
    if (r.waypoints.some((w) => !g.junctions.has(w))) {
      invalidRoutes.push({ id: r.id, reason: 'unknown junction in waypoints' });
      continue;
    }
    if (!g.routeViaJunctions(sp.laneId, r.waypoints)) invalidRoutes.push({ id: r.id, reason: 'routeViaJunctions returned undefined' });
  }
  const spawnsWithoutLane = world.spawnPoints.filter((s) => !s.laneId).map((s) => s.id);
  const spawnsWithUnknownLane = world.spawnPoints.filter((s) => s.laneId && !g.lanes.has(s.laneId)).map((s) => s.id);

  if (danglingLanes.length > 0) problems.push(`${danglingLanes.length} lanes end at a junction without any connector (e.g. ${danglingLanes.slice(0, 5).join(', ')})`);
  if (unreachableLaneIds.length > 0) problems.push(`${unreachableLaneIds.length} drive lanes are outside the largest strongly-connected component (${largestSize} lanes): ${unreachableByCategory.edge} cut by the data extent, ${unreachableByCategory.onewaySourceOrSink} one-way sources/sinks, ${unreachableByCategory.interior} interior`);
  if (bigJunctions.length > 0) problems.push(`${bigJunctions.length} junctions have more than 6 arms (e.g. ${bigJunctions.slice(0, 5).map((b) => `${b.id}:${b.arms}`).join(', ')})`);
  if (zeroLengthRoads.length > 0) problems.push(`${zeroLengthRoads.length} zero-length roads`);
  if (duplicateIds.length > 0) problems.push(`duplicate ids: ${duplicateIds.slice(0, 10).join(', ')}`);
  for (const r of invalidRoutes) problems.push(`route ${r.id}: ${r.reason}`);
  if (spawnsWithoutLane.length > 0) problems.push(`spawn points without laneId: ${spawnsWithoutLane.join(', ')}`);
  if (spawnsWithUnknownLane.length > 0) problems.push(`spawn points with unknown laneId: ${spawnsWithUnknownLane.join(', ')}`);
  return { danglingLanes, unreachableLanes: unreachableLaneIds.length, unreachableLaneIds, unreachableByCategory, interiorUnreachableLaneIds, largestSccLanes: largestSize, bigJunctions, zeroLengthRoads, duplicateIds, invalidRoutes, spawnsWithoutLane, spawnsWithUnknownLane, problems };
}
