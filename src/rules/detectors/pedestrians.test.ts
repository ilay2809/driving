import { describe, expect, it } from 'vitest';
import type { TrafficAgentState } from '@/core/types';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { runScenario } from '../scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const CAR = 4.4;
// eastbound on רחוב הברוש; the mid-block crossing c_mid is at x = -60 (lane s = 59.5, near edge at 58.0)
const path = ['r00_10:f0'];
const ped = (over: Partial<TrafficAgentState> = {}): TrafficAgentState => ({ id: 'ped1', kind: 'pedestrian', pos: [-60, -115.5], heading: -Math.PI / 2, speed: 0, length: 0.5, width: 0.5, crossingId: 'c_mid', pedState: 'waiting', ...over });

describe('PedestriansDetector', () => {
  it('passing a crossing at 40 km/h while a pedestrian waits → PEDESTRIAN_NOT_YIELDED', () => {
    const r = runScenario(world, g, path, { startS: 5, endS: 100, profile: [{ atS: 0, speedKmh: 40 }], setup: (ctx) => ctx.traffic.push(ped()) });
    expect(r.nonInfo).toEqual(['PEDESTRIAN_NOT_YIELDED']);
    const v = r.violations.find((x) => x.type === 'PEDESTRIAN_NOT_YIELDED')!;
    expect(v.details).toMatchObject({ crossing: 'c_mid', speed: 40 });
    expect(v.context).toBe('ברחוב הברוש');
    expect(r.types[0]).toBe('APPROACHING_CROSSING');
  });

  it('stopping before the crossing, letting the pedestrian cross, then going → nothing', () => {
    const stopS = 58 - 0.5 - CAR / 2 - 0.3;
    const r = runScenario(world, g, path, {
      startS: 5,
      endS: 100,
      profile: [
        { atS: 0, speedKmh: 40 },
        { atS: stopS - 40, speedKmh: 40 },
        { atS: stopS, speedKmh: 0, hold: 4 },
        { atS: stopS + 20, speedKmh: 30 },
      ],
      setup: (ctx) => ctx.traffic.push(ped()),
      run: {
        onTick: (ctx) => {
          const p = ctx.traffic[0]!;
          if (ctx.player.speed === 0 && p.pedState === 'waiting') {
            p.pedState = 'crossing';
            p.speed = 1.4;
          }
          if (p.pedState === 'crossing') {
            p.pos = [p.pos[0], p.pos[1] - 1.4 * ctx.dt];
            if (p.pos[1] < -124.5) {
              p.pedState = 'walking';
              p.crossingId = undefined;
              p.speed = 0;
            }
          }
        },
      },
    });
    expect(r.nonInfo).toEqual([]);
    expect(r.types).not.toContain('GOOD_YIELD');
    expect(r.types).toContain('APPROACHING_CROSSING');
  });

  it('a pedestrian walking along the street is not a crossing conflict, but passing within 1.5 m is a near miss', () => {
    const walking = runScenario(world, g, path, { startS: 5, endS: 100, profile: [{ atS: 0, speedKmh: 40 }], setup: (ctx) => ctx.traffic.push(ped({ crossingId: undefined, pedState: 'walking', pos: [-80, -115.5] })) });
    expect(walking.nonInfo).toEqual([]);
    const close = runScenario(world, g, path, { startS: 5, endS: 100, profile: [{ atS: 0, speedKmh: 40 }], setup: (ctx) => ctx.traffic.push(ped({ crossingId: undefined, pedState: 'walking', pos: [-80, -116.6] })) });
    expect(close.nonInfo).toEqual(['PEDESTRIAN_NEAR_MISS']);
    expect(close.violations.find((x) => x.type === 'PEDESTRIAN_NEAR_MISS')!.details).toMatchObject({ agent: 'ped1' });
  });

  it('sends APPROACHING_CROSSING only when somebody is near the crossing', () => {
    const empty = runScenario(world, g, path, { startS: 5, endS: 100, profile: [{ atS: 0, speedKmh: 40 }] });
    expect(empty.types).not.toContain('APPROACHING_CROSSING');
    const near = runScenario(world, g, path, { startS: 5, endS: 100, profile: [{ atS: 0, speedKmh: 40 }], setup: (ctx) => ctx.traffic.push(ped({ crossingId: undefined, pedState: 'walking', pos: [-60, -112] })) });
    expect(near.types).toContain('APPROACHING_CROSSING');
    expect(near.nonInfo).toEqual([]);
  });

  it('at a signalised crossing a waiting pedestrian on red has no priority, a crossing one always has', () => {
    const sig = ['r01_11:f0', 'n11:r01_11:f0>r11_21:f0', 'r11_21:f0'];
    const opts = { startS: 10, endS: 140, profile: [{ atS: 0, speedKmh: 30 }] };
    const waiting = runScenario(world, g, sig, {
      ...opts,
      setup: (ctx) => {
        ctx.signals.set('sig_n11:ped:c_main_w', 'red');
        ctx.traffic.push(ped({ pos: [-9.6, 7.8], crossingId: 'c_main_w', pedState: 'waiting' }));
      },
    });
    expect(waiting.nonInfo).toEqual([]);
    const crossing = runScenario(world, g, sig, {
      ...opts,
      setup: (ctx) => {
        ctx.signals.set('sig_n11:ped:c_main_w', 'red');
        ctx.traffic.push(ped({ pos: [-9.6, 6.0], crossingId: 'c_main_w', pedState: 'crossing', speed: 1 }));
      },
    });
    expect(crossing.nonInfo).toEqual(['PEDESTRIAN_NOT_YIELDED']);
    const green = runScenario(world, g, sig, {
      ...opts,
      setup: (ctx) => {
        ctx.signals.set('sig_n11:ped:c_main_w', 'green');
        ctx.traffic.push(ped({ pos: [-9.6, 7.8], crossingId: 'c_main_w', pedState: 'waiting' }));
      },
    });
    expect(green.nonInfo).toEqual(['PEDESTRIAN_NOT_YIELDED']);
  });
});
