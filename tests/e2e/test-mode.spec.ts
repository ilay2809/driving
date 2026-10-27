/**
 * The practical test ("טסט"): menu → intro → start → examiner greeting + navigation
 * instructions → manoeuvres → wrong turn + re-routing → destination → result sheet →
 * "מבחן חדש" starts a second, clean test.
 *
 * The drive is scripted: an in-page System teleports the car along the navigator's route
 * (≈ 10 m/s), stops at the kerb when the examiner asks for it, reverses, does the U-turn and
 * the emergency stop, and deliberately takes one wrong turn.
 */
import { expect, test, type Page } from '@playwright/test';

interface DriverStats {
  time: number;
  dist: number;
  instructions: string[];
  says: { who: string; text: string; time: number }[];
  maneuvers: { kind: string; status: string; time: number }[];
  violations: { type: string; time: number; context?: string }[];
  finished: { passed: boolean; points: number; violations: unknown[]; durationSec: number } | null;
  started: number;
  reroutes: number;
  wrongTurnDone: boolean;
  routeLength: number;
  routeId?: string;
  planned: string[];
  frames: number;
  mode: string;
  errors: string[];
  parkedSeen: number;
  parkedRequests: number;
}

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Install event collectors on the app bus (before the session exists). */
async function installCollectors(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __app: any; __qa: any };
    const bus = w.__app.bus;
    const qa: any = { instructions: [], says: [], maneuvers: [], violations: [], finished: null, started: 0, requests: [], parkedSeen: 0 };
    w.__qa = qa;
    bus.on('coach:instruction', (i: any) => {
      const last = qa.instructions[qa.instructions.length - 1];
      const key = `${i.kind}|${i.junctionId ?? ''}|${i.streetName ?? ''}`;
      if (last !== key) qa.instructions.push(key);
    });
    bus.on('coach:say', (s: any) => qa.says.push({ who: s.who, text: s.text, time: w.__app.session?.ctx.time ?? 0 }));
    bus.on('examiner:maneuver', (m: any) => qa.maneuvers.push({ kind: m.kind, status: m.status, time: w.__app.session?.ctx.time ?? 0 }));
    bus.on('violation', (v: any) => qa.violations.push({ type: v.type, time: v.time, context: v.context }));
    bus.on('test:finished', (f: any) => {
      qa.finished = f;
      qa.finishedCount = (qa.finishedCount ?? 0) + 1;
    });
    bus.on('test:started', () => qa.started++);
    bus.on('coach:request', (r: any) => qa.requests.push(r));
  });
}

/** Install the scripted driver as a mode system of the current session. */
async function installDriver(page: Page, opts: { wrongTurnAtTurn?: number } = {}): Promise<void> {
  await page.evaluate((o) => {
    const w = window as unknown as { __app: any; __qa: any; __drv: any };
    const s = w.__app.session;
    const g = s.graph;
    const nav = s.navigator;
    const examiner = s.modeSystems.find((m: any) => m.name === 'examiner');
    const qa = w.__qa;
    const drv: any = {
      speed: 10,
      d: 0,
      mode: 'route',
      hold: 0,
      stoppedAtStop: new Set<string>(),
      detour: null,
      kerb: null,
      reverse: null,
      reroutes: 0,
      wrongTurnDone: false,
      turnsSeen: new Set<string>(),
      frames: 0,
      jumpToEnd: false,
      active: true,
      lastOnRouteTime: 0,
      pending: [] as string[],
      errors: [] as string[],
    };
    w.__drv = drv;
    const fwd = (h: number): [number, number] => [Math.cos(h), Math.sin(h)];
    const right = (h: number): [number, number] => [Math.cos(h + Math.PI / 2), Math.sin(h + Math.PI / 2)];
    const place = (p: [number, number], h: number, v: number, lateral = 0) => {
      const r = right(h);
      const pos: [number, number] = [p[0] + r[0] * lateral, p[1] + r[1] * lateral];
      s.vehicle.teleport(pos, h, { engineOn: true, gear: v < 0 ? 'R' : 'D', handbrake: false, seatbelt: true });
      const f = fwd(h);
      s.vehicle.body.body.setLinvel({ x: f[0] * v, y: 0, z: f[1] * v }, true);
    };
    const kerbOffset = (laneId: string, ctx: any) => {
      const lane = g.lane(laneId);
      return lane.width / 2 - ctx.player.width / 2 - 0.35;
    };
    s.ctx.bus.on('examiner:maneuver', (m: any) => {
      if (m.status !== 'requested') return;
      drv.pending.push(m.kind);
    });
    const startManeuver = (kind: string, ctx: any) => {
      const plan = examiner?.plan.find((p: any) => p.kind === kind && p.laneId === ctx.localisation.laneId) ?? examiner?.plan.find((p: any) => p.kind === kind);
      const loc = ctx.localisation;
      switch (kind) {
        case 'pull_over':
        case 'parallel_park': {
          const laneId = plan?.laneId ?? loc.laneId;
          const stretch = plan?.stretch;
          // parallel parking: the spot is the gap between the examiner's two parked cars, which
          // the traffic module spawns on the next frame (resolved lazily in 'kerb' mode)
          const sMid = stretch ? (stretch.s0 + stretch.s1) / 2 : Math.min(g.lane(laneId).length - 15, loc.s + 15);
          drv.kerb = { laneId, s: kind === 'parallel_park' ? undefined : sMid, fallbackS: sMid, lateral: kerbOffset(laneId, ctx), kind, waited: 0 };
          drv.mode = 'kerb';
          drv.hold = 4.5;
          return;
        }
        case 'reverse': {
          const laneId = drv.kerb?.laneId ?? loc.laneId;
          drv.reverse = { laneId, s: drv.kerb?.s ?? loc.s, lateral: drv.kerb?.lateral ?? kerbOffset(laneId, ctx), done: 0 };
          drv.mode = 'reverse';
          return;
        }
        case 'uturn': {
          const laneId = loc.laneId;
          const road = g.road(g.lane(laneId).roadId);
          const opposite = road.lanesForward.includes(laneId) ? road.lanesBackward : road.lanesForward;
          const target = opposite[opposite.length - 1];
          if (!target) return;
          const here = g.laneAt(laneId, loc.s).p;
          const m = g.nearestLane(here, { preferLaneId: target, maxDist: 30, heading: ctx.player.heading + Math.PI });
          const at = g.laneAt(target, m && m.lane.id === target ? m.s : g.lane(target).length / 2);
          drv.uturn = { laneId: target, s: m && m.lane.id === target ? m.s : g.lane(target).length / 2, p: at.p, h: at.h };
          drv.mode = 'uturn';
          drv.hold = 2;
          return;
        }
        case 'emergency_stop':
          drv.mode = 'emergency';
          drv.emergency = { stage: 'wait' };
          return;
      }
    };
    s.ctx.bus.on('coach:say', (m: any) => {
      if (drv.mode === 'emergency' && drv.emergency?.stage === 'wait' && /עצור!/.test(m.text)) drv.emergency.stage = 'go';
    });
    const system = {
      name: 'qa-driver',
      update(ctx: any) {
        try {
          if (!drv.active || ctx.paused) return;
          drv.frames++;
          const dt = ctx.dt;
          const loc = ctx.localisation;
          // manoeuvre requests
          while (drv.pending.length > 0 && (drv.mode === 'route' || drv.mode === 'kerbDone')) startManeuver(drv.pending.shift(), ctx);
          const model = nav.routeModel;
          if (!model) return;
          if (drv.jumpToEnd) {
            drv.jumpToEnd = false;
            drv.d = model.length - 30;
            drv.speed = 4; // roll up to the destination (it may sit at a red light)
            const pt = model.pointAt(drv.d);
            place(pt.p, pt.h, 0);
            drv.mode = 'route';
            return;
          }
          // scripted parked cars (parallel-parking gap) actually present?
          if (qa.requests.length > 0) {
            let n = 0;
            for (const a of ctx.traffic) if (a.parked) n++;
            qa.parkedSeen = Math.max(qa.parkedSeen, n);
          }
          switch (drv.mode) {
            case 'kerb': {
              if (drv.kerb.s === undefined) {
                // wait for the two parked cars, then take the middle of the gap between them
                const cars = ctx.traffic.filter((a: any) => a.parked && a.laneId === drv.kerb.laneId).sort((a: any, b: any) => a.s - b.s);
                drv.kerb.waited += dt;
                if (cars.length >= 2) {
                  const a = cars[0];
                  const b = cars[1];
                  drv.kerb.s = (a.s + a.length / 2 + (b.s - b.length / 2)) / 2;
                  drv.kerb.exitS = b.s + b.length / 2 + 8;
                } else if (drv.kerb.waited > 2) drv.kerb.s = drv.kerb.fallbackS;
                else {
                  place(ctx.player.pos, ctx.player.heading, 0);
                  return;
                }
              }
              const at = g.laneAt(drv.kerb.laneId, drv.kerb.s);
              place(at.p, at.h, 0, drv.kerb.lateral);
              drv.hold -= dt;
              if (drv.hold <= 0) {
                // leave the kerb after the examiner judged it (reverse may follow at once)
                drv.mode = drv.pending.length > 0 ? 'kerbDone' : 'route';
                if (drv.mode === 'route') {
                  // pull out: after parallel parking, go past the parked car in front first
                  const ahead = drv.kerb.exitS !== undefined ? Math.max(2, drv.kerb.exitS - drv.kerb.s) : drv.kerb.kind === 'parallel_park' ? 16 : 2;
                  drv.d = (nav.onRoute ? nav.distanceAlongRoute : drv.d) + ahead;
                  drv.kerb = null;
                }
              }
              return;
            }
            case 'kerbDone':
              // waiting for the chained request to arrive (same frame usually)
              {
                const at = g.laneAt(drv.kerb.laneId, drv.kerb.s);
                place(at.p, at.h, 0, drv.kerb.lateral);
                drv.hold -= dt;
                if (drv.hold < -3) {
                  drv.mode = 'route';
                  drv.kerb = null;
                }
              }
              return;
            case 'reverse': {
              const r = drv.reverse;
              const v = 2.5;
              r.s = Math.max(1, r.s - v * dt);
              r.done += v * dt;
              const at = g.laneAt(r.laneId, r.s);
              place(at.p, at.h, -v, r.lateral);
              if (r.done >= 14) {
                drv.mode = 'route';
                drv.kerb = null;
                drv.hold = 0;
                drv.d = Math.max(0, (nav.onRoute ? nav.distanceAlongRoute : drv.d) - 1);
              }
              return;
            }
            case 'uturn': {
              const u = drv.uturn;
              place(u.p, u.h, 0);
              drv.hold -= dt;
              if (drv.hold <= 0) {
                drv.mode = 'route';
                drv.d = nav.onRoute ? nav.distanceAlongRoute : 0;
              }
              return;
            }
            case 'emergency': {
              const e = drv.emergency;
              if (e.stage === 'go') {
                // brake hard: kill the velocity without teleporting (the body reports the deceleration)
                s.vehicle.body.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                e.stage = 'stopped';
                e.until = ctx.time + 2.5;
                return;
              }
              if (e.stage === 'stopped') {
                if (ctx.time >= e.until) {
                  drv.mode = 'route';
                  drv.d = nav.onRoute ? nav.distanceAlongRoute : drv.d;
                }
                return;
              }
              // 'wait': keep driving straight along the route (fall through)
              break;
            }
            case 'detour': {
              const dd = drv.detour;
              dd.s += drv.speed * dt;
              const pt = pointAlong(dd.pts, dd.s);
              place(pt.p, pt.h, drv.speed);
              if (dd.s >= dd.length) {
                // went down the wrong street long enough: let the navigator re-route
                if (nav.onRoute && drv.reroutes > dd.reroutesBefore) {
                  drv.mode = 'route';
                  drv.d = nav.distanceAlongRoute;
                }
                dd.s = dd.length; // wait there
                // safety: if no reroute after 12 s, give up waiting
                dd.waited = (dd.waited ?? 0) + dt;
                if (dd.waited > 12) {
                  drv.mode = 'route';
                  drv.d = nav.onRoute ? nav.distanceAlongRoute : 0;
                }
              }
              return;
            }
          }
          // ---- route following
          if (nav.onRoute) drv.d = Math.max(drv.d, nav.distanceAlongRoute);
          // keep to the speed limit of the lane
          const limit = loc.speedLimit ? loc.speedLimit / 3.6 - 0.6 : drv.speed;
          const v = Math.max(3, Math.min(drv.speed, limit));
          // red light / stop sign ahead: hold before the stop line
          if (loc.laneId && !loc.insideJunction) {
            const ap = g.approachOf(loc.laneId);
            const distFront = loc.distToLaneEnd - ctx.player.length / 2;
            if (ap && distFront > -1) {
              // brake early enough for the examiner's danger predictor (stopping distance at 5 m/s² + margin)
              if (ap.approach.control === 'signals' && ap.approach.signalGroup && distFront < (v * v) / 10 + 4) {
                const st = ctx.signals.stateOf(ap.approach.signalGroup);
                if (st === 'red' || st === 'red_amber' || st === 'amber') {
                  place(ctx.player.pos, ctx.player.heading, 0);
                  return;
                }
              }
              if (ap.approach.control === 'stop' && distFront < 6 && !drv.stoppedAtStop.has(loc.laneId)) {
                drv.hold = drv.hold > 0 ? drv.hold - dt : 2.2;
                place(ctx.player.pos, ctx.player.heading, 0);
                if (drv.hold <= 0.01 && drv.hold !== 2.2) {
                  drv.stoppedAtStop.add(loc.laneId);
                  drv.hold = 0;
                }
                return;
              }
            }
            // deliberate wrong turn at the n-th turn of the route
            if (o.wrongTurnAtTurn !== undefined && !drv.wrongTurnDone && distFront < 2 && distFront > -2) {
              const expected = nav.expectedConnectorFrom(loc.laneId);
              if (expected && expected.turn !== 'straight') {
                drv.turnsSeen.add(expected.id);
                if (drv.turnsSeen.size >= o.wrongTurnAtTurn) {
                  const alt = g.connectorsFrom(loc.laneId).find((c: any) => c.id !== expected.id && g.lane(c.toLane).kind === 'drive');
                  if (alt) {
                    const lane = g.lane(alt.toLane);
                    const pts = [...alt.path, ...lane.centre.slice(1)];
                    const total = polyLength(pts);
                    drv.detour = { pts, s: 0, length: Math.min(total, alt.length + 60), reroutesBefore: drv.reroutes, connector: alt.id, expected: expected.id, waited: 0 };
                    drv.wrongTurnDone = true;
                    drv.mode = 'detour';
                    return;
                  }
                }
              }
            }
          }
          drv.d += v * dt;
          const pt = model.pointAt(Math.min(drv.d, model.length - 0.5));
          place(pt.p, pt.h, v);
        } catch (err) {
          drv.errors.push(String(err));
        }
      },
    };
    function polyLength(pts: [number, number][]): number {
      let L = 0;
      for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      return L;
    }
    function pointAlong(pts: [number, number][], d: number): { p: [number, number]; h: number } {
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (acc + L >= d || i === pts.length - 1) {
          const t = L > 0 ? Math.min(1, Math.max(0, (d - acc) / L)) : 0;
          return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], h: Math.atan2(b[1] - a[1], b[0] - a[0]) };
        }
        acc += L;
      }
      return { p: pts[0]!, h: 0 };
    }
    // count re-routes: the navigator rebuilds its RouteModel
    let lastModel = nav.routeModel;
    const watcher = {
      name: 'qa-watch',
      update() {
        if (nav.routeModel !== lastModel) {
          lastModel = nav.routeModel;
          if (lastModel) drv.reroutes++;
        }
      },
    };
    s.modeSystems.push(system, watcher);
    qa.planned = examiner ? examiner.plan.map((p: any) => `${p.kind}@${p.laneId}:${Math.round(p.triggerS)}`) : [];
    qa.routeLength = nav.routeModel?.length ?? 0;
  }, opts);
}

async function stats(page: Page): Promise<DriverStats> {
  return page.evaluate(() => {
    const w = window as unknown as { __app: any; __qa: any; __drv: any };
    const s = w.__app.session;
    const qa = w.__qa;
    const drv = w.__drv;
    return {
      time: s?.ctx.time ?? 0,
      dist: s?.navigator.distanceAlongRoute ?? 0,
      instructions: qa.instructions,
      says: qa.says,
      maneuvers: qa.maneuvers,
      violations: qa.violations,
      finished: qa.finished,
      started: qa.started,
      reroutes: drv?.reroutes ?? 0,
      wrongTurnDone: drv?.wrongTurnDone ?? false,
      routeLength: qa.routeLength,
      planned: qa.planned ?? [],
      frames: drv?.frames ?? 0,
      mode: drv?.mode ?? '',
      errors: drv?.errors ?? [],
      parkedSeen: qa.parkedSeen ?? 0,
      parkedRequests: (qa.requests ?? []).filter((r: any) => r.kind === 'spawn_vehicle' && r.payload?.parked).length,
    };
  });
}

async function waitForSession(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __app?: { session: { ctx: { time: number } } | null } };
    return !!w.__app?.session && w.__app.session.ctx.time > 0.3;
  }, undefined, { timeout: 300_000 });
}

test.describe('practical test (טסט)', () => {
  test('intro → start → instructions → manoeuvres → wrong turn → result sheet → new test', async ({ page }) => {
    test.setTimeout(900_000);
    const errors = await collectErrors(page);
    await page.goto('/');
    await expect(page.locator('[data-item="test"]')).toBeVisible({ timeout: 60_000 });
    // software GL is slow: render at low quality so the simulation clock keeps up
    await page.evaluate(() => {
      const key = 'driving-sim-il:settings:v1';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}');
      s.quality = 'low';
      localStorage.setItem(key, JSON.stringify(s));
    });
    await page.reload();
    await expect(page.locator('[data-item="test"]')).toBeVisible({ timeout: 60_000 });
    await installCollectors(page);
    await page.locator('[data-item="test"]').click();

    // ---- intro: routes from the world + random
    const start = page.locator('button.btn-lg').first();
    await expect(start).toBeVisible({ timeout: 120_000 });
    const options = await page.locator('select option').allTextContents();
    console.log('route options', options);
    expect(options.length).toBeGreaterThanOrEqual(5);
    expect(options.some((o) => /אקראי/.test(o))).toBe(true);
    await page.screenshot({ path: 'test-results/test-intro.png' });
    await page.locator('select').selectOption({ index: 1 }); // test_a (deterministic)
    await start.click();

    await waitForSession(page);
    // deterministic scripted drive: no NPC traffic (the examiner still spawns the parked cars it asks for);
    // the sim clock runs at 2× so the ≈ 20 min test fits the headless budget
    await page.evaluate(() => {
      const w = window as unknown as { __app: any };
      w.__app.session.traffic.clear();
      w.__app.session.loop.setTimeScale(2, 1e7);
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/test-start.png' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-results/test-greeting.png' });
    const subtitle = await page.locator('.subtitles, .subtitle, [class*=subtitle]').first().innerText().catch(() => '');
    console.log('subtitle at start:', subtitle);
    await installDriver(page, { wrongTurnAtTurn: 2 });
    let st = await stats(page);
    console.log('planned manoeuvres', st.planned, 'route length', Math.round(st.routeLength));
    expect(st.started).toBe(1);
    expect(st.says[0]?.who).toBe('examiner');
    expect(st.says[0]?.text).toMatch(/בוחן|שלום|בוקר טוב/);

    // drive until at least 3 instructions + the wrong turn happened (or 1.8 km)
    const t0 = Date.now();
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __qa: any; __drv: any; __app: any };
        const nav = w.__app.session.navigator;
        const parkDone = w.__qa.maneuvers.some((m: any) => m.kind === 'parallel_park' && m.status !== 'requested');
        return (w.__qa.instructions.length >= 4 && w.__drv.wrongTurnDone && w.__drv.mode === 'route' && w.__drv.reroutes > 0 && parkDone) || nav.distanceAlongRoute > 2600 || w.__qa.finished;
      },
      undefined,
      { timeout: 600_000, polling: 500 },
    );
    st = await stats(page);
    console.log('after drive', Math.round(Date.now() - t0), 'ms wall;', JSON.stringify({ time: st.time, dist: st.dist, frames: st.frames, instructions: st.instructions, maneuvers: st.maneuvers, violations: st.violations.map((v) => v.type), reroutes: st.reroutes, wrongTurn: st.wrongTurnDone, mode: st.mode, errors: st.errors }));
    console.log('says', JSON.stringify(st.says.map((s) => `${s.who}@${s.time.toFixed(0)}: ${s.text}`), null, 0));
    console.log('parked cars requested', st.parkedRequests, 'seen', st.parkedSeen);
    if (st.parkedRequests > 0) expect(st.parkedSeen).toBeGreaterThanOrEqual(1);
    // the route no longer opens with a U-turn (the car starts facing the route's direction)
    expect(st.instructions[0]).not.toMatch(/^uturn/);
    expect(st.maneuvers.filter((m) => m.status === 'completed').length).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: 'test-results/test-driving.png' });
    expect(st.errors).toEqual([]);
    expect(st.instructions.length).toBeGreaterThanOrEqual(3);
    expect(st.wrongTurnDone).toBe(true);
    expect(st.reroutes).toBeGreaterThan(0);
    expect(st.violations.some((v) => v.type === 'WRONG_TURN')).toBe(true);
    expect(st.finished).toBeNull();

    // nav banner visible with Hebrew text
    const banner = page.locator('.nav-banner');
    await expect(banner).toBeVisible();
    console.log('banner', await banner.innerText());

    // ---- jump to the destination
    await page.evaluate(() => ((window as unknown as { __drv: any }).__drv.jumpToEnd = true));
    await page.waitForFunction(() => !!(window as unknown as { __qa: any }).__qa.finished, undefined, { timeout: 120_000, polling: 500 });
    await page.waitForTimeout(1500);
    st = await stats(page);
    console.log('finished', JSON.stringify(st.finished), 'maneuvers', JSON.stringify(st.maneuvers));
    await page.screenshot({ path: 'test-results/test-result.png' });
    const sheet = page.locator('.test-result');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.stamp')).toBeVisible();
    const sheetText = await sheet.innerText();
    expect(sheetText).toMatch(/מסלול/);
    expect(sheetText).toMatch(/נקודות/);
    expect(errors.filter((e) => !/favicon|DecompressionStream/.test(e))).toEqual([]);

    // ---- "מבחן חדש" → intro → start a second test; the first examiner must be gone
    const says1 = st.says.length;
    await page.locator('button', { hasText: 'מבחן חדש' }).click();
    const start2 = page.locator('button.btn-lg').first();
    await expect(start2).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: 'test-results/test-intro-2.png' });
    await start2.click();
    await page.waitForFunction(() => (window as unknown as { __qa: any }).__qa.started >= 2, undefined, { timeout: 300_000, polling: 500 });
    await page.waitForTimeout(3000);
    const second = await page.evaluate(() => {
      const w = window as unknown as { __app: any; __qa: any };
      const s = w.__app.session;
      return {
        modeSystems: s.modeSystems.map((m: any) => m.name),
        started: w.__qa.started,
        finishedTwice: w.__qa.finishedCount,
        time: s.ctx.time,
        says: w.__qa.says.slice(-6).map((x: any) => `${x.who}: ${x.text}`),
        subtitles: document.querySelector('.subtitles')?.textContent ?? '',
        bannerHidden: (document.querySelector('.nav-banner') as HTMLElement | null)?.hidden,
        maneuverCardHidden: (document.querySelector('.maneuver-card') as HTMLElement | null)?.hidden,
        hasRoute: s.navigator.hasRoute,
      };
    });
    console.log('second test', JSON.stringify(second), 'says before', says1);
    await page.screenshot({ path: 'test-results/test-second.png' });
    expect(second.modeSystems).toEqual(['examiner']);
    expect(second.started).toBe(2);
    expect(second.finishedTwice).toBe(1);
    expect(second.hasRoute).toBe(true);
    expect(second.says.some((t: string) => /^examiner: .*(בוחן|שלום|בוקר טוב)/.test(t))).toBe(true);
    expect(second.maneuverCardHidden).toBe(true);
    expect(errors.filter((e) => !/favicon|DecompressionStream/.test(e))).toEqual([]);
  });
});
