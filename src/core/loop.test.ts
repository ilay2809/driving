import { describe, expect, it } from 'vitest';
import { GameLoop } from './loop';
import { EventBus } from './events';
import { defaultVehicleState, emptyLocalisation, DEFAULT_SETTINGS, type SimContext } from './sim';
import { buildTrainingGround } from '@/world/testWorld';
import { RoadGraph } from '@/world/graph';

function ctx(): SimContext {
  const world = buildTrainingGround();
  return {
    time: 0,
    dt: 0,
    mode: 'free',
    world,
    graph: new RoadGraph(world),
    bus: new EventBus(),
    player: defaultVehicleState([0, 0], 0),
    localisation: emptyLocalisation(),
    traffic: [],
    signals: { stateOf: () => 'red', stateForConnector: () => undefined, stateForCrossing: () => undefined, timeToChange: () => 0, override: () => {} },
    env: { time: 0, hour: 10, weather: 'clear', wetRoad: false },
    settings: DEFAULT_SETTINGS,
    coachPresent: false,
    timeScale: 1,
    paused: false,
  };
}

describe('GameLoop', () => {
  it('advances time, applies time scale and pause', () => {
    const c = ctx();
    const seen: number[] = [];
    const loop = new GameLoop(c, [{ name: 't', update: (x) => seen.push(x.dt) }], () => {});
    loop.step(0.016);
    expect(c.time).toBeCloseTo(0.016);
    loop.setTimeScale(0.5, 1);
    loop.step(0.016);
    expect(seen[1]).toBeCloseTo(0.008);
    loop.setPaused(true);
    loop.step(0.016);
    expect(seen[2]).toBe(0);
    expect(c.time).toBeCloseTo(0.024);
    loop.setPaused(false);
    loop.step(2); // clamped by caller normally; here it ends the slow-motion window
    expect(c.timeScale).toBe(1);
  });
});
