import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import type { Vec2 } from '@/world/geo';
import { alongPolyline, bodyDistance, bodyPointDistance, carriagewayEdges, frontBumper, rearBumper, relativeSpeed, segmentDistance } from './geometry';

describe('geometry helpers', () => {
  it('projects onto a polyline and extrapolates beyond both ends', () => {
    const pts: Vec2[] = [
      [0, 0],
      [10, 0],
    ];
    expect(alongPolyline(pts, [5, 1]).s).toBeCloseTo(5);
    expect(alongPolyline(pts, [5, 1]).lateral).toBeCloseTo(1); // +z is to the right of east
    expect(alongPolyline(pts, [13, 0]).s).toBeCloseTo(13);
    expect(alongPolyline(pts, [13, -1]).lateral).toBeCloseTo(-1);
    expect(alongPolyline(pts, [-2, 0.5]).s).toBeCloseTo(-2);
    expect(alongPolyline(pts, [-2, 0.5]).lateral).toBeCloseTo(0.5);
    expect(alongPolyline(pts, [13, 0]).distance).toBeCloseTo(3);
  });

  it('computes bumpers, body clearance and relative speed', () => {
    const car = { pos: [0, 0] as Vec2, heading: 0, length: 4, width: 2 };
    expect(frontBumper(car)[0]).toBeCloseTo(2);
    expect(rearBumper(car)[0]).toBeCloseTo(-2);
    const ahead = { pos: [10, 0] as Vec2, heading: 0, length: 4, width: 2 };
    expect(bodyDistance(car, ahead)).toBeCloseTo(6);
    const beside = { pos: [0, 2.5] as Vec2, heading: 0, length: 4, width: 2 };
    expect(bodyDistance(car, beside)).toBeCloseTo(0.5);
    const overlapping = { pos: [1, 0] as Vec2, heading: Math.PI / 2, length: 4, width: 2 };
    expect(bodyDistance(car, overlapping)).toBe(0);
    expect(bodyPointDistance(car, [0, 3], 0.25)).toBeCloseTo(1.75);
    expect(segmentDistance([0, 0], [1, 0], [0.5, -1], [0.5, 1])).toBe(0);
    expect(relativeSpeed({ heading: 0, speed: 10 }, { heading: 0, speed: 8 })).toBeCloseTo(2);
    expect(relativeSpeed({ heading: 0, speed: 10 }, { heading: Math.PI, speed: 10 })).toBeCloseTo(20);
  });

  it('derives carriageway edges from the road layout', () => {
    const g = new RoadGraph(buildTrainingGround());
    const main = carriagewayEdges(g.road('r01_11')); // 2 + 2 lanes of 3.3 m
    expect(main.left).toBeCloseTo(-6.6);
    expect(main.right).toBeCloseTo(6.6);
    const oneway = carriagewayEdges(g.road('r02_12')); // single centred lane of 3 m
    expect(oneway.left).toBeCloseTo(-1.5);
    expect(oneway.right).toBeCloseTo(1.5);
    const res = carriagewayEdges(g.road('r00_10')); // 1 + 1 lanes of 3 m
    expect(res.left).toBeCloseTo(-3);
    expect(res.right).toBeCloseTo(3);
  });
});
