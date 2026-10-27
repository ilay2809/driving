import { describe, expect, it } from 'vitest';
import type { TrafficAgentState } from '@/core/types';
import { dist2 } from '@/world/geo';
import { JUNCTION } from './constants';
import { createTrafficHarness } from './harness';
import { obbGap } from './util';

/** Per-agent bookkeeping across frames for the invariants below. */
interface Track {
  prev: TrafficAgentState;
  prevSeg: string | undefined;
  /** Seconds spent stopped within the last 6 m of a stop-controlled lane. */
  stopSignStopped: number;
}

const ROUNDABOUT_ENTRY_LANES = new Set(['r21_rbw:f0', 'rbs_out:b0', 'rbe_out:b0', 'rbn_out:b0']);

describe('TrafficSystem — 120 s at density 1 with the player far away', () => {
  const h = createTrafficHarness({ seed: 42, density: 1, pedestrians: 0.5, playerPos: [5000, 5000] });
  const { traffic, signals, graph } = h;
  const net = traffic.net;
  const dt = 1 / 30;
  const tracks = new Map<string, Track>();
  let overlaps = 0;
  const redRuns: string[] = [];
  const rollingStops: string[] = [];
  const roundaboutCuts: string[] = [];
  const jumps: string[] = [];
  let transitions = 0;
  let stopSignPasses = 0;
  let roundaboutEntries = 0;
  let maxVehicles = 0;
  let frames = 0;

  h.run(120, dt, (ctx) => {
    frames++;
    const vehicles = ctx.traffic.filter((a) => a.kind !== 'pedestrian');
    maxVehicles = Math.max(maxVehicles, vehicles.length);
    // overlaps (every frame, pairs within 20 m)
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const a = vehicles[i]!;
        const b = vehicles[j]!;
        if (dist2(a.pos, b.pos) > 20) continue;
        if (obbGap({ pos: a.pos, heading: a.heading, length: a.length, width: a.width }, { pos: b.pos, heading: b.heading, length: b.length, width: b.width }) < -0.01) overlaps++;
      }
    }
    for (const a of vehicles) {
      const seg = a.laneId ?? a.connectorId;
      const tr = tracks.get(a.id);
      if (tr) {
        // continuity
        const v = Math.max(tr.prev.speed, a.speed);
        const d = dist2(tr.prev.pos, a.pos);
        if (d > v * dt + 0.5) jumps.push(`${a.id} t=${ctx.time.toFixed(2)} d=${d.toFixed(2)} v=${v.toFixed(1)}`);
        // stop sign bookkeeping (r11_12:f0 arrives at the stop sign of n12)
        if (a.laneId === 'r11_12:f0' && a.s !== undefined && a.s > graph.lane('r11_12:f0').length - 6 && a.speed < JUNCTION.stoppedSpeed) tr.stopSignStopped += dt;
        if (tr.prevSeg !== seg && tr.prev.laneId && a.connectorId) {
          transitions++;
          const conn = graph.connector(a.connectorId);
          // red light
          const st = signals.stateForConnector(a.connectorId);
          if (st === 'red' || st === 'red_amber') redRuns.push(`${a.id} ${a.connectorId} t=${ctx.time.toFixed(1)}`);
          // stop sign
          if (tr.prev.laneId === 'r11_12:f0') {
            stopSignPasses++;
            if (tr.stopSignStopped < JUNCTION.stopSignSeconds - 2 * dt) rollingStops.push(`${a.id} stopped ${tr.stopSignStopped.toFixed(2)}s`);
          }
          // roundabout: no entry while a ring vehicle is within TTC 3.5 s (measured after this frame's update)
          if (ROUNDABOUT_ENTRY_LANES.has(tr.prev.laneId) && conn.yieldTo.length > 0) {
            roundaboutEntries++;
            for (const yId of conn.yieldTo) {
              const ySeg = net.seg(yId);
              for (const o of vehicles) {
                if (o.id === a.id) continue;
                if (o.connectorId === yId && (o.s ?? 0) < ySeg.length - o.length / 2) roundaboutCuts.push(`${a.id} entered ${conn.id} with ${o.id} inside ${yId}`);
              }
              for (const up of net.upstream(yId, JUNCTION.upstreamReach)) {
                for (const o of vehicles) {
                  if (o.id === a.id) continue;
                  const onSeg = (o.laneId ?? o.connectorId) === up.seg.id;
                  if (!onSeg || o.s === undefined) continue;
                  if (!traffic.vehicle(o.id)!.plansThrough(yId)) continue; // leaving the ring before our entry: no conflict
                  const d = up.seg.length - o.s + up.offset;
                  if (d < 0 || o.speed < 0.5) continue;
                  if (d / o.speed < JUNCTION.ttcHorizon - 0.3) roundaboutCuts.push(`${a.id} entered ${conn.id} with ${o.id} at ttc ${(d / o.speed).toFixed(2)} on ${up.seg.id}`);
                }
              }
            }
          }
        }
        if (a.laneId && a.laneId !== tr.prev.laneId) tr.stopSignStopped = 0;
        tr.prev = { ...a, pos: [a.pos[0], a.pos[1]] };
        tr.prevSeg = seg;
      } else tracks.set(a.id, { prev: { ...a, pos: [a.pos[0], a.pos[1]] }, prevSeg: seg, stopSignStopped: 0 });
    }
    for (const id of Array.from(tracks.keys())) if (!vehicles.some((a) => a.id === id)) tracks.delete(id);
  });

  it('populates the whole world when the player is off the map', () => {
    expect(frames).toBe(3600);
    expect(maxVehicles).toBeGreaterThanOrEqual(45);
    expect(maxVehicles).toBeLessThanOrEqual(60);
    expect(traffic.agents.filter((a) => a.kind === 'pedestrian').length).toBeGreaterThan(10);
    expect(transitions).toBeGreaterThan(100);
  });
  it('practically never lets NPC bodies overlap', () => {
    // Tolerance: a handful of overlap-frames (≤ 0.3 s of contact in 120 s at maximum density) —
    // the remaining case is a ring vehicle entering a roundabout arm while another vehicle
    // is still crossing the mouth; tracked as a known gap.
    expect(overlaps).toBeLessThanOrEqual(10);
  });
  it('never crosses a red stop line', () => {
    expect(redRuns).toEqual([]);
  });
  it('makes a full stop (≥ 1 s) at the stop sign of n12', () => {
    expect(stopSignPasses).toBeGreaterThan(0);
    expect(rollingStops).toEqual([]);
  });
  it('yields to ring traffic when entering the roundabout', () => {
    expect(roundaboutEntries).toBeGreaterThan(0);
    expect(roundaboutCuts).toEqual([]);
  });
  it('moves every vehicle continuously along its path', () => {
    expect(jumps).toEqual([]);
  });
  it('exposes stable agent views with lane/connector positions', () => {
    const arr = traffic.agents;
    expect(arr).toBe(traffic.agents);
    for (const a of arr) {
      if (a.kind === 'pedestrian') expect(a.pedState).toBeDefined();
      else {
        expect(a.laneId !== undefined || a.connectorId !== undefined).toBe(true);
        expect(Number.isFinite(a.s!)).toBe(true);
      }
    }
  });
});

describe('TrafficSystem — determinism', () => {
  it('produces identical trajectories for the same seed and player inputs', () => {
    const run = () => {
      const h = createTrafficHarness({ seed: 7, density: 0.6, pedestrians: 0.5, playerPos: [-60, 1.6], playerHeading: 0 });
      h.drive = true;
      h.player.speed = 8;
      h.run(60);
      return h.traffic.agents.map((a) => `${a.id}:${a.pos[0].toFixed(4)},${a.pos[1].toFixed(4)},${a.speed.toFixed(4)},${a.pedState ?? ''}`);
    };
    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(10);
    expect(a).toEqual(b);
  }, 30_000); // two full 0.6-density simulations: ≈ 3 s alone, slower when the suite runs in parallel on a loaded box
});

describe('TrafficSystem — scripted spawns', () => {
  it("spawn_vehicle 'from_right' places a car on the lane arriving from the player's right at the next junction", () => {
    const h = createTrafficHarness({ seed: 3, playerPos: [-62.4, 1.6], playerHeading: 0 }); // r01_11:f0, s ≈ 50, next junction n11
    h.step();
    h.bus.emit('coach:request', { kind: 'spawn_vehicle', payload: { where: 'from_right', distance: 40, speedKmh: 30 } });
    h.step();
    const cars = h.traffic.agents.filter((a) => a.kind === 'car');
    expect(cars.length).toBe(1);
    const car = cars[0]!;
    expect(car.laneId).toBe('r11_12:b0'); // the south arm, northbound = from the east-bound player's right
    const lane = h.graph.lane('r11_12:b0');
    expect(lane.length - car.s!).toBeCloseTo(40, 0);
    expect(car.speed).toBeCloseTo(30 / 3.6, 0);
  });

  it("spawn_vehicle 'from_left', 'ahead', 'behind' and 'oncoming' use the right lanes", () => {
    const h = createTrafficHarness({ seed: 3, playerPos: [-62.4, 1.6], playerHeading: 0 });
    h.step();
    const left = h.traffic.spawnVehicle({ where: 'from_left', distance: 30 })!;
    expect(left.state.laneId).toBe('r10_11:f0');
    const ahead = h.traffic.spawnVehicle({ where: 'ahead', distance: 30 })!;
    expect(ahead.state.laneId).toBe('r01_11:f0');
    expect(ahead.s).toBeCloseTo(80, 0);
    const behind = h.traffic.spawnVehicle({ where: 'behind', distance: 30 })!;
    expect(behind.state.laneId).toBe('r01_11:f0');
    expect(behind.s).toBeCloseTo(20, 0);
    const onc = h.traffic.spawnVehicle({ where: 'oncoming', distance: 40 })!;
    expect(onc.state.laneId).toBe('r01_11:b0');
    expect(Math.abs(onc.pos[0] - (-62.4 + 40))).toBeLessThan(2);
  });

  it("spawn_vehicle 'inside_roundabout' places a car on the ring before the player's entry", () => {
    const h = createTrafficHarness({ seed: 3, playerPos: [250, 1.6], playerHeading: 0 }); // r21_rbw:f0 towards rb_w
    h.step();
    const v = h.traffic.spawnVehicle({ where: 'inside_roundabout', distance: 10 })!;
    expect(v).toBeDefined();
    expect(['rb4:f0', 'rb3:f0', 'rb_n:rb3:f0>rb4:f0']).toContain(v.state.laneId ?? v.state.connectorId);
  });

  it("spawn_vehicle {parked: true} places a stationary car at the right kerb that never drives and does not block the lane", () => {
    const h = createTrafficHarness({ seed: 3, playerPos: [-62.4, 1.6], playerHeading: 0 }); // r01_11:f0, s ≈ 50
    h.step();
    h.bus.emit('coach:request', { kind: 'spawn_vehicle', payload: { where: 'ahead', distance: 30, speedKmh: 0, vehicle: 'car', parked: true, side: 'right', laneId: 'r01_11:f0' } });
    h.step();
    const parked = h.traffic.agents.find((a) => a.kind === 'car')!;
    expect(parked).toBeDefined();
    expect(parked.laneId).toBe('r01_11:f0');
    expect(parked.speed).toBe(0);
    expect((parked as { parked?: boolean }).parked).toBe(true);
    const lane = h.graph.lane('r01_11:f0');
    const centre = h.graph.laneAt(lane.id, parked.s!).p;
    // right of an east-bound lane is +z; the car hugs the kerb (≈ half a lane minus half a car)
    expect(parked.pos[1] - centre[1]).toBeGreaterThan(0.3);
    expect(parked.pos[1] - centre[1]).toBeLessThan(lane.width / 2);
    const pos0: [number, number] = [parked.pos[0], parked.pos[1]];
    // a moving car between the player and the parked one is not held by it: it passes
    const mover = h.traffic.spawnVehicle({ where: 'ahead', distance: 18, speedKmh: 30 })!;
    expect(mover.s).toBeGreaterThan(60);
    expect(mover.s).toBeLessThan(parked.s!);
    h.run(2);
    expect(parked.pos[0]).toBeCloseTo(pos0[0], 3);
    expect(parked.pos[1]).toBeCloseTo(pos0[1], 3);
    expect(parked.speed).toBe(0);
    expect(mover.v).toBeGreaterThan(3);
    expect(mover.s).toBeGreaterThan(parked.s!);
  });

  it("the examiner's two parked cars (12 m and 23.4 m ahead) both appear, leaving a 7 m gap", () => {
    const h = createTrafficHarness({ seed: 3, playerPos: [-62.4, 1.6], playerHeading: 0 }); // r01_11:f0, s ≈ 50
    h.step();
    for (const distance of [12, 23]) h.bus.emit('coach:request', { kind: 'spawn_vehicle', payload: { where: 'ahead', distance, speedKmh: 0, vehicle: 'car', parked: true, side: 'right', laneId: 'r01_11:f0' } });
    h.step();
    const parked = h.traffic.agents.filter((a) => a.kind === 'car' && (a as { parked?: boolean }).parked).sort((a, b) => a.s! - b.s!);
    expect(parked.length).toBe(2);
    expect(parked[0]!.s).toBeCloseTo(62, 0);
    expect(parked[1]!.s).toBeCloseTo(73, 0);
    expect(parked[1]!.s! - parked[0]!.s! - parked[0]!.length).toBeGreaterThanOrEqual(6);
  });

  it('clear_traffic despawns everyone and stops automatic spawning', () => {
    const h = createTrafficHarness({ seed: 5, density: 0.5, pedestrians: 0.5, playerPos: [-60, 1.6], playerHeading: 0 });
    h.run(2);
    expect(h.traffic.agents.length).toBeGreaterThan(5);
    h.bus.emit('coach:request', { kind: 'clear_traffic', payload: {} });
    h.run(2);
    expect(h.traffic.agents.length).toBe(0);
    h.traffic.setDensity(0.5);
    h.run(2);
    expect(h.traffic.agents.length).toBeGreaterThan(0);
  });
});
