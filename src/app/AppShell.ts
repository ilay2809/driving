/**
 * Application shell: owns the renderer, settings, profile, UI and the current
 * world session; dispatches between the menu and the modes.
 */
import * as THREE from 'three';
import { EventBus } from '@/core/events';
import { loadSettings, saveSettings } from '@/core/settings';
import type { Settings, System } from '@/core/sim';
import { Profile } from '@/coach';
import { UISystem } from '@/ui';
import { describeGamepads } from '@/vehicle';
import { ContentStore } from './content';
import { WorldSession, type SessionOptions } from './WorldSession';
import { LessonMode } from '@/modes/lessonMode';
import { FreeMode } from '@/modes/freeMode';
import { TestMode } from '@/modes/testMode';
import { TheoryMode } from '@/modes/theoryMode';

export const APP_VERSION = '0.1.0';

export interface ActiveMode {
  restart(): void;
  dispose(): void;
}

export class AppShell {
  readonly bus = new EventBus();
  readonly settings: Settings = loadSettings();
  readonly content = new ContentStore();
  readonly instructorName = 'יוסי';
  canvas!: HTMLCanvasElement;
  uiRoot!: HTMLElement;
  renderer!: THREE.WebGLRenderer;
  profile!: Profile;
  ui!: UISystem;
  session: WorldSession | null = null;
  private activeMode: ActiveMode | null = null;
  private seedCounter = Date.now() % 1_000_000;

  readonly lessons = new LessonMode(this);
  readonly free = new FreeMode(this);
  readonly test = new TestMode(this);
  readonly theory = new TheoryMode(this);

  async boot(): Promise<void> {
    this.canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.uiRoot = document.getElementById('ui') as HTMLElement;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.settings.quality === 'high' ? 2 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.settings.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0b0f14, 1);

    this.profile = await Profile.getOrCreate();
    this.profile.attach(this.bus);
    this.ui = new UISystem(this.uiRoot, this.bus, this.settings, { instructorName: this.instructorName, globalKeys: true });
    this.showMainMenu();
  }

  nextSeed(): number {
    this.seedCounter = (this.seedCounter * 1103515245 + 12345) % 2147483648;
    return this.seedCounter;
  }

  // ---------------------------------------------------------------- menu & modes
  showMainMenu(): void {
    this.ui.setMode('menu');
    this.ui.setCoachPresence('none');
    this.ui.setRoute(null);
    const done = this.profile.lessonsCompleted().length;
    this.ui.showScreen('mainMenu', {
      version: APP_VERSION,
      progressText: done > 0 ? `${done} שיעורים הושלמו` : 'ברוכים הבאים! מומלץ להתחיל בשיעור הראשון.',
      onSelect: (item) => this.select(item),
    });
  }

  private select(item: 'lessons' | 'free' | 'test' | 'theory' | 'training' | 'settings'): void {
    switch (item) {
      case 'lessons':
        void this.lessons.showList();
        break;
      case 'free':
        this.setActive(this.free);
        void this.free.setup('north-tlv');
        break;
      case 'training':
        this.setActive(this.free);
        void this.free.setup('training-ground');
        break;
      case 'test':
        this.setActive(this.test);
        void this.test.intro();
        break;
      case 'theory':
        void this.theory.hub();
        break;
      case 'settings':
        this.showSettings();
        break;
    }
  }

  setActive(mode: ActiveMode | null): void {
    if (this.activeMode && this.activeMode !== mode) this.activeMode.dispose();
    this.activeMode = mode;
  }

  /** Dispose the current session (if any) and create a new one; shows loading progress. */
  async createSession(opts: Omit<SessionOptions, 'onProgress'>): Promise<WorldSession | null> {
    this.endSession();
    this.ui.hideScreens();
    this.ui.setLoading(0, 'מתחיל…');
    try {
      const session = await WorldSession.create(
        { canvas: this.canvas, renderer: this.renderer, bus: this.bus, settings: this.settings, profile: this.profile, ui: this.ui },
        { ...opts, onProgress: (p, label) => this.ui.setLoading(p, label) },
      );
      this.session = session;
      session.systems.push(this.appControls(session));
      this.ui.setLoading(null);
      this.ui.setMode(opts.mode);
      return session;
    } catch (err) {
      console.error(err);
      this.ui.setLoading(null);
      this.ui.toast(`לא הצלחתי להתחיל את הנסיעה: ${String(err)}`, 'danger', 10);
      this.showMainMenu();
      return null;
    }
  }

  endSession(): void {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    this.ui.setRoute(null);
  }

  /** Back to the main menu from anywhere. */
  toMenu(): void {
    this.setActive(null);
    this.endSession();
    this.showMainMenu();
  }

  // ---------------------------------------------------------------- pause / settings / help
  private appControls(session: WorldSession): System {
    let prevPause = false;
    let prevHelp = false;
    return {
      name: 'app-controls',
      update: () => {
        const st = session.input.state;
        if (st.pause && !prevPause) this.togglePause();
        if (st.help && !prevHelp && !session.paused) this.ui.pushScreen('help', { onClose: () => this.ui.popScreen() });
        prevPause = st.pause;
        prevHelp = st.help;
      },
    };
  }

  togglePause(): void {
    const session = this.session;
    if (!session) return;
    if (session.paused) {
      this.ui.hideScreens();
      session.setPaused(false);
      return;
    }
    session.setPaused(true);
    this.ui.showScreen('pauseMenu', {
      onResume: () => {
        this.ui.hideScreens();
        session.setPaused(false);
      },
      onRestart: () => {
        this.ui.hideScreens();
        this.activeMode?.restart();
      },
      onSettings: () => this.showSettings(),
      onMenu: () => this.toMenu(),
      onHelp: () => this.ui.pushScreen('help', { onClose: () => this.ui.popScreen() }),
    });
  }

  showSettings(): void {
    const voices = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('he')).map((v) => v.name) : [];
    let gamepadStatus = 'לא מחובר';
    try {
      const pads = describeGamepads();
      if (Array.isArray(pads) && pads.length > 0) gamepadStatus = pads.map((p: { id?: string; label?: string }) => p.label ?? p.id ?? '').join(', ');
    } catch {
      /* gamepad API unavailable */
    }
    const inSession = !!this.session;
    this.ui.pushScreen('settings', {
      settings: this.settings,
      voices,
      gamepadStatus,
      onChange: (s) => {
        Object.assign(this.settings, s);
        saveSettings(this.settings);
        this.profile.updateSettings(this.settings);
        this.session?.applySettings(this.settings);
      },
      onClose: () => {
        if (inSession) this.ui.popScreen();
        else this.showMainMenu();
      },
    });
  }
}
