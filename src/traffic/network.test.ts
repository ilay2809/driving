import { describe, expect, it } from 'vitest';
import { projectOntoPolyline } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { TrafficNetwork } from './network';
import { SidewalkNetwork } from './sidewalks';
import { obbGap, polylineCrossingS, segmentIntersection } from './util';
import { canStopWithin, idmAcceleration, speedAllowedAt } from './idm';
import { IDM } from './constants';

const world = buildTrainingGround();
const graph = new RoadGraph(world);

describe('geometry helpers', () => {
  it('intersects segments and polylines', () => {
    expect(segmentIntersection([0, 0], [10, 0], [5, -1], [5, 1])).toMatchObject({ t: 0.5, u: 0.5 });
    expect(segmentIntersection([0, 0], [10, 0], [12, -1], [12, 1])).toBeUndefined();
    expect(polylineCrossingS([[0, 0], [10, 0], [10, 10]], [10, 5], [11, 5])).toBeCloseTo(15); // tolerance extends the crossing line
  });
  it('measures oriented box gaps', () => {
    const a = { pos: [0, 0] as [number, number], heading: 0, length: 4, width: 2 };
    const b = { pos: [6, 0] as [number, number], heading: 0, length: 4, width: 2 };
    expect(obbGap(a, b)).toBeCloseTo(2);
    const c = { pos: [2.5, 0] as [number, number], heading: Math.PI / 2, length: 4, width: 2 };
    expect(obbGap(a, c)).toBeLessThan(0);
    expect(obbGap(a, { ...c, pos: [3, 0] })).toBeCloseTo(0);
  });
});

describe('IDM', () => {
  it('accelerates on a free road and brakes behind a close leader', () => {
    expect(idmAcceleration(0, 14, Infinity, 0)).toBeCloseTo(IDM.aMax);
    expect(idmAcceleration(14, 14, Infinity, 0)).toBeCloseTo(0);
    expect(idmAcceleration(14, 14, 10, 14)).toBeLessThan(-3);
    expect(idmAcceleration(0, 14, IDM.s0, 0)).toBeCloseTo(0, 5); // equilibrium at the jam distance
  });
  it('speed lookahead and stopping distances are consistent', () => {
    expect(speedAllowedAt(0, 50, 2)).toBeCloseTo(Math.sqrt(200));
    expect(canStopWithin(10, 25, 2)).toBe(true);
    expect(canStopWithin(10, 24, 2)).toBe(false);
  });
});

describe('TrafficNetwork', () => {
  const net = new TrafficNetwork(world, graph);
  it('locates crossings along lanes and connectors', () => {
    const mid = net.seg('r00_10:f0');
    expect(mid.crossings.length).toBe(1);
    expect(mid.crossings[0]!.crossing.id).toBe('c_mid');
    // road s = 60; the lane starts after the setback of the bend at n00
    const laneStartS = projectOntoPolyline(graph.road('r00_10').centre, graph.lane('r00_10:f0').centre[0]!).s;
    expect(mid.crossings[0]!.s).toBeCloseTo(60 - laneStartS, 1);
    // the approach crossing before the stop sign lies on the connectors leaving the stop line
    const conn = net.seg('n12:r11_12:f0>r12_22:f0');
    expect(conn.crossings.map((c) => c.crossing.id)).toEqual(['c_stop']);
    expect(conn.crossings[0]!.s).toBeGreaterThan(1);
    expect(conn.crossings[0]!.s).toBeLessThan(4);
    const segs = net.segmentsCrossing('c_stop').map((x) => x.seg.id).sort();
    expect(segs).toContain('n12:r11_12:f0>r12_22:f0');
    expect(segs).toContain('n12:r02_12:f0>r11_12:b0');
  });
  it('finds the segments upstream of a connector with distances', () => {
    const up = net.upstream('rb_w:rb4:f0>rb1:f0', 60);
    expect(up[0]!.seg.id).toBe('rb4:f0');
    expect(up[0]!.offset).toBe(0);
    const rb3 = up.find((u) => u.seg.id === 'rb3:f0');
    expect(rb3).toBeDefined();
    expect(rb3!.offset).toBeCloseTo(net.seg('rb4:f0').length + net.seg('rb_n:rb3:f0>rb4:f0').length, 5);
  });
  it('projects bus stops onto lanes', () => {
    expect(net.busStops.size).toBe(1);
    const stop = net.busStops.get('r02_12:f0');
    expect(stop).toBeDefined();
    expect(stop!.s).toBeCloseTo(70 - projectOntoPolyline(graph.road('r02_12').centre, graph.lane('r02_12:f0').centre[0]!).s, 0);
    expect(net.hasBusInfrastructure).toBe(true);
  });
});

describe('SidewalkNetwork', () => {
  const sw = new SidewalkNetwork(world, graph);
  it('has sidewalks on both sides of every road and an edge per crossing', () => {
    const ring = new Set(world.junctions.flatMap((j) => j.roundabout?.ringLaneIds ?? []).map((id) => graph.lane(id).roadId));
    for (const r of world.roads) {
      if (!ring.has(r.id)) expect(sw.byRoadSide.get(`${r.id}:L`)!.length).toBeGreaterThan(0); // ring roads: the island side is not walkable
      expect(sw.byRoadSide.get(`${r.id}:R`)!.length).toBeGreaterThan(0);
    }
    for (const c of world.crossings) {
      const e = sw.crossingEdges.get(c.id);
      expect(e).toBeDefined();
      expect(e!.crossing!.sB - e!.crossing!.sA).toBeCloseTo(Math.hypot(c.line[1][0] - c.line[0][0], c.line[1][1] - c.line[0][1]) + 0.4, 1);
    }
  });
  it('is connected around junction corners', () => {
    // flood fill from an arbitrary node must reach (almost) all nodes
    const start = sw.nodes.find((n) => n.edges.length > 0)!;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const n = queue.pop()!;
      for (const e of n.edges) {
        const o = e.a === n ? e.b : e.a;
        if (!seen.has(o)) {
          seen.add(o);
          queue.push(o);
        }
      }
    }
    const active = sw.nodes.filter((n) => n.edges.length > 0);
    expect(seen.size).toBe(active.length);
  });
  it('samples random sidewalk points and finds the opposite side', () => {
    const rng = () => 0.37;
    const pt = sw.randomSidewalkPoint(rng)!;
    expect(pt.edge.kind).toBe('sidewalk');
    const opp = sw.oppositeSidewalk(pt.edge.roadId!, pt.edge.side!, (pt.edge.s0! + pt.edge.s1!) / 2);
    expect(opp).toBeDefined();
    expect(opp!.edge.side).not.toBe(pt.edge.side);
  });
});
