/**
 * Stop signs (and stop lines of other sign-controlled approaches).
 *
 * Within the 6 m before the line (front bumper) the minimum speed is sampled. A full stop is
 * ≤ 0.3 m/s for ≥ 0.7 s → GOOD_STOP (reported at the moment it is achieved). Crossing the line
 * without one: min speed > 2 m/s → STOP_SIGN_NO_STOP; otherwise the slow roll gets up to 2 s /
 * 2.5 m to turn into a stop: stop with the bumper ≤ 1 m past the line → counted as a stop,
 * 1–2.5 m past → STOP_LINE_OVERRUN, anything else → STOP_SIGN_ROLLING.
 *
 * At give-way / right-hand-rule / roundabout lines a stop with the bumper > 1 m past the line
 * (i.e. on the crossing / in the junction mouth) for ≥ 1 s is also STOP_LINE_OVERRUN.
 */
import type { SimContext } from '@/core/sim';
import type { Detector, JudgeApi } from '../api';
import { STOP as T } from '../thresholds';

interface Track {
  key: string;
  prevDist?: number;
  minSpeed: number;
  stopTimer: number;
  fullStop: boolean;
  infoSent: boolean;
  verdictGiven: boolean;
  pendingSince?: number;
  overrunTimer: number;
  overrunReported: boolean;
}

export class StopSignDetector implements Detector {
  readonly name = 'stopSign';
  private track?: Track;

  reset(): void {
    this.track = undefined;
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const ap = api.approach();
    if (!ap || !ap.stopLine) {
      this.track = undefined;
      return;
    }
    const key = `${ap.junction.id}:${ap.approach.roadId}`;
    if (!this.track || this.track.key !== key) {
      this.track = { key, minSpeed: Infinity, stopTimer: 0, fullStop: false, infoSent: false, verdictGiven: false, overrunTimer: 0, overrunReported: false };
    }
    const t = this.track;
    const dist = ap.distToStopLine;
    const v = Math.abs(ctx.player.speed);
    const dt = ctx.dt;
    const control = ap.approach.control;
    const context = api.junctionContext(ap.junction.id);

    if (control === 'stop') {
      if (!t.infoSent && dist > 0 && dist <= T.APPROACH_INFO_M) {
        t.infoSent = true;
        api.report('APPROACHING_STOP_SIGN', { details: { distance: Math.round(dist) }, context });
      }
      if (!t.verdictGiven && dist > 0 && dist <= T.ZONE_M) {
        t.minSpeed = Math.min(t.minSpeed, v);
        if (v <= T.FULL_STOP_MPS) {
          t.stopTimer += dt;
          if (t.stopTimer >= T.FULL_STOP_S && !t.fullStop) {
            t.fullStop = true;
            api.report('GOOD_STOP', { details: { distance: Math.round(dist * 10) / 10 }, context });
          }
        } else t.stopTimer = 0;
      }
      if (!t.verdictGiven && t.prevDist !== undefined && t.prevDist > 0 && dist <= 0) {
        if (t.fullStop) t.verdictGiven = true;
        else if (t.minSpeed > T.ROLLING_MAX_MPS) {
          t.verdictGiven = true;
          api.report('STOP_SIGN_NO_STOP', { details: { minSpeed: Math.round(t.minSpeed * 3.6) }, context });
        } else {
          t.pendingSince = api.time;
          t.stopTimer = 0;
        }
      }
      if (!t.verdictGiven && t.pendingSince !== undefined) {
        if (v <= T.FULL_STOP_MPS) t.stopTimer += dt;
        else t.stopTimer = 0;
        if (t.stopTimer >= T.FULL_STOP_S) {
          t.verdictGiven = true;
          if (dist >= -T.OVERRUN_M) api.report('GOOD_STOP', { details: { distance: Math.round(dist * 10) / 10 }, context });
          else api.report('STOP_LINE_OVERRUN', { details: { past: Math.round(-dist * 10) / 10 }, context });
        } else if (dist < -T.OVERRUN_MAX_M || v > T.ROLLING_MAX_MPS || (api.time - t.pendingSince > T.PENDING_S && v > T.FULL_STOP_MPS)) {
          t.verdictGiven = true;
          api.report('STOP_SIGN_ROLLING', { details: { minSpeed: Math.round(t.minSpeed * 3.6) }, context });
        }
      }
    } else if ((control === 'give_way' || control === 'right_hand_rule' || control === 'roundabout_entry') && !t.overrunReported) {
      if (v <= T.FULL_STOP_MPS && dist < -T.OVERRUN_M && dist > -(T.OVERRUN_MAX_M + 3)) {
        t.overrunTimer += dt;
        if (t.overrunTimer >= T.OVERRUN_STOPPED_S) {
          t.overrunReported = true;
          api.report('STOP_LINE_OVERRUN', { details: { past: Math.round(-dist * 10) / 10 }, context });
        }
      } else t.overrunTimer = 0;
    }

    t.prevDist = dist;
  }
}
