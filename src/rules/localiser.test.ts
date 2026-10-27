import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import type { Vec2 } from '@/world/geo';
import { currentApproach, upcomingCrossings } from './localiser';
import { makeTestContext, type TestContext } from './scripted';

const world = buildTrainingGround();
const g = new RoadGraph(world);
const CAR = 4.4;

function tick(ctx: TestContext, pos: Vec2, heading: number, speed = 10, dt = 1 / 30) {
  ctx.player.pos = pos;
  ctx.player.heading = heading;
  ctx.player.speed = speed;
  ctx.dt = dt;
  ctx.time += dt;
  ctx.localiser.update(ctx);
  return ctx.localisation;
}

describe('Localiser', () => {
  it('matches the lane running in the direction of travel and fills the fields', () => {
    const ctx = makeTestContext(world, g);
    const l = tick(ctx, [-60, 1.65], 0);
    expect(l.laneId).toBe('r01_11:f0');
    expect(l.roadId).toBe('r01_11');
    expect(l.s).toBeCloseTo(52.4, 1);
    expect(l.lateral).toBeCloseTo(0, 2);
    expect(l.headingError).toBeCloseTo(0, 3);
    expect(l.speedLimit).toBe(50);
    expect(l.nextJunctionId).toBe('n11');
    expect(l.distToLaneEnd).toBeCloseTo(47.9, 1);
    expect(l.insideJunction).toBe(false);
    expect(l.connectorId).toBeUndefined();
    expect(l.wrongWay).toBe(false);
    expect(l.onKerb).toBe(false);
    // the same point heading west is matched to a westbound lane
    const w = tick(makeTestContext(world, g), [-60, 1.65], Math.PI);
    expect(w.laneId?.startsWith('r01_11:b')).toBe(true);
  });

  it('keeps the lane until the car is clearly in the next one (lane-change hysteresis)', () => {
    const ctx = makeTestContext(world, g);
    tick(ctx, [-60, 1.65], 0);
    expect(tick(ctx, [-59, 1.65 + 1.9], 0).laneId).toBe('r01_11:f0'); // 0.25 m past the line, still f0
    expect(tick(ctx, [-58, 1.65 + 2.6], 0).laneId).toBe('r01_11:f1'); // well into f1
    expect(tick(ctx, [-57, 4.95], 0).laneId).toBe('r01_11:f1');
  });

  it('switches to the connector inside a junction and to the exit lane afterwards', () => {
    const ctx = makeTestContext(world, g);
    tick(ctx, [-20, 1.65], 0);
    tick(ctx, [-12.5, 1.65], 0);
    const inside = tick(ctx, [-5, 1.65], 0);
    expect(inside.insideJunction).toBe(true);
    expect(inside.junctionId).toBe('n11');
    expect(inside.connectorId).toBe('n11:r01_11:f0>r11_21:f0');
    expect(inside.laneId).toBeUndefined();
    expect(inside.s).toBeCloseTo(7.1, 1);
    expect(inside.speedLimit).toBe(50);
    expect(inside.distToLaneEnd).toBeCloseTo(24.2 - 7.1 + 100.3, 0);
    tick(ctx, [11, 1.65], 0);
    const out = tick(ctx, [14, 1.65], 0);
    expect(out.laneId).toBe('r11_21:f0');
    expect(out.connectorId).toBeUndefined();
    expect(out.insideJunction).toBe(false);
    expect(out.s).toBeCloseTo(1.9, 1);
  });

  it('flags wrongWay only after 1 s against a one-way street', () => {
    const ctx = makeTestContext(world, g);
    let l = tick(ctx, [-60, 120], Math.PI, 8);
    expect(l.laneId).toBe('r02_12:f0');
    for (let i = 0; i < 27; i++) l = tick(ctx, [-60 - i * 0.27, 120], Math.PI, 8); // 0.9 s
    expect(l.wrongWay).toBe(false);
    for (let i = 0; i < 6; i++) l = tick(ctx, [-68 - i * 0.27, 120], Math.PI, 8);
    expect(l.wrongWay).toBe(true);
    expect(Math.abs(l.headingError)).toBeGreaterThan(3);
    // slow down below 1 m/s: no longer "driving" against the flow
    expect(tick(ctx, [-70, 120], Math.PI, 0.5).wrongWay).toBe(false);
  });

  it('flags the opposite half of a two-way road as wrongWay (matched by heading, beyond the centre line)', () => {
    const ctx = makeTestContext(world, g);
    let l = tick(ctx, [-60, -1.65], 0, 8); // eastbound on the westbound half
    expect(l.laneId).toBe('r01_11:f0');
    for (let i = 0; i < 35; i++) l = tick(ctx, [-60 + i * 0.27, -1.65], 0, 8);
    expect(l.wrongWay).toBe(true);
  });

  it('sets onKerb with 0.5 s hysteresis when the centre is beyond the carriageway edge', () => {
    const ctx = makeTestContext(world, g);
    let l = tick(ctx, [-100, -118.5], 0); // r00_10:f0, lane centre
    expect(l.onKerb).toBe(false);
    for (let i = 0; i < 10; i++) l = tick(ctx, [-99 + i * 0.3, -114.5], 0); // 2.5 m right of the lane: 1 m beyond the edge
    expect(l.onKerb).toBe(false); // 0.33 s
    for (let i = 0; i < 8; i++) l = tick(ctx, [-96 + i * 0.3, -114.5], 0);
    expect(l.onKerb).toBe(true);
    for (let i = 0; i < 8; i++) l = tick(ctx, [-93 + i * 0.3, -118.5], 0);
    expect(l.onKerb).toBe(true); // still within the off-hysteresis
    for (let i = 0; i < 10; i++) l = tick(ctx, [-90 + i * 0.3, -118.5], 0);
    expect(l.onKerb).toBe(false);
  });

  it('computes the approach and the stop-line distance from the front bumper', () => {
    const ctx = makeTestContext(world, g);
    tick(ctx, [-1.5, 100], Math.PI / 2); // r11_12:f0 southbound, lane s = 87.9
    const ap = currentApproach(g, ctx)!;
    expect(ap.junction.id).toBe('n12');
    expect(ap.approach.control).toBe('stop');
    expect(ap.laneId).toBe('r11_12:f0');
    expect(ap.onConnector).toBe(false);
    expect(ap.distToStopLine).toBeCloseTo(99.4 - 87.9 - CAR / 2, 1);
    expect(ap.stopLine).toBeDefined();
    // past the line: on the connector, negative distance
    tick(ctx, [-1.5, 110], Math.PI / 2);
    tick(ctx, [-1.3, 113.5], Math.PI / 2 - 0.2);
    const on = currentApproach(g, ctx)!;
    expect(on.onConnector).toBe(true);
    expect(on.distToStopLine).toBeLessThan(-CAR / 2);
    expect(ctx.localiser.distanceToStopLine(ctx)).toBe(on.distToStopLine);
  });

  it('lists the crossings ahead nearest first, including the one just past the lane end', () => {
    const ctx = makeTestContext(world, g);
    tick(ctx, [-1.5, 60], Math.PI / 2); // r11_12:f0, lane s = 47.9
    const list = upcomingCrossings(g, ctx, 80);
    expect(list.map((c) => c.crossing.id)).toEqual(['c_stop']); // c_dekel_s is behind
    expect(list[0]!.distanceToLine).toBeCloseTo(114 - 60 - CAR / 2, 1);
    expect(list[0]!.distance).toBeCloseTo(114 - 60 - CAR / 2 - 1.5, 1);
    const ctx2 = makeTestContext(world, g);
    tick(ctx2, [-100, -118.5], 0); // r00_10:f0 towards the mid-block crossing at x=-60
    const mid = ctx2.localiser.upcomingCrossings(ctx2, 100);
    expect(mid[0]!.crossing.id).toBe('c_mid');
    expect(mid[0]!.distanceToLine).toBeCloseTo(40 - CAR / 2, 1);
    expect(ctx2.localiser.upcomingCrossings(ctx2, 10)).toEqual([]);
  });

  it('reset forgets the previous match', () => {
    const ctx = makeTestContext(world, g);
    tick(ctx, [-5, 1.65], 0);
    ctx.localiser.reset();
    const l = tick(ctx, [-5, 1.65], 0);
    expect(l.insideJunction).toBe(true);
    expect(l.connectorId).toBeDefined();
  });
});
