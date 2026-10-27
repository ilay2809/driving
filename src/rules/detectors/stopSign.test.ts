import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { ScriptedDrive, runScenario, type ScenarioOptions } from '../scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const CAR = 4.4;
// southbound on רחוב הדקל towards the stop sign at n12, then left into the one-way street
const path = ['r11_12:f0', 'n12:r11_12:f0>r12_22:f0', 'r12_22:f0'];
const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 30 }] });
const lineS = probe.sOf('r11_12:f0', g.lane('r11_12:f0').length);
const base: ScenarioOptions = {
  startS: lineS - 80,
  endS: lineS + 40,
  profile: [{ atS: 0, speedKmh: 30 }],
  events: [{ atS: lineS - 40, indicator: 'left' }],
};

describe('StopSignDetector', () => {
  it('rolling through the stop sign at n12 → STOP_SIGN_ROLLING', () => {
    const r = runScenario(world, g, path, {
      ...base,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 25, speedKmh: 30 },
        { atS: lineS - CAR / 2, speedKmh: 3.6 },
        { atS: lineS + 20, speedKmh: 25 },
      ],
    });
    expect(r.nonInfo).toEqual(['STOP_SIGN_ROLLING']);
    const v = r.violations.find((x) => x.type === 'STOP_SIGN_ROLLING')!;
    expect(v.context).toBe('בצומת 12');
    expect(v.severity).toBe('major');
  });

  it('a full stop before the line → GOOD_STOP and nothing else', () => {
    const r = runScenario(world, g, path, {
      ...base,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 25, speedKmh: 30 },
        { atS: lineS - 1 - CAR / 2, speedKmh: 0, hold: 1.5 },
        { atS: lineS + 20, speedKmh: 25 },
      ],
    });
    expect(r.nonInfo).toEqual([]);
    expect(r.types).toContain('GOOD_STOP');
    expect(r.types).toContain('APPROACHING_STOP_SIGN');
    expect(r.types).toContain('SPEED_LIMIT_CHANGED');
    expect(r.types.filter((t) => t === 'GOOD_STOP').length).toBe(1);
  });

  it('not slowing down at all → STOP_SIGN_NO_STOP (critical)', () => {
    const r = runScenario(world, g, path, { ...base, profile: [{ atS: 0, speedKmh: 25 }] });
    expect(r.nonInfo).toEqual(['STOP_SIGN_NO_STOP']);
    expect(r.violations.find((x) => x.type === 'STOP_SIGN_NO_STOP')!.severity).toBe('critical');
  });

  it('stopping with the bumper 1.8 m past the line → STOP_LINE_OVERRUN instead of a rolling stop', () => {
    const r = runScenario(world, g, path, {
      ...base,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 25, speedKmh: 30 },
        { atS: lineS + 1.8 - CAR / 2, speedKmh: 0, hold: 1.5 },
        { atS: lineS + 25, speedKmh: 25 },
      ],
    });
    expect(r.nonInfo).toEqual(['STOP_LINE_OVERRUN']);
    expect(r.violations.find((x) => x.type === 'STOP_LINE_OVERRUN')!.details).toMatchObject({ past: 1.8 });
  });

  it('stopping with the bumper within 1 m past the line still counts as a stop', () => {
    const r = runScenario(world, g, path, {
      ...base,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 25, speedKmh: 30 },
        { atS: lineS + 0.6 - CAR / 2, speedKmh: 0, hold: 1.5 },
        { atS: lineS + 25, speedKmh: 25 },
      ],
    });
    expect(r.nonInfo).toEqual([]);
    expect(r.types).toContain('GOOD_STOP');
  });

  it('sends APPROACHING_STOP_SIGN at 60 m only when a coach is present', () => {
    const withCoach = runScenario(world, g, path, { ...base, profile: [{ atS: 0, speedKmh: 25 }] });
    const info = withCoach.violations.find((x) => x.type === 'APPROACHING_STOP_SIGN')!;
    expect(info.details).toMatchObject({ distance: 60 });
    const alone = runScenario(world, g, path, { ...base, profile: [{ atS: 0, speedKmh: 25 }], judge: { coachPresent: false } });
    expect(alone.types).not.toContain('APPROACHING_STOP_SIGN');
  });

  it('standing on the crossing past a give-way line → STOP_LINE_OVERRUN', () => {
    const gwPath = ['r00_01:f0', 'n01:r00_01:f0>r01_02:f0', 'r01_02:f0'];
    const p = new ScriptedDrive(g, gwPath, { profile: [{ atS: 0, speedKmh: 30 }] });
    const line = p.sOf('r00_01:f0', g.lane('r00_01:f0').length);
    const r = runScenario(world, g, gwPath, {
      startS: line - 60,
      endS: line + 30,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: line - 35, speedKmh: 30 },
        { atS: line + 2 - CAR / 2, speedKmh: 0, hold: 2 },
        { atS: line + 20, speedKmh: 25 },
      ],
    });
    expect(r.nonInfo).toEqual(['STOP_LINE_OVERRUN']);
  });
});
