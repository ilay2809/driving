/**
 * Engine + automatic gearbox model as pure functions (no Rapier / THREE), so the
 * behaviour can be unit-tested and tuned in node.
 *
 * Units: N, m, s, rad. Forces returned here are "at the driven wheels" along the
 * car's forward axis (positive = forward). The vehicle body turns them into
 * Rapier wheel engine forces / brake impulses.
 */
import type { Gear } from '@/core/types';

export interface DrivetrainSpec {
  /** Vehicle mass (kg) — used for brake force and creep. */
  mass: number;
  wheelRadius: number;
  /** Forward gear ratios, 1st..5th. */
  gearRatios: number[];
  reverseRatio: number;
  finalDrive: number;
  /** Driveline efficiency 0..1. */
  efficiency: number;
  idleRpm: number;
  redlineRpm: number;
  /** Converter stall speed: the rpm the engine reaches at full throttle against the brakes. */
  stallRpm: number;
  peakTorque: number;
  peakTorqueRpm: number;
  /** Up-shift rpm at zero / part throttle (interpolated by throttle). */
  shiftUpRpmMin: number;
  shiftUpRpmMax: number;
  /** Up-shift rpm at full throttle (kickdown holds the gear until here). */
  shiftUpRpmKickdown: number;
  /** Down-shift when the rpm would fall below this (at zero throttle). */
  shiftDownRpm: number;
  /** Kickdown: at full throttle drop a gear when the lower gear would stay below this rpm. */
  kickdownMaxRpm: number;
  /** Minimum seconds between shifts. */
  shiftLockout: number;
  /** Seconds of reduced torque after a shift (smooth "slush-box" feel). */
  shiftCutTime: number;
  /** Torque-converter creep: target speed (m/s) and the maximum creep force (N). */
  creepSpeed: number;
  creepForceMax: number;
  /** Service brakes: deceleration at full pedal (m/s²) and the front axle share. */
  maxBrakeDecel: number;
  brakeBiasFront: number;
  /** Handbrake: deceleration from the rear wheels only (m/s²). */
  handbrakeDecel: number;
  /** Engine braking force per m/s of speed (N·s/m), applied through the driven wheels. */
  engineBrakeCoeff: number;
  engineBrakeMax: number;
  /** Rolling resistance coefficient and aerodynamic drag (N per (m/s)²). */
  rollingResistance: number;
  dragCoeff: number;
  /** Throttle pedal curve exponent (> 1 = softer initial response). */
  throttleExpo: number;
}

/** Compact family car with a 4-speed-ish slush box + overdrive (5 ratios). */
export const DEFAULT_DRIVETRAIN: DrivetrainSpec = {
  mass: 1300,
  wheelRadius: 0.31,
  gearRatios: [3.6, 1.85, 1.3, 1.0, 0.76],
  reverseRatio: 3.2,
  finalDrive: 3.9,
  efficiency: 0.6,
  idleRpm: 800,
  redlineRpm: 6200,
  stallRpm: 2300,
  peakTorque: 160,
  peakTorqueRpm: 4000,
  shiftUpRpmMin: 2800,
  shiftUpRpmMax: 3500,
  shiftUpRpmKickdown: 5100,
  shiftDownRpm: 1350,
  kickdownMaxRpm: 5000,
  shiftLockout: 0.9,
  shiftCutTime: 0.35,
  creepSpeed: 1.75,
  creepForceMax: 520,
  maxBrakeDecel: 6.6,
  brakeBiasFront: 0.65,
  handbrakeDecel: 3.5,
  engineBrakeCoeff: 28,
  engineBrakeMax: 700,
  rollingResistance: 0.014,
  dragCoeff: 0.42,
  throttleExpo: 1.25,
};

const G = 9.81;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Engine torque (Nm) at a given rpm, full throttle. Zero above the redline (fuel cut). */
export function engineTorque(rpm: number, spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  if (rpm > spec.redlineRpm) return 0;
  const r = Math.max(rpm, 0);
  // flat-ish modern curve: 70 % of peak at idle, ~85 % from 1 500 rpm, 65 % at the redline
  if (r < spec.peakTorqueRpm) {
    const t = (spec.peakTorqueRpm - r) / (spec.peakTorqueRpm - spec.idleRpm); // 1 at idle, 0 at peak
    return spec.peakTorque * (1 - 0.3 * t * t);
  }
  const t = (r - spec.peakTorqueRpm) / (spec.redlineRpm - spec.peakTorqueRpm); // 0 at peak, 1 at redline
  return spec.peakTorque * (1 - 0.35 * t * t);
}

/** Overall ratio (engine rev per wheel rev) for a forward gear index (1-based) or reverse. */
export function overallRatio(gear: number | 'R', spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  const g = gear === 'R' ? spec.reverseRatio : (spec.gearRatios[gear - 1] ?? spec.gearRatios[spec.gearRatios.length - 1]!);
  return g * spec.finalDrive;
}

/** Engine rpm implied by a road speed (m/s, magnitude) in a gear, converter locked. */
export function rpmFromSpeed(speedAbs: number, gear: number | 'R', spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  const wheelRadPerSec = Math.abs(speedAbs) / spec.wheelRadius;
  return (wheelRadPerSec * overallRatio(gear, spec) * 60) / (2 * Math.PI);
}

export function speedFromRpm(rpm: number, gear: number | 'R', spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  return ((rpm * 2 * Math.PI) / 60 / overallRatio(gear, spec)) * spec.wheelRadius;
}

/** Pedal position → effective throttle. */
export function throttleCurve(throttle: number, spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  return Math.pow(clamp(throttle, 0, 1), spec.throttleExpo);
}

/**
 * Automatic gear selection. Returns the gear (1..n) the box wants to be in given the
 * current gear, road speed and throttle. Pure: lockout timing is handled by the caller.
 */
export function selectGear(current: number, speedAbs: number, throttle: number, spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  const n = spec.gearRatios.length;
  const g = clamp(Math.round(current), 1, n);
  const rpm = rpmFromSpeed(speedAbs, g, spec);
  const th = clamp(throttle, 0, 1);
  // up-shift point rises with throttle; near full throttle hold the gear much longer (kickdown)
  const partUp = spec.shiftUpRpmMin + (spec.shiftUpRpmMax - spec.shiftUpRpmMin) * Math.min(1, th / 0.8);
  const up = th > 0.8 ? partUp + (spec.shiftUpRpmKickdown - partUp) * ((th - 0.8) / 0.2) : partUp;
  if (g < n && rpm > up) {
    const rpmNext = rpmFromSpeed(speedAbs, g + 1, spec);
    if (rpmNext >= spec.idleRpm * 1.6) return g + 1;
  }
  if (g > 1) {
    const rpmLower = rpmFromSpeed(speedAbs, g - 1, spec);
    // lugging: drop a gear when revs fall too low (threshold rises a little with throttle)
    const down = spec.shiftDownRpm + 400 * th;
    if (rpm < down) return g - 1;
    // kickdown: driver floors it and the lower gear would still be usable
    if (th > 0.85 && rpmLower < spec.kickdownMaxRpm && rpm < spec.shiftUpRpmKickdown - 800) return g - 1;
  }
  return g;
}

/** Torque converter multiplication (1 at coupling … ~1.7 at stall). */
export function converterRatio(speedRpm: number, engineRpm: number): number {
  const slip = engineRpm > 0 ? clamp(speedRpm / engineRpm, 0, 1) : 1;
  return 1 + 0.7 * Math.pow(1 - slip, 1.5);
}

/**
 * Engine rpm model for an automatic with a torque converter: at low road speed the
 * engine floats above the "locked" rpm (up to the stall speed when flooring it).
 */
export function engineRpm(speedAbs: number, gear: number | 'R' | null, throttle: number, engineOn: boolean, spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  if (!engineOn) return 0;
  const th = throttleCurve(throttle, spec);
  const freeRev = spec.idleRpm + (spec.redlineRpm * 0.9 - spec.idleRpm) * th; // in N / P the engine revs freely
  if (gear === null) return freeRev;
  const locked = rpmFromSpeed(speedAbs, gear, spec);
  // converter slip lets the engine rise to the stall rpm at low speed under throttle
  const stall = spec.idleRpm + (spec.stallRpm - spec.idleRpm) * th;
  const coupling = clamp(locked / spec.stallRpm, 0, 1);
  const slipRpm = stall * (1 - coupling);
  return clamp(Math.max(locked, spec.idleRpm, slipRpm), 0, spec.redlineRpm);
}

/** Drive force at the wheels (N, positive forward) from an engine state. */
export function driveForce(rpm: number, throttle: number, gear: number | 'R', speedAbs: number, spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  const th = throttleCurve(throttle, spec);
  if (th <= 0) return 0;
  const torque = engineTorque(rpm, spec) * th;
  const tc = converterRatio(rpmFromSpeed(speedAbs, gear, spec), rpm);
  return (torque * tc * overallRatio(gear, spec) * spec.efficiency) / spec.wheelRadius;
}

/**
 * Torque-converter creep force along the gear direction: a small push that settles the
 * car at ~creepSpeed on flat ground with no pedals. `vAlong` = speed in the gear's
 * direction (positive when moving the way the gear drives).
 */
export function creepForce(vAlong: number, spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  const kp = (spec.creepForceMax / spec.creepSpeed) * 1.4;
  return clamp(kp * (spec.creepSpeed - vAlong), 0, spec.creepForceMax);
}

/** Engine braking (N, opposing motion) when coasting in gear. */
export function engineBrakeForce(vAlong: number, throttle: number, spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  if (throttle > 0.03 || vAlong < 1.0) return 0;
  return Math.min(spec.engineBrakeMax, spec.engineBrakeCoeff * vAlong);
}

/** Rolling resistance + aero drag magnitude (N) for a speed magnitude. */
export function resistanceForce(speedAbs: number, spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): number {
  if (speedAbs < 0.02) return 0;
  return spec.rollingResistance * spec.mass * G + spec.dragCoeff * speedAbs * speedAbs;
}

/** Service brake force per wheel [FL, FR, RL, RR] in N for a pedal position (ABS clamps later). */
export function brakeForces(pedal: number, handbrake: boolean, spec: DrivetrainSpec = DEFAULT_DRIVETRAIN): [number, number, number, number] {
  const total = clamp(pedal, 0, 1) * spec.maxBrakeDecel * spec.mass;
  const front = (total * spec.brakeBiasFront) / 2;
  let rear = (total * (1 - spec.brakeBiasFront)) / 2;
  if (handbrake) rear = Math.max(rear, (spec.handbrakeDecel * spec.mass) / 2);
  return [front, front, rear, rear];
}

export interface DrivetrainInput {
  lever: Gear;
  throttle: number;
  brake: number;
  handbrake: boolean;
  engineOn: boolean;
  /** Signed road speed (m/s, positive forward). */
  speed: number;
}

export interface DrivetrainOutput {
  /** Force to apply through the driven wheels (N, +forward). 0 while braking. */
  driveForce: number;
  /** Brake force per wheel [FL, FR, RL, RR] (N). Includes engine braking and P lock. */
  brakeForces: [number, number, number, number];
  /** Resistance (rolling + drag) magnitude to apply against the velocity (N). */
  resistance: number;
  rpm: number;
  /** Selected automatic gear (1..5) — informational, R/P/N show 1. */
  gearIndex: number;
  /** True while the box is in a shift (torque cut). */
  shifting: boolean;
}

/** Stateful wrapper: gear hunting lockout, shift torque cut and rpm smoothing. */
export class Drivetrain {
  gearIndex = 1;
  rpm = 0;
  private sinceShift = 10;
  private cut = 0;
  constructor(public readonly spec: DrivetrainSpec = DEFAULT_DRIVETRAIN) {}

  reset(): void {
    this.gearIndex = 1;
    this.rpm = 0;
    this.sinceShift = 10;
    this.cut = 0;
  }

  update(h: number, inp: DrivetrainInput): DrivetrainOutput {
    const spec = this.spec;
    const speedAbs = Math.abs(inp.speed);
    this.sinceShift += h;
    this.cut = Math.max(0, this.cut - h);

    const inDrive = inp.lever === 'D';
    const inReverse = inp.lever === 'R';
    const dir = inDrive ? 1 : inReverse ? -1 : 0;
    const vAlong = dir * inp.speed;

    if (inDrive && this.sinceShift >= spec.shiftLockout) {
      const want = selectGear(this.gearIndex, speedAbs, inp.throttle, spec);
      if (want !== this.gearIndex) {
        this.gearIndex = want;
        this.sinceShift = 0;
        this.cut = spec.shiftCutTime;
      }
    } else if (!inDrive) {
      // the box returns to 1st whenever the lever leaves D at low speed
      if (speedAbs < 1) this.gearIndex = 1;
    }

    const gear: number | 'R' | null = inDrive ? this.gearIndex : inReverse ? 'R' : null;
    const throttle = inp.engineOn ? inp.throttle : 0;
    const targetRpm = engineRpm(speedAbs, gear, throttle, inp.engineOn, spec);
    // first-order lag: the engine's rotational inertia (also makes the audio pleasant)
    const tau = targetRpm > this.rpm ? 0.12 : 0.2;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, h / tau);
    if (!inp.engineOn && this.rpm < 1) this.rpm = 0;

    let drive = 0;
    const braking = inp.brake > 0.02;
    if (inp.engineOn && gear !== null && !braking) {
      const cutFactor = this.cut > 0 ? 0.25 : 1;
      const f = driveForce(this.rpm, throttle, gear, speedAbs, spec) * cutFactor;
      const creep = creepForce(vAlong, spec);
      drive = dir * Math.max(f, creep);
    }

    const brakes = brakeForces(inp.brake, inp.handbrake, spec);
    if (inp.lever === 'P') {
      // parking pawl: hold the car firmly (not infinite, so a push still nudges it a little)
      const lock = (2.5 * spec.mass * G) / 4;
      for (let i = 0; i < 4; i++) brakes[i] = Math.max(brakes[i]!, lock);
    }
    if (inp.engineOn && gear !== null && !braking) {
      // engine braking through the driven (front) wheels
      const eb = engineBrakeForce(vAlong, throttle, spec) / 2;
      brakes[0] += eb;
      brakes[1] += eb;
    }
    if (!inp.engineOn && gear !== null) {
      // engine off in gear: the dead engine drags (compression) — strong enough to notice
      const eb = Math.min(spec.engineBrakeMax * 1.5, spec.engineBrakeCoeff * 3 * speedAbs) / 2;
      brakes[0] += eb;
      brakes[1] += eb;
    }

    return {
      driveForce: drive,
      brakeForces: brakes as [number, number, number, number],
      resistance: resistanceForce(speedAbs, spec),
      rpm: this.rpm,
      gearIndex: this.gearIndex,
      shifting: this.cut > 0,
    };
  }
}
