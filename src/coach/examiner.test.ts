import { describe, expect, it } from 'vitest';
import type { SpeechRequest } from '@/core/events';
import type { PathResult } from '@/world/graph';
import { buildWorld, type BuildInput } from '@/world/builder';
import { VIOLATIONS, type ViolationType } from '@/rules/violations';
import { DialogueManager } from './dialogue';
import { Examiner, type ExaminerOptions } from './examiner';
import { Navigator } from './navigator';
import { RouteModel } from './routeModel';
import { createTestContext, eventsNamed, spokenTexts, type TestContext } from './testUtils';
import type { ManeuverKind } from './types';

type ManeuverEvent = { kind: ManeuverKind; text: string; status: 'requested' | 'completed' | 'failed' };
type Finished = { passed: boolean; points: number; violations: { type: string }[]; durationSec: number };

function setup(path?: PathResult, opts: Partial<ExaminerOptions> = {}, t: TestContext = createTestContext({ mode: 'test' })) {
  const dm = new DialogueManager(t.bus, t.settings, { defaultLinger: 0 });
  const nav = new Navigator(t.graph, t.bus, dm);
  const tour = t.world.routes.find((r) => r.id === 'tg_tour')!;
  const route = path ?? t.graph.routeViaJunctions('r00_01:f0', tour.waypoints)!;
  const ex = new Examiner(t.bus, dm, t.graph, nav, { route, routeId: 'tg_tour', ...opts });
  const model = new RouteModel(t.graph, route);
  const maneuvers = () => eventsNamed<ManeuverEvent>(t, 'examiner:maneuver');
  const finished = () => eventsNamed<Finished>(t, 'test:finished');
  const says = () => eventsNamed<SpeechRequest>(t, 'coach:say');
  const violation = (type: ViolationType) => t.bus.emit('violation', { type, severity: VIOLATIONS[type].severity, time: t.ctx.time, pos: [0, 0] });
  return { t, dm, nav, ex, route, model, maneuvers, finished, says, violation, systems: [ex, nav, dm] };
}

/** Drive along the route until `pred` holds (or `maxSeconds` pass). */
function driveUntil(s: ReturnType<typeof setup>, speed: number, pred: () => boolean, maxSeconds = 120): boolean {
  for (let i = 0; i < maxSeconds * 2; i++) {
    if (pred()) return true;
    s.t.drive(s.model, speed, 0.5, s.systems);
  }
  return pred();
}

describe('Examiner', () => {
  it('greets formally, starts the test and plans a kerb stop + reverse on the quiet street of the tour', () => {
    const s = setup();
    s.t.placeOnRoute(s.model, 29.5, 0);
    s.t.step(0.1, s.systems);
    expect(eventsNamed(s.t, 'test:started')).toEqual([{ routeId: 'tg_tour' }]);
    expect(s.says()[0]!.who).toBe('examiner');
    expect(s.says()[0]!.text).toContain('אני הבוחן');
    expect(s.nav.hasRoute).toBe(true);
    expect(s.nav.speaker).toBe('examiner');
    expect(s.ex.state).toBe('running');
    const kinds = s.ex.plan.map((p) => p.kind);
    expect(kinds).toEqual(['pull_over', 'reverse']);
    expect(s.ex.plan[0]!.laneId).toBe('r20_21:b0');
    // the main road (solid centre line) and the short residential lanes offer no U-turn place
    expect(kinds).not.toContain('uturn');
  });

  it('completes a clean test: route instructions only, verdict passed, a missed kerb stop costs a minor', () => {
    const s = setup();
    s.t.placeOnRoute(s.model, 29.5, 0);
    expect(driveUntil(s, 12, () => s.finished().length > 0, 200)).toBe(true);
    expect(s.ex.state).toBe('finished');
    expect(s.ex.reason).toBe('destination');
    const fin = s.finished()[0]!;
    expect(fin.passed).toBe(true);
    expect(fin.violations.map((v) => v.type)).toEqual(['MISSED_INSTRUCTION']);
    expect(fin.points).toBe(1);
    expect(fin.durationSec).toBeGreaterThan(80);
    expect(s.maneuvers().map((m) => `${m.kind}:${m.status}`)).toEqual(['pull_over:requested', 'pull_over:failed']);
    const said = spokenTexts(s.t);
    expect(said.some((x) => x.includes('המבחן הסתיים'))).toBe(true);
    expect(said.every((x) => !x.includes('פנה'))).toBe(true); // terse examiner phrasing
    expect(s.ex.verdict!.examinerSummary.length).toBeGreaterThan(10);
  });

  it('runs the kerb stop and the straight reverse', () => {
    const s = setup();
    s.t.placeOnRoute(s.model, 29.5, 0);
    expect(driveUntil(s, 12, () => s.maneuvers().some((m) => m.kind === 'pull_over' && m.status === 'requested'), 200)).toBe(true);
    expect(s.t.ctx.localisation.laneId).toBe('r20_21:b0');
    expect(spokenTexts(s.t).some((x) => x.includes('עצור בצד'))).toBe(true);
    expect(s.nav.instruction?.kind).toBe('pull_over');
    s.t.drive(s.model, 8, 4, s.systems); // into the legal stretch
    s.t.ctx.player.speed = 0;
    s.t.advance(2, s.systems);
    expect(s.maneuvers().map((m) => `${m.kind}:${m.status}`)).toEqual(['pull_over:requested', 'pull_over:completed', 'reverse:requested']);
    expect(spokenTexts(s.t).some((x) => x.includes('סע לאחור'))).toBe(true);
    s.t.ctx.player.speed = -1.5;
    s.t.advance(10, s.systems);
    expect(s.maneuvers()[3]).toEqual(expect.objectContaining({ kind: 'reverse', status: 'completed' }));
    expect(s.nav.overrideInstruction).toBeUndefined();
    expect(s.ex.scorer.points).toBe(0);
  });

  it('fails the reverse when the car drifts sideways', () => {
    const s = setup();
    s.t.placeOnRoute(s.model, 29.5, 0);
    driveUntil(s, 12, () => s.maneuvers().some((m) => m.kind === 'pull_over' && m.status === 'requested'), 200);
    s.t.drive(s.model, 8, 4, s.systems);
    s.t.ctx.player.speed = 0;
    s.t.advance(2, s.systems);
    expect(s.ex.activeManeuver).toBe('reverse');
    s.t.ctx.player.heading += 0.2; // ~11° off the line
    s.t.ctx.player.speed = -1.5;
    s.t.advance(6, s.systems);
    const last = s.maneuvers()[s.maneuvers().length - 1]!;
    expect(last).toEqual(expect.objectContaining({ kind: 'reverse', status: 'failed' }));
    expect(spokenTexts(s.t).some((x) => x.includes('סטית'))).toBe(true);
  });

  it('requests an emergency stop on a straight quiet lane and judges the deceleration', () => {
    const t = createTestContext({ mode: 'test' });
    const path = t.graph.findPath('r00_10:f0', 'r22_23:f0')!;
    const s = setup(path, { maneuvers: ['emergency_stop'], seed: 3, firstManeuverAfter: 0 }, t);
    expect(s.ex.plan.map((p) => `${p.kind}@${p.laneId}`)).toEqual(['emergency_stop@r10_20:f0']);
    s.t.placeOnRoute(s.model, 10, 0);
    expect(driveUntil(s, 12, () => s.maneuvers().length > 0, 60)).toBe(true);
    expect(spokenTexts(s.t).some((x) => x.includes('בלימת חירום'))).toBe(true);
    expect(driveUntil(s, 12, () => spokenTexts(s.t).some((x) => x === 'עצור!'), 20)).toBe(true);
    const go = s.says().find((x) => x.text === 'עצור!')!;
    expect(go.priority).toBe(3);
    // the candidate brakes hard within a second
    s.t.ctx.player.accel = -7.5;
    s.t.step(0.1, s.systems);
    expect(s.maneuvers()[s.maneuvers().length - 1]).toEqual(expect.objectContaining({ kind: 'emergency_stop', status: 'completed' }));

    // a candidate who does not brake fails the manoeuvre
    const t2 = createTestContext({ mode: 'test' });
    const s2 = setup(t2.graph.findPath('r00_10:f0', 'r22_23:f0')!, { maneuvers: ['emergency_stop'], seed: 3 }, t2);
    s2.t.placeOnRoute(s2.model, 10, 0);
    driveUntil(s2, 12, () => spokenTexts(s2.t).some((x) => x === 'עצור!'), 80);
    s2.t.drive(s2.model, 12, 1.5, s2.systems);
    expect(s2.maneuvers()[s2.maneuvers().length - 1]).toEqual(expect.objectContaining({ kind: 'emergency_stop', status: 'failed' }));
  });

  it('requests parallel parking at a strip and asks traffic for two parked cars when there are no bays', () => {
    const t = createTestContext({ mode: 'test' });
    const path = t.graph.findPath('r00_10:b0', 'r01_02:f0')!;
    const s = setup(path, { maneuvers: ['parallel_park'], firstManeuverAfter: 0 }, t);
    expect(s.ex.plan.map((p) => `${p.kind}@${p.laneId}`)).toEqual(['parallel_park@r00_01:f0']);
    s.t.placeOnRoute(s.model, 60, 0);
    expect(driveUntil(s, 10, () => s.maneuvers().length > 0, 60)).toBe(true);
    const reqs = eventsNamed<{ kind: string; payload: Record<string, unknown> }>(s.t, 'coach:request').filter((r) => r.kind === 'spawn_vehicle');
    expect(reqs.length).toBe(2);
    expect(reqs[0]!.payload.speedKmh).toBe(0);
    expect((reqs[1]!.payload.distance as number) - (reqs[0]!.payload.distance as number)).toBeCloseTo(11.4, 0);
    expect(spokenTexts(s.t).some((x) => x.includes('חניה מקבילה'))).toBe(true);
    // park inside the strip, close to the kerb, parallel, in P
    const stretch = s.ex.plan[0]!.stretch!;
    s.t.placeOnLane('r00_01:f0', (stretch.s0 + stretch.s1) / 2, { speed: 0, lateral: 0.45 });
    s.t.ctx.player.gear = 'P';
    s.t.advance(2.5, s.systems);
    expect(s.maneuvers()[s.maneuvers().length - 1]).toEqual(expect.objectContaining({ kind: 'parallel_park', status: 'completed' }));
  });

  it('requests a U-turn on a wide two-way street and re-routes after it', () => {
    const input: BuildInput = {
      name: 'uturn-world',
      origin: { lat: 0, lon: 0 },
      attribution: [],
      nodes: [
        { id: 'a', pos: [0, 0] },
        { id: 'b', pos: [200, 0] },
        { id: 'c', pos: [400, 0] },
        { id: 'd', pos: [600, 0] },
      ],
      roads: ['ab', 'bc', 'cd'].map((id) => ({ id, from: id[0]!, to: id[1]!, points: [] as [number, number][], cls: 'residential' as const, name: `רחוב ${id}`, oneway: false, lanesForward: 2, lanesBackward: 2, maxSpeed: 50 })),
      spawnPoints: [{ id: 'sp', name: 'start', pos: [20, 1.5], heading: 0, tags: [] }],
    };
    for (const r of input.roads) r.points = [input.nodes.find((n) => n.id === r.from)!.pos, input.nodes.find((n) => n.id === r.to)!.pos];
    const world = buildWorld(input);
    const t = createTestContext({ mode: 'test', world, spawnId: 'sp' });
    const path = t.graph.findPath('ab:f1', 'cd:f1')!;
    const s = setup(path, { maneuvers: ['uturn'], firstManeuverAfter: 0 }, t);
    expect(s.ex.plan.map((p) => `${p.kind}@${p.laneId}`)).toEqual(['uturn@bc:f1']);
    s.t.placeOnRoute(s.model, 20, 0);
    expect(driveUntil(s, 12, () => s.maneuvers().length > 0, 60)).toBe(true);
    expect(spokenTexts(s.t).some((x) => x.includes('פרסה'))).toBe(true);
    // the candidate turns around: now westbound on the same street
    const back = t.graph.laneAt('bc:b1', 60);
    s.t.place(back.p, back.h, 5);
    s.t.step(0.1, s.systems);
    s.t.step(0.1, s.systems);
    expect(s.maneuvers()[s.maneuvers().length - 1]).toEqual(expect.objectContaining({ kind: 'uturn', status: 'completed' }));
    expect(s.nav.path!.laneIds[0]).toBe('bc:b1');
    expect(s.nav.path!.laneIds[s.nav.path!.laneIds.length - 1]).toBe('cd:f1');
    expect(s.ex.scorer.points).toBe(0); // the planned deviation is not a wrong turn
  });

  it('intervenes on a red light, fails the test and ends it at the end of the street', () => {
    const s = setup();
    s.t.signals.setJunction('n11', 'red');
    const lane = s.t.graph.lane('r01_11:f0');
    s.t.placeOnRoute(s.model, 29.5, 0);
    s.t.step(0.1, s.systems);
    s.t.placeOnLane(lane.id, lane.length - 18, { speed: 50 / 3.6 });
    s.t.step(0.1, s.systems);
    expect(eventsNamed(s.t, 'coach:intervention').length).toBe(1);
    const types = eventsNamed<{ type: string }>(s.t, 'violation').map((v) => v.type);
    expect(types).toEqual(['EXAMINER_INTERVENTION']);
    expect(s.ex.state).toBe('failing');
    expect(spokenTexts(s.t)).toContain('אני בולם.');
    expect(s.finished().length).toBe(0);
    // keeps driving to the next street
    s.t.placeOnLane('r11_21:f0', 10, { speed: 8 });
    s.t.step(0.1, s.systems);
    expect(s.ex.state).toBe('finished');
    const fin = s.finished()[0]!;
    expect(fin.passed).toBe(false);
    expect(s.ex.verdict!.mainReasons.some((r) => r.includes('התערבות הבוחן'))).toBe(true);
    expect(s.ex.reason).toBe('failed');
  });

  it('records violations silently, remarks on speeding once, and fails on criticals', () => {
    const s = setup();
    s.t.placeOnRoute(s.model, 29.5, 5);
    s.t.step(0.1, s.systems);
    const before = s.says().length;
    s.violation('NO_INDICATOR_TURN');
    s.violation('LANE_DEPARTURE');
    s.t.advance(1, s.systems);
    expect(s.says().length).toBe(before);
    s.violation('SPEEDING_MINOR');
    s.violation('SPEEDING_MAJOR');
    s.t.advance(8, s.systems);
    expect(s.says().filter((x) => x.text === 'שים לב למהירות.').length).toBe(1);
    expect(s.ex.scorer.points).toBe(1 + 1 + 1 + 4);
    s.violation('STOP_SIGN_NO_STOP');
    expect(s.ex.state).toBe('failing');
    s.t.advance(61, s.systems);
    expect(s.ex.state).toBe('finished');
    expect(s.finished()[0]!.passed).toBe(false);
  });

  it('ends the test after the maximum duration', () => {
    const s = setup(undefined, { maxDurationSec: 30 });
    s.t.placeOnRoute(s.model, 29.5, 0);
    s.t.advance(31, s.systems);
    expect(s.ex.state).toBe('finished');
    expect(s.ex.reason).toBe('timeout');
    expect(spokenTexts(s.t).some((x) => x.includes('הזמן נגמר'))).toBe(true);
  });

  it("emits 'test:started' before the greeting so the UI's reset on it does not wipe the greeting", () => {
    const s = setup();
    s.t.placeOnRoute(s.model, 29.5, 0);
    s.t.step(0.1, s.systems);
    const order = s.t.events.filter((e) => e.name === 'test:started' || e.name === 'coach:say').map((e) => e.name);
    expect(order[0]).toBe('test:started');
    expect(order[1]).toBe('coach:say');
  });

  it('ignores parking verdicts while the candidate has not pulled out yet, but not afterwards', () => {
    const s = setup();
    s.t.placeOnRoute(s.model, 29.5, 0);
    s.t.step(0.1, s.systems);
    s.violation('PARKING_TOO_FAR');
    expect(s.ex.scorer.violations).toEqual([]);
    s.t.drive(s.model, 8, 2, s.systems);
    s.t.placeOnRoute(s.model, 60, 0);
    s.t.step(0.1, s.systems);
    s.violation('PARKING_TOO_FAR');
    expect(s.ex.scorer.violations.map((v) => v.type)).toEqual(['PARKING_TOO_FAR']);
  });

  it('records a wrong turn with a readable place (junction street names) and prefers content ".request" lines', () => {
    const s = setup();
    s.dm.lines.add([{ key: 'examiner.maneuver.pull_over.request', who: 'examiner', variants: ['בבקשה לעצור בצד ימין במקום המותר הראשון.'] }]);
    s.t.placeOnRoute(s.model, 29.5, 0);
    s.t.step(0.1, s.systems);
    // leave the route at the first junction: the navigator reports the deviation, the examiner records WRONG_TURN
    const first = s.route.connectorIds[0]!;
    const conn = s.t.graph.connector(first);
    const other = s.t.graph.connectorsFrom(conn.fromLane).find((c) => c.id !== first)!;
    s.t.placeOnLane(conn.fromLane, s.t.graph.lane(conn.fromLane).length - 1, { speed: 5 });
    s.t.step(0.1, s.systems);
    const mid = other.path[Math.floor(other.path.length / 2)]!;
    s.t.place(mid, Math.atan2(other.path[other.path.length - 1]![1] - mid[1], other.path[other.path.length - 1]![0] - mid[0]), 5);
    s.t.step(0.1, s.systems);
    s.t.step(0.1, s.systems);
    const wrong = s.ex.scorer.violations.find((v) => v.type === 'WRONG_TURN');
    expect(wrong).toBeDefined();
    expect(wrong!.context).toMatch(/^בצומת .+/);
    expect(wrong!.context).not.toMatch(/^n\d/);
    // the kerb-stop request uses the richer content line when one is loaded
    expect(driveUntil(s, 10, () => s.maneuvers().length > 0, 200)).toBe(true);
    expect(s.maneuvers()[0]!.text).toBe('בבקשה לעצור בצד ימין במקום המותר הראשון.');
  });
});
