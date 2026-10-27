import { describe, expect, it } from 'vitest';
import type { NavInstruction } from '@/core/events';
import { projectOntoPolyline } from '@/world/geo';
import { DialogueManager } from './dialogue';
import { Navigator, roundDistance, type DeviationInfo } from './navigator';
import { RouteModel } from './routeModel';
import { createTestContext, eventsNamed, spokenTexts, type TestContext } from './testUtils';

function setup(opts: { speak?: boolean; who?: 'instructor' | 'examiner' } = {}) {
  const t = createTestContext();
  const dm = new DialogueManager(t.bus, t.settings, { defaultLinger: 0 });
  const nav = new Navigator(t.graph, t.bus, dm);
  const tour = t.world.routes.find((r) => r.id === 'tg_tour')!;
  const path = t.graph.routeViaJunctions('r00_01:f0', tour.waypoints)!;
  nav.setRoute(path, { speak: opts.speak ?? true, who: opts.who });
  const route = new RouteModel(t.graph, path);
  return { t, dm, nav, path, route, systems: [nav, dm] };
}

function instructions(t: TestContext): NavInstruction[] {
  return eventsNamed<NavInstruction>(t, 'coach:instruction');
}

describe('RouteModel', () => {
  it('lays the tour out with monotonic distances and locates the player on it', () => {
    const { t, route } = setup();
    expect(route.segments[0]!.id).toBe('r00_01:f0');
    for (let i = 1; i < route.segments.length; i++) expect(route.segments[i]!.start).toBeGreaterThanOrEqual(route.segments[i - 1]!.start);
    expect(route.length).toBeGreaterThan(1100);
    t.placeOnLane('r11_21:f0', 20);
    const loc = route.locate(t.ctx.localisation);
    expect(loc).toBeDefined();
    expect(route.segments[loc!.index]!.id).toBe('r11_21:f0');
    expect(loc!.dist).toBeCloseTo(route.segments[loc!.index]!.start + 20, 0);
    const p = route.pointAt(loc!.dist);
    expect(Math.hypot(p.p[0] - t.ctx.player.pos[0], p.p[1] - t.ctx.player.pos[1])).toBeLessThan(0.5);
  });

  it('handles lane changes (siblings without a connector) as overlapping segments', () => {
    const { t } = setup();
    const path = { laneIds: ['r01_11:f0', 'r01_11:f1', 'r11_21:f1'], connectorIds: t.graph.lane('r01_11:f1').next.filter((id) => t.graph.connector(id).toLane === 'r11_21:f1'), length: 0 };
    expect(path.connectorIds.length).toBe(1);
    const rm = new RouteModel(t.graph, path);
    expect(rm.segments[0]!.start).toBe(0);
    expect(rm.segments[1]!.start).toBe(0); // sibling overlaps
    expect(rm.segments[2]!.kind).toBe('connector');
    expect(rm.segments[2]!.start).toBeCloseTo(t.graph.lane('r01_11:f1').length, 5);
  });
});

describe('Navigator', () => {
  it('builds the manoeuvre sequence of tg_tour from the graph', () => {
    const { nav } = setup();
    const kinds = nav.allManeuvers.map((m) => m.kind);
    expect(kinds).toEqual(['turn_left', 'straight', 'straight', 'roundabout_exit', 'turn_right', 'straight', 'arrive']);
    const [left, sigStraight, , rb, right] = nav.allManeuvers;
    expect(left!.junctionId).toBe('n01');
    expect(left!.streetName).toBe('שדרות הראשיים');
    expect(sigStraight!.junctionId).toBe('n11');
    expect(rb!.junctionId).toBe('rb_w');
    // the tour passes rb_s, rb_e and rb_n and leaves at rb_w again: a full loop = 4th exit
    expect(rb!.exitNumber).toBe(4);
    expect(right!.junctionId).toBe('n21');
    expect(right!.streetName).toBe('רחוב האלון');
    expect(nav.expectedTurnAt('n01')).toBe('left');
    expect(nav.expectedTurnAt('n11')).toBe('straight');
    expect(nav.expectedTurnAt('rb_w')).toBe('right');
  });

  it('counts roundabout exits in travel order (counter-clockwise ring): n21 arm → north road is the 3rd exit', () => {
    const { t, nav } = setup();
    const p = t.graph.findPath('r21_rbw:f0', 'rbn_out:f0')!;
    // sanity: the ring really runs W → S → E → N (counter-clockwise seen from above with north up)
    expect(p.laneIds).toEqual(['r21_rbw:f0', 'rb1:f0', 'rb2:f0', 'rb3:f0', 'rbn_out:f0']);
    nav.setRoute(p);
    const rb = nav.allManeuvers[0]!;
    expect(rb.kind).toBe('roundabout_exit');
    expect(rb.exitNumber).toBe(3);
    expect(rb.streetName).toBe('דרך הצפון');
    const pe = t.graph.findPath('r21_rbw:f0', 'rbe_out:f0')!;
    nav.setRoute(pe);
    expect(nav.allManeuvers[0]!.exitNumber).toBe(2);
    const ps = t.graph.findPath('r21_rbw:f0', 'rbs_out:f0')!;
    nav.setRoute(ps);
    expect(nav.allManeuvers[0]!.exitNumber).toBe(1);
  });

  it('emits an instruction every update with the distance to the manoeuvre', () => {
    const { t, nav, route, systems } = setup({ speak: false });
    t.placeOnRoute(route, 29.5, 10);
    t.step(0.1, systems);
    const first = instructions(t)[0]!;
    expect(first.kind).toBe('turn_left');
    expect(first.junctionId).toBe('n01');
    expect(first.streetName).toBe('שדרות הראשיים');
    expect(first.text).toContain('שמאלה');
    expect(Math.abs(first.distance - (route.segments[1]!.start - 29.5 - 1 - 2.2))).toBeLessThan(1);
    t.drive(route, 10, 5, systems);
    const n = instructions(t).length;
    expect(n).toBeGreaterThan(40);
    expect(instructions(t)[n - 1]!.distance).toBeLessThan(first.distance);
    expect(nav.onRoute).toBe(true);
  });

  it('speaks the far / near announcements, the straight-through hint, the roundabout exit and the arrival', () => {
    const { t, route, systems, nav } = setup();
    t.placeOnRoute(route, 29.5, 0);
    t.drive(route, 12, route.length / 12 + 2, systems);
    const said = spokenTexts(t);
    const idx = (re: RegExp, from = 0) => said.findIndex((s, i) => i >= from && re.test(s));
    const farLeft = idx(/מטר.*שמאלה|שמאלה.*מטר/);
    expect(farLeft).toBeGreaterThanOrEqual(0);
    expect(said[farLeft]).toContain('שדרות הראשיים');
    const nearLeft = idx(/שמאלה/, farLeft + 1);
    expect(nearLeft).toBeGreaterThan(farLeft);
    expect(said[nearLeft]).not.toContain('מטר');
    const straight = idx(/ישר/, nearLeft + 1);
    expect(straight).toBeGreaterThan(nearLeft);
    const rb = idx(/כיכר/, straight + 1);
    expect(rb).toBeGreaterThan(straight);
    expect(said[rb]).toContain('רביעית');
    const right = idx(/ימינה/, rb + 1);
    expect(right).toBeGreaterThan(rb);
    expect(said.slice(right).some((s) => s.includes('האלון'))).toBe(true);
    const arrive = idx(/יעד/, right + 1);
    expect(arrive).toBeGreaterThan(right);
    // street names already carry "רחוב" / "שדרות": no "לרחוב רחוב"
    for (const s of said) expect(s).not.toMatch(/לרחוב (רחוב|שדרות)/);
    expect(nav.atDestination).toBe(true);
    expect(nav.remainingDistance()).toBeLessThan(8.5);
  });

  it('skips a far announcement that would be stale while the instructor is talking; the near line cuts in', () => {
    const { t, route, systems, dm } = setup();
    t.placeOnRoute(route, 29.5, 0);
    const long = 'א'.repeat(170); // ≈ 11.5 s of speech
    dm.say({ who: 'instructor', text: long, priority: 2 });
    t.drive(route, 10, 6, systems);
    const said = eventsNamed<{ text: string; priority: number }>(t, 'coach:say');
    expect(said.map((s) => s.text.includes('מטר'))).not.toContain(true); // no stale "בעוד 80 מטר"
    const near = said.find((s) => /שמאלה/.test(s.text))!;
    expect(near).toBeDefined();
    expect(near.priority).toBe(3); // moving → interrupts the chit-chat
    expect(dm.currentRequest?.text).not.toBe(long);
  });

  it('uses terse examiner phrasing when who = examiner', () => {
    const { t, route, systems } = setup({ who: 'examiner' });
    t.placeOnRoute(route, 29.5, 0);
    t.drive(route, 12, 12, systems);
    const said = spokenTexts(t);
    expect(said.length).toBeGreaterThan(0);
    for (const s of said) expect(s).not.toContain('פנה');
    expect(eventsNamed<{ who: string }>(t, 'coach:say').every((e) => e.who === 'examiner')).toBe(true);
  });

  it('detects a wrong turn, then re-routes after leaving the route and says so once', () => {
    const { t, nav, route, systems } = setup();
    const deviations: DeviationInfo[] = [];
    nav.onDeviation((d) => deviations.push(d));
    t.placeOnRoute(route, 100, 8);
    t.step(0.1, systems);
    expect(nav.onRoute).toBe(true);
    // go straight at n01 instead of turning left: drive into the straight connector
    const straight = t.graph.connectorsFrom('r00_01:f0').find((c) => c.turn === 'straight')!;
    const mid = straight.path[Math.floor(straight.path.length / 2)]!;
    t.place(mid, Math.PI / 2, 8);
    t.step(0.1, systems);
    expect(t.ctx.localisation.connectorId).toBe(straight.id);
    expect(deviations).toEqual([expect.objectContaining({ junctionId: 'n01', expected: 'left', taken: 'straight' })]);
    // now on the wrong lane: off route for > 3 s → re-route from r01_02:f0
    t.placeOnLane('r01_02:f0', 4, { speed: 5 });
    t.step(0.1, systems);
    expect(nav.onRoute).toBe(false);
    t.advance(3.5, systems);
    expect(nav.onRoute).toBe(true);
    expect(nav.path!.laneIds[0]).toBe('r01_02:f0');
    expect(nav.path!.laneIds[nav.path!.laneIds.length - 1]).toBe('r00_10:b0');
    const reroutes = spokenTexts(t).filter((s) => s.includes('נמשיך מכאן'));
    expect(reroutes.length).toBe(1);
    expect(instructions(t)[instructions(t).length - 1]!.kind).not.toBe('arrive');
  });

  it('setDestination / routeViaJunctions path-find from the current lane; pending until localised', () => {
    const t = createTestContext();
    const dm = new DialogueManager(t.bus, t.settings, { defaultLinger: 0 });
    const nav = new Navigator(t.graph, t.bus, dm);
    expect(nav.setDestination('n21')).toBe(true); // pending (no update yet)
    expect(nav.hasRoute).toBe(false);
    t.placeOnLane('r00_01:f0', 30, { speed: 0 });
    t.step(0.1, [nav, dm]);
    expect(nav.hasRoute).toBe(true);
    expect(nav.path!.laneIds[0]).toBe('r00_01:f0');
    expect(t.graph.lane(nav.path!.laneIds[nav.path!.laneIds.length - 1]!).to).toBe('n21');
    expect(nav.setDestination({ spawnId: 'tg_parking' })).toBe(true);
    expect(nav.path!.laneIds[nav.path!.laneIds.length - 1]).toBe('r20_21:f0');
    const spawn = t.graph.spawnPoints.get('tg_parking')!;
    expect(nav.routeModel!.endS).toBeCloseTo(projectOntoPolyline(t.graph.lane('r20_21:f0').centre, spawn.pos).s, 1);
    expect(nav.setDestination([2 * 120 + 10, 1.5])).toBe(true);
    expect(nav.path!.laneIds[nav.path!.laneIds.length - 1]).toBe('r21_rbw:f0');
    expect(nav.routeViaJunctions(['n11', 'n12'])).toBe(true);
    expect(nav.expectedTurnAt('n11')).toBe('right');
    expect(nav.setDestination('no-such-id')).toBe(false);
  });

  it('announceNow repeats the current instruction and overrides replace the guidance', () => {
    const { t, nav, route, systems, dm } = setup({ speak: false });
    t.placeOnRoute(route, 29.5, 0);
    t.step(0.1, systems);
    expect(spokenTexts(t).length).toBe(0);
    nav.announceNow();
    expect(spokenTexts(t).length).toBe(1);
    expect(spokenTexts(t)[0]).toMatch(/שמאלה/);
    nav.setOverride({ kind: 'pull_over', text: 'עצור בצד' });
    t.step(0.1, systems);
    const last = instructions(t)[instructions(t).length - 1]!;
    expect(last.kind).toBe('pull_over');
    dm.cancelAll();
    nav.announceNow();
    expect(spokenTexts(t)[spokenTexts(t).length - 1]).toBe('עצור בצד');
    nav.setOverride(null);
    t.step(0.1, systems);
    expect(instructions(t)[instructions(t).length - 1]!.kind).toBe('turn_left');
  });

  it('rounds announcement distances', () => {
    expect(roundDistance(149)).toBe(150);
    expect(roundDistance(83)).toBe(80);
    expect(roundDistance(3)).toBe(10);
  });
});
