/**
 * World builder: turns a semantic description of a road network (nodes + roads with
 * attributes, crossings, signs …) into the lane-level WorldFile that the runtime uses.
 *
 * Shared by the OSM pipeline (tools/world/build-world.ts) and the synthetic
 * training-ground generator (src/world/testWorld.ts), so all geometry rules
 * (lane offsets, stop lines, connectors, priorities, signal phases) live here.
 */
import { angleDiff, densify, dist2, forwardOf, headingOf, lerp2, offsetPolyline, pointAlong, polylineLength, rightOf, wrapAngle, type Vec2 } from './geo';
import {
  ROAD_DEFAULTS,
  WORLD_SCHEMA_VERSION,
  WorldFileSchema,
  type Approach,
  type Area,
  type Building,
  type Connector,
  type ControlKind,
  type Crossing,
  type Junction,
  type JunctionKind,
  type KerbMarking,
  type Lane,
  type LineType,
  type ParkingStrip,
  type Prop,
  type Road,
  type RoadClass,
  type Route,
  type Sign,
  type SignalController,
  type SignalGroup,
  type SpawnPoint,
  type Turn,
  type WorldFile,
} from './schema';

export type NodeControl = 'auto' | 'signals' | 'all_stop' | 'right_hand_rule' | 'roundabout' | 'none';

export interface BuildNode {
  id: string;
  pos: Vec2;
  control?: NodeControl;
  name?: string;
  osmId?: number;
}

export interface BuildRoad {
  id: string;
  from: string;
  to: string;
  /** Centre line from `from` to `to` (first/last points = node positions). */
  points: Vec2[];
  cls: RoadClass;
  name?: string;
  nameEn?: string;
  oneway: boolean;
  lanesForward: number;
  lanesBackward: number;
  laneWidth?: number;
  maxSpeed?: number;
  /** Allowed turns per forward lane, left→right (null = unrestricted). */
  turnLanesForward?: (Turn[] | null)[];
  turnLanesBackward?: (Turn[] | null)[];
  busLaneForward?: boolean;
  busLaneBackward?: boolean;
  kerbLeft?: KerbMarking;
  kerbRight?: KerbMarking;
  zone?: Road['zone'];
  sidewalkLeft?: boolean;
  sidewalkRight?: boolean;
  bridge?: boolean;
  tunnel?: boolean;
  lit?: boolean;
  /** Part of a roundabout ring (oneway). */
  roundabout?: boolean;
  /** This road has priority at 'auto' junctions (e.g. main road with give-way signs on side streets). */
  priorityRoad?: boolean;
  /** Explicit approach control for traffic arriving at `to` (forward lanes) / at `from` (backward lanes). */
  controlAtTo?: ControlKind;
  controlAtFrom?: ControlKind;
  osmWayIds?: number[];
}

export interface BuildCrossing {
  id: string;
  roadId: string;
  /** Arc-length along the road centre from `from`. */
  s: number;
  kind: Crossing['kind'];
  refuge?: boolean;
}

export interface BuildSign {
  id?: string;
  code: string;
  roadId: string;
  s: number;
  /** Direction of the traffic that reads the sign. */
  direction: 'forward' | 'backward';
  value?: number | string;
  mount?: Sign['mount'];
}

export interface BuildInput {
  name: string;
  origin: { lat: number; lon: number };
  attribution: string[];
  nodes: BuildNode[];
  roads: BuildRoad[];
  crossings?: BuildCrossing[];
  signs?: BuildSign[];
  parking?: ParkingStrip[];
  buildings?: Building[];
  areas?: Area[];
  props?: Prop[];
  spawnPoints?: SpawnPoint[];
  routes?: Route[];
  generatedAt?: string;
}

const CLASS_RANK: Record<RoadClass, number> = {
  motorway: 9,
  trunk: 8,
  primary: 7,
  secondary: 6,
  tertiary: 5,
  unclassified: 4,
  residential: 3,
  living_street: 2,
  service: 1,
  pedestrian: 0,
};

const CROSSING_WIDTH = 3;
/** Distance from the junction edge (setback) to the near edge of an approach crossing. */
const CROSSING_GAP = 0.5;
/** Distance between the far edge of the crossing and the stop line. */
const STOP_LINE_GAP = 1.0;
const MIN_LANE_LENGTH = 1.5;

interface Arm {
  road: BuildRoad;
  end: 'from' | 'to';
  /** Lanes arriving at the node via this arm (ids, left→right in travel direction). */
  inLaneIds: string[];
  /** Lanes leaving the node via this arm. */
  outLaneIds: string[];
  /** Direction pointing from the node outward along the arm. */
  outward: number;
  /** Heading of traffic arriving at the node along this arm. */
  inHeading: number;
  /** Distance from the node position to the lane ends (stop line). */
  trim: number;
  crossing?: BuildCrossing;
  control: ControlKind;
  width: number;
}

interface NodeCtx {
  node: BuildNode;
  arms: Arm[];
  kind: JunctionKind;
  setback: number;
}

/** Slice a polyline between arc-lengths s0 and s1. */
export function slicePolyline(pts: Vec2[], s0: number, s1: number): Vec2[] {
  const total = polylineLength(pts);
  s0 = Math.max(0, Math.min(s0, total));
  s1 = Math.max(s0, Math.min(s1, total));
  const out: Vec2[] = [pointAlong(pts, s0).p];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = dist2(pts[i - 1]!, pts[i]!);
    const sEnd = acc + L;
    if (sEnd > s0 && sEnd < s1) out.push(pts[i]!);
    acc = sEnd;
  }
  const last = pointAlong(pts, s1).p;
  const prev = out[out.length - 1]!;
  if (dist2(prev, last) > 1e-6) out.push(last);
  if (out.length === 1) out.push([last[0] + 1e-3, last[1]]);
  return out;
}

function cubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, n: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    const z = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    pts.push([x, z]);
  }
  return pts;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

function polylinesCross(a: Vec2[], b: Vec2[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentsIntersect(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) return true;
    }
  }
  return false;
}

export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function classifyTurn(inHeading: number, outHeading: number): Turn {
  const d = (angleDiff(inHeading, outHeading) * 180) / Math.PI; // + = right (clockwise)
  const a = Math.abs(d);
  if (a <= 25) return 'straight';
  if (a > 160) return 'uturn';
  if (a <= 55) return d > 0 ? 'slight_right' : 'slight_left';
  if (a <= 135) return d > 0 ? 'right' : 'left';
  return d > 0 ? 'sharp_right' : 'sharp_left';
}

function turnAllowed(allowed: Turn[] | undefined, turn: Turn): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (allowed.includes(turn)) return true;
  if ((turn === 'slight_left' || turn === 'slight_right') && allowed.includes('straight')) return true;
  if (turn === 'slight_left' && allowed.includes('left')) return true;
  if (turn === 'slight_right' && allowed.includes('right')) return true;
  if (turn === 'sharp_left' && allowed.includes('left')) return true;
  if (turn === 'sharp_right' && allowed.includes('right')) return true;
  if (turn === 'uturn' && allowed.includes('left')) return true;
  return false;
}

function isLeftTurn(t: Turn): boolean {
  return t === 'left' || t === 'slight_left' || t === 'sharp_left' || t === 'uturn';
}
function isRightTurn(t: Turn): boolean {
  return t === 'right' || t === 'slight_right' || t === 'sharp_right';
}

function laneWidthOf(r: BuildRoad): number {
  return r.laneWidth ?? ROAD_DEFAULTS[r.cls].laneWidth;
}
function roadWidthOf(r: BuildRoad): number {
  return (r.lanesForward + r.lanesBackward) * laneWidthOf(r);
}
function maxSpeedOf(r: BuildRoad): number {
  if (r.maxSpeed) return r.maxSpeed;
  if (r.zone === 'calming_30' || r.zone === 'living_street' || r.zone === 'school') return 30;
  return ROAD_DEFAULTS[r.cls].maxSpeed;
}

export function buildWorld(input: BuildInput): WorldFile {
  const nodes = new Map<string, BuildNode>();
  for (const n of input.nodes) nodes.set(n.id, n);
  const roads = input.roads.filter((r) => {
    if (!nodes.has(r.from) || !nodes.has(r.to)) throw new Error(`road ${r.id} references unknown node`);
    if (r.lanesForward < 1) throw new Error(`road ${r.id} must have at least one forward lane (reverse the geometry for oneway=-1)`);
    return true;
  });
  const roadById = new Map(roads.map((r) => [r.id, r]));
  const roadLength = new Map<string, number>(roads.map((r) => [r.id, polylineLength(r.points)]));

  // ---- 1. arms per node -------------------------------------------------------
  const ctx = new Map<string, NodeCtx>();
  for (const n of input.nodes) ctx.set(n.id, { node: n, arms: [], kind: 'junction', setback: 0 });
  for (const r of roads) {
    const L = roadLength.get(r.id)!;
    const w = roadWidthOf(r);
    const startH = headingOf(r.points[0]!, pointAlong(r.points, Math.min(5, L)).p);
    const endH = headingOf(pointAlong(r.points, Math.max(0, L - 5)).p, r.points[r.points.length - 1]!);
    const armFrom: Arm = {
      road: r,
      end: 'from',
      inLaneIds: [],
      outLaneIds: [],
      outward: startH,
      inHeading: wrapAngle(startH + Math.PI),
      trim: 0,
      control: 'none',
      width: w,
    };
    const armTo: Arm = {
      road: r,
      end: 'to',
      inLaneIds: [],
      outLaneIds: [],
      outward: wrapAngle(endH + Math.PI),
      inHeading: endH,
      trim: 0,
      control: 'none',
      width: w,
    };
    ctx.get(r.from)!.arms.push(armFrom);
    ctx.get(r.to)!.arms.push(armTo);
  }

  // approach crossings
  const crossingsByRoad = new Map<string, BuildCrossing[]>();
  for (const c of input.crossings ?? []) {
    if (!roadById.has(c.roadId)) continue;
    const list = crossingsByRoad.get(c.roadId) ?? [];
    list.push(c);
    crossingsByRoad.set(c.roadId, list);
  }
  const midBlockCrossings: BuildCrossing[] = [];

  // ---- 2. junction kinds, setbacks, controls -----------------------------------
  for (const c of ctx.values()) {
    const n = c.arms.length;
    const isRoundabout = c.arms.some((a) => a.road.roundabout);
    if (n === 0) continue;
    if (n === 1) c.kind = 'dead_end';
    else if (n === 2 && !isRoundabout && c.node.control !== 'signals') {
      const [a, b] = c.arms as [Arm, Arm];
      const sameLanes = a.road.lanesForward + a.road.lanesBackward === b.road.lanesForward + b.road.lanesBackward;
      c.kind = sameLanes ? 'bend' : 'merge';
    } else c.kind = isRoundabout ? 'roundabout' : 'junction';

    const maxW = Math.max(...c.arms.map((a) => a.width));
    if (c.kind === 'bend' || c.kind === 'merge') {
      // A sharp bend needs room for the turn: with lanes ending ~1 m apart at a 90° corner,
      // vehicles on the two carriageways physically overlap. Grow the setback with the
      // deflection angle (0 for a straight continuation → unchanged 0.5 m).
      const [a, b] = c.arms as [Arm, Arm];
      const deflection = Math.PI - Math.abs(angleDiff(a.outward, b.outward));
      c.setback = 0.5 + (maxW / 2 + 0.5) * Math.min(1, deflection / (Math.PI / 2));
    } else c.setback = c.kind === 'dead_end' ? Math.max(maxW / 2, 3) : maxW / 2 + 1.0;

    for (const arm of c.arms) {
      const L = roadLength.get(arm.road.id)!;
      // approach crossing: a crossing within setback + 8 m of this node end
      const list = crossingsByRoad.get(arm.road.id) ?? [];
      const near = list.find((cr) => (arm.end === 'to' ? L - cr.s : cr.s) <= c.setback + 8);
      arm.trim = c.setback;
      if (near && c.kind !== 'bend' && c.kind !== 'merge') {
        arm.crossing = near;
        arm.trim = c.setback + CROSSING_GAP + CROSSING_WIDTH + STOP_LINE_GAP;
      }
    }
  }
  for (const [roadId, list] of crossingsByRoad) {
    const r = roadById.get(roadId)!;
    for (const cr of list) {
      const usedAsApproach = [ctx.get(r.from)!, ctx.get(r.to)!].some((c) => c.arms.some((a) => a.crossing === cr));
      if (!usedAsApproach) midBlockCrossings.push(cr);
    }
  }
  // clamp trims so lanes keep a minimum length
  for (const r of roads) {
    const L = roadLength.get(r.id)!;
    const a = ctx.get(r.from)!.arms.find((x) => x.road === r && x.end === 'from')!;
    const b = ctx.get(r.to)!.arms.find((x) => x.road === r && x.end === 'to')!;
    const over = a.trim + b.trim + MIN_LANE_LENGTH - L;
    if (over > 0) {
      const scale = Math.max(0, (L - MIN_LANE_LENGTH) / (a.trim + b.trim));
      a.trim *= scale;
      b.trim *= scale;
    }
  }

  // controls
  for (const c of ctx.values()) {
    const control = c.node.control ?? 'auto';
    const ring = c.arms.filter((a) => a.road.roundabout);
    for (const arm of c.arms) {
      const explicit = arm.end === 'to' ? arm.road.controlAtTo : arm.road.controlAtFrom;
      if (c.kind === 'bend' || c.kind === 'merge' || c.kind === 'dead_end') arm.control = 'none';
      else if (ring.length > 0) arm.control = arm.road.roundabout ? 'priority' : 'roundabout_entry';
      else if (control === 'signals') arm.control = 'signals';
      else if (control === 'all_stop') arm.control = 'stop';
      else if (control === 'right_hand_rule') arm.control = 'right_hand_rule';
      else if (control === 'none') arm.control = 'none';
      else if (explicit) arm.control = explicit;
      else arm.control = 'auto' as ControlKind; // resolved below
    }
    if (c.kind === 'roundabout' && ring.length === 0) c.kind = 'junction';
    const unresolved = c.arms.filter((a) => (a.control as string) === 'auto');
    if (unresolved.length > 0) {
      const explicitYield = c.arms.some((a) => a.control === 'stop' || a.control === 'give_way');
      const rankOf = (a: Arm) => CLASS_RANK[a.road.cls] + (a.road.priorityRoad ? 3 : 0);
      const maxRank = Math.max(...c.arms.map(rankOf));
      const minRank = Math.min(...c.arms.map(rankOf));
      for (const arm of unresolved) {
        if (explicitYield) arm.control = 'priority';
        else if (maxRank === minRank) arm.control = 'right_hand_rule';
        else if (rankOf(arm) === maxRank) arm.control = 'priority';
        else arm.control = 'give_way';
      }
      // T-junction: the stem yields even if same class (common Israeli practice: give-way sign on the stem)
      if (c.arms.length === 3 && c.arms.every((a) => a.control === 'right_hand_rule')) {
        const stem = c.arms.find((a) => c.arms.filter((b) => b !== a).every((b) => Math.abs(angleDiff(a.outward, b.outward)) > (Math.PI * 60) / 180 && Math.abs(angleDiff(a.outward, b.outward)) < (Math.PI * 120) / 180));
        if (stem) {
          stem.control = 'give_way';
          for (const other of c.arms) if (other !== stem) other.control = 'priority';
        }
      }
    }
  }

  // ---- 3. lanes -------------------------------------------------------------------
  const lanes: Lane[] = [];
  const laneById = new Map<string, Lane>();
  const outRoads: Road[] = [];
  const centreLineTypeFor = (r: BuildRoad): LineType => {
    if (r.oneway) return 'kerb';
    return CLASS_RANK[r.cls] >= CLASS_RANK.secondary ? 'solid' : 'dashed';
  };
  for (const r of roads) {
    const L = roadLength.get(r.id)!;
    const w = laneWidthOf(r);
    const armFrom = ctx.get(r.from)!.arms.find((x) => x.road === r && x.end === 'from')!;
    const armTo = ctx.get(r.to)!.arms.find((x) => x.road === r && x.end === 'to')!;
    const s0 = armFrom.trim;
    const s1 = L - armTo.trim;
    const speed = maxSpeedOf(r);
    const centreLine = centreLineTypeFor(r);
    const fwdIds: string[] = [];
    const bwdIds: string[] = [];
    const nF = r.lanesForward;
    const nB = r.lanesBackward;
    for (let k = 0; k < nF; k++) {
      const off = r.oneway ? (k + 0.5) * w - (nF * w) / 2 : (k + 0.5) * w;
      const centre = slicePolyline(offsetPolyline(r.points, off), s0, s1);
      const isBus = !!r.busLaneForward && k === nF - 1 && nF > 1;
      const lane: Lane = {
        id: `${r.id}:f${k}`,
        roadId: r.id,
        index: k,
        kind: isBus ? 'bus' : 'drive',
        width: w,
        centre,
        length: polylineLength(centre),
        from: r.from,
        to: r.to,
        maxSpeed: speed,
        leftLine: k === 0 ? centreLine : 'dashed',
        rightLine: k === nF - 1 ? 'kerb' : isBus ? 'yellow_solid' : r.busLaneForward && k === nF - 2 ? 'yellow_solid' : 'dashed',
        turns: r.turnLanesForward?.[k] ?? undefined,
        next: [],
        prev: [],
      };
      lanes.push(lane);
      laneById.set(lane.id, lane);
      fwdIds.push(lane.id);
    }
    for (let k = 0; k < nB; k++) {
      const off = -(k + 0.5) * w;
      const centre = slicePolyline(offsetPolyline(r.points, off), s0, s1).reverse();
      const isBus = !!r.busLaneBackward && k === nB - 1 && nB > 1;
      const lane: Lane = {
        id: `${r.id}:b${k}`,
        roadId: r.id,
        index: k,
        kind: isBus ? 'bus' : 'drive',
        width: w,
        centre,
        length: polylineLength(centre),
        from: r.to,
        to: r.from,
        maxSpeed: speed,
        leftLine: k === 0 ? centreLine : 'dashed',
        rightLine: k === nB - 1 ? 'kerb' : isBus ? 'yellow_solid' : 'dashed',
        turns: r.turnLanesBackward?.[k] ?? undefined,
        next: [],
        prev: [],
      };
      lanes.push(lane);
      laneById.set(lane.id, lane);
      bwdIds.push(lane.id);
    }
    armTo.inLaneIds = fwdIds;
    armTo.outLaneIds = bwdIds;
    armFrom.inLaneIds = bwdIds;
    armFrom.outLaneIds = fwdIds;
    outRoads.push({
      id: r.id,
      osmWayIds: r.osmWayIds ?? [],
      name: r.name,
      nameEn: r.nameEn,
      cls: r.cls,
      centre: r.points,
      length: L,
      from: r.from,
      to: r.to,
      oneway: r.oneway,
      lanesForward: fwdIds,
      lanesBackward: bwdIds,
      width: roadWidthOf(r),
      sidewalkLeft: r.sidewalkLeft ?? r.cls !== 'motorway',
      sidewalkRight: r.sidewalkRight ?? r.cls !== 'motorway',
      kerbLeft: r.kerbLeft ?? 'none',
      kerbRight: r.kerbRight ?? 'none',
      bridge: r.bridge ?? false,
      tunnel: r.tunnel ?? false,
      zone: r.zone ?? 'none',
      lit: r.lit ?? true,
    });
  }

  // ---- 4. crossings ------------------------------------------------------------------
  const crossings: Crossing[] = [];
  const crossingById = new Map<string, Crossing>();
  const crossingLine = (r: BuildRoad, s: number): [Vec2, Vec2] => {
    const at = pointAlong(r.points, s);
    const rt = rightOf(at.h);
    const half = roadWidthOf(r) / 2 + 0.3;
    const off = r.oneway ? 0 : 0;
    const c: Vec2 = [at.p[0] + rt[0] * off, at.p[1] + rt[1] * off];
    return [
      [c[0] - rt[0] * half, c[1] - rt[1] * half],
      [c[0] + rt[0] * half, c[1] + rt[1] * half],
    ];
  };
  const addCrossing = (bc: BuildCrossing, s: number, junctionId?: string): Crossing => {
    const r = roadById.get(bc.roadId)!;
    const cr: Crossing = {
      id: bc.id,
      kind: bc.kind,
      line: crossingLine(r, s),
      width: CROSSING_WIDTH,
      roadId: r.id,
      junctionId,
      laneIds: [...(outRoads.find((x) => x.id === r.id)!.lanesForward), ...(outRoads.find((x) => x.id === r.id)!.lanesBackward)],
      signalGroup: undefined,
      refuge: bc.refuge ?? false,
    };
    crossings.push(cr);
    crossingById.set(cr.id, cr);
    return cr;
  };
  for (const c of ctx.values()) {
    for (const arm of c.arms) {
      if (!arm.crossing) continue;
      const L = roadLength.get(arm.road.id)!;
      const dist = c.setback + CROSSING_GAP + CROSSING_WIDTH / 2; // from node to crossing centre
      const s = arm.end === 'to' ? L - dist : dist;
      addCrossing(arm.crossing, s, c.node.id);
    }
  }
  for (const bc of midBlockCrossings) addCrossing(bc, bc.s);

  // ---- 5. junctions, connectors, priorities, signals --------------------------------
  const junctions: Junction[] = [];
  const connectors: Connector[] = [];
  const signals: SignalController[] = [];
  const signs: Sign[] = [];
  let signSeq = 0;

  const laneEnd = (id: string): { p: Vec2; h: number } => {
    const l = laneById.get(id)!;
    const n = l.centre.length;
    return { p: l.centre[n - 1]!, h: headingOf(l.centre[Math.max(0, n - 2)]!, l.centre[n - 1]!) };
  };
  const laneStart = (id: string): { p: Vec2; h: number } => {
    const l = laneById.get(id)!;
    return { p: l.centre[0]!, h: headingOf(l.centre[0]!, l.centre[1]!) };
  };

  for (const c of ctx.values()) {
    if (c.arms.length === 0) continue;
    const nodeId = c.node.id;
    const approaches: Approach[] = [];
    const exits: Junction['exits'] = [];
    const nodeConnectors: Connector[] = [];
    const hullPts: Vec2[] = [c.node.pos];

    for (const arm of c.arms) {
      const r = arm.road;
      const L = roadLength.get(r.id)!;
      const sTrim = arm.end === 'to' ? L - arm.trim : arm.trim;
      const at = pointAlong(r.points, sTrim);
      const rt = rightOf(at.h);
      const half = arm.width / 2;
      hullPts.push([at.p[0] + rt[0] * half, at.p[1] + rt[1] * half], [at.p[0] - rt[0] * half, at.p[1] - rt[1] * half]);
      if (arm.inLaneIds.length > 0) {
        const first = laneEnd(arm.inLaneIds[0]!);
        const last = laneEnd(arm.inLaneIds[arm.inLaneIds.length - 1]!);
        const w = laneWidthOf(r) / 2;
        const rr = rightOf(first.h);
        const stopLine: [Vec2, Vec2] = [
          [first.p[0] - rr[0] * w, first.p[1] - rr[1] * w],
          [last.p[0] + rr[0] * w, last.p[1] + rr[1] * w],
        ];
        const approach: Approach = {
          roadId: r.id,
          laneIds: arm.inLaneIds,
          control: arm.control,
          heading: arm.inHeading,
          stopLine: c.kind === 'bend' || c.kind === 'merge' ? undefined : stopLine,
          crossingId: arm.crossing?.id,
          signIds: [],
        };
        // automatic signs at the stop line
        const signCode = arm.control === 'stop' ? '302' : arm.control === 'give_way' ? '301' : arm.control === 'roundabout_entry' ? '303' : undefined;
        if (signCode) {
          const sign: Sign = {
            id: `sg${++signSeq}`,
            code: signCode,
            pos: [stopLine[1][0] + rr[0] * 1.0, stopLine[1][1] + rr[1] * 1.0],
            heading: arm.inHeading,
            roadId: r.id,
            laneIds: arm.inLaneIds,
            junctionId: nodeId,
            mount: 'post_right',
          };
          signs.push(sign);
          approach.signIds.push(sign.id);
        }
        approaches.push(approach);
      }
      if (arm.outLaneIds.length > 0) {
        exits.push({ roadId: r.id, laneIds: arm.outLaneIds, heading: laneStart(arm.outLaneIds[0]!).h });
      }
    }

    // connectors
    for (const inArm of c.arms) {
      for (const outArm of c.arms) {
        if (inArm.inLaneIds.length === 0 || outArm.outLaneIds.length === 0) continue;
        const sameRoad = inArm.road === outArm.road;
        if (sameRoad && c.kind !== 'dead_end' && c.arms.length === 1) continue;
        const nIn = inArm.inLaneIds.length;
        const nOut = outArm.outLaneIds.length;
        for (let i = 0; i < nIn; i++) {
          const fromId = inArm.inLaneIds[i]!;
          const fromLane = laneById.get(fromId)!;
          const e = laneEnd(fromId);
          const targets: number[] = [];
          let turnKind: Turn;
          if (sameRoad) {
            turnKind = 'uturn';
            if (c.kind !== 'dead_end' && (i !== 0 || c.kind === 'bend' || c.kind === 'merge' || inArm.road.oneway)) continue;
            targets.push(0);
          } else {
            const s = laneStart(outArm.outLaneIds[0]!);
            turnKind = c.kind === 'bend' || c.kind === 'merge' ? 'straight' : classifyTurn(e.h, s.h);
            if (c.kind === 'roundabout' && inArm.road.roundabout && !outArm.road.roundabout) turnKind = 'right';
            if (turnKind === 'uturn' && c.arms.length > 2) continue; // handled via sameRoad only
            if (!turnAllowed(fromLane.turns, turnKind)) continue;
            if (turnKind === 'straight' || turnKind === 'slight_left' || turnKind === 'slight_right' || c.kind === 'bend' || c.kind === 'merge') {
              targets.push(Math.min(i, nOut - 1));
              if (nOut > nIn && i === nIn - 1) for (let j = nIn; j < nOut; j++) targets.push(j);
              if (nOut > nIn && i === 0 && nIn === 1) for (let j = 1; j < nOut; j++) if (!targets.includes(j)) targets.push(j);
            } else if (isRightTurn(turnKind)) {
              if (i !== nIn - 1 && !(fromLane.turns && fromLane.turns.some(isRightTurn))) continue;
              targets.push(nOut - 1);
            } else {
              if (i !== 0 && !(fromLane.turns && fromLane.turns.some(isLeftTurn))) continue;
              targets.push(0);
            }
          }
          for (const j of targets) {
            const toId = outArm.outLaneIds[j]!;
            const s = laneStart(toId);
            const dStraight = dist2(e.p, s.p);
            let path: Vec2[];
            if (sameRoad) {
              // U-turn / dead-end loop through the node position
              const d1 = Math.max(2, dStraight * 0.8);
              path = cubicBezier(e.p, [e.p[0] + forwardOf(e.h)[0] * d1, e.p[1] + forwardOf(e.h)[1] * d1], [s.p[0] - forwardOf(s.h)[0] * d1, s.p[1] - forwardOf(s.h)[1] * d1], s.p, 12);
            } else {
              const d = Math.min(15, Math.max(1, dStraight * 0.4));
              const f0 = forwardOf(e.h);
              const f1 = forwardOf(s.h);
              const n = Math.max(4, Math.ceil(dStraight / 2));
              path = cubicBezier(e.p, [e.p[0] + f0[0] * d, e.p[1] + f0[1] * d], [s.p[0] - f1[0] * d, s.p[1] - f1[1] * d], s.p, n);
            }
            const conn: Connector = {
              id: `${nodeId}:${fromId}>${toId}`,
              junctionId: nodeId,
              fromLane: fromId,
              toLane: toId,
              path,
              length: polylineLength(path),
              turn: turnKind,
              signalGroup: undefined,
              yieldTo: [],
              crossings: [inArm.crossing?.id, outArm.crossing?.id].filter((x): x is string => !!x),
              maxSpeed: turnKind === 'straight' ? fromLane.maxSpeed : turnKind === 'uturn' ? 10 : turnKind === 'slight_left' || turnKind === 'slight_right' ? Math.min(40, fromLane.maxSpeed) : 20,
            };
            nodeConnectors.push(conn);
            fromLane.next.push(conn.id);
            laneById.get(toId)!.prev.push(conn.id);
          }
        }
      }
    }

    // priorities
    const armOfLane = new Map<string, Arm>();
    for (const arm of c.arms) for (const id of arm.inLaneIds) armOfLane.set(id, arm);
    const controlRank: Record<ControlKind, number> = { priority: 2, signals: 1, right_hand_rule: 1, none: 1, give_way: 0, stop: 0, roundabout_entry: 0 };
    const rightOfArm = (a: Arm, b: Arm) => angleDiff(a.inHeading, b.outward) > 0.05; // b's arm lies to the right of a's heading
    for (const a of nodeConnectors) {
      const armA = armOfLane.get(a.fromLane)!;
      for (const b of nodeConnectors) {
        if (a === b) continue;
        const armB = armOfLane.get(b.fromLane)!;
        const sameApproach = armA === armB;
        const conflict = a.toLane === b.toLane || (!sameApproach && polylinesCross(a.path, b.path));
        if (!conflict) continue;
        let aYields: boolean;
        if (sameApproach) {
          // lane merge within the same approach: the right-hand (merging) lane yields
          aYields = laneById.get(a.fromLane)!.index > laneById.get(b.fromLane)!.index;
        } else {
          const ra = controlRank[armA.control];
          const rb = controlRank[armB.control];
          if (ra !== rb) aYields = ra < rb;
          else {
            const oncoming = Math.abs(angleDiff(armA.inHeading, armB.inHeading)) > (Math.PI * 120) / 180;
            if (isLeftTurn(a.turn) && !isLeftTurn(b.turn) && oncoming) aYields = true; // left turn yields to oncoming traffic
            else if (isLeftTurn(b.turn) && !isLeftTurn(a.turn) && oncoming) aYields = false;
            else if (a.turn === 'uturn' && b.turn !== 'uturn') aYields = true;
            else aYields = rightOfArm(armA, armB); // right-hand rule
          }
        }
        if (aYields) a.yieldTo.push(b.id);
      }
    }

    // signals
    let controllerId: string | undefined;
    if (c.arms.some((a) => a.control === 'signals')) {
      controllerId = `sig_${nodeId}`;
      const groups: SignalGroup[] = [];
      const clusters: Arm[][] = [];
      for (const arm of c.arms.filter((a) => a.inLaneIds.length > 0)) {
        const cl = clusters.find((k) => Math.abs(angleDiff(k[0]!.inHeading, arm.inHeading)) > (Math.PI * 150) / 180);
        if (cl) cl.push(arm);
        else clusters.push([arm]);
      }
      const groupOfArm = new Map<Arm, SignalGroup>();
      for (const arm of c.arms.filter((a) => a.inLaneIds.length > 0)) {
        const ap = approaches.find((p) => p.roadId === arm.road.id && p.laneIds === arm.inLaneIds)!;
        const sl = ap.stopLine!;
        const rr = rightOf(arm.inHeading);
        const heads: SignalGroup['heads'] = [{ pos: [sl[1][0] + rr[0] * 1.2, sl[1][1] + rr[1] * 1.2], heading: arm.inHeading, overhead: false }];
        if (arm.inLaneIds.length >= 2) heads.push({ pos: [sl[0][0] - rr[0] * 1.2, sl[0][1] - rr[1] * 1.2], heading: arm.inHeading, overhead: false });
        const g: SignalGroup = {
          id: `${controllerId}:${arm.road.id}:${arm.end}`,
          controllerId,
          connectors: nodeConnectors.filter((k) => arm.inLaneIds.includes(k.fromLane)).map((k) => k.id),
          crossings: [],
          arrow: null,
          pedestrian: false,
          heads,
        };
        for (const k of nodeConnectors) if (arm.inLaneIds.includes(k.fromLane)) k.signalGroup = g.id;
        ap.signalGroup = g.id;
        groups.push(g);
        groupOfArm.set(arm, g);
      }
      // pedestrian groups: crossing on arm X is green when the clusters NOT containing X are green
      const pedGroups = new Map<Arm, SignalGroup>();
      for (const arm of c.arms) {
        if (!arm.crossing) continue;
        const cr = crossingById.get(arm.crossing.id)!;
        const g: SignalGroup = { id: `${controllerId}:ped:${cr.id}`, controllerId, connectors: [], crossings: [cr.id], arrow: null, pedestrian: true, heads: [{ pos: cr.line[0], heading: arm.inHeading, overhead: false }, { pos: cr.line[1], heading: arm.inHeading, overhead: false }] };
        cr.signalGroup = g.id;
        cr.kind = 'signals';
        groups.push(g);
        pedGroups.set(arm, g);
      }
      const phases: SignalController['phases'] = clusters.map((cl) => {
        const green = cl.map((a) => groupOfArm.get(a)!.id);
        for (const [arm, g] of pedGroups) if (!cl.includes(arm) && cl.every((k) => Math.abs(angleDiff(k.inHeading, arm.inHeading)) > (Math.PI * 45) / 180)) green.push(g.id);
        const major = cl.some((a) => CLASS_RANK[a.road.cls] >= CLASS_RANK.secondary);
        return { green, duration: major ? 32 : 22 };
      });
      signals.push({ id: controllerId, junctionId: nodeId, groups, phases: phases.length > 0 ? phases : [{ green: [], duration: 20 }], offset: (hashString(nodeId) % 60) as number });
    }

    for (const k of nodeConnectors) connectors.push(k);
    const polygon = c.kind === 'bend' || c.kind === 'merge' ? undefined : convexHull(hullPts);
    const ring = c.arms.filter((a) => a.road.roundabout);
    junctions.push({
      id: nodeId,
      osmNodeId: c.node.osmId,
      kind: c.kind,
      position: c.node.pos,
      polygon: polygon && polygon.length >= 3 ? polygon : undefined,
      approaches,
      exits,
      connectors: nodeConnectors.map((k) => k.id),
      signalController: controllerId,
      name: c.node.name,
      roundabout: ring.length > 0 ? { centre: c.node.pos, radius: c.setback, ringLaneIds: ring.flatMap((a) => a.outLaneIds) } : undefined,
    });
  }

  // ---- 6. explicit signs ---------------------------------------------------------------
  for (const bs of input.signs ?? []) {
    const r = roadById.get(bs.roadId);
    if (!r) continue;
    const at = pointAlong(r.points, Math.min(bs.s, roadLength.get(r.id)!));
    const h = bs.direction === 'forward' ? at.h : wrapAngle(at.h + Math.PI);
    const rr = rightOf(h);
    const half = roadWidthOf(r) / 2 + 0.8;
    const outRoad = outRoads.find((x) => x.id === r.id)!;
    signs.push({
      id: bs.id ?? `sg${++signSeq}`,
      code: bs.code,
      pos: [at.p[0] + rr[0] * half, at.p[1] + rr[1] * half],
      heading: h,
      value: bs.value,
      roadId: r.id,
      laneIds: bs.direction === 'forward' ? outRoad.lanesForward : outRoad.lanesBackward,
      junctionId: undefined,
      mount: bs.mount ?? 'post_right',
    });
  }

  // ---- 7. assemble ------------------------------------------------------------------------
  const allPts: Vec2[] = [];
  for (const r of roads) allPts.push(...r.points);
  for (const b of input.buildings ?? []) allPts.push(...b.footprint);
  const bbox = allPts.reduce(
    (acc, p) => ({ minX: Math.min(acc.minX, p[0]), minZ: Math.min(acc.minZ, p[1]), maxX: Math.max(acc.maxX, p[0]), maxZ: Math.max(acc.maxZ, p[1]) }),
    { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity },
  );

  const world = {
    version: WORLD_SCHEMA_VERSION,
    name: input.name,
    origin: input.origin,
    bbox,
    generatedAt: input.generatedAt ?? new Date(0).toISOString(),
    attribution: input.attribution,
    roads: outRoads,
    lanes,
    junctions,
    connectors,
    signals,
    crossings,
    signs,
    parking: input.parking ?? [],
    buildings: input.buildings ?? [],
    areas: input.areas ?? [],
    props: input.props ?? [],
    spawnPoints: input.spawnPoints ?? [],
    routes: input.routes ?? [],
  };
  return WorldFileSchema.parse(world);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Convenience for generators: a straight road between two nodes. */
export function straightRoad(id: string, from: BuildNode, to: BuildNode, attrs: Omit<BuildRoad, 'id' | 'from' | 'to' | 'points'>): BuildRoad {
  return { id, from: from.id, to: to.id, points: [from.pos, to.pos], ...attrs };
}

/** Densified arc from angle a0 to a1 (radians, math angle in the x/z plane) around centre. */
export function arcPoints(centre: Vec2, radius: number, a0: number, a1: number, step = Math.PI / 12): Vec2[] {
  const pts: Vec2[] = [];
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([centre[0] + Math.cos(a) * radius, centre[1] + Math.sin(a) * radius]);
  }
  return pts;
}

export { densify, lerp2 };
