// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS } from '@/core/sim';
import { VIOLATIONS } from '@/rules/violations';
import { FEEDBACK_MS } from './screens/theoryModal';
import { fakeContext, key, stubCanvas } from './testing';
import { UISystem } from './uiSystem';

describe('UISystem', () => {
  let root: HTMLElement;
  let bus: EventBus;
  let ui: UISystem;

  beforeEach(() => {
    vi.useFakeTimers();
    stubCanvas();
    document.body.innerHTML = '';
    root = document.createElement('div');
    root.id = 'ui';
    document.body.appendChild(root);
    bus = new EventBus();
    ui = new UISystem(root, bus, { ...DEFAULT_SETTINGS }, { prefsKey: null });
  });
  afterEach(() => {
    ui.dispose();
    vi.useRealTimers();
  });

  it('mounts the layers and tracks the mode', () => {
    expect(root.querySelector('.ui-hud')).not.toBeNull();
    expect(root.querySelector('.ui-subtitles')).not.toBeNull();
    expect(root.querySelector('.ui-screens')).not.toBeNull();
    expect(root.classList.contains('mode-menu')).toBe(true);
    const ctx = fakeContext({ bus });
    ui.update(ctx);
    expect(root.classList.contains('mode-lesson')).toBe(true);
    bus.emit('mode:changed', { mode: 'free' });
    expect(root.classList.contains('mode-free')).toBe(true);
    expect(root.classList.contains('mode-lesson')).toBe(false);
  });

  it('derives the coach presence from the context unless set explicitly', () => {
    const badge = () => root.querySelector('.coach-badge')!.textContent ?? '';
    ui.update(fakeContext({ bus, mode: 'lesson', coachPresent: true }));
    expect(badge()).toContain('יוסי');
    ui.update(fakeContext({ bus, mode: 'test', coachPresent: true, dt: 0.1 }));
    expect(badge()).toBe('בוחן');
    ui.update(fakeContext({ bus, mode: 'free', coachPresent: false, dt: 0.1 }));
    expect(badge()).toBe('נהיגה חופשית');
    ui.setCoachPresence('examiner');
    ui.update(fakeContext({ bus, mode: 'free', coachPresent: false, dt: 0.1 }));
    expect(badge()).toBe('בוחן');
  });

  it('throttles HUD refreshes to ~30 Hz', () => {
    const ctx = fakeContext({ bus });
    ctx.player.speed = 10;
    ui.update(ctx);
    const speed = () => root.querySelector('.speed-num')!.textContent;
    expect(speed()).toBe('36');
    ctx.player.speed = 20;
    ctx.dt = 0.001;
    ui.update(ctx);
    expect(speed()).toBe('36');
    ctx.dt = 0.05;
    ui.update(ctx);
    expect(speed()).toBe('72');
  });

  it('renders violations, instructions and subtitles from events', () => {
    bus.emit('violation', { type: 'STOP_SIGN_ROLLING', severity: 'major', time: 1, pos: [0, 0] });
    expect(root.querySelector('.law-monitor .chip')!.textContent).toContain(VIOLATIONS.STOP_SIGN_ROLLING.label);
    bus.emit('coach:instruction', { kind: 'turn_right', text: '', distance: 80, junctionId: 'n11', streetName: 'רחוב הדקל' });
    const banner = root.querySelector('.nav-banner') as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('פנה ימינה');
    bus.emit('coach:say', { id: 's1', who: 'instructor', text: 'יפה מאוד', priority: 1 });
    expect(root.querySelector('.subtitle-text')!.textContent).toBe('יפה מאוד');
    bus.emit('lesson:hint', { text: 'רמז', icon: 'mirror', seconds: 3 });
    expect(root.querySelectorAll('.hint')).toHaveLength(1);
    bus.emit('lesson:step', { lessonId: 'L1', stepId: 's', index: 1, total: 4 });
    expect(root.querySelector('.lesson-step')!.textContent).toBe('שלב 2/4');
    bus.emit('examiner:maneuver', { kind: 'parallel_park', text: '', status: 'requested' });
    expect(root.querySelector('.maneuver-card')!.textContent).toContain('חניה מקבילה');
    expect(ui.hud.lawMonitor.el.hidden).toBe(false);
    const ctx = fakeContext({ bus });
    ctx.settings.showLawMonitor = false;
    ui.update(ctx);
    expect(ui.hud.lawMonitor.el.hidden).toBe(true);
  });

  it('shows the briefing on lesson:briefing and emits ui:acknowledged on start', () => {
    const acks: string[] = [];
    bus.on('ui:acknowledged', ({ context }) => acks.push(context));
    bus.emit('lesson:briefing', { lessonId: 'L03', title: 'עצור', slides: [{ title: 'א', text: 'טקסט **מודגש**', signs: ['302'] }, { title: 'ב', text: 'שני', signs: [], diagram: 'right_hand_rule' }] });
    expect(ui.currentScreen).toBe('lessonBriefing');
    const screen = root.querySelector('.screen')!;
    expect(screen.querySelector('.briefing-text strong')!.textContent).toBe('מודגש');
    expect(screen.querySelector('.sign img')).not.toBeNull();
    key(window, 'ArrowLeft');
    expect(screen.querySelector('.briefing-text h2')!.textContent).toBe('ב');
    expect(screen.querySelector('.diagram svg')).not.toBeNull();
    const start = Array.from(screen.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('יוצאים לדרך'))!;
    expect(start.hidden).toBe(false);
    start.click();
    expect(acks).toEqual(['briefing']);
    expect(ui.currentScreen).toBeUndefined();
    expect((root.querySelector('.ui-screens') as HTMLElement).hidden).toBe(true);
  });

  it('shows an in-drive theory question and emits theory:answer with the chosen index', () => {
    const answers: { questionId: string; index: number }[] = [];
    bus.on('theory:answer', (a) => answers.push(a));
    bus.emit('theory:question', { questionId: '1459', text: 'מי נותן זכות קדימה?', answers: ['א', 'ב', 'ג', 'ד'], image: null });
    expect(ui.currentScreen).toBe('theoryQuestion');
    const e = key(window, '2');
    expect(e.defaultPrevented).toBe(true);
    expect(answers).toEqual([{ questionId: '1459', index: 1 }]);
    bus.emit('theory:answered', { questionId: '1459', correct: true });
    expect(root.querySelector('.answer[data-index="1"]')!.classList.contains('correct')).toBe(true);
    expect(root.querySelector('.feedback.correct')).not.toBeNull();
    key(window, '3');
    expect(answers).toHaveLength(1);
    vi.advanceTimersByTime(FEEDBACK_MS + 50);
    expect(ui.currentScreen).toBeUndefined();
  });

  it('in-drive quiz: a synchronous verdict still shows feedback, and a question pushed on top survives the first one closing', () => {
    // the lesson runner answers inside the 'theory:answer' emit and may ask the next question right away
    bus.on('theory:answer', (a) => {
      bus.emit('theory:answered', { questionId: a.questionId, correct: false });
      if (a.questionId === 'q1') bus.emit('theory:question', { questionId: 'q2', text: 'שאלה שנייה', answers: ['א', 'ב'], image: null });
    });
    bus.emit('theory:question', { questionId: 'q1', text: 'שאלה ראשונה', answers: ['א', 'ב'], image: null });
    key(window, '1');
    const modals = () => Array.from(root.querySelectorAll('.theory-modal')) as HTMLElement[];
    expect(modals()).toHaveLength(2);
    expect(modals()[0]!.querySelector('.feedback.wrong')).not.toBeNull();
    expect(modals()[0]!.hidden).toBe(true);
    expect(modals()[1]!.hidden).toBe(false);
    vi.advanceTimersByTime(FEEDBACK_MS + 50);
    // only the answered question closed; the new one is still on top and visible
    expect(modals()).toHaveLength(1);
    expect(modals()[0]!.textContent).toContain('שאלה שנייה');
    expect(modals()[0]!.hidden).toBe(false);
    expect(ui.currentScreen).toBe('theoryQuestion');
  });

  it('lesson hints belong to their step and the pill shows the step title', () => {
    bus.emit('lesson:hint', { text: 'רמז ישן', seconds: 30 });
    expect(root.querySelectorAll('.hints .hint')).toHaveLength(1);
    bus.emit('lesson:step', { lessonId: 'L1', stepId: 's2', index: 1, total: 4, title: 'חגורת בטיחות' });
    expect(root.querySelectorAll('.hints .hint')).toHaveLength(0);
    bus.emit('lesson:hint', { text: 'רמז חדש', seconds: 30 });
    expect(root.querySelector('.hints .hint')!.textContent).toContain('רמז חדש');
    expect(root.querySelector('.lesson-step')!.textContent).toBe('שלב 2/4 — חגורת בטיחות');
    bus.emit('lesson:completed', { lessonId: 'L1', passed: true, score: 90 });
    expect(root.querySelectorAll('.hints .hint')).toHaveLength(0);
    expect((root.querySelector('.lesson-step') as HTMLElement).hidden).toBe(true);
  });

  it('stacks screens: push/pop keeps the one below, Escape calls the screen handler, F1 opens help', () => {
    const onBack = vi.fn();
    ui.showScreen('lessonList', { lessons: [{ id: 'a', order: 1, title: 'שיעור', minutes: 5, status: 'unlocked' }], onSelect: () => undefined, onBack });
    expect(ui.currentScreen).toBe('lessonList');
    const listEl = root.querySelector('.screen') as HTMLElement;
    ui.pushScreen('help', { onClose: () => ui.popScreen() });
    expect(ui.currentScreen).toBe('help');
    expect(listEl.hidden).toBe(true);
    key(window, 'Escape');
    expect(ui.currentScreen).toBe('lessonList');
    expect(listEl.hidden).toBe(false);
    key(window, 'F1');
    expect(ui.currentScreen).toBe('help');
    key(window, 'F1');
    expect(ui.currentScreen).toBe('lessonList');
    key(window, 'Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
    ui.hideScreens();
    expect(ui.currentScreen).toBeUndefined();
    key(window, 'F1');
    expect(ui.currentScreen).toBe('help');
  });

  it('swallows driving keys while a full screen is open', () => {
    ui.showScreen('mainMenu', { onSelect: () => undefined });
    const seen = vi.fn();
    document.body.addEventListener('keydown', seen);
    key(document.body, 'w');
    expect(seen).not.toHaveBeenCalled();
    ui.hideScreens();
    key(document.body, 'w');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('shows toasts and the loading screen', () => {
    ui.toast('נשמר', 'ok', 2);
    expect(root.querySelectorAll('.toast')).toHaveLength(1);
    expect(root.querySelector('.toast')!.classList.contains('kind-ok')).toBe(true);
    vi.advanceTimersByTime(2_400);
    expect(root.querySelectorAll('.toast')).toHaveLength(0);
    ui.setLoading(0.5, 'טוען מבנים');
    const loading = root.querySelector('.ui-loading') as HTMLElement;
    expect(loading.hidden).toBe(false);
    expect((loading.querySelector('.loading-progress i') as HTMLElement).style.width).toBe('50%');
    expect(loading.textContent).toContain('טוען מבנים');
    ui.setLoading(null);
    expect(loading.hidden).toBe(true);
  });

  it('settings screen reports changes to the app and persists UI prefs', () => {
    const onChange = vi.fn();
    ui.showScreen('settings', { settings: { ...DEFAULT_SETTINGS }, voices: ['Carmit'], gamepadStatus: 'לא מחובר', onChange, onClose: () => undefined });
    const toggles = root.querySelectorAll<HTMLInputElement>('.toggle input');
    const tts = toggles[0]!;
    tts.click();
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall![0].tts).toBe(false);
    const voice = root.querySelector<HTMLSelectElement>('select')!;
    voice.value = 'Carmit';
    voice.dispatchEvent(new Event('change'));
    expect(onChange.mock.lastCall![1].ttsVoice).toBe('Carmit');
    expect(ui.prefs.ttsVoice).toBe('Carmit');
  });

  it('dispose removes bus subscriptions and DOM', () => {
    ui.dispose();
    expect(() => bus.emit('violation', { type: 'SEATBELT', severity: 'critical', time: 0, pos: [0, 0] })).not.toThrow();
    expect(root.querySelector('.ui-hud')).toBeNull();
  });
});
