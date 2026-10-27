import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { ScriptedDrive, runScenario } from '../scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const CAR = 4.4;
const main = ['r01_11:f0'];

describe('SpeedDetector', () => {
  it('reports SPEEDING_MAJOR after 1 s at 65 km/h on a 50 km/h road', () => {
    const r = runScenario(world, g, main, { startS: 5, endS: 95, profile: [{ atS: 0, speedKmh: 65 }] });
    expect(r.nonInfo).toEqual(['SPEEDING_MAJOR']);
    const v = r.violations.find((x) => x.type === 'SPEEDING_MAJOR')!;
    expect(v.time).toBeCloseTo(1, 0);
    expect(v.details).toMatchObject({ speed: 65, limit: 50 });
    expect(v.context).toBe('בשדרות הראשיים');
  });

  it('tolerates 54 km/h for 2 s, then reports SPEEDING_MINOR once', () => {
    const r = runScenario(world, g, main, { startS: 5, endS: 95, profile: [{ atS: 0, speedKmh: 54 }] });
    expect(r.nonInfo).toEqual(['SPEEDING_MINOR']);
    const v = r.violations.find((x) => x.type === 'SPEEDING_MINOR')!;
    expect(v.time).toBeGreaterThan(2);
    expect(v.time).toBeLessThan(2.2);
  });

  it('reports SPEEDING_CRITICAL immediately above +20 km/h and nothing at the limit', () => {
    const r = runScenario(world, g, main, { startS: 5, endS: 95, profile: [{ atS: 0, speedKmh: 80 }] });
    expect(r.nonInfo).toEqual(['SPEEDING_CRITICAL']);
    expect(r.violations[0]!.time).toBeLessThan(0.1);
    const ok = runScenario(world, g, main, { startS: 5, endS: 95, profile: [{ atS: 0, speedKmh: 52 }] });
    expect(ok.nonInfo).toEqual([]);
  });

  it('does not downgrade to a minor report within the same speeding episode', () => {
    const r = runScenario(world, g, main, { startS: 5, endS: 95, profile: [{ atS: 0, speedKmh: 65 }, { atS: 30, speedKmh: 65 }, { atS: 40, speedKmh: 56 }] });
    expect(r.nonInfo).toEqual(['SPEEDING_MAJOR']);
  });

  it('reports SPEED_LIMIT_CHANGED when entering the 30 km/h zone', () => {
    const path = ['r11_12:f0', 'n12:r11_12:f0>r12_22:f0', 'r12_22:f0'];
    const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 30 }] });
    const lineS = probe.sOf('r11_12:f0', g.lane('r11_12:f0').length);
    const r = runScenario(world, g, path, {
      startS: lineS - 50,
      endS: lineS + 40,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 30, speedKmh: 30 },
        { atS: lineS - 1 - CAR / 2, speedKmh: 0, hold: 1.5 },
        { atS: lineS + 15, speedKmh: 25 },
      ],
      events: [{ atS: lineS - 40, indicator: 'left' }],
    });
    const v = r.violations.find((x) => x.type === 'SPEED_LIMIT_CHANGED')!;
    expect(v).toBeDefined();
    expect(v.details).toEqual({ from: 50, to: 30 });
    expect(v.context).toBe('ברחוב החצב');
    expect(r.nonInfo).toEqual([]);
  });

  it('reports TOO_SLOW after 8 s at 15 km/h on a long free road', () => {
    const r = runScenario(world, g, ['r21_rbw:f0'], { startS: 5, endS: 100, profile: [{ atS: 0, speedKmh: 15 }] });
    expect(r.nonInfo).toEqual(['TOO_SLOW']);
    expect(r.violations.find((x) => x.type === 'TOO_SLOW')!.time).toBeCloseTo(8, 0);
  });

  it('does not report TOO_SLOW while indicating, braking, or with a car ahead', () => {
    const indicating = runScenario(world, g, ['r21_rbw:f0'], { startS: 5, endS: 100, profile: [{ atS: 0, speedKmh: 15 }], events: [{ atS: 0, indicator: 'right' }] });
    expect(indicating.nonInfo).toEqual([]);
    const braking = runScenario(world, g, ['r21_rbw:f0'], { startS: 5, endS: 100, profile: [{ atS: 0, speedKmh: 30 }, { atS: 20, speedKmh: 30 }, { atS: 95, speedKmh: 2 }] });
    expect(braking.nonInfo).toEqual([]);
    const queue = runScenario(world, g, ['r21_rbw:f0'], {
      startS: 5,
      endS: 100,
      profile: [{ atS: 0, speedKmh: 15 }],
      setup: (ctx) => ctx.traffic.push({ id: 'slow', kind: 'car', pos: [150, 1.65], heading: 0, speed: 4, length: 4.4, width: 1.8, laneId: 'r21_rbw:f0', s: 22.4 }),
      run: { onTick: (ctx) => (ctx.traffic[0]!.pos[0] = 150 + 4 * ctx.time), },
    });
    expect(queue.nonInfo).toEqual([]);
  });

  describe('HESITATION', () => {
    const path = ['r00_01:f0', 'n01:r00_01:f0>r01_02:f0', 'r01_02:f0'];
    const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 30 }] });
    const lineS = probe.sOf('r00_01:f0', g.lane('r00_01:f0').length);
    const stopS = lineS - 1 - CAR / 2;
    const opts = {
      startS: lineS - 60,
      endS: lineS + 30,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 35, speedKmh: 30 },
        { atS: stopS, speedKmh: 0, hold: 6 },
        { atS: lineS + 15, speedKmh: 25 },
      ],
    };

    it('reports a stop of more than 4 s at a free give-way line', () => {
      const r = runScenario(world, g, path, opts);
      expect(r.nonInfo).toEqual(['HESITATION']);
      expect(r.violations.find((x) => x.type === 'HESITATION')!.context).toBe('בצומת 01');
    });

    it('stays quiet while a car with priority is in the junction', () => {
      const r = runScenario(world, g, path, {
        ...opts,
        endS: stopS,
        run: { tailSeconds: 7 },
        setup: (ctx) => ctx.traffic.push({ id: 'prio', kind: 'car', pos: [-116, 2], heading: Math.PI / 2, speed: 0, length: 4.4, width: 1.8, connectorId: 'n01:r01_11:b0>r01_02:f0', s: 6 }),
      });
      expect(r.nonInfo).toEqual([]);
    });

    it('stays quiet when the car is parked (P) at the line', () => {
      const r = runScenario(world, g, path, { ...opts, events: [{ atS: stopS, gear: 'P' }, { atTime: 99, gear: 'D' }] });
      expect(r.nonInfo).not.toContain('HESITATION');
    });
  });
});
