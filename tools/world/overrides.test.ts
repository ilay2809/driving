import { describe, expect, it } from 'vitest';
import { buildWorld } from '@/world/builder';
import { RoadGraph } from '@/world/graph';
import { emptyOverrides, loadOverrides, OverridesSchema } from './overrides';
import { FIXTURE_XML } from './osm/fixture';
import { toBuildInput } from './osm/model';
import { parseOsmXml } from './osm/parse';
import { buildSemanticModel } from './osm/semantics';
import { emptyTlv } from './tlv';

function build(overrides = emptyOverrides()) {
  const osm = parseOsmXml(FIXTURE_XML);
  const result = buildSemanticModel(osm, emptyTlv(), { name: 'fixture', seed: 1, overrides, clipToRiver: false });
  const world = buildWorld(toBuildInput(result.model, '2026-01-01T00:00:00.000Z'));
  return { ...result, world, graph: new RoadGraph(world) };
}

describe('overrides', () => {
  it('loads an empty file set when the path is missing and validates the schema', () => {
    expect(loadOverrides('/nonexistent/overrides.json')).toEqual(emptyOverrides());
    expect(() => OverridesSchema.parse({ nodeControls: [{ at: [1, 2], control: 'bogus' }] })).toThrow();
    const ov = OverridesSchema.parse({ laneOverrides: [{ osmWayId: 1, oneway: -1 }] });
    expect(ov.laneOverrides[0]!.oneway).toBe(-1);
    expect(ov.extraCrossings).toEqual([]);
  });

  it('applies node and approach controls', () => {
    const ov = OverridesSchema.parse({
      nodeControls: [{ at: [34.825, 32.1235], control: 'all_stop' }],
      approachControls: [{ roadName: 'צדדי', nearJunctionAt: [34.825, 32.125], control: 'give_way' }],
    });
    const { model, overrideReport, graph } = build(ov);
    expect(overrideReport.applied).toBe(2);
    expect(overrideReport.failed).toEqual([]);
    expect(model.nodes.get('n5')!.control).toBe('all_stop');
    expect(graph.junction('n5').approaches.every((a) => a.control === 'stop')).toBe(true);
    // n2 is signalised so the approach override is recorded on the road but the builder keeps signals
    expect(model.roadById.get('w200_0')!.controlAtTo).toBe('give_way');
  });

  it('removes ways, changes lanes, reverses direction, adds crossings and signs', () => {
    const ov = OverridesSchema.parse({
      removeWays: [300],
      laneOverrides: [
        { osmWayId: 100, lanesForward: 2, lanesBackward: 2, maxSpeed: 60 },
        { osmWayId: 400, oneway: -1 },
      ],
      extraCrossings: [{ at: [34.8260, 32.1250], kind: 'zebra' }],
      extraSigns: [{ at: [34.8235, 32.12495], code: '426', value: 40, bearingDeg: 90 }],
    });
    const { model, overrideReport, world, graph } = build(ov);
    expect(overrideReport.failed).toEqual([]);
    expect(model.roads.some((r) => r.osmWayIds.includes(300))).toBe(false);
    expect(model.stats.waysRemovedByOverride).toBe(1);
    const a = graph.road('w100_0');
    expect(a.lanesForward.length).toBe(2);
    expect(a.lanesBackward.length).toBe(2);
    expect(graph.lane(a.lanesForward[0]!).maxSpeed).toBe(60);
    const d = model.roadById.get('w400_0')!;
    expect(d.from).toBe('n5'); // reversed: now flows away from the junction
    expect(d.to).toBe('n8');
    expect(d.oneway).toBe(true);
    expect(world.crossings.some((c) => c.id === 'c_ov0' && c.roadId === 'w100_1')).toBe(true);
    const sign = world.signs.find((s) => s.id === 'sg_ov0')!;
    expect(sign.code).toBe('426');
    expect(sign.value).toBe(40);
    expect(sign.roadId).toBe('w100_0');
    expect(sign.laneIds).toEqual(graph.road('w100_0').lanesForward); // eastbound traffic reads it
  });

  it('reports overrides that match nothing', () => {
    const ov = OverridesSchema.parse({ nodeControls: [{ at: [34.9, 32.2], control: 'signals' }], laneOverrides: [{ osmWayId: 12345, lanesForward: 2 }] });
    const { overrideReport } = build(ov);
    expect(overrideReport.applied).toBe(0);
    expect(overrideReport.failed.length).toBe(2);
  });
});
