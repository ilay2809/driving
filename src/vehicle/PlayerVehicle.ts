/**
 * PlayerVehicle — the `System` that owns the player's car: steps the physics with
 * the frame's dt (FixedStep, 60 Hz), applies the InputState, drives the visual model
 * and publishes the vehicle events on the EventBus.
 *
 * ctx.player is MUTATED IN PLACE every update (field-by-field copy, the `pos` array
 * included), so other systems may keep a reference to it.
 *
 * Events published: 'vehicle:gear' (also when a selection is refused, with the
 * unchanged gear, so the UI can flash), 'vehicle:indicator', 'vehicle:collision',
 * 'vehicle:horn', 'vehicle:tick'. Listens to 'coach:intervention' {kind:'brake'} and
 * 'coach:request' {kind:'brake'} (dual-control brake, 1.5 s) and 'sim:reset' (respawn).
 */
import * as THREE from 'three';
import type { EventBus } from '@/core/events';
import type { SimContext, System } from '@/core/sim';
import type { EnvironmentState, VehicleState } from '@/core/types';
import type { Vec2 } from '@/world/geo';
import { CarModel } from './CarModel';
import { indicatorLampOn } from './indicator';
import type { InputState, InputSystem } from './input';
import type { PhysicsWorld } from './physics';
import { VehicleBody, type SpawnOptions, type VehicleSpec } from './VehicleBody';

export interface PlayerVehicleOptions {
  colour?: number;
  spec?: Partial<VehicleSpec>;
  spawn?: SpawnOptions;
  /** Build the interior meshes (default true). */
  interior?: boolean;
}

export const DUAL_BRAKE_SECONDS = 1.5;

export function isNight(env: EnvironmentState): boolean {
  return env.hour < 6.25 || env.hour >= 17.75;
}

function copyState(src: VehicleState, dst: VehicleState): void {
  dst.pos[0] = src.pos[0];
  dst.pos[1] = src.pos[1];
  dst.y = src.y;
  dst.heading = src.heading;
  dst.speed = src.speed;
  dst.accel = src.accel;
  dst.yawRate = src.yawRate;
  dst.steering = src.steering;
  dst.throttle = src.throttle;
  dst.brake = src.brake;
  dst.handbrake = src.handbrake;
  dst.gear = src.gear;
  dst.rpm = src.rpm;
  dst.engineOn = src.engineOn;
  dst.indicator = src.indicator;
  dst.lights = src.lights;
  dst.wipers = src.wipers;
  dst.horn = src.horn;
  dst.seatbelt = src.seatbelt;
  dst.length = src.length;
  dst.width = src.width;
  dst.wheelbase = src.wheelbase;
}

export class PlayerVehicle implements System {
  readonly name = 'vehicle';
  readonly body: VehicleBody;
  readonly model: CarModel;
  /** Live pose of the body origin (for the CameraRig). */
  readonly pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private input: InputState | null = null;
  private inputSystem: InputSystem | null = null;
  private lastHandbrakeInput: boolean | null = null;
  private time = 0;
  private unsub: (() => void)[] = [];

  constructor(
    readonly physics: PhysicsWorld,
    readonly scene: THREE.Scene,
    readonly bus: EventBus,
    spawn: { pos: Vec2; heading: number },
    opts: PlayerVehicleOptions = {},
  ) {
    this.body = new VehicleBody(physics, spawn, opts.spec ?? {}, opts.spawn ?? {});
    this.model = new CarModel({ colour: opts.colour ?? 0x2f6fde, interior: opts.interior ?? true }, { spec: this.body.spec, restHeight: this.body.restHeight });
    scene.add(this.model.root);
    this.syncPose();
    this.unsub.push(
      physics.onCollision((rec) => {
        if (rec.with !== 'kerb' && rec.with !== 'vehicle' && rec.with !== 'pedestrian' && rec.with !== 'object' && rec.with !== 'building') return;
        bus.emit('vehicle:collision', { with: rec.with, impulse: rec.impulse, pos: rec.pos, time: this.time });
      }),
      bus.on('coach:intervention', (ev) => {
        if (ev.kind === 'brake') this.applyExternalBrake(DUAL_BRAKE_SECONDS);
      }),
      bus.on('coach:request', (req) => {
        if (req.kind === 'brake') this.applyExternalBrake(typeof req.payload.seconds === 'number' ? req.payload.seconds : DUAL_BRAKE_SECONDS);
      }),
      bus.on('sim:reset', () => this.respawn()),
    );
  }

  /** Feed an InputState for the next update (scripts / tests). */
  setInput(input: InputState | null): void {
    this.input = input;
  }

  /** Read `system.state` every update and keep its handbrake lever in sync on respawn. */
  bindInput(system: InputSystem | null): void {
    this.inputSystem = system;
    if (system) {
      system.setHandbrake(this.body.state.handbrake);
      this.lastHandbrakeInput = this.body.state.handbrake;
    }
  }

  get state(): VehicleState {
    return this.body.state;
  }

  get object(): THREE.Object3D {
    return this.model.root;
  }

  teleport(pos: Vec2, heading: number, opts?: SpawnOptions): void {
    this.body.teleport(pos, heading, opts);
    this.afterPlacement();
  }

  respawn(): void {
    this.body.respawn();
    this.afterPlacement();
  }

  private afterPlacement(): void {
    this.inputSystem?.setHandbrake(this.body.state.handbrake);
    this.lastHandbrakeInput = this.body.state.handbrake;
    this.syncPose();
  }

  applyExternalBrake(seconds: number): void {
    this.body.applyExternalBrake(seconds);
  }

  private applyInput(inp: InputState): void {
    const b = this.body;
    const t = this.time;
    b.setControls({ steer: inp.steer, throttle: inp.throttle, brake: inp.brake });
    if (this.lastHandbrakeInput === null) this.lastHandbrakeInput = inp.handbrake;
    else if (inp.handbrake !== this.lastHandbrakeInput) {
      b.setHandbrake(inp.handbrake);
      this.lastHandbrakeInput = inp.handbrake;
    }
    if (inp.ignitionToggle) b.toggleIgnition();
    if (inp.gearRequest) {
      b.requestGear(inp.gearRequest);
      this.bus.emit('vehicle:gear', { gear: b.state.gear, time: t });
    } else if (inp.gearCycle) {
      b.cycleGear(inp.gearCycle);
      this.bus.emit('vehicle:gear', { gear: b.state.gear, time: t });
    }
    if (inp.indicatorRequest && b.requestIndicator(inp.indicatorRequest)) {
      this.bus.emit('vehicle:indicator', { indicator: b.state.indicator, time: t });
    }
    if (inp.lightsToggle) b.cycleLights();
    if (inp.wipersToggle) b.toggleWipers();
    if (inp.seatbeltToggle) b.toggleSeatbelt();
    if (inp.horn && !b.state.horn) this.bus.emit('vehicle:horn', { time: t });
    b.setHorn(inp.horn);
  }

  update(ctx: SimContext): void {
    this.time = ctx.time;
    const b = this.body;
    const inp = this.inputSystem?.state ?? this.input;
    if (!ctx.paused) {
      b.time = ctx.time;
      if (inp) this.applyInput(inp);
      b.setGrip(ctx.env.wetRoad ? 0.72 : 1);
      this.physics.setFocus(b.state.pos);
      this.physics.advance(ctx.dt);
    }
    copyState(b.state, ctx.player);
    if (b.consumeAutoCancel()) this.bus.emit('vehicle:indicator', { indicator: 'off', time: ctx.time });
    this.syncPose();
    this.model.update(b.state, b.wheels, ctx.time, {
      lampOn: indicatorLampOn(ctx.time, b.indicators.since),
      night: isNight(ctx.env),
      autoGear: b.state.gear === 'D' ? b.drivetrain.gearIndex : undefined,
    });
    this.bus.emit('vehicle:tick', ctx.player);
  }

  private syncPose(): void {
    const p = this.body.position;
    const q = this.body.quaternion;
    this.pose.position.set(p.x, p.y, p.z);
    this.pose.quaternion.set(q.x, q.y, q.z, q.w);
    this.model.root.position.copy(this.pose.position);
    this.model.root.quaternion.copy(this.pose.quaternion);
  }

  dispose(): void {
    for (const off of this.unsub) off();
    this.unsub.length = 0;
    this.model.dispose();
    this.body.dispose();
  }
}
