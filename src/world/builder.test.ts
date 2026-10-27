import { describe, expect, it } from 'vitest';
import { buildTrainingGround } from './testWorld';
import { RoadGraph } from './graph';
import { classifyTurn, convexHull, slicePolyline } from './builder';
import { WorldFileSchema } from './schema';

describe('builder primitives', () => {
  it('classifies turns (positive = clockwise = right)', () => {
    expect(classifyTurn(0, 0)).toBe('straight');
    expect(classifyTurn(0, Math.PI / 2)).toBe('right'); // east → south
    expect(classifyTurn(0, -Math.PI / 2)).toBe('left'); // east → north
    expect(classifyTurn(0, Math.PI)).toBe('uturn');
    expect(classifyTurn(-Math.PI / 2, 0)).toBe('right'); // north → east
  });
  it('slices polylines by arc length', () => {
    const s = slicePolyline([[0, 0], [10, 0], [20, 0]], 2, 15);
    expect(s[0]).toEqual([2, 0]);
    expect(s[s.length - 1]).toEqual([15, 0]);
    expect(s).toContainEqual([10, 0]);
  });
  it('computes convex hulls', () => {
    const h = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]);
    expect(h.length).toBe(4);
  });
});

describe('training ground world', () => {
  const world = buildTrainingGround();
  const g = new RoadGraph(world);

  it('validates against the schema and has the expected structure', () => {
    expect(() => WorldFileSchema.parse(world)).not.toThrow();
    expect(world.lanes.length).toBeGreaterThan(20);
    expect(world.junctions.length).toBeGreaterThan(9);
    expect(world.connectors.length).toBeGreaterThan(30);
    expect(world.signals.length).toBe(1);
    expect(world.crossings.length).toBe(6);
    // every connector references existing lanes and lanes point back
    for (const c of world.connectors) {
      expect(g.lanes.has(c.fromLane)).toBe(true);
      expect(g.lanes.has(c.toLane)).toBe(true);
      expect(g.lane(c.fromLane).next).toContain(c.id);
      expect(g.lane(c.toLane).prev).toContain(c.id);
    }
  });

  it('builds a 2+2 main road with lanes offset to the right of travel', () => {
    const road = g.road('r01_11');
    expect(road.lanesForward.length).toBe(2);
    expect(road.lanesBackward.length).toBe(2);
    const f0 = g.lane(road.lanesForward[0]!); // leftmost eastbound lane → just south of the centre (z > 0)
    const f1 = g.lane(road.lanesForward[1]!);
    expect(f0.centre[0]![1]).toBeGreaterThan(0);
    expect(f1.centre[0]![1]).toBeGreaterThan(f0.centre[0]![1]);
    const b0 = g.lane(road.lanesBackward[0]!); // westbound: z < 0 and runs east→west
    expect(b0.centre[0]![1]).toBeLessThan(0);
    expect(b0.centre[0]![0]).toBeGreaterThan(b0.centre[b0.centre.length - 1]![0]);
    expect(f0.turns).toEqual(['left', 'straight']);
    expect(f1.turns).toEqual(['straight', 'right']);
  });

  it('gives side streets give-way at the main road and signals at the centre', () => {
    const n01 = g.junction('n01');
    const side = n01.approaches.find((a) => a.roadId === 'r00_01')!;
    expect(side.control).toBe('give_way');
    const mainIn = n01.approaches.find((a) => a.roadId === 'r01_11')!;
    expect(mainIn.control).toBe('priority');
    const n11 = g.junction('n11');
    expect(n11.approaches.every((a) => a.control === 'signals')).toBe(true);
    expect(n11.signalController).toBeDefined();
    const ctrl = g.signals.get(n11.signalController!)!;
    expect(ctrl.phases.length).toBe(2);
    expect(ctrl.groups.filter((x) => x.pedestrian).length).toBe(4);
    // every vehicle connector at n11 has a signal group
    for (const cid of n11.connectors) expect(g.connector(cid).signalGroup).toBeDefined();
  });

  it('places a stop sign and a stop line on the stop-controlled approach', () => {
    const n12 = g.junction('n12');
    const ap = n12.approaches.find((a) => a.roadId === 'r11_12')!;
    expect(ap.control).toBe('stop');
    expect(ap.stopLine).toBeDefined();
    expect(ap.crossingId).toBe('c_stop');
    const sign = world.signs.find((s) => s.junctionId === 'n12' && s.code === '302');
    expect(sign).toBeDefined();
  });

  it('applies the right-hand rule at the T-junction n10', () => {
    const n10 = g.junction('n10');
    expect(n10.approaches.every((a) => a.control === 'right_hand_rule')).toBe(true);
    const conns = n10.connectors.map((id) => g.connector(id));
    // westbound straight on row 0 (arriving from the east arm) …
    const westboundStraight = conns.find((c) => c.fromLane === 'r10_20:b0' && c.turn === 'straight')!;
    // … versus northbound traffic from the south arm turning left into the same westbound lane
    const northboundLeft = conns.find((c) => c.fromLane === 'r10_11:b0' && c.turn === 'left')!;
    const northboundRight = conns.find((c) => c.fromLane === 'r10_11:b0' && c.turn === 'right')!;
    expect(westboundStraight).toBeDefined();
    expect(northboundLeft).toBeDefined();
    expect(northboundRight).toBeDefined();
    expect(northboundLeft.toLane).toBe(westboundStraight.toLane);
    // the westbound driver has the south arm on the LEFT → keeps priority; the northbound driver sees the east arm on the RIGHT → yields
    expect(northboundLeft.yieldTo).toContain(westboundStraight.id);
    expect(westboundStraight.yieldTo).not.toContain(northboundLeft.id);
    // a right turn from the south does not conflict with the westbound lane (it stays on the south side)
    expect(northboundRight.yieldTo).not.toContain(westboundStraight.id);
    // no straight movement exists for the stem of a T-junction
    expect(conns.find((c) => c.fromLane === 'r10_11:b0' && c.turn === 'straight')).toBeUndefined();
  });

  it('makes roundabout entries yield to the ring', () => {
    const rbw = g.junction('rb_w');
    expect(rbw.kind).toBe('roundabout');
    const entry = rbw.approaches.find((a) => a.roadId === 'r21_rbw')!;
    expect(entry.control).toBe('roundabout_entry');
    const ringAp = rbw.approaches.find((a) => a.roadId === 'rb4')!;
    expect(ringAp.control).toBe('priority');
    const entryConn = rbw.connectors.map((id) => g.connector(id)).filter((c) => c.fromLane === 'r21_rbw:f0');
    expect(entryConn.length).toBeGreaterThan(0);
    const ringConn = rbw.connectors.map((id) => g.connector(id)).find((c) => c.fromLane === 'rb4:f0' && c.toLane === 'rb1:f0');
    expect(ringConn).toBeDefined();
    expect(entryConn.some((c) => c.yieldTo.includes(ringConn!.id))).toBe(true);
  });

  it('routes across the town and through the roundabout', () => {
    const p = g.findPath('r00_01:f0', 'rbn_out:f0');
    expect(p).toBeDefined();
    expect(p!.laneIds[0]).toBe('r00_01:f0');
    expect(p!.laneIds[p!.laneIds.length - 1]).toBe('rbn_out:f0');
    expect(p!.connectorIds.length).toBeGreaterThan(2);
    const tour = g.routeViaJunctions('r00_01:f0', world.routes[0]!.waypoints);
    expect(tour).toBeDefined();
  });

  it('map-matches positions to lanes with heading preference', () => {
    // a point on the main road, slightly south of the centre, heading east → eastbound lane f0
    const m = g.nearestLane([-60, 1.6], { heading: 0 });
    expect(m).toBeDefined();
    expect(m!.lane.id).toBe('r01_11:f0');
    expect(Math.abs(m!.lateral)).toBeLessThan(0.5);
    // same point heading west → westbound lane is preferred despite larger distance
    const w = g.nearestLane([-60, 1.6], { heading: Math.PI });
    expect(w!.lane.id.startsWith('r01_11:b')).toBe(true);
  });

  it('does not let the one-way street be entered against its direction', () => {
    const r = g.road('r02_12');
    expect(r.lanesBackward.length).toBe(0);
    const n12 = g.junction('n12');
    // no connector from the n12 approaches into r02_12 (which only flows INTO n12)
    const bad = n12.connectors.map((id) => g.connector(id)).filter((c) => c.toLane.startsWith('r02_12:'));
    expect(bad.length).toBe(0);
  });
});
