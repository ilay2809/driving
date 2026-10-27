import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { ScriptedAgent, ScriptedDrive, runScenario, timeToFirstStop, type ScenarioOptions } from '../scripted';
import { commitDistance } from './yielding';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const CAR = 4.4;
const kmh = (v: number) => v / 3.6;

describe('YieldingDetector — roundabout', () => {
  const path = ['r21_rbw:f0', 'rb_w:r21_rbw:f0>rb1:f0', 'rb1:f0', 'rb_s:rb1:f0>rbs_out:f0', 'rbs_out:f0'];
  const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 30 }] });
  const lineS = probe.sOf('r21_rbw:f0', g.lane('r21_rbw:f0').length);
  const startS = lineS - 60;
  const opts: ScenarioOptions = { startS, endS: lineS + 25, profile: [{ atS: 0, speedKmh: 30 }], events: [{ atS: lineS + 8, indicator: 'right' }] };
  const ringPath = ['rb2:f0', 'rb_e:rb2:f0>rb3:f0', 'rb3:f0', 'rb_n:rb3:f0>rb4:f0', 'rb4:f0', 'rb_w:rb4:f0>rb1:f0', 'rb1:f0', 'rb_s:rb1:f0>rb2:f0'];

  /** A car circulating at 20 km/h that is `ttc` seconds from rb_w when the player's bumper reaches the line. */
  function ringCar(ttc: number): ScriptedAgent {
    const agent = new ScriptedAgent(g, ringPath, { id: 'ring', speedKmh: 20 });
    const tEntry = (lineS - CAR / 2 - startS) / kmh(30);
    const sRb4 = agent.segments.find((s) => s.id === 'rb4:f0')!.start;
    const target = sRb4 + g.lane('rb4:f0').length - ttc * kmh(20);
    agent.moveTo(target - kmh(20) * tEntry);
    return agent;
  }

  it('entering while a car in the ring is 2 s away → ROUNDABOUT_NO_YIELD', () => {
    const r = runScenario(world, g, path, { ...opts, run: { agents: [ringCar(2)] } });
    expect(r.nonInfo).toEqual(['ROUNDABOUT_NO_YIELD']);
    const v = r.violations.find((x) => x.type === 'ROUNDABOUT_NO_YIELD')!;
    expect(v.context).toBe('בכיכר האילנות');
    expect(v.details).toMatchObject({ agent: 'ring' });
    expect(v.details!.ttc as number).toBeLessThan(3);
    expect(r.types).toContain('APPROACHING_ROUNDABOUT');
  });

  it('entering an empty roundabout, or one with a car still 6 s away → nothing', () => {
    expect(runScenario(world, g, path, opts).nonInfo).toEqual([]);
    expect(runScenario(world, g, path, { ...opts, run: { agents: [ringCar(6)] } }).nonInfo).toEqual([]);
  });

  it('an agent already on the priority connector counts as a conflict', () => {
    const r = runScenario(world, g, path, {
      ...opts,
      endS: lineS + 0.5, // the verdict falls at the line; stop the script before the player would drive into the standing car
      setup: (ctx) => ctx.traffic.push({ id: 'inside', kind: 'car', pos: [296.72, -0.22], heading: Math.PI / 2, speed: 1, length: 4.4, width: 1.8, connectorId: 'rb_w:rb4:f0>rb1:f0', s: 4 }),
    });
    expect(r.nonInfo).toEqual(['ROUNDABOUT_NO_YIELD']);
    expect(r.violations.find((x) => x.type === 'ROUNDABOUT_NO_YIELD')!.details).toMatchObject({ ttc: 0 });
  });
});

describe('YieldingDetector — give way at n01', () => {
  // southbound on רחוב התמר, straight through n01 (give way) into r01_02
  const path = ['r00_01:f0', 'n01:r00_01:f0>r01_02:f0', 'r01_02:f0'];
  const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 30 }] });
  const lineS = probe.sOf('r00_01:f0', g.lane('r00_01:f0').length);
  const startS = lineS - 60;
  // the main-road car turning left into the same street (priority): r01_11:b0 → n01 → r01_02:f0
  const prioPath = ['r01_11:b0', 'n01:r01_11:b0>r01_02:f0', 'r01_02:f0'];

  it('crossing the line while the priority car is 2 s away → FAILED_TO_YIELD', () => {
    const tEntry = (lineS - CAR / 2 - startS) / kmh(30) + 0.2;
    const agent = new ScriptedAgent(g, prioPath, { id: 'prio', speedKmh: 25 });
    agent.moveTo(g.lane('r01_11:b0').length - 2 * kmh(25) - kmh(25) * tEntry);
    const r = runScenario(world, g, path, { startS, endS: lineS + 25, profile: [{ atS: 0, speedKmh: 30 }], run: { agents: [agent] } });
    expect(r.nonInfo).toEqual(['FAILED_TO_YIELD']);
    expect(r.violations.find((x) => x.type === 'FAILED_TO_YIELD')!.context).toBe('בצומת 01');
  });

  it('waiting at the line until the priority car has passed → GOOD_YIELD', () => {
    const stopS = lineS - 1 - CAR / 2;
    const opts: ScenarioOptions = {
      startS,
      endS: lineS + 25,
      profile: [
        { atS: 0, speedKmh: 30 },
        { atS: lineS - 35, speedKmh: 30 },
        { atS: stopS, speedKmh: 0, hold: 6 },
        { atS: lineS + 15, speedKmh: 25 },
      ],
    };
    const tStop = timeToFirstStop(g, path, opts);
    const agent = new ScriptedAgent(g, prioPath, { id: 'prio', speedKmh: 25 });
    // reaches its own stop line 2 s after the player stopped, clears the junction well before the player goes
    agent.moveTo(g.lane('r01_11:b0').length - kmh(25) * (tStop + 2));
    const r = runScenario(world, g, path, { ...opts, run: { agents: [agent] } });
    expect(r.nonInfo).toEqual([]);
    expect(r.types).toContain('GOOD_YIELD');
  });

  it('an agent disturbed by the player anywhere within 25 m → FAILED_TO_YIELD once', () => {
    const r = runScenario(world, g, ['r01_11:f0'], {
      startS: 5,
      endS: 60,
      profile: [{ atS: 0, speedKmh: 40 }],
      run: {
        onTick: (ctx) => {
          const a = ctx.traffic[0]!;
          a.pos = [ctx.player.pos[0] - 8, 4.95];
          a.disturbedByPlayer = ctx.time > 1;
        },
      },
      setup: (ctx) => ctx.traffic.push({ id: 'behind', kind: 'car', pos: [-110, 4.95], heading: 0, speed: 11, length: 4.4, width: 1.8, laneId: 'r01_11:f1' }),
    });
    expect(r.nonInfo).toEqual(['FAILED_TO_YIELD']);
    expect(r.violations.find((x) => x.type === 'FAILED_TO_YIELD')!.details).toMatchObject({ agent: 'behind', disturbed: true });
  });
});

describe('YieldingDetector — left turn across oncoming traffic at n11 (green)', () => {
  const path = ['r01_11:f0', 'n11:r01_11:f0>r10_11:b0', 'r10_11:b0'];
  const conn = g.connector('n11:r01_11:f0>r10_11:b0');
  const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 25 }] });
  const lineS = probe.sOf('r01_11:f0', g.lane('r01_11:f0').length);
  const startS = lineS - 50;
  const oncomingPath = ['r11_21:b0', 'n11:r11_21:b0>r01_11:b0', 'r01_11:b0'];
  const base: ScenarioOptions = { startS, endS: probe.sOf('r10_11:b0', 30), profile: [{ atS: 0, speedKmh: 25 }], events: [{ atS: lineS - 40, indicator: 'left' }, { atS: probe.sOf('r10_11:b0', 5), indicator: 'off' }] };

  it('the conflict point of the left turn lies where it crosses the oncoming straight path', () => {
    const d = commitDistance(g, conn);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(conn.length);
    expect(commitDistance(g, g.connector('rb_w:r21_rbw:f0>rb1:f0'))).toBeLessThan(6.1);
  });

  it('turning in front of an oncoming car 2 s away → LEFT_TURN_NO_YIELD', () => {
    const sEval = probe.sOf('n11:r01_11:f0>r10_11:b0', commitDistance(g, conn) - 0.5 - CAR / 2);
    const tEval = (sEval - startS) / kmh(25) + 0.3;
    const agent = new ScriptedAgent(g, oncomingPath, { id: 'oncoming', speedKmh: 40 });
    agent.moveTo(g.lane('r11_21:b0').length - 2 * kmh(40) - kmh(40) * tEval);
    const r = runScenario(world, g, path, { ...base, run: { agents: [agent] } });
    expect(r.nonInfo).toEqual(['LEFT_TURN_NO_YIELD']);
    expect(r.violations.find((x) => x.type === 'LEFT_TURN_NO_YIELD')!.details).toMatchObject({ agent: 'oncoming', turn: 'left' });
  });

  it('waiting inside the junction until the oncoming car has passed → nothing', () => {
    const waitS = probe.sOf('n11:r01_11:f0>r10_11:b0', 2);
    const opts: ScenarioOptions = {
      ...base,
      profile: [
        { atS: 0, speedKmh: 25 },
        { atS: lineS - 20, speedKmh: 25 },
        { atS: waitS, speedKmh: 0, hold: 2.5 },
        { atS: waitS + 10, speedKmh: 20 },
      ],
    };
    const tStop = timeToFirstStop(g, path, opts);
    const agent = new ScriptedAgent(g, oncomingPath, { id: 'oncoming', speedKmh: 40 });
    agent.moveTo(g.lane('r11_21:b0').length - kmh(40) * (tStop + 0.5));
    const r = runScenario(world, g, path, { ...opts, run: { agents: [agent] } });
    expect(r.nonInfo).toEqual([]);
  });

  it('an oncoming movement that is on red is not a conflict', () => {
    const sEval = probe.sOf('n11:r01_11:f0>r10_11:b0', commitDistance(g, conn) - 0.5 - CAR / 2);
    const tEval = (sEval - startS) / kmh(25) + 0.3;
    const agent = new ScriptedAgent(g, oncomingPath, { id: 'oncoming', speedKmh: 40 });
    agent.moveTo(g.lane('r11_21:b0').length - 2 * kmh(40) - kmh(40) * tEval);
    const r = runScenario(world, g, path, { ...base, run: { agents: [agent] }, setup: (ctx) => ctx.signals.set('sig_n11:r11_21:from', 'red') });
    expect(r.nonInfo).toEqual([]);
  });
});
