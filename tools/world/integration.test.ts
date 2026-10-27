/**
 * Builds the real North Tel Aviv world from data/raw when the cached data is present
 * (skipped otherwise, e.g. in a fresh checkout) and checks the output is sane.
 */
import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { parseWorld } from '@/world/schema';
import { RAW_OSM_DIR } from './area';
import { buildNorthTlv, roundingReplacer } from './build-world';

const hasData = existsSync(RAW_OSM_DIR) && readdirSync(RAW_OSM_DIR).some((f) => f.endsWith('.osm'));

describe.skipIf(!hasData)('north-tlv world build (real data)', () => {
  it(
    'builds a large, valid, routable world',
    () => {
      const r = buildNorthTlv();
      const w = r.world;
      expect(w.name).toBe('north-tlv');
      expect(w.roads.length).toBeGreaterThan(1500);
      expect(w.junctions.length).toBeGreaterThan(500);
      expect(w.buildings.length).toBeGreaterThan(5000);
      expect(w.signals.length).toBeGreaterThan(50);
      expect(w.crossings.length).toBeGreaterThan(200);
      expect(w.areas.some((a) => a.kind === 'water')).toBe(true);
      expect(w.props.filter((p) => p.kind === 'tree').length).toBeLessThanOrEqual(9000);
      // spawn points: the fixed ids, each on a lane
      const ids = ['tlv_test_start', 'tlv_university', 'tlv_einstein', 'tlv_namir_rokach', 'tlv_kochav', 'tlv_afeka', 'tlv_telbaruch', 'tlv_hadaryosef', 'tlv_tzahala', 'tlv_ramathahayal', 'tlv_lamed', 'tlv_neveavivim', 'tlv_glilot'];
      const g = new RoadGraph(w);
      for (const id of ids) {
        const sp = g.spawnPoints.get(id);
        expect(sp, id).toBeDefined();
        expect(sp!.laneId && g.lanes.has(sp!.laneId), id).toBe(true);
      }
      // routes: ≥ 4 test routes + tours, all valid
      expect(w.routes.filter((x) => x.kind === 'test').length).toBeGreaterThanOrEqual(4);
      expect(w.routes.filter((x) => x.kind === 'tour').length).toBeGreaterThanOrEqual(2);
      expect(r.validation.invalidRoutes).toEqual([]);
      expect(r.validation.danglingLanes).toEqual([]);
      expect(r.validation.duplicateIds).toEqual([]);
      expect(r.validation.zeroLengthRoads).toEqual([]);
      expect(r.validation.spawnsWithoutLane).toEqual([]);
      // most drive lanes are mutually reachable
      expect(r.validation.largestSccLanes).toBeGreaterThan(w.lanes.length * 0.85);
      // the serialised file round-trips and stays within the size budget
      const json = JSON.stringify(w, roundingReplacer);
      expect(() => parseWorld(JSON.parse(json))).not.toThrow();
      expect(r.gz.length).toBeLessThan(4.6e6);
    },
    300_000,
  );
});
