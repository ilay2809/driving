/**
 * Profile — the player's progress store: lessons completed with scores, test attempts
 * (verdicts), theory answer history with spaced-repetition scheduling, settings, total
 * driving time / distance and violation counters ("your weak points").
 *
 * Persistence: idb-keyval when IndexedDB exists, else localStorage, else memory.
 * `Profile.getOrCreate()` loads (and validates) the stored profile or creates a new one.
 * `attach(bus)` records violations, lesson / test results and theory answers from the
 * EventBus; `update(ctx)` accumulates driving time / distance and autosaves.
 */
import { z } from 'zod';
import type { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS, type Settings, type SimContext, type System } from '@/core/sim';
import { VIOLATIONS, type ViolationType } from '@/rules/violations';
import type { TestVerdict } from './types';

export const PROFILE_VERSION = 1;
export const PROFILE_KEY = 'driving-sim-il:profile';

export const TheoryEntrySchema = z.object({
  attempts: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  lastAt: z.number(),
  lastCorrect: z.boolean(),
  /** Timestamp (ms) when the question is due again. */
  due: z.number(),
  /** Current repetition interval in days (0 after a wrong answer). */
  interval: z.number().nonnegative(),
});

export const ProfileDataSchema = z.object({
  version: z.literal(PROFILE_VERSION),
  createdAt: z.number(),
  updatedAt: z.number(),
  name: z.string().default(''),
  settings: z
    .object({
      volume: z.number().min(0).max(1),
      tts: z.boolean(),
      subtitles: z.boolean(),
      controls: z.enum(['keyboard', 'gamepad', 'wheel']),
      steeringAssist: z.number().min(0).max(1),
      mirrors: z.boolean(),
      quality: z.enum(['low', 'medium', 'high']),
      showLawMonitor: z.boolean(),
      language: z.literal('he'),
    })
    .partial()
    .default(() => ({})),
  // NOTE: every object / array default is a factory — zod shares a literal default's nested
  // objects between parses, which would leak answers between profiles.
  lessons: z.record(z.string(), z.object({ attempts: z.number().int(), completed: z.boolean(), bestScore: z.number(), lastScore: z.number(), lastAt: z.number() })).default(() => ({})),
  testAttempts: z
    .array(
      z.object({
        at: z.number(),
        routeId: z.string(),
        passed: z.boolean(),
        points: z.number(),
        durationSec: z.number(),
        mainReasons: z.array(z.string()),
        summary: z.string(),
        byType: z.record(z.string(), z.number()),
      }),
    )
    .default(() => []),
  theory: z
    .object({
      answers: z.record(z.string(), TheoryEntrySchema).default(() => ({})),
      exams: z.array(z.object({ at: z.number(), correct: z.number(), total: z.number(), passed: z.boolean(), durationSec: z.number() })).default(() => []),
    })
    .default(() => ({ answers: {}, exams: [] })),
  driving: z.object({ totalSeconds: z.number(), totalMetres: z.number(), sessions: z.number().int() }).default(() => ({ totalSeconds: 0, totalMetres: 0, sessions: 0 })),
  violations: z.record(z.string(), z.number()).default(() => ({})),
});

export type ProfileData = z.infer<typeof ProfileDataSchema>;
export type TheoryEntry = z.infer<typeof TheoryEntrySchema>;

export interface ProfileStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export class MemoryStore implements ProfileStore {
  readonly map = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.map.get(key);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
}

export class LocalStorageStore implements ProfileStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> = globalThis.localStorage) {}
  async get(key: string): Promise<unknown> {
    const raw = this.storage.getItem(key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  async set(key: string, value: unknown): Promise<void> {
    this.storage.setItem(key, JSON.stringify(value));
  }
}

/** idb-keyval backed store (undefined when IndexedDB is unavailable, e.g. in node). */
export async function createIdbStore(): Promise<ProfileStore | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  try {
    const idb = await import('idb-keyval');
    const store = idb.createStore('driving-sim-il', 'profile');
    return {
      get: (key) => idb.get(key, store),
      set: (key, value) => idb.set(key, value, store),
    };
  } catch {
    return undefined;
  }
}

export async function defaultStore(): Promise<ProfileStore> {
  const idb = await createIdbStore();
  if (idb) return idb;
  if (typeof localStorage !== 'undefined') return new LocalStorageStore();
  return new MemoryStore();
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const AUTOSAVE_INTERVAL = 30;

export function emptyProfileData(now = Date.now()): ProfileData {
  return {
    version: PROFILE_VERSION,
    createdAt: now,
    updatedAt: now,
    name: '',
    settings: {},
    lessons: {},
    testAttempts: [],
    theory: { answers: {}, exams: [] },
    driving: { totalSeconds: 0, totalMetres: 0, sessions: 0 },
    violations: {},
  };
}

export class Profile implements System {
  readonly name = 'profile';
  data: ProfileData;
  private store?: ProfileStore;
  private readonly key: string;
  private dirty = false;
  private lastAutosave = 0;
  private sessionCounted = false;
  private readonly now: () => number;

  constructor(data?: ProfileData, store?: ProfileStore, opts: { key?: string; now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.data = data ?? emptyProfileData(this.now());
    this.store = store;
    this.key = opts.key ?? PROFILE_KEY;
  }

  /** Load the stored profile (validated) or create a fresh one bound to the store. */
  static async getOrCreate(store?: ProfileStore, opts: { key?: string; now?: () => number } = {}): Promise<Profile> {
    const s = store ?? (await defaultStore());
    const key = opts.key ?? PROFILE_KEY;
    let data: ProfileData | undefined;
    try {
      const raw = await s.get(key);
      if (raw) {
        const parsed = ProfileDataSchema.safeParse(raw);
        if (parsed.success) data = parsed.data;
        else console.warn('[coach] stored profile invalid, starting fresh', parsed.error.issues.slice(0, 3));
      }
    } catch (err) {
      console.warn('[coach] could not read the profile store', err);
    }
    const profile = new Profile(data, s, { key, now: opts.now });
    if (!data) await profile.save();
    return profile;
  }

  get settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.data.settings };
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...patch };
    this.touch();
  }

  // ---- recording -------------------------------------------------------------------

  recordLesson(lessonId: string, passed: boolean, score: number): void {
    const prev = this.data.lessons[lessonId] ?? { attempts: 0, completed: false, bestScore: 0, lastScore: 0, lastAt: 0 };
    this.data.lessons[lessonId] = { attempts: prev.attempts + 1, completed: prev.completed || passed, bestScore: Math.max(prev.bestScore, score), lastScore: score, lastAt: this.now() };
    this.touch();
  }

  recordTest(verdict: TestVerdict, info: { routeId: string; durationSec: number }): void {
    this.data.testAttempts.push({
      at: this.now(),
      routeId: info.routeId,
      passed: verdict.passed,
      points: verdict.points,
      durationSec: info.durationSec,
      mainReasons: verdict.mainReasons,
      summary: verdict.examinerSummary,
      byType: Object.fromEntries(Object.entries(verdict.byType).map(([k, v]) => [k, v ?? 0])),
    });
    this.touch();
  }

  /** Spaced repetition: wrong → due again in 10 minutes; right → interval 1 day, then ×2.5 (max 60 days). */
  recordTheoryAnswer(questionId: string, correct: boolean, at = this.now()): TheoryEntry {
    const prev = this.data.theory.answers[questionId];
    const entry: TheoryEntry = prev ? { ...prev } : { attempts: 0, correct: 0, wrong: 0, lastAt: 0, lastCorrect: false, due: 0, interval: 0 };
    entry.attempts++;
    entry.lastAt = at;
    entry.lastCorrect = correct;
    if (correct) {
      entry.correct++;
      entry.interval = entry.interval === 0 ? 1 : Math.min(60, entry.interval * 2.5);
      entry.due = at + entry.interval * DAY;
    } else {
      entry.wrong++;
      entry.interval = 0;
      entry.due = at + 10 * MINUTE;
    }
    this.data.theory.answers[questionId] = entry;
    this.touch();
    return entry;
  }

  recordTheoryExam(result: { correct: number; total: number; passed: boolean; durationSec: number }): void {
    this.data.theory.exams.push({ at: this.now(), ...result });
    this.touch();
  }

  recordViolation(type: ViolationType | string): void {
    if (VIOLATIONS[type as ViolationType]?.severity === 'info') return;
    this.data.violations[type] = (this.data.violations[type] ?? 0) + 1;
    this.touch();
  }

  recordDriving(seconds: number, metres: number): void {
    this.data.driving.totalSeconds += seconds;
    this.data.driving.totalMetres += metres;
    this.dirty = true;
  }

  theoryEntry(questionId: string): TheoryEntry | undefined {
    return this.data.theory.answers[questionId];
  }

  // ---- queries -----------------------------------------------------------------------

  isLessonCompleted(lessonId: string): boolean {
    return this.data.lessons[lessonId]?.completed ?? false;
  }

  lessonsCompleted(): string[] {
    return Object.entries(this.data.lessons)
      .filter(([, l]) => l.completed)
      .map(([id]) => id);
  }

  /** Most frequent violation types with their Hebrew labels. */
  weakPoints(limit = 5): { type: ViolationType; count: number; label: string }[] {
    return Object.entries(this.data.violations)
      .filter(([type]) => type in VIOLATIONS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([type, count]) => ({ type: type as ViolationType, count, label: VIOLATIONS[type as ViolationType].label }));
  }

  get lastTest(): ProfileData['testAttempts'][number] | undefined {
    return this.data.testAttempts[this.data.testAttempts.length - 1];
  }

  // ---- integration --------------------------------------------------------------------

  /**
   * Record results from the bus. 'theory:answered' events are recorded too (lesson quizzes);
   * `TheoryEngine.answer()` records directly, so callers must not emit 'theory:answered' for
   * answers that went through the engine.
   */
  attach(bus: EventBus, opts: { theoryEvents?: boolean } = {}): () => void {
    const offs = [
      bus.on('violation', (v) => this.recordViolation(v.type)),
      bus.on('lesson:completed', (e) => this.recordLesson(e.lessonId, e.passed, e.score)),
      bus.on('test:finished', (e) => {
        const byType: Partial<Record<ViolationType, number>> = {};
        for (const v of e.violations) byType[v.type] = (byType[v.type] ?? 0) + 1;
        this.recordTest({ passed: e.passed, points: e.points, byType, mainReasons: [], examinerSummary: '', majors: 0, criticals: 0, minors: 0 }, { routeId: 'test', durationSec: e.durationSec });
      }),
    ];
    if (opts.theoryEvents ?? true) offs.push(bus.on('theory:answered', (e) => this.recordTheoryAnswer(e.questionId, e.correct)));
    return () => offs.forEach((off) => off());
  }

  update(ctx: SimContext): void {
    if (ctx.paused) return;
    if (!this.sessionCounted) {
      this.sessionCounted = true;
      this.data.driving.sessions++;
      this.dirty = true;
    }
    const v = Math.abs(ctx.player.speed);
    if (ctx.player.engineOn) this.recordDriving(ctx.dt, v > 0.1 ? v * ctx.dt : 0);
    if (this.dirty && ctx.time - this.lastAutosave >= AUTOSAVE_INTERVAL) {
      this.lastAutosave = ctx.time;
      void this.save();
    }
  }

  async save(): Promise<void> {
    if (!this.store) return;
    this.data.updatedAt = this.now();
    this.dirty = false;
    try {
      await this.store.set(this.key, this.data);
    } catch (err) {
      console.warn('[coach] profile save failed', err);
    }
  }

  export(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /** Replace the profile with exported JSON (validated). Returns false when invalid. */
  import(json: string | unknown): boolean {
    try {
      const raw = typeof json === 'string' ? JSON.parse(json) : json;
      const parsed = ProfileDataSchema.safeParse(raw);
      if (!parsed.success) return false;
      this.data = parsed.data;
      this.touch();
      return true;
    } catch {
      return false;
    }
  }

  reset(): void {
    this.data = emptyProfileData(this.now());
    this.touch();
  }

  private touch(): void {
    this.data.updatedAt = this.now();
    this.dirty = true;
  }
}
