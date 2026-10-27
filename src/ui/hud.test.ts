// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hud, snapshotOf } from './hud';
import { fakeContext } from './testing';

describe('Hud', () => {
  let hud: Hud;
  beforeEach(() => {
    vi.useFakeTimers();
    hud = new Hud();
    document.body.appendChild(hud.el);
  });
  afterEach(() => {
    hud.dispose();
    vi.useRealTimers();
  });

  it('renders speed, gear and the speed-limit sign from a SimContext', () => {
    const ctx = fakeContext();
    ctx.player.speed = 50 / 3.6;
    ctx.player.gear = 'D';
    ctx.localisation.speedLimit = 50;
    hud.update(ctx);
    expect(hud.el.querySelector('.speed-num')!.textContent).toBe('50');
    expect(hud.el.querySelector('.gear.on')!.textContent).toBe('D');
    expect(hud.el.querySelectorAll('.gear.on')).toHaveLength(1);
    expect(hud.speedLimitText).toBe('50');
    expect(hud.el.querySelector('.speed-num')!.classList.contains('over')).toBe(false);
  });

  it('pulses the sign when the limit changes and flags speeding', () => {
    const ctx = fakeContext();
    ctx.player.speed = 50 / 3.6;
    hud.update(ctx);
    ctx.localisation.speedLimit = 30;
    hud.update(ctx);
    const sign = hud.el.querySelector('.speed-sign')!;
    expect(hud.speedLimitText).toBe('30');
    expect(sign.classList.contains('pulse')).toBe(true);
    expect(sign.getAttribute('aria-label')).toContain('30');
    expect(hud.el.querySelector('.speed-num')!.classList.contains('over')).toBe(true);
  });

  it('shows indicators, hazard, lights, seatbelt and handbrake tell-tales', () => {
    const ctx = fakeContext();
    ctx.player.indicator = 'left';
    ctx.player.lights = 'high';
    ctx.player.seatbelt = false;
    ctx.player.speed = 3;
    ctx.player.handbrake = true;
    hud.update(ctx);
    expect(hud.el.querySelector('.tell.left')!.classList.contains('on')).toBe(true);
    expect(hud.el.querySelector('.tell.right')!.classList.contains('on')).toBe(false);
    expect(hud.el.querySelector('.tell.lights')!.classList.contains('high')).toBe(true);
    const belt = hud.el.querySelector('.tell.seatbelt')!;
    expect(belt.classList.contains('on')).toBe(true);
    expect(belt.classList.contains('moving')).toBe(true);
    expect(hud.el.querySelector('.tell.handbrake')!.classList.contains('on')).toBe(true);

    ctx.player.indicator = 'hazard';
    ctx.player.seatbelt = true;
    ctx.player.lights = 'off';
    hud.update(ctx);
    expect(hud.el.querySelector('.tell.left')!.classList.contains('on')).toBe(true);
    expect(hud.el.querySelector('.tell.right')!.classList.contains('on')).toBe(true);
    expect(hud.el.querySelector('.tell.hazard')!.classList.contains('on')).toBe(true);
    expect(belt.classList.contains('on')).toBe(false);
    expect(hud.el.querySelector('.tell.lights')!.classList.contains('on')).toBe(false);
  });

  it('only touches the DOM when values change', () => {
    const ctx = fakeContext();
    ctx.player.speed = 10;
    hud.update(ctx);
    const speedEl = hud.el.querySelector('.speed-num')!;
    const spy = vi.spyOn(speedEl, 'textContent', 'set');
    hud.update(ctx);
    expect(spy).not.toHaveBeenCalled();
    ctx.player.speed = 11;
    hud.update(ctx);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('lights up mirror indicators briefly on a glance', () => {
    hud.glance('left_mirror');
    const left = hud.el.querySelector('.mirror-ind.left')!;
    expect(left.classList.contains('lit')).toBe(true);
    hud.glance('right_shoulder');
    expect(hud.el.querySelector('.mirror-ind.right')!.classList.contains('shoulder')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(left.classList.contains('lit')).toBe(false);
  });

  it('shows the coach presence badge and the paused badge', () => {
    hud.setPresence('examiner');
    expect(hud.el.querySelector('.coach-badge')!.textContent).toContain('בוחן');
    hud.setPresence('instructor', 'דנה');
    expect(hud.el.querySelector('.coach-badge')!.textContent).toContain('דנה');
    const ctx = fakeContext({ paused: true });
    hud.update(ctx);
    expect((hud.el.querySelector('.paused-badge') as HTMLElement).hidden).toBe(false);
  });

  it('snapshotOf normalises the rpm fraction and over-limit flag', () => {
    const ctx = fakeContext();
    ctx.player.rpm = 3250;
    ctx.player.speed = 60 / 3.6;
    ctx.localisation.speedLimit = 50;
    const s = snapshotOf(ctx);
    expect(s.rpm).toBe(50);
    expect(s.over).toBe(true);
    expect(s.speed).toBe(60);
  });
});
