/**
 * Spawn points and routes: resolved against a BUILT world (RoadGraph) so that
 * every spawn point carries a laneId and every route is validated with
 * routeViaJunctions. Specs come from places.he.ts and data/overrides.
 */
import { createProjector, dist2, headingOf, pointAlong, compassDegToHeading, type Projector, type Vec2 } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import type { Junction, Lane, Road, Route, SpawnPoint, WorldFile } from '@/world/schema';
import { normaliseName } from './geom';
import type { RouteSpec, SpawnSpec, WaypointSpec } from './places.he';

export interface PlaceResolution {
  spawnPoints: SpawnPoint[];
  routes: Route[];
  /** Human-readable notes about fallbacks / dropped routes (go into the stats TODOs). */
  notes: string[];
  routeLengths: Record<string, number>;
}

function roadNames(road: Road): string[] {
  const out: string[] = [];
  if (road.name) out.push(normaliseName(road.name));
  if (road.nameEn) out.push(normaliseName(road.nameEn));
  return out;
}

function nameMatches(road: Road, query: string): boolean {
  const q = normaliseName(query);
  if (!q) return false;
  return roadNames(road).some((n) => n === q || n.includes(q) || (q.length >= 6 && q.includes(n) && n.length >= 4));
}

export function findRoadsByName(world: WorldFile, query: string): Road[] {
  return world.roads.filter((r) => nameMatches(r, query));
}

function roadMid(r: Road): Vec2 {
  return pointAlong(r.centre, r.length / 2).p;
}

function laneHeadingAt(lane: Lane, s: number): number {
  return pointAlong(lane.centre, s).h;
}

/** Junction arms as road ids (approaches ∪ exits). */
function junctionRoadIds(j: Junction): string[] {
  const ids = new Set<string>();
  for (const a of j.approaches) ids.add(a.roadId);
  for (const e of j.exits) ids.add(e.roadId);
  return [...ids];
}

export class PlaceResolver {
  readonly graph: RoadGraph;
  readonly proj: Projector;
  private junctionNames = new Map<string, Set<string>>();

  constructor(
    readonly world: WorldFile,
    proj?: Projector,
  ) {
    this.graph = new RoadGraph(world);
    this.proj = proj ?? createProjector(world.origin);
    for (const j of world.junctions) {
      const names = new Set<string>();
      for (const rid of junctionRoadIds(j)) for (const n of roadNames(this.graph.road(rid))) names.add(n);
      this.junctionNames.set(j.id, names);
    }
  }

  toWorld(lonLat: [number, number]): Vec2 {
    return this.proj.toWorld(lonLat[0], lonLat[1]);
  }

  /** A drive lane near a point, preferring the given heading. */
  laneNear(pos: Vec2, opts: { heading?: number; maxDist?: number; quiet?: boolean } = {}): { lane: Lane; s: number } | undefined {
    const maxDist = opts.maxDist ?? 40;
    let best: { lane: Lane; s: number; score: number } | undefined;
    for (const lane of this.graph.lanesWithin(pos, maxDist, ['drive'])) {
      const road = this.graph.road(lane.roadId);
      if (road.cls === 'motorway' || road.cls === 'trunk') continue;
      const m = this.graph.nearestLane(pos, { heading: opts.heading, maxDist, kinds: ['drive'], preferLaneId: lane.id });
      if (!m || m.lane.id !== lane.id) continue;
      let score = m.distance + Math.abs(m.headingError) * 4;
      if (opts.quiet) {
        if (road.cls === 'residential' || road.cls === 'living_street') score -= 10;
        if (road.oneway) score += 5;
        if (lane.length < 60) score += 8;
      }
      if (lane.length < 25) score += 15;
      if (!best || score < best.score) best = { lane, s: m.s, score };
    }
    return best ? { lane: best.lane, s: best.s } : undefined;
  }

  /** Place a spawn point on a lane: ≥ 10 m from the ends, heading along the lane. */
  spawnOnLane(id: string, name: string, lane: Lane, s: number, tags: SpawnPoint['tags']): SpawnPoint {
    const L = lane.length;
    const sc = L < 25 ? L / 2 : Math.min(Math.max(s, 10), L - 12);
    const at = pointAlong(lane.centre, sc);
    return { id, name, pos: [Math.round(at.p[0] * 100) / 100, Math.round(at.p[1] * 100) / 100], heading: Math.round(laneHeadingAt(lane, sc) * 1000) / 1000, laneId: lane.id, tags };
  }

  resolveSpawn(spec: SpawnSpec, notes: string[]): SpawnPoint | undefined {
    const hint = this.toWorld(spec.near);
    const heading = spec.bearingDeg !== undefined ? compassDegToHeading(spec.bearingDeg) : undefined;
    for (const street of spec.streets) {
      const roads = findRoadsByName(this.world, street).filter((r) => r.cls !== 'motorway' && r.cls !== 'trunk' && r.lanesForward.length > 0);
      if (roads.length === 0) continue;
      const scored = roads
        .map((r) => {
          let score = dist2(roadMid(r), hint);
          if (spec.quiet) {
            if (r.cls !== 'residential' && r.cls !== 'living_street' && r.cls !== 'unclassified') score += 150;
            if (r.oneway) score += 40;
          }
          if (r.length < 40) score += 60;
          return { r, score };
        })
        .sort((a, b) => a.score - b.score);
      const road = scored[0]!.r;
      // the lane whose direction best matches the requested bearing (or the forward lanes)
      const fwd = this.graph.lane(road.lanesForward[road.lanesForward.length - 1]!);
      const bwd = road.lanesBackward.length > 0 ? this.graph.lane(road.lanesBackward[road.lanesBackward.length - 1]!) : undefined;
      let lane = fwd;
      if (heading !== undefined && bwd) {
        const hf = laneHeadingAt(fwd, fwd.length / 2);
        const hb = laneHeadingAt(bwd, bwd.length / 2);
        if (Math.abs(Math.atan2(Math.sin(hb - heading), Math.cos(hb - heading))) < Math.abs(Math.atan2(Math.sin(hf - heading), Math.cos(hf - heading)))) lane = bwd;
      }
      if (lane.kind !== 'drive') lane = this.graph.lane(road.lanesForward[0]!);
      const s = Math.max(10, Math.min(lane.length - 12, lane.length * 0.35));
      return this.spawnOnLane(spec.id, spec.name, lane, s, spec.tags);
    }
    const near = this.laneNear(hint, { heading, maxDist: 250, quiet: spec.quiet });
    if (!near) {
      notes.push(`spawn ${spec.id}: no street named ${spec.streets.join(' / ')} and no lane within 250 m of the hint — dropped`);
      return undefined;
    }
    const road = this.graph.road(near.lane.roadId);
    notes.push(`spawn ${spec.id}: street ${spec.streets[0]} not found; placed on the nearest street ${road.name ?? road.nameEn ?? road.id}`);
    return this.spawnOnLane(spec.id, spec.name, near.lane, near.s, spec.tags);
  }

  /** Spawn point from a raw position (override files). */
  resolveSpawnAt(id: string, name: string, lonLat: [number, number], bearingDeg: number | undefined, tags: SpawnPoint['tags'], notes: string[]): SpawnPoint | undefined {
    const pos = this.toWorld(lonLat);
    const near = this.laneNear(pos, { heading: bearingDeg !== undefined ? compassDegToHeading(bearingDeg) : undefined, maxDist: 40 });
    if (!near) {
      notes.push(`spawn ${id}: no drive lane within 40 m of ${lonLat.join(',')} — dropped`);
      return undefined;
    }
    return this.spawnOnLane(id, name, near.lane, near.s, tags);
  }

  /** Candidate junctions for a waypoint spec. */
  junctionCandidates(wp: WaypointSpec): Junction[] {
    if ('junction' in wp) {
      const j = this.graph.junctions.get(wp.junction);
      return j ? [j] : [];
    }
    if ('near' in wp) {
      const pos = this.toWorld(wp.near);
      return this.graph
        .junctionsWithin(pos, 80)
        .filter((j) => j.approaches.length >= 2)
        .sort((a, b) => dist2(a.position, pos) - dist2(b.position, pos))
        .slice(0, 3);
    }
    const [a, b] = wp.streets.map(normaliseName);
    const out: Junction[] = [];
    for (const j of this.world.junctions) {
      if (j.approaches.length < 2) continue;
      const names = this.junctionNames.get(j.id)!;
      const has = (q: string) => [...names].some((n) => n === q || n.includes(q));
      if (has(a!) && has(b!)) out.push(j);
    }
    return out;
  }

  /** Resolve a route greedily: at each waypoint take the candidate junction with the shortest path. */
  resolveRoute(spec: RouteSpec, spawn: SpawnPoint, notes: string[]): { route: Route; length: number } | undefined {
    if (!spawn.laneId) return undefined;
    let cur = spawn.laneId;
    const waypoints: string[] = [];
    for (const [i, wp] of spec.waypoints.entries()) {
      const cands = this.junctionCandidates(wp);
      if (cands.length === 0) {
        notes.push(`route ${spec.id}: waypoint ${i + 1} (${describeWaypoint(wp)}) matches no junction — route dropped`);
        return undefined;
      }
      let best: { j: Junction; laneId: string; length: number } | undefined;
      for (const j of cands) {
        for (const ap of j.approaches) {
          for (const laneId of ap.laneIds) {
            if (laneId === cur) continue;
            const p = this.graph.findPath(cur, laneId);
            if (p && (!best || p.length < best.length)) best = { j, laneId, length: p.length };
          }
        }
      }
      if (!best) {
        notes.push(`route ${spec.id}: waypoint ${i + 1} (${describeWaypoint(wp)}) is unreachable from the previous one — route dropped`);
        return undefined;
      }
      waypoints.push(best.j.id);
      cur = best.laneId;
    }
    const check = this.graph.routeViaJunctions(spawn.laneId, waypoints);
    if (!check) {
      notes.push(`route ${spec.id}: routeViaJunctions failed after greedy resolution — route dropped`);
      return undefined;
    }
    return { route: { id: spec.id, name: spec.name, kind: spec.kind, spawnId: spawn.id, waypoints, notes: spec.notes }, length: check.length };
  }
}

function describeWaypoint(wp: WaypointSpec): string {
  if ('junction' in wp) return wp.junction;
  if ('near' in wp) return wp.near.join(',');
  return wp.streets.join(' / ');
}

export function resolvePlaces(world: WorldFile, spawnSpecs: SpawnSpec[], routeSpecs: RouteSpec[], extra: { spawns: { id: string; name: string; at: [number, number]; bearingDeg?: number; tags: SpawnPoint['tags'] }[]; routes: RouteSpec[] }): PlaceResolution {
  const resolver = new PlaceResolver(world);
  const notes: string[] = [];
  const spawnPoints: SpawnPoint[] = [];
  for (const spec of spawnSpecs) {
    const sp = resolver.resolveSpawn(spec, notes);
    if (sp) spawnPoints.push(sp);
  }
  for (const e of extra.spawns) {
    const sp = resolver.resolveSpawnAt(e.id, e.name, e.at, e.bearingDeg, e.tags, notes);
    if (sp) spawnPoints.push(sp);
  }
  const routes: Route[] = [];
  const routeLengths: Record<string, number> = {};
  for (const spec of [...routeSpecs, ...extra.routes]) {
    const spawn = spawnPoints.find((s) => s.id === spec.spawnId);
    if (!spawn) {
      notes.push(`route ${spec.id}: unknown spawn ${spec.spawnId} — dropped`);
      continue;
    }
    const r = resolver.resolveRoute(spec, spawn, notes);
    if (!r) continue;
    routes.push(r.route);
    routeLengths[spec.id] = Math.round(r.length);
    if (spec.kind === 'test' && (r.length < 5000 || r.length > 10000)) notes.push(`route ${spec.id}: length ${Math.round(r.length)} m is outside the 6–9 km test target`);
  }
  return { spawnPoints, routes, notes, routeLengths };
}

export { headingOf as _headingOf };
