/**
 * Traffic signals: red / amber / red+amber at the moment the front bumper crosses the stop
 * line, moving off during red+amber, not moving at green, stopping past the line at red, and
 * the "approaching signals" hint.
 *
 * Red light vs. overrun: crossing the line at red at speed (> 2 m/s) is RED_LIGHT at once. A
 * slow creep over the line is given a short grace: if the car then stops with the bumper
 * 1–3 m past the line → STOP_LINE_OVERRUN (minor); if it continues past 3 m or speeds up →
 * RED_LIGHT. This mirrors how examiners grade "עצירה אחרי הקו" vs "נסיעה באדום".
 */
import type { SimContext } from '@/core/sim';
import type { SignalState } from '@/world/schema';
import type { Detector, JudgeApi } from '../api';
import { agentsAhead, isVehicle, pedestriansAtCrossing } from '../queries';
import { SIGNALS as T, STOPPED_MPS } from '../thresholds';

interface Track {
  key: string;
  prevDist?: number;
  lastState?: SignalState;
  /** Decided at amber onset: could the car have stopped comfortably before the line? */
  amberCouldStop?: boolean;
  wasStoppedAtRed: boolean;
  redAmberReported: boolean;
  greenStoppedTimer: number;
  greenReported: boolean;
  infoSent: boolean;
  pendingRed: boolean;
}

export function stoppingDistance(v: number): number {
  return v * T.AMBER_REACTION_S + (v * v) / (2 * T.AMBER_DECEL_MPS2);
}

export class SignalsDetector implements Detector {
  readonly name = 'signals';
  private track?: Track;

  reset(): void {
    this.track = undefined;
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const ap = api.approach();
    if (!ap || ap.approach.control !== 'signals' || !ap.approach.signalGroup) {
      this.track = undefined;
      return;
    }
    const key = `${ap.junction.id}:${ap.approach.roadId}`;
    if (!this.track || this.track.key !== key) {
      this.track = { key, wasStoppedAtRed: false, redAmberReported: false, greenStoppedTimer: 0, greenReported: false, infoSent: false, pendingRed: false };
    }
    const t = this.track;
    const dist = ap.distToStopLine;
    const state = ctx.signals.stateOf(ap.approach.signalGroup);
    const v = ctx.player.speed;
    const stopped = Math.abs(v) < STOPPED_MPS;
    const context = api.junctionContext(ap.junction.id);

    if (!t.infoSent && dist > 0 && dist <= T.APPROACH_INFO_M) {
      t.infoSent = true;
      api.report('APPROACHING_SIGNALS', { details: { state, distance: Math.round(dist) }, context });
    }

    // amber onset: remember whether stopping was possible
    if (state === 'amber' && t.lastState !== 'amber') {
      t.amberCouldStop = t.lastState === undefined ? undefined : dist > 0 && stoppingDistance(Math.max(0, v)) < dist;
    }

    // red+amber: starting to move from a stop (without crossing the line)
    if ((state === 'red' || state === 'red_amber') && stopped && dist > -1 && dist < 15) t.wasStoppedAtRed = true;
    if (state === 'red_amber') {
      if (t.wasStoppedAtRed && v > T.RED_AMBER_MOVE_MPS && dist > 0 && !t.redAmberReported) {
        t.redAmberReported = true;
        api.report('RED_AMBER_START', { context });
      }
    } else if (state !== 'red') {
      t.wasStoppedAtRed = false;
      t.redAmberReported = false;
    }

    // the front bumper crosses the stop line
    if (t.prevDist !== undefined && t.prevDist > 0 && dist <= 0 && v > 0) {
      const details = { speed: Math.round(v * 3.6), state };
      if (state === 'red') {
        if (v > T.RED_CROSS_SLOW_MPS) api.report('RED_LIGHT', { details, context });
        else t.pendingRed = true;
      } else if (state === 'amber') {
        if (t.amberCouldStop) api.report('AMBER_RUN', { details, context });
      } else if (state === 'red_amber') {
        if (v > T.RED_AMBER_MOVE_MPS && !t.redAmberReported) {
          t.redAmberReported = true;
          api.report('RED_AMBER_START', { details, context });
        }
      }
    }

    // slow creep over the line at red: overrun or, if it goes on, a red-light run
    if (t.pendingRed) {
      if (state !== 'red') t.pendingRed = false;
      else if (dist < -T.RED_OVERRUN_LIMIT_M || v > T.RED_CROSS_SLOW_MPS) {
        t.pendingRed = false;
        api.report('RED_LIGHT', { details: { speed: Math.round(v * 3.6), state }, context });
      } else if (stopped && dist < -T.OVERRUN_M) {
        t.pendingRed = false;
        api.report('STOP_LINE_OVERRUN', { details: { past: Math.round(-dist * 10) / 10 }, context });
      }
    }

    // green, free road, not moving (only the time stopped WITHOUT a reason counts)
    if (state === 'green' && stopped && dist >= -1 && dist <= T.GREEN_NOT_MOVING_NEAR_LINE_M && ctx.player.gear === 'D') {
      const queue = agentsAhead(ctx, T.GREEN_NOT_MOVING_AGENT_AHEAD_M, 2.5, isVehicle).length > 0;
      const ped = ap.approach.crossingId ? pedestriansAtCrossing(ctx, ap.approach.crossingId, ['crossing']).length > 0 : false;
      t.greenStoppedTimer = queue || ped ? 0 : t.greenStoppedTimer + ctx.dt;
      if (t.greenStoppedTimer > T.GREEN_NOT_MOVING_S && !t.greenReported) {
        t.greenReported = true;
        api.report('GREEN_NOT_MOVING', { details: { seconds: Math.round(t.greenStoppedTimer) }, context });
      }
    } else {
      t.greenStoppedTimer = 0;
      if (!stopped) t.greenReported = false;
    }

    t.prevDist = dist;
    t.lastState = state;
  }
}
