import { describe, expect, it } from 'vitest';
import { DEFAULT_WHEEL_CONFIG, STD, applyDeadzone, buttonSnapshot, describeGamepads, expo, isWheelId, mapStandardGamepad, mapWheel, pedalValue, wheelConfigFor, type GamepadLike } from './gamepad';

function pad(opts: Partial<GamepadLike> & { pressedButtons?: number[]; values?: Record<number, number> } = {}): GamepadLike {
  const buttons = Array.from({ length: 25 }, (_, i) => ({ pressed: opts.pressedButtons?.includes(i) ?? false, value: opts.values?.[i] ?? (opts.pressedButtons?.includes(i) ? 1 : 0) }));
  return { id: opts.id ?? 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)', index: opts.index ?? 0, connected: true, mapping: opts.mapping ?? 'standard', axes: opts.axes ?? [0, 0, 0, 0], buttons };
}

describe('gamepad utilities', () => {
  it('detects steering wheels by id', () => {
    expect(isWheelId('Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)')).toBe(true);
    expect(isWheelId('G920 Driving Force Racing Wheel')).toBe(true);
    expect(isWheelId('Thrustmaster T150 Force Feedback')).toBe(true);
    expect(isWheelId('Xbox Wireless Controller')).toBe(false);
    expect(isWheelId('Sony DualSense')).toBe(false);
  });

  it('deadzone rescales and expo keeps the end points', () => {
    expect(applyDeadzone(0.05)).toBe(0);
    expect(applyDeadzone(-0.05)).toBe(0);
    expect(applyDeadzone(1)).toBe(1);
    expect(applyDeadzone(-1)).toBe(-1);
    expect(applyDeadzone(0.54)).toBeCloseTo(0.5, 2);
    expect(expo(1)).toBe(1);
    expect(expo(-1)).toBe(-1);
    expect(expo(0.5)).toBeLessThan(0.5);
    expect(expo(0.5)).toBeGreaterThan(0.3);
  });

  it('converts pedal axes using the resting value', () => {
    expect(pedalValue(1, 1)).toBe(0); // rest +1 (inverted), not pressed
    expect(pedalValue(-1, 1)).toBe(1); // fully pressed
    expect(pedalValue(0, 1)).toBe(0.5);
    expect(pedalValue(-1, -1)).toBe(0);
    expect(pedalValue(1, -1)).toBe(1);
    expect(pedalValue(0.7, 0)).toBe(0.7);
  });

  it('maps a standard gamepad: stick steer, triggers, face buttons as gears, bumpers as indicators', () => {
    const p = pad({ axes: [0.6, 0, -0.5, 0.3], values: { [STD.RT]: 0.8, [STD.LT]: 0.2 }, pressedButtons: [STD.A, STD.LB] });
    const m = mapStandardGamepad(p);
    expect(m.steer).toBeGreaterThan(0.3);
    expect(m.steer).toBeLessThan(0.7);
    expect(m.throttle).toBe(0.8);
    expect(m.brake).toBe(0.2);
    expect(m.gearRequest).toBe('D');
    expect(m.indicatorRequest).toBe('left');
    expect(m.lookYaw).toBeLessThan(0);
    expect(m.lookPitch).toBeLessThan(0);
    // edge detection: held buttons do not re-trigger
    const prev = buttonSnapshot(p);
    const again = mapStandardGamepad(p, prev);
    expect(again.gearRequest).toBeUndefined();
    expect(again.indicatorRequest).toBeUndefined();
    const m2 = mapStandardGamepad(pad({ pressedButtons: [STD.B, STD.RB, STD.DUP, STD.START, STD.RS] }));
    expect(m2.gearRequest).toBe('R');
    expect(m2.indicatorRequest).toBe('right');
    expect(m2.lightsToggle).toBe(true);
    expect(m2.pause).toBe(true);
    expect(m2.horn).toBe(true);
    expect(mapStandardGamepad(pad({ pressedButtons: [STD.X] })).gearRequest).toBe('N');
    expect(mapStandardGamepad(pad({ pressedButtons: [STD.Y] })).gearRequest).toBe('P');
  });

  it('maps a wheel: linear steering, inverted pedals detected from the rest value, paddles', () => {
    const id = 'G29 Driving Force Racing Wheel';
    const rest = [0, 1, 1, 0, 0, 1];
    const p = pad({ id, mapping: '', axes: [-0.5, 1, 0, 0, 0, 1], pressedButtons: [DEFAULT_WHEEL_CONFIG.buttons.indicatorRight] });
    const cfg = wheelConfigFor(p);
    expect(cfg.throttleAxis).toBe(2);
    expect(cfg.brakeAxis).toBe(5);
    const m = mapWheel(p, cfg, rest);
    expect(m.steer).toBe(-0.5);
    expect(m.throttle).toBe(0.5); // axis 2 at 0 with rest +1 → half pressed
    expect(m.brake).toBe(0);
    expect(m.indicatorRequest).toBe('right');
    const three = pad({ id, mapping: '', axes: [0.2, 1, 1] });
    const cfg3 = wheelConfigFor(three);
    expect(cfg3.throttleAxis).toBe(1);
    expect(cfg3.brakeAxis).toBe(2);
    const paddle = mapWheel(pad({ id, mapping: '', axes: [0, 1, 1, 0, 0, 1], pressedButtons: [DEFAULT_WHEEL_CONFIG.buttons.gearUp] }), cfg, rest);
    expect(paddle.gearUp).toBe(true);
  });

  it('describes connected devices for the settings UI', () => {
    const list = describeGamepads([null, pad({ index: 1 }), pad({ index: 2, id: 'Logitech G923 Racing Wheel', mapping: '', axes: [0, 1, 1, 0, 0, 1] }), undefined]);
    expect(list).toHaveLength(2);
    expect(list[0]!.kind).toBe('gamepad');
    expect(list[1]!.kind).toBe('wheel');
    expect(list[1]!.wheel?.pedalsInverted).toBe(true);
    expect(list[1]!.wheel?.throttleAxis).toBe(2);
  });
});
