/**
 * Small geometric helpers shared by the localiser and the detectors. Pure functions,
 * conventions per src/world/geo.ts (+x east, +z south, heading = atan2 of the forward vector,
 * positive lateral = right of travel).
 */
import { dist2, forwardOf, polylineLength, projectOntoPolyline, rightOf, type Vec2 } from '@/world/geo';
import type { Road } from '@/world/schema';

export interface Body {
  pos: Vec2;
  heading: number;
  length: number;
  width: number;
}

export function offsetPoint(p: Vec2, heading: number, along: number, lateral = 0): Vec2 {
  const f = forwardOf(heading);
  const r = rightOf(heading);
  return [p[0] + f[0] * along + r[0] * lateral, p[1] + f[1] * along + r[1] * lateral];
}

/** Centre of the front bumper. */
export function frontBumper(b: Body): Vec2 {
  return offsetPoint(b.pos, b.heading, b.length / 2);
}

/** Centre of the rear bumper. */
export function rearBumper(b: Body): Vec2 {
  return offsetPoint(b.pos, b.heading, -b.length / 2);
}

/** Signed distance of point p ahead of body b along its heading (negative = behind). */
export function aheadOf(b: { pos: Vec2; heading: number }, p: Vec2): number {
  const f = forwardOf(b.heading);
  return (p[0] - b.pos[0]) * f[0] + (p[1] - b.pos[1]) * f[1];
}

/** Signed lateral offset of point p relative to body b (positive = to its right). */
export function lateralOf(b: { pos: Vec2; heading: number }, p: Vec2): number {
  const r = rightOf(b.heading);
  return (p[0] - b.pos[0]) * r[0] + (p[1] - b.pos[1]) * r[1];
}

export interface AlongResult {
  /** Arc length of the projection; < 0 before the start, > length beyond the end. */
  s: number;
  /** Lateral offset from the (extended) polyline, positive = right of travel. */
  lateral: number;
  /** Euclidean distance to the polyline itself (not extended). */
  distance: number;
  /** Heading of the polyline at the projection. */
  h: number;
}

/**
 * Project q onto a polyline, extrapolating linearly beyond both ends so that
 * positions just past a lane end get s > length (and just before, s < 0).
 */
export function alongPolyline(pts: Vec2[], q: Vec2, totalLength?: number): AlongResult {
  const n = pts.length;
  if (n === 0) return { s: 0, lateral: 0, distance: Infinity, h: 0 };
  if (n === 1) return { s: 0, lateral: 0, distance: dist2(pts[0]!, q), h: 0 };
  const pr = projectOntoPolyline(pts, q);
  if (pr.segment === 0) {
    const a = pts[0]!;
    const b = pts[1]!;
    const L = dist2(a, b);
    if (L > 0) {
      const ux = (b[0] - a[0]) / L;
      const uz = (b[1] - a[1]) / L;
      const along = (q[0] - a[0]) * ux + (q[1] - a[1]) * uz;
      if (along < 0) {
        const lateral = (q[0] - a[0]) * -uz + (q[1] - a[1]) * ux;
        return { s: along, lateral, distance: pr.distance, h: Math.atan2(uz, ux) };
      }
    }
  }
  if (pr.segment === n - 2) {
    const a = pts[n - 2]!;
    const b = pts[n - 1]!;
    const L = dist2(a, b);
    if (L > 0) {
      const ux = (b[0] - a[0]) / L;
      const uz = (b[1] - a[1]) / L;
      const along = (q[0] - b[0]) * ux + (q[1] - b[1]) * uz;
      if (along > 0) {
        const lateral = (q[0] - b[0]) * -uz + (q[1] - b[1]) * ux;
        const total = totalLength ?? polylineLength(pts);
        return { s: total + along, lateral, distance: pr.distance, h: Math.atan2(uz, ux) };
      }
    }
  }
  return { s: pr.s, lateral: pr.lateral, distance: pr.distance, h: pr.h };
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Distance from point p to segment ab. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
}

function orient(p: Vec2, q: Vec2, r: Vec2): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = Math.sign(orient(a, b, c));
  const o2 = Math.sign(orient(a, b, d));
  const o3 = Math.sign(orient(c, d, a));
  const o4 = Math.sign(orient(c, d, b));
  return o1 !== o2 && o3 !== o4;
}

/** Minimum distance between two segments. */
export function segmentDistance(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): number {
  if (segmentsIntersect(a0, a1, b0, b1)) return 0;
  return Math.min(pointSegmentDistance(a0, b0, b1), pointSegmentDistance(a1, b0, b1), pointSegmentDistance(b0, a0, a1), pointSegmentDistance(b1, a0, a1));
}

/** Axis segment (rear bumper → front bumper) of a body. */
export function axisOf(b: Body): [Vec2, Vec2] {
  return [rearBumper(b), frontBumper(b)];
}

/** The four corners of a body's footprint (front-right, front-left, rear-left, rear-right). */
export function rectCorners(b: Body): [Vec2, Vec2, Vec2, Vec2] {
  const f = forwardOf(b.heading);
  const r = rightOf(b.heading);
  const hl = b.length / 2;
  const hw = b.width / 2;
  const [x, z] = b.pos;
  return [
    [x + f[0] * hl + r[0] * hw, z + f[1] * hl + r[1] * hw],
    [x + f[0] * hl - r[0] * hw, z + f[1] * hl - r[1] * hw],
    [x - f[0] * hl - r[0] * hw, z - f[1] * hl - r[1] * hw],
    [x - f[0] * hl + r[0] * hw, z - f[1] * hl + r[1] * hw],
  ];
}

function pointInConvex(p: Vec2, poly: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const o = orient(a, b, p);
    if (o === 0) continue;
    const s = Math.sign(o);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Clearance between two bodies (oriented rectangles); 0 when they overlap. */
export function bodyDistance(a: Body, b: Body): number {
  const A = rectCorners(a);
  const B = rectCorners(b);
  if (A.some((p) => pointInConvex(p, B)) || B.some((p) => pointInConvex(p, A))) return 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const d = segmentDistance(A[i]!, A[(i + 1) % 4]!, B[j]!, B[(j + 1) % 4]!);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Clearance between a body and a point (e.g. a pedestrian treated as a disc of `radius`). */
export function bodyPointDistance(a: Body, p: Vec2, radius = 0): number {
  const A = rectCorners(a);
  if (pointInConvex(p, A)) return 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) best = Math.min(best, pointSegmentDistance(p, A[i]!, A[(i + 1) % 4]!));
  return Math.max(0, best - radius);
}

/** Magnitude of the velocity difference between two moving bodies. */
export function relativeSpeed(a: { heading: number; speed: number }, b: { heading: number; speed: number }): number {
  const fa = forwardOf(a.heading);
  const fb = forwardOf(b.heading);
  return Math.hypot(fa[0] * a.speed - fb[0] * b.speed, fa[1] * a.speed - fb[1] * b.speed);
}

/** Lateral offset of pos from the road centre line, in the road's FORWARD direction (positive = right). */
export function roadLateral(road: Road, pos: Vec2): number {
  return projectOntoPolyline(road.centre, pos).lateral;
}

/**
 * Carriageway edges in road-lateral coordinates. The builder centres one-way roads on the
 * centre line and puts forward lanes to the right / backward lanes to the left otherwise.
 */
export function carriagewayEdges(road: Road): { left: number; right: number } {
  const nF = road.lanesForward.length;
  const nB = road.lanesBackward.length;
  if (road.oneway) return { left: -road.width / 2, right: road.width / 2 };
  const w = road.width / Math.max(1, nF + nB);
  return { left: -nB * w, right: nF * w };
}

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
export function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
