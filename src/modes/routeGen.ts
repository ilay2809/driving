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

const TURN_WEIGHT: Record<string, number> = { straight: 1.0, slight_left: 0.8, slight_right: 0.8, left: 0.6, right: 0.7, sharp_left: 0.3, sharp_right: 0.3, uturn: 0.02, merge_left: 0.8, merge_right: 0.8 };

export function generateRoute(graph: RoadGraph, startLaneId: string, opts: RouteGenOptions): PathResult {
  const target = opts.targetLength ?? 6500;
  const avoid = new Set(opts.avoidKinds ?? ['bus', 'bike', 'parking', 'shoulder']);
  const laneIds: string[] = [startLaneId];
  const connectorIds: string[] = [];
  const recent: string[] = [];
  let length = graph.lane(startLaneId).length;
  let cur = startLaneId;
  let guard = 0;
  while (length < target && guard++ < 2000) {
    const options = graph.connectorsFrom(cur).filter((c) => !avoid.has(graph.lane(c.toLane).kind));
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
    // finish on a quiet street so the examiner can ask to pull over
    if (length >= target && graph.road(graph.lane(cur).roadId).cls !== 'residential') {
      // allow up to +1.5 km to find a residential street
      if (length < target + 1500) continue;
    }
  }
  return { laneIds, connectorIds, length };
}

function weightOf(c: Connector, recent: string[], graph: RoadGraph): number {
  let w = TURN_WEIGHT[c.turn] ?? 0.5;
  const road = graph.road(graph.lane(c.toLane).roadId);
  if (road.cls === 'motorway' || road.cls === 'trunk') w *= 0.05; // not part of a city test
  if (road.cls === 'service') w *= 0.3;
  if (recent.includes(road.id)) w *= 0.15; // avoid loops
  const dead = graph.junction(graph.lane(c.toLane).to).kind === 'dead_end';
  if (dead) w *= 0.05;
  return w;
}
