/**
 * Vehicle handling: handbrake left on, no seat belt, wrong gear, rolling with the engine off.
 */
import type { SimContext } from '@/core/sim';
import type { Detector, JudgeApi } from '../api';
import { VEHICLE as T } from '../thresholds';

export class VehicleDetector implements Detector {
  readonly name = 'vehicle';
  private handbrakeTimer = 0;
  private seatbeltArmed = true;
  private neutralTimer = 0;
  private gearTimer = 0;
  private engineTimer = 0;

  reset(): void {
    this.handbrakeTimer = 0;
    this.seatbeltArmed = true;
    this.neutralTimer = 0;
    this.gearTimer = 0;
    this.engineTimer = 0;
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const p = ctx.player;
    const dt = ctx.dt;
    const v = p.speed;
    const av = Math.abs(v);

    if (p.handbrake && av > T.MOVING_MPS) {
      this.handbrakeTimer += dt;
      if (this.handbrakeTimer > T.HANDBRAKE_S) {
        api.report('HANDBRAKE_ON');
        this.handbrakeTimer = 0;
      }
    } else this.handbrakeTimer = 0;

    if (av > T.MOVING_MPS && !p.seatbelt) {
      if (this.seatbeltArmed) {
        this.seatbeltArmed = false;
        api.report('SEATBELT');
      }
    } else if (p.seatbelt) this.seatbeltArmed = true;

    if (p.gear === 'N' && v > T.WRONG_GEAR_MIN_SPEED_MPS) {
      this.neutralTimer += dt;
      if (this.neutralTimer > T.WRONG_GEAR_NEUTRAL_S) {
        api.report('WRONG_GEAR', { details: { gear: 'N', reason: 'coasting' } });
        this.neutralTimer = 0;
      }
    } else this.neutralTimer = 0;

    const mismatch = (p.gear === 'D' && v < -T.WRONG_GEAR_MIN_SPEED_MPS) || (p.gear === 'R' && v > T.WRONG_GEAR_MIN_SPEED_MPS) || (p.gear === 'P' && av > T.WRONG_GEAR_MIN_SPEED_MPS);
    if (mismatch) {
      this.gearTimer += dt;
      if (this.gearTimer > T.WRONG_GEAR_S) {
        api.report('WRONG_GEAR', { details: { gear: p.gear, direction: v < 0 ? 'reverse' : 'forward' } });
        this.gearTimer = 0;
      }
    } else this.gearTimer = 0;

    if (!p.engineOn && av > T.MOVING_MPS) {
      this.engineTimer += dt;
      if (this.engineTimer > T.ENGINE_OFF_S) {
        api.report('ENGINE_OFF_ROLL');
        this.engineTimer = 0;
      }
    } else this.engineTimer = 0;
  }
}
