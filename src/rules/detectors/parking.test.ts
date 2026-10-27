import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { HE } from '../strings.he';
import { makeTestContext, runScenario, type ScenarioOptions } from '../scripted';
import { parkingReport } from './parking';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const CAR = 4.4;

/** Pull over (right indicator), stop at `stopS`, select P and stand for a while. */
function park(path: string[], stopS: number, extra: Partial<ScenarioOptions> = {}): ScenarioOptions {
  return {
    startS: Math.max(0, stopS - 40),
    endS: stopS,
    lateral: 0.3,
    profile: [
      { atS: 0, speedKmh: 20 },
      { atS: stopS - 25, speedKmh: 20 },
      { atS: stopS, speedKmh: 0, hold: 5 },
    ],
    events: [{ atS: stopS - 30, indicator: 'right' }, { atS: stopS, gear: 'P', indicator: 'off' }],
    run: { tailSeconds: 6 },
    ...extra,
  };
}

describe('ParkingDetector — parking', () => {
  it('parking on the red-white kerb of p1 → ILLEGAL_PARKING', () => {
    const r = runScenario(world, g, ['r10_20:f0'], park(['r10_20:f0'], 41)); // road s 45 → inside p1 (20..70)
    expect(r.nonInfo).toEqual(['ILLEGAL_PARKING']);
    const v = r.violations.find((x) => x.type === 'ILLEGAL_PARKING')!;
    expect(v.context).toBe(HE.kerb.red_white);
    expect(v.details).toMatchObject({ kerb: 'red_white', side: 'right' });
  });

  it('parking on p3 (plain kerb) 0.3 m from the kerb → GOOD_PARKING, reported once', () => {
    const r = runScenario(world, g, ['r20_21:f0'], park(['r20_21:f0'], 59, { run: { tailSeconds: 15 } }));
    expect(r.nonInfo).toEqual([]);
    expect(r.types.filter((t) => t === 'GOOD_PARKING').length).toBe(1);
    const v = r.violations.find((x) => x.type === 'GOOD_PARKING')!;
    expect(v.details!.kerbDistance as number).toBeCloseTo(0.3, 1);
    expect(v.context).toBe('ברחוב האלון');
  });

  it('0.9 m from the kerb → PARKING_TOO_FAR; 12° off → PARKING_ANGLE', () => {
    const far = runScenario(world, g, ['r20_21:f0'], park(['r20_21:f0'], 59, { lateral: -0.3 }));
    expect(far.nonInfo).toEqual(['PARKING_TOO_FAR']);
    expect(far.violations[0]!.details!.kerbDistance as number).toBeCloseTo(0.9, 1);
    const base = park(['r20_21:f0'], 59);
    const angled = runScenario(world, g, ['r20_21:f0'], { ...base, events: [...base.events!, { atS: 59, headingDeg: 12 }] });
    expect(angled.nonInfo).toEqual(['PARKING_ANGLE']);
    expect(Math.abs(angled.violations[0]!.details!.angleDeg as number)).toBeCloseTo(12, 0);
  });

  it('parking less than 12 m from a junction → ILLEGAL_PARKING', () => {
    const r = runScenario(world, g, ['r20_21:f0'], park(['r20_21:f0'], 104));
    expect(r.nonInfo).toEqual(['ILLEGAL_PARKING']);
    expect(r.violations.find((x) => x.type === 'ILLEGAL_PARKING')!.context).toBe(HE.nearJunction);
  });

  it('parking less than 12 m before a crossing → ILLEGAL_PARKING', () => {
    const r = runScenario(world, g, ['r00_10:f0'], park(['r00_10:f0'], 50 - CAR / 2));
    expect(r.nonInfo).toEqual(['ILLEGAL_PARKING']);
    expect(r.violations.find((x) => x.type === 'ILLEGAL_PARKING')!.context).toBe(HE.nearCrossing);
  });

  it('parking at the red-yellow bus-stop kerb on the left side of a one-way-like approach (p4) → ILLEGAL_PARKING', () => {
    // northbound on רחוב התמר (r01_02:b0); p4 is on the road's left side between road s 20 and 60 (z = 40 → lane s 79.5)
    const r = runScenario(world, g, ['r01_02:b0'], park(['r01_02:b0'], 79.5));
    expect(r.nonInfo).toEqual(['ILLEGAL_PARKING']);
    expect(r.violations.find((x) => x.type === 'ILLEGAL_PARKING')!.context).toBe(HE.kerb.red_yellow);
  });

  it('parkingReport() describes the position for lessons and the examiner', () => {
    const ctx = makeTestContext(world, g);
    ctx.player.pos = [118.5 - 0.3, -60]; // heading south: the kerb (right side) is to the west
    ctx.player.heading = Math.PI / 2;
    ctx.localiser.update(ctx);
    const rep = parkingReport(g, ctx)!;
    expect(rep.legal).toBe(true);
    expect(rep.reasons).toEqual([]);
    expect(rep.kerbDistance).toBeCloseTo(0.3, 2);
    expect(rep.side).toBe('right');
    expect(rep.kerb).toBe('none');
    expect(rep.strip?.id).toBe('p3');
    expect(rep.laneId).toBe('r20_21:f0');
    ctx.player.pos = [45, -118.5 + 0.3];
    ctx.player.heading = 0;
    ctx.localiser.update(ctx);
    const bad = parkingReport(g, ctx)!;
    expect(bad.legal).toBe(false);
    expect(bad.reasons).toEqual([HE.kerb.red_white]);
    expect(bad.strip?.id).toBe('p1');
    ctx.localisation.laneId = undefined;
    expect(parkingReport(g, ctx)).toBeUndefined();
  });
});

describe('ParkingDetector — illegal stops', () => {
  it('standing on a pedestrian crossing for 3 s → ILLEGAL_STOP "על מעבר חצייה"', () => {
    const r = runScenario(world, g, ['r00_10:f0'], {
      startS: 20,
      endS: 59.5,
      profile: [
        { atS: 0, speedKmh: 20 },
        { atS: 40, speedKmh: 20 },
        { atS: 59.5, speedKmh: 0, hold: 4 },
      ],
      run: { tailSeconds: 5 },
    });
    expect(r.nonInfo).toEqual(['ILLEGAL_STOP']);
    expect(r.violations.find((x) => x.type === 'ILLEGAL_STOP')!.context).toBe(HE.onCrossing);
  });

  it('standing at a bus stop for 3 s → ILLEGAL_STOP "בתחנת אוטובוס"', () => {
    const r = runScenario(world, g, ['r02_12:f0'], {
      startS: 30,
      endS: 69.5,
      profile: [
        { atS: 0, speedKmh: 20 },
        { atS: 50, speedKmh: 20 },
        { atS: 69.5, speedKmh: 0, hold: 4 },
      ],
      run: { tailSeconds: 5 },
    });
    expect(r.nonInfo).toEqual(['ILLEGAL_STOP']);
    expect(r.violations.find((x) => x.type === 'ILLEGAL_STOP')!.context).toBe(HE.atBusStop);
  });

  it('a 3 s stop in the middle of a quiet street is not an illegal stop', () => {
    const r = runScenario(world, g, ['r20_21:f0'], {
      startS: 20,
      endS: 60,
      profile: [
        { atS: 0, speedKmh: 20 },
        { atS: 40, speedKmh: 20 },
        { atS: 60, speedKmh: 0, hold: 4 },
      ],
      run: { tailSeconds: 5 },
    });
    expect(r.nonInfo).toEqual([]);
  });
});
