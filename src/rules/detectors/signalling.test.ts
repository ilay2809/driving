import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { ScriptedDrive, runScenario, timeToFirstStop, type ScenarioOptions } from '../scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const CAR = 4.4;

describe('SignallingDetector — turns', () => {
  // southbound on רחוב התמר, LEFT into the main road at n01 (south → east)
  const path = ['r00_01:f0', 'n01:r00_01:f0>r01_11:f0', 'r01_11:f0'];
  const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 30 }] });
  const lineS = probe.sOf('r00_01:f0', g.lane('r00_01:f0').length);
  const base: ScenarioOptions = {
    startS: lineS - 80,
    endS: lineS + 50,
    profile: [
      { atS: 0, speedKmh: 30 },
      { atS: lineS - 30, speedKmh: 30 },
      { atS: lineS, speedKmh: 20 },
      { atS: lineS + 20, speedKmh: 30 },
    ],
  };

  it('turning without an indicator → NO_INDICATOR_TURN', () => {
    const r = runScenario(world, g, path, base);
    expect(r.nonInfo).toEqual(['NO_INDICATOR_TURN']);
    const v = r.violations.find((x) => x.type === 'NO_INDICATOR_TURN')!;
    expect(v.details).toMatchObject({ turn: 'left', side: 'left' });
    expect(v.context).toBe('בצומת 01');
  });

  it('indicating 25 m before the line → nothing; 5 m before → INDICATOR_LATE', () => {
    const early = runScenario(world, g, path, { ...base, events: [{ atS: lineS - 25 - CAR / 2, indicator: 'left' }, { atS: lineS + 25, indicator: 'off' }] });
    expect(early.nonInfo).toEqual([]);
    const late = runScenario(world, g, path, { ...base, events: [{ atS: lineS - 5 - CAR / 2, indicator: 'left' }, { atS: lineS + 25, indicator: 'off' }] });
    expect(late.nonInfo).toEqual(['INDICATOR_LATE']);
    const wrongSide = runScenario(world, g, path, { ...base, events: [{ atS: lineS - 25 - CAR / 2, indicator: 'right' }, { atS: lineS + 25, indicator: 'off' }] });
    expect(wrongSide.nonInfo).toEqual(['NO_INDICATOR_TURN']);
  });

  it('a right turn needs the right indicator', () => {
    const rp = ['r01_02:b0', 'n01:r01_02:b0>r01_11:f1', 'r01_11:f1'];
    const p = new ScriptedDrive(g, rp, { profile: [{ atS: 0, speedKmh: 30 }] });
    const line = p.sOf('r01_02:b0', g.lane('r01_02:b0').length);
    const opts: ScenarioOptions = { startS: line - 60, endS: line + 40, profile: [{ atS: 0, speedKmh: 30 }, { atS: line - 20, speedKmh: 30 }, { atS: line, speedKmh: 20 }, { atS: line + 15, speedKmh: 30 }] };
    expect(runScenario(world, g, rp, opts).nonInfo).toEqual(['NO_INDICATOR_TURN']);
    expect(runScenario(world, g, rp, { ...opts, events: [{ atS: line - 30, indicator: 'right' }, { atS: line + 20, indicator: 'off' }] }).nonInfo).toEqual([]);
  });

  it('leaving the indicator on for 10 s after the turn → INDICATOR_LEFT_ON', () => {
    const lp = ['r20_21:f0', 'n21:r20_21:f0>r21_rbw:f0', 'r21_rbw:f0'];
    const p = new ScriptedDrive(g, lp, { profile: [{ atS: 0, speedKmh: 30 }] });
    const line = p.sOf('r20_21:f0', g.lane('r20_21:f0').length);
    const opts: ScenarioOptions = {
      startS: line - 60,
      endS: p.sOf('r21_rbw:f0', 110),
      profile: [{ atS: 0, speedKmh: 30 }, { atS: line - 20, speedKmh: 30 }, { atS: line, speedKmh: 20 }, { atS: line + 15, speedKmh: 30 }],
      events: [{ atS: line - 30, indicator: 'left' }],
    };
    const r = runScenario(world, g, lp, opts);
    expect(r.nonInfo).toEqual(['INDICATOR_LEFT_ON']);
    const cancelled = runScenario(world, g, lp, { ...opts, events: [...opts.events!, { atS: line + 20, indicator: 'off' }] });
    expect(cancelled.nonInfo).toEqual([]);
  });

  it('roundabouts: no indicator needed to enter, the right indicator is needed to exit', () => {
    const rp = ['r21_rbw:f0', 'rb_w:r21_rbw:f0>rb1:f0', 'rb1:f0', 'rb_s:rb1:f0>rbs_out:f0', 'rbs_out:f0'];
    const p = new ScriptedDrive(g, rp, { profile: [{ atS: 0, speedKmh: 25 }] });
    const line = p.sOf('r21_rbw:f0', g.lane('r21_rbw:f0').length);
    const opts: ScenarioOptions = { startS: line - 30, endS: p.sOf('rbs_out:f0', 20), profile: [{ atS: 0, speedKmh: 25 }] };
    const none = runScenario(world, g, rp, opts);
    expect(none.nonInfo).toEqual(['NO_INDICATOR_TURN']);
    const v = none.violations.find((x) => x.type === 'NO_INDICATOR_TURN')!;
    expect(v.details).toMatchObject({ side: 'right' });
    expect(v.context).toBe('בכיכר האילנות');
    const signalled = runScenario(world, g, rp, { ...opts, events: [{ atS: p.sOf('rb1:f0', 0), indicator: 'right' }] });
    expect(signalled.nonInfo).toEqual([]);
  });
});

describe('SignallingDetector — lane changes', () => {
  const path = ['r01_11:f0'];
  const base: ScenarioOptions = { startS: 5, endS: 95, profile: [{ atS: 0, speedKmh: 40 }] };

  it('changing lane without indicator, mirror and shoulder check → three observations', () => {
    const r = runScenario(world, g, path, { ...base, events: [{ atS: 30, lateral: 3.3, over: 15 }] });
    expect(r.nonInfo).toEqual(['NO_INDICATOR_LANE_CHANGE', 'NO_MIRROR_CHECK', 'NO_SHOULDER_CHECK']);
    expect(r.violations.find((x) => x.type === 'NO_MIRROR_CHECK')!.details).toMatchObject({ side: 'right' });
    expect(r.ctx.localisation.laneId).toBe('r01_11:f1');
  });

  it('indicator ≥ 1 s before plus both glances within 5 s → nothing', () => {
    const r = runScenario(world, g, path, {
      ...base,
      events: [
        { atS: 18, indicator: 'right' },
        { atS: 20, glance: 'right_mirror' },
        { atS: 22, glance: 'rear_mirror' },
        { atS: 24, glance: 'right_shoulder' },
        { atS: 30, lateral: 3.3, over: 15 },
        { atS: 60, indicator: 'off' },
      ],
    });
    expect(r.nonInfo).toEqual([]);
  });

  it('an indicator switched on just before the change → INDICATOR_LATE', () => {
    const r = runScenario(world, g, path, {
      ...base,
      events: [
        { atS: 20, glance: 'right_mirror' },
        { atS: 24, glance: 'right_shoulder' },
        { atS: 30, lateral: 3.3, over: 15 },
        { atS: 35, indicator: 'right' },
        { atS: 60, indicator: 'off' },
      ],
    });
    expect(r.nonInfo).toEqual(['INDICATOR_LATE']);
  });

  it('a glance at the other side does not count', () => {
    const r = runScenario(world, g, path, {
      ...base,
      events: [
        { atS: 18, indicator: 'right' },
        { atS: 20, glance: 'left_mirror' },
        { atS: 24, glance: 'left_shoulder' },
        { atS: 30, lateral: 3.3, over: 15 },
        { atS: 60, indicator: 'off' },
      ],
    });
    expect(r.nonInfo).toEqual(['NO_MIRROR_CHECK', 'NO_SHOULDER_CHECK']);
  });
});

describe('SignallingDetector — pulling out from the kerb', () => {
  const path = ['r00_01:f0'];
  const base: ScenarioOptions = {
    startS: 20,
    endS: 70,
    profile: [
      { atS: 20, speedKmh: 0, hold: 4 },
      { atS: 30, speedKmh: 20 },
    ],
  };

  it('moving off after standing at the kerb without checks → indicator, mirror and shoulder observations', () => {
    const r = runScenario(world, g, path, base);
    expect(r.nonInfo).toEqual(['NO_INDICATOR_LANE_CHANGE', 'NO_MIRROR_CHECK', 'NO_SHOULDER_CHECK']);
    const v = r.violations[0]!;
    expect(v.context).toBe('ביציאה מהחניה');
    expect(v.details).toMatchObject({ side: 'left', manoeuvre: 'pull_out' });
    // all three are tagged as a pull-out (not a lane change) so the coach phrases them as "יציאה מחניה"
    for (const x of r.violations.filter((y) => y.severity !== 'info')) {
      expect(x.details).toMatchObject({ side: 'left', maneuver: 'pull_out' });
      expect(x.context).toBe('ביציאה מהחניה');
    }
  });

  it('free drive: the very first move-off of the session (car never moved yet) is not judged', () => {
    for (const mode of ['free', 'training_ground'] as const) {
      const r = runScenario(world, g, path, { ...base, ctx: { mode } });
      expect(r.nonInfo).toEqual([]);
    }
  });

  it('free drive: a later pull-out (after driving, stopping ≥ 3 s at the kerb) is judged as a pull-out', () => {
    const later: ScenarioOptions = {
      startS: 0,
      endS: 80,
      ctx: { mode: 'training_ground' },
      profile: [
        { atS: 0, speedKmh: 20 },
        { atS: 25, speedKmh: 0, hold: 4 },
        { atS: 40, speedKmh: 20 },
      ],
    };
    const r = runScenario(world, g, path, later);
    expect(r.nonInfo).toEqual(['NO_INDICATOR_LANE_CHANGE', 'NO_MIRROR_CHECK', 'NO_SHOULDER_CHECK']);
    for (const x of r.violations.filter((y) => y.severity !== 'info')) expect(x.details).toMatchObject({ side: 'left', maneuver: 'pull_out' });
    const tStop = timeToFirstStop(g, path, later);
    const ok = runScenario(world, g, path, {
      ...later,
      events: [
        { atTime: tStop + 1.0, indicator: 'left' },
        { atTime: tStop + 2.0, glance: 'left_mirror' },
        { atTime: tStop + 2.5, glance: 'left_shoulder' },
        { atS: 55, indicator: 'off' },
      ],
    });
    expect(ok.nonInfo).toEqual([]);
  });

  it('free drive: a move-off within the first 3 s of the session is not judged even after a reset of the odometer', () => {
    // standing 3 s is required to count as parked; a session that is exactly that young is still "the first start"
    const r = runScenario(world, g, path, { ...base, ctx: { mode: 'free' }, profile: [{ atS: 20, speedKmh: 0, hold: 3.05 }, { atS: 30, speedKmh: 20 }] });
    expect(r.nonInfo).toEqual([]);
  });

  it('left indicator, left mirror and left shoulder before moving off → nothing', () => {
    const r = runScenario(world, g, path, {
      ...base,
      events: [
        { atTime: 2.0, indicator: 'left' },
        { atTime: 3.0, glance: 'left_mirror' },
        { atTime: 3.5, glance: 'left_shoulder' },
        { atS: 45, indicator: 'off' },
      ],
    });
    expect(r.nonInfo).toEqual([]);
  });

  it('a short stop in traffic is not a pull-out', () => {
    const r = runScenario(world, g, path, { ...base, profile: [{ atS: 20, speedKmh: 0, hold: 2 }, { atS: 30, speedKmh: 20 }] });
    expect(r.nonInfo).toEqual([]);
  });
});
