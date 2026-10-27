import { describe, expect, it } from 'vitest';
import { compassDegToHeading, createProjector, headingToCompassDeg, headingToRotationY, offsetPolyline, pointAlong, projectOntoPolyline, rotationYToHeading, wrapAngle } from './geo';

describe('geo conventions', () => {
  it('projects north as -z and east as +x', () => {
    const p = createProjector({ lat: 32.125, lon: 34.825 });
    const north = p.toWorld(34.825, 32.135);
    const east = p.toWorld(34.835, 32.125);
    expect(north[0]).toBeCloseTo(0, 6);
    expect(north[1]).toBeLessThan(-1000);
    expect(east[0]).toBeGreaterThan(900);
    expect(east[1]).toBeCloseTo(0, 6);
    const back = p.toLonLat(east[0], east[1]);
    expect(back.lon).toBeCloseTo(34.835, 9);
    expect(back.lat).toBeCloseTo(32.125, 9);
  });

  it('maps headings to compass bearings', () => {
    expect(headingToCompassDeg(0)).toBeCloseTo(90); // east
    expect(headingToCompassDeg(-Math.PI / 2)).toBeCloseTo(0); // north
    expect(headingToCompassDeg(Math.PI / 2)).toBeCloseTo(180); // south
    expect(headingToCompassDeg(Math.PI)).toBeCloseTo(270); // west
    expect(compassDegToHeading(0)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(compassDegToHeading(90))).toBeCloseTo(0);
  });

  it('round-trips three.js rotation.y', () => {
    for (const h of [0, 1, -1, 2.5, -3]) {
      expect(wrapAngle(rotationYToHeading(headingToRotationY(h)) - h)).toBeCloseTo(0, 9);
    }
    // heading north (-π/2) → rotation.y 0 (model forward -z)
    expect(headingToRotationY(-Math.PI / 2)).toBeCloseTo(0);
  });

  it('projects onto a polyline with right-positive lateral offset', () => {
    const line: [number, number][] = [
      [0, 0],
      [100, 0],
    ]; // heading east
    const r = projectOntoPolyline(line, [40, 3]); // +z is south = right of east-bound travel
    expect(r.s).toBeCloseTo(40);
    expect(r.lateral).toBeCloseTo(3);
    expect(r.distance).toBeCloseTo(3);
    const l = projectOntoPolyline(line, [40, -3]);
    expect(l.lateral).toBeCloseTo(-3);
  });

  it('offsets polylines to the right', () => {
    const line: [number, number][] = [
      [0, 0],
      [100, 0],
    ];
    const off = offsetPolyline(line, 2);
    expect(off[0]![1]).toBeCloseTo(2);
    expect(off[1]![1]).toBeCloseTo(2);
    const at = pointAlong(off, 50);
    expect(at.p[0]).toBeCloseTo(50);
    expect(at.h).toBeCloseTo(0);
  });
});
