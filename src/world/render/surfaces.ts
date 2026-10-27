/**
 * Static ground-level geometry of a tile: carriageways, junction surfaces, kerbs,
 * sidewalks, lane markings, stop lines, crossings and lane arrows. Everything is
 * appended to three MeshBuffers (asphalt / solid / marking) — one draw call each per tile.
 */
import type { RoadGraph } from '@/world/graph';
import type { Crossing, Junction, Lane, Road } from '@/world/schema';
import {
  KERB_HEIGHT,
  KERB_WIDTH,
  MARKING_Y,
  RAISED_CROSSING_HEIGHT,
  carriagewayRibbon,
  junctionKerbs,
  junctionSurface,
  kerbPieces,
  laneArrow,
  laneMarkings,
  raisedCrossingSurface,
  roadExtent,
  sidewalkPieces,
  stopLineMarking,
  zebraMarkings,
  type KerbColour,
  type KerbPiece,
  type MarkingColour,
  type RoundaboutRing,
} from '@/world/roadGeometry';
import type { MeshBuffer, RGB } from './MeshBuffer';
import { PALETTE, rgb } from './palette';

export interface SurfaceBuffers {
  asphalt: MeshBuffer;
  solid: MeshBuffer;
  marking: MeshBuffer;
}

const ASPHALT = rgb(PALETTE.asphalt);
const SIDEWALK = rgb(PALETTE.sidewalk);
const KERB: Record<KerbColour, RGB> = {
  grey: rgb(PALETTE.kerb.grey),
  red: rgb(PALETTE.kerb.red),
  white: rgb(PALETTE.kerb.white),
  blue: rgb(PALETTE.kerb.blue),
  yellow: rgb(PALETTE.kerb.yellow),
};
const MARKING: Record<MarkingColour, RGB> = { white: rgb(PALETTE.marking.white), yellow: rgb(PALETTE.marking.yellow) };

export function addKerb(k: KerbPiece, solid: MeshBuffer): void {
  const colour = KERB[k.colour];
  solid.strip(k, KERB_HEIGHT, colour);
  if (k.wall) {
    const towards = k.inner.map((p, i) => {
      const o = k.outer[i] ?? k.outer[k.outer.length - 1]!;
      return [p[0] - o[0], p[1] - o[1]] as [number, number];
    });
    solid.wall(k.inner, towards, 0, KERB_HEIGHT, colour);
  }
}

export function addRoad(road: Road, graph: RoadGraph, b: SurfaceBuffers): void {
  if (road.width <= 0 || road.centre.length < 2) return;
  const extent = roadExtent(road, graph.lanes);
  if (extent.s1 - extent.s0 < 0.05) return;
  b.asphalt.ribbon(carriagewayRibbon(road, extent), 0, ASPHALT);
  const parking = graph.parkingByRoad.get(road.id) ?? [];
  for (const k of kerbPieces(road, extent, parking)) addKerb(k, b.solid);
  for (const s of sidewalkPieces(road, extent)) b.solid.strip(s, KERB_HEIGHT, SIDEWALK);
  const lanes: Lane[] = [];
  for (const id of [...road.lanesForward, ...road.lanesBackward]) {
    const l = graph.lanes.get(id);
    if (l) lanes.push(l);
  }
  for (const m of laneMarkings(road, lanes, extent)) b.marking.ribbon(m.ribbon, MARKING_Y, MARKING[m.colour]);
  for (const lane of lanes) b.marking.triangles2(laneArrow(lane), MARKING_Y, MARKING.white);
}

export function addJunction(j: Junction, graph: RoadGraph, b: SurfaceBuffers): void {
  const surf = junctionSurface(j, (id) => graph.roads.get(id), graph.lanes);
  if (surf) {
    b.asphalt.polygon(surf.polygon, [], 0, ASPHALT);
    const { kerbs, sidewalks } = junctionKerbs(surf);
    for (const k of kerbs) addKerb(k, b.solid);
    for (const s of sidewalks) b.solid.strip(s, KERB_HEIGHT, SIDEWALK);
  }
  for (const ap of j.approaches) for (const sl of stopLineMarking(ap)) b.marking.ribbon(sl.ribbon, MARKING_Y, MARKING.white);
}

/** Central island of a roundabout: kerb ring, grass top and a low mound. */
export function addRoundaboutIsland(ring: RoundaboutRing, b: SurfaceBuffers): void {
  const [cx, cz] = ring.centre;
  const r = ring.islandRadius;
  const segments = Math.max(16, Math.ceil(r * 4));
  const circle = (radius: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius]);
    }
    return pts;
  };
  const outer = circle(r);
  const inner = circle(r - KERB_WIDTH);
  b.solid.stripXZ(inner, outer, KERB_HEIGHT, KERB.grey);
  b.solid.wall(
    outer,
    outer.map((p) => [p[0] - cx, p[1] - cz] as [number, number]),
    0,
    KERB_HEIGHT,
    KERB.grey,
  );
  const grass = rgb(PALETTE.island);
  const mound = rgb(PALETTE.islandMound);
  const top = circle(r - KERB_WIDTH);
  b.solid.polygon(top.slice(0, -1), [], KERB_HEIGHT, grass);
  const moundBase = circle(Math.max(0.5, (r - KERB_WIDTH) * 0.7));
  const apexY = KERB_HEIGHT + Math.min(0.8, r * 0.12);
  for (let i = 0; i < segments; i++) b.solid.triangle3([moundBase[i]![0], KERB_HEIGHT + 0.01, moundBase[i]![1]], [moundBase[i + 1]![0], KERB_HEIGHT + 0.01, moundBase[i + 1]![1]], [cx, apexY, cz], mound, [0, 1, 0]);
}

export function addCrossing(c: Crossing, b: SurfaceBuffers): void {
  let y = MARKING_Y;
  const raised = raisedCrossingSurface(c);
  if (raised) {
    const h = RAISED_CROSSING_HEIGHT;
    b.asphalt.polygon(raised.top, [], h, ASPHALT);
    for (const r of raised.ramps) {
      const [p0, p1, p2, p3] = r as [[number, number], [number, number], [number, number], [number, number]];
      b.asphalt.quad3([p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p2[0], h, p2[1]], [p3[0], h, p3[1]], ASPHALT, [0, 1, 0]);
    }
    y = h + MARKING_Y;
  }
  for (const z of zebraMarkings(c)) b.marking.ribbon(z.ribbon, y, MARKING.white);
}
