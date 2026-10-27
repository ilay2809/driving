/**
 * Planar geometry helpers for the data pipeline (metres, +x east, +z south).
 * Everything here is pure and deterministic.
 */
import { dist2, projectOntoPolyline, type Vec2 } from '@/world/geo';

export interface BBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function bboxOf(pts: Vec2[]): BBox {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return { minX, minZ, maxX, maxZ };
}

export function bboxContains(b: BBox, p: Vec2, margin = 0): boolean {
  return p[0] >= b.minX - margin && p[0] <= b.maxX + margin && p[1] >= b.minZ - margin && p[1] <= b.maxZ + margin;
}

/** Perpendicular distance from p to the segment a-b. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
}

/** Douglas–Peucker simplification; the first and last points are always kept. */
export function simplifyPolyline(pts: Vec2[], tolerance: number): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [i0, i1] = stack.pop()!;
    if (i1 - i0 < 2) continue;
    let best = -1;
    let bestD = tolerance;
    const a = pts[i0]!;
    const b = pts[i1]!;
    for (let i = i0 + 1; i < i1; i++) {
      const d = pointSegmentDistance(pts[i]!, a, b);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]!);
  return out;
}

/** Remove consecutive (near-)duplicate points. */
export function dedupePoints(pts: Vec2[], minDist = 0.05): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || dist2(last, p) >= minDist) out.push(p);
  }
  return out;
}

/**
 * Simplify a ring (no repeated closing point) to at most `maxVertices` points by
 * increasing the tolerance until it fits. Returns at least a triangle, or [] when
 * the ring degenerates.
 */
export function simplifyRing(ring: Vec2[], tolerance: number, maxVertices: number): Vec2[] {
  let pts = dedupePoints(ring, 0.02);
  if (pts.length >= 2 && dist2(pts[0]!, pts[pts.length - 1]!) < 0.02) pts = pts.slice(0, -1);
  if (pts.length < 3) return [];
  let tol = tolerance;
  for (let iter = 0; iter < 8; iter++) {
    // close the ring for DP so the closing edge is simplified too, then reopen it
    const closed = simplifyPolyline([...pts, pts[0]!], tol);
    const open = closed.slice(0, -1);
    if (open.length <= maxVertices || tol > 64) {
      pts = open;
      break;
    }
    tol *= 2;
  }
  // DP on a ring keeps the (arbitrary) first point; remove it when it is collinear
  if (pts.length > 3) {
    const a = pts[pts.length - 1]!;
    const b = pts[0]!;
    const c = pts[1]!;
    if (pointSegmentDistance(b, a, c) < tolerance) pts = pts.slice(1);
  }
  return pts.length >= 3 ? pts : [];
}

/** Signed area (shoelace). Positive when the ring is counter-clockwise in the x/z plane. */
export function signedArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j]!;
    const q = ring[i]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function ringArea(ring: Vec2[]): number {
  return Math.abs(signedArea(ring));
}

export function centroidOf(ring: Vec2[]): Vec2 {
  const a = signedArea(ring);
  if (Math.abs(a) < 1e-6) {
    let x = 0;
    let z = 0;
    for (const p of ring) {
      x += p[0];
      z += p[1];
    }
    return [x / ring.length, z / ring.length];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j]!;
    const q = ring[i]!;
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cz += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

export function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function roundPoint(p: Vec2, decimals = 2): Vec2 {
  return [roundTo(p[0], decimals), roundTo(p[1], decimals)];
}

/** Uniform grid spatial index for points and (sampled) polylines / bboxes. */
export class GridIndex<T> {
  private cells = new Map<string, T[]>();
  constructor(public readonly size: number) {}
  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }
  private cell(v: number): number {
    return Math.floor(v / this.size);
  }
  insertPoint(p: Vec2, v: T): void {
    const k = this.key(this.cell(p[0]), this.cell(p[1]));
    const list = this.cells.get(k);
    if (list) list.push(v);
    else this.cells.set(k, [v]);
  }
  insertBBox(b: BBox, v: T): void {
    const x0 = this.cell(b.minX);
    const x1 = this.cell(b.maxX);
    const z0 = this.cell(b.minZ);
    const z1 = this.cell(b.maxZ);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        const list = this.cells.get(k);
        if (list) list.push(v);
        else this.cells.set(k, [v]);
      }
    }
  }
  /** Insert a polyline by the bbox of each segment (fine for roads with few points). */
  insertPolyline(pts: Vec2[], v: T): void {
    const seen = new Set<string>();
    for (let i = 1; i < pts.length; i++) {
      const b = bboxOf([pts[i - 1]!, pts[i]!]);
      const x0 = this.cell(b.minX);
      const x1 = this.cell(b.maxX);
      const z0 = this.cell(b.minZ);
      const z1 = this.cell(b.maxZ);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const k = this.key(x, z);
          if (seen.has(k)) continue;
          seen.add(k);
          const list = this.cells.get(k);
          if (list) list.push(v);
          else this.cells.set(k, [v]);
        }
      }
    }
    if (pts.length === 1) this.insertPoint(pts[0]!, v);
  }
  /** Candidates whose cell is within `radius` of p (caller filters by exact distance). */
  query(p: Vec2, radius: number): T[] {
    const out: T[] = [];
    const seen = new Set<T>();
    const r = Math.ceil(radius / this.size);
    const cx = this.cell(p[0]);
    const cz = this.cell(p[1]);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const list = this.cells.get(this.key(cx + i, cz + j));
        if (!list) continue;
        for (const v of list) {
          if (!seen.has(v)) {
            seen.add(v);
            out.push(v);
          }
        }
      }
    }
    return out;
  }
  queryBBox(b: BBox): T[] {
    const out: T[] = [];
    const seen = new Set<T>();
    const x0 = this.cell(b.minX);
    const x1 = this.cell(b.maxX);
    const z0 = this.cell(b.minZ);
    const z1 = this.cell(b.maxZ);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.cells.get(this.key(x, z));
        if (!list) continue;
        for (const v of list) {
          if (!seen.has(v)) {
            seen.add(v);
            out.push(v);
          }
        }
      }
    }
    return out;
  }
}

/** Nearest polyline (by perpendicular distance) among candidates. */
export function nearestPolyline<T>(p: Vec2, candidates: T[], pointsOf: (c: T) => Vec2[], maxDist: number): { item: T; s: number; lateral: number; distance: number; h: number } | undefined {
  let best: { item: T; s: number; lateral: number; distance: number; h: number } | undefined;
  for (const c of candidates) {
    const pr = projectOntoPolyline(pointsOf(c), p);
    if (pr.distance <= maxDist && (!best || pr.distance < best.distance)) best = { item: c, s: pr.s, lateral: pr.lateral, distance: pr.distance, h: pr.h };
  }
  return best;
}

/**
 * Join open polylines (identified by their endpoint node ids) into longer chains,
 * reversing pieces when needed. Returns closed rings and open chains separately.
 * Used for OSM multipolygon members and coastline ways.
 */
export function joinChains<T extends { first: number; last: number; nodeIds: number[]; points: Vec2[] }>(pieces: T[]): { rings: { nodeIds: number[]; points: Vec2[] }[]; open: { nodeIds: number[]; points: Vec2[] }[] } {
  const rings: { nodeIds: number[]; points: Vec2[] }[] = [];
  const open: { nodeIds: number[]; points: Vec2[] }[] = [];
  const pool = pieces.map((p) => ({ nodeIds: p.nodeIds.slice(), points: p.points.slice() }));
  const used = new Array<boolean>(pool.length).fill(false);
  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let nodeIds = pool[i]!.nodeIds.slice();
    let points = pool[i]!.points.slice();
    let extended = true;
    while (extended && nodeIds[0] !== nodeIds[nodeIds.length - 1]) {
      extended = false;
      const last = nodeIds[nodeIds.length - 1];
      const first = nodeIds[0];
      for (let j = 0; j < pool.length; j++) {
        if (used[j]) continue;
        const q = pool[j]!;
        const qf = q.nodeIds[0];
        const ql = q.nodeIds[q.nodeIds.length - 1];
        if (qf === last) {
          nodeIds = nodeIds.concat(q.nodeIds.slice(1));
          points = points.concat(q.points.slice(1));
        } else if (ql === last) {
          nodeIds = nodeIds.concat(q.nodeIds.slice().reverse().slice(1));
          points = points.concat(q.points.slice().reverse().slice(1));
        } else if (ql === first) {
          nodeIds = q.nodeIds.concat(nodeIds.slice(1));
          points = q.points.concat(points.slice(1));
        } else if (qf === first) {
          nodeIds = q.nodeIds.slice().reverse().concat(nodeIds.slice(1));
          points = q.points.slice().reverse().concat(points.slice(1));
        } else continue;
        used[j] = true;
        extended = true;
        break;
      }
    }
    if (nodeIds.length >= 4 && nodeIds[0] === nodeIds[nodeIds.length - 1]) rings.push({ nodeIds: nodeIds.slice(0, -1), points: points.slice(0, -1) });
    else open.push({ nodeIds, points });
  }
  return { rings, open };
}

/**
 * Normalise a Hebrew/English street name for fuzzy matching: quotes and geresh
 * variants are dropped, "שד'" becomes "שדרות", double yod/vav spellings collapse
 * (OSM writes אינשטיין, the municipality איינשטיין), punctuation becomes spaces.
 */
export function normaliseName(s: string): string {
  // (\b is ASCII-only in JS regexes, so Hebrew tokens are delimited by whitespace explicitly)
  return s
    .replace(/[״"”“]/g, '')
    .replace(/[׳'’`]/g, '')
    .replace(/[-–—/]/g, ' ')
    .replace(/[.,()]/g, ' ')
    .replace(/(^|\s)שד(?=\s|$)/g, '$1שדרות')
    .replace(/יי/g, 'י')
    .replace(/וו/g, 'ו')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
