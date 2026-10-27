/**
 * Gamepad / steering-wheel mapping utilities (pure, testable). The InputSystem feeds
 * `navigator.getGamepads()` snapshots through these.
 */
import type { Gear, GlanceTarget, Indicator } from '@/core/types';

/** Minimal structural view of the browser Gamepad object (so tests can fake one). */
export interface GamepadLike {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export const WHEEL_ID_RE = /G29|G920|G923|G27|G25|T150|T300|T500|TMX|TS-PC|TS-XW|Thrustmaster|Logitech.*(Wheel|Racing|Driving)|Fanatec|wheel/i;

export function isWheelId(id: string): boolean {
  return WHEEL_ID_RE.test(id);
}

/** Deadzone with rescaling so the output still reaches ±1. */
export function applyDeadzone(v: number, dz = 0.08): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  const s = (a - dz) / (1 - dz);
  return Math.sign(v) * Math.min(1, s);
}

/** Mild expo curve: finer control around centre, full range at the ends. */
export function expo(v: number, k = 0.35): number {
  const c = Math.max(-1, Math.min(1, v));
  return c * (1 - k) + c * c * c * k;
}

/**
 * Convert a raw pedal axis to 0..1 given its resting value. Wheels commonly report
 * +1 at rest and -1 when pressed; some report -1 at rest; a few report 0..1.
 */
export function pedalValue(raw: number, rest: number): number {
  if (rest > 0.5) return clamp01((1 - raw) / 2);
  if (rest < -0.5) return clamp01((raw + 1) / 2);
  return clamp01(raw);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface MappedInput {
  steer: number;
  throttle: number;
  brake: number;
  lookYaw: number;
  lookPitch: number;
  horn: boolean;
  gearRequest?: Gear;
  indicatorRequest?: Indicator;
  glance?: GlanceTarget;
  lightsToggle: boolean;
  wipersToggle: boolean;
  handbrakeToggle: boolean;
  ignitionToggle: boolean;
  seatbeltToggle: boolean;
  pause: boolean;
  acknowledge: boolean;
  gearUp: boolean;
  gearDown: boolean;
}

export function emptyMapped(): MappedInput {
  return {
    steer: 0,
    throttle: 0,
    brake: 0,
    lookYaw: 0,
    lookPitch: 0,
    horn: false,
    lightsToggle: false,
    wipersToggle: false,
    handbrakeToggle: false,
    ignitionToggle: false,
    seatbeltToggle: false,
    pause: false,
    acknowledge: false,
    gearUp: false,
    gearDown: false,
  };
}

/** Standard-mapping button indices (W3C "standard" layout, Xbox naming). */
export const STD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,
  RS: 11,
  DUP: 12,
  DDOWN: 13,
  DLEFT: 14,
  DRIGHT: 15,
} as const;

function pressed(pad: GamepadLike, i: number): boolean {
  const b = pad.buttons[i];
  return !!b && (b.pressed || b.value > 0.5);
}

function rising(pad: GamepadLike, prev: readonly boolean[] | undefined, i: number): boolean {
  return pressed(pad, i) && !(prev?.[i] ?? false);
}

export function buttonSnapshot(pad: GamepadLike): boolean[] {
  return pad.buttons.map((b) => b.pressed || b.value > 0.5);
}

/**
 * Standard gamepad: left stick steer (deadzone + expo), RT throttle, LT brake,
 * A = D, B = R, X = N, Y = P, LB/RB indicators, right stick look, D-pad up/down =
 * lights/wipers, D-pad left/right = mirror glances, Start = pause, Back = ignition,
 * LS click = handbrake, RS click = horn.
 */
export function mapStandardGamepad(pad: GamepadLike, prev?: readonly boolean[]): MappedInput {
  const m = emptyMapped();
  m.steer = expo(applyDeadzone(pad.axes[0] ?? 0));
  const rt = pad.buttons[STD.RT]?.value ?? 0;
  const lt = pad.buttons[STD.LT]?.value ?? 0;
  m.throttle = clamp01(rt);
  m.brake = clamp01(lt);
  m.lookYaw = applyDeadzone(pad.axes[2] ?? 0, 0.12);
  m.lookPitch = -applyDeadzone(pad.axes[3] ?? 0, 0.12);
  m.horn = pressed(pad, STD.RS);
  if (rising(pad, prev, STD.A)) m.gearRequest = 'D';
  else if (rising(pad, prev, STD.B)) m.gearRequest = 'R';
  else if (rising(pad, prev, STD.X)) m.gearRequest = 'N';
  else if (rising(pad, prev, STD.Y)) m.gearRequest = 'P';
  if (rising(pad, prev, STD.LB)) m.indicatorRequest = 'left';
  else if (rising(pad, prev, STD.RB)) m.indicatorRequest = 'right';
  if (rising(pad, prev, STD.DUP)) m.lightsToggle = true;
  if (rising(pad, prev, STD.DDOWN)) m.wipersToggle = true;
  if (rising(pad, prev, STD.DLEFT)) m.glance = 'left_mirror';
  if (rising(pad, prev, STD.DRIGHT)) m.glance = 'right_mirror';
  if (rising(pad, prev, STD.START)) m.pause = true;
  if (rising(pad, prev, STD.BACK)) m.ignitionToggle = true;
  if (rising(pad, prev, STD.LS)) m.handbrakeToggle = true;
  return m;
}

/** Configurable wheel layout (defaults follow the Logitech G29/G920 in Chromium). */
export interface WheelConfig {
  steerAxis: number;
  throttleAxis: number;
  brakeAxis: number;
  /** Degrees of lock-to-lock the device reports as ±1 (informational). */
  rotationDeg: number;
  buttons: {
    gearP: number;
    gearR: number;
    gearN: number;
    gearD: number;
    gearUp: number;
    gearDown: number;
    indicatorLeft: number;
    indicatorRight: number;
    hazard: number;
    lights: number;
    wipers: number;
    horn: number;
    ignition: number;
    handbrake: number;
    pause: number;
    acknowledge: number;
  };
}

export const DEFAULT_WHEEL_CONFIG: WheelConfig = {
  steerAxis: 0,
  throttleAxis: 2,
  brakeAxis: 5,
  rotationDeg: 900,
  buttons: {
    gearD: 0, // X / A
    gearR: 2, // circle / B
    gearN: 1, // square / X
    gearP: 3, // triangle / Y
    gearUp: 4, // right paddle
    gearDown: 5, // left paddle
    indicatorLeft: 7, // L2
    indicatorRight: 6, // R2
    hazard: 12, // +
    lights: 13, // -
    wipers: 19, // dial press / spare
    horn: 10, // R3
    ignition: 8, // share
    handbrake: 11, // L3
    pause: 9, // options
    acknowledge: 0,
  },
};

/** Pick pedal axes that exist on the device (G29 reports 6 axes, cheaper wheels 3). */
export function wheelConfigFor(pad: GamepadLike, base: WheelConfig = DEFAULT_WHEEL_CONFIG): WheelConfig {
  if (pad.axes.length > Math.max(base.throttleAxis, base.brakeAxis)) return base;
  if (pad.axes.length >= 3) return { ...base, throttleAxis: 1, brakeAxis: 2 };
  return { ...base, throttleAxis: 1, brakeAxis: 1 };
}

/**
 * Steering wheel: axis 0 linear to ±1 (±450° on a 900° wheel), pedals via the
 * calibrated resting values (`rest[axis]` captured when the pedals were first seen).
 */
export function mapWheel(pad: GamepadLike, cfg: WheelConfig, rest: readonly number[], prev?: readonly boolean[]): MappedInput {
  const m = emptyMapped();
  m.steer = Math.max(-1, Math.min(1, pad.axes[cfg.steerAxis] ?? 0));
  const tRaw = pad.axes[cfg.throttleAxis];
  const bRaw = pad.axes[cfg.brakeAxis];
  if (tRaw !== undefined) m.throttle = pedalValue(tRaw, rest[cfg.throttleAxis] ?? 1);
  if (bRaw !== undefined && cfg.brakeAxis !== cfg.throttleAxis) m.brake = pedalValue(bRaw, rest[cfg.brakeAxis] ?? 1);
  const B = cfg.buttons;
  m.horn = pressed(pad, B.horn);
  if (rising(pad, prev, B.gearD)) m.gearRequest = 'D';
  else if (rising(pad, prev, B.gearR)) m.gearRequest = 'R';
  else if (rising(pad, prev, B.gearN)) m.gearRequest = 'N';
  else if (rising(pad, prev, B.gearP)) m.gearRequest = 'P';
  if (rising(pad, prev, B.gearUp)) m.gearUp = true;
  if (rising(pad, prev, B.gearDown)) m.gearDown = true;
  if (rising(pad, prev, B.indicatorLeft)) m.indicatorRequest = 'left';
  else if (rising(pad, prev, B.indicatorRight)) m.indicatorRequest = 'right';
  else if (rising(pad, prev, B.hazard)) m.indicatorRequest = 'hazard';
  if (rising(pad, prev, B.lights)) m.lightsToggle = true;
  if (rising(pad, prev, B.wipers)) m.wipersToggle = true;
  if (rising(pad, prev, B.ignition)) m.ignitionToggle = true;
  if (rising(pad, prev, B.handbrake)) m.handbrakeToggle = true;
  if (rising(pad, prev, B.pause)) m.pause = true;
  if (rising(pad, prev, B.acknowledge)) m.acknowledge = true;
  return m;
}

export interface GamepadDescription {
  index: number;
  id: string;
  kind: 'wheel' | 'gamepad';
  mapping: string;
  axes: number[];
  buttons: number[];
  /** For wheels: which axes are used for pedals and whether they read inverted at rest. */
  wheel?: { steerAxis: number; throttleAxis: number; brakeAxis: number; pedalsInverted: boolean };
}

/**
 * Calibration helper for the settings UI: describe every connected device. `restOf`
 * returns the axis values recorded when the device was first seen (pedals released),
 * so inversion is reported correctly even while a pedal is pressed.
 */
export function describeGamepads(pads: Iterable<GamepadLike | null | undefined>, restOf?: (index: number) => readonly number[] | undefined): GamepadDescription[] {
  const out: GamepadDescription[] = [];
  for (const p of pads) {
    if (!p || !p.connected) continue;
    const kind = isWheelId(p.id) ? 'wheel' : 'gamepad';
    const d: GamepadDescription = {
      index: p.index,
      id: p.id,
      kind,
      mapping: p.mapping,
      axes: p.axes.map((a) => Math.round(a * 1000) / 1000),
      buttons: p.buttons.map((b) => Math.round(b.value * 100) / 100),
    };
    if (kind === 'wheel') {
      const cfg = wheelConfigFor(p);
      const rest = restOf?.(p.index)?.[cfg.throttleAxis] ?? p.axes[cfg.throttleAxis] ?? 1;
      d.wheel = { steerAxis: cfg.steerAxis, throttleAxis: cfg.throttleAxis, brakeAxis: cfg.brakeAxis, pedalsInverted: rest > 0.5 };
    }
    out.push(d);
  }
  return out;
}
