import { describe, expect, it } from 'vitest';
import { buildTrainingGround } from '@/world/testWorld';
import { RoadGraph } from '@/world/graph';
import { projectOntoPolyline } from '@/world/geo';
import { KERB_HEIGHT, KERB_WIDTH, boxesAlongPolyline, bucketSpecs, buildingHulls, cellKey, cellsAround, kerbEdgesOfLane, kerbSegments, propColliders, worldColliderSpecs } from './colliders';

const world = buildTrainingGround();
const g = new RoadGraph(world);

describe('kerb collider segments', () => {
  it('builds boxes ≤ 20 m long along a polyline with the right orientation', () => {
    const boxes = boxesAlongPolyline([[0, 0], [50, 0]], 'x', 'kerb', KERB_WIDTH / 2, KERB_HEIGHT);
    expect(boxes.length).toBe(3);
    for (const b of boxes) {
      expect(b.half[0] * 2).toBeLessThanOrEqual(20 + 0.2);
      expect(b.half[1] * 2).toBeCloseTo(KERB_HEIGHT, 6);
      expect(b.centre[1]).toBeCloseTo(KERB_HEIGHT / 2, 6);
      expect(b.rotY).toBeCloseTo(0, 6); // eastbound segment: local x already points east
    }
    const south = boxesAlongPolyline([[0, 0], [0, 10]], 'y', 'kerb', 0.1, 0.1);
    expect(south[0]!.rotY).toBeCloseTo(-Math.PI / 2, 6); // rotation.y = −heading
  });

  it('puts a kerb on the right edge of every kerb-side lane and on the left of one-way lane 0', () => {
    const lanes = world.lanes;
    const kerbSide = lanes.filter((l) => l.rightLine === 'kerb');
    expect(kerbSide.length).toBeGreaterThan(0);
    const inner = lanes.filter((l) => l.rightLine !== 'kerb');
    expect(inner.length).toBeGreaterThan(0); // the 2+2 main road has inner lanes
    for (const l of inner) expect(kerbEdgesOfLane(l)).toHaveLength(0);
    const oneway = lanes.filter((l) => g.road(l.roadId).oneway && l.index === 0 && l.leftLine === 'kerb');
    expect(oneway.length).toBeGreaterThan(0);
    for (const l of oneway) expect(kerbEdgesOfLane(l).map((e) => e.side).sort()).toEqual(['left', 'right']);
  });

  it('places the kerb box just outside the lane edge, in the travel frame', () => {
    const lane = g.lane(g.road('r00_01').lanesForward[0]!); // southbound residential lane, kerb on its right (west side)
    const edges = kerbEdgesOfLane(lane);
    expect(edges).toHaveLength(1);
    const boxes = boxesAlongPolyline(edges[0]!.pts, 'k', 'kerb', KERB_WIDTH / 2, KERB_HEIGHT);
    for (const b of boxes) {
      const pr = projectOntoPolyline(lane.centre, [b.centre[0], b.centre[2]]);
      expect(pr.lateral).toBeCloseTo(lane.width / 2 + KERB_WIDTH / 2, 2);
    }
  });

  it('kerbs stop before junctions (lanes are trimmed) — no kerb box inside a junction polygon', () => {
    const boxes = kerbSegments(world);
    expect(boxes.length).toBeGreaterThan(50);
    for (const j of world.junctions) {
      if (!j.polygon) continue;
      for (const b of boxes) {
        const inside = g.insideJunction([b.centre[0], b.centre[2]], j);
        expect(inside).toBe(false);
      }
    }
  });
});

describe('buildings and props', () => {
  it('extrudes building footprints into hull point clouds', () => {
    const hulls = buildingHulls(world);
    expect(hulls.length).toBe(world.buildings.length);
    const h = hulls[0]!;
    const b = world.buildings[0]!;
    expect(h.points.length).toBe(b.footprint.length * 6);
    expect(h.points[1]).toBe(0);
    expect(h.points[4]).toBeCloseTo(b.height, 6);
    expect(h.centre[1]).toBeCloseTo(b.height / 2, 6);
  });

  it('turns trees / lamps / bus stops into r=0.2 cylinders and bumps into shallow boxes across the road', () => {
    const props = propColliders(world);
    const trees = props.filter((p) => p.id.startsWith('prop:tree'));
    expect(trees.length).toBe(world.props.filter((p) => p.kind === 'tree').length);
    for (const t of trees) {
      expect(t.shape).toBe('cylinder');
      if (t.shape === 'cylinder') expect(t.radius).toBeCloseTo(0.2, 6);
    }
    const bus = props.find((p) => p.id.startsWith('prop:bus_stop'));
    expect(bus?.shape).toBe('cylinder');
    const bump = props.find((p) => p.kind === 'bump');
    expect(bump?.shape).toBe('box');
    if (bump && bump.shape === 'box') {
      expect(bump.half[1] * 2).toBeLessThan(0.1);
      expect(bump.half[0] * 2).toBeCloseTo(g.road('r02_12').width, 3);
      expect(bump.rotY).toBeCloseTo(-Math.PI / 2, 3); // eastbound road → the bump runs north-south
    }
  });
});

describe('grid bucketing', () => {
  it('buckets specs by cell and finds the cells around a point', () => {
    const specs = worldColliderSpecs(world);
    const cells = bucketSpecs(specs, 100);
    let total = 0;
    for (const list of cells.values()) total += list.length;
    expect(total).toBe(specs.length);
    expect(cellKey(150, -20, 100)).toBe('1,-1');
    const around = cellsAround(0, 0, 400, 100);
    expect(around).toContain('0,0');
    expect(around).toContain('-1,-1');
    expect(around).toContain('3,0');
    expect(around).not.toContain('6,6');
    // every active spec lies within radius + cell diagonal of the focus
    for (const k of around) {
      for (const s of cells.get(k) ?? []) expect(Math.hypot(s.centre[0], s.centre[2])).toBeLessThan(400 + 150);
    }
  });
});
