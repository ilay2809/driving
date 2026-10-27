import { describe, expect, it } from 'vitest';
import { buildWorld, type BuildNode, type BuildRoad } from '@/world/builder';
import type { Vec2 } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { HE } from '../strings.he';
import { ScriptedAgent, ScriptedDrive, runScenario, timeToFirstStop, type ScenarioOptions } from '../scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const _CAR = 4.4;

describe('LanesDetector — direction and lines', () => {
  it('driving west on the one-way רחוב החצב → WRONG_WAY once per episode', () => {
    const pts = [...g.lane('r02_12:f0').centre].reverse() as Vec2[];
    const r = runScenario(world, g, [pts], { startS: 5, endS: 90, profile: [{ atS: 0, speedKmh: 25 }] });
    expect(r.nonInfo).toEqual(['WRONG_WAY']);
    const v = r.violations[0]!;
    expect(v.context).toBe('ברחוב החצב');
    expect(v.time).toBeGreaterThan(2);
    expect(v.time).toBeLessThan(2.5);
    expect(r.ctx.localisation.wrongWay).toBe(true);
  });

  it('drifting 1 m to the right of a 3 m lane for 1.5 s → LANE_DEPARTURE, not when indicating', () => {
    const r = runScenario(world, g, ['r00_10:f0'], { startS: 5, endS: 60, profile: [{ atS: 0, speedKmh: 30 }], lateral: 1.0 });
    expect(r.nonInfo).toEqual(['LANE_DEPARTURE']);
    expect(r.violations[0]!.details).toMatchObject({ side: 'right' });
    expect(r.violations[0]!.time).toBeGreaterThan(1.5);
    const intended = runScenario(world, g, ['r00_10:f0'], { startS: 5, endS: 60, profile: [{ atS: 0, speedKmh: 30 }], lateral: 1.0, events: [{ atS: 0, indicator: 'right' }] });
    expect(intended.nonInfo).toEqual([]);
  });

  it('crossing the solid centre line of the main road → SOLID_LINE_CROSSED then CENTRE_LINE_CROSSED', () => {
    const r = runScenario(world, g, ['r01_11:f0'], { startS: 5, endS: 80, profile: [{ atS: 0, speedKmh: 30 }], events: [{ atS: 15, lateral: -2.3, over: 10 }] });
    expect(r.nonInfo).toEqual(['SOLID_LINE_CROSSED', 'CENTRE_LINE_CROSSED']);
    expect(r.violations.find((x) => x.type === 'SOLID_LINE_CROSSED')!.details).toMatchObject({ line: 'solid', side: 'left' });
    expect(r.violations.find((x) => x.type === 'CENTRE_LINE_CROSSED')!.severity).toBe('critical');
    // a dashed centre line (residential street) is not a solid-line offence, but the wrong side still is
    const dashed = runScenario(world, g, ['r00_10:f0'], { startS: 5, endS: 80, profile: [{ atS: 0, speedKmh: 30 }], events: [{ atS: 15, lateral: -2.0, over: 10 }] });
    expect(dashed.nonInfo).toEqual(['CENTRE_LINE_CROSSED']);
  });

  it('mounting the sidewalk → KERB_MOUNT; a kerb collision event → KERB_STRIKE above a small impulse', () => {
    const r = runScenario(world, g, ['r00_10:f0'], { startS: 5, endS: 60, profile: [{ atS: 0, speedKmh: 20 }], lateral: 2.5 });
    expect(r.nonInfo).toContain('KERB_MOUNT');
    expect(r.nonInfo.filter((t) => t === 'KERB_MOUNT').length).toBe(1);
    let sent = false;
    const strike = runScenario(world, g, ['r00_10:f0'], {
      startS: 5,
      endS: 40,
      profile: [{ atS: 0, speedKmh: 20 }],
      run: {
        onTick: (ctx) => {
          if (ctx.time > 1 && !sent) {
            sent = true;
            ctx.bus.emit('vehicle:collision', { with: 'kerb', impulse: 4, pos: ctx.player.pos, time: ctx.time });
            ctx.bus.emit('vehicle:collision', { with: 'kerb', impulse: 40, pos: ctx.player.pos, time: ctx.time });
          }
        },
      },
    });
    expect(strike.nonInfo).toEqual(['KERB_STRIKE']);
    expect(strike.violations[0]!.details).toMatchObject({ impulse: 40 });
  });
});

describe('LanesDetector — turning', () => {
  const path = ['r00_01:f0', 'n01:r00_01:f0>r01_11:f0', 'r01_11:f0'];
  const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 20 }] });
  const lineS = probe.sOf('r00_01:f0', g.lane('r00_01:f0').length);
  const connS = probe.sOf('n01:r00_01:f0>r01_11:f0', 0);
  const exitS = probe.sOf('r01_11:f0', 0);
  const base: ScenarioOptions = { startS: lineS - 40, endS: exitS + 30, profile: [{ atS: 0, speedKmh: 20 }], events: [{ atS: lineS - 35, indicator: 'left' }, { atS: exitS + 5, indicator: 'off' }] };

  it('a left turn hugging the inside → CUT_CORNER, swinging wide → WIDE_TURN', () => {
    const cut = runScenario(world, g, path, { ...base, events: [...base.events!, { atS: connS + 0.5, lateral: -2.0 }, { atS: exitS, lateral: 0 }] });
    expect(cut.nonInfo).toEqual(['CUT_CORNER']);
    const wide = runScenario(world, g, path, { ...base, events: [...base.events!, { atS: connS + 0.5, lateral: 2.0 }, { atS: exitS, lateral: 0 }] });
    expect(wide.nonInfo).toEqual(['WIDE_TURN']);
    expect(runScenario(world, g, path, base).nonInfo).toEqual([]);
  });

  it('turning right from the left lane of the main road → WRONG_LANE_FOR_TURN', () => {
    const f0 = g.lane('r01_11:f0');
    const f1 = g.lane('r01_11:f1');
    const end = f0.centre[f0.centre.length - 1]!;
    const endF1 = f1.centre[f1.centre.length - 1]!;
    const wl = [
      [f0.centre[0]!, [end[0] - 14, end[1]]] as Vec2[],
      [[endF1[0] - 8, endF1[1]], endF1] as Vec2[],
      'n11:r01_11:f1>r11_12:f0',
      'r11_12:f0',
    ];
    const p = new ScriptedDrive(g, wl, { profile: [{ atS: 0, speedKmh: 25 }] });
    const r = runScenario(world, g, wl, {
      startS: 40,
      endS: p.sOf('r11_12:f0', 25),
      profile: [{ atS: 0, speedKmh: 25 }],
      events: [
        { atS: 45, indicator: 'right' },
        { atS: 84, glance: 'right_mirror' },
        { atS: 86, glance: 'right_shoulder' },
        { atS: p.sOf('r11_12:f0', 5), indicator: 'off' },
      ],
    });
    expect(r.nonInfo).toEqual(['WRONG_LANE_FOR_TURN']);
    expect(r.violations.find((x) => x.type === 'WRONG_LANE_FOR_TURN')!.details).toMatchObject({ turn: 'right', fromLane: 'r01_11:f0' });
  });

  it('turning right from the right lane is fine', () => {
    const rp = ['r01_11:f1', 'n11:r01_11:f1>r11_12:f0', 'r11_12:f0'];
    const p = new ScriptedDrive(g, rp, { profile: [{ atS: 0, speedKmh: 25 }] });
    const r = runScenario(world, g, rp, { startS: 40, endS: p.sOf('r11_12:f0', 25), profile: [{ atS: 0, speedKmh: 25 }], events: [{ atS: 45, indicator: 'right' }, { atS: p.sOf('r11_12:f0', 5), indicator: 'off' }] });
    expect(r.nonInfo).toEqual([]);
  });
});

describe('LanesDetector — stopping inside a junction', () => {
  const path = ['r01_11:f0', 'n11:r01_11:f0>r11_21:f0', 'r11_21:f0'];
  const probe = new ScriptedDrive(g, path, { profile: [{ atS: 0, speedKmh: 30 }] });
  const waitS = probe.sOf('n11:r01_11:f0>r11_21:f0', 12);
  const opts: ScenarioOptions = {
    startS: waitS - 60,
    endS: waitS,
    profile: [
      { atS: 0, speedKmh: 30 },
      { atS: waitS - 20, speedKmh: 30 },
      { atS: waitS, speedKmh: 0, hold: 5 },
    ],
    run: { tailSeconds: 6 },
  };

  it('stopped for no reason inside the junction → ILLEGAL_STOP "בתוך הצומת"', () => {
    const r = runScenario(world, g, path, opts);
    expect(r.nonInfo).toEqual(['ILLEGAL_STOP']);
    expect(r.violations.find((x) => x.type === 'ILLEGAL_STOP')!.context).toBe(HE.insideJunction);
  });

  it('stopped inside because the exit is blocked → BLOCKING_JUNCTION', () => {
    const r = runScenario(world, g, path, {
      ...opts,
      setup: (ctx) => ctx.traffic.push({ id: 'queue', kind: 'car', pos: [12.1 + 3, 1.65], heading: 0, speed: 0, length: 4.4, width: 1.8, laneId: 'r11_21:f0', s: 3 }),
    });
    expect(r.nonInfo).toEqual(['BLOCKING_JUNCTION']);
  });

  it('waiting inside for a conflicting movement is allowed', () => {
    const lp = ['r01_11:f0', 'n11:r01_11:f0>r10_11:b0', 'r10_11:b0'];
    const p = new ScriptedDrive(g, lp, { profile: [{ atS: 0, speedKmh: 25 }] });
    const w = p.sOf('n11:r01_11:f0>r10_11:b0', 2);
    const o: ScenarioOptions = {
      startS: w - 60,
      endS: p.sOf('r10_11:b0', 20),
      profile: [
        { atS: 0, speedKmh: 25 },
        { atS: w - 20, speedKmh: 25 },
        { atS: w, speedKmh: 0, hold: 5 },
        { atS: w + 12, speedKmh: 20 },
      ],
      events: [{ atS: w - 50, indicator: 'left' }, { atS: p.sOf('r10_11:b0', 3), indicator: 'off' }],
    };
    // an oncoming car reaches its stop line 1 s after the player stopped and is inside the junction when the 3 s check runs
    const tStop = timeToFirstStop(g, lp, o);
    const oncoming = new ScriptedAgent(g, ['r11_21:b0', 'n11:r11_21:b0>r01_11:b0', 'r01_11:b0'], { id: 'oncoming', speedKmh: 30 });
    oncoming.moveTo(g.lane('r11_21:b0').length - (30 / 3.6) * (tStop + 1));
    const r = runScenario(world, g, lp, { ...o, run: { agents: [oncoming] } });
    expect(r.nonInfo).toEqual([]);
  });
});

describe('LanesDetector — bus lanes and no-entry signs', () => {
  const nodes: BuildNode[] = [
    { id: 'A', pos: [0, 0], control: 'none' },
    { id: 'B', pos: [200, 0], control: 'none' },
    { id: 'C', pos: [400, 0], control: 'none' },
  ];
  const roads: BuildRoad[] = [
    { id: 'ab', from: 'A', to: 'B', points: [[0, 0], [200, 0]], cls: 'secondary', name: 'שדרות הרכבת', oneway: false, lanesForward: 2, lanesBackward: 1, maxSpeed: 50, busLaneForward: true },
    { id: 'bc', from: 'B', to: 'C', points: [[200, 0], [400, 0]], cls: 'residential', name: 'רחוב הסגור', oneway: false, lanesForward: 1, lanesBackward: 1, maxSpeed: 50 },
  ];
  const w2 = buildWorld({ name: 'bus-test', origin: { lat: 0, lon: 0 }, attribution: [], nodes, roads, signs: [{ code: '402', roadId: 'bc', s: 195, direction: 'backward' }] });
  const g2 = new RoadGraph(w2);

  it('driving in the bus lane for 2 s → BUS_LANE, unless turning right soon', () => {
    expect(g2.lane('ab:f1').kind).toBe('bus');
    const r = runScenario(w2, g2, ['ab:f1'], { startS: 5, endS: 60, profile: [{ atS: 0, speedKmh: 30 }] });
    expect(r.nonInfo).toEqual(['BUS_LANE']);
    expect(r.violations[0]!.context).toBe('בשדרות הרכבת');
    const turning = runScenario(w2, g2, ['ab:f1'], { startS: g2.lane('ab:f1').length - 28, endS: g2.lane('ab:f1').length - 2, profile: [{ atS: 0, speedKmh: 30 }], events: [{ atS: 0, indicator: 'right' }] });
    expect(turning.nonInfo).toEqual([]);
  });

  it('entering a lane with a no-entry sign from its start → NO_ENTRY', () => {
    expect(g2.signsByLane.get('bc:b0')?.some((s) => s.code === '402')).toBe(true);
    const r = runScenario(w2, g2, ['bc:f0', 'C:bc:f0>bc:b0', 'bc:b0'], { startS: 150, endS: 230, profile: [{ atS: 0, speedKmh: 15 }], events: [{ atS: 160, indicator: 'left' }] });
    expect(r.nonInfo).toContain('NO_ENTRY');
    expect(r.violations.find((x) => x.type === 'NO_ENTRY')!.context).toBe('ברחוב הסגור');
  });
});
