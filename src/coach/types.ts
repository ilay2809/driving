/**
 * Types shared inside the coach module (instructor, examiner, lesson runner, navigator).
 * Pure data — no THREE, usable in node tests.
 */
import type { SimContext } from '@/core/sim';
import type { Turn } from '@/world/schema';
import type { ViolationType } from '@/rules/violations';

/** Manoeuvres an examiner (or a lesson) can request. */
export type ManeuverKind = 'parallel_park' | 'pull_over' | 'reverse' | 'uturn' | 'emergency_stop' | 'hill_start';

/** Kinds of turn-by-turn instruction the navigator emits (`NavInstruction.kind`). */
export type NavKind = 'turn_left' | 'turn_right' | 'straight' | 'roundabout_exit' | 'uturn' | 'arrive' | 'pull_over' | 'reverse' | 'stop_here' | 'park';

/**
 * Result of the parking / kerb-stop assessment. Produced by the rules module's parking
 * detector (passed in through `setParkingReporter`) or, when none is wired, by the
 * coach's own estimator (`src/coach/parking.ts`).
 */
export interface ParkingReport {
  /** The car is stationary (|v| < 0.15 m/s). */
  stopped: boolean;
  /** Seconds the car has been stationary. */
  stoppedFor: number;
  /** Stationary and secured (gear P or parking brake). */
  parked: boolean;
  /** Distance from the right side of the car to the kerb (m), if known. */
  kerbDistance?: number;
  /** Angle between the car and the kerb (degrees), if known. */
  angleDeg?: number;
  /** Whether stopping / parking at this spot is legal. */
  legal: boolean;
  /** Hebrew reasons when illegal (e.g. "אבן שפה אדומה-לבנה"). */
  reasons: string[];
  /** Parking bay the car occupies (from ParkingStrip.bays), if any. */
  bayId?: string;
  laneId?: string;
}

export type ParkingReporter = (ctx: SimContext) => ParkingReport | undefined;

export type DangerKind = 'red_signal' | 'pedestrian' | 'yield' | 'collision';

/** A predicted imminent danger (the dual-brake trigger). */
export interface DangerPrediction {
  kind: DangerKind;
  /** Hebrew, human-readable reason for the HUD / result sheet. */
  reason: string;
  /** Seconds until the conflict (0 when already inside it). */
  ttc: number;
  /** Id of the agent / crossing / junction involved. */
  subject?: string;
}

export interface TestVerdict {
  passed: boolean;
  points: number;
  byType: Partial<Record<ViolationType, number>>;
  /** Hebrew, one line per main reason for failing (empty when passed). */
  mainReasons: string[];
  /** 2–3 Hebrew sentences: strengths / weaknesses. */
  examinerSummary: string;
  majors: number;
  criticals: number;
  minors: number;
}

/** Maps a connector turn to the coarse DSL turn classes. */
export function coarseTurn(turn: Turn): 'straight' | 'left' | 'right' | 'uturn' {
  switch (turn) {
    case 'left':
    case 'slight_left':
    case 'sharp_left':
      return 'left';
    case 'right':
    case 'slight_right':
    case 'sharp_right':
      return 'right';
    case 'uturn':
      return 'uturn';
    default:
      return 'straight';
  }
}
