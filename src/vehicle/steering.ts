/**
 * Steering input filters (pure). Keyboard steering is rate based: holding a key turns
 * the wheel at a speed-dependent rate, releasing it lets the wheel self-centre, and a
 * first-order filter (scaled by Settings.steeringAssist) smooths the result so that
 * lane keeping at 50 km/h is relaxed instead of twitchy.
 */

export interface KeyboardSteerParams {
  /** Rate of turn (full lock per second) at standstill. */
  rateAtRest: number;
  /** Speed (m/s) at which the rate has halved. */
  rateHalfSpeed: number;
  /** Max |steer| as a function of speed: 1 − slope·v, floored at `minAtSpeed`. */
  maxSlope: number;
  minAtSpeed: number;
  /** Self-centring rate (per second) at rest and its growth per m/s. */
  centreRate: number;
  centreRatePerMps: number;
  /** Smoothing time constant: tau = tauBase + tauAssist·assist. */
  tauBase: number;
  tauAssist: number;
}

export const DEFAULT_KEYBOARD_STEER: KeyboardSteerParams = {
  rateAtRest: 2.9,
  rateHalfSpeed: 5,
  maxSlope: 0.024,
  minAtSpeed: 0.35,
  centreRate: 1.6,
  centreRatePerMps: 0.16,
  tauBase: 0.03,
  tauAssist: 0.15,
};

export function clamp01s(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Max keyboard steering magnitude at a road speed (m/s). */
export function keyboardMaxSteer(speedMps: number, p: KeyboardSteerParams = DEFAULT_KEYBOARD_STEER): number {
  return Math.max(p.minAtSpeed, 1 - p.maxSlope * Math.abs(speedMps));
}

/** Rate of steering change (per second) at a road speed. */
export function keyboardSteerRate(speedMps: number, p: KeyboardSteerParams = DEFAULT_KEYBOARD_STEER): number {
  return p.rateAtRest / (1 + Math.abs(speedMps) / p.rateHalfSpeed);
}

export class KeyboardSteering {
  /** Filtered output -1..1. */
  value = 0;
  /** Rate-integrated raw wheel position (before smoothing). */
  raw = 0;
  constructor(public params: KeyboardSteerParams = DEFAULT_KEYBOARD_STEER) {}

  reset(): void {
    this.value = 0;
    this.raw = 0;
  }

  update(dt: number, left: boolean, right: boolean, speedMps: number, assist: number): number {
    const p = this.params;
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    const max = keyboardMaxSteer(speedMps, p);
    if (dir !== 0) {
      let rate = keyboardSteerRate(speedMps, p);
      // correcting against the current lock is quicker (like flicking the wheel back)
      if (Math.sign(this.raw) === -dir && this.raw !== 0) rate *= 1.8;
      this.raw = clamp01s(this.raw + dir * rate * dt);
    } else {
      const cr = p.centreRate + p.centreRatePerMps * Math.abs(speedMps);
      const step = cr * dt;
      if (Math.abs(this.raw) <= step) this.raw = 0;
      else this.raw -= Math.sign(this.raw) * step;
    }
    if (Math.abs(this.raw) > max) this.raw = Math.sign(this.raw) * max;
    const tau = p.tauBase + p.tauAssist * Math.max(0, Math.min(1, assist));
    this.value += (this.raw - this.value) * Math.min(1, dt / tau);
    if (Math.abs(this.value) < 1e-4 && this.raw === 0) this.value = 0;
    return this.value;
  }
}

/** Light smoothing for analog sticks (gamepad); wheels are passed through unfiltered. */
export function smoothAnalog(prev: number, target: number, dt: number, assist: number): number {
  const tau = 0.015 + 0.06 * Math.max(0, Math.min(1, assist));
  return prev + (target - prev) * Math.min(1, dt / tau);
}

/**
 * Pedal ramp for keyboard: pressing builds up over `riseTime`, releasing drops over
 * `fallTime` — gives progressive throttle/brake instead of on/off.
 */
export function rampPedal(prev: number, pressed: boolean, dt: number, riseTime: number, fallTime: number): number {
  if (pressed) return Math.min(1, prev + dt / riseTime);
  const v = prev - dt / fallTime;
  return v < 1e-6 ? 0 : v;
}
