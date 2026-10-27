import { describe, expect, it } from 'vitest';
import { blinkOn, lampStates, pedLampStates } from './signals';

describe('signal lamp states', () => {
  it('maps vehicle states to lamps', () => {
    expect(lampStates('red', true)).toEqual({ red: true, amber: false, green: false });
    expect(lampStates('red_amber', true)).toEqual({ red: true, amber: true, green: false });
    expect(lampStates('green', false)).toEqual({ red: false, amber: false, green: true });
    expect(lampStates('amber', false)).toEqual({ red: false, amber: true, green: false });
    expect(lampStates('off', true)).toEqual({ red: false, amber: false, green: false });
  });

  it('blinks flashing states with the blink phase', () => {
    expect(lampStates('flashing_green', true).green).toBe(true);
    expect(lampStates('flashing_green', false).green).toBe(false);
    expect(lampStates('flashing_amber', true).amber).toBe(true);
    expect(lampStates('flashing_amber', false).amber).toBe(false);
  });

  it('maps pedestrian states to the two figures', () => {
    expect(pedLampStates('green', true)).toEqual({ red: false, green: true });
    expect(pedLampStates('flashing_green', false)).toEqual({ red: false, green: false });
    expect(pedLampStates('red', true)).toEqual({ red: true, green: false });
    expect(pedLampStates('amber', true)).toEqual({ red: true, green: false });
  });

  it('blinks at 2 Hz (0.25 s on, 0.25 s off)', () => {
    expect(blinkOn(0)).toBe(true);
    expect(blinkOn(0.2)).toBe(true);
    expect(blinkOn(0.3)).toBe(false);
    expect(blinkOn(0.5)).toBe(true);
    expect(blinkOn(0.76)).toBe(false);
    let flips = 0;
    let prev = blinkOn(0);
    for (let i = 1; i <= 100; i++) {
      const b = blinkOn(i / 100);
      if (b !== prev) flips++;
      prev = b;
    }
    expect(flips).toBe(4); // two full cycles per second
  });
});
