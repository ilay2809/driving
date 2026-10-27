import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const THEORY: { id: string; correctIndex: number }[] = JSON.parse(readFileSync('data/content/theory.json', 'utf8'));
const correctIndexOf = (id: string): number => THEORY.find((q) => q.id === id)?.correctIndex ?? 0;

/** Shape of window.__app as the lesson tests read it (private fields are reachable at runtime). */
type Vec2 = [number, number];
interface SpawnOpts {
  gear?: string;
  handbrake?: boolean;
  engineOn?: boolean;
  seatbelt?: boolean;
}
interface LessonsWindow {
  __reqs?: { kind: string; payload: Record<string, unknown> }[];
  __app?: {
    bus: { on(name: string, fn: (ev: { kind: string; payload: Record<string, unknown> }) => void): () => void };
    profile: { data: { lessons: Record<string, { completed: boolean; bestScore: number }> }; recordLesson(id: string, passed: boolean, score: number): void; save(): Promise<void> };
    session: {
      ctx: { time: number; paused: boolean; traffic: unknown[]; player: { speed: number; gear: string; engineOn: boolean; seatbelt: boolean; handbrake: boolean; pos: Vec2; heading: number }; localisation: { laneId?: string; connectorId?: string } };
      vehicle: { teleport(pos: Vec2, heading: number, opts?: SpawnOpts): void };
      graph: {
        junctions: Map<string, { position: Vec2 }>;
        lanes: Map<string, { length: number }>;
        laneAt(laneId: string, s: number): { p: Vec2; h: number };
        connectorsFrom(laneId: string): { id: string; turn: string; toLane: string; path: Vec2[] }[];
      };
      traffic: { agents: readonly { id: string; kind: string; pos: Vec2 }[] };
      signals: { stateOf(groupId: string): string };
      navigator: { path?: unknown };
      judge: { history: { type: string; time: number; severity: string }[] };
    } | null;
    lessons: { runner?: { stepState?: { quiz: { waiting?: string }; glances: { target: string }[] }; progress: { index: number; total: number; stepId?: string; state: string; restarts: number } }; current?: { id: string } };
  };
}

const DRIVING: SpawnOpts = { gear: 'D', handbrake: false, engineOn: true, seatbelt: true };

/** Teleport the car (keeps it ready to drive) and let a few frames pass. */
async function teleport(page: Page, pos: Vec2, heading: number, opts: SpawnOpts = DRIVING): Promise<void> {
  await page.evaluate(([p, h, o]) => (window as unknown as LessonsWindow).__app!.session!.vehicle.teleport(p as Vec2, h as number, o as SpawnOpts), [pos, heading, opts] as const);
  await page.waitForTimeout(500);
}

/** Drive through a junction by teleporting lane end → connector → next lane (the localiser records the passage). */
async function passJunction(page: Page, fromLane: string, turn: string): Promise<string> {
  const plan = await page.evaluate(
    ([laneId, t]) => {
      const g = (window as unknown as LessonsWindow).__app!.session!.graph;
      const c = g.connectorsFrom(laneId).find((x) => x.turn === t);
      if (!c) throw new Error(`no ${t} connector from ${laneId}: ${g.connectorsFrom(laneId).map((x) => x.turn).join(',')}`);
      const end = g.laneAt(laneId, g.lanes.get(laneId)!.length - 1.5);
      const i = Math.floor(c.path.length / 2);
      const mid = c.path[i]!;
      const a = c.path[Math.max(0, i - 1)]!;
      const b = c.path[Math.min(c.path.length - 1, i + 1)]!;
      const midH = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const out = g.laneAt(c.toLane, 4);
      return { end, mid, midH, out, toLane: c.toLane };
    },
    [fromLane, turn] as const,
  );
  const loc = () => page.evaluate(() => (window as unknown as LessonsWindow).__app!.session!.ctx.localisation);
  await teleport(page, plan.end.p, plan.end.h);
  const l1 = await loc();
  await teleport(page, plan.mid, plan.midH);
  const l2 = await loc();
  await teleport(page, plan.out.p, plan.out.h);
  const l3 = await loc();
  console.log('passJunction', fromLane, turn, JSON.stringify([l1, l2, l3].map((l) => ({ lane: l.laneId, conn: l.connectorId }))));
  return plan.toLane;
}

/** Press a glance key and wait until the runner recorded that glance (or the glance completed the step). */
async function glance(page: Page, key: string, target: string): Promise<void> {
  const stepBefore = (await progress(page))?.stepId;
  await page.keyboard.press(key);
  await page.waitForFunction(
    ([t, step]) => {
      const r = (window as unknown as LessonsWindow).__app!.lessons.runner!;
      return r.progress.stepId !== step || !!r.stepState?.glances.some((g) => g.target === t);
    },
    [target, stepBefore] as const,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(200);
}

/** Mark lessons as completed in the profile (unlocks the next ones) and persist. */
async function completeLessons(page: Page, ids: string[]): Promise<void> {
  await page.evaluate(async (list) => {
    const app = (window as unknown as LessonsWindow).__app!;
    for (const id of list) app.profile.recordLesson(id, true, 90);
    await app.profile.save();
  }, ids);
}

const lanePos = (page: Page, laneId: string, s: number) => page.evaluate(([l, at]) => (window as unknown as LessonsWindow).__app!.session!.graph.laneAt(l as string, at as number), [laneId, s] as const);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const progress = (page: Page) => page.evaluate(() => (window as unknown as LessonsWindow).__app!.lessons.runner?.progress ?? null);
const player = (page: Page) => page.evaluate(() => (window as unknown as LessonsWindow).__app!.session!.ctx.player);
const subtitles = (page: Page) => page.locator('.subtitle-bar:not([hidden]) .subtitle-text');

async function waitForStep(page: Page, stepId: string, timeout = 60_000): Promise<void> {
  await page.waitForFunction((id) => (window as unknown as LessonsWindow).__app!.lessons.runner?.progress.stepId === id, stepId, { timeout });
}

async function waitForSession(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as LessonsWindow;
    return !!w.__app?.session && w.__app.session.ctx.time > 0.3;
  }, undefined, { timeout: 120_000 });
}

/** Click through the briefing slides (checks the slide content on the way) and start. */
async function finishBriefing(page: Page, shot: string): Promise<void> {
  const briefing = page.locator('.screen.briefing');
  await expect(briefing).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `test-results/${shot}-slide1.png` });
  const nextBtn = briefing.locator('button', { hasText: 'הבא' });
  const startBtn = briefing.locator('button', { hasText: 'יוצאים לדרך' });
  for (let i = 0; i < 6 && (await nextBtn.isVisible()); i++) {
    await nextBtn.click();
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: `test-results/${shot}-last.png` });
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(briefing).toBeHidden();
}

/** Seatbelt → ignition (brake held, P) → D (brake held) → release the parking brake. */
async function prepareCar(page: Page, opts: { seatbelt?: boolean; ignition?: boolean; gearD?: boolean; releaseHandbrake?: boolean } = {}): Promise<void> {
  if (opts.seatbelt ?? true) await page.keyboard.press('KeyB');
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(500);
  if (opts.ignition ?? true) {
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(600);
  }
  if (opts.gearD ?? true) {
    await page.keyboard.press('KeyD');
    await page.waitForTimeout(400);
  }
  if (opts.releaseHandbrake ?? true) await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowDown');
}

test.describe('driving lessons', () => {
  test('L00 end to end: list → briefing → steps → quiz → debrief → next lesson', async ({ page }) => {
    test.setTimeout(600_000);
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.locator('[data-item="lessons"]')).toBeVisible({ timeout: 60_000 });
    await page.locator('[data-item="lessons"]').click();

    // ---- lesson list: L00 unlocked with a resume CTA, the rest locked
    const list = page.locator('.screen', { hasText: 'שיעורי נהיגה' });
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-lesson="L00"]')).toHaveClass(/unlocked/);
    await expect(page.locator('[data-lesson="L01"]')).toHaveClass(/locked/);
    await expect(page.locator('.resume-bar')).toContainText('היכרות עם הרכב');
    await page.screenshot({ path: 'test-results/lessons-list.png' });
    await page.locator('.resume-bar button').click();

    await waitForSession(page);
    await finishBriefing(page, 'lessons-l00-briefing');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/lessons-l00-step1.png' });
    console.log('after briefing', JSON.stringify(await progress(page)));
    console.log('subtitle', await subtitles(page).allTextContents());
    expect((await progress(page))?.stepId).toBe('seat_mirrors');
    await expect(page.locator('.lesson-step')).toBeVisible();
    console.log('pill', await page.locator('.lesson-step').textContent());

    // step 1: glance at the three mirrors
    await glance(page, 'Digit2', 'rear_mirror');
    await glance(page, 'Digit1', 'left_mirror');
    await glance(page, 'Digit3', 'right_mirror');
    await waitForStep(page, 'seatbelt', 20_000);
    await page.keyboard.press('KeyB');
    await waitForStep(page, 'ignition', 20_000);
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyI');
    await waitForStep(page, 'gears', 20_000);
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyD');
    await page.waitForTimeout(400);
    await page.keyboard.press('Space'); // release the parking brake
    await page.waitForTimeout(300);
    // left mirror, left indicator, left shoulder — the kerb pull-out routine
    await glance(page, 'Digit1', 'left_mirror');
    await page.keyboard.press('KeyQ');
    await page.waitForTimeout(600);
    await glance(page, 'KeyZ', 'left_shoulder');
    const z0 = (await player(page)).pos[1];
    await page.keyboard.up('ArrowDown'); // creep (no throttle) until the car has rolled a metre or so
    await page.waitForFunction((z) => Math.abs((window as unknown as LessonsWindow).__app!.session!.ctx.player.pos[1] - z) > 1.3, z0, { timeout: 60_000 });
    await page.screenshot({ path: 'test-results/lessons-l00-creep.png' });
    console.log('creep', JSON.stringify(await player(page)), JSON.stringify(await progress(page)));
    await page.keyboard.down('ArrowDown');
    await waitForStep(page, 'park', 30_000);
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyP');
    await waitForStep(page, 'quiz', 20_000);
    await page.keyboard.up('ArrowDown');

    // quiz: answer 5 questions (first one wrong on purpose → it comes back)
    const modal = page.locator('.theory-modal');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'test-results/lessons-l00-quiz.png' });
    let wrongDone = false;
    for (let i = 0; i < 8; i++) {
      // wait until the runner asks the next question (sim-time pacing) or finishes the lesson
      await page.waitForFunction(
        () => {
          const r = (window as unknown as LessonsWindow).__app!.lessons.runner!;
          return r.progress.state === 'finished' || !!r.stepState?.quiz.waiting;
        },
        undefined,
        { timeout: 90_000 },
      );
      const state = await progress(page);
      if (state?.state === 'finished') break;
      await expect(modal).toBeVisible({ timeout: 15_000 });
      const qid = await page.evaluate(() => (window as unknown as LessonsWindow).__app!.lessons.runner!.stepState?.quiz.waiting ?? null);
      if (!qid) break;
      console.log('question', i, qid);
      let idx = correctIndexOf(qid);
      if (!wrongDone) {
        idx = (idx + 1) % 4;
        wrongDone = true;
      }
      await page.keyboard.press(`Digit${idx + 1}`);
      await page.waitForTimeout(300);
      if (i === 0) await page.screenshot({ path: 'test-results/lessons-l00-quiz-feedback.png' });
      await expect(modal).toBeHidden({ timeout: 10_000 });
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(() => (window as unknown as LessonsWindow).__app!.lessons.runner?.progress.state === 'finished', undefined, { timeout: 30_000 });
    const debrief = page.locator('.screen', { hasText: 'סיכום' });
    await expect(debrief).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/lessons-l00-debrief.png' });
    await expect(debrief.locator('.debrief-verdict')).toHaveClass(/pass/);
    const lessonsData = await page.evaluate(() => (window as unknown as LessonsWindow).__app!.profile.data.lessons);
    console.log('profile', JSON.stringify(lessonsData));
    expect(lessonsData['L00']?.completed).toBe(true);
    const violations = await page.evaluate(() => (window as unknown as LessonsWindow).__app!.session!.judge.history.map((v) => `${v.type}@${v.time.toFixed(0)}`));
    console.log('violations', JSON.stringify(violations));

    // "השיעור הבא" → L01 briefing (its second slide shows sign images)
    const nextBtn = debrief.locator('button', { hasText: 'לשיעור הבא' });
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();
    await page.waitForTimeout(3000);
    console.log('after next click: errors', JSON.stringify(errors), 'current', await page.evaluate(() => (window as unknown as LessonsWindow).__app!.lessons.current?.id), 'screen', await page.locator('.screen h1').allTextContents());
    await waitForSession(page);
    const briefing = page.locator('.screen.briefing');
    await expect(briefing).toBeVisible({ timeout: 60_000 });
    await expect(briefing).toContainText('נסיעה ראשונה');
    await briefing.locator('button', { hasText: 'הבא' }).click();
    const signs = briefing.locator('.sign-row img');
    await expect(signs).toHaveCount(2);
    await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>('.sign-row img')).every((i) => i.complete), undefined, { timeout: 20_000 });
    const signsOk = await signs.evaluateAll((imgs) => imgs.map((i) => ({ src: (i as HTMLImageElement).src, ok: (i as HTMLImageElement).naturalWidth > 0 })));
    console.log('signs', JSON.stringify(signsOk));
    expect(signsOk.every((x) => x.ok && /\/signs\/.+\.svg$/.test(x.src))).toBe(true);
    await page.screenshot({ path: 'test-results/lessons-l01-briefing-signs.png' });

    // the result survives a reload: L00 completed with its score, L01 unlocked and offered as "resume"
    await page.reload();
    await page.locator('[data-item="lessons"]').click({ timeout: 60_000 });
    await expect(page.locator('[data-lesson="L00"]')).toHaveClass(/completed/, { timeout: 30_000 });
    await expect(page.locator('[data-lesson="L00"] .score-ring')).toBeVisible();
    await expect(page.locator('[data-lesson="L01"]')).toHaveClass(/unlocked/);
    await expect(page.locator('[data-lesson="L02"]')).toHaveClass(/locked/);
    await expect(page.locator('.resume-bar')).toContainText('נסיעה ראשונה');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/lessons-list-after-l00.png' });
    expect(errors.filter((e) => !/favicon|DecompressionStream/.test(e))).toEqual([]);
  });

  test('L01 first drive: prep → pull out → straight → smooth stop → cross the junction', async ({ page }) => {
    test.setTimeout(600_000);
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.locator('[data-item="lessons"]')).toBeVisible({ timeout: 60_000 });
    await completeLessons(page, ['L00']);
    await page.locator('[data-item="lessons"]').click();
    const card = page.locator('[data-lesson="L01"]');
    await expect(card).toHaveClass(/unlocked/, { timeout: 30_000 });
    await card.click();
    await waitForSession(page);
    await finishBriefing(page, 'lessons-l01-briefing');

    // step 1: the on-screen instruction is a hint above the subtitles; the pill names the step
    await waitForStep(page, 'prep');
    await expect(page.locator('.hints .hint')).toContainText('חגורה', { timeout: 10_000 });
    await expect(page.locator('.lesson-step')).toContainText('הכנות');
    await page.screenshot({ path: 'test-results/lessons-l01-prep.png' });
    await prepareCar(page);
    await waitForStep(page, 'pull_out', 30_000);

    // step 2: mirror → left indicator → shoulder → pull away (15 m)
    await glance(page, 'Digit2', 'rear_mirror');
    await glance(page, 'Digit1', 'left_mirror');
    await page.keyboard.press('KeyQ');
    await page.waitForTimeout(600);
    await glance(page, 'KeyZ', 'left_shoulder');
    await page.keyboard.down('ArrowUp');
    await waitForStep(page, 'straight', 120_000);
    await page.screenshot({ path: 'test-results/lessons-l01-pullout.png' });

    // step 3: hold 15–45 km/h for 3 s
    await page.waitForFunction(() => (window as unknown as LessonsWindow).__app!.session!.ctx.player.speed * 3.6 > 28, undefined, { timeout: 120_000 });
    await page.keyboard.up('ArrowUp');
    await waitForStep(page, 'smooth_stop', 120_000);
    await expect(page.locator('.lesson-step')).toContainText('עצירה חלקה');
    console.log('L01 after straight', JSON.stringify(await player(page)), JSON.stringify(await progress(page)));
    await page.screenshot({ path: 'test-results/lessons-l01-straight.png' });

    // step 4: stop before n01 (radius 16 m): place the car ~22 m short of the junction, roll in and brake
    const approach = await lanePos(page, 'r00_01:f0', 120 - 22);
    await teleport(page, approach.p, approach.h);
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => (window as unknown as LessonsWindow).__app!.session!.ctx.player.pos[1] > -15, undefined, { timeout: 60_000 });
    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('ArrowDown');
    await waitForStep(page, 'cross', 60_000);
    await page.keyboard.up('ArrowDown');
    await page.screenshot({ path: 'test-results/lessons-l01-stop.png' });
    // the crossing step navigates: the navigator has a route and the HUD shows the banner
    await page.waitForFunction(() => !!(window as unknown as LessonsWindow).__app!.session!.navigator.path, undefined, { timeout: 20_000 });
    await expect(page.locator('.nav-banner')).toBeVisible({ timeout: 20_000 });

    // step 5: straight through n01 → step 6 (zone 30 pull-over); its quiz waits for the end of the step
    await passJunction(page, 'r00_01:f0', 'straight');
    await waitForStep(page, 'zone30_pullover', 30_000);
    await page.waitForTimeout(1500);
    await expect(page.locator('.theory-modal')).toHaveCount(0);
    await expect(page.locator('.lesson-step')).toContainText('6/6');
    await page.screenshot({ path: 'test-results/lessons-l01-zone30.png' });
    const violations = await page.evaluate(() => (window as unknown as LessonsWindow).__app!.session!.judge.history.map((v) => `${v.type}@${v.time.toFixed(0)}`));
    console.log('L01 violations', JSON.stringify(violations));
    expect((await progress(page))?.restarts).toBe(0);
    expect(errors.filter((e) => !/favicon|DecompressionStream/.test(e))).toEqual([]);
  });

  test('L03 triggers: set_signal turns the light green and spawn_vehicle produces a car from the right', async ({ page }) => {
    test.setTimeout(600_000);
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.locator('[data-item="lessons"]')).toBeVisible({ timeout: 60_000 });
    await completeLessons(page, ['L00', 'L01', 'L02']);
    await page.locator('[data-item="lessons"]').click();
    const card = page.locator('[data-lesson="L03"]');
    await expect(card).toHaveClass(/unlocked/, { timeout: 30_000 });
    await card.click();
    await waitForSession(page);
    await page.evaluate(() => {
      const w = window as unknown as LessonsWindow;
      w.__reqs = [];
      w.__app!.bus.on('coach:request', (r) => w.__reqs!.push(r));
      w.__app!.bus.on('coach:intervention', (r) => w.__reqs!.push({ kind: `intervention:${r.kind}`, payload: r as unknown as Record<string, unknown> }));
    });
    await finishBriefing(page, 'lessons-l03-briefing');
    await waitForStep(page, 'right_lane_turn');
    const reqs = () => page.evaluate(() => (window as unknown as LessonsWindow).__reqs ?? []);

    // step 1: within 85 m of n11 the script forces the light green for our approach
    const near = await lanePos(page, 'r01_11:f1', 120 - 60);
    await teleport(page, near.p, near.h);
    await page.waitForFunction(() => ((window as unknown as LessonsWindow).__reqs ?? []).some((r) => r.kind === 'set_signal'), undefined, { timeout: 30_000 });
    const sig = (await reqs()).find((r) => r.kind === 'set_signal')!;
    console.log('set_signal', JSON.stringify(sig));
    expect(sig.payload.junctionId).toBe('n11');
    expect(sig.payload.state).toBe('green');
    expect(typeof sig.payload.groupId).toBe('string');
    await page.waitForTimeout(500);
    const light = await page.evaluate((g) => (window as unknown as LessonsWindow).__app!.session!.signals.stateOf(g), sig.payload.groupId as string);
    expect(light).toBe('green');
    await page.screenshot({ path: 'test-results/lessons-l03-green.png' });

    // steps 1–2: right at n11, then left at the stop sign n12
    const lane2 = await passJunction(page, 'r01_11:f1', 'right');
    await waitForStep(page, 'stop_sign', 30_000);
    // rolling through the stop sign without stopping fires the step's brake trigger: dual brake + banner + "אני בולם"
    const lane3 = await passJunction(page, lane2, 'left');
    await page.waitForFunction(() => ((window as unknown as LessonsWindow).__reqs ?? []).some((r) => r.kind === 'intervention:brake'), undefined, { timeout: 20_000 });
    const brake = (await reqs()).find((r) => r.kind === 'intervention:brake')!;
    console.log('intervention', JSON.stringify(brake));
    expect(brake.payload.reason).toContain('עצור');
    await waitForStep(page, 'give_way_n22', 30_000);
    await expect(page.locator('.lesson-step')).toContainText('תן זכות קדימה');

    // step 3: within 65 m of n22 a car is requested from the right and the traffic system spawns it
    const before = await page.evaluate(() => (window as unknown as LessonsWindow).__app!.session!.traffic.agents.filter((a) => a.kind !== 'pedestrian').map((a) => a.id));
    const near22 = await lanePos(page, lane3, 120 - 55);
    await teleport(page, near22.p, near22.h);
    await page.waitForFunction(() => ((window as unknown as LessonsWindow).__reqs ?? []).some((r) => r.kind === 'spawn_vehicle'), undefined, { timeout: 30_000 });
    const spawnReq = (await reqs()).find((r) => r.kind === 'spawn_vehicle')!;
    console.log('spawn_vehicle', JSON.stringify(spawnReq));
    expect(spawnReq.payload.where).toBe('from_right');
    await page.waitForFunction(
      (prev) => {
        const s = (window as unknown as LessonsWindow).__app!.session!;
        const n22 = s.graph.junctions.get('n22')!.position;
        return s.traffic.agents.some((a) => a.kind !== 'pedestrian' && !prev.includes(a.id) && Math.hypot(a.pos[0] - n22[0], a.pos[1] - n22[1]) < 90);
      },
      before,
      { timeout: 30_000 },
    );
    const newcomers = await page.evaluate((prev) => (window as unknown as LessonsWindow).__app!.session!.traffic.agents.filter((a) => a.kind !== 'pedestrian' && !prev.includes(a.id)).map((a) => ({ id: a.id, kind: a.kind, pos: a.pos })), before);
    console.log('spawned', JSON.stringify(newcomers));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/lessons-l03-spawn.png' });

    // Esc → pause menu → "התחל מחדש" rebuilds the session and shows the briefing again
    await page.keyboard.press('Escape');
    const pause = page.locator('.screen', { hasText: 'התחל מחדש' });
    await expect(pause).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'test-results/lessons-l03-pause.png' });
    await pause.locator('button', { hasText: 'התחל מחדש' }).click();
    await page.waitForFunction(() => (window as unknown as LessonsWindow).__app!.lessons.runner?.progress.state === 'briefing' && !!(window as unknown as LessonsWindow).__app!.session, undefined, { timeout: 120_000 });
    await expect(page.locator('.screen.briefing')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.screen.briefing')).toContainText('תקנה 64');
    expect(errors.filter((e) => !/favicon|DecompressionStream/.test(e))).toEqual([]);
  });
});
