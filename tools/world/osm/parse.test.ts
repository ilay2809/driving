import { describe, expect, it } from 'vitest';
import { FIXTURE_XML } from './fixture';
import { createOsmData, isClosedWay, parseOsmXml, wayNodes } from './parse';

describe('OSM XML parsing', () => {
  it('parses nodes, ways, relations and tags with entities', () => {
    const osm = parseOsmXml(FIXTURE_XML);
    expect(osm.nodes.size).toBe(17);
    expect(osm.ways.size).toBe(7);
    expect(osm.relations.size).toBe(1);
    const n2 = osm.nodes.get(2)!;
    expect(n2.lat).toBeCloseTo(32.125, 6);
    expect(n2.lon).toBeCloseTo(34.825, 6);
    expect(n2.tags?.highway).toBe('traffic_signals');
    expect(osm.nodes.get(1)!.tags).toBeUndefined();
    const way = osm.ways.get(100)!;
    expect(way.nodes).toEqual([1, 9, 2, 3]);
    expect(way.tags.name).toBe('ראשי');
    expect(osm.ways.get(500)!.tags.name).toBe('בניין "הבדיקה"');
    expect(isClosedWay(osm.ways.get(500)!)).toBe(true);
    expect(isClosedWay(way)).toBe(false);
    const rel = osm.relations.get(900)!;
    expect(rel.members).toEqual([
      { type: 'way', ref: 400, role: 'from' },
      { type: 'node', ref: 5, role: 'via' },
      { type: 'way', ref: 201, role: 'to' },
    ]);
    expect(rel.tags.restriction).toBe('no_right_turn');
    expect(wayNodes(osm, way).map((n) => n.id)).toEqual([1, 9, 2, 3]);
  });

  it('de-duplicates elements across tiles by id', () => {
    const data = createOsmData();
    parseOsmXml(FIXTURE_XML, data);
    // a second "tile" repeating node 2 (with different metadata) and way 100, plus a new node
    parseOsmXml(
      `<osm version="0.6"><node id="2" lat="0" lon="0"><tag k="highway" v="stop"/></node><node id="999" lat="32.126" lon="34.826"/><way id="100"><nd ref="1"/><nd ref="3"/><tag k="highway" v="primary"/></way></osm>`,
      data,
    );
    expect(data.nodes.size).toBe(18);
    expect(data.nodes.get(2)!.tags?.highway).toBe('traffic_signals'); // first occurrence wins
    expect(data.ways.get(100)!.tags.highway).toBe('secondary');
    expect(data.ways.get(100)!.nodes.length).toBe(4);
  });

  it('rejects documents without an <osm> root', () => {
    expect(() => parseOsmXml('<foo/>')).toThrow();
  });
});
