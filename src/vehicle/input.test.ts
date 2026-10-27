// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS, defaultVehicleState, emptyLocalisation, type SignalStateProvider, type SimContext } from '@/core/sim';
import { InputSystem } from './input';
import type { GamepadLike } from './gamepad';

const signals: SignalStateProvider = { stateOf: () => 'off', stateForConnector: () => undefined, stateForCrossing: () => undefined, timeToChange: () => 0, override: () => undefined };

function makeCtx(bus: EventBus, speed = 0): SimContext {
  const player = defaultVehicleState([0, 0], 0);
  player.speed = speed;
  return {
    time: 1,
    dt: 1 / 60,
    mode: 'free',
    world: {} as SimContext['world'],
    graph: {} as SimContext['graph'],
    bus,
    player,
    localisation: emptyLocalisation(),
    traffic: [],
    signals,
    env: { time: 1, hour: 12, weather: 'clear', wetRoad: false },
    settings: { ...DEFAULT_SETTINGS },
    coachPresent: false,
    timeScale: 1,
    paused: false,
  };
}

function rig(opts: { pads?: GamepadLike[] } = {}) {
  const bus = new EventBus();
  const target = document.createElement('div');
  document.body.appendChild(target);
  const input = new InputSystem(target, bus, { ...DEFAULT_SETTINGS }, { getGamepads: () => opts.pads ?? [] });
  const ctx = makeCtx(bus);
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      ctx.time += 1 / 60;
      input.update(ctx);
    }
    return input.state;
  };
  return { bus, target, input, ctx, step };
}

describe('InputSystem (keyboard)', () => {
  it('P/R/N/D letters act as the lever only while stopped; D steers right when moving', () => {
    const { input, ctx, step } = rig();
    input.pressKey('KeyD');
    let s = step();
    expect(s.gearRequest).toBe('D');
    expect(s.steer).toBe(0); // consumed as a gear request, not as steering
    s = step();
    expect(s.gearRequest).toBeUndefined(); // one-frame pulse
    input.releaseKey('KeyD');
    ctx.player.speed = 10;
    step(2);
    input.pressKey('KeyD');
    s = step(10);
    expect(s.gearRequest).toBeUndefined();
    expect(s.steer).toBeGreaterThan(0.05);
    input.releaseKey('KeyD');
    input.pressKey('KeyR');
    expect(step().gearRequest).toBe('R'); // R has no steering meaning → always a request (vehicle refuses when moving)
  });

  it('indicators, lights, horn and the handbrake lever', () => {
    const { input, step } = rig();
    expect(input.state.handbrake).toBe(true);
    input.pressKey('KeyQ');
    expect(step().indicatorRequest).toBe('left');
    expect(step().indicatorRequest).toBeUndefined();
    input.pressKey('KeyX');
    expect(step().indicatorRequest).toBe('hazard');
    input.pressKey('KeyL');
    expect(step().lightsToggle).toBe(true);
    expect(step().lightsToggle).toBe(false);
    input.pressKey('KeyH');
    expect(step().horn).toBe(true);
    input.releaseKey('KeyH');
    expect(step().horn).toBe(false);
    input.pressKey('Space');
    expect(step().handbrake).toBe(false);
    expect(step().handbrake).toBe(false); // lever state persists
    input.pressKey('Space');
    expect(step().handbrake).toBe(true);
  });

  it('Shift+arrows cycle the lever and pedals ramp progressively', () => {
    const { input, step } = rig();
    input.pressKey('ArrowDown', true);
    expect(step().gearCycle).toBe(1);
    expect(step().gearCycle).toBe(0);
    input.pressKey('ArrowUp', true);
    expect(step().gearCycle).toBe(-1);
    input.releaseKey('ArrowUp');
    input.pressKey('ArrowUp');
    const a = step(5).throttle;
    const b = step(5).throttle;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
    expect(step(30).throttle).toBe(1);
    input.releaseKey('ArrowUp');
    expect(step(20).throttle).toBe(0);
    input.pressKey('KeyS');
    expect(step(3).brake).toBeGreaterThan(0);
  });

  it('glance keys emit input:glance with the sim time and set the one-frame glance field', () => {
    const { bus, input, step } = rig();
    const seen: { target: string; time: number }[] = [];
    bus.on('input:glance', (e) => seen.push(e));
    input.pressKey('Digit1');
    expect(step().glance).toBe('left_mirror');
    input.pressKey('KeyC');
    expect(step().glance).toBe('right_shoulder');
    expect(step().glance).toBeUndefined();
    expect(seen.map((s) => s.target)).toEqual(['left_mirror', 'right_shoulder']);
    expect(seen[0]!.time).toBeGreaterThan(1);
  });

  it('mouse drag gives free look that returns to zero on release', () => {
    const { target, step } = rig();
    target.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new MouseEvent('pointermove', { clientX: 310, clientY: 20, bubbles: true }));
    let s = step();
    expect(s.lookYaw).toBeCloseTo(0.5, 1);
    expect(s.lookPitch).toBeGreaterThan(0.2);
    target.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 310, clientY: 20, bubbles: true }));
    s = step();
    expect(s.lookYaw).toBe(0);
    expect(s.lookPitch).toBe(0);
  });
});

describe('InputSystem (gamepad)', () => {
  it('merges a standard gamepad: triggers, stick steer, face buttons', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    buttons[7] = { pressed: true, value: 0.7 }; // RT
    buttons[0] = { pressed: true, value: 1 }; // A → D
    const pad: GamepadLike = { id: 'Xbox Wireless Controller', index: 0, connected: true, mapping: 'standard', axes: [0.5, 0, 0, 0], buttons };
    const { step } = rig({ pads: [pad] });
    let s = step();
    expect(s.source).toBe('gamepad');
    expect(s.throttle).toBeCloseTo(0.7, 5);
    expect(s.gearRequest).toBe('D');
    s = step(30);
    expect(s.gearRequest).toBeUndefined(); // held button does not repeat
    expect(s.steer).toBeGreaterThan(0.2);
    expect(s.steer).toBeLessThan(0.6);
  });

  it('identifies a wheel and inverts the pedals from their rest value', () => {
    const buttons = Array.from({ length: 25 }, () => ({ pressed: false, value: 0 }));
    const pad: GamepadLike = { id: 'Logitech G29 Driving Force Racing Wheel', index: 0, connected: true, mapping: '', axes: [0.2, 1, 1, 0, 0, 1], buttons };
    const { input, step } = rig({ pads: [pad] });
    let s = step();
    expect(s.source).toBe('wheel');
    expect(s.steer).toBeCloseTo(0.2, 5);
    expect(s.throttle).toBe(0);
    (pad.axes as number[])[2] = -1; // throttle fully pressed (inverted axis)
    s = step();
    expect(s.throttle).toBe(1);
    const desc = input.describeGamepads();
    expect(desc[0]?.kind).toBe('wheel');
    expect(desc[0]?.wheel?.pedalsInverted).toBe(true);
  });
});
