/**
 * Random test-route generator: a seeded walk over the lane graph that produces a
 * realistic 20–30 minute examination route (mix of turns, main roads and quiet
 * streets) when the world has no hand-authored routes, or when the candidate picks
 * "random".
 */
import type { RoadGraph, PathResult } from '@/world/graph';
import type { Connector } from '@/world/schema';

export interface RouteGenOptions {
  /** Target length in metres (default 6,500 ≈ 20–25 min of city driving). */
  targetLength?: number;
  rng: () => number;
  /** Lane kinds that may not be used. */
  avoidKinds?: string[];
}

const FAST_ROADS = new Set<string>(['motorway', 'motorway_link']);
const TURN_WEIGHT: Record<string, number> = { straight: 1.0, slight_left: 0.8, slight_right: 0.8, left: 0.6, right: 0.7, sharp_left: 0.3, sharp_right: 0.3, uturn: 0.02, merge_left: 0.8, merge_right: 0.8 };

export function generateRoute(graph: RoadGraph, startLaneId: string, opts: RouteGenOptions): PathResult {
  const target = opts.targetLength ?? 6500;
  const avoid = new Set(opts.avoidKinds ?? ['bus', 'bike', 'parking', 'shoulder']);
  const laneIds: string[] = [startLaneId];
  const connectorIds: string[] = [];
  const recent: string[] = [];
  const escapeMemo = new Map<string, boolean>();
  let length = graph.lane(startLaneId).length;
  let cur = startLaneId;
  let guard = 0;
  while (guard++ < 2000) {
    // finish on a quiet, reasonably long street (not a junction stub or a dead end) so the
    // examiner can ask to pull over at the end: up to +800 m for a residential street,
    // +1.5 km for any proper street
    if (length >= target && (goodFinish(graph, cur, length < target + 800) || length >= target + 1500)) break;
    let options = graph.connectorsFrom(cur);
    // excluded lane kinds and motorways (not part of a city test; trunk roads such as דרך
    // נמיר are, but rarely) are only entered when there is no other way
    const city = options.filter((c) => !blocked(graph, c.toLane, avoid));
    if (city.length > 0) options = city;
    // a U-turn is only ever the last resort (dead end / no other way out), and a lane whose
    // only way out is a U-turn or a motorway ramp (a cul-de-sac pocket) is not entered when
    // there is a choice
    const noUturn = options.filter((c) => c.turn !== 'uturn');
    if (noUturn.length > 0) options = noUturn;
    const onward = options.filter((c) => escapes(graph, c.toLane, avoid, 5, escapeMemo));
    if (onward.length > 0) options = onward;
    if (options.length === 0) break;
    const weighted = options.map((c) => ({ c, w: weightOf(c, recent, graph) }));
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let pick = opts.rng() * total;
    let chosen: Connector = weighted[weighted.length - 1]!.c;
    for (const x of weighted) {
      pick -= x.w;
      if (pick <= 0) {
        chosen = x.c;
        break;
      }
    }
    connectorIds.push(chosen.id);
    laneIds.push(chosen.toLane);
    length += chosen.length + graph.lane(chosen.toLane).length;
    recent.push(graph.lane(chosen.toLane).roadId);
    if (recent.length > 12) recent.shift();
    cur = chosen.toLane;
  }
  return { laneIds, connectorIds, length };
}

function blocked(graph: RoadGraph, laneId: string, avoid: Set<string>): boolean {
  const lane = graph.lane(laneId);
  return avoid.has(lane.kind) || FAST_ROADS.has(graph.road(lane.roadId).cls);
}

/**
 * The lane leads somewhere: within `depth` junctions there is a way on without a U-turn
 * (cul-de-sac pockets — clusters of dead-end streets — force U-turns and are avoided).
 */
function escapes(graph: RoadGraph, laneId: string, avoid: Set<string>, depth: number, memo: Map<string, boolean>): boolean {
  const key = `${laneId}@${depth}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  const next = graph.connectorsFrom(laneId).filter((c) => c.turn !== 'uturn' && !blocked(graph, c.toLane, avoid));
  let ok: boolean;
  if (next.length === 0) ok = false;
  else if (depth <= 1) ok = true;
  else ok = next.some((c) => escapes(graph, c.toLane, avoid, depth - 1, memo));
  memo.set(key, ok);
  return ok;
}

function goodFinish(graph: RoadGraph, laneId: string, residentialOnly: boolean): boolean {
  const lane = graph.lane(laneId);
  if (lane.length < 40) return false;
  if (graph.junction(lane.to).kind === 'dead_end') return false;
  return !residentialOnly || graph.road(lane.roadId).cls === 'residential';
}

function weightOf(c: Connector, recent: string[], graph: RoadGraph): number {
  let w = TURN_WEIGHT[c.turn] ?? 0.5;
  const road = graph.road(graph.lane(c.toLane).roadId);
  if (road.cls === 'motorway' || road.cls === 'trunk') w *= 0.05; // not part of a city test
  if (road.cls === 'service') w *= 0.15; // car parks / alleys: rarely part of a test
  if (recent.includes(road.id)) w *= 0.15; // avoid loops
  const dead = graph.junction(graph.lane(c.toLane).to).kind === 'dead_end';
  if (dead) w *= 0.01; // a dead end forces a U-turn
  return w;
}
