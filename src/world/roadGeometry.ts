/**
 * Pure 2-D geometry derived from a WorldFile: carriageway ribbons, kerb and sidewalk
 * strips (with parking-strip kerb colours), junction surfaces and their outer kerbs,
 * lane markings, stop lines, zebra crossings and lane arrows.
 *
 * No THREE here — the renderer turns these into meshes and the physics module can
 * reuse them for kerb collision shapes. All distances in metres, coordinates per
 * src/world/geo.ts ([x, z], +x east, +z south). "Left"/"right" of a road are relative
 * to the road's forward direction (road.centre order), "inner"/"outer" of a strip
 * are relative to the carriageway (inner = road side).
 */
import { angleDiff, dist2, forwardOf, headingOf, lerp2, offsetPolyline, projectOntoPolyline, rightOf, type Vec2 } from './geo';
import { convexHull } from './builder';
import type { Approach, Connector, Crossing, Junction, KerbMarking, Lane, LineType, ParkingStrip, Road, Turn } from './schema';

export const KERB_HEIGHT = 0.12;
export const KERB_WIDTH = 0.25;
export const SIDEWALK_WIDTH = 2;
export const LINE_WIDTH = 0.12;
/** Centre-to-centre spacing of the two lines of a double line. */
export const DOUBLE_LINE_SPACING = 0.3;
export const DASH_LENGTH = 3;
export const DASH_GAP = 6;
export const STOP_LINE_WIDTH = 0.4;
export const ZEBRA_STRIPE = 0.5;
export const ZEBRA_GAP = 0.5;
/** Lane arrows are painted this far before the end of the lane (the stop line). */
export const ARROW_BEFORE_STOP = 8;
/** Length of one colour block of a patterned kerb (red/white …). */
export const KERB_PATTERN_LENGTH = 1;
export const RAISED_CROSSING_HEIGHT = 0.06;
export const RAISED_CROSSING_RAMP = 1.0;
/** Marking surfaces sit this high above the asphalt (the renderer also uses polygonOffset). */
export const MARKING_Y = 0.01;

export type Triangle = [Vec2, Vec2, Vec2];

/** Two polylines with 1:1 vertex correspondence; consecutive pairs form quads. */
export interface Ribbon {
  left: Vec2[];
  right: Vec2[];
}

/** A strip beside the carriageway: `inner` is the road side. Same 1:1 correspondence as Ribbon. */
export interface Strip {
  inner: Vec2[];
  outer: Vec2[];
}

export type KerbColour = 'grey' | 'red' | 'white' | 'blue' | 'yellow';

export interface KerbPiece extends Strip {
  colour: KerbColour;
  /** Draw a vertical face along `inner` (false for corner fans whose inner edge is degenerate). */
  wall: boolean;
}

export type MarkingColour = 'white' | 'yellow';

export interface MarkingPiece {
  colour: MarkingColour;
  ribbon: Ribbon;
}

export interface RoadExtent {
  /** Arc-length along road.centre where the lanes start (after the junction mouth at `from`). */
  s0: number;
  /** Arc-length where the lanes end (the junction mouth / stop line at `to`). */
  s1: number;
}

export interface JunctionEdge {
  a: Vec2;
  b: Vec2;
  /** True when this edge is the mouth of a road (no kerb there). */
  mouth: boolean;
  /** Outward unit normal of the edge. */
  normal: Vec2;
}

export interface JunctionSurface {
  id: string;
  polygon: Vec2[];
  edges: JunctionEdge[];
}

export interface RaisedCrossing {
  /** Plateau quad at RAISED_CROSSING_HEIGHT. */
  top: Vec2[];
  /** Ramps: first two points at ground level, last two at plateau level. */
  ramps: Vec2[][];
}

// ---------------------------------------------------------------------------------
// Centre line sampling

/**
 * Arc-length parametrised polyline with cached mitred offsets. `slice(d, s0, s1)` is the
 * core primitive: a lateral offset polyline between two arc-lengths whose end sections
 * are exactly perpendicular to the centre line (so junction mouths match the builder's
 * hull corners) and whose interior vertices are the mitred offsets of geo.offsetPolyline.
 */
export class CentreLine {
  readonly s: number[];
  readonly length: number;
  private readonly offsets = new Map<number, Vec2[]>();

  constructor(readonly pts: Vec2[]) {
    const s: number[] = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1]! + dist2(pts[i - 1]!, pts[i]!));
    this.s = s;
    this.length = s[s.length - 1] ?? 0;
  }

  /** Segment index i (pts[i] → pts[i+1]) and fraction t for arc-length s (clamped). */
  locate(s: number): { i: number; t: number } {
    const n = this.pts.length;
    if (n < 2) return { i: 0, t: 0 };
    if (s <= 0) return { i: 0, t: 0 };
    if (s >= this.length) return { i: n - 2, t: 1 };
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const L = this.s[lo + 1]! - this.s[lo]!;
    return { i: lo, t: L > 0 ? (s - this.s[lo]!) / L : 0 };
  }

  at(s: number): { p: Vec2; h: number } {
    if (this.pts.length === 1) return { p: this.pts[0]!, h: 0 };
    const { i, t } = this.locate(s);
    const a = this.pts[i]!;
    const b = this.pts[i + 1]!;
    return { p: lerp2(a, b, t), h: headingOf(a, b) };
  }

  /** Point at arc-length s displaced laterally by d (positive = right of travel), perpendicular section. */
  section(s: number, d: number): Vec2 {
    const { p, h } = this.at(s);
    const r = rightOf(h);
    return [p[0] + r[0] * d, p[1] + r[1] * d];
  }

  /** Cached mitred offset of the whole centre line. */
  offset(d: number): Vec2[] {
    const key = Math.round(d * 1000);
    let o = this.offsets.get(key);
    if (!o) {
      o = d === 0 ? this.pts.map((p) => [p[0], p[1]] as Vec2) : offsetPolyline(this.pts, d);
      this.offsets.set(key, o);
    }
    return o;
  }

  /** Offset polyline between s0 and s1 (see class doc). Always ≥ 2 points. */
  slice(d: number, s0: number, s1: number): Vec2[] {
    s0 = Math.max(0, Math.min(s0, this.length));
    s1 = Math.max(s0, Math.min(s1, this.length));
    const out: Vec2[] = [this.section(s0, d)];
    const off = this.offset(d);
    for (let i = 1; i < this.pts.length - 1; i++) {
      const si = this.s[i]!;
      if (si > s0 + 1e-6 && si < s1 - 1e-6) out.push(off[i]!);
    }
    out.push(this.section(s1, d));
    return out;
  }

  ribbon(dLeft: number, dRight: number, s0: number, s1: number): Ribbon {
    return { left: this.slice(dLeft, s0, s1), right: this.slice(dRight, s0, s1) };
  }

  strip(dInner: number, dOuter: number, s0: number, s1: number): Strip {
    return { inner: this.slice(dInner, s0, s1), outer: this.slice(dOuter, s0, s1) };
  }
}

const centreCache = new WeakMap<Road, CentreLine>();
export function centreLineOf(road: Road): CentreLine {
  let c = centreCache.get(road);
  if (!c) {
    c = new CentreLine(road.centre);
    centreCache.set(road, c);
  }
  return c;
}

// ---------------------------------------------------------------------------------
// Roads

/** Lane extent along the road centre (between the two junction mouths). */
export function roadExtent(road: Road, laneById: ReadonlyMap<string, Lane>): RoadExtent {
  const laneId = road.lanesForward[0] ?? road.lanesBackward[0];
  const lane = laneId ? laneById.get(laneId) : undefined;
  if (!lane || lane.centre.length < 2) return { s0: 0, s1: road.length };
  const a = projectOntoPolyline(road.centre, lane.centre[0]!).s;
  const b = projectOntoPolyline(road.centre, lane.centre[lane.centre.length - 1]!).s;
  return { s0: Math.min(a, b), s1: Math.max(a, b) };
}

/** Ribbon of the paved carriageway (total width road.width) between the junction mouths. */
export function carriagewayRibbon(road: Road, extent: RoadExtent): Ribbon {
  const cl = centreLineOf(road);
  return cl.ribbon(-road.width / 2, road.width / 2, extent.s0, extent.s1);
}

/** Simple polygon of the carriageway (left edge forward, right edge backward). */
export function carriagewayPolygon(road: Road, extent: RoadExtent): Vec2[] {
  const r = carriagewayRibbon(road, extent);
  return [...r.left, ...[...r.right].reverse()];
}

/** Kerb edge polylines (carriageway edges) of a road. */
export function kerbEdges(road: Road, extent: RoadExtent): { left: Vec2[]; right: Vec2[] } {
  const cl = centreLineOf(road);
  return { left: cl.slice(-road.width / 2, extent.s0, extent.s1), right: cl.slice(road.width / 2, extent.s0, extent.s1) };
}

/** Colour pattern of a kerb marking: one colour = plain, two = alternating 1 m blocks. */
export function kerbPattern(marking: KerbMarking): KerbColour[] {
  switch (marking) {
    case 'red_white':
      return ['red', 'white'];
    case 'blue_white':
      return ['blue', 'white'];
    case 'red_yellow':
      return ['red', 'yellow'];
    case 'disabled':
      return ['blue'];
    case 'loading':
      return ['yellow'];
    case 'none':
    default:
      return ['grey'];
  }
}

interface KerbInterval {
  s0: number;
  s1: number;
  marking: KerbMarking;
}

/** Split [s0, s1] into intervals with the kerb marking that applies (parking strips override the road default). */
export function kerbIntervals(road: Road, side: 'left' | 'right', extent: RoadExtent, parking: readonly ParkingStrip[]): KerbInterval[] {
  const base = side === 'left' ? road.kerbLeft : road.kerbRight;
  let intervals: KerbInterval[] = [{ s0: extent.s0, s1: extent.s1, marking: base }];
  for (const p of parking) {
    if (p.roadId !== road.id || p.side !== side) continue;
    const a = Math.max(extent.s0, Math.min(p.s0, p.s1));
    const b = Math.min(extent.s1, Math.max(p.s0, p.s1));
    if (b - a <= 1e-6) continue;
    const next: KerbInterval[] = [];
    for (const iv of intervals) {
      if (iv.s1 <= a || iv.s0 >= b) {
        next.push(iv);
        continue;
      }
      if (iv.s0 < a) next.push({ s0: iv.s0, s1: a, marking: iv.marking });
      next.push({ s0: Math.max(iv.s0, a), s1: Math.min(iv.s1, b), marking: p.kerb });
      if (iv.s1 > b) next.push({ s0: b, s1: iv.s1, marking: iv.marking });
    }
    intervals = next;
  }
  return intervals.filter((iv) => iv.s1 - iv.s0 > 1e-6);
}

/** Kerb strips (KERB_WIDTH wide, outside the carriageway) on both sides of a road, coloured by parking strips. */
export function kerbPieces(road: Road, extent: RoadExtent, parking: readonly ParkingStrip[]): KerbPiece[] {
  const cl = centreLineOf(road);
  const out: KerbPiece[] = [];
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1;
    const dIn = sign * (road.width / 2);
    const dOut = sign * (road.width / 2 + KERB_WIDTH);
    for (const iv of kerbIntervals(road, side, extent, parking)) {
      const pattern = kerbPattern(iv.marking);
      if (pattern.length === 1) {
        out.push({ colour: pattern[0]!, wall: true, ...cl.strip(dIn, dOut, iv.s0, iv.s1) });
        continue;
      }
      let k = 0;
      for (let s = iv.s0; s < iv.s1 - 1e-6; s += KERB_PATTERN_LENGTH, k++) {
        const e = Math.min(iv.s1, s + KERB_PATTERN_LENGTH);
        out.push({ colour: pattern[k % pattern.length]!, wall: true, ...cl.strip(dIn, dOut, s, e) });
      }
    }
  }
  return out;
}

/** Sidewalk strips (SIDEWALK_WIDTH wide) outside the kerb where the road has a sidewalk. */
export function sidewalkPieces(road: Road, extent: RoadExtent): Strip[] {
  const cl = centreLineOf(road);
  const out: Strip[] = [];
  const dKerb = road.width / 2 + KERB_WIDTH;
  if (road.sidewalkLeft) out.push(cl.strip(-dKerb, -(dKerb + SIDEWALK_WIDTH), extent.s0, extent.s1));
  if (road.sidewalkRight) out.push(cl.strip(dKerb, dKerb + SIDEWALK_WIDTH, extent.s0, extent.s1));
  return out;
}

// ---------------------------------------------------------------------------------
// Lane markings

const LINE_RANK: Record<LineType, number> = {
  none: 0,
  kerb: 0,
  dashed: 1,
  solid: 2,
  dashed_solid: 3,
  solid_dashed: 3,
  double_solid: 4,
  yellow_solid: 5,
};

export interface Boundary {
  /** Lateral offset from the road centre (road-forward frame). */
  offset: number;
  type: LineType;
  /** +1 when the lane that owns this line lies on the positive-lateral side of it, -1 otherwise. */
  laneSide: 1 | -1;
}

/** Lateral offset of a lane's centre relative to the road centre (road-forward frame). */
export function laneOffset(road: Road, lane: Lane): number {
  const mid = lane.centre[Math.floor(lane.centre.length / 2)]!;
  return projectOntoPolyline(road.centre, mid).lateral;
}

/**
 * Boundaries to paint for a road, each shared lane boundary once (the right line of lane k
 * and the left line of lane k+1 coincide; the "stronger" marking wins, e.g. the yellow bus
 * lane separator over a plain dashed line).
 */
export function roadBoundaries(road: Road, lanes: readonly Lane[]): Boundary[] {
  const byKey = new Map<number, Boundary>();
  const add = (b: Boundary) => {
    const key = Math.round(b.offset * 100);
    const prev = byKey.get(key);
    if (!prev || LINE_RANK[b.type] > LINE_RANK[prev.type]) byKey.set(key, b);
  };
  for (const lane of lanes) {
    if (lane.roadId !== road.id) continue;
    const forward = road.lanesForward.includes(lane.id);
    const o = laneOffset(road, lane);
    const half = lane.width / 2;
    if (forward) {
      add({ offset: o - half, type: lane.leftLine, laneSide: 1 });
      add({ offset: o + half, type: lane.rightLine, laneSide: -1 });
    } else {
      add({ offset: o + half, type: lane.leftLine, laneSide: -1 });
      add({ offset: o - half, type: lane.rightLine, laneSide: 1 });
    }
  }
  return [...byKey.values()].filter((b) => b.type !== 'none' && b.type !== 'kerb').sort((a, b) => a.offset - b.offset);
}

function dashes(cl: CentreLine, d: number, s0: number, s1: number, colour: MarkingColour, out: MarkingPiece[]): void {
  for (let s = s0; s < s1 - 0.5; s += DASH_LENGTH + DASH_GAP) {
    const e = Math.min(s1, s + DASH_LENGTH);
    out.push({ colour, ribbon: cl.ribbon(d - LINE_WIDTH / 2, d + LINE_WIDTH / 2, s, e) });
  }
}

function solidLine(cl: CentreLine, d: number, s0: number, s1: number, colour: MarkingColour, out: MarkingPiece[]): void {
  if (s1 - s0 < 0.05) return;
  out.push({ colour, ribbon: cl.ribbon(d - LINE_WIDTH / 2, d + LINE_WIDTH / 2, s0, s1) });
}

/** Painted lane lines of a road between its junction mouths (nothing inside junctions). */
export function laneMarkings(road: Road, lanes: readonly Lane[], extent: RoadExtent): MarkingPiece[] {
  const cl = centreLineOf(road);
  const out: MarkingPiece[] = [];
  const { s0, s1 } = extent;
  for (const b of roadBoundaries(road, lanes)) {
    const near = b.offset + (b.laneSide * DOUBLE_LINE_SPACING) / 2;
    const far = b.offset - (b.laneSide * DOUBLE_LINE_SPACING) / 2;
    switch (b.type) {
      case 'dashed':
        dashes(cl, b.offset, s0, s1, 'white', out);
        break;
      case 'solid':
        solidLine(cl, b.offset, s0, s1, 'white', out);
        break;
      case 'yellow_solid':
        solidLine(cl, b.offset, s0, s1, 'yellow', out);
        break;
      case 'double_solid':
        solidLine(cl, near, s0, s1, 'white', out);
        solidLine(cl, far, s0, s1, 'white', out);
        break;
      case 'dashed_solid':
        dashes(cl, near, s0, s1, 'white', out);
        solidLine(cl, far, s0, s1, 'white', out);
        break;
      case 'solid_dashed':
        solidLine(cl, near, s0, s1, 'white', out);
        dashes(cl, far, s0, s1, 'white', out);
        break;
      case 'none':
      case 'kerb':
      default:
        break;
    }
  }
  return out;
}

export const GIVE_WAY_DASH = 0.6;
export const GIVE_WAY_GAP = 0.3;
export const GIVE_WAY_LINE_WIDTH = 0.3;

/**
 * The line at the end of an approach, painted just before approach.stopLine (inside the lanes):
 * a solid STOP_LINE_WIDTH stop line where traffic must stop (stop sign, signals), a dashed
 * give-way line (קו המתנה) where it must yield (give way, roundabout entry), nothing on
 * approaches that have priority / the right-hand rule.
 */
export function stopLineMarking(approach: Approach): MarkingPiece[] {
  const line = approach.stopLine;
  if (!line) return [];
  const [l, r] = line;
  const len = dist2(l, r);
  if (len < 0.1) return [];
  // the line runs left→right across travel, so travel direction = line direction rotated -90°
  const d: Vec2 = [(r[0] - l[0]) / len, (r[1] - l[1]) / len];
  const f: Vec2 = [d[1], -d[0]];
  const at = (u: number, back: number): Vec2 => [l[0] + d[0] * u - f[0] * back, l[1] + d[1] * u - f[1] * back];
  switch (approach.control) {
    case 'stop':
    case 'signals':
      return [{ colour: 'white', ribbon: { left: [at(0, STOP_LINE_WIDTH), at(0, 0)], right: [at(len, STOP_LINE_WIDTH), at(len, 0)] } }];
    case 'give_way':
    case 'roundabout_entry': {
      const out: MarkingPiece[] = [];
      for (let u = 0; u < len - 0.1; u += GIVE_WAY_DASH + GIVE_WAY_GAP) {
        const e = Math.min(len, u + GIVE_WAY_DASH);
        out.push({ colour: 'white', ribbon: { left: [at(u, GIVE_WAY_LINE_WIDTH), at(u, 0)], right: [at(e, GIVE_WAY_LINE_WIDTH), at(e, 0)] } });
      }
      return out;
    }
    default:
      return [];
  }
}

/** Zebra stripes across a crossing (stripes run along the road, alternating ZEBRA_STRIPE / ZEBRA_GAP along the line). */
export function zebraMarkings(crossing: Crossing): MarkingPiece[] {
  if (crossing.kind === 'unmarked') return [];
  const [a, b] = crossing.line;
  const len = dist2(a, b);
  if (len < 1) return [];
  const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: Vec2 = [d[1], -d[0]]; // along the road
  const half = crossing.width / 2;
  const out: MarkingPiece[] = [];
  // the builder extends the line 0.3 m beyond each kerb; keep stripes on the carriageway
  const margin = 0.3;
  const usable = len - 2 * margin;
  const count = Math.floor((usable + ZEBRA_GAP) / (ZEBRA_STRIPE + ZEBRA_GAP));
  const start = margin + (usable - (count * (ZEBRA_STRIPE + ZEBRA_GAP) - ZEBRA_GAP)) / 2;
  for (let k = 0; k < count; k++) {
    const u0 = start + k * (ZEBRA_STRIPE + ZEBRA_GAP);
    const u1 = u0 + ZEBRA_STRIPE;
    const p = (u: number, v: number): Vec2 => [a[0] + d[0] * u + n[0] * v, a[1] + d[1] * u + n[1] * v];
    out.push({ colour: 'white', ribbon: { left: [p(u0, -half), p(u0, half)], right: [p(u1, -half), p(u1, half)] } });
  }
  return out;
}

/** Plateau and ramps of a raised crossing (undefined for other kinds). */
export function raisedCrossingSurface(crossing: Crossing): RaisedCrossing | undefined {
  if (crossing.kind !== 'raised') return undefined;
  const [a, b] = crossing.line;
  const len = dist2(a, b);
  if (len < 1) return undefined;
  const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: Vec2 = [d[1], -d[0]];
  const p = (u: number, v: number): Vec2 => [a[0] + d[0] * u + n[0] * v, a[1] + d[1] * u + n[1] * v];
  const half = crossing.width / 2;
  const m = 0.3;
  const top = [p(m, -half), p(len - m, -half), p(len - m, half), p(m, half)];
  const r = RAISED_CROSSING_RAMP;
  const rampA = [p(m, -half - r), p(len - m, -half - r), p(len - m, -half), p(m, -half)];
  const rampB = [p(m, half + r), p(len - m, half + r), p(len - m, half), p(m, half)];
  return { top, ramps: [rampA, rampB] };
}

// ---------------------------------------------------------------------------------
// Lane arrows

/** Arrow shapes in lane-local coordinates: u along travel (+ = forward), v lateral (+ = right). */
function arrowShape(turns: readonly Turn[]): [number, number][][] {
  const tris: [number, number][][] = [];
  const rect = (u0: number, u1: number, v0: number, v1: number) => {
    tris.push([[u0, v0], [u1, v0], [u1, v1]], [[u0, v0], [u1, v1], [u0, v1]]);
  };
  const W = 0.3; // shaft width
  const left = turns.some((t) => t === 'left' || t === 'sharp_left' || t === 'uturn');
  const right = turns.some((t) => t === 'right' || t === 'sharp_right');
  // slight turns and merges are painted as a straight arrow
  const straight = turns.some((t) => t === 'straight' || t === 'merge_left' || t === 'merge_right' || t === 'slight_left' || t === 'slight_right') || (!left && !right);
  rect(-2.0, straight ? 1.0 : 0.3, -W / 2, W / 2);
  if (straight) tris.push([[1.0, -0.55], [2.0, 0], [1.0, 0.55]]); // head pointing forward
  const sideHead = (sign: 1 | -1) => {
    // horizontal bar off the shaft, then a head pointing sideways
    const uBar = straight ? -0.4 : 0.3;
    rect(uBar - W / 2, uBar + W / 2, sign > 0 ? 0 : -0.7, sign > 0 ? 0.7 : 0);
    tris.push([[uBar - 0.5, sign * 0.7], [uBar, sign * 1.5], [uBar + 0.5, sign * 0.7]]);
  };
  if (left) sideHead(-1);
  if (right) sideHead(1);
  return tris;
}

/** Painted lane arrow(s) for a lane with turn restrictions, ARROW_BEFORE_STOP m before the lane end. */
export function laneArrow(lane: Lane): Triangle[] {
  if (!lane.turns || lane.turns.length === 0 || lane.centre.length < 2) return [];
  const cl = new CentreLine(lane.centre);
  if (cl.length < 6) return [];
  const s = cl.length >= ARROW_BEFORE_STOP + 4 ? cl.length - ARROW_BEFORE_STOP : cl.length / 2;
  const { p, h } = cl.at(s);
  const f = forwardOf(h);
  const r = rightOf(h);
  const toWorld = (uv: [number, number]): Vec2 => [p[0] + f[0] * uv[0] + r[0] * uv[1], p[1] + f[1] * uv[0] + r[1] * uv[1]];
  return arrowShape(lane.turns).map((t) => [toWorld(t[0]!), toWorld(t[1]!), toWorld(t[2]!)] as Triangle);
}

// ---------------------------------------------------------------------------------
// Junctions

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

/** Signed area (positive when the ring is counter-clockwise in the x/z plane). */
export function signedArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
  return a / 2;
}

export interface JunctionMouth {
  roadId: string;
  /** Arc-length on the road where the mouth is. */
  s: number;
  centre: Vec2;
  left: Vec2;
  right: Vec2;
  /** Unit vector pointing from the junction into the road. */
  outward: Vec2;
}

/** The carriageway cross-sections where roads meet a junction. */
export function junctionMouths(junction: Junction, roadById: (id: string) => Road | undefined, laneById: ReadonlyMap<string, Lane>): JunctionMouth[] {
  const ids = new Set<string>();
  for (const a of junction.approaches) ids.add(a.roadId);
  for (const e of junction.exits) ids.add(e.roadId);
  const out: JunctionMouth[] = [];
  for (const id of ids) {
    const road = roadById(id);
    if (!road) continue;
    const cl = centreLineOf(road);
    const ext = roadExtent(road, laneById);
    const ends: ('from' | 'to')[] = [];
    if (road.from === junction.id) ends.push('from');
    if (road.to === junction.id) ends.push('to');
    for (const end of ends) {
      const s = end === 'from' ? ext.s0 : ext.s1;
      const { p, h } = cl.at(s);
      const f = forwardOf(h);
      out.push({
        roadId: id,
        s,
        centre: p,
        left: cl.section(s, -road.width / 2),
        right: cl.section(s, road.width / 2),
        outward: end === 'from' ? f : [-f[0], -f[1]],
      });
    }
  }
  return out;
}

/**
 * Paved surface of a junction: its polygon (or, for polygon-less bends/merges, the hull of
 * the road mouths so the gap between the carriageway ribbons is filled) with each edge
 * classified as a road mouth or an outer (kerbed) edge.
 */
export function junctionSurface(junction: Junction, roadById: (id: string) => Road | undefined, laneById: ReadonlyMap<string, Lane>): JunctionSurface | undefined {
  const mouths = junctionMouths(junction, roadById, laneById);
  let polygon = junction.polygon;
  if (!polygon) {
    const pts: Vec2[] = [];
    for (const m of mouths) pts.push(m.left, m.right);
    if (pts.length < 3) return undefined;
    polygon = convexHull(pts);
    if (polygon.length < 3) return undefined;
  }
  const centroid = polygonCentroid(polygon);
  const edges: JunctionEdge[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const len = dist2(a, b);
    if (len < 1e-6) continue;
    const mid = lerp2(a, b, 0.5);
    let normal: Vec2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
    if ((mid[0] - centroid[0]) * normal[0] + (mid[1] - centroid[1]) * normal[1] < 0) normal = [-normal[0], -normal[1]];
    // a mouth edge carries the road's cross-section: the mouth centre lies on it (or, at acute
    // junctions where a corner fell inside the hull, the hull edge crosses the mouth segment)
    const mouth = mouths.some((m) => pointSegmentDistance(m.centre, a, b) < 0.35 || segmentsCross(a, b, m.left, m.right));
    edges.push({ a, b, mouth, normal });
  }
  return { id: junction.id, polygon, edges };
}

// ---------------------------------------------------------------------------------
// Roundabouts

export interface RoundaboutRing {
  centre: Vec2;
  /** Radius of the circulating lane centre line. */
  radius: number;
  laneWidth: number;
  laneIds: string[];
  /** Radius of the central island (kerb outer edge). */
  islandRadius: number;
}

/**
 * Circular roundabouts: ring lanes (junction.roundabout.ringLaneIds) connected through
 * their connectors form a loop; the loop's centroid / mean radius give the island.
 * Non-circular loops (points scattered more than 1.5 m from the fitted circle) are skipped.
 */
export function roundaboutRings(junctions: Iterable<Junction>, laneById: ReadonlyMap<string, Lane>, connectorById: ReadonlyMap<string, Connector>): RoundaboutRing[] {
  const ringIds = new Set<string>();
  for (const j of junctions) if (j.roundabout) for (const id of j.roundabout.ringLaneIds) if (laneById.has(id)) ringIds.add(id);
  const seen = new Set<string>();
  const rings: RoundaboutRing[] = [];
  for (const start of ringIds) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const id = stack.pop()!;
      group.push(id);
      const lane = laneById.get(id)!;
      for (const cid of [...lane.next, ...lane.prev]) {
        const c = connectorById.get(cid);
        if (!c) continue;
        for (const other of [c.toLane, c.fromLane]) {
          if (ringIds.has(other) && !seen.has(other)) {
            seen.add(other);
            stack.push(other);
          }
        }
      }
    }
    const pts: Vec2[] = [];
    let width = 0;
    for (const id of group) {
      const lane = laneById.get(id)!;
      pts.push(...lane.centre);
      width = Math.max(width, lane.width);
    }
    if (pts.length < 6) continue;
    const centre = polygonCentroid(pts);
    const dists = pts.map((p) => dist2(p, centre));
    const radius = dists.reduce((a, b) => a + b, 0) / dists.length;
    if (radius < 3 || dists.some((d) => Math.abs(d - radius) > 1.5)) continue;
    const islandRadius = radius - width / 2 - 0.4;
    if (islandRadius < 1) continue;
    rings.push({ centre, radius, laneWidth: width, laneIds: group, islandRadius });
  }
  return rings;
}

function arc(centre: Vec2, radius: number, h0: number, h1: number, steps: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k <= steps; k++) {
    const h = h0 + ((h1 - h0) * k) / steps;
    out.push([centre[0] + Math.cos(h) * radius, centre[1] + Math.sin(h) * radius]);
  }
  return out;
}

/**
 * Kerb and sidewalk strips around the outer (non-mouth) edges of a junction, plus rounded
 * corner fans so the strips meet the road strips without gaps. Kerb pieces come first
 * (wall = true for edges, false for fans), sidewalk strips are returned separately.
 */
export function junctionKerbs(surface: JunctionSurface, roadSidewalk = true): { kerbs: KerbPiece[]; sidewalks: Strip[] } {
  const kerbs: KerbPiece[] = [];
  const sidewalks: Strip[] = [];
  const edges = surface.edges;
  const n = edges.length;
  const dOut = KERB_WIDTH + SIDEWALK_WIDTH;
  for (let i = 0; i < n; i++) {
    const e = edges[i]!;
    if (e.mouth) continue;
    const nx = e.normal[0];
    const nz = e.normal[1];
    const off = (p: Vec2, d: number): Vec2 => [p[0] + nx * d, p[1] + nz * d];
    kerbs.push({ colour: 'grey', wall: true, inner: [e.a, e.b], outer: [off(e.a, KERB_WIDTH), off(e.b, KERB_WIDTH)] });
    if (roadSidewalk) sidewalks.push({ inner: [off(e.a, KERB_WIDTH), off(e.b, KERB_WIDTH)], outer: [off(e.a, dOut), off(e.b, dOut)] });
    // corner fan at the end vertex (e.b) between this edge's normal and the next edge's outward direction
    const next = edges[(i + 1) % n]!;
    const h0 = Math.atan2(nz, nx);
    // for a mouth edge the road kerb leaves the corner along the mouth line, away from the carriageway
    const h1 = next.mouth ? Math.atan2(next.a[1] - next.b[1], next.a[0] - next.b[0]) : Math.atan2(next.normal[1], next.normal[0]);
    addFan(e.b, h0, h0 + angleDiff(h0, h1), kerbs, sidewalks, roadSidewalk);
    // fan at the start vertex when the previous edge is a mouth (otherwise its own end fan covered it)
    const prev = edges[(i - 1 + n) % n]!;
    if (prev.mouth) {
      const hp = Math.atan2(prev.b[1] - prev.a[1], prev.b[0] - prev.a[0]);
      addFan(e.a, hp, hp + angleDiff(hp, h0), kerbs, sidewalks, roadSidewalk);
    }
  }
  return { kerbs, sidewalks };
}

function addFan(c: Vec2, h0: number, h1: number, kerbs: KerbPiece[], sidewalks: Strip[], withSidewalk: boolean): void {
  const span = Math.abs(h1 - h0);
  if (span < 0.02) return;
  const steps = Math.max(1, Math.ceil(span / (Math.PI / 8)));
  const kerbArc = arc(c, KERB_WIDTH, h0, h1, steps);
  kerbs.push({ colour: 'grey', wall: false, inner: kerbArc.map(() => c), outer: kerbArc });
  if (withSidewalk) sidewalks.push({ inner: kerbArc, outer: arc(c, KERB_WIDTH + SIDEWALK_WIDTH, h0, h1, steps) });
}
