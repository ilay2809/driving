/**
 * Speed: speeding bands with tolerance and confirmation times, speed-limit changes,
 * driving far too slowly on a free road, and hesitating at a yield-type approach.
 */
import type { SimContext } from '@/core/sim';
import { mpsToKmh } from '@/world/geo';
import type { Detector, JudgeApi } from '../api';
import type { ApproachInfo } from '../localiser';
import { agentsAhead, conflictAgents, isVehicle, leaderAhead, pedestriansAtCrossing } from '../queries';
import { SPEED as T } from '../thresholds';

type Band = 'minor' | 'major' | 'critical';
const BAND_RANK: Record<Band, number> = { minor: 0, major: 1, critical: 2 };

export class SpeedDetector implements Detector {
  readonly name = 'speed';
  private overTimer = 0;
  /** Highest band already reported in the current continuous speeding episode. */
  private episodeBand?: Band;
  private lastLimit?: number;
  private slowTimer = 0;
  private hesitationKey?: string;
  private noReasonTimer = 0;

  reset(): void {
    this.overTimer = 0;
    this.episodeBand = undefined;
    this.lastLimit = undefined;
    this.slowTimer = 0;
    this.hesitationKey = undefined;
    this.noReasonTimer = 0;
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const loc = ctx.localisation;
    const p = ctx.player;
    const dt = ctx.dt;
    const limit = loc.speedLimit;
    const kmh = mpsToKmh(Math.abs(p.speed));
    const moving = Math.abs(p.speed) > T.TOO_SLOW_MIN_SPEED_MPS;

    // ---- limit changed while driving --------------------------------------------------------
    if (this.lastLimit !== undefined && limit !== this.lastLimit && moving) {
      api.report('SPEED_LIMIT_CHANGED', { details: { from: this.lastLimit, to: limit } });
    }
    this.lastLimit = limit;

    // ---- speeding ---------------------------------------------------------------------------
    const over = kmh - limit - T.TOLERANCE_KMH;
    if (over > 0) {
      this.overTimer += dt;
      const details = { speed: Math.round(kmh), limit, over: Math.round(over) };
      let band: Band | undefined;
      if (over > T.MAJOR_MAX_OVER_KMH) band = 'critical';
      else if (over > T.MINOR_MAX_OVER_KMH) band = this.overTimer >= T.MAJOR_AFTER_S ? 'major' : undefined;
      else band = this.overTimer > T.MINOR_AFTER_S ? 'minor' : undefined;
      if (band && (!this.episodeBand || BAND_RANK[band] > BAND_RANK[this.episodeBand])) {
        const type = band === 'critical' ? 'SPEEDING_CRITICAL' : band === 'major' ? 'SPEEDING_MAJOR' : 'SPEEDING_MINOR';
        if (api.report(type, { details })) this.episodeBand = band;
      }
    } else {
      this.overTimer = 0;
      this.episodeBand = undefined;
    }

    // ---- too slow on a free road ---------------------------------------------------------------
    // Slowing down on purpose (braking, decelerating, signalling to turn / pull over) is not "too slow".
    const slowingOnPurpose = p.brake > 0 || p.accel < -0.2 || p.indicator !== 'off';
    if (moving && p.speed > 0 && kmh < limit * T.TOO_SLOW_FRACTION && loc.laneId && !slowingOnPurpose && this.freeRoad(ctx, api)) {
      this.slowTimer += dt;
      if (this.slowTimer > T.TOO_SLOW_AFTER_S) {
        api.report('TOO_SLOW', { details: { speed: Math.round(kmh), limit } });
        this.slowTimer = 0;
      }
    } else this.slowTimer = 0;

    // ---- hesitation at a yield-type approach ----------------------------------------------------
    // Counts only the time spent stopped WITHOUT a reason (conflicting traffic, a queue, a
    // pedestrian, a non-green signal), so waiting for a car and then going is never penalised.
    const ap = api.approach();
    const key = ap ? `${ap.junction.id}:${ap.approach.roadId}` : undefined;
    if (this.hesitationKey && this.hesitationKey !== key) this.hesitationKey = undefined;
    const atYieldLine =
      ap !== undefined &&
      key !== undefined &&
      !ap.onConnector &&
      (ap.approach.control === 'give_way' || ap.approach.control === 'right_hand_rule' || ap.approach.control === 'roundabout_entry') &&
      ap.distToStopLine > -1 &&
      ap.distToStopLine < T.HESITATION_NEAR_LINE_M;
    const stoppedInDrive = api.stoppedFor > 0 && p.gear === 'D' && !p.handbrake;
    if (atYieldLine && stoppedInDrive && this.hesitationKey !== key) {
      this.noReasonTimer = this.reasonToWait(ctx, api, ap) ? 0 : this.noReasonTimer + dt;
      if (this.noReasonTimer > T.HESITATION_STOPPED_S) {
        api.report('HESITATION', { context: api.junctionContext(ap.junction.id), details: { seconds: Math.round(api.stoppedFor) } });
        this.hesitationKey = key;
        this.noReasonTimer = 0;
      }
    } else this.noReasonTimer = 0;
  }

  private reasonToWait(ctx: SimContext, api: JudgeApi, ap: ApproachInfo): boolean {
    const g = api.graph;
    for (const c of g.connectorsFrom(ap.laneId)) if (conflictAgents(g, ctx, c, T.HESITATION_TTC_S).length > 0) return true;
    if (agentsAhead(ctx, T.HESITATION_QUEUE_AHEAD_M, 2.5, isVehicle).length > 0) return true;
    if (ap.approach.crossingId && pedestriansAtCrossing(ctx, ap.approach.crossingId).length > 0) return true;
    if (ap.approach.signalGroup) {
      const s = ctx.signals.stateOf(ap.approach.signalGroup);
      if (s === 'red' || s === 'red_amber' || s === 'amber') return true;
    }
    return false;
  }

  /** No reason to drive slowly: nobody close ahead, no junction / crossing / control coming up. */
  private freeRoad(ctx: SimContext, api: JudgeApi): boolean {
    const loc = ctx.localisation;
    if (loc.insideJunction || loc.connectorId) return false;
    if (loc.distToLaneEnd < T.TOO_SLOW_FREE_JUNCTION_M) return false;
    if (api.crossingsAhead(T.TOO_SLOW_FREE_JUNCTION_M).length > 0) return false;
    if (leaderAhead(api.graph, ctx, T.TOO_SLOW_FREE_AHEAD_M)) return false;
    if (agentsAhead(ctx, T.TOO_SLOW_FREE_AHEAD_M, 2.0, isVehicle).length > 0) return false;
    return true;
  }
}
