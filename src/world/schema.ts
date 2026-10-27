/**
 * World file schema — the single source of truth shared by the data pipeline
 * (tools/world) and the runtime (src/world, src/traffic, src/rules, src/coach).
 *
 * Coordinates: see src/world/geo.ts (metres, +x east, +z south, y up).
 * All polylines that describe LANES/CONNECTORS run in the direction of travel.
 *
 * Lane indexing: index 0 = LEFTMOST lane in the direction of travel (next to the
 * centre line); the highest index is the kerb-side lane. This matches the OSM
 * `turn:lanes` ordering. Right-hand traffic everywhere.
 */
import { z } from 'zod';

export const WORLD_SCHEMA_VERSION = 1;

export const Vec2Schema = z.tuple([z.number(), z.number()]);
export const PolylineSchema = z.array(Vec2Schema).min(2);
/** Simple ring; first point is NOT repeated at the end. */
export const PolygonSchema = z.array(Vec2Schema).min(3);

export const RoadClassSchema = z.enum([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'living_street',
  'service',
  'unclassified',
  'pedestrian',
]);

export const LaneKindSchema = z.enum(['drive', 'bus', 'bike', 'parking', 'shoulder']);

/** Marking on one side of a lane. */
export const LineTypeSchema = z.enum([
  'none',
  'dashed', // may be crossed
  'solid', // may not be crossed
  'double_solid',
  'dashed_solid', // dashed on the near side, solid on the far side (crossing allowed)
  'solid_dashed', // solid on the near side (crossing NOT allowed)
  'yellow_solid', // edge of carriageway / bus lane separator
  'kerb',
]);

export const TurnSchema = z.enum(['straight', 'left', 'right', 'slight_left', 'slight_right', 'sharp_left', 'sharp_right', 'uturn', 'merge_left', 'merge_right']);

export const KerbMarkingSchema = z.enum([
  'none', // plain grey kerb: parking allowed unless a sign says otherwise
  'blue_white', // paid / resident parking
  'red_white', // no stopping / no parking
  'red_yellow', // bus stop
  'disabled',
  'loading',
]);

export const LaneSchema = z.object({
  id: z.string(),
  roadId: z.string(),
  index: z.number().int().nonnegative(),
  kind: LaneKindSchema,
  width: z.number().positive(),
  /** Centre line of the lane, in travel direction. */
  centre: PolylineSchema,
  length: z.number().nonnegative(),
  /** Junction ids. */
  from: z.string(),
  to: z.string(),
  /** Legal speed limit on this lane, km/h. */
  maxSpeed: z.number().positive(),
  leftLine: LineTypeSchema,
  rightLine: LineTypeSchema,
  /** Allowed turns at the end of the lane (undefined = unrestricted). */
  turns: z.array(TurnSchema).optional(),
  /** Connector ids that leave this lane at `to`. */
  next: z.array(z.string()),
  /** Connector ids that enter this lane at `from`. */
  prev: z.array(z.string()),
});

export const RoadSchema = z.object({
  id: z.string(),
  osmWayIds: z.array(z.number()).default([]),
  /** Hebrew street name, as it appears on street signs. */
  name: z.string().optional(),
  nameEn: z.string().optional(),
  cls: RoadClassSchema,
  /** Centre of the carriageway, in the direction of the "forward" lanes. */
  centre: PolylineSchema,
  length: z.number().nonnegative(),
  from: z.string(),
  to: z.string(),
  oneway: z.boolean(),
  /** Lane ids ordered left→right in their travel direction. */
  lanesForward: z.array(z.string()),
  lanesBackward: z.array(z.string()),
  /** Total paved width (m). */
  width: z.number().positive(),
  sidewalkLeft: z.boolean().default(true),
  sidewalkRight: z.boolean().default(true),
  /** Default kerb marking along each side (relative to the forward direction). */
  kerbLeft: KerbMarkingSchema.default('none'),
  kerbRight: KerbMarkingSchema.default('none'),
  bridge: z.boolean().default(false),
  tunnel: z.boolean().default(false),
  /** Traffic-calmed / 30 km/h zone, school zone etc. */
  zone: z.enum(['none', 'calming_30', 'living_street', 'school']).default('none'),
  lit: z.boolean().default(true),
});

export const ControlKindSchema = z.enum([
  'signals',
  'stop', // sign 302: full stop at the stop line, then yield
  'give_way', // sign 301
  'priority', // this approach has priority (others have stop/give_way)
  'right_hand_rule', // no signs: yield to traffic from the right (תקנה 64)
  'roundabout_entry', // yield to traffic inside the roundabout (sign 303)
  'none', // no conflicting traffic (merge / bend)
]);

export const ApproachSchema = z.object({
  roadId: z.string(),
  /** Incoming lanes (ids) ordered left→right. */
  laneIds: z.array(z.string()),
  control: ControlKindSchema,
  /** Heading of the incoming traffic at the junction. */
  heading: z.number(),
  /** Stop line across the incoming lanes (left end, right end). */
  stopLine: z.tuple([Vec2Schema, Vec2Schema]).optional(),
  signalGroup: z.string().optional(),
  /** Pedestrian crossing just before the junction on this approach, if any. */
  crossingId: z.string().optional(),
  signIds: z.array(z.string()).default([]),
});

export const JunctionKindSchema = z.enum(['junction', 'roundabout', 'merge', 'bend', 'dead_end', 'turning_loop']);

export const JunctionSchema = z.object({
  id: z.string(),
  osmNodeId: z.number().optional(),
  kind: JunctionKindSchema,
  position: Vec2Schema,
  /** Paved area of the junction (for rendering and "inside junction" tests). */
  polygon: PolygonSchema.optional(),
  approaches: z.array(ApproachSchema),
  /** Outgoing roads: lane ids leaving the junction. */
  exits: z.array(z.object({ roadId: z.string(), laneIds: z.array(z.string()), heading: z.number() })),
  connectors: z.array(z.string()),
  signalController: z.string().optional(),
  /** e.g. "נמיר / איינשטיין" */
  name: z.string().optional(),
  roundabout: z
    .object({
      centre: Vec2Schema,
      radius: z.number().positive(),
      /** Lane ids that form the circulating carriageway (ordered). */
      ringLaneIds: z.array(z.string()),
    })
    .optional(),
});

export const ConnectorSchema = z.object({
  id: z.string(),
  junctionId: z.string(),
  fromLane: z.string(),
  toLane: z.string(),
  /** Path through the junction from the end of `fromLane` to the start of `toLane`. */
  path: PolylineSchema,
  length: z.number().nonnegative(),
  turn: TurnSchema,
  /** Signal group controlling this movement, if signalised. */
  signalGroup: z.string().optional(),
  /** Connector ids that have priority over this movement (must yield to them). */
  yieldTo: z.array(z.string()),
  /** Crossing ids this movement passes over. */
  crossings: z.array(z.string()),
  /** Advisory speed through the movement, km/h. */
  maxSpeed: z.number().positive(),
});

export const SignalStateSchema = z.enum(['red', 'red_amber', 'green', 'flashing_green', 'amber', 'flashing_amber', 'off']);

export const SignalGroupSchema = z.object({
  id: z.string(),
  controllerId: z.string(),
  /** Vehicle movements (connector ids) or pedestrian crossing ids governed by this group. */
  connectors: z.array(z.string()),
  crossings: z.array(z.string()).default([]),
  /** null = full disc, otherwise an arrow head. */
  arrow: z.enum(['left', 'right', 'straight']).nullable().default(null),
  pedestrian: z.boolean().default(false),
  /** Where the signal heads stand: position, and the heading of traffic that reads them. */
  heads: z.array(z.object({ pos: Vec2Schema, heading: z.number(), overhead: z.boolean().default(false) })),
});

export const SignalPhaseSchema = z.object({
  /** Groups that are green during this phase. Everything else is red. */
  green: z.array(z.string()),
  /** Seconds of steady green (transitions are added by the runtime: 3 s flashing green, 3 s amber, 2 s all-red, 1 s red+amber). */
  duration: z.number().positive(),
});

export const SignalControllerSchema = z.object({
  id: z.string(),
  junctionId: z.string(),
  groups: z.array(SignalGroupSchema),
  phases: z.array(SignalPhaseSchema).min(1),
  /** Seconds offset of the cycle start relative to world time 0. */
  offset: z.number().default(0),
});

export const CrossingSchema = z.object({
  id: z.string(),
  kind: z.enum(['zebra', 'signals', 'unmarked', 'raised']),
  /** The crossing as a line across the carriageway. */
  line: z.tuple([Vec2Schema, Vec2Schema]),
  width: z.number().positive().default(3),
  roadId: z.string().optional(),
  junctionId: z.string().optional(),
  laneIds: z.array(z.string()),
  signalGroup: z.string().optional(),
  /** Island / refuge in the middle. */
  refuge: z.boolean().default(false),
});

export const SignSchema = z.object({
  id: z.string(),
  /** Israeli sign catalogue number, e.g. "302" (stop), "301" (give way), "426" (speed limit). */
  code: z.string(),
  pos: Vec2Schema,
  /** Heading of the traffic the sign addresses (the sign face looks AGAINST this heading). */
  heading: z.number(),
  value: z.union([z.number(), z.string()]).optional(),
  roadId: z.string().optional(),
  laneIds: z.array(z.string()).default([]),
  junctionId: z.string().optional(),
  mount: z.enum(['post_right', 'post_left', 'overhead', 'ground']).default('post_right'),
});

export const ParkingStripSchema = z.object({
  id: z.string(),
  roadId: z.string(),
  side: z.enum(['left', 'right']),
  /** Arc-length range along the road centre (m). */
  s0: z.number().nonnegative(),
  s1: z.number().nonnegative(),
  kerb: KerbMarkingSchema,
  layout: z.enum(['parallel', 'perpendicular', 'diagonal']).default('parallel'),
  /** Optional explicit bays for lessons (centre, heading of a parked car). */
  bays: z.array(z.object({ pos: Vec2Schema, heading: z.number() })).default([]),
});

export const BuildingSchema = z.object({
  id: z.string(),
  footprint: PolygonSchema,
  holes: z.array(PolygonSchema).default([]),
  height: z.number().positive(),
  levels: z.number().int().positive().optional(),
  kind: z.enum(['residential', 'commercial', 'public', 'industrial', 'religious', 'education', 'other']).default('residential'),
  name: z.string().optional(),
});

export const AreaSchema = z.object({
  id: z.string(),
  kind: z.enum(['park', 'grass', 'water', 'sand', 'parking_lot', 'plaza', 'sports', 'construction', 'forest', 'cemetery', 'school']),
  polygon: PolygonSchema,
  holes: z.array(PolygonSchema).default([]),
  name: z.string().optional(),
});

export const PropSchema = z.object({
  kind: z.enum(['tree', 'lamp', 'bus_stop', 'bench', 'bollard', 'bin', 'hydrant', 'speed_bump', 'barrier']),
  pos: Vec2Schema,
  heading: z.number().default(0),
  scale: z.number().positive().default(1),
  name: z.string().optional(),
  roadId: z.string().optional(),
});

export const SpawnTagSchema = z.enum(['lesson', 'test', 'free', 'parking', 'quiet', 'main_road', 'start']);

export const SpawnPointSchema = z.object({
  id: z.string(),
  name: z.string(),
  pos: Vec2Schema,
  heading: z.number(),
  laneId: z.string().optional(),
  tags: z.array(SpawnTagSchema).default([]),
});

export const RouteSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['test', 'lesson', 'tour']),
  spawnId: z.string(),
  /** Ordered junction ids the route passes through (the runtime path-finds between them). */
  waypoints: z.array(z.string()).min(1),
  notes: z.string().optional(),
});

export const WorldFileSchema = z.object({
  version: z.literal(WORLD_SCHEMA_VERSION),
  name: z.string(),
  origin: z.object({ lat: z.number(), lon: z.number() }),
  bbox: z.object({ minX: z.number(), minZ: z.number(), maxX: z.number(), maxZ: z.number() }),
  generatedAt: z.string(),
  attribution: z.array(z.string()),
  roads: z.array(RoadSchema),
  lanes: z.array(LaneSchema),
  junctions: z.array(JunctionSchema),
  connectors: z.array(ConnectorSchema),
  signals: z.array(SignalControllerSchema),
  crossings: z.array(CrossingSchema),
  signs: z.array(SignSchema),
  parking: z.array(ParkingStripSchema),
  buildings: z.array(BuildingSchema),
  areas: z.array(AreaSchema),
  props: z.array(PropSchema),
  spawnPoints: z.array(SpawnPointSchema),
  routes: z.array(RouteSchema),
});

export type Vec2 = z.infer<typeof Vec2Schema>;
export type RoadClass = z.infer<typeof RoadClassSchema>;
export type LaneKind = z.infer<typeof LaneKindSchema>;
export type LineType = z.infer<typeof LineTypeSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type KerbMarking = z.infer<typeof KerbMarkingSchema>;
export type Lane = z.infer<typeof LaneSchema>;
export type Road = z.infer<typeof RoadSchema>;
export type ControlKind = z.infer<typeof ControlKindSchema>;
export type Approach = z.infer<typeof ApproachSchema>;
export type JunctionKind = z.infer<typeof JunctionKindSchema>;
export type Junction = z.infer<typeof JunctionSchema>;
export type Connector = z.infer<typeof ConnectorSchema>;
export type SignalState = z.infer<typeof SignalStateSchema>;
export type SignalGroup = z.infer<typeof SignalGroupSchema>;
export type SignalPhase = z.infer<typeof SignalPhaseSchema>;
export type SignalController = z.infer<typeof SignalControllerSchema>;
export type Crossing = z.infer<typeof CrossingSchema>;
export type Sign = z.infer<typeof SignSchema>;
export type ParkingStrip = z.infer<typeof ParkingStripSchema>;
export type Building = z.infer<typeof BuildingSchema>;
export type Area = z.infer<typeof AreaSchema>;
export type Prop = z.infer<typeof PropSchema>;
export type SpawnPoint = z.infer<typeof SpawnPointSchema>;
export type Route = z.infer<typeof RouteSchema>;
export type WorldFile = z.infer<typeof WorldFileSchema>;

/** Input type (before zod defaults are applied) — what the pipeline/generators produce. */
export type WorldFileInput = z.input<typeof WorldFileSchema>;

/** Signal timing constants (seconds) used by the runtime for every controller. */
export const SIGNAL_TIMING = {
  flashingGreen: 3,
  amber: 3,
  allRed: 2,
  redAmber: 1.5,
} as const;

/** Default lane widths and speeds by road class (used by the pipeline when OSM lacks tags). */
export const ROAD_DEFAULTS: Record<RoadClass, { lanes: number; laneWidth: number; maxSpeed: number }> = {
  motorway: { lanes: 3, laneWidth: 3.6, maxSpeed: 110 },
  trunk: { lanes: 2, laneWidth: 3.5, maxSpeed: 90 },
  primary: { lanes: 2, laneWidth: 3.4, maxSpeed: 50 },
  secondary: { lanes: 2, laneWidth: 3.3, maxSpeed: 50 },
  tertiary: { lanes: 1, laneWidth: 3.2, maxSpeed: 50 },
  residential: { lanes: 1, laneWidth: 3.0, maxSpeed: 50 },
  living_street: { lanes: 1, laneWidth: 3.0, maxSpeed: 30 },
  service: { lanes: 1, laneWidth: 2.8, maxSpeed: 30 },
  unclassified: { lanes: 1, laneWidth: 3.0, maxSpeed: 50 },
  pedestrian: { lanes: 1, laneWidth: 3.0, maxSpeed: 20 },
};

export function parseWorld(json: unknown): WorldFile {
  return WorldFileSchema.parse(json);
}
