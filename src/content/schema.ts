/**
 * Schemas for learning content: theory questions, the sign catalogue, rule articles
 * and dialogue lines. Files live in data/content/ and are imported as JSON.
 */
import { z } from 'zod';

export const LicenceClassSchema = z.enum(['A', 'A1', 'A2', 'B', 'C', 'C1', 'D', 'D1', 'D2', 'D3', '1']);

export const TheoryQuestionSchema = z.object({
  /** Official question number from the Ministry of Transport bank, e.g. "1759". */
  id: z.string(),
  text: z.string(),
  answers: z.array(z.string()).min(2).max(5),
  correctIndex: z.number().int().nonnegative(),
  /** Official category (Hebrew), e.g. "חוקי התנועה", "תמרורים", "בטיחות". */
  category: z.string(),
  classes: z.array(LicenceClassSchema),
  /** Image file name under public/theory/ if the question has a picture (sign / situation). */
  image: z.string().nullable().default(null),
  /** Sign codes mentioned/pictured, when known (lets the sim quiz in context). */
  signs: z.array(z.string()).default([]),
  /** Topic tags used to link questions to lessons (e.g. "priority", "roundabout", "parking"). */
  topics: z.array(z.string()).default([]),
});

export const SignCategorySchema = z.enum(['warning', 'mandatory', 'priority', 'prohibition', 'public_transport', 'information', 'signals', 'markings', 'work_zone']);

export const SignDefSchema = z.object({
  /** Catalogue number, e.g. "302". */
  code: z.string(),
  name: z.string(),
  category: SignCategorySchema,
  /** Meaning (Hebrew, 1–2 sentences). */
  meaning: z.string(),
  /** What the driver must do (Hebrew). */
  action: z.string(),
  shape: z.enum(['triangle', 'inverted_triangle', 'octagon', 'circle', 'square', 'rectangle', 'diamond', 'arrow', 'marking', 'light']),
  /** SVG file under public/signs/, e.g. "302.svg". */
  svg: z.string(),
  /** Whether the sign takes a value (speed, weight, distance). */
  hasValue: z.boolean().default(false),
  /** Topic tags. */
  topics: z.array(z.string()).default([]),
});

export const RuleArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Hebrew text with light markdown (paragraphs, **bold**, bullet lines starting with "- "). */
  body: z.string(),
  signs: z.array(z.string()).default([]),
  violations: z.array(z.string()).default([]),
  /** Legal source, e.g. "תקנות התעבורה, תקנה 64". */
  source: z.string().optional(),
  topics: z.array(z.string()).default([]),
  /** Question ids that practise this article. */
  questions: z.array(z.string()).default([]),
});

export const DialogueLineSchema = z.object({
  /** Stable key used by code, e.g. "greeting.lesson_start", "violation.STOP_SIGN_NO_STOP.1". */
  key: z.string(),
  who: z.enum(['instructor', 'examiner', 'system']),
  /** One or more variants; the runtime picks one (seeded). Supports {placeholders}. */
  variants: z.array(z.string()).min(1),
});

export type TheoryQuestion = z.infer<typeof TheoryQuestionSchema>;
export type SignDef = z.infer<typeof SignDefSchema>;
export type RuleArticle = z.infer<typeof RuleArticleSchema>;
export type DialogueLine = z.infer<typeof DialogueLineSchema>;

export const TheoryBankSchema = z.array(TheoryQuestionSchema);
export const SignCatalogSchema = z.array(SignDefSchema);
export const RuleBookSchema = z.array(RuleArticleSchema);
export const DialogueSchema = z.array(DialogueLineSchema);
