/**
 * CameraRig — driver's point of view (left seat, Israeli LHD car) with free look,
 * quick mirror / shoulder glances, subtle speed bob, and a chase camera toggle.
 *
 * Conventions: the car's local forward is −z, right is +x (see geo.ts). "Look right"
 * is a rotation of −θ about +y (three.js), "look up" is +θ about +x.
 */
import * as THREE from 'three';
import type { GlanceTarget, VehicleState } from '@/core/types';
import { headingToRotationY } from '@/world/geo';

export type CameraMode = 'pov' | 'chase';

export interface CameraRigOptions {
  /** Eye position relative to the car centre at ground level: x right, y up, z forward (+ = ahead). */
  eye: { x: number; y: number; z: number };
  /** Height of the body origin above the ground when a pose is supplied. */
  originHeight: number;
  fov: number;
  near: number;
  far: number;
  /** Free-look limits (rad). */
  yawMax: number;
  pitchMax: number;
  chaseDistance: number;
  chaseHeight: number;
}

export const DEFAULT_CAMERA_OPTIONS: CameraRigOptions = {
  eye: { x: -0.37, y: 1.15, z: 0.3 },
  originHeight: 0.6,
  fov: 72,
  near: 0.1,
  far: 2500,
  yawMax: (120 * Math.PI) / 180,
  pitchMax: (40 * Math.PI) / 180,
  chaseDistance: 7,
  chaseHeight: 2.6,
};

interface GlancePreset {
  yaw: number; // positive = right
  pitch: number; // positive = up
  seconds: number;
}

const DEG = Math.PI / 180;

/** Where the head turns for each glance (yaw positive = right). */
export const GLANCE_PRESETS: Record<GlanceTarget, GlancePreset> = {
  left_mirror: { yaw: -37 * DEG, pitch: -9 * DEG, seconds: 0.6 },
  rear_mirror: { yaw: 32 * DEG, pitch: 7 * DEG, seconds: 0.6 },
  right_mirror: { yaw: 59 * DEG, pitch: -6 * DEG, seconds: 0.6 },
  left_shoulder: { yaw: -110 * DEG, pitch: -2 * DEG, seconds: 0.7 },
  right_shoulder: { yaw: 110 * DEG, pitch: -2 * DEG, seconds: 0.7 },
  ahead: { yaw: 0, pitch: 0, seconds: 0.3 },
};

export interface CameraInput {
  lookYaw: number;
  lookPitch: number;
  glance?: GlanceTarget;
  chaseToggle?: boolean;
}

export interface CarPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _offset = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _target = new THREE.Vector3();

export class CameraRig {
  mode: CameraMode = 'pov';
  readonly opts: CameraRigOptions;
  /** Current head yaw / pitch (rad). */
  headYaw = 0;
  headPitch = 0;
  private glanceUntil = -1;
  private glanceTarget: GlancePreset | null = null;
  private t = 0;
  private bobPhase = 0;
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  private extraPitch = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    opts: Partial<CameraRigOptions> = {},
  ) {
    this.opts = { ...DEFAULT_CAMERA_OPTIONS, ...opts, eye: { ...DEFAULT_CAMERA_OPTIONS.eye, ...(opts.eye ?? {}) } };
    camera.fov = this.opts.fov;
    camera.near = this.opts.near;
    camera.far = this.opts.far;
    camera.updateProjectionMatrix();
  }

  glance(target: GlanceTarget): void {
    const p = GLANCE_PRESETS[target];
    this.glanceTarget = p;
    this.glanceUntil = this.t + p.seconds;
  }

  toggleChase(): void {
    this.mode = this.mode === 'pov' ? 'chase' : 'pov';
    this.chaseInit = false;
  }

  /**
   * @param pose optional live body pose (position + quaternion of the car origin). Without
   *   it the camera is placed from the VehicleState (flat: no pitch / roll).
   */
  update(dt: number, state: VehicleState, input: CameraInput, pose?: CarPose): void {
    this.t += dt;
    if (input.chaseToggle) this.toggleChase();
    if (input.glance) this.glance(input.glance);

    // car frame
    if (pose) {
      _pos.copy(pose.position);
      _q.copy(pose.quaternion);
      _offset.set(this.opts.eye.x, this.opts.eye.y - this.opts.originHeight, -this.opts.eye.z);
    } else {
      _pos.set(state.pos[0], state.y, state.pos[1]);
      _q.setFromAxisAngle(_up, headingToRotationY(state.heading));
      _offset.set(this.opts.eye.x, this.opts.eye.y, -this.opts.eye.z);
    }

    if (this.mode === 'chase') {
      this.updateChase(dt, state);
      return;
    }

    // head target: glance preset wins, then free look, then centre
    let yawT = input.lookYaw * this.opts.yawMax;
    let pitchT = input.lookPitch * this.opts.pitchMax;
    let tau: number;
    if (this.glanceTarget && this.t < this.glanceUntil) {
      yawT = this.glanceTarget.yaw;
      pitchT = this.glanceTarget.pitch;
      tau = 0.07;
    } else {
      this.glanceTarget = null;
      if (Math.abs(input.lookYaw) < 0.01 && Math.abs(input.lookPitch) < 0.01) tau = 0.22; // ease back to centre
      else tau = 0.09;
    }
    const k = Math.min(1, dt / tau);
    this.headYaw += (yawT - this.headYaw) * k;
    this.headPitch += (pitchT - this.headPitch) * k;

    // subtle bob / shake with speed, and a nod under acceleration / braking
    const speed = Math.abs(state.speed);
    const amp = 0.002 + 0.005 * Math.min(1, speed / 22);
    this.bobPhase += dt * (1.6 + speed * 0.12) * Math.PI * 2;
    const bobY = Math.sin(this.bobPhase) * amp + Math.sin(this.bobPhase * 2.37) * amp * 0.4;
    const bobX = Math.sin(this.bobPhase * 0.53) * amp * 0.5;
    const pitchNod = THREE.MathUtils.clamp(-state.accel * 0.006, -0.03, 0.03);
    this.extraPitch += (pitchNod - this.extraPitch) * Math.min(1, dt / 0.25);

    _offset.x += bobX;
    _offset.y += bobY;
    _offset.applyQuaternion(_q);
    this.camera.position.copy(_pos).add(_offset);

    _qYaw.setFromAxisAngle(_up, -this.headYaw);
    _qPitch.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.headPitch + this.extraPitch);
    this.camera.quaternion.copy(_q).multiply(_qYaw).multiply(_qPitch);
  }

  private updateChase(dt: number, state: VehicleState): void {
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(Math.cos(state.heading), 0, Math.sin(state.heading));
    _fwd.normalize();
    _target.copy(_pos).addScaledVector(_fwd, -this.opts.chaseDistance);
    _target.y = _pos.y + this.opts.chaseHeight;
    if (!this.chaseInit) {
      this.chasePos.copy(_target);
      this.chaseInit = true;
    } else {
      this.chasePos.lerp(_target, Math.min(1, dt / 0.15));
    }
    this.camera.position.copy(this.chasePos);
    _target.copy(_pos).addScaledVector(_fwd, 4);
    _target.y = _pos.y + 0.8;
    this.camera.lookAt(_target);
    this.headYaw = 0;
    this.headPitch = 0;
  }
}
