/**
 * The player's car as a Rapier raycast vehicle + drivetrain + cabin controls, with NO
 * rendering dependencies so the whole driving model can be tuned and tested in node.
 *
 * Conventions (see src/world/geo.ts): chassis local forward is −z, right is +x, up +y.
 * Heading is derived from the body's forward vector; signed speed = velocity · forward.
 * The `state` object (VehicleState) is mutated in place every physics step.
 *
 * Raycast-vehicle semantics (Rapier port of Bullet's btRaycastVehicle):
 *  - suspension stiffness / damping are per kg of chassis mass;
 *  - `wheelBrake` is a per-step IMPULSE cap, so we pass force × h;
 *  - engine force and brake are mutually exclusive on a wheel (engine wins);
 *  - friction cap per wheel = suspension force × h × frictionSlip (≈ μ).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { defaultVehicleState } from '@/core/sim';
import type { Gear, Indicator, Lights, VehicleState } from '@/core/types';
import type { Vec2 } from '@/world/geo';
import { DEFAULT_DRIVETRAIN, Drivetrain, clamp, type DrivetrainOutput, type DrivetrainSpec } from './drivetrain';
import { IndicatorLogic } from './indicator';
import { quatFromHeading, type PhysicsWorld } from './physics';

export interface VehicleSpec {
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Suspension hard point height in the chassis frame (below the body origin). */
  hardpointY: number;
  suspensionRest: number;
  /** Per-kg values (Bullet convention). */
  suspensionStiffness: number;
  dampingCompression: number;
  dampingRelaxation: number;
  maxSuspensionTravel: number;
  maxSuspensionForce: number;
  /** ≈ tyre friction coefficient. */
  frictionSlip: number;
  sideFrictionStiffness: number;
  maxSteerRad: number;
  /** Steering rack rate (rad/s at the wheels). */
  steerRate: number;
  /** Centre of mass in the chassis frame. */
  com: { x: number; y: number; z: number };
  angularDamping: number;
  drivetrain: DrivetrainSpec;
}

export const DEFAULT_VEHICLE_SPEC: VehicleSpec = {
  length: 4.4,
  width: 1.8,
  height: 1.45,
  wheelbase: 2.6,
  track: 1.55,
  wheelRadius: 0.31,
  wheelWidth: 0.2,
  hardpointY: -0.1,
  suspensionRest: 0.3,
  suspensionStiffness: 24,
  dampingCompression: 3.0,
  dampingRelaxation: 4.6,
  maxSuspensionTravel: 0.25,
  maxSuspensionForce: 40000,
  frictionSlip: 1.35,
  sideFrictionStiffness: 1.0,
  maxSteerRad: (35 * Math.PI) / 180,
  steerRate: 3.2,
  com: { x: 0, y: -0.12, z: 0.05 },
  angularDamping: 0.35,
  drivetrain: DEFAULT_DRIVETRAIN,
};

export interface WheelPose {
  /** Wheel centre in the chassis frame. */
  x: number;
  y: number;
  z: number;
  /** Steer angle, positive = right (geo convention). */
  steer: number;
  /** Accumulated spin (rad), positive when rolling forward. */
  spin: number;
  contact: boolean;
  /** Friction-circle utilisation 0..1+ (≥ 1 = sliding). */
  slip: number;
  /** Current suspension compression 0..1 (for the camera bob). */
  compression: number;
}

export interface VehicleControls {
  steer: number;
  throttle: number;
  brake: number;
}

export interface SpawnOptions {
  engineOn?: boolean;
  gear?: Gear;
  handbrake?: boolean;
  seatbelt?: boolean;
}

const G = 9.81;
const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;

function rotateByQuat(q: { x: number; y: number; z: number; w: number }, v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export class VehicleBody {
  readonly spec: VehicleSpec;
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly colliders: RAPIER.Collider[] = [];
  readonly drivetrain: Drivetrain;
  readonly indicators = new IndicatorLogic();
  /** Public vehicle state — mutated in place each physics step. */
  readonly state: VehicleState;
  readonly controls: VehicleControls = { steer: 0, throttle: 0, brake: 0 };
  /** Simulation clock (synced by the owner to ctx.time before each frame). */
  time = 0;
  /** Body origin height above flat ground when the suspension is at rest. */
  readonly restHeight: number;
  /** Max friction-circle utilisation over all wheels (tyre squeal). */
  slip = 0;
  /** Wheel poses in the chassis frame (updated after each step). */
  readonly wheels: WheelPose[] = [];
  /** Steering wheel position actually reached by the rack, −1..1. */
  steerActual = 0;
  lastSpawn: { pos: Vec2; heading: number; opts: SpawnOptions };
  /** Last drivetrain output (debug / audio). */
  last: DrivetrainOutput | null = null;

  private steerAngle = 0;
  private prevSpeed = 0;
  private externalBrakeUntil = -1;
  private wheelGroundKind: (string | undefined)[] = [undefined, undefined, undefined, undefined];
  private autoCancelled = false;
  private upsideDownFor = 0;
  private offPre: () => void;
  private offPost: () => void;
  private grip = 1;
  private readonly excludeFromWheelRays: (c: RAPIER.Collider) => boolean;

  constructor(
    readonly physics: PhysicsWorld,
    spawn: { pos: Vec2; heading: number },
    spec: Partial<VehicleSpec> = {},
    opts: SpawnOptions = {},
  ) {
    this.spec = { ...DEFAULT_VEHICLE_SPEC, ...spec, drivetrain: { ...DEFAULT_DRIVETRAIN, ...(spec.drivetrain ?? {}) } };
    const s = this.spec;
    this.drivetrain = new Drivetrain(s.drivetrain);
    this.state = defaultVehicleState([spawn.pos[0], spawn.pos[1]], spawn.heading);
    this.state.length = s.length;
    this.state.width = s.width;
    this.state.wheelbase = s.wheelbase;
    this.lastSpawn = { pos: [spawn.pos[0], spawn.pos[1]], heading: spawn.heading, opts };

    // static compression at rest: k·Δ·m per wheel = m·g/4  →  Δ = g / (4k)
    const sag = G / (4 * s.suspensionStiffness);
    this.restHeight = -s.hardpointY + (s.suspensionRest - sag) + s.wheelRadius;

    const world = physics.world;
    const m = s.drivetrain.mass;
    const ixx = (m / 12) * (s.height * s.height + s.length * s.length);
    const iyy = (m / 12) * (s.width * s.width + s.length * s.length);
    const izz = (m / 12) * (s.width * s.width + s.height * s.height);
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.pos[0], this.restHeight + 0.05, spawn.pos[1])
      .setRotation(quatFromHeading(spawn.heading))
      .setAdditionalMassProperties(m, s.com, { x: ixx, y: iyy, z: izz }, { x: 0, y: 0, z: 0, w: 1 })
      .setAngularDamping(s.angularDamping)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bodyDesc);

    // lower body (bumper height) + cabin; density 0 so the explicit mass properties rule
    const groundClear = 0.25;
    const lowerTop = 0.85;
    const lower = RAPIER.ColliderDesc.cuboid(s.width / 2, (lowerTop - groundClear) / 2, s.length / 2)
      .setTranslation(0, (lowerTop + groundClear) / 2 - this.restHeight, 0)
      .setDensity(0)
      .setFriction(0.5)
      .setRestitution(0.1);
    const cabin = RAPIER.ColliderDesc.cuboid(s.width / 2 - 0.12, (s.height - lowerTop) / 2, s.length / 4)
      .setTranslation(0, (s.height + lowerTop) / 2 - this.restHeight, 0.2)
      .setDensity(0)
      .setFriction(0.5);
    for (const d of [lower, cabin]) {
      const c = world.createCollider(d, this.body);
      physics.registerPlayerCollider(c);
      this.colliders.push(c);
    }

    this.controller = world.createVehicleController(this.body);
    const half = s.track / 2;
    const hp = [
      { x: -half, z: -s.wheelbase / 2 },
      { x: half, z: -s.wheelbase / 2 },
      { x: -half, z: s.wheelbase / 2 },
      { x: half, z: s.wheelbase / 2 },
    ];
    hp.forEach((p, i) => {
      this.controller.addWheel({ x: p.x, y: s.hardpointY, z: p.z }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, s.suspensionRest, s.wheelRadius);
      this.controller.setWheelSuspensionStiffness(i, s.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, s.dampingCompression);
      this.controller.setWheelSuspensionRelaxation(i, s.dampingRelaxation);
      this.controller.setWheelMaxSuspensionTravel(i, s.maxSuspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, s.maxSuspensionForce);
      this.controller.setWheelFrictionSlip(i, s.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, s.sideFrictionStiffness);
      this.wheels.push({ x: p.x, y: s.hardpointY - s.suspensionRest + sag, z: p.z, steer: 0, spin: 0, contact: false, slip: 0, compression: 0 });
    });

    // wheel rays ignore pushable objects, other road users and the car itself
    this.excludeFromWheelRays = (c: RAPIER.Collider) => {
      const t = physics.tagOf(c.handle);
      return !t || (t.kind !== 'object' && t.kind !== 'vehicle' && t.kind !== 'pedestrian' && t.kind !== 'player');
    };

    this.applySpawnOptions(opts);
    this.offPre = physics.onPreStep((h) => this.fixedUpdate(h));
    this.offPost = physics.onPostStep((h) => this.afterStep(h));
  }

  // ---- cabin controls -------------------------------------------------------------

  setControls(c: Partial<VehicleControls>): void {
    if (c.steer !== undefined) this.controls.steer = clamp(c.steer, -1, 1);
    if (c.throttle !== undefined) this.controls.throttle = clamp(c.throttle, 0, 1);
    if (c.brake !== undefined) this.controls.brake = clamp(c.brake, 0, 1);
  }

  /** Engine start needs the brake pressed and the lever in P or N. Returns true when the state changed. */
  toggleIgnition(): boolean {
    const st = this.state;
    if (st.engineOn) {
      st.engineOn = false;
      return true;
    }
    if ((st.gear === 'P' || st.gear === 'N') && this.controls.brake > 0.3) {
      st.engineOn = true;
      return true;
    }
    return false;
  }

  setEngine(on: boolean): void {
    this.state.engineOn = on;
  }

  /**
   * Gear lever. R and P engage only below 1 m/s; leaving P needs the brake pressed
   * (shift lock). Returns whether the gear changed — the owner emits 'vehicle:gear'
   * either way so the UI can flash a refused selection.
   */
  requestGear(g: Gear): boolean {
    const st = this.state;
    if (g === st.gear) return false;
    const vAbs = Math.abs(st.speed);
    if ((g === 'R' || g === 'P') && vAbs > 1) return false;
    if (st.gear === 'P' && this.controls.brake < 0.2 && this.externalBrakeUntil < this.time) return false;
    st.gear = g;
    if (g !== 'D') this.drivetrain.gearIndex = 1;
    return true;
  }

  /** Cycle the lever one notch along P-R-N-D (+1 = towards D). */
  cycleGear(dir: 1 | -1): { gear: Gear; changed: boolean } {
    const order: Gear[] = ['P', 'R', 'N', 'D'];
    const i = clamp(order.indexOf(this.state.gear) + dir, 0, 3);
    const g = order[i]!;
    return { gear: g, changed: this.requestGear(g) };
  }

  setHandbrake(on: boolean): void {
    this.state.handbrake = on;
  }

  toggleHandbrake(): boolean {
    this.state.handbrake = !this.state.handbrake;
    return this.state.handbrake;
  }

  requestIndicator(req: Indicator): boolean {
    const changed = this.indicators.request(req, this.state.heading, this.time);
    if (changed) this.state.indicator = this.indicators.indicator;
    return changed;
  }

  cycleLights(): Lights {
    const order: Lights[] = ['off', 'parking', 'low', 'high'];
    this.state.lights = order[(order.indexOf(this.state.lights) + 1) % order.length]!;
    return this.state.lights;
  }

  setLights(l: Lights): void {
    this.state.lights = l;
  }

  toggleWipers(): boolean {
    this.state.wipers = !this.state.wipers;
    return this.state.wipers;
  }

  setHorn(on: boolean): void {
    this.state.horn = on;
  }

  toggleSeatbelt(): boolean {
    this.state.seatbelt = !this.state.seatbelt;
    return this.state.seatbelt;
  }

  /** Dual-control brake: full brake, throttle ignored, for `seconds`. */
  applyExternalBrake(seconds: number): void {
    this.externalBrakeUntil = Math.max(this.externalBrakeUntil, this.time + seconds);
  }

  get externalBrakeActive(): boolean {
    return this.externalBrakeUntil > this.time;
  }

  /** Scale tyre grip (1 = dry; ~0.7 = wet). */
  setGrip(factor: number): void {
    if (factor === this.grip) return;
    this.grip = factor;
    for (let i = 0; i < 4; i++) this.controller.setWheelFrictionSlip(i, this.spec.frictionSlip * factor);
  }

  /** True once after an indicator self-cancelled (consumed on read). */
  consumeAutoCancel(): boolean {
    const v = this.autoCancelled;
    this.autoCancelled = false;
    return v;
  }

  // ---- placement -------------------------------------------------------------------

  teleport(pos: Vec2, heading: number, opts?: SpawnOptions): void {
    this.body.setTranslation({ x: pos[0], y: this.restHeight + 0.05, z: pos[1] }, true);
    this.body.setRotation(quatFromHeading(heading), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.drivetrain.reset();
    this.steerAngle = 0;
    this.prevSpeed = 0;
    this.externalBrakeUntil = -1;
    this.upsideDownFor = 0;
    const st = this.state;
    st.pos = [pos[0], pos[1]];
    st.heading = heading;
    st.speed = 0;
    st.accel = 0;
    st.yawRate = 0;
    this.indicators.reset(heading);
    st.indicator = 'off';
    this.lastSpawn = { pos: [pos[0], pos[1]], heading, opts: opts ?? this.lastSpawn.opts };
    this.applySpawnOptions(this.lastSpawn.opts);
  }

  respawn(): void {
    this.teleport(this.lastSpawn.pos, this.lastSpawn.heading, this.lastSpawn.opts);
  }

  private applySpawnOptions(o: SpawnOptions): void {
    const st = this.state;
    st.gear = o.gear ?? 'P';
    st.handbrake = o.handbrake ?? true;
    st.engineOn = o.engineOn ?? false;
    st.seatbelt = o.seatbelt ?? false;
    st.horn = false;
    this.drivetrain.gearIndex = 1;
  }

  // ---- physics ----------------------------------------------------------------------

  private fixedUpdate(h: number): void {
    const s = this.spec;
    const st = this.state;
    this.time += h;
    let throttle = this.controls.throttle;
    let brake = this.controls.brake;
    if (this.externalBrakeUntil > this.time) {
      brake = 1;
      throttle = 0;
    }
    const speed = st.speed;
    const vAbs = Math.abs(speed);

    // steering: speed-sensitive lock (keeps 90 km/h stable) + rack rate limit + Ackermann
    const lockScale = clamp(1 - (0.75 * (vAbs - 4)) / 26, 0.25, 1);
    const target = this.controls.steer * s.maxSteerRad * lockScale;
    const maxDelta = s.steerRate * h;
    this.steerAngle += clamp(target - this.steerAngle, -maxDelta, maxDelta);
    const delta = this.steerAngle;
    let left = delta;
    let right = delta;
    if (Math.abs(delta) > 1e-4) {
      const R = s.wheelbase / Math.tan(Math.abs(delta));
      const inner = Math.atan(s.wheelbase / Math.max(0.5, R - s.track / 2));
      const outer = Math.atan(s.wheelbase / (R + s.track / 2));
      if (delta > 0) {
        right = inner;
        left = outer;
      } else {
        left = -inner;
        right = -outer;
      }
    }
    // Rapier: positive wheel steering turns the wheel to the LEFT (axle +x rotated about +y)
    this.controller.setWheelSteering(0, -left);
    this.controller.setWheelSteering(1, -right);

    const out = this.drivetrain.update(h, { lever: st.gear, throttle, brake, handbrake: st.handbrake, engineOn: st.engineOn, speed });
    this.last = out;

    // wheels: front driven; brake is an impulse cap per step; ABS = never exceed the friction circle
    const mu = s.frictionSlip * this.grip;
    for (let i = 0; i < 4; i++) {
      const inContact = this.controller.wheelIsInContact(i);
      const load = this.controller.wheelSuspensionForce(i) ?? 0;
      const frictionCap = Math.max(0, load) * h * mu * 0.95;
      let engine = 0;
      let brakeImp = 0;
      if (i < 2 && out.driveForce !== 0) engine = out.driveForce / 2;
      else if (inContact) brakeImp = Math.min(out.brakeForces[i]! * h, Math.max(frictionCap, st.gear === 'P' ? out.brakeForces[i]! * h : 0));
      this.controller.setWheelEngineForce(i, engine);
      this.controller.setWheelBrake(i, brakeImp);
    }

    // rolling resistance + aero drag on the body, against the horizontal velocity.
    // (one-shot impulse: Rapier's addForce is persistent and would accumulate)
    const lin = this.body.linvel();
    const vh = Math.hypot(lin.x, lin.z);
    if (vh > 0.05 && out.resistance > 0) {
      // never let the resistance impulse reverse the velocity within the step
      const imp = Math.min(out.resistance * h, vh * s.drivetrain.mass * 0.5) / vh;
      this.body.applyImpulse({ x: -lin.x * imp, y: 0, z: -lin.z * imp }, true);
    }

    this.controller.updateVehicle(h, undefined, undefined, this.excludeFromWheelRays);

    st.throttle = throttle;
    st.brake = brake;
    st.rpm = out.rpm;
  }

  private afterStep(h: number): void {
    const s = this.spec;
    const st = this.state;
    const t = this.body.translation();
    const q = this.body.rotation();
    const fwd = rotateByQuat(q, { x: 0, y: 0, z: -1 });
    const up = rotateByQuat(q, { x: 0, y: 1, z: 0 });
    const lin = this.body.linvel();
    const ang = this.body.angvel();
    const heading = Math.atan2(fwd.z, fwd.x);
    const speed = lin.x * fwd.x + lin.y * fwd.y + lin.z * fwd.z;
    const accelRaw = (speed - this.prevSpeed) / h;
    this.prevSpeed = speed;

    st.pos[0] = t.x;
    st.pos[1] = t.z;
    st.y = t.y - this.restHeight;
    st.heading = heading;
    st.speed = Math.abs(speed) < 0.01 ? 0 : speed;
    st.accel += (accelRaw - st.accel) * Math.min(1, h / 0.1);
    st.yawRate = -ang.y; // heading grows clockwise (east→south) while rotation.y decreases
    this.steerActual = this.steerAngle / s.maxSteerRad;
    st.steering = this.steerActual;

    // wheel poses, slip and kerb mounting
    let maxSlip = 0;
    const mu = s.frictionSlip * this.grip;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      const len = this.controller.wheelSuspensionLength(i) ?? s.suspensionRest;
      w.y = s.hardpointY - len;
      w.steer = -(this.controller.wheelSteering(i) ?? 0);
      w.spin = this.controller.wheelRotation(i) ?? 0;
      w.contact = this.controller.wheelIsInContact(i);
      w.compression = clamp((s.suspensionRest - len) / s.maxSuspensionTravel, -1, 1);
      const load = this.controller.wheelSuspensionForce(i) ?? 0;
      const cap = load * h * mu;
      const f = this.controller.wheelForwardImpulse(i) ?? 0;
      const sd = this.controller.wheelSideImpulse(i) ?? 0;
      w.slip = cap > 1e-6 && w.contact ? Math.hypot(0.5 * f, sd) / cap : 0;
      if (w.slip > maxSlip) maxSlip = w.slip;

      const ground = w.contact ? this.controller.wheelGroundObject(i) : null;
      const kind = ground ? this.physics.tagOf(ground.handle)?.kind : undefined;
      if (kind === 'kerb' && this.wheelGroundKind[i] !== 'kerb') {
        const cp = this.controller.wheelContactPoint(i);
        this.physics.reportCollision({
          with: 'kerb',
          id: `wheel:${WHEEL_NAMES[i]}`,
          impulse: (s.drivetrain.mass / 4) * Math.max(0.4, Math.abs(st.speed)),
          pos: cp ? [cp.x, cp.z] : [t.x, t.z],
        });
      }
      this.wheelGroundKind[i] = kind;
    }
    this.slip = Math.abs(st.speed) > 0.5 ? maxSlip : 0;

    if (this.indicators.update(heading, st.steering)) {
      st.indicator = 'off';
      this.autoCancelled = true;
    }

    // safety net: rolled over or fell through the world → put the car back on its wheels
    if (up.y < 0.2) this.upsideDownFor += h;
    else this.upsideDownFor = 0;
    if (this.upsideDownFor > 2.5 || t.y < -20) {
      this.teleport([t.x, t.z], heading, this.lastSpawn.opts);
      this.state.engineOn = true;
    }
  }

  /** Pose for the visual model / camera. */
  get position(): { x: number; y: number; z: number } {
    return this.body.translation();
  }

  get quaternion(): { x: number; y: number; z: number; w: number } {
    return this.body.rotation();
  }

  dispose(): void {
    this.offPre();
    this.offPost();
    this.controller.free();
    this.physics.world.removeRigidBody(this.body);
  }
}
