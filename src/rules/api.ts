/**
 * Interfaces between the Judge and its detectors. Detectors never touch the EventBus or the
 * scorer directly — they call `api.report(type, …)` and the Judge applies cooldowns, fills in
 * time / position / Hebrew context, records history and publishes the `violation` event.
 */
import type { SimEventMap } from '@/core/events';
import type { SimContext } from '@/core/sim';
import type { GlanceEvent } from '@/core/types';
import type { Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { ApproachInfo, CrossingAhead } from './localiser';
import type { Severity, Violation, ViolationType } from './violations';

export type CollisionEvent = SimEventMap['vehicle:collision'];

export interface ReportOptions {
  details?: Record<string, string | number | boolean>;
  /** Hebrew context ("ברחוב הדקל"); defaults to the current street / junction. */
  context?: string;
  /** Override the catalogue severity (e.g. TAILGATING below 0.5 s is major). */
  severity?: Severity;
  pos?: Vec2;
  time?: number;
}

export interface JudgeApi {
  readonly graph: RoadGraph;
  /** Simulation time of the current tick (s). */
  readonly time: number;
  readonly dt: number;
  /** Whether an instructor / examiner sits in the car (gates the APPROACHING_* hints). */
  readonly coachPresent: boolean;
  /** Metres driven since reset (|speed| integrated). */
  readonly odometer: number;
  /** Seconds the player has been (nearly) stationary. */
  readonly stoppedFor: number;
  /** Collision events received since the previous tick. */
  readonly collisions: readonly CollisionEvent[];
  /** Junction approach of the lane the player is on (cached per tick). */
  approach(): ApproachInfo | undefined;
  /** Crossings ahead of the front bumper within `within` m, nearest first. */
  crossingsAhead(within: number): CrossingAhead[];
  /** Report a violation; returns it, or undefined when suppressed by the cooldown. */
  report(type: ViolationType, opts?: ReportOptions): Violation | undefined;
  /** Hebrew context for the player's current position. */
  hereContext(): string | undefined;
  streetContext(laneId: string | undefined): string | undefined;
  junctionContext(junctionId: string | undefined): string | undefined;
  /** Mirror / shoulder glances received within the last `seconds`. */
  glancesWithin(seconds: number): GlanceEvent[];
}

export interface Detector {
  readonly name: string;
  update(ctx: SimContext, api: JudgeApi): void;
  reset?(): void;
}
