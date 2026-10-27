/** Turn classification helpers and the indicator a movement requires. */
import type { RoadGraph } from '@/world/graph';
import type { Connector, Lane, Turn } from '@/world/schema';

export type TurnClass = 'left' | 'right' | 'straight' | 'uturn';
export type Side = 'left' | 'right';

export function isLeftTurn(t: Turn): boolean {
  return t === 'left' || t === 'slight_left' || t === 'sharp_left' || t === 'uturn';
}
export function isRightTurn(t: Turn): boolean {
  return t === 'right' || t === 'slight_right' || t === 'sharp_right';
}
export function turnClass(t: Turn): TurnClass {
  if (t === 'uturn') return 'uturn';
  if (isLeftTurn(t)) return 'left';
  if (isRightTurn(t)) return 'right';
  return 'straight';
}

const ringCache = new WeakMap<RoadGraph, Set<string>>();

/** Lanes that form roundabout rings (the Road record has no roundabout flag, the junctions do). */
export function ringLanes(graph: RoadGraph): Set<string> {
  let set = ringCache.get(graph);
  if (!set) {
    set = new Set<string>();
    for (const j of graph.junctions.values()) if (j.roundabout) for (const id of j.roundabout.ringLaneIds) set.add(id);
    ringCache.set(graph, set);
  }
  return set;
}

/**
 * Which indicator a movement needs. Roundabouts follow the Israeli practice taught in driving
 * schools: no indicator is required when entering or circulating (the builder classifies the
 * entry as a right turn), the right indicator is required when leaving the ring.
 */
export function requiredIndicator(graph: RoadGraph, c: Connector): Side | undefined {
  const j = graph.junctions.get(c.junctionId);
  if (j?.kind === 'roundabout') {
    const ring = ringLanes(graph);
    const fromRing = ring.has(c.fromLane);
    const toRing = ring.has(c.toLane);
    if (fromRing && !toRing) return 'right';
    return undefined;
  }
  if (isLeftTurn(c.turn)) return 'left';
  if (isRightTurn(c.turn)) return 'right';
  return undefined;
}

/** Two lanes of the same road running in the same direction (a lane change moves between them). */
export function areSiblings(graph: RoadGraph, a: Lane, b: Lane): boolean {
  if (a.roadId !== b.roadId || a.id === b.id) return false;
  const road = graph.roads.get(a.roadId);
  if (!road) return false;
  const fa = road.lanesForward.includes(a.id);
  const fb = road.lanesForward.includes(b.id);
  return fa === fb;
}
