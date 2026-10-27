/**
 * UISystem — the whole 2D interface as one `System`. Mounts the layers (HUD, minimap,
 * subtitles, toasts, screens, loading), subscribes to EventBus events and refreshes the HUD
 * from `update(ctx)` at ≤ 30 Hz. Other modules never touch the DOM: they emit events, and
 * the app calls `showScreen()` with props + handlers.
 */
import type { EventBus } from '@/core/events';
import type { Settings, SimContext, System } from '@/core/sim';
import type { SimMode } from '@/core/types';
import { el, setHidden } from './dom';
import { focusFirst, rovingArrows, trapTab } from './focus';
import { Hud } from './hud';
import { LoadingScreen } from './loading';
import { Minimap, type RoutePath } from './minimap';
import { freeDriveSetupScreen } from './screens/freeDriveSetup';
import { helpScreen } from './screens/help';
import { lessonBriefingScreen } from './screens/lessonBriefing';
import { lessonDebriefScreen } from './screens/lessonDebrief';
import { lessonListScreen } from './screens/lessonList';
import { mainMenuScreen } from './screens/mainMenu';
import { pauseMenuScreen } from './screens/pauseMenu';
import { settingsScreen } from './screens/settings';
import { signLibraryScreen } from './screens/signLibrary';
import { testIntroScreen } from './screens/testIntro';
import { testResultScreen } from './screens/testResult';
import { theoryModalScreen } from './screens/theoryModal';
import { theoryQuizScreen } from './screens/theoryQuiz';
import { COLLISION, INSTRUCTOR_NAME } from './strings.he';
import { Subtitles } from './subtitles';
import { Toasts } from './toasts';
import { DEFAULT_UI_PREFS, type CoachPresence, type HelpProps, type ScreenHandle, type ScreenHost, type ScreenName, type ScreenPropsMap, type ToastKind, type UiPrefs } from './types';

export const HUD_REFRESH_HZ = 30;
export const PREFS_STORAGE_KEY = 'driving-sim.ui.prefs';

export interface UISystemOptions {
  instructorName?: string;
  /** localStorage key for UI preferences (null = do not persist). */
  prefsKey?: string | null;
  /** Install the global F1 (help) handler and screen key handling on `window`. */
  globalKeys?: boolean;
}

type AnyScreenName = ScreenName | 'theoryQuestion';

interface MountedScreen {
  name: AnyScreenName;
  handle: ScreenHandle;
}

const FACTORIES: { [K in ScreenName]: (host: ScreenHost, props: ScreenPropsMap[K]) => ScreenHandle } = {
  mainMenu: mainMenuScreen,
  lessonList: lessonListScreen,
  lessonBriefing: lessonBriefingScreen,
  lessonDebrief: lessonDebriefScreen,
  freeDriveSetup: freeDriveSetupScreen,
  testIntro: testIntroScreen,
  testResult: testResultScreen,
  theoryQuiz: theoryQuizScreen,
  signLibrary: signLibraryScreen,
  settings: settingsScreen,
  help: helpScreen,
  pauseMenu: pauseMenuScreen,
};

function loadPrefs(key: string | null): UiPrefs {
  const prefs: UiPrefs = { ...DEFAULT_UI_PREFS };
  if (!key) return prefs;
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw) Object.assign(prefs, JSON.parse(raw) as Partial<UiPrefs>);
  } catch {
    /* ignore */
  }
  return prefs;
}

export class UISystem implements System {
  readonly name = 'ui';
  readonly hud: Hud;
  readonly minimap: Minimap;
  readonly subtitles: Subtitles;
  readonly toasts: Toasts;
  readonly loading: LoadingScreen;
  readonly prefs: UiPrefs;
  readonly settings: Settings;

  private readonly screensLayer: HTMLElement;
  private readonly toastsLayer: HTMLElement;
  private stack: MountedScreen[] = [];
  private unsubs: (() => void)[] = [];
  private mode: SimMode = 'menu';
  private presenceExplicit = false;
  private instructorName: string;
  private helpProps: HelpProps = {};
  private acc = 0;
  private hudEverUpdated = false;
  private lastCtx?: SimContext;
  private readonly prefsKey: string | null;
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private readonly globalKeys: boolean;
  private disposed = false;

  constructor(
    readonly root: HTMLElement,
    readonly bus: EventBus,
    settings: Settings,
    opts: UISystemOptions = {},
  ) {
    this.settings = settings;
    this.instructorName = opts.instructorName ?? INSTRUCTOR_NAME;
    this.prefsKey = opts.prefsKey === undefined ? PREFS_STORAGE_KEY : opts.prefsKey;
    this.prefs = loadPrefs(this.prefsKey);
    this.globalKeys = opts.globalKeys ?? true;

    root.classList.add('ui-root', 'mode-menu');
    root.setAttribute('dir', 'rtl');
    root.setAttribute('lang', 'he');

    this.hud = new Hud();
    this.minimap = new Minimap({ headingUp: this.prefs.minimapHeadingUp });
    this.hud.regions.bl.append(this.minimap.el, this.minimap.streetEl);
    this.subtitles = new Subtitles();
    this.toastsLayer = el('div', { class: 'ui-toasts', attrs: { 'aria-live': 'polite' } });
    this.toastsLayer.style.pointerEvents = 'none';
    this.toasts = new Toasts(this.toastsLayer);
    this.screensLayer = el('div', { class: 'ui-screens' }, el('div', { class: 'backdrop' }));
    this.screensLayer.hidden = true;
    this.loading = new LoadingScreen();
    root.append(this.hud.el, this.subtitles.el, this.toastsLayer, this.screensLayer, this.loading.el);

    this.hud.setPresence('none');
    this.subscribe();
    if (this.globalKeys && typeof window !== 'undefined') window.addEventListener('keydown', this.keyHandler, true);
  }

  // ------------------------------------------------------------- events
  private subscribe(): void {
    const on = this.bus.on.bind(this.bus);
    this.unsubs.push(
      on('violation', (v) => this.hud.lawMonitor.push(v)),
      on('coach:say', (req) => this.subtitles.say(req)),
      on('coach:said', ({ id }) => this.subtitles.said(id)),
      on('coach:instruction', (instr) => {
        this.hud.navBanner.set(instr);
        this.minimap.setNextJunction(instr.junctionId);
      }),
      on('coach:intervention', ({ kind }) => this.hud.intervention(kind)),
      on('input:glance', ({ target }) => this.hud.glance(target)),
      on('lesson:briefing', (b) => this.showScreen('lessonBriefing', { lessonId: b.lessonId, title: b.title, slides: b.slides })),
      on('lesson:hint', ({ text, icon, seconds }) => this.subtitles.hint(text, icon, seconds)),
      on('lesson:step', ({ index, total }) => this.hud.setStep(index + 1, total)),
      on('lesson:highlight', ({ target, seconds }) => this.hud.highlight(target, seconds)),
      on('lesson:completed', () => {
        this.hud.clearStep();
        this.hud.navBanner.clear();
        this.minimap.setNextJunction(undefined);
      }),
      on('theory:question', (q) => this.pushTheoryQuestion(q)),
      on('examiner:maneuver', ({ kind, text, status }) => this.hud.setManeuver(kind, text, status)),
      on('mode:changed', ({ mode }) => this.setMode(mode)),
      on('sim:paused', ({ paused }) => this.root.classList.toggle('paused', paused)),
      on('sim:reset', () => this.resetTransient()),
      on('test:started', () => this.resetTransient()),
      on('test:finished', () => {
        this.hud.navBanner.clear();
        this.minimap.setNextJunction(undefined);
      }),
      on('vehicle:collision', ({ with: what }) => {
        this.hud.flashVignette();
        if (what === 'vehicle' || what === 'pedestrian') this.hud.showBanner(COLLISION, 'warning', 1500);
      }),
    );
  }

  private resetTransient(): void {
    this.hud.lawMonitor.clear();
    this.hud.navBanner.clear();
    this.subtitles.clear();
    this.minimap.setNextJunction(undefined);
    this.hud.clearStep();
  }

  // ---------------------------------------------------------- per frame
  update(ctx: SimContext): void {
    if (this.disposed) return;
    this.lastCtx = ctx;
    if (ctx.mode !== this.mode) this.setMode(ctx.mode);
    const wallDt = ctx.timeScale > 0 ? ctx.dt / ctx.timeScale : ctx.dt;
    this.acc += wallDt;
    if (this.hudEverUpdated && this.acc < 1 / HUD_REFRESH_HZ - 1e-4) return;
    const elapsed = this.acc;
    this.acc = 0;
    this.hudEverUpdated = true;
    if (!this.presenceExplicit) {
      const derived: CoachPresence = !ctx.coachPresent ? 'none' : ctx.mode === 'test' ? 'examiner' : 'instructor';
      if (derived !== this.hud.currentPresence) this.hud.setPresence(derived, this.instructorName);
    }
    this.hud.update(ctx, elapsed);
    this.hud.lawMonitor.setVisible(ctx.settings.showLawMonitor);
    this.subtitles.setEnabled(ctx.settings.subtitles);
    this.subtitles.setIdlePrompt(ctx.mode === 'lesson' && ctx.coachPresent && this.prefs.hintPrompt && !ctx.paused);
    this.minimap.headingUp = this.prefs.minimapHeadingUp;
    this.minimap.update(ctx);
  }

  // ------------------------------------------------------------ public API
  setMode(mode: SimMode): void {
    if (mode !== this.mode) {
      this.root.classList.remove(`mode-${this.mode}`);
      this.mode = mode;
      this.root.classList.add(`mode-${mode}`);
    }
  }

  get currentMode(): SimMode {
    return this.mode;
  }

  /** Explicit presence (stops the automatic derivation from ctx.coachPresent/mode). */
  setCoachPresence(presence: CoachPresence, name?: string): void {
    this.presenceExplicit = true;
    if (name) this.instructorName = name;
    this.hud.setPresence(presence, this.instructorName);
  }

  /** Go back to deriving the presence from the SimContext. */
  autoCoachPresence(): void {
    this.presenceExplicit = false;
  }

  toast(text: string, kind: ToastKind = 'info', seconds = 4): void {
    this.toasts.show(text, kind, seconds);
  }

  /** progress 0..1 (null hides the loading screen). */
  setLoading(progress: number | null, label?: string): void {
    this.loading.set(progress, label);
  }

  /** Route polyline (world metres) or a path result from RoadGraph.findPath / routeViaJunctions. */
  setRoute(path: RoutePath | null): void {
    this.minimap.setRoute(path);
  }

  /** Data for the F1 help overlay (keymap, gamepad / wheel notes). */
  setHelp(props: HelpProps): void {
    this.helpProps = props;
  }

  setPrefs(patch: Partial<UiPrefs>): void {
    Object.assign(this.prefs, patch);
    this.savePrefs();
    this.minimap.headingUp = this.prefs.minimapHeadingUp;
  }

  savePrefs(): void {
    if (!this.prefsKey) return;
    try {
      globalThis.localStorage?.setItem(this.prefsKey, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
  }

  // --------------------------------------------------------------- screens
  get currentScreen(): AnyScreenName | undefined {
    return this.stack[this.stack.length - 1]?.name;
  }

  /** Replace whatever is open with this screen. */
  showScreen<K extends ScreenName>(name: K, props: ScreenPropsMap[K]): HTMLElement {
    this.hideScreens();
    return this.mount(name, FACTORIES[name](this.host(), props));
  }

  /** Open a screen on top of the current one (the one below is hidden, not disposed). */
  pushScreen<K extends ScreenName>(name: K, props: ScreenPropsMap[K]): HTMLElement {
    const top = this.stack[this.stack.length - 1];
    if (top) top.handle.el.hidden = true;
    return this.mount(name, FACTORIES[name](this.host(), props));
  }

  /** Close the top screen and reveal the one below (if any). */
  popScreen(): void {
    const top = this.stack.pop();
    if (top) this.unmount(top);
    const next = this.stack[this.stack.length - 1];
    if (next) {
      next.handle.el.hidden = false;
      this.applyKind(next.handle);
      focusFirst(next.handle.el, next.handle.initialFocus);
    } else {
      this.screensLayer.hidden = true;
    }
  }

  hideScreens(): void {
    while (this.stack.length > 0) this.unmount(this.stack.pop()!);
    setHidden(this.screensLayer, true);
  }

  private host(): ScreenHost {
    return { bus: this.bus, prefs: this.prefs, close: () => this.popScreen() };
  }

  private mount(name: AnyScreenName, handle: ScreenHandle): HTMLElement {
    this.stack.push({ name, handle });
    this.screensLayer.appendChild(handle.el);
    this.applyKind(handle);
    setHidden(this.screensLayer, false);
    focusFirst(handle.el, handle.initialFocus);
    return handle.el;
  }

  private applyKind(handle: ScreenHandle): void {
    this.screensLayer.classList.toggle('kind-modal', handle.kind === 'modal');
    this.screensLayer.classList.toggle('kind-full', handle.kind === 'full');
  }

  private unmount(m: MountedScreen): void {
    try {
      m.handle.dispose?.();
    } catch (err) {
      console.error('[ui] screen dispose threw', err);
    }
    m.handle.el.remove();
  }

  private pushTheoryQuestion(q: Parameters<typeof theoryModalScreen>[1]): void {
    const top = this.stack[this.stack.length - 1];
    if (top) top.handle.el.hidden = true;
    this.mount('theoryQuestion', theoryModalScreen(this.host(), q));
  }

  // ------------------------------------------------------------- keyboard
  private onKey(e: KeyboardEvent): void {
    if (this.disposed) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      if (e.key === 'F1' && !this.loading.visible) {
        e.preventDefault();
        this.pushScreen('help', { ...this.helpProps, onClose: () => this.popScreen() });
      }
      return;
    }
    const h = top.handle;
    if (e.key === 'F1' && top.name !== 'help') {
      e.preventDefault();
      e.stopPropagation();
      this.pushScreen('help', { ...this.helpProps, onClose: () => this.popScreen() });
      return;
    }
    if (h.onKey?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (trapTab(h.el, e) || rovingArrows(e)) {
      e.stopPropagation();
      return;
    }
    // Keep driving keys from reaching the input system while a full screen is open.
    if (h.kind === 'full' && !/^F\d+$/.test(e.key)) e.stopPropagation();
  }

  /** Last SimContext seen by update() (for screens that enrich data, e.g. place names). */
  get context(): SimContext | undefined {
    return this.lastCtx;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubs) off();
    this.unsubs = [];
    if (this.globalKeys && typeof window !== 'undefined') window.removeEventListener('keydown', this.keyHandler, true);
    this.hideScreens();
    this.hud.dispose();
    this.minimap.dispose();
    this.subtitles.dispose();
    this.toasts.clear();
    this.loading.dispose();
    this.toastsLayer.remove();
    this.screensLayer.remove();
    this.root.classList.remove('ui-root', `mode-${this.mode}`);
  }
}
