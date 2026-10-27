/**
 * Driving feel from the driver's seat (free drive): POV / interior proportions, ambient traffic
 * at spawn, pull-out feedback, and a scripted keyboard drive on the training ground measuring
 * 0→50 km/h, braking 50→0, a tight right turn steered with ArrowRight taps, the indicator's
 * self-cancel and stability at 90 km/h. North Tel Aviv: spawn / night / chase screenshots,
 * NPC count in view and a frame-time sample.
 *
 * Scripted input goes through InputSystem.pressKey / releaseKey (the DOM key handlers' code
 * path: rate-based keyboard steering, pedal ramps) and is scheduled in SIMULATION time by a
 * System installed into the session, so the numbers do not depend on how slowly SwiftShader
 * renders. Screenshots land in test-results/feel-*.png; numbers in test-results/driving-feel.json.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

interface Mark {
  time: number;
  kmh: number;
  odo: number;
  pos: [number, number];
}

interface FeelState {
  done: boolean;
  phase: string;
  marks: Record<string, Mark>;
  violations: { type: string; time: number; pos?: [number, number]; details?: Record<string, unknown> }[];
  says: string[];
  timeouts: string[];
  stability: { upMin: number; maxHeadingErrDeg: number; maxKmh: number; respawns: number };
  odometer: number;
  time: number;
  kmh: number;
  lane?: string;
  indicator: string;
  steering: number;
}

type Step =
  | { kind: 'tap'; code: string }
  | { kind: 'press'; code: string }
  | { kind: 'release'; code: string }
  | { kind: 'releaseAll' }
  | { kind: 'wait'; seconds: number }
  | { kind: 'waitSpeed'; kmh: number; dir: 'above' | 'below'; timeout: number }
  | { kind: 'mark'; name: string }
  | { kind: 'phase'; name: string }
  | { kind: 'teleport'; laneId: string; s: number }
  | { kind: 'follow'; path: string[]; kmh: number; until: { laneId: string; minS?: number }; lookahead?: number; offset?: number; offsetEndS?: number; timeout: number }
  | { kind: 'cruise'; kmh: number; seconds: number; watch?: boolean; wiggleAt?: number }
  | { kind: 'clearTraffic' };

declare global {
  interface Window {
    __app?: {
      session: {
        ctx: {
          time: number;
          dt: number;
          player: { pos: [number, number]; heading: number; speed: number; steering: number; indicator: string; gear: string; engineOn: boolean; lights: string; length: number; width: number };
          localisation: { laneId?: string; s: number; headingError: number };
          bus: { on(name: string, fn: (p: unknown) => void): () => void; emit(name: string, payload: unknown): void };
          traffic: { kind: string; pos: [number, number] }[];
        };
        systems: { name: string; update(ctx: unknown): void }[];
        graph: {
          lanes: Map<string, { centre: [number, number][] }>;
          connectors: Map<string, { path: [number, number][] }>;
          laneAt(id: string, s: number): { p: [number, number]; h: number };
          approachOf(laneId: string): { approach: { signalGroup?: string } } | undefined;
        };
        input: { pressKey(code: string, shift?: boolean): void; releaseKey(code: string): void };
        vehicle: { teleport(pos: [number, number], heading: number, opts?: Record<string, unknown>): void; pose: { quaternion: { x: number; y: number; z: number; w: number } }; body: { respawnCount?: number } };
        cameraRig: { glance(target: string): void; mode: string };
        worldRenderer: { stats(): { drawCalls: number; triangles: number; tilesLoaded: number } };
        traffic: { stats: { vehicles: number; pedestrians: number } };
        setTimeOfDay(h: number): void;
        world: { name: string };
      } | null;
    };
    __feel?: FeelState & { run(steps: Step[]): void; holdGlance: string | null; frameTimes: number[] };
  }
}

/** Installs the autopilot System into the running session (runs in the page). */
function installAutopilot(): void {
  const s = window.__app!.session!;
  const MAX_STEER = (35 * Math.PI) / 180;
  const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  const held = new Set<string>();
  const press = (code: string): void => {
    if (held.has(code)) return;
    held.add(code);
    s.input.pressKey(code);
  };
  const release = (code: string): void => {
    if (!held.has(code)) return;
    held.delete(code);
    s.input.releaseKey(code);
  };
  const releaseAll = (): void => {
    for (const c of Array.from(held)) release(c);
  };
  const feel: NonNullable<Window['__feel']> = {
    done: true,
    phase: 'idle',
    marks: {},
    violations: [],
    says: [],
    timeouts: [],
    stability: { upMin: 1, maxHeadingErrDeg: 0, maxKmh: 0, respawns: 0 },
    odometer: 0,
    time: 0,
    kmh: 0,
    indicator: 'off',
    steering: 0,
    holdGlance: null,
    frameTimes: [],
    run(steps: Step[]) {
      program = steps;
      index = 0;
      stepStart = s.ctx.time;
      stepData = {};
      feel.done = false;
      feel.timeouts = [];
    },
  };
  let program: Step[] = [];
  let index = 0;
  let stepStart = 0;
  let stepData: Record<string, unknown> = {};
  let tapRelease: string | null = null;
  let watching = false;
  let lastFrame = performance.now();
  s.ctx.bus.on('violation', (v) => {
    const x = v as { type: string; time: number; pos?: [number, number]; details?: Record<string, unknown> };
    feel.violations.push({ type: x.type, time: x.time, pos: x.pos, details: x.details });
  });
  s.ctx.bus.on('coach:say', (r) => feel.says.push((r as { text: string }).text));

  const polyline = (ids: string[]): [number, number][] => {
    const pts: [number, number][] = [];
    for (const id of ids) {
      const src = s.graph.lanes.get(id)?.centre ?? s.graph.connectors.get(id)?.path;
      if (!src) throw new Error(`unknown path segment ${id}`);
      for (const p of src) {
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) pts.push([p[0], p[1]]);
      }
    }
    return pts;
  };
  /** Closest point on the polyline (arc length) and the point `ahead` metres further on, shifted `offset` m to its right. */
  const lookaheadPoint = (pts: [number, number][], p: [number, number], ahead: number, offset: number, offsetEndS: number): [number, number] => {
    let best = { d: Infinity, s: 0 };
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const t = len > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (len * len))) : 0;
      const qx = a[0] + dx * t;
      const qz = a[1] + dz * t;
      const d = Math.hypot(p[0] - qx, p[1] - qz);
      if (d < best.d) best = { d, s: acc + len * t };
      acc += len;
    }
    const target = best.s + ahead;
    acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + len >= target) {
        const t = len > 0 ? (target - acc) / len : 0;
        const h = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const off = target < offsetEndS ? offset : 0;
        return [a[0] + (b[0] - a[0]) * t + Math.cos(h + Math.PI / 2) * off, a[1] + (b[1] - a[1]) * t + Math.sin(h + Math.PI / 2) * off];
      }
      acc += len;
    }
    return pts[pts.length - 1]!;
  };
  const speedControl = (kmh: number, band = 2): void => {
    const v = feel.kmh;
    if (v < kmh - band) {
      release('ArrowDown');
      press('ArrowUp');
    } else if (v > kmh + band) {
      release('ArrowUp');
      press('ArrowDown');
    } else {
      release('ArrowUp');
      release('ArrowDown');
    }
  };
  const steerAlong = (pts: [number, number][], lookahead: number, offset: number, offsetEndS: number): void => {
    const p = s.ctx.player;
    const speed = Math.abs(p.speed);
    const ld = Math.max(lookahead, 0.9 * speed);
    const tgt = lookaheadPoint(pts, p.pos, ld, offset, offsetEndS);
    const alpha = wrap(Math.atan2(tgt[1] - p.pos[1], tgt[0] - p.pos[0]) - p.heading); // + = right
    const delta = Math.atan2(2 * 2.6 * Math.sin(alpha), ld); // pure pursuit steer angle
    const want = Math.max(-1, Math.min(1, delta / MAX_STEER));
    const have = p.steering;
    if (want > have + 0.06) {
      release('ArrowLeft');
      press('ArrowRight');
    } else if (want < have - 0.06) {
      release('ArrowRight');
      press('ArrowLeft');
    } else {
      release('ArrowRight');
      release('ArrowLeft');
    }
  };

  const system = {
    name: 'driving-feel-autopilot',
    update(): void {
      const ctx = s.ctx;
      const now = performance.now();
      feel.frameTimes.push(now - lastFrame);
      if (feel.frameTimes.length > 240) feel.frameTimes.shift();
      lastFrame = now;
      const p = ctx.player;
      feel.time = ctx.time;
      feel.kmh = Math.abs(p.speed) * 3.6;
      feel.lane = ctx.localisation.laneId;
      feel.indicator = p.indicator;
      feel.steering = p.steering;
      feel.odometer += Math.abs(p.speed) * ctx.dt;
      if (feel.holdGlance) s.cameraRig.glance(feel.holdGlance);
      if (watching) {
        const q = s.vehicle.pose.quaternion;
        const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
        feel.stability.upMin = Math.min(feel.stability.upMin, upY);
        feel.stability.maxKmh = Math.max(feel.stability.maxKmh, feel.kmh);
        if (ctx.localisation.laneId) feel.stability.maxHeadingErrDeg = Math.max(feel.stability.maxHeadingErrDeg, (Math.abs(ctx.localisation.headingError) * 180) / Math.PI);
      }
      if (tapRelease) {
        release(tapRelease);
        tapRelease = null;
      }
      if (feel.done || ctx.dt === 0) return;
      const mark = (): Mark => ({ time: ctx.time, kmh: feel.kmh, odo: feel.odometer, pos: [p.pos[0], p.pos[1]] });
      // run steps; instantaneous ones chain within the same frame
      for (let guard = 0; guard < 8; guard++) {
        const step = program[index];
        if (!step) {
          releaseAll();
          feel.done = true;
          feel.phase = 'done';
          return;
        }
        const elapsed = ctx.time - stepStart;
        let finished = false;
        switch (step.kind) {
          case 'tap':
            press(step.code);
            tapRelease = step.code;
            finished = true;
            break;
          case 'press':
            press(step.code);
            finished = true;
            break;
          case 'release':
            release(step.code);
            finished = true;
            break;
          case 'releaseAll':
            releaseAll();
            finished = true;
            break;
          case 'mark':
            feel.marks[step.name] = mark();
            finished = true;
            break;
          case 'phase':
            feel.phase = step.name;
            finished = true;
            break;
          case 'clearTraffic':
            ctx.bus.emit('coach:request', { kind: 'clear_traffic', payload: {} });
            finished = true;
            break;
          case 'teleport': {
            releaseAll();
            const at = s.graph.laneAt(step.laneId, step.s);
            s.vehicle.teleport(at.p, at.h, { engineOn: true, gear: 'D', handbrake: false, seatbelt: true });
            finished = true;
            break;
          }
          case 'wait':
            finished = elapsed >= step.seconds;
            break;
          case 'waitSpeed':
            finished = step.dir === 'above' ? feel.kmh >= step.kmh : feel.kmh <= step.kmh;
            if (!finished && elapsed > step.timeout) {
              feel.timeouts.push(`waitSpeed ${step.dir} ${step.kmh}`);
              finished = true;
            }
            break;
          case 'follow': {
            if (!stepData['pts']) stepData['pts'] = polyline(step.path);
            steerAlong(stepData['pts'] as [number, number][], step.lookahead ?? 5, step.offset ?? 0, step.offsetEndS ?? Infinity);
            speedControl(step.kmh);
            const loc = ctx.localisation;
            finished = loc.laneId === step.until.laneId && (step.until.minS === undefined || loc.s >= step.until.minS);
            if (!finished && elapsed > step.timeout) {
              feel.timeouts.push(`follow → ${step.until.laneId}`);
              finished = true;
            }
            if (finished) releaseAll();
            break;
          }
          case 'cruise': {
            watching = step.watch ?? false;
            speedControl(step.kmh, 3);
            if (step.wiggleAt !== undefined) {
              // a short steering jab at speed: the car must stay planted
              if (elapsed > step.wiggleAt && elapsed < step.wiggleAt + 0.25) press('ArrowRight');
              else if (elapsed >= step.wiggleAt + 0.25 && elapsed < step.wiggleAt + 0.5) {
                release('ArrowRight');
                press('ArrowLeft');
              } else {
                release('ArrowLeft');
                release('ArrowRight');
              }
            }
            finished = elapsed >= step.seconds;
            if (finished) {
              releaseAll();
              watching = false;
            }
            break;
          }
        }
        if (!finished) return;
        index++;
        stepStart = ctx.time;
        stepData = {};
        if (step.kind === 'tap') return; // the release needs a frame
      }
    },
  };
  s.systems.push(system);
  window.__feel = feel;
}

async function bootSession(page: Page, item: 'training' | 'free', timeout: number): Promise<void> {
  await page.goto('/');
  await page.locator(`[data-item="${item}"]`).click({ timeout: 60_000 });
  const start = page.locator('button.btn-lg').first();
  await expect(start).toBeVisible({ timeout: 120_000 });
  await start.click();
  await page.waitForFunction(() => !!window.__app?.session && window.__app.session.ctx.time > 0.3, undefined, { timeout });
  await page.evaluate(installAutopilot);
}

async function runProgram(page: Page, steps: Step[], timeoutMs: number): Promise<FeelState> {
  await page.evaluate((st) => window.__feel!.run(st), steps);
  await page.waitForFunction(() => window.__feel!.done, undefined, { timeout: timeoutMs, polling: 250 });
  return readFeel(page);
}

const readFeel = (page: Page): Promise<FeelState> =>
  page.evaluate(() => {
    const f = window.__feel!;
    return { done: f.done, phase: f.phase, marks: f.marks, violations: f.violations, says: f.says, timeouts: f.timeouts, stability: f.stability, odometer: f.odometer, time: f.time, kmh: f.kmh, lane: f.lane, indicator: f.indicator, steering: f.steering };
  });

const SPAWN_SEQUENCE: Step[] = [
  { kind: 'tap', code: 'KeyB' }, // seatbelt
  { kind: 'press', code: 'ArrowDown' }, // brake while starting and selecting D
  { kind: 'wait', seconds: 0.6 },
  { kind: 'tap', code: 'KeyI' },
  { kind: 'wait', seconds: 0.4 },
  { kind: 'tap', code: 'KeyD' },
  { kind: 'wait', seconds: 0.3 },
  { kind: 'tap', code: 'Space' }, // parking brake off
  { kind: 'wait', seconds: 0.3 },
  { kind: 'release', code: 'ArrowDown' },
];

/** Cycle the lights with L (off → parking → low → high) until the wanted state; one press per frame at most. */
async function setLights(page: Page, want: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const cur = await page.evaluate(() => window.__app!.session!.ctx.player.lights);
    if (cur === want) return;
    await page.keyboard.press('KeyL');
    await page.waitForFunction((prev) => window.__app!.session!.ctx.player.lights !== prev, cur, { timeout: 15_000 });
  }
  expect(await page.evaluate(() => window.__app!.session!.ctx.player.lights)).toBe(want);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test-results/${name}.png` });
}

async function glanceShot(page: Page, target: string, code: string, name: string): Promise<void> {
  await page.evaluate((t) => {
    window.__feel!.holdGlance = t;
  }, target);
  await page.keyboard.press(code);
  await page.waitForTimeout(1800);
  await shot(page, name);
  await page.evaluate(() => {
    window.__feel!.holdGlance = null;
  });
  await page.waitForTimeout(600);
}

async function npcInView(page: Page, maxDist: number): Promise<{ vehicles: number; pedestrians: number; nearestAhead: number }> {
  return page.evaluate((max) => {
    const ctx = window.__app!.session!.ctx;
    const p = ctx.player;
    const f = [Math.cos(p.heading), Math.sin(p.heading)];
    let vehicles = 0;
    let pedestrians = 0;
    let nearestAhead = Infinity;
    for (const a of ctx.traffic) {
      const wx = a.pos[0] - p.pos[0];
      const wz = a.pos[1] - p.pos[1];
      const along = wx * f[0]! + wz * f[1]!;
      const lat = Math.abs(wx * f[1]! - wz * f[0]!);
      const d = Math.hypot(wx, wz);
      if (along > 0 && d <= max && Math.atan2(lat, along) < (50 * Math.PI) / 180) {
        if (a.kind === 'pedestrian') pedestrians++;
        else {
          vehicles++;
          if (lat < 6) nearestAhead = Math.min(nearestAhead, along);
        }
      }
    }
    return { vehicles, pedestrians, nearestAhead };
  }, maxDist);
}

const perfSample = (page: Page) =>
  page.evaluate(() => {
    const f = window.__feel!.frameTimes.slice(-60);
    const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
    const sorted = [...f].sort((a, b) => a - b);
    const s = window.__app!.session!;
    return { frameMsAvg: Math.round(avg), frameMsP90: Math.round(sorted[Math.floor(sorted.length * 0.9)] ?? 0), stats: s.worldRenderer.stats(), traffic: s.traffic.stats };
  });

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/driving-feel.json', JSON.stringify(results, null, 2));
});

test.describe('driving feel', () => {
  test('training ground: POV, ambient traffic, pull-out briefing, 0→50, braking, right turn, 90 km/h', async ({ page }) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await bootSession(page, 'training', 180_000);

    // --- ambient traffic at spawn (initial fill) + the instructor's pull-out briefing -----------
    await page.waitForTimeout(2500);
    const spawnNpc = await npcInView(page, 200);
    const perfSpawn = await perfSample(page);
    await shot(page, 'feel-tg-spawn');
    results['tg.spawn'] = { npcInView: spawnNpc, perf: perfSpawn };
    console.log('tg.spawn', JSON.stringify(results['tg.spawn']));
    expect(spawnNpc.vehicles + spawnNpc.pedestrians).toBeGreaterThanOrEqual(2);
    expect(spawnNpc.nearestAhead).toBeGreaterThan(25);
    await page.waitForFunction(() => window.__feel!.says.some((t) => /כתף/.test(t) && /חגורה/.test(t)), undefined, { timeout: 90_000 });
    await shot(page, 'feel-tg-briefing');

    // --- pull away without any checks: no pull-out observations on the very first start ---------
    const t0 = await readFeel(page);
    const pullOut = await runProgram(page, [...SPAWN_SEQUENCE, { kind: 'mark', name: 'go' }, { kind: 'press', code: 'ArrowUp' }, { kind: 'waitSpeed', kmh: 20, dir: 'above', timeout: 12 }, { kind: 'release', code: 'ArrowUp' }, { kind: 'wait', seconds: 3 }, { kind: 'press', code: 'ArrowDown' }, { kind: 'waitSpeed', kmh: 0.5, dir: 'below', timeout: 10 }, { kind: 'release', code: 'ArrowDown' }], 240_000);
    const pullOutTypes = pullOut.violations.filter((v) => v.time >= t0.time).map((v) => v.type);
    results['tg.firstPullOut'] = { violations: pullOutTypes, timeouts: pullOut.timeouts, briefing: pullOut.says.find((t) => /כתף/.test(t)) };
    console.log('tg.firstPullOut', JSON.stringify(results['tg.firstPullOut']));
    expect(pullOutTypes.filter((t) => /NO_INDICATOR_LANE_CHANGE|NO_MIRROR_CHECK|NO_SHOULDER_CHECK/.test(t))).toEqual([]);
    expect(pullOut.timeouts).toEqual([]);

    // --- 0→50 km/h and 50→0 braking on the straight arm towards the roundabout (164 m, nothing to yield to for 80 m)
    const accelStart = await readFeel(page);
    const accel = await runProgram(
      page,
      [
        { kind: 'clearTraffic' },
        { kind: 'teleport', laneId: 'r21_rbw:f0', s: 2 },
        { kind: 'wait', seconds: 1.5 },
        { kind: 'mark', name: 't0' },
        { kind: 'press', code: 'ArrowUp' },
        { kind: 'waitSpeed', kmh: 50, dir: 'above', timeout: 20 },
        { kind: 'mark', name: 't50' },
        { kind: 'release', code: 'ArrowUp' },
        { kind: 'press', code: 'ArrowDown' },
        { kind: 'waitSpeed', kmh: 0.5, dir: 'below', timeout: 15 },
        { kind: 'mark', name: 'stop' },
        { kind: 'release', code: 'ArrowDown' },
      ],
      300_000,
    );
    const to50 = accel.marks['t50']!.time - accel.marks['t0']!.time;
    const brakeDist = accel.marks['stop']!.odo - accel.marks['t50']!.odo;
    results['tg.accelBrake'] = { zeroTo50s: +to50.toFixed(2), brake50to0m: +brakeDist.toFixed(1), timeouts: accel.timeouts, violations: accel.violations.filter((v) => v.time >= accelStart.time).map((v) => `${v.type}@${v.time.toFixed(1)}`) };
    console.log('tg.accelBrake', JSON.stringify(results['tg.accelBrake']));
    expect(accel.timeouts).toEqual([]);
    expect(to50).toBeGreaterThan(3);
    expect(to50).toBeLessThan(9);
    expect(brakeDist).toBeGreaterThan(10);
    expect(brakeDist).toBeLessThan(24);

    // --- straight road at 40 km/h: POV screenshot ------------------------------------------
    await page.evaluate(() => window.__feel!.run([{ kind: 'teleport', laneId: 'r00_01:f0', s: 5 }, { kind: 'wait', seconds: 1 }, { kind: 'phase', name: 'straight' }, { kind: 'cruise', kmh: 40, seconds: 14 }]));
    await page.waitForFunction(() => window.__feel!.phase === 'straight' && window.__feel!.kmh > 30, undefined, { timeout: 120_000 });
    await shot(page, 'feel-tg-straight');
    await page.waitForFunction(() => window.__feel!.done, undefined, { timeout: 120_000 });

    // --- right turn at 20 km/h: northbound on רחוב התמר (r01_02:b0) right into שדרות הראשיים (r01_11:f1) at n01
    const turnStart = await readFeel(page);
    await page.evaluate(() =>
      window.__feel!.run([
        { kind: 'teleport', laneId: 'r01_02:b0', s: 60 },
        { kind: 'wait', seconds: 1 },
        { kind: 'tap', code: 'KeyE' }, // right indicator
        { kind: 'phase', name: 'turning' },
        { kind: 'follow', path: ['r01_02:b0', 'n01:r01_02:b0>r01_11:f1', 'r01_11:f1'], kmh: 20, until: { laneId: 'r01_11:f1', minS: 12 }, lookahead: 5, offset: -0.8, offsetEndS: 112, timeout: 60 },
        { kind: 'mark', name: 'turned' },
        { kind: 'phase', name: 'after-turn' },
        { kind: 'follow', path: ['r01_11:f1'], kmh: 20, until: { laneId: 'r01_11:f1', minS: 45 }, lookahead: 6, timeout: 30 }, // keep lane for ~30 m: the indicator must self-cancel
      ]),
    );
    await page.waitForFunction(() => window.__feel!.phase === 'turning' && Math.abs(window.__feel!.steering) > 0.4, undefined, { timeout: 180_000 });
    await shot(page, 'feel-tg-right-turn');
    await page.waitForFunction(() => window.__feel!.done, undefined, { timeout: 240_000 });
    const turn = await readFeel(page);
    const turnViolations = turn.violations.filter((v) => v.time >= turnStart.time).map((v) => v.type);
    results['tg.rightTurn'] = { lane: turn.lane, indicatorAfter: turn.indicator, violations: turnViolations, timeouts: turn.timeouts, detail: turn.violations.filter((v) => v.time >= turnStart.time) };
    console.log('tg.rightTurn', JSON.stringify(results['tg.rightTurn']));
    expect(turn.timeouts).toEqual([]);
    expect(turn.lane).toBe('r01_11:f1');
    expect(turnViolations.filter((t) => /KERB_STRIKE|KERB_MOUNT|CENTRE_LINE_CROSSED/.test(t))).toEqual([]);
    expect(turn.indicator).toBe('off'); // self-cancelled after the turn

    // --- signalised junction n11 and the chase camera ---------------------------------------
    await runProgram(page, [{ kind: 'teleport', laneId: 'r01_11:f0', s: 70 }, { kind: 'wait', seconds: 2 }], 60_000);
    await shot(page, 'feel-tg-n11');
    await page.keyboard.press('F3');
    await page.waitForTimeout(1500);
    await shot(page, 'feel-tg-chase');
    await page.keyboard.press('F3');
    await page.waitForTimeout(800);

    // --- mirror glances ---------------------------------------------------------------------
    await glanceShot(page, 'left_mirror', 'Digit1', 'feel-tg-glance-left');
    await glanceShot(page, 'rear_mirror', 'Digit2', 'feel-tg-glance-rear');
    await glanceShot(page, 'right_mirror', 'Digit3', 'feel-tg-glance-right');

    // --- night: hour 21, headlights on (L: off → parking → low) --------------------------------
    await runProgram(page, [{ kind: 'teleport', laneId: 'r01_11:f0', s: 40 }, { kind: 'wait', seconds: 1 }], 60_000);
    await page.evaluate(() => window.__app!.session!.setTimeOfDay(21));
    await setLights(page, 'low');
    await page.waitForTimeout(2500);
    await shot(page, 'feel-tg-night');
    // --- the physics run needs a clear road: no NPCs (the instructor's dual brake would cut it short)
    // and a green light at n11 for the player's approach
    await page.evaluate(() => {
      const ses = window.__app!.session!;
      ses.ctx.bus.emit('coach:request', { kind: 'clear_traffic', payload: {} });
      const group = ses.graph.approachOf('r01_11:f0')?.approach.signalGroup;
      if (group) ses.ctx.bus.emit('coach:request', { kind: 'set_signal', payload: { groupId: group, state: 'green' } });
    });
    // --- 90 km/h on שדרות הראשיים: full throttle east from n01, a steering jab, then a hard stop
    const fast = await runProgram(
      page,
      [
        { kind: 'teleport', laneId: 'r01_11:f0', s: 3 },
        { kind: 'wait', seconds: 1 },
        { kind: 'mark', name: 't0_90' },
        { kind: 'press', code: 'ArrowUp' },
        { kind: 'waitSpeed', kmh: 90, dir: 'above', timeout: 30 },
        { kind: 'mark', name: 't90' },
        { kind: 'cruise', kmh: 90, seconds: 2.5, watch: true, wiggleAt: 0.5 },
        { kind: 'mark', name: 'brake90' },
        { kind: 'press', code: 'ArrowDown' },
        { kind: 'waitSpeed', kmh: 0.5, dir: 'below', timeout: 15 },
        { kind: 'mark', name: 'stop90' },
        { kind: 'release', code: 'ArrowDown' },
      ],
      400_000,
    );
    const t90 = fast.marks['t90']!;
    const t090 = fast.marks['t0_90']!;
    results['tg.ninety'] = { zeroTo90s: +(t90.time - t090.time).toFixed(1), zeroTo90m: +(t90.odo - t090.odo).toFixed(0), kmhAtMark: +t90.kmh.toFixed(1), stability: fast.stability, timeouts: fast.timeouts, stopPos: fast.marks['stop90']?.pos, brake90to0m: +(fast.marks['stop90']!.odo - fast.marks['brake90']!.odo).toFixed(0) };
    console.log('tg.ninety', JSON.stringify(results['tg.ninety']));
    expect(fast.timeouts).toEqual([]);
    expect(t90.kmh).toBeGreaterThanOrEqual(90);
    expect(fast.stability.maxKmh).toBeGreaterThan(85); // the cruise step holds ≈ 90 (± 3 km/h band)
    expect(fast.stability.upMin).toBeGreaterThan(0.95); // never rolled
    expect(fast.stability.maxHeadingErrDeg).toBeLessThan(15);

    expect(errors.filter((e) => !/favicon|DecompressionStream/.test(e))).toEqual([]);
  });

  test('North Tel Aviv: spawn POV with traffic, night, chase, frame time', async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await bootSession(page, 'free', 300_000);
    await page.waitForTimeout(3000);
    const npc = await npcInView(page, 200);
    const perf = await perfSample(page);
    await shot(page, 'feel-tlv-spawn');
    results['tlv.spawn'] = { npcInView: npc, perf };
    console.log('tlv.spawn', JSON.stringify(results['tlv.spawn']));
    expect(npc.vehicles + npc.pedestrians).toBeGreaterThanOrEqual(2);
    expect(npc.nearestAhead).toBeGreaterThan(25);
    expect(perf.stats.drawCalls).toBeLessThan(400);
    await page.keyboard.press('F3');
    await page.waitForTimeout(1500);
    await shot(page, 'feel-tlv-chase');
    await page.keyboard.press('F3');
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__app!.session!.setTimeOfDay(21));
    await setLights(page, 'low');
    await page.waitForTimeout(3000);
    await shot(page, 'feel-tlv-night');
    const perfNight = await perfSample(page);
    // same scene with the headlights off (low → high → off): how much of the night cost is the two spot lights?
    await setLights(page, 'off');
    await page.waitForTimeout(4000);
    const perfNightNoLights = await perfSample(page);
    results['tlv.night'] = { perf: perfNight, perfNoHeadlights: perfNightNoLights };
    console.log('tlv.night', JSON.stringify(results['tlv.night']));
    expect(errors.filter((e) => !/favicon|DecompressionStream/.test(e))).toEqual([]);
  });
});
