/**
 * Typed loaders for the learning content in data/content/*.json.
 *
 * Each loader dynamically imports its JSON (Vite code-splits it so the menu does not pay
 * for the 800 KB theory bank), validates it against the zod contract in ./schema (or the
 * Lesson DSL in @/coach/lessonSchema) and memoises the result for the session.
 *
 * Also exports small pure helpers over the loaded content (indexes, placeholder filling,
 * seeded variant picking) that the coach / UI share.
 */
import { LessonCatalogSchema, type Lesson } from '@/coach/lessonSchema';
import { DialogueSchema, RuleBookSchema, SignCatalogSchema, TheoryBankSchema, type DialogueLine, type RuleArticle, type SignDef, type TheoryQuestion } from './schema';

const cache = new Map<string, Promise<unknown>>();

function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load().catch((err) => {
      cache.delete(key); // allow a retry after a transient failure
      throw err;
    });
    cache.set(key, p);
  }
  return p;
}

/** Drop memoised content (tests / hot reload). */
export function resetContentCache(): void {
  cache.clear();
}

/** The official theory question bank, filtered to licence class B (1,200+ questions). */
export function loadTheory(): Promise<TheoryQuestion[]> {
  return memo('theory', async () => TheoryBankSchema.parse((await import('../../data/content/theory.json')).default));
}

/** The sign catalogue (public/signs/<code>.svg drawings + meanings). */
export function loadSigns(): Promise<SignDef[]> {
  return memo('signs', async () => SignCatalogSchema.parse((await import('../../data/content/signs.json')).default));
}

/** The rule book — Hebrew articles linked to signs, violations and questions. */
export function loadRules(): Promise<RuleArticle[]> {
  return memo('rules', async () => RuleBookSchema.parse((await import('../../data/content/rules.json')).default));
}

/** Instructor / examiner / system lines keyed by stable ids. */
export function loadDialogue(): Promise<DialogueLine[]> {
  return memo('dialogue', async () => DialogueSchema.parse((await import('../../data/content/dialogue.json')).default));
}

/** All lessons (data/content/lessons/*.json), validated and sorted by `order`. */
export function loadLessons(): Promise<Lesson[]> {
  return memo('lessons', async () => {
    const modules = import.meta.glob('../../data/content/lessons/*.json', { import: 'default' });
    const raw = await Promise.all(Object.keys(modules).sort().map((k) => modules[k]!()));
    return LessonCatalogSchema.parse(raw).sort((a, b) => a.order - b.order);
  });
}

/** URL of a sign drawing, honouring the Vite base path (GitHub Pages sub-folder). */
export function signUrl(code: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : base + '/'}signs/${encodeURIComponent(code)}.svg`;
}

// ───────────────────────────── helpers over loaded content ─────────────────────────────

export function indexSigns(signs: readonly SignDef[]): Map<string, SignDef> {
  return new Map(signs.map((s) => [s.code, s]));
}

export function indexRules(rules: readonly RuleArticle[]): Map<string, RuleArticle> {
  return new Map(rules.map((r) => [r.id, r]));
}

export function indexDialogue(lines: readonly DialogueLine[]): Map<string, DialogueLine> {
  return new Map(lines.map((l) => [l.key, l]));
}

export function indexQuestions(bank: readonly TheoryQuestion[]): Map<string, TheoryQuestion> {
  return new Map(bank.map((q) => [q.id, q]));
}

/** Questions carrying a topic tag (e.g. "roundabout"), optionally without pictures. */
export function questionsByTopic(bank: readonly TheoryQuestion[], topic: string, opts: { withImages?: boolean } = {}): TheoryQuestion[] {
  return bank.filter((q) => q.topics.includes(topic) && (opts.withImages || !q.topics.includes('has_image')));
}

/** Replace {placeholders} with values; unknown placeholders are left in place. */
export function fillPlaceholders(text: string, vars: Record<string, string | number | undefined> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}

/**
 * Pick one variant deterministically. `rng` is a createRng(seed) function (0..1); without
 * it the first variant is used, which keeps tests reproducible.
 */
export function pickVariant(line: DialogueLine, rng?: () => number): string {
  const n = line.variants.length;
  if (n === 1 || !rng) return line.variants[0]!;
  return line.variants[Math.min(n - 1, Math.floor(rng() * n))]!;
}

/** Convenience: look up a key, pick a variant and fill placeholders. Returns undefined for unknown keys. */
export function sayLine(index: Map<string, DialogueLine>, key: string, vars?: Record<string, string | number | undefined>, rng?: () => number): string | undefined {
  const line = index.get(key);
  return line ? fillPlaceholders(pickVariant(line, rng), vars) : undefined;
}

/** Dialogue key for a violation type (every ViolationType has one — see loaders.test.ts). */
export function violationKey(type: string): string {
  return `violation.${type}`;
}

/** Navigation keys: `nav.<kind>` (with {distance}/{street}/{exit}) and `nav.<kind>.now` (immediate form). */
export function navKey(kind: 'turn_left' | 'turn_right' | 'straight' | 'roundabout_exit' | 'uturn' | 'pull_over' | 'arrive', now = false): string {
  return now ? `nav.${kind}.now` : `nav.${kind}`;
}

/** Keys that code relies on (checked by the content tests). */
export const REQUIRED_DIALOGUE_KEYS = [
  'greeting.lesson_start',
  'greeting.free_drive',
  'greeting.test',
  'greeting.training_ground',
  'lesson.step_done',
  'lesson.passed',
  'lesson.failed',
  'praise.generic',
  'praise.GOOD_STOP',
  'praise.GOOD_YIELD',
  'praise.GOOD_PARKING',
  'nav.turn_left',
  'nav.turn_left.now',
  'nav.turn_right',
  'nav.turn_right.now',
  'nav.straight',
  'nav.straight.now',
  'nav.roundabout_exit',
  'nav.roundabout_exit.now',
  'nav.uturn',
  'nav.uturn.now',
  'nav.pull_over',
  'nav.pull_over.now',
  'nav.arrive',
  'nav.arrive.now',
  'nav.reroute',
  'examiner.greeting',
  'examiner.instruction_prefix',
  'examiner.maneuver.pull_over.request',
  'examiner.maneuver.pull_over.done',
  'examiner.maneuver.reverse.request',
  'examiner.maneuver.reverse.done',
  'examiner.maneuver.uturn.request',
  'examiner.maneuver.uturn.done',
  'examiner.maneuver.parallel_park.request',
  'examiner.maneuver.parallel_park.done',
  'examiner.maneuver.emergency_stop.request',
  'examiner.maneuver.emergency_stop.go',
  'examiner.maneuver.emergency_stop.done',
  'examiner.intervention',
  'examiner.end_passed',
  'examiner.end_failed',
  'examiner.summary.intro',
  'examiner.summary.critical',
  'examiner.summary.points',
  'examiner.summary.majors',
  'examiner.summary.minors',
  'examiner.summary.clean',
  'examiner.summary.advice',
  'examiner.summary.duration',
  'intervention.brake',
  'explain.approach_stop',
  'explain.approach_give_way',
  'explain.approach_signals_red',
  'explain.approach_signals_green',
  'explain.approach_signals_amber',
  'explain.approach_signals_flashing_green',
  'explain.approach_signals_red_amber',
  'explain.approach_signals_flashing_amber',
  'explain.approach_roundabout',
  'explain.crossing_ahead',
  'explain.speed_zone_30',
  'explain.one_way',
  'explain.bus_lane',
  'explain.parking_rules',
  'tips.loading',
] as const;

/** Spawn ids of the North Tel Aviv world that lessons may target (owned by the world pipeline). */
export const NORTH_TLV_SPAWN_IDS = [
  'tlv_university',
  'tlv_einstein',
  'tlv_namir_rokach',
  'tlv_kochav',
  'tlv_afeka',
  'tlv_telbaruch',
  'tlv_hadaryosef',
  'tlv_tzahala',
  'tlv_ramathahayal',
  'tlv_lamed',
  'tlv_neveavivim',
  'tlv_glilot',
  'tlv_test_start',
] as const;

/** Diagram ids a briefing slide may reference (rendered by the UI). */
export const BRIEFING_DIAGRAMS = ['right_hand_rule', 'roundabout_lanes', 'stop_line_order', 'parking_12m', 'mirrors_blindspot', 'left_turn_yield'] as const;
