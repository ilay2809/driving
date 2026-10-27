/**
 * Tile index: every static world item is assigned to the tile of its representative point
 * (midpoint of a road, position of a junction / building centroid / prop / sign / signal
 * head). Pure TypeScript so the scheduling logic can be unit-tested.
 */
import { dist2, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Building, Crossing, Junction, Prop, Road, Sign, SignalGroup, WorldFile } from '@/world/schema';
import { polygonCentroid, roundaboutRings, type RoundaboutRing } from '@/world/roadGeometry';

export interface SignalHeadRef {
  group: SignalGroup;
  head: SignalGroup['heads'][number];
  /** For pedestrian heads: the crossing they belong to (the head faces across it). */
  crossing?: Crossing;
}

export interface TileContent {
  key: string;
  ix: number;
  iz: number;
  centre: Vec2;
  roads: Road[];
  junctions: Junction[];
  buildings: Building[];
  props: Prop[];
  signs: Sign[];
  crossings: Crossing[];
  heads: SignalHeadRef[];
  /** Roundabout central islands whose centre lies in this tile. */
  islands: RoundaboutRing[];
}

export function tileCoord(v: number, size: number): number {
  return Math.floor(v / size);
}

export function tileKey(ix: number, iz: number): string {
  return `${ix},${iz}`;
}

export function tileCentre(ix: number, iz: number, size: number): Vec2 {
  return [(ix + 0.5) * size, (iz + 0.5) * size];
}

/** Distance from a point to the nearest point of a tile's square. */
export function tileDistance(p: Vec2, ix: number, iz: number, size: number): number {
  const dx = Math.max(ix * size - p[0], 0, p[0] - (ix + 1) * size);
  const dz = Math.max(iz * size - p[1], 0, p[1] - (iz + 1) * size);
  return Math.hypot(dx, dz);
}

export interface TileWish {
  key: string;
  ix: number;
  iz: number;
  /** Distance from the camera to the tile's centre. */
  dist: number;
}

/** Tiles whose square comes within `radius` of `p`, nearest centre first. */
export function tilesWithin(p: Vec2, radius: number, size: number): TileWish[] {
  const out: TileWish[] = [];
  const ix0 = tileCoord(p[0] - radius, size);
  const ix1 = tileCoord(p[0] + radius, size);
  const iz0 = tileCoord(p[1] - radius, size);
  const iz1 = tileCoord(p[1] + radius, size);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      if (tileDistance(p, ix, iz, size) > radius) continue;
      out.push({ key: tileKey(ix, iz), ix, iz, dist: dist2(p, tileCentre(ix, iz, size)) });
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

export class TileIndex {
  readonly tiles = new Map<string, TileContent>();

  constructor(world: WorldFile, graph: RoadGraph, readonly size: number) {
    const at = (p: Vec2): TileContent => {
      const ix = tileCoord(p[0], size);
      const iz = tileCoord(p[1], size);
      const key = tileKey(ix, iz);
      let t = this.tiles.get(key);
      if (!t) {
        t = { key, ix, iz, centre: tileCentre(ix, iz, size), roads: [], junctions: [], buildings: [], props: [], signs: [], crossings: [], heads: [], islands: [] };
        this.tiles.set(key, t);
      }
      return t;
    };
    for (const r of world.roads) at(polylineMidpoint(r.centre)).roads.push(r);
    for (const j of world.junctions) at(j.position).junctions.push(j);
    for (const b of world.buildings) at(polygonCentroid(b.footprint)).buildings.push(b);
    for (const p of world.props) at(p.pos).props.push(p);
    for (const s of world.signs) at(s.pos).signs.push(s);
    for (const c of world.crossings) at([(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2]).crossings.push(c);
    for (const ctrl of world.signals) {
      for (const g of ctrl.groups) {
        const crossing = g.pedestrian ? g.crossings.map((id) => graph.crossings.get(id)).find((c) => !!c) : undefined;
        for (const head of g.heads) at(head.pos).heads.push({ group: g, head, crossing });
      }
    }
    for (const ring of roundaboutRings(world.junctions, graph.lanes, graph.connectors)) at(ring.centre).islands.push(ring);
  }

  get(key: string): TileContent | undefined {
    return this.tiles.get(key);
  }
}

export function polylineMidpoint(pts: Vec2[]): Vec2 {
  if (pts.length === 0) return [0, 0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist2(pts[i - 1]!, pts[i]!);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = dist2(pts[i - 1]!, pts[i]!);
    if (acc + L >= total / 2) {
      const t = L > 0 ? (total / 2 - acc) / L : 0;
      return [pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * t, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * t];
    }
    acc += L;
  }
  return pts[pts.length - 1]!;
}
