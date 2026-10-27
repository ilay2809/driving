import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { runScenario } from '../scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const path = ['r01_11:f0'];
const drive = { startS: 5, endS: 90, profile: [{ atS: 0, speedKmh: 30 }] };

describe('VehicleDetector', () => {
  it('driving with the handbrake on for 1 s → HANDBRAKE_ON', () => {
    const r = runScenario(world, g, path, { ...drive, vehicle: { handbrake: true } });
    expect(r.nonInfo).toEqual(['HANDBRAKE_ON']);
    expect(r.violations[0]!.time).toBeCloseTo(1, 0);
  });

  it('moving without a seat belt → SEATBELT once (critical), re-armed after buckling up', () => {
    const r = runScenario(world, g, path, { ...drive, vehicle: { seatbelt: false } });
    expect(r.nonInfo).toEqual(['SEATBELT']);
    expect(r.violations[0]!.severity).toBe('critical');
    // SEATBELT has a 30 s cooldown: a second report needs a long drive (225 m at 20 km/h ≈ 40 s)
    const long = ['r01_11:f0', 'n11:r01_11:f0>r11_21:f0', 'r11_21:f0'];
    const twice = runScenario(world, g, long, { startS: 5, endS: 220, profile: [{ atS: 0, speedKmh: 20 }], vehicle: { seatbelt: false }, events: [{ atS: 20, seatbelt: true }, { atS: 200, seatbelt: false }] });
    expect(twice.nonInfo).toEqual(['SEATBELT', 'SEATBELT']);
    const once = runScenario(world, g, long, { startS: 5, endS: 220, profile: [{ atS: 0, speedKmh: 20 }], vehicle: { seatbelt: false } });
    expect(once.nonInfo).toEqual(['SEATBELT']);
  });

  it('coasting in N for 3 s → WRONG_GEAR; R while moving forward → WRONG_GEAR after 0.5 s', () => {
    const n = runScenario(world, g, path, { ...drive, vehicle: { gear: 'N' } });
    expect(n.nonInfo).toEqual(['WRONG_GEAR']);
    expect(n.violations[0]!.time).toBeCloseTo(3, 0);
    expect(n.violations[0]!.details).toMatchObject({ gear: 'N' });
    const r = runScenario(world, g, path, { ...drive, vehicle: { gear: 'R' } });
    expect(r.nonInfo).toEqual(['WRONG_GEAR']);
    expect(r.violations[0]!.time).toBeCloseTo(0.5, 0);
    expect(r.violations[0]!.details).toMatchObject({ gear: 'R', direction: 'forward' });
  });

  it('rolling with the engine off → ENGINE_OFF_ROLL after 1 s', () => {
    const r = runScenario(world, g, path, { ...drive, vehicle: { engineOn: false } });
    expect(r.nonInfo).toEqual(['ENGINE_OFF_ROLL']);
    expect(r.violations[0]!.time).toBeCloseTo(1, 0);
  });

  it('a properly set up car produces nothing', () => {
    expect(runScenario(world, g, path, drive).nonInfo).toEqual([]);
  });
});
