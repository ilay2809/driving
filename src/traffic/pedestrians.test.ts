import { describe, expect, it } from 'vitest';
import { JUNCTION, PED } from './constants';
import { createTrafficHarness } from './harness';

describe('pedestrians at crossings', () => {
  it('a pedestrian at c_mid steps onto the zebra only when no vehicle arrives within 3.5 s (or one has stopped)', () => {
    const h = createTrafficHarness({ seed: 11, playerPos: [5000, 5000] });
    const { traffic, graph } = h;
    const lanes = ['r00_10:f0', 'r00_10:b0'];
    const sCross = Object.fromEntries(lanes.map((id) => [id, traffic.net.seg(id).crossings[0]!.s]));
    h.step();
    const ped = traffic.spawnPedestrian('c_mid')!;
    expect(ped).toBeDefined();
    expect(ped.state.crossingId).toBe('c_mid');
    // a car already close to the crossing (TTC ≈ 2 s) and then a stream of cars on both lanes, one every 5 s
    {
      const seg = traffic.net.seg('r00_10:f0');
      const first = traffic.spawnRandomVehicle()!;
      first.path = [seg];
      first.idx = 0;
      first.s = seg.crossings[0]!.s - 26;
      first.v = 12;
    }
    let nextCar = 2;
    let crossings = 0;
    let waited = 0;
    const violations: string[] = [];
    let prevState = ped.state.pedState;
    let unsafeWaitFrames = 0;
    h.run(90, 1 / 30, (ctx) => {
      if (ctx.time >= nextCar) {
        nextCar += 5;
        for (const id of lanes) {
          const seg = traffic.net.seg(id);
          const agent = traffic.spawnRandomVehicle();
          // the random spawner may land anywhere; force the lane by re-placing when possible
          if (agent && (agent.seg.id !== id || agent.s > 20)) {
            // move it to the lane start if the slot is free
            agent.path = [seg];
            agent.idx = 0;
            agent.s = 5;
            agent.v = 12;
          }
        }
      }
      const st = ped.state.pedState;
      if (st === 'waiting') {
        waited++;
        // is a vehicle within the TTC horizon? (then waiting is right)
        for (const a of ctx.traffic) {
          if (a.kind === 'pedestrian' || !a.laneId || !lanes.includes(a.laneId) || a.s === undefined) continue;
          const d = sCross[a.laneId]! - a.s - a.length / 2;
          if (d > 0 && a.speed > 0.5 && d / a.speed < PED.ttcHorizon) unsafeWaitFrames++;
        }
      }
      if (prevState === 'waiting' && st === 'crossing') {
        crossings++;
        for (const a of ctx.traffic) {
          if (a.kind === 'pedestrian' || !a.laneId || !lanes.includes(a.laneId) || a.s === undefined) continue;
          const d = sCross[a.laneId]! - a.s - a.length / 2;
          if (d < -(a.length + 1)) continue;
          const stoppedForUs = a.speed < PED.stoppedSpeed && d < PED.stoppedDistance;
          if (d < 0.3 && !stoppedForUs) violations.push(`${a.id} on the crossing (d=${d.toFixed(1)})`);
          else if (!stoppedForUs && a.speed > 0.5 && d / a.speed < PED.ttcHorizon - 0.2) violations.push(`${a.id} ttc ${(d / a.speed).toFixed(2)} at t=${ctx.time.toFixed(1)}`);
        }
      }
      prevState = st;
    });
    expect(waited).toBeGreaterThan(0);
    expect(unsafeWaitFrames).toBeGreaterThan(0); // it actually had to wait for traffic at least once
    expect(crossings).toBeGreaterThanOrEqual(1);
    expect(violations).toEqual([]);
    void graph;
  });

  it('a waiting pedestrian at c_main_w does not step out in front of the player at 50 km/h, but does once the player stopped', () => {
    const h = createTrafficHarness({ seed: 2, playerPos: [-9.6 - 30, 1.6], playerHeading: 0 });
    const { traffic, signals } = h;
    signals.override('sig_n11:ped:c_main_w', 'green'); // pedestrian signal green: only the gap check decides
    h.player.speed = 50 / 3.6;
    h.step();
    const ped = traffic.spawnPedestrian('c_main_w')!;
    expect(ped.state.crossingId).toBe('c_main_w');
    h.run(2); // the player stays 30 m away (not driven), approaching at 50 km/h → TTC ≈ 2.2 s
    expect(ped.state.pedState).toBe('waiting');
    expect(traffic.pedestriansAtCrossing('c_main_w').length).toBe(1);
    // now the player has stopped 8 m before the crossing line
    h.place([-9.6 - 8 - 2.2, 1.6], 0, 0);
    h.run(1.5);
    expect(ped.state.pedState).toBe('crossing');
    expect(ped.state.crossingProgress).toBeGreaterThan(0);
    h.run(12);
    expect(ped.state.pedState).toBe('walking');
  });

  it('a scripted pedestrian waits on the sidewalk until the player is 40–60 m away', () => {
    const h = createTrafficHarness({ seed: 2, playerPos: [-9.6 - 120, 1.6], playerHeading: 0 });
    h.step();
    const ped = h.traffic.spawnPedestrian()!; // nearest crossing ahead = c_main_w
    expect(ped.state.crossingId).toBe('c_main_w');
    h.run(3);
    expect(ped.state.pedState).toBe('walking');
    expect(ped.speed).toBe(0);
    h.place([-9.6 - 45, 1.6], 0, 10);
    h.run(2);
    expect(ped.state.pedState).toBe('waiting');
  });

  it('vehicles stop before a zebra crossing while a pedestrian is waiting or crossing', () => {
    const h = createTrafficHarness({ seed: 4, playerPos: [5000, 5000] });
    const { traffic } = h;
    h.step();
    const ped = traffic.spawnPedestrian('c_mid')!;
    const seg = traffic.net.seg('r00_10:f0');
    const sCross = seg.crossings[0]!.s;
    const car = traffic.spawnRandomVehicle()!;
    car.path = [seg];
    car.idx = 0;
    car.s = sCross - 24; // TTC ≈ 2 s: the pedestrian must wait, the car must stop for the waiting pedestrian
    car.v = 11;
    const laneZ = -118.5; // r00_10:f0 runs east at z = -118.5; the pedestrian starts on the south kerb and walks north
    let minFrontGap = Infinity;
    let carHeld = false;
    let carPassed = false;
    h.run(25, 1 / 30, () => {
      if (car.seg.id !== 'r00_10:f0') return;
      const front = car.s + car.length / 2;
      if (front > sCross + 2) carPassed = true;
      const pedCleared = ped.pos[1] < laneZ - (seg.lane!.width / 2 + 1); // past the car's lane and walking away
      if ((ped.state.pedState === 'crossing' && !pedCleared) || ped.state.pedState === 'waiting') {
        minFrontGap = Math.min(minFrontGap, sCross - seg.crossings[0]!.crossing.width / 2 - front);
        if (car.v < JUNCTION.stoppedSpeed) carHeld = true;
      }
    });
    expect(carHeld).toBe(true);
    expect(minFrontGap).toBeGreaterThan(0);
    expect(carPassed).toBe(true); // and continues once the pedestrian has cleared its lane
  });
});
