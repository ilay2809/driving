/**
 * Public types of the UI module. Screens are driven by props the app passes to
 * `UISystem.showScreen(name, props)`; everything else is driven by EventBus events
 * and the per-frame `update(ctx)`.
 */
import type { Settings } from '@/core/sim';
import type { SimEventMap } from '@/core/events';
import type { SignDef, TheoryQuestion } from '@/content/schema';
import type { Violation } from '@/rules/violations';

export type CoachPresence = 'instructor' | 'examiner' | 'none';
export type ToastKind = 'info' | 'ok' | 'warn' | 'danger';

/** UI-only preferences (not part of the shared Settings contract). Persisted in localStorage. */
export interface UiPrefs {
  /** Rotate the minimap with the car's heading (false = north up). */
  minimapHeadingUp: boolean;
  /** Show the "לחץ ? להסבר" prompt when the coach is idle in lessons. */
  hintPrompt: boolean;
  /** Preferred Web Speech voice name (null = browser default). */
  ttsVoice: string | null;
}

export const DEFAULT_UI_PREFS: UiPrefs = { minimapHeadingUp: true, hintPrompt: true, ttsVoice: null };

export type LessonStatus = 'locked' | 'unlocked' | 'completed';

export interface LessonCardData {
  id: string;
  order: number;
  title: string;
  subtitle?: string;
  minutes: number;
  status: LessonStatus;
  /** 0..100 when completed. */
  score?: number;
}

export type MenuItemId = 'lessons' | 'free' | 'test' | 'theory' | 'training' | 'settings';

export interface MainMenuProps {
  onSelect: (item: MenuItemId) => void;
  version?: string;
  /** Short progress line, e.g. "4 מתוך 12 שיעורים הושלמו". */
  progressText?: string;
}

export interface LessonListProps {
  lessons: LessonCardData[];
  onSelect: (lessonId: string) => void;
  onBack: () => void;
  /** Lesson to offer as "resume". */
  resumeId?: string;
}

export type BriefingSlideData = SimEventMap['lesson:briefing']['slides'][number];

export interface LessonBriefingProps {
  lessonId: string;
  title: string;
  slides: BriefingSlideData[];
  /** Called after 'ui:acknowledged' {context:'briefing'} is emitted. */
  onStart?: () => void;
  onClose?: () => void;
}

export interface DebriefError {
  type: string;
  label: string;
  advice: string;
  count: number;
  severity: 'minor' | 'major' | 'critical';
}

export interface LessonDebriefProps {
  lessonTitle: string;
  score: number;
  passed: boolean;
  counts: { minor: number; major: number; critical: number };
  errors: DebriefError[];
  /** Extra closing line from the instructor. */
  summary?: string;
  onAgain: () => void;
  onNext?: () => void;
  onMenu: () => void;
}

export interface FreeDriveConfig {
  spawnId: string;
  /** 0..1 */
  traffic: number;
  /** 0..1 */
  pedestrians: number;
  /** 0..24 */
  hour: number;
  weather: 'clear' | 'rain' | 'fog';
  coach: boolean;
  lawMonitor: boolean;
}

export interface FreeDriveSetupProps {
  spawnPoints: { id: string; name: string }[];
  defaults?: Partial<FreeDriveConfig>;
  onStart: (config: FreeDriveConfig) => void;
  onBack: () => void;
}

export interface TestIntroProps {
  routes: { id: string; name: string }[];
  onStart: (choice: { routeId: string | 'random' }) => void;
  onBack: () => void;
}

export interface ManeuverResult {
  kind: string;
  label?: string;
  status: 'requested' | 'completed' | 'failed' | 'skipped';
}

export interface TestResultProps {
  passed: boolean;
  /** Date of the test (ms epoch or Date). */
  date: number | Date;
  routeName: string;
  durationSec: number;
  points: number;
  maxPoints?: number;
  violations: (Violation & { place?: string })[];
  maneuvers: ManeuverResult[];
  summary: string;
  examinerName?: string;
  onNewTest: () => void;
  onReplay?: () => void;
  onMenu: () => void;
}

export interface TheoryQuizResult {
  total: number;
  correct: number;
  answers: { questionId: string; index: number | null; correct: boolean }[];
  byTopic: { topic: string; total: number; correct: number }[];
  passed: boolean;
  timedOut: boolean;
}

export interface TheoryQuizProps {
  questions: TheoryQuestion[];
  mode: 'practice' | 'exam';
  /** Exam mode only: seconds for the whole quiz (default 40 min). */
  timeLimitSec?: number;
  /** Pass mark (number of correct answers), default ceil(total*26/30). */
  passMark?: number;
  /** Optional explanation per question id, shown after answering. */
  explanations?: Record<string, string>;
  onAnswer?: (questionId: string, index: number, correct: boolean) => void;
  onFinish: (result: TheoryQuizResult) => void;
  onClose: () => void;
}

export interface SignLibraryProps {
  signs: SignDef[];
  onClose: () => void;
  /** Initially selected sign code. */
  selected?: string;
}

export interface SettingsProps {
  settings: Settings;
  /** Available TTS voice names. */
  voices: string[];
  /** Text describing the detected gamepad / wheel, e.g. "לא מחובר". */
  gamepadStatus: string;
  onChange: (settings: Settings, prefs: UiPrefs) => void;
  onClose: () => void;
}

export interface KeymapEntry {
  keys: string[];
  action: string;
}

export interface HelpProps {
  keymap?: KeymapEntry[];
  gamepadNotes?: string[];
  wheelNotes?: string[];
  onClose?: () => void;
}

export interface PauseMenuProps {
  onResume: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onMenu: () => void;
  onHelp?: () => void;
}

export interface ScreenPropsMap {
  mainMenu: MainMenuProps;
  lessonList: LessonListProps;
  lessonBriefing: LessonBriefingProps;
  lessonDebrief: LessonDebriefProps;
  freeDriveSetup: FreeDriveSetupProps;
  testIntro: TestIntroProps;
  testResult: TestResultProps;
  theoryQuiz: TheoryQuizProps;
  signLibrary: SignLibraryProps;
  settings: SettingsProps;
  help: HelpProps;
  pauseMenu: PauseMenuProps;
}

export type ScreenName = keyof ScreenPropsMap;

/** What the UISystem offers a screen while it is mounted. */
export interface ScreenHost {
  bus: import('@/core/events').EventBus;
  prefs: UiPrefs;
  /** Close this screen (the app's callbacks decide what comes next). */
  close(): void;
}

/** What a mounted screen hands back to the screen host. */
export interface ScreenHandle {
  el: HTMLElement;
  /** Return true when the key was handled (the host then stops propagation). */
  onKey?: (e: KeyboardEvent) => boolean;
  dispose?: () => void;
  /** Element to focus initially (defaults to the first focusable). */
  initialFocus?: HTMLElement;
  /** 'full' covers the scene with a dark backdrop; 'modal' keeps the scene visible. */
  kind: 'full' | 'modal';
}
