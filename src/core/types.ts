/**
 * Runtime state shared between systems (vehicle → rules/coach/traffic/ui).
 * Keep these plain data objects — no THREE / Rapier types here so that the rules
 * engine and the coach can run in node tests.
 */
import type { Vec2 } from '@/world/geo';

export type Gear = 'P' | 'R' | 'N' | 'D';
export type Indicator = 'off' | 'left' | 'right' | 'hazard';
export type Lights = 'off' | 'parking' | 'low' | 'high';

export interface VehicleState {
  /** World position of the vehicle centre (ground level). */
  pos: Vec2;
  /** Height above ground (for bridges — flat world: 0). */
  y: number;
  /** Heading per src/world/geo.ts conventions. */
  heading: number;
  /** Signed longitudinal speed, m/s (negative when reversing). */
  speed: number;
  /** Longitudinal acceleration, m/s². */
  accel: number;
  /** Yaw rate rad/s. */
  yawRate: number;
  steering: number; // -1 (full left) .. +1 (full right)
  throttle: number; // 0..1
  brake: number; // 0..1
  handbrake: boolean;
  gear: Gear;
  rpm: number;
  engineOn: boolean;
  indicator: Indicator;
  lights: Lights;
  wipers: boolean;
  horn: boolean;
  seatbelt: boolean;
  /** Vehicle body size (m). */
  length: number;
  width: number;
  /** Wheelbase (m). */
  wheelbase: number;
}

export type GlanceTarget = 'rear_mirror' | 'left_mirror' | 'right_mirror' | 'left_shoulder' | 'right_shoulder' | 'ahead';

export interface GlanceEvent {
  target: GlanceTarget;
  time: number;
}

export type AgentKind = 'car' | 'bus' | 'truck' | 'motorcycle' | 'bicycle' | 'scooter' | 'pedestrian' | 'emergency';

/** A traffic participant as seen by the rules engine and the coach. */
export interface TrafficAgentState {
  id: string;
  kind: AgentKind;
  pos: Vec2;
  heading: number;
  speed: number; // m/s, along heading
  length: number;
  width: number;
  /** Lane id the agent currently follows (vehicles), or undefined for pedestrians. */
  laneId?: string;
  /** Connector id when inside a junction. */
  connectorId?: string;
  /** Arc-length along the current lane/connector. */
  s?: number;
  indicator?: Indicator;
  /** Pedestrians: crossing id they are waiting at / crossing. */
  crossingId?: string;
  /** Pedestrians: 'waiting' at the kerb, 'crossing', or 'walking' elsewhere. */
  pedState?: 'waiting' | 'crossing' | 'walking';
  /** Set when the agent had to brake hard / swerve because of the player this frame. */
  disturbedByPlayer?: boolean;
  /** Emergency vehicle with siren on. */
  siren?: boolean;
}

/** Where the player is on the road network (computed by the localiser each tick). */
export interface Localisation {
  laneId?: string;
  connectorId?: string;
  roadId?: string;
  junctionId?: string;
  /** Arc-length along the lane / connector. */
  s: number;
  /** Lateral offset from the lane centre (m, positive = right). */
  lateral: number;
  /** Heading difference between the car and the lane direction (rad). */
  headingError: number;
  /** True when driving against the lane direction. */
  wrongWay: boolean;
  /** Distance (m) to the end of the lane (= the next junction's stop line region). */
  distToLaneEnd: number;
  /** Next junction id and the approach's control. */
  nextJunctionId?: string;
  speedLimit: number; // km/h
  onKerb: boolean;
  insideJunction: boolean;
}

export interface EnvironmentState {
  /** Simulation time, seconds since start. */
  time: number;
  /** Hour of day 0..24 (affects lighting, headlights rule). */
  hour: number;
  weather: 'clear' | 'rain' | 'fog';
  /** Wet road reduces grip and increases required following distance. */
  wetRoad: boolean;
}

export type SimMode = 'menu' | 'lesson' | 'free' | 'test' | 'theory' | 'training_ground';
