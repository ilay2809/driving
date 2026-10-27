// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { NAV_HIDE_AFTER_S, NavBanner, navDisplay } from './navBanner';
import { fakeContext } from './testing';

describe('navDisplay', () => {
  it('formats kind, distance, exit number and progress', () => {
    const d = navDisplay({ kind: 'roundabout_exit', text: '', distance: 120, exitNumber: 2, streetName: 'שדרות הראשיים' }, 120, 200);
    expect(d.main).toBe('בכיכר');
    expect(d.exit).toBe('יציאה 2');
    expect(d.distance).toBe('בעוד 120 מ׳');
    expect(d.street).toBe('שדרות הראשיים');
    expect(d.icon).toBe('roundabout');
    expect(d.progress).toBeCloseTo(0.4);
    expect(d.urgent).toBe(false);
    const near = navDisplay({ kind: 'turn_right', text: '', distance: 10 }, 10, 100);
    expect(near.distance).toBe('עכשיו');
    expect(near.urgent).toBe(true);
    expect(near.icon).toBe('arrowRight');
    const unknown = navDisplay({ kind: 'custom', text: 'טקסט מהמנווט', distance: 50 }, 50, 50);
    expect(unknown.main).toBe('טקסט מהמנווט');
  });
});

describe('NavBanner', () => {
  it('counts down the distance as the car moves and hides after the manoeuvre point', () => {
    const nb = new NavBanner();
    document.body.appendChild(nb.el);
    expect(nb.visible).toBe(false);
    nb.set({ kind: 'turn_left', text: '', distance: 100, junctionId: 'n01', streetName: 'רחוב התמר' });
    expect(nb.visible).toBe(true);
    expect(nb.el.querySelector('.nav-main')!.textContent).toBe('פנה שמאלה');
    expect(nb.el.querySelector('.nav-dist')!.textContent).toBe('בעוד 100 מ׳');
    const ctx = fakeContext();
    ctx.player.pos = [0, 0];
    nb.update(ctx);
    ctx.player.pos = [25, 0];
    nb.update(ctx);
    expect(nb.remaining()).toBeCloseTo(75);
    expect(nb.el.querySelector('.nav-dist')!.textContent).toBe('בעוד 75 מ׳');
    for (const x of [50, 75, 100, 120]) {
      ctx.player.pos = [x, 0];
      nb.update(ctx);
    }
    expect(nb.el.querySelector('.nav-dist')!.textContent).toBe('עכשיו');
    expect(nb.el.classList.contains('urgent')).toBe(true);
    ctx.dt = 1;
    for (let i = 0; i <= NAV_HIDE_AFTER_S; i++) nb.update(ctx);
    expect(nb.visible).toBe(false);
  });

  it('ignores teleports and resets the progress on a new instruction', () => {
    const nb = new NavBanner();
    nb.set({ kind: 'straight', text: '', distance: 50, junctionId: 'a' });
    const ctx = fakeContext();
    ctx.player.pos = [0, 0];
    nb.update(ctx);
    ctx.player.pos = [500, 0];
    nb.update(ctx);
    expect(nb.remaining()).toBe(50);
    nb.set({ kind: 'turn_right', text: '', distance: 80, junctionId: 'b' });
    expect(nb.remaining()).toBe(80);
    nb.clear();
    expect(nb.visible).toBe(false);
  });
});
