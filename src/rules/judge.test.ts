import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { Judge } from './judge';
import { makeTestContext } from './scripted';
import type { Violation } from './violations';

const world = buildTrainingGround();
const g = new RoadGraph(world);

function placed(x: number, z: number, heading: number) {
  const ctx = makeTestContext(world, g);
  ctx.player.pos = [x, z];
  ctx.player.heading = heading;
  ctx.localiser.update(ctx);
  return ctx;
}

describe('Judge', () => {
  it('applies per-type cooldowns, records history, scores and publishes on the bus', () => {
    const ctx = placed(-60, 1.65, 0);
    const judge = new Judge(g, ctx.bus, { detectors: [] });
    const seen: Violation[] = [];
    ctx.bus.on('violation', (v) => seen.push(v));
    judge.update(ctx);
    const v1 = judge.report('SPEEDING_MINOR', { details: { speed: 55 } });
    expect(v1).toBeDefined();
    expect(v1!.context).toBe('בשדרות הראשיים');
    expect(v1!.severity).toBe('minor');
    expect(v1!.pos).toEqual([-60, 1.65]);
    expect(v1!.details).toEqual({ speed: 55 });
    ctx.time = 5;
    judge.update(ctx);
    expect(judge.report('SPEEDING_MINOR')).toBeUndefined(); // within the 15 s cooldown
    expect(judge.report('SPEEDING_MAJOR')).toBeDefined(); // other types are independent
    ctx.time = 16;
    judge.update(ctx);
    expect(judge.report('SPEEDING_MINOR')).toBeDefined();
    expect(judge.history.map((v) => v.type)).toEqual(['SPEEDING_MINOR', 'SPEEDING_MAJOR', 'SPEEDING_MINOR']);
    expect(seen.length).toBe(3);
    expect(judge.summary().points).toBe(1 + 4 + 1);
    expect(judge.summary().passed).toBe(true);
    expect(judge.lastViolation?.time).toBe(16);
    expect(judge.violationsSince(10).length).toBe(1);
  });

  it('lets a detector override the severity and the context', () => {
    const ctx = placed(-60, 1.65, 0);
    const judge = new Judge(g, ctx.bus);
    judge.update(ctx);
    const v = judge.report('TAILGATING', { severity: 'major', context: 'בכביש' })!;
    expect(v.severity).toBe('major');
    expect(v.context).toBe('בכביש');
    expect(judge.summary().counts.major).toBe(1);
  });

  it('uses the junction name as context inside a junction', () => {
    const ctx = placed(-5, 1.65, 0);
    const judge = new Judge(g, ctx.bus);
    judge.update(ctx);
    expect(ctx.localisation.insideJunction).toBe(true);
    expect(judge.hereContext()).toBe('בצומת 11');
    expect(judge.junctionContext('rb_w')).toBe('בכיכר האילנות');
    expect(judge.streetContext('r02_12:f0')).toBe('ברחוב החצב');
    expect(judge.streetContext(undefined)).toBeUndefined();
  });

  it('suppresses the approaching hints when no coach is present', () => {
    const ctx = placed(-60, 1.65, 0);
    ctx.coachPresent = false;
    const judge = new Judge(g, ctx.bus, { detectors: [] });
    judge.update(ctx);
    expect(judge.coachPresent).toBe(false);
    expect(judge.report('APPROACHING_SIGNALS')).toBeUndefined();
    expect(judge.report('GOOD_STOP')).toBeDefined(); // other infos still flow
    const forced = new Judge(g, ctx.bus, { coachPresent: true, detectors: [] });
    forced.update(ctx);
    expect(forced.report('APPROACHING_SIGNALS')).toBeDefined();
  });

  it('tracks stopped time, odometer, glances and collisions from the bus', () => {
    const ctx = placed(-60, 1.65, 0);
    const judge = new Judge(g, ctx.bus);
    ctx.dt = 0.5;
    judge.update(ctx);
    judge.update(ctx);
    expect(judge.stoppedFor).toBeCloseTo(1);
    ctx.player.speed = 10;
    ctx.time += 0.5;
    ctx.bus.emit('input:glance', { target: 'left_mirror', time: ctx.time });
    ctx.bus.emit('vehicle:collision', { with: 'kerb', impulse: 5, pos: [-60, 1.65], time: ctx.time });
    judge.update(ctx);
    expect(judge.stoppedFor).toBe(0);
    expect(judge.odometer).toBeCloseTo(5);
    expect(judge.glancesWithin(5).map((x) => x.target)).toEqual(['left_mirror']);
    expect(judge.collisions.length).toBe(1);
    judge.update(ctx);
    expect(judge.collisions.length).toBe(0); // consumed
    judge.reset();
    expect(judge.history.length).toBe(0);
    expect(judge.odometer).toBe(0);
    expect(judge.glancesWithin(5).length).toBe(0);
    judge.dispose();
    ctx.bus.emit('input:glance', { target: 'right_mirror', time: ctx.time + 1 });
    judge.update(ctx);
    expect(judge.glancesWithin(5).length).toBe(0);
  });

  it('exposes the instruction and parking hooks', () => {
    const ctx = placed(118.5, -60, Math.PI / 2); // r20_21:f0 next to the p3 strip
    const judge = new Judge(g, ctx.bus);
    judge.update(ctx);
    judge.setExpectedTurn('n21', 'right');
    expect(judge.instructions.expectations.turn).toEqual({ junctionId: 'n21', turn: 'right' });
    judge.setExpectedStop([118.5, -40], 6);
    expect(judge.instructions.expectations.stop?.radius).toBe(6);
    judge.clearExpectedStop();
    expect(judge.instructions.expectations.stop).toBeUndefined();
    const rep = judge.parkingReport(ctx)!;
    expect(rep.legal).toBe(true);
    expect(rep.kerbDistance).toBeCloseTo(0.6, 2);
    expect(rep.side).toBe('right');
  });
});
