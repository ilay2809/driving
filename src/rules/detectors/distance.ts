/**
 * Following distance, smoothness and contact: tailgating (time gap to the leader on the
 * player's path), harsh braking / acceleration, collisions and near misses with vehicles.
 */
import type { SimContext } from '@/core/sim';
import type { Detector, JudgeApi } from '../api';
import { bodyDistance, relativeSpeed } from '../geometry';
import { agentsAhead, isVehicle, leaderAhead } from '../queries';
import { HE } from '../strings.he';
import { DISTANCE as T } from '../thresholds';

const NEAR_MISS_REPEAT_S = 5;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

export class DistanceDetector implements Detector {
  readonly name = 'distance';
  private tailgateTimer = 0;
  private brakeTimer = 0;
  private brakeReported = false;
  private accelTimer = 0;
  private accelReported = false;
  private nearMissSeen = new Map<string, number>();

  reset(): void {
    this.tailgateTimer = 0;
    this.brakeTimer = 0;
    this.brakeReported = false;
    this.accelTimer = 0;
    this.accelReported = false;
    this.nearMissSeen.clear();
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const p = ctx.player;
    const dt = ctx.dt;
    const v = p.speed;

    // ---- tailgating --------------------------------------------------------------------------
    if (v > T.TAILGATE_MIN_SPEED_MPS) {
      const leader = leaderAhead(api.graph, ctx, T.TAILGATE_MAX_GAP_M);
      const gap = leader ? leader.gap / v : Infinity;
      if (leader && gap < T.TAILGATE_GAP_S) {
        this.tailgateTimer += dt;
        if (this.tailgateTimer > T.TAILGATE_S) {
          api.report('TAILGATING', { severity: gap < T.TAILGATE_MAJOR_GAP_S ? 'major' : undefined, details: { gapSeconds: r2(gap), gapMetres: r1(leader.gap), agent: leader.agent.id } });
          this.tailgateTimer = 0;
        }
      } else this.tailgateTimer = 0;
    } else this.tailgateTimer = 0;

    // ---- harsh braking ------------------------------------------------------------------------
    if (p.accel < T.HARSH_BRAKE_MPS2 && v > 0) {
      this.brakeTimer += dt;
      if (this.brakeTimer >= T.HARSH_BRAKE_S && !this.brakeReported) {
        this.brakeReported = true;
        const justified = agentsAhead(ctx, T.HARSH_BRAKE_JUSTIFY_M, 3).length > 0;
        if (!justified) api.report('HARSH_BRAKING', { details: { decel: r1(-p.accel) } });
      }
    } else {
      this.brakeTimer = 0;
      this.brakeReported = false;
    }

    // ---- harsh acceleration ------------------------------------------------------------------------
    if (p.accel > T.HARSH_ACCEL_MPS2) {
      this.accelTimer += dt;
      if (this.accelTimer >= T.HARSH_ACCEL_S && !this.accelReported) {
        this.accelReported = true;
        api.report('HARSH_ACCELERATION', { details: { accel: r1(p.accel) } });
      }
    } else {
      this.accelTimer = 0;
      this.accelReported = false;
    }

    // ---- collisions ------------------------------------------------------------------------------------
    for (const col of api.collisions) {
      if (col.with === 'kerb' || col.impulse < T.COLLISION_MIN_IMPULSE) continue;
      api.report('COLLISION', { details: { with: col.with, impulse: Math.round(col.impulse) }, context: HE.collision[col.with], pos: col.pos, time: col.time });
    }

    // ---- near misses with vehicles ----------------------------------------------------------------------
    for (const a of ctx.traffic) {
      if (!isVehicle(a)) continue;
      // optional flag some traffic implementations set; not part of the shared contract
      const flagged = (a as { nearMissWithPlayer?: boolean }).nearMissWithPlayer === true;
      let d = 0;
      if (!flagged) {
        d = bodyDistance(p, a);
        if (d >= T.NEAR_MISS_M || relativeSpeed(p, a) <= T.NEAR_MISS_REL_SPEED_MPS) continue;
      }
      const last = this.nearMissSeen.get(a.id);
      if (last !== undefined && api.time - last < NEAR_MISS_REPEAT_S) continue;
      this.nearMissSeen.set(a.id, api.time);
      api.report('NEAR_MISS', { details: { agent: a.id, distance: r2(d) } });
    }
  }
}
