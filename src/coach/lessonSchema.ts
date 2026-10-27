/**
 * Lesson DSL — data-driven lesson scripts interpreted by the LessonRunner.
 * Content lives in data/content/lessons/*.json (Hebrew). Keep this schema stable;
 * extend with optional fields only.
 */
import { z } from 'zod';
import { VIOLATION_TYPES } from '@/rules/violations';

export const ViolationTypeSchema = z.enum(VIOLATION_TYPES);

/** A condition the runner evaluates every tick. */
export const ConditionSchema: z.ZodType<any> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    /** Player reached within `radius` m of a point / spawn / junction. */
    z.object({ kind: z.literal('reach'), pos: z.tuple([z.number(), z.number()]).optional(), spawnId: z.string().optional(), junctionId: z.string().optional(), radius: z.number().default(8) }),
    /** Player passed through a junction using a given turn (straight/left/right/uturn/any). */
    z.object({ kind: z.literal('passed_junction'), junctionId: z.string().optional(), turn: z.enum(['straight', 'left', 'right', 'uturn', 'any']).default('any') }),
    /** Vehicle has been (nearly) stopped for `seconds`. */
    z.object({ kind: z.literal('stopped'), seconds: z.number().default(1), maxSpeedKmh: z.number().default(1) }),
    /** Driven at least `metres` since the step started. */
    z.object({ kind: z.literal('distance'), metres: z.number() }),
    /** Speed held within [min, max] km/h for `seconds`. */
    z.object({ kind: z.literal('speed_in_range'), min: z.number(), max: z.number(), seconds: z.number().default(3) }),
    /** Vehicle state checks. */
    z.object({ kind: z.literal('vehicle'), gear: z.enum(['P', 'R', 'N', 'D']).optional(), seatbelt: z.boolean().optional(), engineOn: z.boolean().optional(), indicator: z.enum(['off', 'left', 'right', 'hazard']).optional(), lights: z.enum(['off', 'parking', 'low', 'high']).optional(), handbrake: z.boolean().optional(), wipers: z.boolean().optional() }),
    /** A glance at a mirror / shoulder happened within the last `withinSeconds`. */
    z.object({ kind: z.literal('glanced'), target: z.enum(['rear_mirror', 'left_mirror', 'right_mirror', 'left_shoulder', 'right_shoulder', 'any']), withinSeconds: z.number().default(5) }),
    /** Parked: stopped, in P, within `maxKerbDistance` m of the kerb, heading parallel. */
    z.object({ kind: z.literal('parked'), maxKerbDistance: z.number().default(0.4), maxAngleDeg: z.number().default(8), bayId: z.string().optional() }),
    /** Reversed at least `metres` (speed < 0). */
    z.object({ kind: z.literal('reversed'), metres: z.number() }),
    /** A violation of the given types occurred since the step started. */
    z.object({ kind: z.literal('violation'), types: z.array(ViolationTypeSchema) }),
    /** No violations of the given types since the step started (checked when the step otherwise completes). */
    z.object({ kind: z.literal('no_violation'), types: z.array(ViolationTypeSchema).optional() }),
    /** Seconds elapsed in this step. */
    z.object({ kind: z.literal('elapsed'), seconds: z.number() }),
    /** Player answered the quiz question(s) of this step. */
    z.object({ kind: z.literal('quiz_answered'), minCorrect: z.number().default(1) }),
    /** The player pressed "continue" (space / button) after reading. */
    z.object({ kind: z.literal('acknowledged') }),
    z.object({ kind: z.literal('all'), of: z.array(ConditionSchema) }),
    z.object({ kind: z.literal('any'), of: z.array(ConditionSchema) }),
  ]),
);

/** Something the runner does when a trigger fires. */
export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('say'), text: z.string(), priority: z.number().int().min(0).max(3).default(1), key: z.string().optional(), cooldown: z.number().default(10) }),
  z.object({ kind: z.literal('hint'), text: z.string(), icon: z.string().optional(), seconds: z.number().default(6) }),
  z.object({ kind: z.literal('highlight'), target: z.enum(['stop_line', 'crossing', 'signal', 'sign', 'lane', 'mirror_left', 'mirror_right', 'mirror_rear', 'indicator', 'gear', 'speedometer']), seconds: z.number().default(5) }),
  z.object({ kind: z.literal('brake'), reason: z.string() }),
  z.object({ kind: z.literal('slow_motion'), factor: z.number().default(0.3), seconds: z.number().default(3) }),
  z.object({ kind: z.literal('fail_step'), reason: z.string() }),
  z.object({ kind: z.literal('restart_step') }),
  z.object({ kind: z.literal('spawn_pedestrian'), crossingId: z.string().optional(), nearest: z.boolean().default(true) }),
  z.object({ kind: z.literal('spawn_vehicle'), where: z.enum(['ahead', 'behind', 'oncoming', 'from_right', 'from_left', 'inside_roundabout']), distance: z.number().default(60), speedKmh: z.number().optional(), vehicle: z.enum(['car', 'bus', 'truck', 'motorcycle', 'scooter', 'bicycle', 'emergency']).default('car') }),
  z.object({ kind: z.literal('set_signal'), junctionId: z.string().optional(), state: z.enum(['red', 'green', 'amber', 'flashing_green', 'red_amber']) }),
  z.object({ kind: z.literal('score'), delta: z.number() }),
]);

export const TriggerSchema = z.object({
  /** Fire when this condition becomes true (edge-triggered). */
  when: ConditionSchema,
  do: z.array(ActionSchema),
  /** Fire at most this many times in the step. */
  maxTimes: z.number().int().positive().default(1),
});

export const BriefingSlideSchema = z.object({
  title: z.string(),
  /** Markdown-ish Hebrew text (paragraphs separated by blank lines, **bold** supported). */
  text: z.string(),
  /** Sign codes to display next to the text, e.g. ["302", "301"]. */
  signs: z.array(z.string()).default([]),
  /** Optional diagram id rendered by the UI (e.g. "right_hand_rule", "roundabout_lanes"). */
  diagram: z.string().optional(),
});

export const StepSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** What the instructor says when the step starts (sentences spoken one after another). */
  say: z.array(z.string()).default([]),
  /** On-screen instruction (short). */
  instruction: z.string().optional(),
  /** Navigation target: the runner computes a route and issues turn-by-turn instructions. */
  navigateTo: z.object({ junctionId: z.string().optional(), spawnId: z.string().optional(), pos: z.tuple([z.number(), z.number()]).optional(), via: z.array(z.string()).default([]) }).optional(),
  /** Completion condition. */
  done: ConditionSchema,
  /** Fail the step (and restart it) when this becomes true. */
  fail: ConditionSchema.optional(),
  triggers: z.array(TriggerSchema).default([]),
  /** Violation types that this step teaches — reported with extra emphasis. */
  focus: z.array(ViolationTypeSchema).default([]),
  /** Theory questions to ask (ids from the question bank) when kind=quiz or at the end of the step. */
  quiz: z.array(z.string()).default([]),
  /** What the instructor says when the step completes. */
  onDone: z.array(z.string()).default([]),
  timeoutSeconds: z.number().positive().optional(),
});

export const LessonSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  title: z.string(),
  subtitle: z.string().optional(),
  summary: z.string(),
  /** Estimated minutes. */
  minutes: z.number().positive().default(10),
  prerequisites: z.array(z.string()).default([]),
  /** Where the lesson starts. */
  spawnId: z.string(),
  /** Start parked at the right-hand kerb of the spawn lane (pull-out practice) instead of the lane centre. */
  startAtKerb: z.boolean().default(false),
  /** Use the synthetic training ground instead of the real map. */
  world: z.enum(['north-tlv', 'training-ground']).default('north-tlv'),
  traffic: z.object({ density: z.number().min(0).max(1).default(0.3), pedestrians: z.number().min(0).max(1).default(0.3), seed: z.number().int().default(1) }).prefault({}),
  hour: z.number().min(0).max(24).default(10),
  weather: z.enum(['clear', 'rain', 'fog']).default('clear'),
  briefing: z.array(BriefingSlideSchema).default([]),
  steps: z.array(StepSchema).min(1),
  /** Pass criteria over the whole lesson. */
  pass: z.object({ maxMinor: z.number().default(6), maxMajor: z.number().default(2), allowCritical: z.boolean().default(false) }).prefault({}),
  /** Theory topics / rule article ids this lesson covers. */
  topics: z.array(z.string()).default([]),
  /** What the instructor says at the end of the lesson. */
  debrief: z.array(z.string()).default([]),
});

export const LessonCatalogSchema = z.array(LessonSchema);

export type Condition = z.infer<typeof ConditionSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type BriefingSlide = z.infer<typeof BriefingSlideSchema>;
export type LessonStep = z.infer<typeof StepSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type LessonInput = z.input<typeof LessonSchema>;

export function parseLessons(json: unknown): Lesson[] {
  return LessonCatalogSchema.parse(json);
}
