/**
 * Every numeric threshold used by the rules engine, in one place, with units in the name
 * or the comment. Detectors import from here; tests may reference them to build scenarios.
 *
 * Units: metres (M), seconds (S), m/s (MPS), m/s² (MPS2), km/h (KMH), degrees (DEG).
 */

export const LOCALISER = {
  /** A connector counts as matched when the car centre is within this distance of its path. */
  CONNECTOR_MATCH_M: 3,
  /** Junction polygons considered for the "inside junction" test. */
  JUNCTION_SEARCH_M: 25,
  /** Maximum distance from a lane centre for a lane match. */
  LANE_MAX_DIST_M: 12,
  /** The previous lane is kept while the car is still this close to it … */
  STICKY_PREV_LANE_M: 2.5,
  /** … unless the new candidate is at least this close (physically on it). */
  SWITCH_LANE_MIN_M: 1.0,
  /** A connector only replaces the one matched last tick when its score is better by this margin. */
  CONNECTOR_SWITCH_MARGIN_M: 1.0,
  /** Heading error beyond which a one-way lane is being driven against its direction. */
  WRONG_WAY_HEADING_DEG: 110,
  WRONG_WAY_MIN_SPEED_MPS: 1,
  /** Distance of the car centre beyond the road centre line that counts as the opposite side. */
  OPPOSITE_SIDE_M: 0.3,
  /** Wrong-way condition must hold this long before `wrongWay` is set. */
  WRONG_WAY_S: 1.0,
  /** Car centre beyond the carriageway edge by more than this → on the kerb. */
  KERB_BEYOND_M: 0.6,
  /** On/off hysteresis for `onKerb`. */
  KERB_S: 0.5,
} as const;

export const SPEED = {
  TOLERANCE_KMH: 3,
  MINOR_MAX_OVER_KMH: 10,
  MAJOR_MAX_OVER_KMH: 20,
  MINOR_AFTER_S: 2,
  MAJOR_AFTER_S: 1,
  /** Below this fraction of the limit the driver is "too slow". */
  TOO_SLOW_FRACTION: 0.4,
  TOO_SLOW_AFTER_S: 8,
  TOO_SLOW_MIN_SPEED_MPS: 1,
  /** Free road: no agent ahead within … on the same lane. */
  TOO_SLOW_FREE_AHEAD_M: 35,
  /** Free road: no junction / crossing within … */
  TOO_SLOW_FREE_JUNCTION_M: 40,
  HESITATION_STOPPED_S: 4,
  /** Conflicting agents closer than this TTC justify waiting. */
  HESITATION_TTC_S: 4,
  /** Being within this distance of the stop line counts as "at the approach". */
  HESITATION_NEAR_LINE_M: 8,
  HESITATION_QUEUE_AHEAD_M: 12,
} as const;

export const SIGNALS = {
  APPROACH_INFO_M: 60,
  /** Stopping distance model at amber onset: d = v·REACTION + v² / (2·DECEL). */
  AMBER_REACTION_S: 1.0,
  AMBER_DECEL_MPS2: 3.5,
  /** Moving faster than this across the line during red+amber → RED_AMBER_START. */
  RED_AMBER_MOVE_MPS: 0.5,
  GREEN_NOT_MOVING_S: 4,
  GREEN_NOT_MOVING_NEAR_LINE_M: 6,
  GREEN_NOT_MOVING_AGENT_AHEAD_M: 12,
  /** Crossing the line at red slower than this is judged as an overrun first (see signals.ts). */
  RED_CROSS_SLOW_MPS: 2.0,
  /** Front bumper this far past the line at red = entered the junction → RED_LIGHT. */
  RED_OVERRUN_LIMIT_M: 3.0,
  /** Front bumper past the line by more than this while stopped → STOP_LINE_OVERRUN. */
  OVERRUN_M: 1.0,
} as const;

export const STOP = {
  /** Minimum speed is sampled within this distance before the stop line (front bumper). */
  ZONE_M: 6,
  FULL_STOP_MPS: 0.3,
  FULL_STOP_S: 0.7,
  /** Minimum speed above this when crossing the line → no stop at all. */
  ROLLING_MAX_MPS: 2.0,
  /** Stopping with the front bumper more than this past the line → overrun (minor) … */
  OVERRUN_M: 1.0,
  /** … but more than this past the line is simply a rolling stop. */
  OVERRUN_MAX_M: 2.5,
  /** A slow roll over the line is given this long (and OVERRUN_MAX_M) to turn into a (late) stop. */
  PENDING_S: 4.0,
  APPROACH_INFO_M: 60,
  /** Overrun at give-way / right-hand-rule / roundabout lines (same rule as stop signs). */
  OVERRUN_STOPPED_S: 1.0,
} as const;

export const YIELD = {
  /** An agent on the feeding lane of a priority movement with TTC below this is a conflict. */
  TTC_S: 3.0,
  MIN_AGENT_SPEED_MPS: 1.0,
  /** Any agent flagged disturbedByPlayer within this radius → FAILED_TO_YIELD. */
  DISTURBED_RADIUS_M: 25,
  /** Waiting = slower than this near the line. */
  WAIT_SPEED_MPS: 0.5,
  /** Time after entering the junction within which the connector taken must be identified. */
  DECIDE_WINDOW_S: 2.0,
  APPROACH_INFO_M: 60,
  /** Same disturbed agent is not reported again within this time. */
  DISTURBED_REPEAT_S: 10,
} as const;

export const PEDESTRIANS = {
  LOOKAHEAD_M: 30,
  /** Front bumper must stay this far before the crossing line when a pedestrian is waiting / crossing. */
  STOP_MARGIN_M: 0.5,
  /** Passing the line faster than this with a pedestrian present → PEDESTRIAN_NOT_YIELDED. */
  PASS_SPEED_MPS: 1.0,
  NEAR_MISS_M: 1.5,
  NEAR_MISS_REL_SPEED_MPS: 2.0,
  INFO_M: 40,
  /** A pedestrian within this distance of either end of the crossing line is "near" it. */
  NEAR_CROSSING_M: 6,
} as const;

export const SIGNALLING = {
  TURN_INDICATOR_MIN_S: 1.5,
  TURN_INDICATOR_MIN_M: 20,
  LANE_CHANGE_INDICATOR_MIN_S: 1.0,
  /** Mirror / shoulder glances must have happened within this window before the manoeuvre. */
  GLANCE_WINDOW_S: 5,
  /** Indicator still on this long after a completed turn → INDICATOR_LEFT_ON. */
  LEFT_ON_S: 10,
  PULL_OUT_STOPPED_S: 3,
  /** Right side of the car within this distance of the kerb counts as parked at the kerb. */
  PULL_OUT_KERB_M: 1.2,
  /** An indicator switched off less than this long ago still counts for the turn. */
  RECENT_OFF_GRACE_S: 1.0,
  /** Speed above which the car is considered to have pulled out. */
  PULL_OUT_SPEED_MPS: 0.5,
  /** A stop closer than this to a stop line is traffic, not parking. */
  PULL_OUT_NOT_NEAR_LINE_M: 12,
  PULL_OUT_NO_CROSSING_M: 10,
  PULL_OUT_NO_AGENT_AHEAD_M: 12,
} as const;

export const LANES = {
  /** |lateral| > lane.width/2 − car.width/2 + MARGIN for DEPARTURE_S → LANE_DEPARTURE. */
  DEPARTURE_MARGIN_M: 0.25,
  DEPARTURE_S: 1.5,
  DEPARTURE_MIN_SPEED_MPS: 2,
  /** Car centre this far on the wrong side of the road centre → CENTRE_LINE_CROSSED after CENTRE_LINE_S. */
  CENTRE_LINE_M: 0.3,
  CENTRE_LINE_S: 1.0,
  WRONG_WAY_S: 1.0,
  BUS_LANE_S: 2,
  /** Using the bus lane within this distance of the junction while indicating right is allowed. */
  BUS_LANE_TURN_EXEMPT_M: 30,
  KERB_MOUNT_S: 0.5,
  /** 'vehicle:collision' with the kerb above this impulse → KERB_STRIKE. */
  KERB_STRIKE_MIN_IMPULSE: 20,
  WIDE_TURN_M: 1.5,
  WIDE_TURN_S: 0.5,
  BLOCKING_S: 3,
  /** Exit lane free when no agent within this distance ahead. */
  BLOCKING_EXIT_FREE_M: 8,
  /** Matching a lane with s below this right after a lane change counts as "entering from its start". */
  NO_ENTRY_START_M: 10,
  /** The lane the player was on at this distance before the stop line is the "origin lane" of a turn. */
  WRONG_LANE_LOOKBACK_M: 10,
  MOVING_MPS: 1,
} as const;

export const DISTANCE = {
  TAILGATE_GAP_S: 1.0,
  TAILGATE_MAJOR_GAP_S: 0.5,
  TAILGATE_S: 2.0,
  TAILGATE_MIN_SPEED_MPS: 5.5,
  TAILGATE_MAX_GAP_M: 60,
  HARSH_BRAKE_MPS2: -5.5,
  HARSH_BRAKE_S: 0.2,
  /** A pedestrian / agent within this distance ahead justifies hard braking. */
  HARSH_BRAKE_JUSTIFY_M: 15,
  HARSH_ACCEL_MPS2: 3.5,
  HARSH_ACCEL_S: 0.3,
  NEAR_MISS_M: 0.8,
  NEAR_MISS_REL_SPEED_MPS: 2.0,
  /** Collision events below this impulse are resting contacts, not collisions. */
  COLLISION_MIN_IMPULSE: 5,
} as const;

export const VEHICLE = {
  HANDBRAKE_S: 1.0,
  MOVING_MPS: 1.0,
  /** Coasting in N for this long → WRONG_GEAR. */
  WRONG_GEAR_NEUTRAL_S: 3.0,
  /** D while reversing / R while moving forward for this long → WRONG_GEAR. */
  WRONG_GEAR_S: 0.5,
  WRONG_GEAR_MIN_SPEED_MPS: 0.5,
  ENGINE_OFF_S: 1.0,
} as const;

export const PARKING = {
  STOPPED_S: 3,
  BUS_STOP_M: 12,
  /** Legal minimum distance from a junction (תקנה 72). */
  JUNCTION_M: 12,
  /** Legal minimum distance before a pedestrian crossing. */
  CROSSING_M: 12,
  KERB_MAX_M: 0.4,
  ANGLE_MAX_DEG: 8,
  /** The parking check re-arms after the car moved this far. */
  REARM_MOVE_M: 2,
  STOPPED_MPS: 0.3,
} as const;

export const INSTRUCTIONS = {
  /** Driving this far past an expected stop point without stopping → MISSED_INSTRUCTION. */
  MISSED_STOP_OVERSHOOT_M: 30,
} as const;

/** |speed| below this is "stopped" everywhere in the rules engine. */
export const STOPPED_MPS = 0.3;

export const THRESHOLDS = { LOCALISER, SPEED, SIGNALS, STOP, YIELD, PEDESTRIANS, SIGNALLING, LANES, DISTANCE, VEHICLE, PARKING, INSTRUCTIONS, STOPPED_MPS } as const;
