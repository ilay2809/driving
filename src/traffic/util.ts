/**
 * Small pure geometry / numeric helpers used across the traffic module.
 */
import { dist2, type Vec2 } from '@/world/geo';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Positive modulo. */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Pick a random element with a seeded rng (undefined for an empty list). */
export function pick<T>(rng: () => number, list: readonly T[]): T | undefined {
  if (list.length === 0) return undefined;
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

export function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/** Intersection parameter of segment p→p2 with segment q→q2 (t along p, u along q) or undefined. */
export function segmentIntersection(p: Vec2, p2: Vec2, q: Vec2, q2: Vec2): { t: number; u: number } | undefined {
  const rx = p2[0] - p[0];
  const rz = p2[1] - p[1];
  const sx = q2[0] - q[0];
  const sz = q2[1] - q[1];
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-9) return undefined;
  const qpx = q[0] - p[0];
  const qpz = q[1] - p[1];
  const t = (qpx * sz - qpz * sx) / denom;
  const u = (qpx * rz - qpz * rx) / denom;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return undefined;
  return { t: clamp(t, 0, 1), u: clamp(u, 0, 1) };
}

/**
 * Arc-length along a polyline where it crosses the segment a→b (first crossing), or undefined.
 * `tolerance` extends the crossing segment at both ends (lane centres may end exactly on it).
 */
export function polylineCrossingS(pts: Vec2[], a: Vec2, b: Vec2, tolerance = 0.5): number | undefined {
  const L = dist2(a, b);
  if (L < 1e-6) return undefined;
  const ux = ((b[0] - a[0]) / L) * tolerance;
  const uz = ((b[1] - a[1]) / L) * tolerance;
  const a2: Vec2 = [a[0] - ux, a[1] - uz];
  const b2: Vec2 = [b[0] + ux, b[1] + uz];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    const seg = dist2(p, q);
    const hit = segmentIntersection(p, q, a2, b2);
    if (hit) return acc + hit.t * seg;
    acc += seg;
  }
  return undefined;
}

export interface Obb {
  pos: Vec2;
  heading: number;
  length: number;
  width: number;
}

/**
 * Signed clearance between two oriented boxes (separating-axis test on the 4 edge normals):
 * > 0 = gap in metres (lower bound), ≤ 0 = overlap.
 */
export function obbGap(a: Obb, b: Obb): number {
  const axes: Vec2[] = [
    [Math.cos(a.heading), Math.sin(a.heading)],
    [-Math.sin(a.heading), Math.cos(a.heading)],
    [Math.cos(b.heading), Math.sin(b.heading)],
    [-Math.sin(b.heading), Math.cos(b.heading)],
  ];
  const dx = b.pos[0] - a.pos[0];
  const dz = b.pos[1] - a.pos[1];
  let best = -Infinity;
  for (const ax of axes) {
    const ra = (Math.abs(ax[0] * Math.cos(a.heading) + ax[1] * Math.sin(a.heading)) * a.length) / 2 + (Math.abs(-ax[0] * Math.sin(a.heading) + ax[1] * Math.cos(a.heading)) * a.width) / 2;
    const rb = (Math.abs(ax[0] * Math.cos(b.heading) + ax[1] * Math.sin(b.heading)) * b.length) / 2 + (Math.abs(-ax[0] * Math.sin(b.heading) + ax[1] * Math.cos(b.heading)) * b.width) / 2;
    const d = Math.abs(dx * ax[0] + dz * ax[1]);
    const gap = d - ra - rb;
    if (gap > best) best = gap;
  }
  return best;
}

/** Distance from point q to the segment a→b. */
export function pointSegmentDistance(q: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? clamp(((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / L2, 0, 1) : 0;
  return Math.hypot(q[0] - (a[0] + dx * t), q[1] - (a[1] + dz * t));
}

/** Insertion into a list kept sorted by `key`. */
export function insertSorted<T>(list: T[], item: T, key: (t: T) => number): void {
  const k = key(item);
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(list[mid]!) <= k) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, item);
}
