/**
 * Geographic + coordinate conventions shared by the data pipeline and the runtime.
 *
 *  World frame (metres, Three.js y-up):
 *    +x = east, +z = south (so -z = north), y = up. Ground is y = 0.
 *  A 2-D point is [x, z].
 *
 *  Heading h (radians) = math angle of the forward vector in the x/z plane:
 *    forward = (cos h, sin h)  →  h = 0 east, h = -π/2 north, h = +π/2 south, h = ±π west.
 *  Compass bearing (degrees, clockwise from north) = deg(h + π/2) mod 360.
 *  Three.js Object3D.rotation.y for an object whose local forward is -z: rotY = -h - π/2.
 *
 *  Right-hand traffic: the right side of a lane is at heading h + π/2.
 */

export type Vec2 = [number, number];

/** Reference origin of the North Tel Aviv world (centre of the area). */
export const WORLD_ORIGIN = { lat: 32.125, lon: 34.825 };

const M_PER_DEG_LAT = 110_574; // metres per degree of latitude (WGS84, ~32°N)
const M_PER_DEG_LON_EQ = 111_320; // metres per degree of longitude at the equator

export interface Projector {
  origin: { lat: number; lon: number };
  toWorld(lon: number, lat: number): Vec2;
  toLonLat(x: number, z: number): { lon: number; lat: number };
}

/** Local equirectangular projection — error < 0.1 % within ±10 km of the origin. */
export function createProjector(origin = WORLD_ORIGIN): Projector {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  const mPerDegLon = M_PER_DEG_LON_EQ * cosLat;
  return {
    origin,
    toWorld(lon, lat) {
      return [(lon - origin.lon) * mPerDegLon, -(lat - origin.lat) * M_PER_DEG_LAT];
    },
    toLonLat(x, z) {
      return { lon: origin.lon + x / mPerDegLon, lat: origin.lat - z / M_PER_DEG_LAT };
    },
  };
}

export const TWO_PI = Math.PI * 2;

/** Normalise an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  return a;
}

/** Signed smallest difference b - a in (-π, π]. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

export function headingOf(from: Vec2, to: Vec2): number {
  return Math.atan2(to[1] - from[1], to[0] - from[0]);
}

export function forwardOf(h: number): Vec2 {
  return [Math.cos(h), Math.sin(h)];
}

/** Unit vector pointing to the right of heading h (right-hand traffic side). */
export function rightOf(h: number): Vec2 {
  return [Math.cos(h + Math.PI / 2), Math.sin(h + Math.PI / 2)];
}

export function headingToCompassDeg(h: number): number {
  const d = ((h + Math.PI / 2) * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

export function compassDegToHeading(deg: number): number {
  return wrapAngle((deg * Math.PI) / 180 - Math.PI / 2);
}

/** Three.js rotation.y for a model whose local forward axis is -z. */
export function headingToRotationY(h: number): number {
  return -h - Math.PI / 2;
}

export function rotationYToHeading(rotY: number): number {
  return wrapAngle(-rotY - Math.PI / 2);
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return Math.hypot(dx, dz);
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function polylineLength(pts: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist2(pts[i - 1]!, pts[i]!);
  return L;
}

/** Point and heading at arc-length s along a polyline (clamped). */
export function pointAlong(pts: Vec2[], s: number): { p: Vec2; h: number; segment: number } {
  if (pts.length === 1) return { p: pts[0]!, h: 0, segment: 0 };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const L = dist2(a, b);
    if (s <= acc + L || i === pts.length - 1) {
      const t = L > 0 ? Math.min(1, Math.max(0, (s - acc) / L)) : 0;
      return { p: lerp2(a, b, t), h: headingOf(a, b), segment: i - 1 };
    }
    acc += L;
  }
  const a = pts[pts.length - 2]!;
  const b = pts[pts.length - 1]!;
  return { p: b, h: headingOf(a, b), segment: pts.length - 2 };
}

/**
 * Project point q onto a polyline. Returns the arc-length position s, the lateral
 * offset (positive = to the RIGHT of travel direction), the distance and the segment index.
 */
export function projectOntoPolyline(pts: Vec2[], q: Vec2): { s: number; lateral: number; distance: number; segment: number; h: number } {
  let best = { s: 0, lateral: 0, distance: Infinity, segment: 0, h: 0 };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / L2)) : 0;
    const px = a[0] + dx * t;
    const pz = a[1] + dz * t;
    const d = Math.hypot(q[0] - px, q[1] - pz);
    if (d < best.distance) {
      const L = Math.sqrt(L2);
      const h = Math.atan2(dz, dx);
      // right vector = (cos(h+90°), sin(h+90°)) = (-sin h, cos h)
      const lateral = (q[0] - px) * -Math.sin(h) + (q[1] - pz) * Math.cos(h);
      best = { s: acc + L * t, lateral, distance: d, segment: i - 1, h };
    }
    acc += Math.hypot(dx, dz);
  }
  return best;
}

/** Offset a polyline laterally by d metres (positive = right of travel direction). */
export function offsetPolyline(pts: Vec2[], d: number): Vec2[] {
  if (pts.length < 2) return pts.map((p) => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    const p = pts[i]!;
    let hx: number, hz: number;
    if (i === 0) {
      hx = next[0] - p[0];
      hz = next[1] - p[1];
    } else if (i === pts.length - 1) {
      hx = p[0] - prev[0];
      hz = p[1] - prev[1];
    } else {
      // bisector of the two adjacent segment directions
      const h1 = Math.atan2(p[1] - prev[1], p[0] - prev[0]);
      const h2 = Math.atan2(next[1] - p[1], next[0] - p[0]);
      const hm = h1 + angleDiff(h1, h2) / 2;
      const half = angleDiff(h1, h2) / 2;
      const scale = Math.min(3, 1 / Math.max(0.2, Math.cos(half))); // mitre, limited
      const r = rightOf(hm);
      out.push([p[0] + r[0] * d * scale, p[1] + r[1] * d * scale]);
      continue;
    }
    const h = Math.atan2(hz, hx);
    const r = rightOf(h);
    out.push([p[0] + r[0] * d, p[1] + r[1] * d]);
  }
  return out;
}

/** Resample a polyline so consecutive points are at most `step` metres apart. */
export function densify(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const L = dist2(a, b);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push(lerp2(a, b, k / n));
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

export function kmhToMps(v: number): number {
  return v / 3.6;
}
export function mpsToKmh(v: number): number {
  return v * 3.6;
}
