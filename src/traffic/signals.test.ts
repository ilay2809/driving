import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/events';
import { defaultVehicleState, emptyLocalisation } from '@/core/sim';
import { RoadGraph } from '@/world/graph';
import { SIGNAL_TIMING } from '@/world/schema';
import { buildTrainingGround } from '@/world/testWorld';
import { buildControllerPlan, PEDESTRIAN_FLASH_SECONDS, SignalSystem } from './signals';

const world = buildTrainingGround();
const graph = new RoadGraph(world);
const ctrl = world.signals[0]!; // sig_n11
const MAIN = 'sig_n11:r01_11:to';
const MAIN_E = 'sig_n11:r11_21:from';
const SIDE = 'sig_n11:r10_11:to';
const PED_DEKEL_N = 'sig_n11:ped:c_dekel_n'; // crossing on the north arm: green with the main road (phase 1)
const PED_MAIN_W = 'sig_n11:ped:c_main_w'; // crossing on the west arm: green with the side streets (phase 2)

const phase1 = ctrl.phases[0]!.duration; // 32
const phase2 = ctrl.phases[1]!.duration; // 22
const slot = (d: number) => SIGNAL_TIMING.redAmber + d + SIGNAL_TIMING.flashingGreen + SIGNAL_TIMING.amber + SIGNAL_TIMING.allRed;

describe('SignalSystem', () => {
  it('builds a cycle of red_amber → green → flashing_green → amber → all-red per phase', () => {
    const plan = buildControllerPlan(ctrl);
    expect(plan.cycle).toBeCloseTo(slot(phase1) + slot(phase2), 6);
    const main = plan.intervals.get(MAIN)!;
    expect(main.map((iv) => iv.state)).toEqual(['red_amber', 'green', 'flashing_green', 'amber', 'red']);
    expect(main[0]!.end - main[0]!.start).toBeCloseTo(SIGNAL_TIMING.redAmber);
    expect(main[1]!.end - main[1]!.start).toBeCloseTo(phase1);
    expect(main[2]!.end - main[2]!.start).toBeCloseTo(SIGNAL_TIMING.flashingGreen);
    expect(main[3]!.end - main[3]!.start).toBeCloseTo(SIGNAL_TIMING.amber);
  });

  it('reports states according to SIGNAL_TIMING and the controller offset', () => {
    const sig = new SignalSystem(world, graph);
    const t0 = ctrl.offset; // cycle start
    const at = (t: number, g: string) => {
      sig.setTime(t);
      return sig.stateOf(g);
    };
    expect(at(t0 + 0.5, MAIN)).toBe('red_amber');
    expect(at(t0 + 0.5, SIDE)).toBe('red');
    expect(at(t0 + SIGNAL_TIMING.redAmber + 1, MAIN)).toBe('green');
    expect(at(t0 + SIGNAL_TIMING.redAmber + 1, MAIN_E)).toBe('green');
    expect(at(t0 + SIGNAL_TIMING.redAmber + phase1 + 1, MAIN)).toBe('flashing_green');
    expect(at(t0 + SIGNAL_TIMING.redAmber + phase1 + SIGNAL_TIMING.flashingGreen + 1, MAIN)).toBe('amber');
    const allRedStart = t0 + SIGNAL_TIMING.redAmber + phase1 + SIGNAL_TIMING.flashingGreen + SIGNAL_TIMING.amber;
    expect(at(allRedStart + 1, MAIN)).toBe('red');
    expect(at(allRedStart + 1, SIDE)).toBe('red');
    // phase 2
    const p2 = t0 + slot(phase1);
    expect(at(p2 + 0.5, SIDE)).toBe('red_amber');
    expect(at(p2 + SIGNAL_TIMING.redAmber + 5, SIDE)).toBe('green');
    expect(at(p2 + SIGNAL_TIMING.redAmber + 5, MAIN)).toBe('red');
    // wraps around the cycle
    expect(at(t0 + slot(phase1) + slot(phase2) + 0.5, MAIN)).toBe('red_amber');
    expect(at(t0 - 1, MAIN)).toBe('red'); // end of the previous cycle: all-red
  });

  it('gives pedestrians green only during the perpendicular phase, flashing in the last 5 s', () => {
    const sig = new SignalSystem(world, graph);
    const t0 = ctrl.offset;
    const greenStart = t0 + SIGNAL_TIMING.redAmber;
    sig.setTime(greenStart + 1);
    expect(sig.stateOf(PED_DEKEL_N)).toBe('green'); // crossing the side street while the main road flows
    expect(sig.stateOf(PED_MAIN_W)).toBe('red');
    sig.setTime(greenStart + phase1 - PEDESTRIAN_FLASH_SECONDS + 0.5);
    expect(sig.stateOf(PED_DEKEL_N)).toBe('flashing_green');
    sig.setTime(greenStart + phase1 + 1); // vehicles flashing green, pedestrians already red
    expect(sig.stateOf(PED_DEKEL_N)).toBe('red');
    const p2green = t0 + slot(phase1) + SIGNAL_TIMING.redAmber;
    sig.setTime(p2green + 1);
    expect(sig.stateOf(PED_MAIN_W)).toBe('green');
    expect(sig.stateOf(PED_DEKEL_N)).toBe('red');
    expect(sig.stateForCrossing('c_main_w')).toBe('green');
    expect(sig.stateForCrossing('c_mid')).toBeUndefined(); // zebra, not signalised
    // every connector of the north approach is governed by the side group
    for (const cid of graph.junction('n11').connectors) {
      const c = graph.connector(cid);
      if (c.fromLane === 'r10_11:f0') expect(sig.stateForConnector(cid)).toBe('green');
    }
    expect(sig.stateForConnector('n01:r00_01:f0>r01_11:f0')).toBeUndefined();
  });

  it('computes timeToChange across merged intervals', () => {
    const sig = new SignalSystem(world, graph);
    const t0 = ctrl.offset;
    sig.setTime(t0 + SIGNAL_TIMING.redAmber + 2);
    expect(sig.timeToChange(MAIN)).toBeCloseTo(phase1 - 2, 6);
    const allRedStart = t0 + SIGNAL_TIMING.redAmber + phase1 + SIGNAL_TIMING.flashingGreen + SIGNAL_TIMING.amber;
    sig.setTime(allRedStart + 0.5);
    // red through the all-red + the whole second phase slot, until red_amber at the next cycle start
    expect(sig.timeToChange(MAIN)).toBeCloseTo(SIGNAL_TIMING.allRed - 0.5 + slot(phase2), 6);
  });

  it('applies overrides and forces conflicting groups red', () => {
    const sig = new SignalSystem(world, graph);
    const t0 = ctrl.offset;
    sig.setTime(t0 + SIGNAL_TIMING.redAmber + 2); // main road green
    sig.override(SIDE, 'green');
    expect(sig.stateOf(SIDE)).toBe('green');
    expect(sig.stateOf(MAIN)).toBe('red');
    expect(sig.stateOf(MAIN_E)).toBe('red');
    expect(sig.stateOf('sig_n11:r11_12:from')).toBe('red'); // compatible (same phase) → keeps its own schedule (red at this time)
    expect(sig.timeToChange(SIDE)).toBe(Infinity);
    sig.override(SIDE, undefined);
    expect(sig.stateOf(MAIN)).toBe('green');
    expect(sig.stateOf(SIDE)).toBe('red');
  });

  it('handles coach:request set_signal for the junction ahead of the player', () => {
    const sig = new SignalSystem(world, graph);
    const bus = new EventBus();
    sig.attach(bus);
    const player = defaultVehicleState([-60, 1.6], 0);
    const loc = emptyLocalisation();
    loc.laneId = 'r01_11:f0';
    loc.nextJunctionId = 'n11';
    sig.setPlayer(player, loc);
    sig.setTime(ctrl.offset + SIGNAL_TIMING.redAmber + 2); // main green by schedule
    bus.emit('coach:request', { kind: 'set_signal', payload: { junctionId: 'n11', state: 'red' } });
    expect(sig.stateOf(MAIN)).toBe('red');
    expect(sig.stateOf(SIDE)).toBe('red');
    expect(sig.stateOf(PED_MAIN_W)).toBe('red');
    bus.emit('coach:request', { kind: 'set_signal', payload: { state: 'green' } }); // junction inferred from the player's lane
    expect(sig.stateOf(MAIN)).toBe('green');
    expect(sig.stateOf(MAIN_E)).toBe('red'); // only the player's approach gets green
    expect(sig.stateOf(PED_DEKEL_N)).toBe('green'); // parallel crossing
    expect(sig.stateOf(PED_MAIN_W)).toBe('red');
    bus.emit('coach:request', { kind: 'set_signal', payload: { junctionId: 'n11', state: 'release' } });
    expect(sig.overriddenGroups).toEqual([]);
    expect(sig.stateOf(MAIN_E)).toBe('green');
  });
});
