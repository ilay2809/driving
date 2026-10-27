import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { ScriptedDrive, runScenario, type ScenarioOptions } from '../scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const CAR = 4.4;

describe('InstructionsDetector', () => {
  const path = ['r00_01:f0', 'n01:r00_01:f0>r01_11:f0', 'r01_11:f0'];
  const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 25 }] });
  const lineS = probe.sOf('r00_01:f0', g.lane('r00_01:f0').length);
  const base: ScenarioOptions = {
    startS: lineS - 50,
    endS: probe.sOf('r01_11:f0', 30),
    profile: [{ atS: 0, speedKmh: 25 }],
    events: [{ atS: lineS - 40, indicator: 'left' }, { atS: probe.sOf('r01_11:f0', 5), indicator: 'off' }],
  };

  it('turning left when told to turn right → WRONG_TURN, and the expectation is consumed', () => {
    const r = runScenario(world, g, path, { ...base, setup: (_ctx, judge) => judge.setExpectedTurn('n01', 'right') });
    expect(r.nonInfo).toEqual(['WRONG_TURN']);
    const v = r.violations[0]!;
    expect(v.details).toMatchObject({ expected: 'right', actual: 'left', expectedHe: 'ימינה', actualHe: 'שמאלה' });
    expect(v.context).toBe('בצומת 01');
    expect(r.judge.instructions.expectations.turn).toBeUndefined();
  });

  it('the instructed movement or "any" → nothing', () => {
    expect(runScenario(world, g, path, { ...base, setup: (_c, j) => j.setExpectedTurn('n01', 'left') }).nonInfo).toEqual([]);
    expect(runScenario(world, g, path, { ...base, setup: (_c, j) => j.setExpectedTurn('n01', 'any') }).nonInfo).toEqual([]);
    expect(runScenario(world, g, path, { ...base, setup: (_c, j) => j.setExpectedTurn('n11', 'right') }).nonInfo).toEqual([]); // another junction
  });

  it('driving 30 m past an expected stop point → MISSED_INSTRUCTION', () => {
    const r = runScenario(world, g, ['r01_11:f0'], { startS: 5, endS: 95, profile: [{ atS: 0, speedKmh: 30 }], setup: (_c, j) => j.setExpectedStop([-60, 1.65], 8) });
    expect(r.nonInfo).toEqual(['MISSED_INSTRUCTION']);
    const v = r.violations.find((x) => x.type === 'MISSED_INSTRUCTION')!;
    expect(v.details).toMatchObject({ kind: 'stop' });
    expect(v.pos[0]).toBeGreaterThan(-60 + 30);
  });

  it('stopping within the radius satisfies the instruction', () => {
    const stopS = 52.4 - CAR / 2; // lane s of x = -60 minus half a car
    const r = runScenario(world, g, ['r01_11:f0'], {
      startS: 5,
      endS: 95,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: stopS - 20, speedKmh: 30 },
        { atS: stopS, speedKmh: 0, hold: 2 },
        { atS: stopS + 30, speedKmh: 30 },
      ],
      events: [{ atS: stopS - 25, indicator: 'right' }, { atS: stopS + 5, indicator: 'off' }],
      setup: (_c, j) => j.setExpectedStop([-60, 1.65], 8),
    });
    expect(r.nonInfo).toEqual([]);
    expect(r.judge.instructions.expectations.stop).toBeUndefined();
  });
});
