import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { ScriptedAgent, runScenario } from '../scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const main = ['r01_11:f0', 'n11:r01_11:f0>r11_21:f0', 'r11_21:f0'];

describe('DistanceDetector', () => {
  it('following a car at 0.7 s for 2 s → TAILGATING (minor), at 0.4 s → major', () => {
    const minor = runScenario(world, g, main, { startS: 10, endS: 90, profile: [{ atS: 0, speedKmh: 30 }], run: { agents: [new ScriptedAgent(g, main, { id: 'lead', speedKmh: 30, startS: 20 })] } });
    expect(minor.nonInfo).toEqual(['TAILGATING']);
    const v = minor.violations.find((x) => x.type === 'TAILGATING')!;
    expect(v.severity).toBe('minor');
    expect(v.time).toBeCloseTo(2, 0);
    expect(v.details).toMatchObject({ agent: 'lead' });
    expect(v.details!.gapSeconds as number).toBeLessThan(1);
    const major = runScenario(world, g, main, { startS: 10, endS: 90, profile: [{ atS: 0, speedKmh: 30 }], run: { agents: [new ScriptedAgent(g, main, { id: 'lead', speedKmh: 30, startS: 17.4 })] } });
    expect(major.violations.find((x) => x.type === 'TAILGATING')!.severity).toBe('major');
    const safe = runScenario(world, g, main, { startS: 10, endS: 90, profile: [{ atS: 0, speedKmh: 30 }], run: { agents: [new ScriptedAgent(g, main, { id: 'lead', speedKmh: 30, startS: 35 })] } });
    expect(safe.nonInfo).toEqual([]);
  });

  it('a car in the next lane is not a leader', () => {
    const r = runScenario(world, g, main, { startS: 10, endS: 90, profile: [{ atS: 0, speedKmh: 30 }], run: { agents: [new ScriptedAgent(g, ['r01_11:f1'], { id: 'beside', speedKmh: 30, startS: 20 })] } });
    expect(r.nonInfo).toEqual([]);
  });

  it('braking harder than 5.5 m/s² → HARSH_BRAKING, unless something ahead justified it', () => {
    const profile = [
      { atS: 0, speedKmh: 50 },
      { atS: 40, speedKmh: 50 },
      { atS: 50, speedKmh: 0, hold: 1 },
      { atS: 75, speedKmh: 30 },
    ];
    const r = runScenario(world, g, ['r01_11:f0'], { startS: 5, endS: 90, profile });
    expect(r.nonInfo).toEqual(['HARSH_BRAKING']);
    expect(r.violations.find((x) => x.type === 'HARSH_BRAKING')!.details!.decel as number).toBeGreaterThan(5.5);
    const justified = runScenario(world, g, ['r01_11:f0'], {
      startS: 5,
      endS: 48,
      profile,
      setup: (ctx) => ctx.traffic.push({ id: 'ped', kind: 'pedestrian', pos: [-112.4 + 57, 1.65], heading: 0, speed: 0, length: 0.5, width: 0.5 }),
    });
    expect(justified.nonInfo).not.toContain('HARSH_BRAKING');
  });

  it('accelerating harder than 3.5 m/s² → HARSH_ACCELERATION', () => {
    const r = runScenario(world, g, ['r01_11:f0'], { startS: 5, endS: 60, profile: [{ atS: 5, speedKmh: 0, hold: 1 }, { atS: 20, speedKmh: 50 }] });
    expect(r.nonInfo).toEqual(['HARSH_ACCELERATION']);
    const gentle = runScenario(world, g, ['r01_11:f0'], { startS: 5, endS: 95, profile: [{ atS: 5, speedKmh: 0, hold: 1 }, { atS: 65, speedKmh: 50 }] });
    expect(gentle.nonInfo).toEqual([]);
  });

  it('a collision event with a vehicle → COLLISION (critical) with the partner as context', () => {
    let sent = false;
    const r = runScenario(world, g, ['r01_11:f0'], {
      startS: 5,
      endS: 40,
      profile: [{ atS: 0, speedKmh: 20 }],
      run: {
        onTick: (ctx) => {
          if (ctx.time > 1 && !sent) {
            sent = true;
            ctx.bus.emit('vehicle:collision', { with: 'vehicle', impulse: 2, pos: ctx.player.pos, time: ctx.time }); // resting contact
            ctx.bus.emit('vehicle:collision', { with: 'vehicle', impulse: 800, pos: ctx.player.pos, time: ctx.time });
          }
        },
      },
    });
    expect(r.nonInfo).toEqual(['COLLISION']);
    const v = r.violations[0]!;
    expect(v.severity).toBe('critical');
    expect(v.context).toBe('ברכב אחר');
    expect(v.details).toMatchObject({ with: 'vehicle', impulse: 800 });
  });

  it('passing a stopped car with 0.5 m clearance → NEAR_MISS once', () => {
    const r = runScenario(world, g, ['r01_11:f0'], {
      startS: 5,
      endS: 90,
      profile: [{ atS: 0, speedKmh: 30 }],
      setup: (ctx) => ctx.traffic.push({ id: 'parked', kind: 'car', pos: [-70, 3.95], heading: 0, speed: 0, length: 4.4, width: 1.8, laneId: 'r01_11:f1' }),
    });
    expect(r.nonInfo).toEqual(['NEAR_MISS']);
    expect(r.violations[0]!.details).toMatchObject({ agent: 'parked' });
    const flagged = runScenario(world, g, ['r01_11:f0'], {
      startS: 5,
      endS: 40,
      profile: [{ atS: 0, speedKmh: 30 }],
      setup: (ctx) => ctx.traffic.push({ id: 'x', kind: 'car', pos: [-30, 20], heading: 0, speed: 5, length: 4.4, width: 1.8, nearMissWithPlayer: true } as never),
    });
    expect(flagged.nonInfo).toEqual(['NEAR_MISS']);
  });
});
