/**
 * Tunables of the NPC traffic module. Metres, seconds, m/s unless stated otherwise.
 * Everything that shapes behaviour lives here so that tests and lessons can reason
 * about the numbers (and so that nothing is hidden inline in the logic).
 */
import type { AgentKind } from '@/core/types';

export type VehicleKind = Exclude<AgentKind, 'pedestrian'>;

/** Intelligent Driver Model parameters (Treiber et al.). */
export const IDM = {
  /** Maximum acceleration a_max. */
  aMax: 1.5,
  /** Comfortable deceleration b. */
  b: 2.0,
  /** Jam distance s0 (bumper to bumper). */
  s0: 2.0,
  /** Safe time headway T for a normal driver. */
  T: 1.5,
  /** Time headway of a tailgating ("bad") driver. */
  TBad: 0.8,
  /** Acceleration exponent δ. */
  delta: 4,
  /** Hard physical deceleration limit (never exceeded, even in emergencies). */
  bMax: 8,
  /** Deceleration above which a braking event counts as "had to brake hard". */
  bDisturbed: 3,
} as const;

/** Share of "bad" drivers (seeded): +15 km/h over the limit, tailgating, sloppy indicators. */
export const BAD_DRIVER_SHARE = 0.1;
export const BAD_DRIVER_EXTRA_KMH = 15;

/** Vehicle body dimensions by kind. */
export const VEHICLE_DIMS: Record<VehicleKind, { length: number; width: number; height: number }> = {
  car: { length: 4.4, width: 1.8, height: 1.45 },
  bus: { length: 12, width: 2.55, height: 3.2 },
  truck: { length: 7, width: 2.3, height: 2.7 },
  motorcycle: { length: 2.1, width: 0.8, height: 1.3 },
  scooter: { length: 1.2, width: 0.5, height: 1.2 },
  bicycle: { length: 1.8, width: 0.6, height: 1.2 },
  emergency: { length: 5.2, width: 2.0, height: 2.0 },
};

/** Speed caps (km/h) of slow vehicle kinds, applied on top of the legal limit. */
export const KIND_SPEED_CAP_KMH: Partial<Record<VehicleKind, number>> = { bicycle: 25, scooter: 25, truck: 80, bus: 70 };

/** Two-wheelers ride near the right edge of the lane (metres from the kerb-side lane edge). */
export const EDGE_RIDING_KINDS: ReadonlySet<VehicleKind> = new Set<VehicleKind>(['bicycle', 'scooter']);
export const EDGE_RIDING_MARGIN = 0.45;

/** Kind mix of automatically spawned vehicles (cumulative shares). */
export const VEHICLE_MIX = { car: 0.85, bus: 0.1, truck: 0.05 } as const;

/** Spawner limits. */
export const SPAWN = {
  maxVehicles: 60,
  maxPedestrians: 40,
  vehicleRadius: 350,
  vehicleMinDist: 120,
  vehicleDespawn: 450,
  pedestrianRadius: 250,
  pedestrianMinDist: 60,
  pedestrianDespawn: 300,
  /** Do not spawn inside the player's view cone (half angle, rad) within this distance. */
  viewConeHalfAngle: (35 * Math.PI) / 180,
  viewConeDistance: 150,
  pedViewConeDistance: 100,
  /** Minimum seconds between two automatic vehicle spawns. */
  vehicleInterval: 0.25,
  pedestrianInterval: 0.2,
  /** Spawn attempts per request before giving up for this frame. */
  attempts: 14,
  /** Longitudinal clearance to any vehicle on the same lane at spawn time. */
  clearance: 10,
  /** Keep this many metres clear before the end of the lane (stop line). */
  laneEndMargin: 15,
} as const;

/** Junction behaviour. */
export const JUNCTION = {
  /** Time-to-collision horizon for gap acceptance at give-way / roundabout / left turns. */
  ttcHorizon: 3.5,
  /** How far upstream of a conflicting connector we look for approaching traffic. */
  upstreamReach: 70,
  /** Full-stop time at a stop sign. */
  stopSignSeconds: 1.0,
  /** Speed below which the vehicle counts as stopped. */
  stoppedSpeed: 0.3,
  /** The front bumper rests this far before the stop line. */
  stopLineGap: 0.5,
  /** After waiting this long with every blocker stationary (and nobody inside), the deadlock is broken. */
  deadlockSeconds: 12,
  /** A vehicle held at its line for longer than this is not "about to go" any more. */
  stuckSeconds: 10,
  /** A long vehicle does not start a tight turn while someone will reach the corner within this time. */
  longVehicleCornerWindow: 4.5,
  /** Deceleration we are willing to use to stop for an amber light. */
  amberStopDecel: 4.0,
  /** Deceleration used to decide whether a sudden red (override) can still be honoured. */
  redEmergencyDecel: 6.5,
  /** Distance before the lane end from which the junction rules are evaluated. */
  decisionDistance: 90,
  /** Front bumper within this distance of the line with an accepted gap → committed to enter. */
  commitDistance: 1.5,
  /** Leader search horizon along the agent's own path. */
  leaderHorizon: 80,
} as const;

/** Lane-change behaviour (MOBIL-lite). */
export const LANE_CHANGE = {
  duration: 3.0,
  /** Plan the turn lane at least this far before the lane end. */
  planDistance: 60,
  /** Give up waiting for a gap and re-plan from the current lane below this distance. */
  abortDistance: 35,
  /** Overtake when the leader is at least this much slower than our desired speed (m/s ≈ 10 km/h). */
  overtakeSpeedDiff: 10 / 3.6,
  overtakeGap: 45,
  /** Safety: the new follower must not need to brake harder than this. */
  safeDecel: 2.0,
  /** Our own deceleration behind the new leader must not exceed this. */
  ownSafeDecel: 2.5,
  /** Incentive threshold (m/s²) for discretionary changes. */
  incentive: 0.3,
  cooldown: 4,
  /** Return to the right lane when it is free for at least this gap. */
  keepRightGap: 60,
} as const;

/** Bus behaviour. */
export const BUS = {
  dwellMin: 8,
  dwellMax: 12,
  /** Bus stop prop must lie within this lateral distance from the lane's right edge. */
  stopSearchLateral: 5,
  /** Where the bus front stops relative to the bus stop prop (m past it). */
  frontOffset: 2,
} as const;

/** Pedestrian behaviour. */
export const PED = {
  walkMin: 1.0,
  walkMax: 1.5,
  crossSpeed: 1.3,
  /** Sidewalk centre line offset from the carriageway edge. */
  sidewalkOffset: 1.2,
  /** Standing point at the kerb: distance from the carriageway edge. */
  kerbStand: 0.5,
  ttcHorizon: 3.5,
  /** A vehicle slower than this within `stoppedDistance` before the crossing "has stopped for us". */
  stoppedSpeed: 0.5,
  stoppedDistance: 15,
  jaywalkerShare: 0.05,
  /** Max road width (m) of a "quiet street" where jaywalking happens. */
  quietRoadWidth: 7,
  /** Scripted pedestrians start waiting when the player is this far from the crossing. */
  scriptedTriggerMin: 40,
  scriptedTriggerMax: 60,
  /** Pedestrian body footprint. */
  length: 0.4,
  width: 0.5,
  /** Lateral clearance a vehicle keeps from a pedestrian inside its lane corridor. */
  corridorClearance: 0.6,
  corridorLookahead: 45,
} as const;

/** Renderer limits. */
export const RENDER = {
  maxVehicles: 96,
  maxPedestrians: 64,
  maxDistance: 400,
  blinkPeriod: 0.8,
} as const;

/** Per-driver speed factor range applied to the legal limit (good drivers). */
export const SPEED_FACTOR = { min: 0.95, max: 1.1 } as const;

/** Advisory speed through curves/connectors is approached with this comfortable deceleration. */
export const LOOKAHEAD_DECEL = 1.5;
