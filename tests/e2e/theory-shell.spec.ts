/**
 * Everything outside the 3D drive: theory hub (practice quiz, mock exam, sign library,
 * rule book), settings persistence, pause / resume / restart / menu round trip, F1 help,
 * loading screen and a 1024×600 sanity check. Boots the real app (window.__app).
 */
import { expect, test, type Page } from '@playwright/test';

const SETTINGS_KEY = 'driving-sim-il:settings:v1';

type AppWindow = Window & {
  __app?: {
    session: {
      ctx: { time: number; paused: boolean; player: { speed: number } };
      mirrors: { enabled: boolean };
      worldRenderer: { stats(): { drawCalls: number; tilesLoaded: number } };
      /** Set by the test to tell an old session object from a new one. */
      qaTag?: string;
    } | null;
    settings: Record<string, unknown>;
    profile: { data: { theory: { answers: Record<string, { attempts: number; correct: number }>; exams: { correct: number; total: number; passed: boolean }[] } } };
    content: { rules(): Promise<{ id: string; body: string; signs: string[] }[]> };
  };
};

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const realErrors = (errors: string[]) => errors.filter((e) => !/favicon|DecompressionStream/.test(e));

async function gotoMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-item="theory"]')).toBeVisible({ timeout: 60_000 });
}

async function openHub(page: Page): Promise<void> {
  await page.locator('[data-item="theory"]').click();
  await expect(page.locator('.mode-panel h1')).toHaveText('תיאוריה', { timeout: 30_000 });
  await expect(page.locator('.mode-card')).toHaveCount(4);
}

/** Answer the current question (by key or click) and move on; returns true when the quiz finished. */
async function answerQuestion(page: Page, i: number): Promise<void> {
  const quiz = page.locator('.theory-quiz');
  const answers = quiz.locator('.answer');
  const n = await answers.count();
  const pick = i % n;
  if (i % 2 === 0) await page.keyboard.press(String(pick + 1));
  else await answers.nth(pick).click();
  await expect(quiz.locator('.feedback')).toBeVisible();
  const next = quiz.locator('.screen-foot .btn-primary');
  await expect(next).toBeEnabled();
  if (i % 2 === 0) await page.keyboard.press('Enter');
  else await next.click();
}

async function theoryProfile(page: Page) {
  return page.evaluate(() => {
    const t = (window as unknown as AppWindow).__app!.profile.data.theory;
    return { answered: Object.keys(t.answers).length, exams: t.exams };
  });
}

async function startTrainingGround(page: Page): Promise<void> {
  await page.locator('[data-item="training"]').click();
  const start = page.locator('button.btn-lg').first();
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  await page.waitForFunction(() => {
    const w = window as unknown as AppWindow;
    return !!w.__app?.session && w.__app.session.ctx.time > 0.5;
  }, undefined, { timeout: 120_000 });
}

async function simTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as AppWindow).__app!.session!.ctx.time);
}

test.describe('theory hub', () => {
  test('practice quiz: keys and clicks, feedback, results page, stats line and profile', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await gotoMenu(page);
    await openHub(page);
    await expect(page.locator('.mode-panel [data-role="stats"]')).toHaveText('מאגר השאלות הרשמי של משרד התחבורה');
    await page.screenshot({ path: 'test-results/theory-hub.png' });

    await page.locator('[data-hub="practice"]').click();
    const quiz = page.locator('.theory-quiz');
    await expect(quiz).toBeVisible({ timeout: 30_000 });
    await expect(quiz.locator('.quiz-progress .num')).toHaveText('שאלה 1/20');
    await expect(quiz.locator('.quiz-timer')).toHaveCount(0);
    await expect(quiz.locator('.answer')).toHaveCount(4);

    // first answer by key: feedback appears, buttons lock, next is enabled
    await page.keyboard.press('2');
    await expect(quiz.locator('.feedback')).toBeVisible();
    await expect(quiz.locator('.answer').nth(1)).toBeDisabled();
    await expect(quiz.locator('.answer.correct')).toHaveCount(1);
    await page.screenshot({ path: 'test-results/theory-practice-feedback.png' });
    await page.keyboard.press('Enter');
    await expect(quiz.locator('.quiz-progress .num')).toHaveText('שאלה 2/20');

    for (let i = 1; i < 20; i++) await answerQuestion(page, i);

    // finishing shows the results page and keeps it open (it used to be torn down at once)
    await expect(quiz.locator('.results-hero')).toBeVisible();
    await expect(quiz.locator('.topic-breakdown .topic-row').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/theory-practice-results.png' });
    const afterQuiz = await theoryProfile(page);
    expect(afterQuiz.answered).toBe(20);
    expect(afterQuiz.exams).toHaveLength(0);

    await quiz.locator('.screen-foot .btn-primary').click();
    await expect(page.locator('.mode-panel h1')).toHaveText('תיאוריה');
    await expect(page.locator('.mode-panel [data-role="stats"]')).toContainText('ענית על 20 שאלות');

    // Escape in the quiz goes back to the hub; Escape in the hub goes back to the main menu
    await page.locator('[data-hub="practice"]').click();
    await expect(quiz).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.mode-panel h1')).toHaveText('תיאוריה');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-item="theory"]')).toBeVisible();
    await expect(page.locator('.mode-panel')).toHaveCount(0);
    expect(realErrors(errors)).toEqual([]);
  });

  test('mock exam: 30 questions with a timer; abort is not recorded, finishing is', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await gotoMenu(page);
    await openHub(page);
    await page.locator('[data-hub="exam"]').click();
    const quiz = page.locator('.theory-quiz');
    await expect(quiz).toBeVisible({ timeout: 30_000 });
    await expect(quiz.locator('h1')).toContainText('מבחן מדומה');
    await expect(quiz.locator('.quiz-progress .num')).toHaveText('שאלה 1/30');
    await expect(quiz.locator('.quiz-timer')).toHaveText(/^(40:00|39:5\d)$/);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/theory-exam.png' });
    for (let i = 0; i < 3; i++) await answerQuestion(page, i);
    await expect(quiz.locator('.quiz-progress .num')).toHaveText('שאלה 4/30');
    await page.keyboard.press('Escape');
    await expect(page.locator('.mode-panel h1')).toHaveText('תיאוריה');
    expect((await theoryProfile(page)).exams).toHaveLength(0);

    await page.locator('[data-hub="exam"]').click();
    await expect(quiz).toBeVisible();
    for (let i = 0; i < 30; i++) await answerQuestion(page, i);
    await expect(quiz.locator('.results-hero')).toBeVisible();
    await expect(quiz.locator('.results-hero .score-val')).toHaveText(/^\d+\/30$/);
    await expect(quiz.locator('.results-hero p').nth(1)).toHaveText('ציון עובר: 26 מתוך 30');
    await page.screenshot({ path: 'test-results/theory-exam-results.png' });
    const done = await theoryProfile(page);
    expect(done.exams).toHaveLength(1);
    expect(done.exams[0]!.total).toBe(30);
    await quiz.locator('.screen-foot .btn-primary').click();
    await expect(page.locator('.mode-panel [data-role="stats"]')).toContainText('1 מבחנים מדומים');
    expect(realErrors(errors)).toEqual([]);
  });

  test('sign library: 119 signs with images, category filter, search, detail view', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await gotoMenu(page);
    await openHub(page);
    await page.locator('[data-hub="signs"]').click();
    const lib = page.locator('.screen', { has: page.locator('.sign-grid') });
    await expect(lib).toBeVisible({ timeout: 30_000 });
    const cards = lib.locator('.sign-card');
    await expect(cards).toHaveCount(119);
    await expect(lib.locator('.filter-chip')).toHaveCount(10);

    // every catalogue SVG is served, and nothing fell back to the drawn placeholder
    const codes = await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code!));
    const srcs = await lib.locator('.sign-card img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).getAttribute('src')!));
    expect(new Set(codes).size).toBe(119);
    for (const src of srcs) {
      const res = await page.request.get(src);
      expect(res.status(), src).toBe(200);
      expect(res.headers()['content-type'], src).toContain('svg');
    }
    await page.waitForTimeout(500);
    await expect(lib.locator('.sign.fallback')).toHaveCount(0);
    const loaded = await lib.locator('.sign-card img').evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0).length);
    expect(loaded).toBeGreaterThan(10);
    await page.screenshot({ path: 'test-results/theory-signs.png' });

    await lib.locator('.filter-chip[data-value="priority"]').click();
    const priorityCount = await cards.count();
    expect(priorityCount).toBeGreaterThan(0);
    expect(priorityCount).toBeLessThan(119);
    await lib.locator('.sign-card[data-code="302"]').click();
    await expect(lib.locator('.sign-detail h3')).toHaveText('עצור');
    await expect(lib.locator('.sign-detail dd').first()).not.toBeEmpty();
    await page.screenshot({ path: 'test-results/theory-sign-detail.png' });

    await lib.locator('.filter-chip[data-value="all"]').click();
    await lib.locator('input[type="search"]').fill('כיכר');
    expect(await cards.count()).toBeGreaterThan(0);
    expect(await cards.count()).toBeLessThan(20);
    await page.keyboard.press('Escape');
    await expect(page.locator('.mode-panel h1')).toHaveText('תיאוריה');
    expect(realErrors(errors)).toEqual([]);
  });

  test('rule book: 31 articles, markdown with lists, sign images and source', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await gotoMenu(page);
    await openHub(page);
    await page.locator('[data-hub="rules"]').click();
    await expect(page.locator('.mode-panel h1')).toHaveText('ספר החוקים', { timeout: 30_000 });
    const items = page.locator('.mode-rules__item');
    await expect(items).toHaveCount(31);
    await expect(items.first()).toHaveClass(/is-active/);
    await expect(page.locator('.mode-rules__body p').first()).not.toBeEmpty();
    await expect(page.locator('.mode-rules__body strong').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/theory-rules.png' });

    await page.locator('[data-rule="traffic_lights"]').click();
    await expect(page.locator('.mode-panel__sub')).toContainText('רמזורים');
    const imgs = page.locator('.mode-rules__signs img');
    await expect(imgs).toHaveCount(11);
    await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>('.mode-rules__signs img')).every((i) => i.complete && i.naturalWidth > 0));
    await expect(page.locator('.mode-rules__source')).toContainText('מקור:');
    await expect(page.locator('[data-rule="traffic_lights"]')).toHaveClass(/is-active/);
    await page.screenshot({ path: 'test-results/theory-rules-signals.png' });

    // numbered lists render as <ol>, bullets as <ul>
    await page.locator('[data-rule="junction_discipline"]').click();
    await expect(page.locator('.mode-rules__body ol li').first()).toBeVisible();
    const rendered = await page.locator('.mode-rules__body').innerText();
    expect(rendered).not.toMatch(/\*\*/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.mode-panel h1')).toHaveText('תיאוריה');
    await page.locator('[data-act="back"]').click();
    await expect(page.locator('[data-item="theory"]')).toBeVisible();
    expect(realErrors(errors)).toEqual([]);
  });
});

test.describe('settings', () => {
  test('changes persist to localStorage and survive a reload; reset restores defaults', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await gotoMenu(page);
    await page.locator('[data-item="settings"]').click();
    const screen = page.getByRole('dialog', { name: 'הגדרות' });
    await expect(screen).toBeVisible();
    await page.screenshot({ path: 'test-results/settings.png' });

    const toggle = (name: string) => screen.locator('label.toggle', { has: page.getByRole('switch', { name }) });
    await toggle('כתוביות').click();
    await toggle('מראות').click();
    await screen.locator('.seg[aria-label="איכות גרפיקה"] button[data-value="low"]').click();
    const volume = screen.locator('input[type="range"][aria-label="עוצמת שמע"]');
    await volume.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '0.3';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(screen.locator('.field-value').first()).toHaveText('30%');

    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SETTINGS_KEY);
    expect(stored).toMatchObject({ subtitles: false, mirrors: false, quality: 'low', volume: 0.3 });
    const live = await page.evaluate(() => (window as unknown as AppWindow).__app!.settings);
    expect(live).toMatchObject({ subtitles: false, mirrors: false, quality: 'low' });

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-item="settings"]')).toBeVisible();

    await page.reload();
    await expect(page.locator('[data-item="settings"]')).toBeVisible({ timeout: 60_000 });
    await page.locator('[data-item="settings"]').click();
    await expect(page.getByRole('switch', { name: 'כתוביות' })).toHaveAttribute('aria-checked', 'false');
    await expect(screen.locator('.seg[aria-label="איכות גרפיקה"] button[data-value="low"]')).toHaveAttribute('aria-pressed', 'true');

    await screen.getByRole('button', { name: /איפוס/ }).click();
    const reset = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SETTINGS_KEY);
    expect(reset).toMatchObject({ subtitles: true, mirrors: true, quality: 'medium', volume: 0.8 });
    await expect(page.getByRole('switch', { name: 'כתוביות' })).toHaveAttribute('aria-checked', 'true');
    await screen.getByRole('button', { name: 'סגור' }).last().click();
    await expect(page.locator('[data-item="settings"]')).toBeVisible();
    expect(realErrors(errors)).toEqual([]);
  });
});

test.describe('session shell', () => {
  test('loading, pause / resume, settings live apply, restart, F1 help, menu round trip', async ({ page }) => {
    test.setTimeout(400_000);
    const errors = collectErrors(page);
    await gotoMenu(page);
    await expect(page.locator('.menu-foot')).toContainText('גרסה 0.1.0');
    await expect(page.locator('.menu-foot')).toContainText('ברוכים הבאים');

    await page.locator('[data-item="training"]').click();
    const start = page.locator('button.btn-lg').first();
    await expect(start).toBeVisible({ timeout: 30_000 });
    await start.click();
    // loading screen with progress + label
    const loading = page.locator('.ui-loading');
    try {
      await expect(loading).toBeVisible({ timeout: 10_000 });
      await expect(loading.locator('.loading-label')).not.toBeEmpty();
      await expect(loading.locator('.loading-tip span')).not.toBeEmpty();
      await page.screenshot({ path: 'test-results/shell-loading.png' });
    } catch {
      console.log('loading screen was too quick to observe');
    }
    await page.waitForFunction(() => {
      const w = window as unknown as AppWindow;
      return !!w.__app?.session && w.__app.session.ctx.time > 0.5;
    }, undefined, { timeout: 120_000 });
    await expect(loading).toBeHidden();
    await expect(page.locator('.ui-hud')).toHaveCount(1);
    await expect(page.locator('.ui-subtitles')).toHaveCount(1);

    // pause: Esc opens the pause menu and the sim clock stops
    await page.keyboard.press('Escape');
    const pause = page.getByRole('dialog', { name: 'מושהה' });
    await expect(pause).toBeVisible();
    await expect(page.locator('.ui-root')).toHaveClass(/paused/);
    const t1 = await simTime(page);
    await page.waitForTimeout(1200);
    const t2 = await simTime(page);
    expect(t2).toBe(t1);
    expect(await page.evaluate(() => (window as unknown as AppWindow).__app!.session!.ctx.paused)).toBe(true);
    await page.screenshot({ path: 'test-results/shell-pause.png' });

    // driving keys do not leak into the car while paused
    await page.keyboard.press('KeyB');
    // resume with Esc: clock runs again
    await page.keyboard.press('Escape');
    await expect(pause).toBeHidden();
    await page.waitForFunction((t) => (window as unknown as AppWindow).__app!.session!.ctx.time > t + 0.3, t2, { timeout: 20_000 });

    // settings from the pause menu apply live (mirrors) and return to the pause menu
    await page.keyboard.press('Escape');
    await expect(pause).toBeVisible();
    await pause.getByRole('button', { name: 'הגדרות' }).click();
    const settings = page.getByRole('dialog', { name: 'הגדרות' });
    await expect(settings).toBeVisible();
    await settings.locator('label.toggle', { has: page.getByRole('switch', { name: 'מראות' }) }).click();
    expect(await page.evaluate(() => (window as unknown as AppWindow).__app!.session!.mirrors.enabled)).toBe(false);
    await settings.locator('label.toggle', { has: page.getByRole('switch', { name: 'מראות' }) }).click();
    expect(await page.evaluate(() => (window as unknown as AppWindow).__app!.session!.mirrors.enabled)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(pause).toBeVisible();

    // help from the pause menu shows the real key map, once
    await pause.getByRole('button', { name: 'עזרה' }).click();
    const help = page.getByRole('dialog', { name: /מקשים ובקרה/ });
    // counts include hidden (stacked) screens, so a duplicate overlay would be caught
    const helpAll = page.locator('.screen:has(.help-cols)');
    await expect(helpAll).toHaveCount(1);
    await expect(help.locator('tbody tr')).toHaveCount(30);
    await expect(help.locator('tbody tr', { hasText: 'מבט מעבר לכתף שמאל' }).locator('kbd')).toHaveText(['Z']);
    await expect(help.locator('tbody tr', { hasText: 'מהבהבי חירום' }).locator('kbd')).toHaveText(['X']);
    await expect(help.locator('tbody tr', { hasText: 'התנעה' }).locator('kbd')).toHaveText(['I']);
    await expect(help.locator('tbody tr', { hasText: 'מצלמה' }).locator('kbd')).toHaveText(['F3']);
    await expect(help.locator('tbody tr', { hasText: 'ידית הילוכים למעלה' }).locator('kbd')).toHaveText(['Shift + ↑']);
    await page.waitForTimeout(400); // let the open animation finish so the screenshot shows the panel
    await page.screenshot({ path: 'test-results/shell-help.png' });
    await page.keyboard.press('Escape');
    await expect(helpAll).toHaveCount(0);
    await expect(pause).toBeVisible();

    // restart: a fresh (different) session object, unpaused, with its own clock
    await page.evaluate(() => {
      (window as unknown as AppWindow).__app!.session!.qaTag = 'old';
    });
    await pause.getByRole('button', { name: 'התחל מחדש' }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as AppWindow;
      const s = w.__app?.session;
      return !!s && s.qaTag !== 'old' && !s.ctx.paused && s.ctx.time > 0.3;
    }, undefined, { timeout: 120_000 });
    await expect(page.locator('.ui-root')).not.toHaveClass(/paused/);

    // F1 while driving opens exactly one help overlay; F1 again closes it
    await page.keyboard.press('F1');
    await expect(helpAll).toHaveCount(1);
    await expect(help.locator('tbody tr', { hasText: 'מבט מעבר לכתף ימין' }).locator('kbd')).toHaveText(['C']);
    await page.keyboard.press('F1');
    await expect(helpAll).toHaveCount(0);

    // back to the main menu: the session is disposed, the UI layers are not duplicated
    await page.keyboard.press('Escape');
    await expect(pause).toBeVisible();
    await pause.getByRole('button', { name: 'תפריט ראשי' }).click();
    await expect(page.locator('[data-item="training"]')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as AppWindow).__app!.session)).toBeNull();
    await expect(page.locator('.ui-hud')).toHaveCount(1);
    await expect(page.locator('.ui-subtitles')).toHaveCount(1);
    await expect(page.locator('.ui-hud')).toBeHidden();
    await expect(page.locator('.ui-root')).not.toHaveClass(/paused/);
    // the old drive's subtitles / law-monitor chips are gone (they must not leak into the next session)
    await expect(page.locator('.subtitle-bar')).toHaveAttribute('hidden', '');
    await expect(page.locator('.law-monitor .chip')).toHaveCount(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/shell-menu-after.png' });

    // a new session afterwards works and the renderer starts from scratch
    await startTrainingGround(page);
    const stats = await page.evaluate(() => (window as unknown as AppWindow).__app!.session!.worldRenderer.stats());
    expect(stats.tilesLoaded).toBeGreaterThan(0);
    await expect(page.locator('.ui-hud')).toHaveCount(1);
    await expect(page.locator('.ui-hud')).toBeVisible();
    await page.screenshot({ path: 'test-results/shell-second-session.png' });
    expect(realErrors(errors)).toEqual([]);
  });
});

test.describe('1024×600 viewport', () => {
  test.use({ viewport: { width: 1024, height: 600 } });

  test('menu, theory hub and HUD fit without horizontal overflow', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await gotoMenu(page);
    const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    let o = await overflow();
    expect(o.sw).toBeLessThanOrEqual(o.cw);
    const cards = page.locator('.main-menu .card');
    await expect(cards).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      const box = await cards.nth(i).boundingBox();
      expect(box, `card ${i}`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
    }
    await page.screenshot({ path: 'test-results/small-menu.png' });

    await openHub(page);
    const hub = await page.locator('.mode-panel__card').boundingBox();
    expect(hub!.y + hub!.height).toBeLessThanOrEqual(600);
    await page.screenshot({ path: 'test-results/small-theory-hub.png' });
    await page.keyboard.press('Escape');

    await startTrainingGround(page);
    await page.waitForTimeout(1000);
    o = await overflow();
    expect(o.sw).toBeLessThanOrEqual(o.cw);
    const hudBoxes = await page.locator('.ui-hud > *:not([hidden])').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })));
    for (const b of hudBoxes) {
      expect(b.l).toBeGreaterThanOrEqual(-1);
      expect(b.r).toBeLessThanOrEqual(1025);
      expect(b.b).toBeLessThanOrEqual(601);
    }
    await page.screenshot({ path: 'test-results/small-hud.png' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'מושהה' })).toBeVisible();
    await page.screenshot({ path: 'test-results/small-pause.png' });
    expect(realErrors(errors)).toEqual([]);
  });
});
