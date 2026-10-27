import { describe, expect, it } from 'vitest';
import { buildWorld } from '@/world/builder';
import { createProjector, WORLD_ORIGIN } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import { WorldFileSchema } from '@/world/schema';
import { emptyTlv } from '../tlv';
import { FIXTURE_XML } from './fixture';
import { toBuildInput } from './model';
import { parseOsmXml } from './parse';
import { buildSemanticModel } from './semantics';
import { parseLanes, parseMaxspeedValue, parseParking, parseTurnLanes } from './tags';
import { normaliseName } from '../geom';

function fixtureModel(overrides?: Parameters<typeof buildSemanticModel>[2]['overrides']) {
  const osm = parseOsmXml(FIXTURE_XML);
  return buildSemanticModel(osm, emptyTlv(), { name: 'fixture', seed: 1, overrides, clipToRiver: false });
}

describe('tag parsing', () => {
  it('parses turn:lanes', () => {
    expect(parseTurnLanes('left|through;right|').lanes).toEqual([['left'], ['straight', 'right'], null]);
    expect(parseTurnLanes('none|merge_to_left').lanes).toEqual([null, null]);
    expect(parseTurnLanes('reverse;left|bogus').unknown).toEqual(['bogus']);
    expect(parseTurnLanes('reverse;left').lanes).toEqual([['uturn', 'left']]);
  });
  it('parses maxspeed values', () => {
    expect(parseMaxspeedValue('50')).toBe(50);
    expect(parseMaxspeedValue('IL:urban')).toBe(50);
    expect(parseMaxspeedValue('30 mph')).toBe(48);
    expect(parseMaxspeedValue('fast')).toBeUndefined();
  });
  it('parses lanes for two-way and oneway roads', () => {
    const two = parseLanes({ lanes: '3', 'lanes:forward': '2' }, 'secondary', false, false);
    expect([two.lanesForward, two.lanesBackward]).toEqual([2, 1]);
    const one = parseLanes({ 'turn:lanes': 'left|left|through' }, 'tertiary', false, true);
    expect(one.lanesForward).toBe(3);
    expect(one.turnLanesForward).toEqual([['left'], ['left'], ['straight']]);
    const bus = parseLanes({ lanes: '3', 'psv:lanes': 'yes|yes|designated' }, 'primary', false, true);
    expect(bus.busLaneForward).toBe(true);
    expect(bus.lanesForward).toBe(3);
  });
  it('parses parking tags into kerb kinds', () => {
    expect(parseParking({ 'parking:both': 'no' }, 'left')).toEqual({ kind: 'no' });
    expect(parseParking({ 'parking:right': 'lane', 'parking:right:zone': '12' }, 'right')?.kind).toBe('paid');
    expect(parseParking({ 'parking:lane:left': 'no_stopping' }, 'left')?.kind).toBe('no_stopping');
    expect(parseParking({}, 'right')).toBeUndefined();
  });
  it('normalises street names for matching', () => {
    expect(normaliseName('איינשטיין')).toBe(normaliseName('אינשטיין'));
    expect(normaliseName("ש''י עגנון")).toBe(normaliseName('ש״י עגנון'));
    expect(normaliseName("שד' רוקח")).toBe(normaliseName('שדרות רוקח'));
  });
});

describe('semantics on the fixture', () => {
  const { model } = fixtureModel();
  const proj = createProjector(WORLD_ORIGIN);

  it('builds roads between junction nodes with the right attributes', () => {
    const ids = model.roads.map((r) => r.id).sort();
    // A split at n2 (n9 is interior), B split at n2, B' (lanes differ, so no merge at n5), C, D
    expect(ids).toEqual(['w100_0', 'w100_1', 'w200_0', 'w200_1', 'w201_0', 'w300_0', 'w400_0']);
    const a0 = model.roadById.get('w100_0')!;
    expect(a0.cls).toBe('secondary');
    expect(a0.name).toBe('ראשי');
    expect(a0.nameEn).toBe('Main');
    expect(a0.oneway).toBe(false);
    expect([a0.lanesForward, a0.lanesBackward]).toEqual([1, 1]);
    expect(a0.maxSpeed).toBe(50);
    expect(a0.kerbRight).toBe('red_white');
    expect(a0.from).toBe('n1');
    expect(a0.to).toBe('n2');
    expect(a0.nodeIds).toEqual([1, 9, 2]);
    const b = model.roadById.get('w200_0')!;
    expect(b.zone).toBe('calming_30');
    expect(b.maxSpeed).toBe(30);
    expect(model.nodes.get('n2')!.degree).toBe(4);
    expect(model.nodes.get('n2')!.name).toBe('ראשי / צדדי');
  });

  it('reverses oneway=-1 geometry so lanesForward ≥ 1 in the travel direction', () => {
    const c = model.roadById.get('w300_0')!;
    expect(c.oneway).toBe(true);
    expect(c.from).toBe('n5');
    expect(c.to).toBe('n6');
    expect([c.lanesForward, c.lanesBackward]).toEqual([1, 0]);
    const p5 = proj.toWorld(34.825, 32.1235);
    expect(c.points[0]![0]).toBeCloseTo(p5[0], 3);
    expect(c.points[0]![1]).toBeCloseTo(p5[1], 3);
  });

  it('derives controls: signals at n2, stop on the D approach, turn lanes on D', () => {
    expect(model.nodes.get('n2')!.control).toBe('signals');
    const d = model.roadById.get('w400_0')!;
    expect(d.controlAtTo).toBe('stop');
    expect(d.lanesForward).toBe(2);
    // the no_right_turn relation (D → B' south) removes 'right' from the kerb lane and adds a 428 sign
    expect(d.turnLanesForward).toEqual([['left'], ['straight']]);
    expect(model.signs.some((s) => s.code === '428' && s.roadId === 'w400_0')).toBe(true);
    expect(model.stats.turnRestrictionsApplied).toBe(1);
  });

  it('extracts crossings with arc-length positions', () => {
    const mid = model.crossings.find((c) => c.id === 'c9')!;
    expect(mid.roadId).toBe('w100_0');
    expect(mid.kind).toBe('zebra');
    const a0 = model.roadById.get('w100_0')!;
    expect(mid.s).toBeGreaterThan(a0.length * 0.4);
    expect(mid.s).toBeLessThan(a0.length * 0.6);
    const near = model.crossings.find((c) => c.id === 'c10')!;
    expect(near.roadId).toBe('w200_0');
    expect(near.refuge).toBe(true);
    expect(near.s).toBeGreaterThan(model.roadById.get('w200_0')!.length - 10);
    // crossing-ahead sign 30 m before the mid-block crossing, both directions
    expect(model.signs.filter((s) => s.code === '135' && s.roadId === 'w100_0').length).toBe(2);
    // one-way street entry sign on C, no-parking sign on A (right side)
    expect(model.signs.some((s) => s.code === '618' && s.roadId === 'w300_0')).toBe(true);
    expect(model.signs.some((s) => s.code === '432' && s.roadId === 'w100_0' && s.direction === 'forward')).toBe(true);
  });

  it('extracts buildings, trees and bus stops', () => {
    expect(model.buildings.length).toBe(1);
    const b = model.buildings[0]!;
    expect(b.id).toBe('b500');
    expect(b.height).toBe(13);
    expect(b.levels).toBe(4);
    expect(b.name).toBe('בניין "הבדיקה"');
    expect(b.footprint.length).toBe(4);
    expect(model.props.filter((p) => p.kind === 'tree').length).toBe(1);
    const stop = model.props.find((p) => p.kind === 'bus_stop')!;
    expect(stop.name).toBe('תחנה');
    expect(stop.roadId).toBeDefined();
    expect(model.signs.some((s) => s.code === '505')).toBe(true);
    expect(model.parking.some((p) => p.kerb === 'red_yellow')).toBe(true);
  });

  it('produces a BuildInput that the builder turns into a valid world', () => {
    const input = toBuildInput(model, '2026-01-01T00:00:00.000Z');
    const world = buildWorld(input);
    expect(() => WorldFileSchema.parse(world)).not.toThrow();
    const g = new RoadGraph(world);
    // lane counts
    expect(g.road('w100_0').lanesForward.length).toBe(1);
    expect(g.road('w100_0').lanesBackward.length).toBe(1);
    expect(g.road('w400_0').lanesForward.length).toBe(2);
    expect(g.road('w300_0').lanesBackward.length).toBe(0);
    // the one-way street can only be entered from n5 and ends at a dead end (a one-way sink)
    expect(g.lane('w300_0:f0').prev.length).toBeGreaterThan(0);
    expect(g.junction(g.lane('w300_0:f0').to).kind).toBe('dead_end');
    expect(g.lane('w300_0:f0').next.length).toBe(0);
    // signals at n2 with a controller and pedestrian group for the approach crossing
    const n2 = g.junction('n2');
    expect(n2.approaches.every((a) => a.control === 'signals')).toBe(true);
    expect(n2.signalController).toBeDefined();
    const fromNorth = n2.approaches.find((a) => a.roadId === 'w200_0')!;
    expect(fromNorth.crossingId).toBe('c10');
    expect(g.crossings.get('c10')!.kind).toBe('signals');
    // stop sign on D at n5 and a 302 sign emitted by the builder
    const n5 = g.junction('n5');
    expect(n5.approaches.find((a) => a.roadId === 'w400_0')!.control).toBe('stop');
    expect(world.signs.some((s) => s.code === '302' && s.junctionId === 'n5')).toBe(true);
    // D's left lane may only turn left (north), its right lane goes straight into C and never right into B'
    const left = g.lane('w400_0:f0');
    const right = g.lane('w400_0:f1');
    expect(left.turns).toEqual(['left']);
    expect(g.connectorsFrom(left.id).every((c) => c.turn === 'left' || c.turn === 'slight_left' || c.turn === 'sharp_left')).toBe(true);
    expect(g.connectorsFrom(right.id).some((c) => c.toLane === 'w300_0:f0')).toBe(true);
    expect(g.connectorsFrom(right.id).some((c) => c.toLane.startsWith('w201_0:'))).toBe(false);
    // mid-block crossing kept as such
    const mid = g.crossings.get('c9')!;
    expect(mid.junctionId).toBeUndefined();
    expect(mid.laneIds).toContain('w100_0:f0');
    // no lane is left without a connector
    expect(world.lanes.filter((l) => l.next.length === 0 && g.junction(l.to).kind !== 'dead_end').length).toBe(0);
  });
});
