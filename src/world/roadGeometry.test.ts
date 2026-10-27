import { describe, expect, it } from 'vitest';
import { buildWorld, type BuildInput } from './builder';
import { dist2, type Vec2 } from './geo';
import { RoadGraph } from './graph';
import {
  CentreLine,
  DASH_GAP,
  DASH_LENGTH,
  KERB_WIDTH,
  SIDEWALK_WIDTH,
  STOP_LINE_WIDTH,
  carriagewayRibbon,
  junctionKerbs,
  junctionSurface,
  kerbIntervals,
  kerbPieces,
  laneArrow,
  laneMarkings,
  roadBoundaries,
  roadExtent,
  roundaboutRings,
  sidewalkPieces,
  stopLineMarking,
  zebraMarkings,
} from './roadGeometry';
import { buildTrainingGround } from './testWorld';

/** One straight road from (0,0) to (L,0) between two dead ends. */
function straightWorld(L: number, opts: Partial<BuildInput['roads'][number]> = {}, extra: Partial<BuildInput> = {}) {
  const input: BuildInput = {
    name: 'test',
    origin: { lat: 0, lon: 0 },
    attribution: [],
    nodes: [
      { id: 'a', pos: [0, 0], control: 'none' },
      { id: 'b', pos: [L, 0], control: 'none' },
    ],
    roads: [{ id: 'r', from: 'a', to: 'b', points: [[0, 0], [L, 0]], cls: 'residential', oneway: false, lanesForward: 1, lanesBackward: 1, maxSpeed: 50, ...opts }],
    ...extra,
  };
  const world = buildWorld(input);
  return { world, graph: new RoadGraph(world), road: world.roads[0]! };
}

describe('CentreLine', () => {
  it('slices with perpendicular end sections and mitred interior vertices', () => {
    const cl = new CentreLine([[0, 0], [10, 0], [10, 10]]);
    expect(cl.length).toBeCloseTo(20);
    const s = cl.slice(1, 2, 18); // right of travel: +z on the first leg, -x on the second
    expect(s[0]).toEqual([2, 1]);
    expect(s[s.length - 1]![0]).toBeCloseTo(9);
    expect(s[s.length - 1]![1]).toBeCloseTo(8);
    expect(s.length).toBe(3); // one interior (mitred) vertex at the corner
    expect(s[1]![0]).toBeCloseTo(9);
    expect(s[1]![1]).toBeCloseTo(1);
    // ribbon keeps 1:1 correspondence
    const r = cl.ribbon(-1, 1, 0, 20);
    expect(r.left.length).toBe(r.right.length);
  });
});

describe('carriageway, kerbs and sidewalks', () => {
  const { graph, road } = straightWorld(100);
  const extent = roadExtent(road, graph.lanes);

  it('derives the lane extent from the lanes (between the dead-end setbacks)', () => {
    expect(extent.s0).toBeGreaterThan(0);
    expect(extent.s1).toBeLessThan(100);
    expect(extent.s1 - extent.s0).toBeGreaterThan(80);
  });

  it('builds a ribbon as wide as the road', () => {
    const r = carriagewayRibbon(road, extent);
    expect(r.left.length).toBe(r.right.length);
    for (let i = 0; i < r.left.length; i++) expect(dist2(r.left[i]!, r.right[i]!)).toBeCloseTo(road.width, 6);
    // left edge is north (−z) of the eastbound centre line
    expect(r.left[0]![1]).toBeCloseTo(-road.width / 2);
    expect(r.right[0]![1]).toBeCloseTo(road.width / 2);
  });

  it('puts kerbs just outside the carriageway and sidewalks outside the kerbs', () => {
    const kerbs = kerbPieces(road, extent, []);
    expect(kerbs.length).toBe(2); // plain grey, one piece per side
    for (const k of kerbs) {
      expect(k.colour).toBe('grey');
      expect(k.wall).toBe(true);
      for (let i = 0; i < k.inner.length; i++) {
        expect(Math.abs(k.inner[i]![1])).toBeCloseTo(road.width / 2);
        expect(Math.abs(k.outer[i]![1])).toBeCloseTo(road.width / 2 + KERB_WIDTH);
      }
    }
    const sw = sidewalkPieces(road, extent);
    expect(sw.length).toBe(2);
    for (const s of sw) {
      expect(Math.abs(s.inner[0]![1])).toBeCloseTo(road.width / 2 + KERB_WIDTH);
      expect(Math.abs(s.outer[0]![1])).toBeCloseTo(road.width / 2 + KERB_WIDTH + SIDEWALK_WIDTH);
    }
  });

  it('segments the kerb by parking strips with alternating 1 m colour blocks', () => {
    const strips = [{ id: 'p', roadId: 'r', side: 'right' as const, s0: 20, s1: 70, kerb: 'red_white' as const, layout: 'parallel' as const, bays: [] }];
    const intervals = kerbIntervals(road, 'right', extent, strips);
    expect(intervals.map((i) => i.marking)).toEqual(['none', 'red_white', 'none']);
    expect(intervals[1]!.s0).toBe(20);
    expect(intervals[1]!.s1).toBe(70);
    const pieces = kerbPieces(road, extent, strips);
    const right = pieces.filter((p) => p.inner[0]![1] > 0);
    const coloured = right.filter((p) => p.colour !== 'grey');
    expect(coloured.length).toBe(50);
    expect(coloured[0]!.colour).toBe('red');
    expect(coloured[1]!.colour).toBe('white');
    expect(coloured[49]!.colour).toBe('white');
    expect(right.filter((p) => p.colour === 'grey').length).toBe(2);
    // the left side is untouched
    expect(pieces.filter((p) => p.inner[0]![1] < 0).length).toBe(1);
    // each block is 1 m long
    expect(dist2(coloured[3]!.inner[0]!, coloured[3]!.inner[coloured[3]!.inner.length - 1]!)).toBeCloseTo(1);
  });
});

describe('lane markings', () => {
  it('paints one dashed centre line on a 1+1 residential street (kerb lines are nothing)', () => {
    const { graph, road } = straightWorld(100);
    const extent = roadExtent(road, graph.lanes);
    const lanes = [...road.lanesForward, ...road.lanesBackward].map((id) => graph.lane(id));
    const boundaries = roadBoundaries(road, lanes);
    expect(boundaries.length).toBe(1);
    expect(boundaries[0]!.type).toBe('dashed');
    expect(boundaries[0]!.offset).toBeCloseTo(0, 2);
    const pieces = laneMarkings(road, lanes, extent);
    const expectedDashes = Math.ceil((extent.s1 - extent.s0 - 0.5) / (DASH_LENGTH + DASH_GAP));
    expect(pieces.length).toBe(expectedDashes);
    // every dash is 0.12 wide, centred on z = 0, and starts at the lane start
    const first = pieces[0]!;
    expect(dist2(first.ribbon.left[0]!, first.ribbon.right[0]!)).toBeCloseTo(0.12);
    expect(first.ribbon.left[0]![0]).toBeCloseTo(extent.s0);
    expect(dist2(first.ribbon.left[0]!, first.ribbon.left[1]!)).toBeCloseTo(DASH_LENGTH);
  });

  it('draws each shared boundary once on a 2+2 secondary road (solid centre, dashed lane lines)', () => {
    const { graph, road } = straightWorld(200, { cls: 'secondary', lanesForward: 2, lanesBackward: 2 });
    const lanes = [...road.lanesForward, ...road.lanesBackward].map((id) => graph.lane(id));
    const boundaries = roadBoundaries(road, lanes);
    expect(boundaries.map((b) => b.type)).toEqual(['dashed', 'solid', 'dashed']);
    expect(boundaries.map((b) => Math.round(b.offset * 10) / 10)).toEqual([-3.3, 0, 3.3]);
  });

  it('uses the yellow separator next to a bus lane', () => {
    const { graph, road } = straightWorld(200, { cls: 'secondary', lanesForward: 2, lanesBackward: 1, busLaneForward: true });
    const lanes = [...road.lanesForward, ...road.lanesBackward].map((id) => graph.lane(id));
    const extent = roadExtent(road, graph.lanes);
    const yellow = laneMarkings(road, lanes, extent).filter((m) => m.colour === 'yellow');
    expect(yellow.length).toBe(1);
    expect(roadBoundaries(road, lanes).some((b) => b.type === 'yellow_solid')).toBe(true);
  });

  it('paints lane arrows 8 m before the end of a lane with turn restrictions', () => {
    const { graph, road } = straightWorld(100, { cls: 'secondary', lanesForward: 2, lanesBackward: 2, turnLanesForward: [['left', 'straight'], ['straight', 'right']] });
    const lane = graph.lane(road.lanesForward[1]!);
    const tris = laneArrow(lane);
    expect(tris.length).toBeGreaterThan(4);
    const end = lane.centre[lane.centre.length - 1]!;
    for (const t of tris) for (const p of t) expect(dist2(p, end)).toBeLessThan(12);
    const xs = tris.flat().map((p) => p[0]);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(Math.abs(end[0] - 8 - mid)).toBeLessThan(1.2);
    expect(laneArrow(graph.lane(road.lanesBackward[0]!))).toEqual([]); // no turns → no arrow
  });
});

describe('stop lines and crossings', () => {
  const world = buildTrainingGround();
  const g = new RoadGraph(world);

  it('paints the stop line 0.4 m wide just before the lane ends', () => {
    const n12 = g.junction('n12');
    const ap = n12.approaches.find((a) => a.roadId === 'r11_12')!;
    const pieces = stopLineMarking(ap);
    expect(pieces.length).toBe(1);
    const m = pieces[0]!;
    const [l, r] = ap.stopLine!;
    expect(m.ribbon.left[1]![0]).toBeCloseTo(l[0]);
    expect(m.ribbon.left[1]![1]).toBeCloseTo(l[1]);
    expect(m.ribbon.right[1]![0]).toBeCloseTo(r[0]);
    expect(m.ribbon.right[1]![1]).toBeCloseTo(r[1]);
    expect(dist2(m.ribbon.left[0]!, m.ribbon.left[1]!)).toBeCloseTo(STOP_LINE_WIDTH);
    // traffic on r11_12 heads south (+z): the painted strip lies north of the line (before it)
    expect(m.ribbon.left[0]![1]).toBeLessThan(l[1]);
  });

  it('paints a dashed give-way line on yielding approaches and nothing on priority ones', () => {
    const n01 = g.junction('n01');
    const side = n01.approaches.find((a) => a.roadId === 'r00_01')!;
    expect(side.control).toBe('give_way');
    const dashes = stopLineMarking(side);
    expect(dashes.length).toBeGreaterThan(2);
    for (const d of dashes) expect(dist2(d.ribbon.left[0]!, d.ribbon.left[1]!)).toBeCloseTo(0.3);
    const main = n01.approaches.find((a) => a.roadId === 'r01_11')!;
    expect(main.control).toBe('priority');
    expect(stopLineMarking(main)).toEqual([]);
    const rb = g.junction('rb_w').approaches.find((a) => a.roadId === 'r21_rbw')!;
    expect(stopLineMarking(rb).length).toBeGreaterThan(2);
  });

  it('draws zebra stripes 0.5 m wide with 0.5 m gaps across the carriageway', () => {
    const c = g.crossings.get('c_mid')!;
    const stripes = zebraMarkings(c);
    const len = dist2(c.line[0], c.line[1]);
    expect(stripes.length).toBe(Math.floor((len - 0.6 + 0.5) / 1));
    for (const s of stripes) {
      expect(dist2(s.ribbon.left[0]!, s.ribbon.right[0]!)).toBeCloseTo(0.5);
      expect(dist2(s.ribbon.left[0]!, s.ribbon.left[1]!)).toBeCloseTo(c.width);
    }
    expect(zebraMarkings({ ...c, kind: 'unmarked' })).toEqual([]);
  });
});

describe('roundabouts', () => {
  it('fits the circulating ring of the training ground roundabout and sizes the island', () => {
    const world = buildTrainingGround();
    const g = new RoadGraph(world);
    const rings = roundaboutRings(world.junctions, g.lanes, g.connectors);
    expect(rings.length).toBe(1);
    const r = rings[0]!;
    expect(r.laneIds.length).toBe(4);
    expect(r.centre[0]).toBeCloseTo(310, 0);
    expect(r.centre[1]).toBeCloseTo(0, 0);
    expect(r.radius).toBeCloseTo(14, 0);
    expect(r.islandRadius).toBeLessThan(r.radius - r.laneWidth / 2);
    expect(r.islandRadius).toBeGreaterThan(8);
  });
});

describe('junction surfaces', () => {
  const world = buildTrainingGround();
  const g = new RoadGraph(world);
  const roadById = (id: string) => g.roads.get(id);

  it('classifies the four mouths of the signalised crossroads and kerbs the four corners', () => {
    const surf = junctionSurface(g.junction('n11'), roadById, g.lanes)!;
    expect(surf).toBeDefined();
    expect(surf.polygon.length).toBe(8);
    expect(surf.edges.filter((e) => e.mouth).length).toBe(4);
    expect(surf.edges.filter((e) => !e.mouth).length).toBe(4);
    const { kerbs, sidewalks } = junctionKerbs(surf);
    expect(kerbs.filter((k) => k.wall).length).toBe(4);
    expect(kerbs.filter((k) => !k.wall).length).toBe(8); // two fans per corner edge
    expect(sidewalks.length).toBe(4 + 8);
    // outward normals point away from the junction centre
    for (const e of surf.edges) {
      const mid: Vec2 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
      expect((mid[0] - 0) * e.normal[0] + (mid[1] - 0) * e.normal[1]).toBeGreaterThan(0);
    }
  });

  it('fills polygon-less bends with the hull of the road mouths', () => {
    const { world: w, graph: gg } = straightWorld(100, {}, {
      nodes: [
        { id: 'a', pos: [0, 0], control: 'none' },
        { id: 'm', pos: [100, 0], control: 'auto' },
        { id: 'b', pos: [200, 50], control: 'none' },
      ],
      roads: [
        { id: 'r', from: 'a', to: 'm', points: [[0, 0], [100, 0]], cls: 'residential', oneway: false, lanesForward: 1, lanesBackward: 1, maxSpeed: 50 },
        { id: 'r2', from: 'm', to: 'b', points: [[100, 0], [200, 50]], cls: 'residential', oneway: false, lanesForward: 1, lanesBackward: 1, maxSpeed: 50 },
      ],
    });
    const bend = w.junctions.find((j) => j.id === 'm')!;
    expect(bend.kind).toBe('bend');
    expect(bend.polygon).toBeUndefined();
    const surf = junctionSurface(bend, (id) => gg.roads.get(id), gg.lanes)!;
    expect(surf).toBeDefined();
    expect(surf.polygon.length).toBeGreaterThanOrEqual(4);
    expect(surf.edges.filter((e) => e.mouth).length).toBe(2);
  });
});
