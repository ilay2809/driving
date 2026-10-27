import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIOLATION_TYPES } from '@/rules/violations';
import { parseLessons, type Condition, type Lesson, type LessonStep } from '@/coach/lessonSchema';
import { buildTrainingGround } from '@/world/testWorld';
import {
  BRIEFING_DIAGRAMS,
  NORTH_TLV_SPAWN_IDS,
  REQUIRED_DIALOGUE_KEYS,
  fillPlaceholders,
  indexDialogue,
  loadDialogue,
  loadLessons,
  loadRules,
  loadSigns,
  loadTheory,
  pickVariant,
  questionsByTopic,
  sayLine,
  signUrl,
} from './loaders';

const unique = <T>(xs: readonly T[]): boolean => new Set(xs).size === xs.length;

/** Walk a condition tree and collect every referenced id of a kind. */
function collectIds(c: Condition, out: { spawn: Set<string>; junction: Set<string>; crossing: Set<string>; bay: Set<string> }): void {
  if (!c || typeof c !== 'object') return;
  if ('spawnId' in c && typeof c.spawnId === 'string') out.spawn.add(c.spawnId);
  if ('junctionId' in c && typeof c.junctionId === 'string') out.junction.add(c.junctionId);
  if ('crossingId' in c && typeof c.crossingId === 'string') out.crossing.add(c.crossingId);
  if ('bayId' in c && typeof c.bayId === 'string') out.bay.add(c.bayId);
  if ('of' in c && Array.isArray(c.of)) for (const sub of c.of) collectIds(sub as Condition, out);
}

function lessonRefs(lesson: Lesson) {
  const out = { spawn: new Set<string>([lesson.spawnId]), junction: new Set<string>(), crossing: new Set<string>(), bay: new Set<string>() };
  for (const step of lesson.steps) {
    collectIds(step.done, out);
    if (step.fail) collectIds(step.fail, out);
    if (step.navigateTo?.spawnId) out.spawn.add(step.navigateTo.spawnId);
    if (step.navigateTo?.junctionId) out.junction.add(step.navigateTo.junctionId);
    for (const v of step.navigateTo?.via ?? []) out.junction.add(v);
    for (const t of step.triggers) {
      collectIds(t.when, out);
      for (const a of t.do) {
        if (a.kind === 'spawn_pedestrian' && a.crossingId) out.crossing.add(a.crossingId);
        if (a.kind === 'set_signal' && a.junctionId) out.junction.add(a.junctionId);
      }
    }
  }
  return out;
}

describe('theory bank', () => {
  it('loads, validates and has unique ids with sane answers', async () => {
    const bank = await loadTheory();
    expect(bank.length).toBeGreaterThan(1000);
    expect(unique(bank.map((q) => q.id))).toBe(true);
    for (const q of bank) {
      expect(q.classes).toContain('B');
      expect(q.correctIndex).toBeLessThan(q.answers.length);
      expect(q.text.length).toBeGreaterThan(5);
      expect(q.topics.length).toBeGreaterThan(0);
      if (q.image !== null) expect(q.topics).toContain('has_image');
    }
    expect(questionsByTopic(bank, 'roundabout').length).toBeGreaterThan(3);
    expect(questionsByTopic(bank, 'priority').length).toBeGreaterThan(50);
  });
});

describe('sign catalogue', () => {
  it('loads with unique codes and an SVG file per sign', async () => {
    const signs = await loadSigns();
    expect(signs.length).toBeGreaterThanOrEqual(80);
    expect(unique(signs.map((s) => s.code))).toBe(true);
    for (const s of signs) {
      expect(s.svg).toBe(`${s.code}.svg`);
      expect(existsSync(resolve(process.cwd(), 'public/signs', s.svg)), `missing public/signs/${s.svg}`).toBe(true);
    }
    for (const code of ['301', '302', '303', '306', '402', '426', '501', '618', '701', '706', '718', '719', '810', '811', '818']) {
      expect(signs.some((s) => s.code === code), `sign ${code}`).toBe(true);
    }
  });

  it('builds sign urls under the base path', () => {
    expect(signUrl('302')).toMatch(/\/signs\/302\.svg$/);
  });
});

describe('rule book', () => {
  it('loads ~30 articles with valid cross references', async () => {
    const [rules, signs, bank] = await Promise.all([loadRules(), loadSigns(), loadTheory()]);
    const signCodes = new Set(signs.map((s) => s.code));
    const qids = new Set(bank.map((q) => q.id));
    const violations = new Set<string>(VIOLATION_TYPES);
    expect(rules.length).toBeGreaterThanOrEqual(28);
    expect(unique(rules.map((r) => r.id))).toBe(true);
    for (const r of rules) {
      const words = r.body.split(/\s+/).length;
      expect(words, `${r.id} has ${words} words`).toBeGreaterThanOrEqual(90);
      expect(words, `${r.id} has ${words} words`).toBeLessThanOrEqual(340);
      for (const s of r.signs) expect(signCodes.has(s), `${r.id}: sign ${s}`).toBe(true);
      for (const v of r.violations) expect(violations.has(v), `${r.id}: violation ${v}`).toBe(true);
      for (const q of r.questions) expect(qids.has(q), `${r.id}: question ${q}`).toBe(true);
      expect(r.questions.length, `${r.id} should link questions`).toBeGreaterThan(0);
    }
  });
});

describe('dialogue', () => {
  it('covers every violation type and every key the code relies on', async () => {
    const lines = await loadDialogue();
    expect(unique(lines.map((l) => l.key))).toBe(true);
    const index = indexDialogue(lines);
    for (const t of VIOLATION_TYPES) {
      const line = index.get(`violation.${t}`);
      expect(line, `violation.${t}`).toBeDefined();
      expect(line!.variants.length).toBeGreaterThanOrEqual(2);
    }
    for (const k of REQUIRED_DIALOGUE_KEYS) expect(index.has(k), k).toBe(true);
    expect(index.get('praise.generic')!.variants.length).toBeGreaterThanOrEqual(6);
    expect(index.get('tips.loading')!.variants.length).toBeGreaterThanOrEqual(20);
    expect(index.get('greeting.test')!.who).toBe('examiner');
    for (const l of lines) {
      for (const v of l.variants) {
        expect(v.trim().length, `${l.key} empty variant`).toBeGreaterThan(0);
        expect((v.match(/\{/g) ?? []).length, `${l.key} unbalanced braces`).toBe((v.match(/\}/g) ?? []).length);
      }
    }
    // navigation lines carry placeholders in the distance form only
    for (const kind of ['turn_left', 'turn_right', 'straight', 'roundabout_exit', 'uturn', 'pull_over', 'arrive']) {
      expect(index.get(`nav.${kind}`)!.variants.every((v) => v.includes('{distance}'))).toBe(true);
      expect(index.get(`nav.${kind}.now`)!.variants.every((v) => !v.includes('{distance}'))).toBe(true);
    }
  });

  it('fills placeholders and picks variants deterministically', async () => {
    const index = indexDialogue(await loadDialogue());
    const text = sayLine(index, 'nav.turn_right', { distance: 80, street: 'אינשטיין' });
    expect(text).toContain('80');
    expect(text).toContain('אינשטיין');
    expect(fillPlaceholders('{a} {b}', { a: 1 })).toBe('1 {b}');
    const line = index.get('praise.generic')!;
    expect(pickVariant(line, () => 0.99)).toBe(line.variants[line.variants.length - 1]);
    expect(pickVariant(line)).toBe(line.variants[0]);
    expect(sayLine(index, 'no.such.key')).toBeUndefined();
  });
});

describe('lessons', () => {
  it('has L00..L14 in ascending order and validates with parseLessons', async () => {
    const lessons = await loadLessons();
    expect(lessons.map((l) => l.id)).toEqual(Array.from({ length: 15 }, (_, i) => `L${String(i).padStart(2, '0')}`));
    for (let i = 1; i < lessons.length; i++) expect(lessons[i]!.order).toBeGreaterThan(lessons[i - 1]!.order);
    expect(() => parseLessons(lessons)).not.toThrow();
    for (const l of lessons) {
      expect(l.steps.length).toBeGreaterThanOrEqual(1);
      expect(l.steps.length).toBeLessThanOrEqual(8);
      expect(unique(l.steps.map((s) => s.id))).toBe(true);
      expect(l.briefing.length).toBeGreaterThanOrEqual(2);
      expect(l.briefing.length).toBeLessThanOrEqual(4);
      expect(l.debrief.length).toBeGreaterThan(0);
      for (const p of l.prerequisites) expect(lessons.some((x) => x.id === p), `${l.id} prerequisite ${p}`).toBe(true);
    }
  });

  it('references only ids that exist in the training ground / north-tlv spawn list, the sign catalogue and the theory bank', async () => {
    const [lessons, signs, bank] = await Promise.all([loadLessons(), loadSigns(), loadTheory()]);
    const signCodes = new Set(signs.map((s) => s.code));
    const qids = new Set(bank.map((q) => q.id));
    const tg = buildTrainingGround();
    const tgSpawns = new Set(tg.spawnPoints.map((s) => s.id));
    const tgJunctions = new Set(tg.junctions.map((j) => j.id));
    const tgCrossings = new Set(tg.crossings.map((c) => c.id));
    const tgBays = new Set(tg.parking.map((p) => p.id));
    const tlvSpawns = new Set<string>(NORTH_TLV_SPAWN_IDS);
    const diagrams = new Set<string>(BRIEFING_DIAGRAMS);
    for (const l of lessons) {
      for (const slide of l.briefing) {
        for (const s of slide.signs) expect(signCodes.has(s), `${l.id}: briefing sign ${s}`).toBe(true);
        if (slide.diagram) expect(diagrams.has(slide.diagram), `${l.id}: diagram ${slide.diagram}`).toBe(true);
      }
      const refs = lessonRefs(l);
      if (l.world === 'training-ground') {
        for (const s of refs.spawn) expect(tgSpawns.has(s), `${l.id}: spawn ${s}`).toBe(true);
        for (const j of refs.junction) expect(tgJunctions.has(j), `${l.id}: junction ${j}`).toBe(true);
        for (const c of refs.crossing) expect(tgCrossings.has(c), `${l.id}: crossing ${c}`).toBe(true);
        for (const b of refs.bay) expect(tgBays.has(b), `${l.id}: bay ${b}`).toBe(true);
      } else {
        for (const s of refs.spawn) expect(tlvSpawns.has(s), `${l.id}: tlv spawn ${s}`).toBe(true);
        expect(refs.junction.size, `${l.id}: north-tlv lessons must not hard-code junction ids`).toBe(0);
        expect(refs.crossing.size, `${l.id}: north-tlv lessons must not hard-code crossing ids`).toBe(0);
      }
      const quizIds = l.steps.flatMap((s: LessonStep) => s.quiz);
      expect(quizIds.length, `${l.id} should include quiz questions`).toBeGreaterThanOrEqual(3);
      for (const q of quizIds) expect(qids.has(q), `${l.id}: quiz ${q}`).toBe(true);
      expect(unique(quizIds), `${l.id}: duplicate quiz ids`).toBe(true);
    }
  });

  it('keeps the curriculum structure (prerequisite chain, worlds, mock test)', async () => {
    const lessons = await loadLessons();
    const byId = new Map(lessons.map((l) => [l.id, l]));
    expect(byId.get('L00')!.world).toBe('training-ground');
    expect(byId.get('L10')!.world).toBe('training-ground');
    expect(byId.get('L11')!.world).toBe('north-tlv');
    expect(byId.get('L12')!.weather).toBe('rain');
    expect(byId.get('L12')!.hour).toBeGreaterThanOrEqual(19);
    const mock = byId.get('L14')!;
    expect(mock.steps.length).toBe(1);
    expect(mock.pass.allowCritical).toBe(false);
    expect(mock.pass.maxMajor).toBeLessThanOrEqual(1);
    for (let i = 1; i < lessons.length; i++) expect(lessons[i]!.prerequisites.length).toBeGreaterThan(0);
  });
});
