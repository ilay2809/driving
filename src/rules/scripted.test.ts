import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/events';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { Judge } from './judge';
import { ScriptedAgent, ScriptedDrive, makeTestContext, runDrive, runScenario, timeToFirstStop } from './scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);

describe('ScriptedDrive', () => {
  it('concatenates lanes and connectors and maps local arc lengths', () => {
    const d = new ScriptedDrive(g, ['r11_12:f0', 'n12:r11_12:f0>r12_22:f0', 'r12_22:f0'], { profile: [{ atS: 0, speedKmh: 36 }] });
    expect(d.length).toBeCloseTo(99.4 + 11.27 + 112, 0);
    expect(d.sOf('n12:r11_12:f0>r12_22:f0', 0)).toBeCloseTo(99.4, 1);
    expect(d.segmentAt(5)).toEqual({ id: 'r11_12:f0', s: 5 });
    expect(d.segmentAt(105)?.id).toBe('n12:r11_12:f0>r12_22:f0');
    expect(d.state.pos[0]).toBeCloseTo(-1.5);
    expect(d.state.heading).toBeCloseTo(Math.PI / 2);
    expect(d.state.speed).toBeCloseTo(10);
    expect(d.state.gear).toBe('D');
    expect(d.state.seatbelt).toBe(true);
  });

  it('follows the speed profile, holds at stop points and fires events once', () => {
    const bus = new EventBus();
    const glances: string[] = [];
    bus.on('input:glance', (e) => glances.push(e.target));
    const d = new ScriptedDrive(g, ['r01_11:f0'], {
      profile: [
        { atS: 0, speedKmh: 36 },
        { atS: 20, speedKmh: 36 },
        { atS: 30, speedKmh: 0, hold: 1 },
        { atS: 40, speedKmh: 36 },
      ],
      events: [
        { atS: 10, indicator: 'right' },
        { atTime: 0.5, glance: 'right_mirror' },
      ],
    });
    let t = 0;
    while (d.S < 20) {
      d.step(0.1, bus);
      t += 0.1;
    }
    expect(t).toBeCloseTo(2, 1); // 20 m at 10 m/s
    expect(d.state.speed).toBeCloseTo(10, 1);
    while (d.S < 25) d.step(0.1, bus);
    expect(d.state.speed).toBeCloseTo(5, 0); // half way through the linear deceleration
    expect(d.state.indicator).toBe('right');
    expect(glances).toEqual(['right_mirror']);
    while (d.state.speed > 0) d.step(0.1, bus);
    expect(d.S).toBeCloseTo(30, 5);
    const tStop = d.time;
    while (d.state.speed === 0) d.step(0.1, bus);
    expect(d.time - tStop).toBeCloseTo(1, 1);
    while (!d.done) d.step(0.1, bus);
    expect(d.S).toBeCloseTo(d.length);
    expect(glances).toEqual(['right_mirror']);
    expect(timeToFirstStop(g, ['r01_11:f0'], { profile: [{ atS: 0, speedKmh: 36 }, { atS: 20, speedKmh: 36 }, { atS: 30, speedKmh: 0, hold: 1 }] })).toBeCloseTo(tStop, 0);
  });

  it('applies lateral offsets, ramps and heading offsets', () => {
    const d = new ScriptedDrive(g, ['r01_11:f0'], { profile: [{ atS: 0, speedKmh: 36 }], lateral: 1, events: [{ atS: 10, lateral: 3, over: 10 }, { atS: 25, headingDeg: 10 }] });
    expect(d.state.pos[1]).toBeCloseTo(1.65 + 1);
    while (d.S < 15) d.step(0.05);
    expect(d.state.pos[1]).toBeGreaterThan(1.65 + 1.5);
    expect(d.state.pos[1]).toBeLessThan(1.65 + 3);
    while (d.S < 26) d.step(0.05);
    expect(d.state.pos[1]).toBeCloseTo(1.65 + 3, 1);
    expect(d.state.heading).toBeCloseTo((10 * Math.PI) / 180, 3);
  });
});

describe('ScriptedAgent', () => {
  it('places the agent on lanes and connectors with s', () => {
    const a = new ScriptedAgent(g, ['rb4:f0', 'rb_w:rb4:f0>rb1:f0', 'rb1:f0'], { id: 'x', speedKmh: 18, startS: 2 });
    expect(a.state.laneId).toBe('rb4:f0');
    expect(a.state.connectorId).toBeUndefined();
    expect(a.state.s).toBeCloseTo(2);
    expect(a.state.speed).toBeCloseTo(5);
    a.moveTo(13.43 + 3);
    expect(a.state.connectorId).toBe('rb_w:rb4:f0>rb1:f0');
    expect(a.state.laneId).toBeUndefined();
    expect(a.state.s).toBeCloseTo(3, 1);
    a.step(10);
    expect(a.state.laneId).toBe('rb1:f0');
    a.step(100);
    expect(a.state.speed).toBe(0); // stopped at the end of the path
  });
});

describe('makeTestContext / runDrive', () => {
  it('builds a context with a settable signal stub and runs the judge', () => {
    const ctx = makeTestContext(world, g, { player: { seatbelt: false }, coachPresent: false });
    expect(ctx.player.seatbelt).toBe(false);
    expect(ctx.coachPresent).toBe(false);
    expect(ctx.signals.stateOf('sig_n11:r01_11:to')).toBe('green');
    ctx.signals.set('sig_n11:r01_11:to', 'red');
    expect(ctx.signals.stateForConnector('n11:r01_11:f0>r11_21:f0')).toBe('red');
    expect(ctx.signals.stateForCrossing('c_main_w')).toBe('green');
    ctx.signals.override('sig_n11:r01_11:to', 'amber');
    expect(ctx.signals.stateOf('sig_n11:r01_11:to')).toBe('amber');
    ctx.signals.override('sig_n11:r01_11:to', undefined);
    expect(ctx.signals.stateOf('sig_n11:r01_11:to')).toBe('red');
    ctx.signals.setAll('off');
    expect(ctx.signals.stateOf('sig_n11:r01_11:to')).toBe('off');

    const judge = new Judge(g, ctx.bus);
    const drive = new ScriptedDrive(g, ['r01_11:f0'], { startS: 5, endS: 60, profile: [{ atS: 0, speedKmh: 40 }] });
    const vs = runDrive(ctx, drive, judge);
    expect(drive.done).toBe(true);
    expect(ctx.time).toBeGreaterThan(4);
    expect(ctx.localisation.laneId).toBe('r01_11:f0');
    expect(vs.map((v) => v.type)).toEqual(['SEATBELT']);
    expect(judge.history).toEqual(vs);
  });

  it('runScenario wires everything and filters informational violations', () => {
    const r = runScenario(world, g, ['r01_11:f0'], { startS: 5, endS: 60, profile: [{ atS: 0, speedKmh: 40 }] });
    expect(r.types).toEqual(['APPROACHING_SIGNALS']);
    expect(r.nonInfo).toEqual([]);
  });
});
