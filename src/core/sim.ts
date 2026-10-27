/**
 * Integration contract between systems. Every runtime module implements `System`
 * and receives the shared `SimContext` each frame. Order of update per frame:
 *
 *   input → vehicle (fixed physics step) → localiser → signals → traffic → rules → coach → modes → ui
 *
 * Nothing here depends on THREE or Rapier so that rules/coach/traffic can be tested in node.
 */
import type { EventBus } from './events';
import type { EnvironmentState, Localisation, SimMode, TrafficAgentState, VehicleState } from './types';
import type { RoadGraph } from '@/world/graph';
import type { SignalState, WorldFile } from '@/world/schema';

/** Read-only view of traffic-signal state (implemented by src/traffic/signals.ts). */
export interface SignalStateProvider {
  /** State of a signal group at the current simulation time. */
  stateOf(groupId: string): SignalState;
  /** State governing a connector, or undefined when the movement is not signalised. */
  stateForConnector(connectorId: string): SignalState | undefined;
  /** State for a pedestrian crossing group, if signalised. */
  stateForCrossing(crossingId: string): SignalState | undefined;
  /** Seconds until the group's current state changes (for "flashing green" anticipation). */
  timeToChange(groupId: string): number;
  /** Lesson scripting: force a controller/group into a state (undefined = release). */
  override(groupId: string, state: SignalState | undefined): void;
}

export interface Settings {
  /** 0..1 master volume. */
  volume: number;
  tts: boolean;
  subtitles: boolean;
  /** 'keyboard' | 'gamepad' | 'wheel' — informational; input auto-detects. */
  controls: 'keyboard' | 'gamepad' | 'wheel';
  /** Steering assist for keyboard users (0 = raw, 1 = strong smoothing). */
  steeringAssist: number;
  mirrors: boolean;
  quality: 'low' | 'medium' | 'high';
  showLawMonitor: boolean;
  language: 'he';
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  tts: true,
  subtitles: true,
  controls: 'keyboard',
  steeringAssist: 0.6,
  mirrors: true,
  quality: 'medium',
  showLawMonitor: true,
  language: 'he',
};

export interface SimContext {
  /** Simulation time in seconds (pauses when paused). */
  time: number;
  /** Wall-clock delta of the current frame (s), already clamped. */
  dt: number;
  mode: SimMode;
  world: WorldFile;
  graph: RoadGraph;
  bus: EventBus;
  player: VehicleState;
  localisation: Localisation;
  traffic: readonly TrafficAgentState[];
  signals: SignalStateProvider;
  env: EnvironmentState;
  settings: Settings;
  /** Whether a human coach (instructor / examiner) sits in the car. */
  coachPresent: boolean;
  /** Time scale (1 = real time; lessons may slow down briefly). */
  timeScale: number;
  paused: boolean;
}

export interface System {
  readonly name: string;
  update(ctx: SimContext): void;
  dispose?(): void;
}

/** Fixed-step accumulator used by the vehicle physics (60 Hz). */
export class FixedStep {
  private acc = 0;
  constructor(public readonly step = 1 / 60, public readonly maxSubSteps = 4) {}
  run(dt: number, fn: (h: number) => void): void {
    this.acc += Math.min(dt, this.step * this.maxSubSteps);
    let n = 0;
    while (this.acc >= this.step && n < this.maxSubSteps) {
      fn(this.step);
      this.acc -= this.step;
      n++;
    }
  }
}

/** Deterministic PRNG (mulberry32) — all randomness in simulation code must come from here. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function emptyLocalisation(): Localisation {
  return { s: 0, lateral: 0, headingError: 0, wrongWay: false, distToLaneEnd: Infinity, speedLimit: 50, onKerb: false, insideJunction: false };
}

export function defaultVehicleState(pos: [number, number], heading: number): VehicleState {
  return {
    pos,
    y: 0,
    heading,
    speed: 0,
    accel: 0,
    yawRate: 0,
    steering: 0,
    throttle: 0,
    brake: 0,
    handbrake: true,
    gear: 'P',
    rpm: 800,
    engineOn: false,
    indicator: 'off',
    lights: 'off',
    wipers: false,
    horn: false,
    seatbelt: false,
    length: 4.4,
    width: 1.8,
    wheelbase: 2.6,
  };
}
