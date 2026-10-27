import { describe, expect, it } from 'vitest';
import { AUTO_CANCEL_TURN, IndicatorLogic, indicatorLampOn } from './indicator';

describe('IndicatorLogic', () => {
  it('toggles like a stalk: same side again switches off, hazard has priority', () => {
    const ind = new IndicatorLogic();
    expect(ind.request('left', 0, 1)).toBe(true);
    expect(ind.indicator).toBe('left');
    expect(ind.since).toBe(1);
    expect(ind.request('left', 0, 2)).toBe(true);
    expect(ind.indicator).toBe('off');
    ind.request('right', 0, 3);
    expect(ind.request('right', 0, 3)).toBe(true); // off again
    ind.request('hazard', 0, 4);
    expect(ind.indicator).toBe('hazard');
    expect(ind.request('left', 0, 5)).toBe(false); // ignored while hazard is on
    expect(ind.indicator).toBe('hazard');
    expect(ind.request('hazard', 0, 6)).toBe(true);
    expect(ind.indicator).toBe('off');
    expect(ind.request('off', 0, 7)).toBe(false);
  });

  it('auto-cancels after a > 60° turn in the signalled direction once the wheel is centred', () => {
    const ind = new IndicatorLogic();
    ind.request('right', 0, 0);
    // turn right (heading increases) gradually with the wheel turned
    let h = 0;
    for (let i = 0; i < 20; i++) {
      h += AUTO_CANCEL_TURN / 10;
      expect(ind.update(h, 0.6)).toBe(false); // wheel still turned → no cancel yet
    }
    expect(ind.indicator).toBe('right');
    expect(ind.update(h, 0.05)).toBe(true); // wheel back to centre → cancel
    expect(ind.indicator).toBe('off');
  });

  it('does not cancel on a turn in the opposite direction or on a small wiggle', () => {
    const ind = new IndicatorLogic();
    ind.request('left', 0, 0);
    let h = 0;
    for (let i = 0; i < 30; i++) {
      h += 0.05; // turning right while signalling left
      expect(ind.update(h, 0.3)).toBe(false);
    }
    expect(ind.update(h, 0)).toBe(false);
    expect(ind.indicator).toBe('left');
    const ind2 = new IndicatorLogic();
    ind2.request('left', 0, 0);
    ind2.update(-0.3, -0.5); // 17° left
    expect(ind2.update(-0.3, 0)).toBe(false);
    expect(ind2.indicator).toBe('left');
  });

  it('handles heading wrap-around (turning left across ±π)', () => {
    const ind = new IndicatorLogic();
    ind.request('left', Math.PI - 0.2, 0); // heading just below +π (west-ish)
    let h = Math.PI - 0.2;
    for (let i = 0; i < 12; i++) {
      h -= 0.1; // turning left = heading decreasing
      ind.update(h, -0.5);
    }
    // crossed from +π side? go further so that we pass through ±π when turning left
    const ind3 = new IndicatorLogic();
    ind3.request('right', -Math.PI + 0.1, 0);
    let g = -Math.PI + 0.1;
    for (let i = 0; i < 15; i++) {
      g += 0.1;
      if (g > Math.PI) g -= 2 * Math.PI; // wrap like atan2 would
      ind3.update(g, 0.5);
    }
    expect(ind3.update(g, 0)).toBe(true);
    expect(ind.indicator).toBe('left'); // only 1.2 rad > 60° but wheel never centred
    expect(ind.update(h, 0)).toBe(true);
  });

  it('hazard never auto-cancels', () => {
    const ind = new IndicatorLogic();
    ind.request('hazard', 0, 0);
    for (let i = 1; i < 40; i++) expect(ind.update(i * 0.1, 0)).toBe(false);
    expect(ind.indicator).toBe('hazard');
  });

  it('lamp phase blinks at 1.5 Hz from the switch-on time', () => {
    expect(indicatorLampOn(10, 10)).toBe(true);
    expect(indicatorLampOn(10.2, 10)).toBe(true);
    expect(indicatorLampOn(10.4, 10)).toBe(false);
    expect(indicatorLampOn(10.7, 10)).toBe(true);
  });
});
