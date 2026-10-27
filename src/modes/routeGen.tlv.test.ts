/**
 * The practical-test routes on the real North Tel Aviv world (skipped when the generated
 * world file is missing): the hand-made routes resolve from the test start, the random
 * generator produces plausible 6–8 km city routes, and the examiner finds places for its
 * manoeuvres on the real network.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { parseWorld, type WorldFile } from '@/world/schema';
import { createRng, DEFAULT_SETTINGS } from '@/core/sim';
import { EventBus } from '@/core/events';
import { DialogueManager } from '@/coach/dialogue';
import { Navigator } from '@/coach/navigator';
import { Examiner } from '@/coach/examiner';
import { RouteModel } from '@/coach/routeModel';
import { generateRoute } from './routeGen';
import { oppositeStart, startsWithUturn } from './testMode';

const GZ = 'public/world/north-tlv.json.gz';
const has = existsSync(GZ);

function examinerFor(g: RoadGraph, route: ReturnType<typeof generateRoute>, seed: number): Examiner {
  const bus = new EventBus();
  const dm = new DialogueManager(bus, { ...DEFAULT_SETTINGS, tts: false }, { tts: undefined });
  const nav = new Navigator(g, bus, dm);
  return new Examiner(bus, dm, g, nav, { route, routeId: 'x', seed });
}

describe.skipIf(!has)('practical-test routes on the north-tlv world', () => {
  let world: WorldFile;
  let g: RoadGraph;
  let start: string;
  let startPos: [number, number];
  beforeAll(() => {
    world = parseWorld(JSON.parse(gunzipSync(readFileSync(GZ)).toString('utf8')));
    g = new RoadGraph(world);
    const sp = g.spawnPoints.get('tlv_test_start')!;
    expect(sp).toBeDefined();
    start = g.nearestLane(sp.pos, { heading: sp.heading, maxDist: 10 })!.lane.id;
    startPos = sp.pos;
  }, 60_000);

  it('hand-made test routes resolve from the start and are 6–9 km', () => {
    const tests = world.routes.filter((r) => r.kind === 'test');
    expect(tests.length).toBeGreaterThanOrEqual(4);
    for (const r of tests) {
      const p = g.routeViaJunctions(start, r.waypoints);
      expect(p, r.id).toBeDefined();
      expect(p!.length, r.id).toBeGreaterThan(6000);
      expect(p!.length, r.id).toBeLessThan(9500);
      // a route that leaves the other way has an equivalent start on the opposite lane without the U-turn
      if (startsWithUturn(g, p!)) {
        const flipped = oppositeStart(g, start, startPos)!;
        expect(flipped).toBeDefined();
        const alt = g.routeViaJunctions(flipped.laneId, r.waypoints)!;
        expect(alt, r.id).toBeDefined();
        expect(startsWithUturn(g, alt), r.id).toBe(false);
      }
    }
  }, 60_000);

  it('the random generator produces plausible 6–8 km city routes with turns and (almost) no U-turns', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const p = generateRoute(g, start, { rng: createRng(seed), targetLength: 6500 });
      expect(p.length, `seed ${seed}`).toBeGreaterThanOrEqual(6000);
      expect(p.length, `seed ${seed}`).toBeLessThanOrEqual(8200);
      const turns = p.connectorIds.map((c) => g.connector(c).turn);
      expect(turns.filter((t) => t === 'uturn').length, `seed ${seed} U-turns`).toBeLessThanOrEqual(1);
      expect(turns.filter((t) => t === 'left' || t === 'right').length, `seed ${seed} turns`).toBeGreaterThanOrEqual(8);
      const classes = new Set(p.laneIds.map((l) => g.road(g.lane(l).roadId).cls));
      expect(classes.has('motorway'), `seed ${seed} classes`).toBe(false);
      expect(new Set(p.laneIds.map((l) => g.lane(l).roadId)).size, `seed ${seed} roads`).toBeGreaterThan(25);
      const lastLane = g.lane(p.laneIds[p.laneIds.length - 1]!);
      expect(lastLane.length, `seed ${seed} end lane`).toBeGreaterThanOrEqual(40);
      expect(g.junction(lastLane.to).kind, `seed ${seed} end`).not.toBe('dead_end');
    }
  }, 60_000);

  it('the examiner places its manoeuvres on the real network, spread along the route', () => {
    const routes = [
      ...world.routes.filter((r) => r.kind === 'test').map((r) => g.routeViaJunctions(start, r.waypoints)!),
      ...[1, 2, 3].map((seed) => generateRoute(g, start, { rng: createRng(seed), targetLength: 6500 })),
    ];
    for (const route of routes) {
      const ex = examinerFor(g, route, 3);
      const model = new RouteModel(g, route);
      const kinds = ex.plan.map((p) => p.kind);
      expect(kinds).toContain('pull_over');
      expect(kinds).toContain('reverse');
      expect(new Set(kinds).size).toBeGreaterThanOrEqual(4);
      const starts = ex.plan.map((p) => model.segments[p.segmentIndex]!.start + p.triggerS);
      expect(Math.min(...starts)).toBeGreaterThanOrEqual(250);
      for (const p of ex.plan) {
        expect(g.lanes.has(p.laneId)).toBe(true);
        expect(p.segmentIndex).toBeLessThan(model.segments.length - 1);
      }
      for (let i = 1; i < starts.length; i++) {
        if (ex.plan[i]!.kind === 'reverse') continue; // chained to the kerb stop
        expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(100);
      }
    }
  }, 60_000);
});
