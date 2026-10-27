/**
 * Indicator stalk logic (pure): left / right / hazard with the self-cancelling
 * behaviour of a real stalk — after the car has turned > 60° in the signalled
 * direction and the wheel returns to centre, the indicator switches off.
 */
import type { Indicator } from '@/core/types';
import { angleDiff } from '@/world/geo';

/** Israeli regulations allow 60–120 flashes/min; 90/min looks right. */
export const INDICATOR_BLINK_HZ = 1.5;

/** Lamp phase shared by the dashboard, the exterior lamps and the tick-tock audio. */
export function indicatorLampOn(time: number, since: number): boolean {
  const t = (time - since) * INDICATOR_BLINK_HZ;
  return t - Math.floor(t) < 0.5;
}

export const AUTO_CANCEL_TURN = Math.PI / 3; // 60°
export const AUTO_CANCEL_STEER_CENTRE = 0.15;

export class IndicatorLogic {
  indicator: Indicator = 'off';
  /** Simulation time the current signal was switched on (blink phase origin). */
  since = 0;
  private prevHeading = 0;
  private turned = 0;
  private armed = false;

  /**
   * Apply a stalk request. Pressing the active side again (or 'off') cancels; hazard
   * toggles and has priority over left/right. Returns true when the indicator changed.
   */
  request(req: Indicator, heading: number, time: number): boolean {
    let next: Indicator;
    if (req === 'off') next = 'off';
    else if (req === 'hazard') next = this.indicator === 'hazard' ? 'off' : 'hazard';
    else if (this.indicator === 'hazard') return false;
    else next = this.indicator === req ? 'off' : req;
    if (next === this.indicator) return false;
    this.indicator = next;
    this.since = time;
    this.prevHeading = heading;
    this.turned = 0;
    this.armed = false;
    return true;
  }

  /** Per-tick self-cancel check. Returns true when the indicator was auto-cancelled. */
  update(heading: number, steer: number): boolean {
    const ind = this.indicator;
    if (ind === 'off' || ind === 'hazard') {
      this.prevHeading = heading;
      return false;
    }
    // accumulate the heading change (handles wrap-around and > 180° turns)
    this.turned += angleDiff(this.prevHeading, heading);
    this.prevHeading = heading;
    const inDirection = ind === 'right' ? this.turned : -this.turned; // heading grows clockwise (right)
    if (inDirection > AUTO_CANCEL_TURN) this.armed = true;
    if (this.armed && Math.abs(steer) < AUTO_CANCEL_STEER_CENTRE) {
      this.indicator = 'off';
      this.armed = false;
      this.turned = 0;
      return true;
    }
    return false;
  }

  reset(heading: number): void {
    this.indicator = 'off';
    this.prevHeading = heading;
    this.turned = 0;
    this.armed = false;
  }
}
