import { describe, expect, it } from 'vitest';
import { DEFAULT_DRIVETRAIN, Drivetrain, brakeForces, creepForce, driveForce, engineRpm, engineTorque, resistanceForce, rpmFromSpeed, selectGear, speedFromRpm } from './drivetrain';
import { kmhToMps } from '@/world/geo';

const S = DEFAULT_DRIVETRAIN;

describe('engine model', () => {
  it('has the torque peak at the peak rpm and cuts fuel past the redline', () => {
    expect(engineTorque(S.peakTorqueRpm)).toBeCloseTo(S.peakTorque, 5);
    expect(engineTorque(S.idleRpm)).toBeLessThan(S.peakTorque);
    expect(engineTorque(S.idleRpm)).toBeGreaterThan(S.peakTorque * 0.5);
    expect(engineTorque(S.redlineRpm)).toBeGreaterThan(0);
    expect(engineTorque(S.redlineRpm + 1)).toBe(0);
    // monotone up to the peak
    let prev = 0;
    for (let r = S.idleRpm; r <= S.peakTorqueRpm; r += 100) {
      const t = engineTorque(r);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('rpm ↔ speed are inverse and give sane values', () => {
    const v = kmhToMps(50);
    const rpm3 = rpmFromSpeed(v, 3);
    expect(speedFromRpm(rpm3, 3)).toBeCloseTo(v, 6);
    expect(rpm3).toBeGreaterThan(1500);
    expect(rpm3).toBeLessThan(3500);
    // 1st gear at 25 km/h is already revving
    expect(rpmFromSpeed(kmhToMps(25), 1)).toBeGreaterThan(2500);
    // 5th at 90 km/h cruises
    const rpm90 = rpmFromSpeed(kmhToMps(90), 5);
    expect(rpm90).toBeGreaterThan(1800);
    expect(rpm90).toBeLessThan(3200);
  });

  it('engine rpm floats on the converter at low speed and revs freely in N', () => {
    expect(engineRpm(0, 1, 0, true)).toBe(S.idleRpm);
    expect(engineRpm(0, 1, 1, true)).toBeCloseTo(S.stallRpm, 0);
    expect(engineRpm(0, null, 1, true)).toBeGreaterThan(5000);
    expect(engineRpm(10, 2, 0.3, false)).toBe(0);
    expect(engineRpm(kmhToMps(50), 3, 0.3, true)).toBeCloseTo(rpmFromSpeed(kmhToMps(50), 3), 0);
    expect(engineRpm(100, 5, 1, true)).toBeLessThanOrEqual(S.redlineRpm);
  });

  it('drive force is strongest in 1st and falls with the gears', () => {
    const f1 = driveForce(2500, 1, 1, 5);
    const f2 = driveForce(2500, 1, 2, 10);
    const f5 = driveForce(2500, 1, 5, 25);
    expect(f1).toBeGreaterThan(f2);
    expect(f2).toBeGreaterThan(f5);
    expect(f1 / S.mass).toBeGreaterThan(2.5); // > 0.25 g launch
    expect(f1 / S.mass).toBeLessThan(6);
    expect(driveForce(2500, 0, 1, 5)).toBe(0);
  });
});

describe('automatic gear selection', () => {
  it('starts in 1st and climbs through the gears with speed at part throttle', () => {
    let g = 1;
    const seen: number[] = [1];
    for (let kmh = 0; kmh <= 110; kmh += 2) {
      const next = selectGear(g, kmhToMps(kmh), 0.4);
      expect(Math.abs(next - g)).toBeLessThanOrEqual(1);
      if (next !== g) seen.push(next);
      g = next;
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('shifts up later with more throttle (2 800 → 3 500 rpm) and holds gears at full throttle (kickdown)', () => {
    const upSpeed = (throttle: number): number => {
      for (let kmh = 5; kmh < 120; kmh += 0.5) if (selectGear(1, kmhToMps(kmh), throttle) === 2) return kmhToMps(kmh);
      return Infinity;
    };
    const light = upSpeed(0);
    const medium = upSpeed(0.8);
    const full = upSpeed(1);
    expect(rpmFromSpeed(light, 1)).toBeGreaterThan(2700);
    expect(rpmFromSpeed(light, 1)).toBeLessThan(2950);
    expect(rpmFromSpeed(medium, 1)).toBeGreaterThan(3400);
    expect(rpmFromSpeed(medium, 1)).toBeLessThan(3650);
    expect(rpmFromSpeed(full, 1)).toBeGreaterThan(4900);
  });

  it('kicks down when the driver floors it at cruising speed and downshifts when lugging', () => {
    const v50 = kmhToMps(50);
    expect(selectGear(4, v50, 0.2)).toBe(4); // light cruise in 4th is fine
    expect(selectGear(4, v50, 1)).toBe(3); // floor it → one gear down
    expect(selectGear(3, kmhToMps(12), 0)).toBe(2); // crawling in 3rd → down
    expect(selectGear(1, 0, 0)).toBe(1);
    expect(selectGear(5, kmhToMps(100), 1)).toBe(4); // 100 km/h flat out: 5th → 4th (≈ 3 300 rpm)
    expect(selectGear(5, kmhToMps(160), 1)).toBe(5); // no kickdown when the lower gear would over-rev
  });
});

describe('creep, brakes and resistance', () => {
  it('creeps forward and fades out around the creep speed', () => {
    expect(creepForce(0)).toBe(S.creepForceMax);
    expect(creepForce(-1)).toBe(S.creepForceMax); // rolling back against the gear: full push
    expect(creepForce(S.creepSpeed)).toBe(0);
    expect(creepForce(S.creepSpeed * 0.8)).toBeGreaterThan(0);
    expect(creepForce(5)).toBe(0);
  });

  it('full brake pedal gives ~8 m/s² with a front bias; handbrake acts on the rear', () => {
    const [fl, fr, rl, rr] = brakeForces(1, false);
    expect(fl).toBe(fr);
    expect(rl).toBe(rr);
    expect(fl).toBeGreaterThan(rl);
    expect((fl + fr + rl + rr) / S.mass).toBeCloseTo(S.maxBrakeDecel, 5);
    const hb = brakeForces(0, true);
    expect(hb[0]).toBe(0);
    expect(hb[2]).toBeGreaterThan(0);
    expect((hb[2] + hb[3]) / S.mass).toBeCloseTo(S.handbrakeDecel, 5);
  });

  it('resistance is zero at rest and grows with speed²', () => {
    expect(resistanceForce(0)).toBe(0);
    const r10 = resistanceForce(10);
    const r20 = resistanceForce(20);
    expect(r20 - r10).toBeGreaterThan(r10 - resistanceForce(0.1));
  });
});

describe('Drivetrain (stateful)', () => {
  const run = (dt: Drivetrain, seconds: number, inp: Parameters<Drivetrain['update']>[1]) => {
    let out = dt.update(1 / 60, inp);
    for (let t = 0; t < seconds; t += 1 / 60) out = dt.update(1 / 60, inp);
    return out;
  };

  it('idles in P, settles the rpm, locks the wheels and produces no drive', () => {
    const dt = new Drivetrain();
    const out = run(dt, 1, { lever: 'P', throttle: 0, brake: 0, handbrake: false, engineOn: true, speed: 0 });
    expect(out.rpm).toBeCloseTo(S.idleRpm, 0);
    expect(out.driveForce).toBe(0);
    expect(out.brakeForces[0]).toBeGreaterThan(S.mass * 2);
  });

  it('creeps in D with no pedals and reverses the creep in R', () => {
    const dt = new Drivetrain();
    const d = run(dt, 0.5, { lever: 'D', throttle: 0, brake: 0, handbrake: false, engineOn: true, speed: 0 });
    expect(d.driveForce).toBeCloseTo(S.creepForceMax, 3);
    const r = run(dt, 0.5, { lever: 'R', throttle: 0, brake: 0, handbrake: false, engineOn: true, speed: 0 });
    expect(r.driveForce).toBeCloseTo(-S.creepForceMax, 3);
    const n = run(dt, 0.5, { lever: 'N', throttle: 1, brake: 0, handbrake: false, engineOn: true, speed: 0 });
    expect(n.driveForce).toBe(0);
    expect(n.rpm).toBeGreaterThan(4000);
  });

  it('brake pedal removes drive (creep included) and the dead engine gives nothing', () => {
    const dt = new Drivetrain();
    const b = run(dt, 0.5, { lever: 'D', throttle: 1, brake: 0.5, handbrake: false, engineOn: true, speed: 3 });
    expect(b.driveForce).toBe(0);
    expect(b.brakeForces[0]).toBeGreaterThan(1000);
    const off = run(dt, 2, { lever: 'D', throttle: 1, brake: 0, handbrake: false, engineOn: false, speed: 3 });
    expect(off.driveForce).toBe(0);
    expect(off.rpm).toBe(0); // spun down (first-order lag, snapped to 0)
  });

  it('applies the shift lockout and a torque cut when changing gear', () => {
    const dt = new Drivetrain();
    run(dt, 0.2, { lever: 'D', throttle: 0.5, brake: 0, handbrake: false, engineOn: true, speed: 2 });
    expect(dt.gearIndex).toBe(1);
    const fast = { lever: 'D' as const, throttle: 0.5, brake: 0, handbrake: false, engineOn: true, speed: kmhToMps(55) };
    const o1 = dt.update(1 / 60, fast);
    expect(dt.gearIndex).toBe(2);
    expect(o1.shifting).toBe(true);
    // cannot shift again immediately even though 55 km/h in 2nd (≈ 3 760 rpm) wants 3rd
    dt.update(1 / 60, fast);
    expect(dt.gearIndex).toBe(2);
    const o2 = run(dt, S.shiftLockout + S.shiftCutTime + 0.2, fast);
    expect(dt.gearIndex).toBe(3);
    expect(o2.shifting).toBe(false);
  });
});
