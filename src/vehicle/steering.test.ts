import { describe, expect, it } from 'vitest';
import { KeyboardSteering, keyboardMaxSteer, keyboardSteerRate, rampPedal, smoothAnalog } from './steering';

const DT = 1 / 60;

function hold(ks: KeyboardSteering, seconds: number, left: boolean, right: boolean, speed: number, assist = 0.6): number {
  let v = 0;
  for (let t = 0; t < seconds; t += DT) v = ks.update(DT, left, right, speed, assist);
  return v;
}

describe('keyboard steering filter', () => {
  it('reaches full lock quickly at standstill and much more slowly at 50 km/h', () => {
    const ks = new KeyboardSteering();
    expect(hold(ks, 0.6, false, true, 0)).toBeGreaterThan(0.9);
    const k2 = new KeyboardSteering();
    const after = hold(k2, 0.25, false, true, 13.9);
    expect(after).toBeGreaterThan(0.05);
    expect(after).toBeLessThan(0.35); // a quarter-second tap at 50 km/h is a gentle correction
    expect(keyboardSteerRate(13.9)).toBeLessThan(keyboardSteerRate(0) / 2);
  });

  it('limits the lock at speed so lane keeping stays calm', () => {
    expect(keyboardMaxSteer(0)).toBe(1);
    expect(keyboardMaxSteer(13.9)).toBeLessThan(0.75);
    expect(keyboardMaxSteer(13.9)).toBeGreaterThan(0.5);
    expect(keyboardMaxSteer(40)).toBe(0.35);
    const ks = new KeyboardSteering();
    expect(hold(ks, 3, false, true, 25)).toBeLessThanOrEqual(keyboardMaxSteer(25) + 1e-6);
  });

  it('self-centres when released, faster at speed', () => {
    const slow = new KeyboardSteering();
    hold(slow, 1, false, true, 0);
    const slowAfter = hold(slow, 0.25, false, false, 0);
    const fast = new KeyboardSteering();
    hold(fast, 1, false, true, 0);
    const fastAfter = hold(fast, 0.25, false, false, 20);
    expect(slowAfter).toBeGreaterThan(0);
    expect(fastAfter).toBeLessThan(slowAfter);
    expect(hold(slow, 2, false, false, 0)).toBe(0);
  });

  it('flicking to the opposite side is quicker than the initial turn', () => {
    const ks = new KeyboardSteering();
    hold(ks, 1, false, true, 5);
    const start = ks.raw;
    ks.update(DT, true, false, 5, 0.6);
    const back = start - ks.raw;
    const fresh = new KeyboardSteering();
    fresh.update(DT, true, false, 5, 0.6);
    expect(back).toBeGreaterThan(Math.abs(fresh.raw) * 1.5);
  });

  it('steering assist adds smoothing (lower assist responds faster)', () => {
    const raw = new KeyboardSteering();
    const assisted = new KeyboardSteering();
    const a = hold(raw, 0.1, false, true, 10, 0);
    const b = hold(assisted, 0.1, false, true, 10, 1);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
  });
});

describe('analog helpers', () => {
  it('smoothAnalog converges and rampPedal ramps', () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = smoothAnalog(v, 1, DT, 0.6);
    expect(v).toBeGreaterThan(0.99);
    let p = 0;
    for (let i = 0; i < 6; i++) p = rampPedal(p, true, DT, 0.3, 0.1);
    expect(p).toBeCloseTo(0.333, 1);
    for (let i = 0; i < 12; i++) p = rampPedal(p, true, DT, 0.3, 0.1);
    expect(p).toBe(1);
    for (let i = 0; i < 6; i++) p = rampPedal(p, false, DT, 0.3, 0.1);
    expect(p).toBe(0);
  });
});
