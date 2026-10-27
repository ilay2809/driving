import { describe, expect, it } from 'vitest';
import type { TheoryQuestion } from '@/content/schema';
import { MemoryStore, Profile } from './profile';
import { EXAM_DEFAULTS, TheoryEngine } from './theory';

const CATEGORIES = ['חוקי התנועה', 'תמרורים', 'בטיחות'];
const TOPICS = ['priority', 'roundabout', 'parking', 'signals'];
const BANK: TheoryQuestion[] = Array.from({ length: 60 }, (_, i) => ({
  id: `q${i}`,
  text: `שאלה ${i}`,
  answers: ['א', 'ב', 'ג', 'ד'],
  correctIndex: i % 4,
  category: CATEGORIES[i % 3]!,
  classes: i % 5 === 0 ? ['C'] : ['B', 'A'],
  image: null,
  signs: [],
  topics: [TOPICS[i % 4]!],
}));

function engine(seed = 1, start = 1_000_000) {
  let t = start;
  const now = () => t;
  const profile = new Profile(undefined, new MemoryStore(), { now });
  const e = new TheoryEngine(BANK, profile, { seed, now });
  return { e, profile, advance: (ms: number) => (t += ms), now };
}

describe('TheoryEngine', () => {
  it('picks deterministically per seed, filters by class B / topics / categories and never repeats within a pick', () => {
    const a = engine(5).e.pick({ count: 10, classB: true });
    const b = engine(5).e.pick({ count: 10, classB: true });
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    expect(new Set(a.map((q) => q.id)).size).toBe(10);
    expect(a.every((q) => q.classes.includes('B'))).toBe(true);
    const c = engine(9).e.pick({ count: 10, classB: true });
    expect(c.map((q) => q.id)).not.toEqual(a.map((q) => q.id));
    const topical = engine(1).e.pick({ count: 50, topics: ['roundabout'] });
    expect(topical.length).toBe(15);
    expect(topical.every((q) => q.topics.includes('roundabout'))).toBe(true);
    const cat = engine(1).e.pick({ count: 50, categories: ['תמרורים'], excludeIds: ['q1'] });
    expect(cat.every((q) => q.category === 'תמרורים' && q.id !== 'q1')).toBe(true);
  });

  it('answers, records to the profile and schedules repetition (wrong → soon, right → later)', () => {
    const { e, profile, advance, now } = engine();
    const wrong = e.answer('q3', 0); // correct is 3
    expect(wrong.correct).toBe(false);
    expect(wrong.correctIndex).toBe(3);
    const entry = profile.theoryEntry('q3')!;
    expect(entry.wrong).toBe(1);
    expect(entry.due - now()).toBe(10 * 60_000);
    advance(60_000);
    const right = e.answer('q3', 3);
    expect(right.correct).toBe(true);
    const e2 = profile.theoryEntry('q3')!;
    expect(e2.correct).toBe(1);
    expect(e2.interval).toBe(1);
    expect(e2.due - now()).toBe(86_400_000);
    advance(2 * 86_400_000);
    e.answer('q3', 3);
    expect(profile.theoryEntry('q3')!.interval).toBe(2.5);
    expect(() => e.answer('nope', 0)).toThrow();
  });

  it('puts due / wrong questions first when weakFirst, unseen next, not-due last', () => {
    const { e, advance } = engine(2);
    e.answer('q2', 0); // wrong (correct 2) → due in 10 min
    e.answer('q5', 1); // right (correct 1) → due tomorrow
    e.answer('q9', 1); // right → due tomorrow
    advance(11 * 60_000);
    const picked = e.pick({ count: 60 });
    const ids = picked.map((q) => q.id);
    expect(ids[0]).toBe('q2'); // due and wrong
    expect(ids.indexOf('q5')).toBeGreaterThan(50); // not due: last tier
    expect(ids.indexOf('q9')).toBeGreaterThan(50);
    const unseen = ids.slice(1, 10);
    expect(unseen.includes('q5')).toBe(false);
    advance(2 * 86_400_000);
    const later = e.pick({ count: 5 }).map((q) => q.id);
    expect(later.slice(0, 3).sort()).toEqual(['q2', 'q5', 'q9']);
    expect(engine(2).e.pick({ count: 3, weakFirst: false }).length).toBe(3);
  });

  it('computes stats by category and weak topics', () => {
    const { e, advance } = engine();
    for (let i = 0; i < 8; i++) e.answer(`q${i * 4 + 1}`, 0); // topic roundabout (i%4 === 1): correct index 1 → all wrong
    for (let i = 0; i < 4; i++) e.answer(`q${i * 4}`, 0); // topic priority: correct index 0 → right
    const s = e.stats();
    expect(s.total).toBe(60);
    expect(s.seen).toBe(12);
    expect(s.attempts).toBe(12);
    expect(s.correct).toBe(4);
    expect(s.accuracy).toBeCloseTo(1 / 3, 5);
    expect(s.weakTopics).toEqual(['roundabout']);
    expect(Object.keys(s.byCategory).sort()).toEqual([...CATEGORIES].sort());
    expect(s.due).toBe(0); // wrong answers come back after 10 minutes
    advance(11 * 60_000);
    expect(e.stats().due).toBe(8);
  });

  it('runs an exam: 30 class-B questions, 40 minutes, pass with ≥ 26', () => {
    const { e, advance, profile } = engine(3);
    const exam = e.startExam();
    expect(exam.questions.length).toBe(EXAM_DEFAULTS.count);
    expect(exam.questions.every((q) => q.classes.includes('B'))).toBe(true);
    expect(e.examRemainingSeconds()).toBe(2400);
    advance(5 * 60_000);
    expect(e.examRemainingSeconds()).toBe(2100);
    exam.questions.forEach((q, i) => {
      const r = e.answerExam(q.id, i < 4 ? (q.correctIndex + 1) % 4 : q.correctIndex);
      expect(r.correct).toBe(i >= 4);
    });
    // changing an answer replaces the previous one
    e.answerExam(exam.questions[0]!.id, exam.questions[0]!.correctIndex);
    const result = e.finishExam();
    expect(result.total).toBe(30);
    expect(result.correct).toBe(27);
    expect(result.mistakes).toBe(3);
    expect(result.passed).toBe(true);
    expect(result.wrong.length).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.durationSec).toBe(300);
    expect(e.exam).toBeUndefined();
    expect(profile.data.theory.exams.length).toBe(1);
    expect(e.stats().exams).toEqual({ taken: 1, passed: 1, best: 27 });
    // 5 mistakes fail
    const second = e.startExam();
    second.questions.forEach((q, i) => e.answerExam(q.id, i < 5 ? (q.correctIndex + 1) % 4 : q.correctIndex));
    expect(e.finishExam().passed).toBe(false);
    // time runs out: the next answer finishes the exam
    const third = e.startExam({ minutes: 1 });
    advance(61_000);
    const late = e.answerExam(third.questions[0]!.id, third.questions[0]!.correctIndex);
    expect(late.finished?.timedOut).toBe(true);
    expect(late.finished?.correct).toBe(0);
    expect(e.exam).toBeUndefined();
    expect(() => e.finishExam()).toThrow();
  });
});
