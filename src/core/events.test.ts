import { describe, expect, it } from 'vitest';
import { EventBus } from './events';

describe('EventBus', () => {
  it('delivers typed events and supports off/once', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.on('vehicle:gear', (e) => seen.push(e.gear));
    bus.once('vehicle:horn', () => seen.push('horn'));
    bus.emit('vehicle:gear', { gear: 'D', time: 0 });
    bus.emit('vehicle:horn', { time: 1 });
    bus.emit('vehicle:horn', { time: 2 });
    off();
    bus.emit('vehicle:gear', { gear: 'R', time: 3 });
    expect(seen).toEqual(['D', 'horn']);
  });

  it('isolates handler errors', () => {
    const bus = new EventBus();
    let called = 0;
    bus.on('sim:paused', () => {
      throw new Error('boom');
    });
    bus.on('sim:paused', () => {
      called++;
    });
    bus.emit('sim:paused', { paused: true });
    expect(called).toBe(1);
  });
});
