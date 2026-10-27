/**
 * Driving-feel acceptance tests: the whole Rapier vehicle runs headless in node.
 * Targets from the module spec: 0→50 km/h ≈ 6–7 s, 50→0 ≈ 14–16 m, U-turn ≈ 11 m,
 * creep ≈ 6 km/h, stable at 90 km/h, reversing works, R/P refused above 1 m/s.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTrainingGround } from '@/world/testWorld';
import { angleDiff, kmhToMps, mpsToKmh } from '@/world/geo';
import { createPhysics, type CollisionRecord, type PhysicsWorld } from './physics';
import { VehicleBody } from './VehicleBody';

const H = 1 / 60;

interface Rig {
  physics: PhysicsWorld;
  car: VehicleBody;
  run: (seconds: number, each?: (t: number) => void) => void;
  settle: () => void;
}

async function rig(pos: [number, number] = [0, 0], heading = 0): Promise<Rig> {
  const physics = await createPhysics();
  physics.addGroundPlane();
  const car = new VehicleBody(physics, { pos, heading });
  const run = (seconds: number, each?: (t: number) => void) => {
    const n = Math.round(seconds / H);
    for (let i = 0; i < n; i++) {
      each?.(i * H);
      physics.stepOnce(H);
    }
  };
  const settle = () => run(1.5);
  return { physics, car, run, settle };
}

/** Put the car in D with the engine running, handbrake off (the way a driver would). */
function ready(car: VehicleBody): void {
  car.setControls({ brake: 1 });
  expect(car.toggleIgnition()).toBe(true);
  expect(car.requestGear('D')).toBe(true);
  car.setHandbrake(false);
  car.setControls({ brake: 0 });
}

describe('VehicleBody — rest and controls', () => {
  let r: Rig;
  beforeAll(async () => {
    r = await rig();
  });

  it('settles on its wheels at the computed ride height without bouncing', () => {
    r.settle();
    const y = r.car.position.y;
    expect(Math.abs(y - r.car.restHeight)).toBeLessThan(0.04);
    expect(r.car.wheels.every((w) => w.contact)).toBe(true);
    // no residual vertical motion (position-based: Rapier's post-step linvel still holds this
    // step's gravity increment, which the suspension cancels at the start of the next step)
    let minY = Infinity;
    let maxY = -Infinity;
    r.run(1, () => {
      minY = Math.min(minY, r.car.position.y);
      maxY = Math.max(maxY, r.car.position.y);
    });
    expect(maxY - minY).toBeLessThan(0.005);
    expect(r.car.state.speed).toBe(0);
    expect(r.car.state.gear).toBe('P');
    expect(r.car.state.handbrake).toBe(true);
    expect(r.car.state.engineOn).toBe(false);
  });

  it('starts only with the brake pressed in P or N; leaving P needs the brake', () => {
    expect(r.car.toggleIgnition()).toBe(false); // no brake
    r.car.setControls({ brake: 1 });
    expect(r.car.toggleIgnition()).toBe(true);
    expect(r.car.state.engineOn).toBe(true);
    expect(r.car.toggleIgnition()).toBe(true); // off again
    r.car.setControls({ brake: 0 });
    expect(r.car.requestGear('D')).toBe(false); // shift lock
    r.car.setControls({ brake: 0.5 });
    expect(r.car.requestGear('D')).toBe(true);
    expect(r.car.requestGear('R')).toBe(true); // stationary → fine
    expect(r.car.requestGear('P')).toBe(true);
    expect(r.car.cycleGear(1).gear).toBe('R');
    expect(r.car.cycleGear(1).gear).toBe('N');
    expect(r.car.cycleGear(-1).gear).toBe('R');
    r.car.requestGear('P');
    r.car.setControls({ brake: 0 });
  });

  it('stays put in P and with the handbrake on even in D with the engine running', () => {
    ready(r.car);
    r.car.setHandbrake(true);
    const x0 = r.car.position.x;
    r.run(3);
    expect(Math.abs(r.car.position.x - x0)).toBeLessThan(0.1);
    r.car.requestGear('P');
    r.car.setHandbrake(false);
    r.car.setControls({ throttle: 1 });
    r.run(2);
    expect(Math.abs(r.car.position.x - x0)).toBeLessThan(0.1);
    r.car.setControls({ throttle: 0 });
  });
});

describe('VehicleBody — performance envelope', () => {
  it('accelerates 0→50 km/h in ≈ 6–7 s at full throttle (and > 40 km/h after 4 s)', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    r.car.setControls({ throttle: 1 });
    let t50 = -1;
    let v4 = 0;
    let t = 0;
    r.run(12, () => {
      if (t50 < 0 && r.car.state.speed >= kmhToMps(50)) t50 = t;
      if (Math.abs(t - 4) < H / 2) v4 = r.car.state.speed;
      t += H;
    });
    expect(mpsToKmh(v4)).toBeGreaterThan(40);
    expect(t50).toBeGreaterThan(5.2);
    expect(t50).toBeLessThan(7.6);
    expect(r.car.state.rpm).toBeGreaterThan(1500);
    expect(r.car.drivetrain.gearIndex).toBeGreaterThanOrEqual(3);
    // heading held straight
    expect(Math.abs(angleDiff(0, r.car.state.heading))).toBeLessThan(0.02);
  });

  it('stops from 50 km/h in ≈ 14–16 m at full brake', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    r.car.setControls({ throttle: 1 });
    r.run(0.5);
    // exact entry speed: set the velocity directly (east = +x)
    r.car.body.setLinvel({ x: kmhToMps(50), y: 0, z: 0 }, true);
    r.run(0.1);
    r.car.setControls({ throttle: 0, brake: 1 });
    const x0 = r.car.position.x;
    let stopped = -1;
    let t = 0;
    r.run(6, () => {
      if (stopped < 0 && Math.abs(r.car.state.speed) < 0.1) stopped = t;
      t += H;
    });
    const d = r.car.position.x - x0;
    expect(stopped).toBeGreaterThan(0);
    expect(stopped).toBeLessThan(3);
    expect(d).toBeGreaterThan(12.5);
    expect(d).toBeLessThan(17);
    expect(Math.abs(r.car.state.speed)).toBeLessThan(0.1);
  });

  it('creeps at ≈ 6 km/h in D with no pedals, and backwards in R', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    r.run(10);
    expect(mpsToKmh(r.car.state.speed)).toBeGreaterThan(4);
    expect(mpsToKmh(r.car.state.speed)).toBeLessThan(8);
    r.car.setControls({ brake: 1 });
    r.run(3);
    expect(Math.abs(r.car.state.speed)).toBeLessThan(0.05);
    expect(r.car.requestGear('R')).toBe(true);
    r.car.setControls({ brake: 0 });
    r.run(8);
    expect(mpsToKmh(r.car.state.speed)).toBeLessThan(-4);
    expect(mpsToKmh(r.car.state.speed)).toBeGreaterThan(-8);
  });

  it('reverses under throttle and refuses R/P while moving', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    r.car.setControls({ brake: 1 });
    r.car.requestGear('R');
    r.car.setControls({ brake: 0, throttle: 0.5 });
    r.run(3);
    expect(r.car.state.speed).toBeLessThan(-2);
    expect(r.car.position.x).toBeLessThan(-2); // moved west while facing east
    expect(r.car.requestGear('P')).toBe(false);
    expect(r.car.requestGear('N')).toBe(true); // N is always allowed
    expect(r.car.requestGear('R')).toBe(false);
    expect(r.car.state.gear).toBe('N');
  });

  it('turns right when steering right and completes a low-speed U-turn within ≈ 11 m', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    const h0 = r.car.state.heading;
    const x0 = r.car.position.x;
    const z0 = r.car.position.z;
    let turned = 0;
    let prevH = h0;
    let doneAt: { x: number; z: number } | null = null;
    r.run(25, () => {
      const v = r.car.state.speed;
      r.car.setControls({ steer: 1, throttle: Math.max(0, Math.min(0.6, 0.25 + (2.5 - v) * 0.4)) });
      turned += angleDiff(prevH, r.car.state.heading);
      prevH = r.car.state.heading;
      if (!doneAt && turned >= Math.PI) doneAt = { x: r.car.position.x, z: r.car.position.z };
    });
    expect(turned).toBeGreaterThan(Math.PI); // heading increased = clockwise = right turn
    expect(doneAt).not.toBeNull();
    // facing east at the start, a right U-turn ends displaced to the south (+z)
    const lateral = doneAt!.z - z0;
    expect(lateral).toBeGreaterThan(5);
    expect(lateral).toBeLessThan(11);
    expect(Math.abs(doneAt!.x - x0)).toBeLessThan(8);
  });

  it('is stable at 90 km/h: a lane-change wiggle and even full lock do not roll the car', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    r.car.body.setLinvel({ x: kmhToMps(90), y: 0, z: 0 }, true);
    r.car.setControls({ throttle: 0.6 });
    let minUp = 1;
    const upY = () => {
      const q = r.car.quaternion;
      return 1 - 2 * (q.x * q.x + q.z * q.z);
    };
    r.run(1.5, () => {
      r.car.setControls({ steer: 0.35 });
      minUp = Math.min(minUp, upY());
    });
    r.run(1.5, () => {
      r.car.setControls({ steer: -0.35 });
      minUp = Math.min(minUp, upY());
    });
    expect(minUp).toBeGreaterThan(0.95);
    expect(r.car.state.speed).toBeGreaterThan(kmhToMps(60));
    r.run(4, () => {
      r.car.setControls({ steer: 1 });
      minUp = Math.min(minUp, upY());
    });
    expect(minUp).toBeGreaterThan(0.8);
    expect(r.car.position.y).toBeLessThan(2);
  });

  it('engine braking slows the car gently when coasting in D', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    r.car.body.setLinvel({ x: kmhToMps(50), y: 0, z: 0 }, true);
    r.run(0.1);
    r.car.setControls({ throttle: 0 });
    const v0 = r.car.state.speed;
    r.run(3);
    const v1 = r.car.state.speed;
    const decel = (v0 - v1) / 3;
    expect(decel).toBeGreaterThan(0.3);
    expect(decel).toBeLessThan(1.6);
  });
});

describe('VehicleBody — interventions, collisions and world colliders', () => {
  it('dual-control brake overrides the throttle for the requested time', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    r.car.body.setLinvel({ x: 10, y: 0, z: 0 }, true);
    r.car.setControls({ throttle: 1 });
    r.car.applyExternalBrake(1.5);
    expect(r.car.externalBrakeActive).toBe(true);
    r.run(1.4);
    expect(r.car.state.brake).toBe(1); // the instructor's pedal shows on the state
    expect(r.car.state.throttle).toBe(0);
    expect(Math.abs(r.car.state.speed)).toBeLessThan(1.5);
    r.run(0.2);
    expect(r.car.externalBrakeActive).toBe(false);
    expect(r.car.state.brake).toBe(0); // pedal state reflects the driver again
    r.run(1.5);
    expect(r.car.state.speed).toBeGreaterThan(1.5); // the driver's throttle works again
  });

  it('reports a collision with a dynamic obstacle and pushes it', async () => {
    const r = await rig();
    r.settle();
    const cone = r.physics.addDynamicObstacle([8, 0.35, 0], [0.4, 0.7, 0.4], { id: 'cone-1' });
    r.run(0.5);
    const hits: CollisionRecord[] = [];
    r.physics.onCollision((rec) => hits.push(rec));
    ready(r.car);
    r.car.setControls({ throttle: 1 });
    r.run(4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.with).toBe('object');
    expect(hits[0]!.id).toBe('cone-1');
    expect(hits[0]!.impulse).toBeGreaterThan(0);
    expect(Math.abs(hits[0]!.pos[0] - 8)).toBeLessThan(3);
    expect(cone.translation().x).toBeGreaterThan(8.5);
  });

  it('instantiates world colliders around the focus only and reports mounting a kerb', async () => {
    const physics = await createPhysics();
    physics.addGroundPlane();
    const world = buildTrainingGround();
    physics.addWorldColliders(world);
    expect(physics.activeColliderCount).toBe(0);
    const spawn = world.spawnPoints.find((s) => s.id === 'tg_start')!;
    physics.setFocus(spawn.pos);
    const near = physics.activeColliderCount;
    expect(near).toBeGreaterThan(20);
    physics.setFocus([5000, 5000]);
    expect(physics.activeColliderCount).toBe(0);
    physics.setFocus(spawn.pos);
    expect(physics.activeColliderCount).toBe(near);

    const car = new VehicleBody(physics, { pos: spawn.pos, heading: spawn.heading });
    const hits: CollisionRecord[] = [];
    physics.onCollision((rec) => hits.push(rec));
    for (let i = 0; i < 90; i++) physics.stepOnce(H);
    ready(car);
    // drift right towards the kerb at walking pace
    for (let i = 0; i < 60 * 8; i++) {
      car.setControls({ steer: 0.35, throttle: 0.3 });
      physics.stepOnce(H);
      if (hits.length) break;
    }
    expect(hits.some((h) => h.with === 'kerb')).toBe(true);
    const kerb = hits.find((h) => h.with === 'kerb')!;
    expect(kerb.id.startsWith('wheel:')).toBe(true);
    expect(kerb.impulse).toBeGreaterThan(0);
  });

  it('indicator self-cancels after the turn and the flag is consumed once', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    expect(r.car.requestIndicator('right')).toBe(true);
    expect(r.car.state.indicator).toBe('right');
    let turned = 0;
    let prevH = r.car.state.heading;
    r.run(14, () => {
      const v = r.car.state.speed;
      r.car.setControls({ steer: turned < Math.PI / 2.5 ? 1 : 0, throttle: Math.max(0, Math.min(0.5, 0.25 + (2.5 - v) * 0.4)) });
      turned += angleDiff(prevH, r.car.state.heading);
      prevH = r.car.state.heading;
    });
    expect(turned).toBeGreaterThan(Math.PI / 3);
    expect(r.car.state.indicator).toBe('off');
    expect(r.car.consumeAutoCancel()).toBe(true);
    expect(r.car.consumeAutoCancel()).toBe(false);
  });

  it('teleports and respawns cleanly', async () => {
    const r = await rig();
    r.settle();
    ready(r.car);
    r.car.setControls({ throttle: 1 });
    r.run(3);
    r.car.teleport([100, 50], Math.PI / 2, { engineOn: true, gear: 'D', handbrake: false });
    r.run(0.5);
    expect(Math.abs(r.car.position.x - 100)).toBeLessThan(0.5);
    expect(Math.abs(r.car.position.z - 50)).toBeLessThan(1.5); // may creep a little in D
    expect(Math.abs(angleDiff(Math.PI / 2, r.car.state.heading))).toBeLessThan(0.05);
    expect(r.car.state.engineOn).toBe(true);
    expect(r.car.state.gear).toBe('D');
    r.car.setControls({ throttle: 0.5 });
    r.run(2);
    r.car.respawn();
    r.run(0.2);
    expect(Math.abs(r.car.position.x - 100)).toBeLessThan(0.5);
    expect(Math.abs(r.car.state.speed)).toBeLessThan(0.5);
  });
});
