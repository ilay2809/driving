/**
 * Static collider specifications derived from a WorldFile (pure: no Rapier), so the
 * geometry can be unit-tested and so the dev harness can draw the same boxes.
 *
 *  - kerbs: thin boxes (0.12 m high, 0.25 m wide) along the outer edge of every
 *    kerb-side lane (lane.rightLine === 'kerb', and lane.leftLine === 'kerb' for
 *    lane 0 of one-way roads), chunked ≤ 20 m. Lane polylines are already trimmed
 *    at junction setbacks by the builder, so the kerbs stop before junctions.
 *  - buildings: convex hull of the extruded footprint (height from building.height).
 *  - props: cylinders for trunks / posts, boxes for benches, barriers, speed bumps.
 *
 * Specs are bucketed on a grid so only the cells near the player are instantiated.
 */
import { densify, offsetPolyline, pointAlong, projectOntoPolyline, type Vec2 } from '@/world/geo';
import type { Lane, Prop, WorldFile } from '@/world/schema';

export type ColliderKind = 'kerb' | 'building' | 'object' | 'bump' | 'vehicle' | 'pedestrian' | 'ground' | 'player';

export interface BoxSpec {
  shape: 'box';
  kind: ColliderKind;
  id: string;
  /** World centre [x, y, z]. */
  centre: [number, number, number];
  /** Half extents [x, y, z] in the box's local frame (local x along the segment). */
  half: [number, number, number];
  /** Rotation about world y (three.js rotation.y convention). */
  rotY: number;
}

export interface CylinderSpec {
  shape: 'cylinder';
  kind: ColliderKind;
  id: string;
  centre: [number, number, number];
  radius: number;
  halfHeight: number;
}

export interface HullSpec {
  shape: 'hull';
  kind: ColliderKind;
  id: string;
  /** xyz triples of the extruded footprint (bottom + top rings). */
  points: Float32Array;
  centre: [number, number, number];
}

export type ColliderSpec = BoxSpec | CylinderSpec | HullSpec;

export const KERB_HEIGHT = 0.12;
export const KERB_WIDTH = 0.25;
export const KERB_CHUNK = 20;
export const DEFAULT_CELL_SIZE = 100;
export const DEFAULT_ACTIVE_RADIUS = 400;

/** Boxes along a polyline: one per segment after densifying to ≤ `chunk` metres. */
export function boxesAlongPolyline(pts: Vec2[], idPrefix: string, kind: ColliderKind, halfWidth: number, height: number, chunk = KERB_CHUNK): BoxSpec[] {
  if (pts.length < 2) return [];
  const dense = densify(pts, chunk);
  const out: BoxSpec[] = [];
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const h = Math.atan2(dz, dx);
    out.push({
      shape: 'box',
      kind,
      id: `${idPrefix}:${i - 1}`,
      centre: [(a[0] + b[0]) / 2, height / 2, (a[1] + b[1]) / 2],
      half: [len / 2 + 0.06, height / 2, halfWidth], // 6 cm overlap hides gaps at polyline corners
      rotY: -h, // rotation.y = θ maps local +x to (cos θ, 0, −sin θ); we need (cos h, 0, sin h)
    });
  }
  return out;
}

/** Kerb edge polylines of a lane: right edge when rightLine is a kerb, left edge likewise. */
export function kerbEdgesOfLane(lane: Lane): { side: 'left' | 'right'; pts: Vec2[] }[] {
  const out: { side: 'left' | 'right'; pts: Vec2[] }[] = [];
  const off = lane.width / 2 + KERB_WIDTH / 2; // kerb face flush with the lane edge, box outside the lane
  if (lane.rightLine === 'kerb') out.push({ side: 'right', pts: offsetPolyline(lane.centre, off) });
  if (lane.leftLine === 'kerb' && lane.index === 0) out.push({ side: 'left', pts: offsetPolyline(lane.centre, -off) });
  return out;
}

export function kerbSegments(world: WorldFile, chunk = KERB_CHUNK): BoxSpec[] {
  const out: BoxSpec[] = [];
  for (const lane of world.lanes) {
    for (const edge of kerbEdgesOfLane(lane)) {
      out.push(...boxesAlongPolyline(edge.pts, `kerb:${lane.id}:${edge.side}`, 'kerb', KERB_WIDTH / 2, KERB_HEIGHT, chunk));
    }
  }
  return out;
}

export function buildingHulls(world: WorldFile): HullSpec[] {
  const out: HullSpec[] = [];
  for (const b of world.buildings) {
    const fp = b.footprint;
    if (fp.length < 3) continue;
    const h = Math.max(2.5, b.height);
    const pts = new Float32Array(fp.length * 6);
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < fp.length; i++) {
      const p = fp[i]!;
      pts[i * 6] = p[0];
      pts[i * 6 + 1] = 0;
      pts[i * 6 + 2] = p[1];
      pts[i * 6 + 3] = p[0];
      pts[i * 6 + 4] = h;
      pts[i * 6 + 5] = p[1];
      cx += p[0];
      cz += p[1];
    }
    out.push({ shape: 'hull', kind: 'building', id: `building:${b.id}`, points: pts, centre: [cx / fp.length, h / 2, cz / fp.length] });
  }
  return out;
}

const PROP_CYLINDERS: Partial<Record<Prop['kind'], { radius: number; halfHeight: number }>> = {
  tree: { radius: 0.2, halfHeight: 2.0 },
  lamp: { radius: 0.2, halfHeight: 3.0 },
  bus_stop: { radius: 0.2, halfHeight: 1.5 },
  bollard: { radius: 0.1, halfHeight: 0.45 },
  hydrant: { radius: 0.15, halfHeight: 0.4 },
  bin: { radius: 0.3, halfHeight: 0.5 },
};

export function propColliders(world: WorldFile): (CylinderSpec | BoxSpec)[] {
  const out: (CylinderSpec | BoxSpec)[] = [];
  const roads = new Map(world.roads.map((r) => [r.id, r]));
  world.props.forEach((p, i) => {
    const s = p.scale || 1;
    const cyl = PROP_CYLINDERS[p.kind];
    if (cyl) {
      out.push({ shape: 'cylinder', kind: 'object', id: `prop:${p.kind}:${i}`, centre: [p.pos[0], cyl.halfHeight * s, p.pos[1]], radius: cyl.radius * s, halfHeight: cyl.halfHeight * s });
      return;
    }
    if (p.kind === 'bench') {
      out.push({ shape: 'box', kind: 'object', id: `prop:bench:${i}`, centre: [p.pos[0], 0.25, p.pos[1]], half: [0.9 * s, 0.25, 0.25 * s], rotY: -p.heading });
    } else if (p.kind === 'barrier') {
      out.push({ shape: 'box', kind: 'object', id: `prop:barrier:${i}`, centre: [p.pos[0], 0.5, p.pos[1]], half: [1.0 * s, 0.5, 0.25], rotY: -p.heading });
    } else if (p.kind === 'speed_bump') {
      // a shallow 7 cm hump across the carriageway: the wheel rays feel it, the chassis never touches it
      const road = p.roadId ? roads.get(p.roadId) : undefined;
      let travel = p.heading;
      let width = 6;
      if (road) {
        const pr = projectOntoPolyline(road.centre, p.pos);
        travel = pointAlong(road.centre, pr.s).h;
        width = road.width;
      }
      out.push({ shape: 'box', kind: 'bump', id: `prop:bump:${i}`, centre: [p.pos[0], 0.035, p.pos[1]], half: [width / 2, 0.035, 0.2], rotY: -(travel + Math.PI / 2) });
    }
  });
  return out;
}

export function worldColliderSpecs(world: WorldFile): ColliderSpec[] {
  return [...kerbSegments(world), ...buildingHulls(world), ...propColliders(world)];
}

export function cellKey(x: number, z: number, size = DEFAULT_CELL_SIZE): string {
  return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}

export function bucketSpecs(specs: ColliderSpec[], size = DEFAULT_CELL_SIZE): Map<string, ColliderSpec[]> {
  const m = new Map<string, ColliderSpec[]>();
  for (const s of specs) {
    const k = cellKey(s.centre[0], s.centre[2], size);
    const list = m.get(k);
    if (list) list.push(s);
    else m.set(k, [s]);
  }
  return m;
}

/** Keys of the grid cells whose area comes within `radius` of (x, z). */
export function cellsAround(x: number, z: number, radius = DEFAULT_ACTIVE_RADIUS, size = DEFAULT_CELL_SIZE): string[] {
  const out: string[] = [];
  const r = Math.ceil(radius / size) + 1;
  const cx = Math.floor(x / size);
  const cz = Math.floor(z / size);
  const reach = radius + size * Math.SQRT1_2;
  for (let i = cx - r; i <= cx + r; i++) {
    for (let j = cz - r; j <= cz + r; j++) {
      const mx = (i + 0.5) * size;
      const mz = (j + 0.5) * size;
      if (Math.hypot(mx - x, mz - z) <= reach) out.push(`${i},${j}`);
    }
  }
  return out;
}
