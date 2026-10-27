/**
 * Intelligent Driver Model (longitudinal control) and speed lookahead helpers — pure functions.
 *
 *   a = a_max · [ 1 − (v / v0)^δ − (s* / gap)² ]
 *   s* = s0 + v·T + v·Δv / (2·sqrt(a_max·b))
 */
import { IDM } from './constants';

export interface DriverParams {
  aMax: number;
  b: number;
  s0: number;
  T: number;
}

export const DEFAULT_DRIVER: DriverParams = { aMax: IDM.aMax, b: IDM.b, s0: IDM.s0, T: IDM.T };

/**
 * IDM acceleration.
 * @param v    own speed (m/s)
 * @param v0   desired speed (m/s)
 * @param gap  bumper-to-bumper distance to the leader (m); Infinity for free road
 * @param dv   approach rate v − v_leader (m/s)
 */
export function idmAcceleration(v: number, v0: number, gap: number, dv: number, p: DriverParams = DEFAULT_DRIVER): number {
  const vv0 = v0 > 0.01 ? v / v0 : v > 0 ? 10 : 0;
  // Free-road term; when already faster than v0 (e.g. the limit dropped) decelerate gently instead of (v/v0)^4 blowing up.
  let free = vv0 <= 1 ? p.aMax * (1 - Math.pow(vv0, IDM.delta)) : -Math.min(2.5, p.aMax * (Math.pow(vv0, IDM.delta) - 1));
  if (!Number.isFinite(gap) || gap >= 1e6) return Math.max(free, -IDM.bMax);
  const g = Math.max(gap, 0.05);
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.aMax * p.b)));
  const inter = p.aMax * (sStar / g) * (sStar / g);
  if (vv0 > 1) free = Math.min(free, 0);
  return Math.max(free - inter, -IDM.bMax);
}

/** Highest speed at distance d from a point where the speed must not exceed vTarget (comfortable decel). */
export function speedAllowedAt(vTarget: number, d: number, decel: number): number {
  return Math.sqrt(Math.max(0, vTarget * vTarget + 2 * decel * Math.max(0, d)));
}

/** Can a vehicle at speed v stop within distance d using at most `decel`? */
export function canStopWithin(v: number, d: number, decel: number): boolean {
  return d >= (v * v) / (2 * decel);
}
