import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { ScriptedDrive, runScenario, type ScenarioOptions } from '../scripted';
import { stoppingDistance } from './signals';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const CAR = 4.4;
const path = ['r01_11:f0', 'n11:r01_11:f0>r11_21:f0', 'r11_21:f0'];
const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 50 }] });
const lineS = probe.sOf('r01_11:f0', g.lane('r01_11:f0').length);
const group = 'sig_n11:r01_11:to';
const at50: ScenarioOptions = { startS: lineS - 90, endS: lineS + 40, profile: [{ atS: 0, speedKmh: 50 }] };

describe('SignalsDetector', () => {
  it('models the stopping distance d = v·1 + v²/(2·3.5)', () => {
    expect(stoppingDistance(10)).toBeCloseTo(10 + 100 / 7);
  });

  it('reports RED_LIGHT when the front bumper crosses the line at red', () => {
    const r = runScenario(world, g, path, { ...at50, setup: (ctx) => ctx.signals.set(group, 'red') });
    expect(r.nonInfo).toEqual(['RED_LIGHT']);
    const v = r.violations.find((x) => x.type === 'RED_LIGHT')!;
    expect(v.context).toBe('בצומת 11');
    expect(v.details).toMatchObject({ speed: 50, state: 'red' });
    // crossed at t ≈ (90 − 2.2) / 13.9
    expect(v.time).toBeCloseTo((90 - CAR / 2) / (50 / 3.6), 0);
  });

  it('reports nothing at green and sends the approaching hint once', () => {
    const r = runScenario(world, g, path, { ...at50, setup: (ctx) => ctx.signals.set(group, 'green') });
    expect(r.nonInfo).toEqual([]);
    expect(r.types.filter((t) => t === 'APPROACHING_SIGNALS').length).toBe(1);
    expect(r.violations[0]!.details).toMatchObject({ state: 'green' });
  });

  it('reports AMBER_RUN when amber started far enough to stop, nothing when it started too late', () => {
    const early = runScenario(world, g, path, { ...at50, run: { onTick: (ctx, d) => ctx.signals.set(group, d.S >= lineS - 60 - CAR / 2 ? 'amber' : 'green') } });
    expect(early.nonInfo).toEqual(['AMBER_RUN']);
    const late = runScenario(world, g, path, { ...at50, run: { onTick: (ctx, d) => ctx.signals.set(group, d.S >= lineS - 15 - CAR / 2 ? 'amber' : 'green') } });
    expect(late.nonInfo).toEqual([]);
    const flashing = runScenario(world, g, path, { ...at50, setup: (ctx) => ctx.signals.set(group, 'flashing_green') });
    expect(flashing.nonInfo).toEqual([]);
  });

  it('reports RED_AMBER_START when crossing the line during red+amber', () => {
    const r = runScenario(world, g, path, { ...at50, profile: [{ atS: 0, speedKmh: 30 }], setup: (ctx) => ctx.signals.set(group, 'red_amber') });
    expect(r.nonInfo).toEqual(['RED_AMBER_START']);
  });

  it('reports RED_AMBER_START when moving off from a stop during red+amber, not at green', () => {
    const stopS = lineS - 2 - CAR / 2;
    const base: ScenarioOptions = {
      startS: lineS - 60,
      endS: lineS + 40,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 35, speedKmh: 30 },
        { atS: stopS, speedKmh: 0, hold: 3 },
        { atS: lineS + 15, speedKmh: 30 },
      ],
    };
    const jumped = runScenario(world, g, path, { ...base, run: { onTick: (ctx) => ctx.signals.set(group, ctx.time < 4 ? 'red' : 'red_amber') } });
    expect(jumped.nonInfo).toEqual(['RED_AMBER_START']);
    const patient = runScenario(world, g, path, { ...base, run: { onTick: (ctx, d) => ctx.signals.set(group, d.state.speed === 0 && d.time < 100 ? 'red' : 'green') } });
    // the light turns green exactly when the car moves off (lenient stub) → no violation
    expect(patient.nonInfo).toEqual([]);
  });

  it('reports GREEN_NOT_MOVING after 4 s at green with a free road, but not behind a queue', () => {
    const stopS = lineS - 2 - CAR / 2;
    const base: ScenarioOptions = {
      startS: lineS - 60,
      endS: lineS + 40,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 35, speedKmh: 30 },
        { atS: stopS, speedKmh: 0, hold: 6 },
        { atS: lineS + 15, speedKmh: 30 },
      ],
      setup: (ctx) => ctx.signals.set(group, 'green'),
    };
    const r = runScenario(world, g, path, base);
    expect(r.nonInfo).toEqual(['GREEN_NOT_MOVING']);
    const queue = runScenario(world, g, path, {
      ...base,
      endS: stopS, // stay behind the queue instead of driving through it afterwards
      run: { tailSeconds: 7 },
      setup: (ctx) => {
        ctx.signals.set(group, 'green');
        // a car waiting in the junction mouth, 2.8 m ahead of the player's stop position
        ctx.traffic.push({ id: 'front', kind: 'car', pos: [-9.1, 1.65], heading: 0, speed: 0, length: 4.4, width: 1.8, connectorId: 'n11:r01_11:f0>r11_21:f0', s: 3 });
      },
    });
    expect(queue.nonInfo).toEqual([]);
  });

  it('judges a slow creep over the line at red as STOP_LINE_OVERRUN, and continuing as RED_LIGHT', () => {
    const past = lineS + 1.8 - CAR / 2;
    const overrun = runScenario(world, g, path, {
      startS: lineS - 60,
      endS: past,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 35, speedKmh: 30 },
        { atS: past, speedKmh: 0, hold: 3 },
      ],
      run: { tailSeconds: 3 },
      setup: (ctx) => ctx.signals.set(group, 'red'),
    });
    expect(overrun.nonInfo).toEqual(['STOP_LINE_OVERRUN']);
    expect(overrun.violations.find((x) => x.type === 'STOP_LINE_OVERRUN')!.details).toMatchObject({ past: 1.8 });
    const creep = runScenario(world, g, path, {
      startS: lineS - 60,
      endS: lineS + 30,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 35, speedKmh: 30 },
        { atS: lineS - CAR / 2, speedKmh: 4 },
        { atS: lineS + 10, speedKmh: 4 },
        { atS: lineS + 30, speedKmh: 20 },
      ],
      setup: (ctx) => ctx.signals.set(group, 'red'),
    });
    expect(creep.nonInfo).toEqual(['RED_LIGHT']);
  });
});
