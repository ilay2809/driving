/**
 * The Yarkon as a boundary: the product's world is "North Tel Aviv, north of the
 * Yarkon". The river's own OSM geometry (waterway=river ways named ירקון) is joined
 * into one polyline, and roads lying entirely south of it (beyond a margin) are left
 * out of the network. Buildings and areas south of the river are kept as scenery.
 */
import type { Projector, Vec2 } from '@/world/geo';
import { joinChains, pointInRing } from '../geom';
import type { OsmData } from './parse';

export const RIVER_NAME = /ירקון/;
/** Roads within this distance south of the river stay (bridge approaches, the bank road). */
export const RIVER_SOUTH_MARGIN = 120;

/** Joined polyline of the river, ordered west → east, or undefined when the data has none. */
export function riverPolyline(osm: OsmData, proj: Projector): Vec2[] | undefined {
  const pieces = [...osm.ways.values()]
    .filter((w) => w.tags.waterway === 'river' && RIVER_NAME.test(`${w.tags.name ?? ''} ${w.tags['name:he'] ?? ''}`))
    .map((w) => {
      const nodeIds = w.nodes.filter((id) => osm.nodes.has(id));
      return { first: nodeIds[0]!, last: nodeIds[nodeIds.length - 1]!, nodeIds, points: nodeIds.map((id) => proj.toWorld(osm.nodes.get(id)!.lon, osm.nodes.get(id)!.lat)) };
    })
    .filter((p) => p.nodeIds.length >= 2);
  if (pieces.length === 0) return undefined;
  // Ways of the main channel do not always share node ids (weirs / islands split the
  // river into pieces), so after joining by node id the chains are ordered west → east
  // by proximity. Tiny pieces (island banks) are dropped.
  const { open, rings } = joinChains(pieces);
  const chains = [...open, ...rings]
    .filter((c) => c.points.length >= 5)
    .map((c) => (c.points[0]![0] > c.points[c.points.length - 1]![0] ? c.points.slice().reverse() : c.points.slice()))
    .sort((a, b) => a[0]![0] - b[0]![0]);
  const pts: Vec2[] = [];
  for (const c of chains) {
    const last = pts[pts.length - 1];
    // skip a chain that lies entirely inside the span already covered (a side channel)
    if (last && c[c.length - 1]![0] <= last[0]) continue;
    pts.push(...(last ? c.filter((p) => p[0] > last[0]) : c));
  }
  return pts.length >= 2 ? pts : undefined;
}

/**
 * Predicate "this road belongs to the world": at least one point north of the river
 * (or within `margin` south of it). The south region is the polygon closed far below
 * the river, after shifting the river `margin` metres south.
 */
export function northOfRiverFilter(river: Vec2[], extent: { minX: number; maxX: number; maxZ: number }, margin = RIVER_SOUTH_MARGIN): (points: Vec2[]) => boolean {
  const shifted: Vec2[] = river.map((p) => [p[0], p[1] + margin]);
  const far = extent.maxZ + 5000;
  const south: Vec2[] = [[extent.minX - 5000, shifted[0]![1]], ...shifted, [extent.maxX + 5000, shifted[shifted.length - 1]![1]], [extent.maxX + 5000, far], [extent.minX - 5000, far]];
  return (points) => points.some((p) => !pointInRing(p, south));
}
