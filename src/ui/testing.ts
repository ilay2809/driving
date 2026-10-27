/**
 * Test helpers for the UI module (used by *.test.ts files only).
 */
import { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS, defaultVehicleState, emptyLocalisation, type SignalStateProvider, type SimContext } from '@/core/sim';
import { RoadGraph } from '@/world/graph';
import type { WorldFile } from '@/world/schema';
import { buildTrainingGround } from '@/world/testWorld';

let cached: { world: WorldFile; graph: RoadGraph } | undefined;

/** The synthetic training ground (built once per test file). */
export function trainingGround(): { world: WorldFile; graph: RoadGraph } {
  if (!cached) {
    const world = buildTrainingGround();
    cached = { world, graph: new RoadGraph(world) };
  }
  return cached;
}

export const stubSignals: SignalStateProvider = {
  stateOf: () => 'green',
  stateForConnector: () => undefined,
  stateForCrossing: () => undefined,
  timeToChange: () => 10,
  override: () => undefined,
};

export function fakeContext(overrides: Partial<SimContext> = {}): SimContext {
  const { world, graph } = trainingGround();
  return {
    time: 0,
    dt: 1 / 30,
    mode: 'lesson',
    world,
    graph,
    bus: new EventBus(),
    player: defaultVehicleState([-121.5, -90], Math.PI / 2),
    localisation: emptyLocalisation(),
    traffic: [],
    signals: stubSignals,
    env: { time: 0, hour: 10, weather: 'clear', wetRoad: false },
    settings: { ...DEFAULT_SETTINGS },
    coachPresent: true,
    timeScale: 1,
    paused: false,
    ...overrides,
  };
}

/** jsdom has no canvas implementation; make getContext return null without logging. */
export function stubCanvas(): void {
  if (typeof HTMLCanvasElement === 'undefined') return;
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
}

export function key(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
