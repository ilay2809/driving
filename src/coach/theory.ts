/**
 * TheoryEngine — quiz / exam engine over the official question bank.
 *
 *  pick():  seeded selection; with `weakFirst` (default) questions answered wrong before and
 *           questions that are due (spaced repetition in the Profile) come first, then unseen
 *           ones, then the rest.
 *  answer(): checks the answer and records it in the Profile (wrong → due again in 10 min,
 *           right → due later, growing intervals).
 *  Exam mode mirrors the real theory test: 30 questions, 40 minutes, pass with ≥ 26 correct
 *  (4 mistakes allowed). The engine exposes the remaining time; the UI counts down and calls
 *  finishExam() (answers after the time is up finish the exam automatically).
 */
import { createRng } from '@/core/sim';
import type { TheoryQuestion } from '@/content/schema';
import type { Profile } from './profile';

export interface PickOptions {
  topics?: string[];
  categories?: string[];
  count: number;
  /** Only questions valid for the class-B licence. */
  classB?: true;
  /** Prefer questions answered wrong / due for review (default true). */
  weakFirst?: boolean;
  excludeIds?: string[];
}

export interface TheoryStats {
  total: number;
  seen: number;
  attempts: number;
  correct: number;
  accuracy: number;
  due: number;
  byCategory: Record<string, { total: number; attempts: number; correct: number }>;
  weakTopics: string[];
  exams: { taken: number; passed: number; best: number };
}

export interface ExamState {
  questions: TheoryQuestion[];
  startedAt: number;
  durationSec: number;
  passMark: number;
  answers: { questionId: string; index: number; correct: boolean }[];
}

export interface ExamResult {
  passed: boolean;
  correct: number;
  total: number;
  mistakes: number;
  answers: ExamState['answers'];
  durationSec: number;
  timedOut: boolean;
  /** Questions answered wrong (for the review screen). */
  wrong: TheoryQuestion[];
}

export const EXAM_DEFAULTS = { count: 30, minutes: 40, passMark: 26 } as const;

export class TheoryEngine {
  private readonly rng: () => number;
  private readonly now: () => number;
  private readonly byIdMap = new Map<string, TheoryQuestion>();
  private current?: ExamState;

  constructor(
    readonly questions: TheoryQuestion[],
    private readonly profile: Profile,
    opts: { seed?: number; now?: () => number } = {},
  ) {
    this.rng = createRng(opts.seed ?? 42);
    this.now = opts.now ?? (() => Date.now());
    for (const q of questions) this.byIdMap.set(q.id, q);
  }

  byId(id: string): TheoryQuestion | undefined {
    return this.byIdMap.get(id);
  }

  /** Lookup suitable for LessonRunner's `questionLookup`. */
  get lookup(): (id: string) => TheoryQuestion | undefined {
    return (id) => this.byIdMap.get(id);
  }

  pick(opts: PickOptions): TheoryQuestion[] {
    const exclude = new Set(opts.excludeIds ?? []);
    let pool = this.questions.filter((q) => !exclude.has(q.id));
    if (opts.classB) pool = pool.filter((q) => q.classes.includes('B'));
    if (opts.topics && opts.topics.length > 0) pool = pool.filter((q) => q.topics.some((t) => opts.topics!.includes(t)));
    if (opts.categories && opts.categories.length > 0) pool = pool.filter((q) => opts.categories!.includes(q.category));
    const shuffled = this.shuffle(pool);
    if (opts.weakFirst === false) return shuffled.slice(0, opts.count);
    const now = this.now();
    const tier = (q: TheoryQuestion): number => {
      const e = this.profile.theoryEntry(q.id);
      if (!e) return 2; // unseen
      if (e.due <= now) return e.lastCorrect ? 1 : 0; // due: wrong ones first
      return 3; // not due yet
    };
    const scored = shuffled.map((q, i) => ({ q, i, tier: tier(q), due: this.profile.theoryEntry(q.id)?.due ?? 0 }));
    scored.sort((a, b) => a.tier - b.tier || (a.tier === 3 ? a.due - b.due : 0) || a.i - b.i);
    return scored.slice(0, opts.count).map((s) => s.q);
  }

  /** Check an answer and record it (practice mode). */
  answer(questionId: string, index: number): { correct: boolean; correctIndex: number; question: TheoryQuestion } {
    const question = this.byIdMap.get(questionId);
    if (!question) throw new Error(`unknown question ${questionId}`);
    const correct = index === question.correctIndex;
    this.profile.recordTheoryAnswer(questionId, correct, this.now());
    return { correct, correctIndex: question.correctIndex, question };
  }

  stats(): TheoryStats {
    const now = this.now();
    const byCategory: TheoryStats['byCategory'] = {};
    const topicStats = new Map<string, { attempts: number; correct: number }>();
    let seen = 0;
    let attempts = 0;
    let correct = 0;
    let due = 0;
    for (const q of this.questions) {
      const cat = (byCategory[q.category] ??= { total: 0, attempts: 0, correct: 0 });
      cat.total++;
      const e = this.profile.theoryEntry(q.id);
      if (!e) continue;
      seen++;
      attempts += e.attempts;
      correct += e.correct;
      cat.attempts += e.attempts;
      cat.correct += e.correct;
      if (e.due <= now) due++;
      for (const t of q.topics) {
        const ts = topicStats.get(t) ?? { attempts: 0, correct: 0 };
        ts.attempts += e.attempts;
        ts.correct += e.correct;
        topicStats.set(t, ts);
      }
    }
    const weakTopics = [...topicStats.entries()]
      .filter(([, s]) => s.attempts >= 2 && s.correct / s.attempts < 0.7)
      .sort((a, b) => a[1].correct / a[1].attempts - b[1].correct / b[1].attempts)
      .map(([t]) => t);
    const exams = this.profile.data.theory.exams;
    return {
      total: this.questions.length,
      seen,
      attempts,
      correct,
      accuracy: attempts > 0 ? correct / attempts : 0,
      due,
      byCategory,
      weakTopics,
      exams: { taken: exams.length, passed: exams.filter((e) => e.passed).length, best: exams.reduce((m, e) => Math.max(m, e.correct), 0) },
    };
  }

  // ---- exam mode ------------------------------------------------------------------------

  get exam(): ExamState | undefined {
    return this.current;
  }

  startExam(opts: { count?: number; minutes?: number; passMark?: number } = {}): ExamState {
    const count = opts.count ?? EXAM_DEFAULTS.count;
    const questions = this.pick({ count, classB: true, weakFirst: false });
    this.current = { questions, startedAt: this.now(), durationSec: (opts.minutes ?? EXAM_DEFAULTS.minutes) * 60, passMark: opts.passMark ?? EXAM_DEFAULTS.passMark, answers: [] };
    return this.current;
  }

  examRemainingSeconds(): number {
    if (!this.current) return 0;
    return Math.max(0, this.current.durationSec - (this.now() - this.current.startedAt) / 1000);
  }

  /** Answer an exam question; after the time is up the exam is finished and the answer ignored. */
  answerExam(questionId: string, index: number): { correct: boolean; correctIndex: number; finished?: ExamResult } {
    const exam = this.current;
    if (!exam) throw new Error('no exam in progress');
    const question = exam.questions.find((q) => q.id === questionId);
    if (!question) throw new Error(`question ${questionId} is not part of the exam`);
    if (this.examRemainingSeconds() <= 0) return { correct: false, correctIndex: question.correctIndex, finished: this.finishExam() };
    const correct = index === question.correctIndex;
    const existing = exam.answers.find((a) => a.questionId === questionId);
    if (existing) {
      existing.index = index;
      existing.correct = correct;
    } else exam.answers.push({ questionId, index, correct });
    this.profile.recordTheoryAnswer(questionId, correct, this.now());
    return { correct, correctIndex: question.correctIndex };
  }

  finishExam(): ExamResult {
    const exam = this.current;
    if (!exam) throw new Error('no exam in progress');
    this.current = undefined;
    const correct = exam.answers.filter((a) => a.correct).length;
    const total = exam.questions.length;
    const elapsed = (this.now() - exam.startedAt) / 1000;
    const timedOut = elapsed >= exam.durationSec;
    const result: ExamResult = {
      passed: correct >= Math.min(exam.passMark, total),
      correct,
      total,
      mistakes: total - correct,
      answers: exam.answers,
      durationSec: Math.min(elapsed, exam.durationSec),
      timedOut,
      wrong: exam.questions.filter((q) => !exam.answers.some((a) => a.questionId === q.id && a.correct)),
    };
    this.profile.recordTheoryExam({ correct, total, passed: result.passed, durationSec: result.durationSec });
    return result;
  }

  abortExam(): void {
    this.current = undefined;
  }

  // ---- internals --------------------------------------------------------------------------

  private shuffle<T>(items: T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}
