/**
 * LessonRunner — interprets the Lesson DSL (src/coach/lessonSchema.ts).
 *
 *   start(lesson) → 'lesson:briefing' … waits for 'ui:acknowledged' {context:'briefing'}
 *   → for each step: speak `say` (priority 2), set the navigation target, 'lesson:step',
 *     evaluate `done` / `fail` / triggers every tick, run actions, ask quiz questions
 *     ('theory:question' ↔ 'theory:answer' → 'theory:answered'), restart on fail / timeout
 *     ('sim:reset' {reason:'step_restart'})
 *   → quiz questions are asked when the step starts if its `done` condition waits for them
 *     (`quiz_answered`), otherwise once the rest of `done` is satisfied (end of the step);
 *     consecutive questions are spaced by QUIZ_NEXT_DELAY_S so the feedback can be read
 *   → lesson end: pass per `lesson.pass` over the violations since start, debrief,
 *     'lesson:completed' {passed, score = clamp(100 − points·3 + score deltas, 0, 100)}.
 *
 * Triggers are edge-triggered (fire when their condition turns true) up to `maxTimes`.
 * Slow motion goes through the `onTimeScale` callback (and a 'coach:request' for
 * integrations that prefer events); spawns and signal overrides go out as 'coach:request'.
 */
import type { EventBus } from '@/core/events';
import type { SimContext, System } from '@/core/sim';
import type { GlanceEvent } from '@/core/types';
import { dist2, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Turn } from '@/world/schema';
import { SEVERITY_POINTS, VIOLATIONS, type Violation } from '@/rules/violations';
import type { TheoryQuestion } from '@/content/schema';
import type { DialogueManager } from './dialogue';
import type { Instructor } from './instructor';
import type { Action, Condition, Lesson, LessonStep } from './lessonSchema';
import type { Navigator } from './navigator';
import { ParkingMonitor } from './parking';
import { coarseTurn, type ParkingReport, type ParkingReporter } from './types';

export interface LessonRunnerOptions {
  /** Theory bank lookup for quiz steps. Without it quiz questions are skipped. */
  questionLookup?: (id: string) => TheoryQuestion | undefined;
  /** Slow-motion hook provided by the app (factor, seconds). */
  onTimeScale?: (factor: number, seconds: number) => void;
  parkingReporter?: ParkingReporter;
}

export type RunnerState = 'idle' | 'briefing' | 'running' | 'finished';

/** Sim seconds between an answer and the next question (the UI shows the feedback meanwhile). */
export const QUIZ_NEXT_DELAY_S = 2.5;

export interface StepState {
  index: number;
  step: LessonStep;
  startTime: number;
  startPos: Vec2;
  distance: number;
  reversed: number;
  violations: Violation[];
  passed: { junctionId: string; turn: Turn; time: number }[];
  glances: GlanceEvent[];
  acknowledged: boolean;
  quiz: { remaining: string[]; askedOnce: Set<string>; waiting?: string; answered: number; correct: number; askable: number; started: boolean; nextAt?: number };
  triggers: { prev: boolean; count: number }[];
  timers: WeakMap<object, number>;
  prevConnectorId?: string;
  restarts: number;
  report?: ParkingReport;
}

export interface LessonProgress {
  index: number;
  total: number;
  stepId?: string;
  elapsed: number;
  restarts: number;
  state: RunnerState;
}

export class LessonRunner implements System {
  readonly name = 'lessonRunner';
  private state: RunnerState = 'idle';
  private lesson?: Lesson;
  private step?: StepState;
  private lessonStart = 0;
  private lessonViolations: Violation[] = [];
  private scoreDelta = 0;
  private ackBriefing = false;
  private lastCtx?: SimContext;
  private readonly parking: ParkingMonitor;
  private readonly offs: (() => void)[] = [];
  private readonly questionLookup?: (id: string) => TheoryQuestion | undefined;
  private readonly onTimeScale?: (factor: number, seconds: number) => void;
  private pendingStepIndex?: number;

  constructor(
    private readonly bus: EventBus,
    private readonly dialogue: DialogueManager,
    private readonly navigator: Navigator,
    private readonly instructor: Instructor,
    private readonly graph: RoadGraph,
    opts: LessonRunnerOptions = {},
  ) {
    this.questionLookup = opts.questionLookup;
    this.onTimeScale = opts.onTimeScale;
    this.parking = new ParkingMonitor(graph, dialogue.lines, opts.parkingReporter);
    this.offs.push(bus.on('ui:acknowledged', (e) => this.onAcknowledged(e.context)));
    this.offs.push(bus.on('violation', (v) => this.onViolation(v)));
    this.offs.push(bus.on('input:glance', (g) => this.step?.glances.push(g)));
    this.offs.push(bus.on('theory:answer', (a) => this.onAnswer(a.questionId, a.index)));
  }

  // ---- public API ------------------------------------------------------------------

  get runnerState(): RunnerState {
    return this.state;
  }
  get currentLesson(): Lesson | undefined {
    return this.lesson;
  }
  get currentStep(): LessonStep | undefined {
    return this.step?.step;
  }
  get stepState(): StepState | undefined {
    return this.step;
  }
  get progress(): LessonProgress {
    return {
      index: this.step?.index ?? (this.pendingStepIndex ?? 0),
      total: this.lesson?.steps.length ?? 0,
      stepId: this.step?.step.id,
      elapsed: this.lastCtx && this.lesson ? this.lastCtx.time - this.lessonStart : 0,
      restarts: this.step?.restarts ?? 0,
      state: this.state,
    };
  }

  setParkingReporter(fn: ParkingReporter | undefined): void {
    this.parking.setReporter(fn);
  }

  /** Begin a lesson: shows the briefing and waits for the player to acknowledge it. */
  start(lesson: Lesson): void {
    this.lesson = lesson;
    this.state = 'briefing';
    this.step = undefined;
    this.lessonViolations = [];
    this.scoreDelta = 0;
    this.lessonStart = this.lastCtx?.time ?? 0;
    this.pendingStepIndex = 0;
    this.dialogue.resetCooldowns();
    if (lesson.briefing.length > 0) {
      this.ackBriefing = false;
      this.bus.emit('lesson:briefing', { lessonId: lesson.id, title: lesson.title, slides: lesson.briefing.map((s) => ({ title: s.title, text: s.text, signs: s.signs, diagram: s.diagram })) });
    } else this.ackBriefing = true;
  }

  /** Stop the lesson without a result. */
  abort(): void {
    if (this.state === 'idle') return;
    const wasRunning = this.state === 'running' || this.state === 'briefing';
    this.state = 'finished';
    this.step = undefined;
    this.navigator.setRoute(null);
    this.instructor.setFocus([]);
    if (wasRunning) this.dialogue.sayLine('lesson.aborted', undefined, { priority: 2 });
  }

  /** Dev / accessibility: complete the current step right away. */
  skipStep(): void {
    if (this.state === 'running' && this.step && this.lastCtx) this.completeStep(this.lastCtx);
  }

  update(ctx: SimContext): void {
    this.lastCtx = ctx;
    if (this.state === 'briefing' && this.ackBriefing) {
      this.state = 'running';
      this.lessonStart = ctx.time;
      this.instructor.greet('lesson');
      this.beginStep(this.pendingStepIndex ?? 0, ctx, false);
    }
    if (this.state !== 'running' || ctx.paused || !this.step) return;
    const st = this.step;
    const step = st.step;
    const v = ctx.player.speed;
    if (v > 0) st.distance += v * ctx.dt;
    else if (v < 0) st.reversed += -v * ctx.dt;
    const cid = ctx.localisation.connectorId;
    if (cid !== st.prevConnectorId) {
      if (st.prevConnectorId) {
        const c = this.graph.connectors.get(st.prevConnectorId);
        if (c) st.passed.push({ junctionId: c.junctionId, turn: c.turn, time: ctx.time });
      }
      st.prevConnectorId = cid;
    }
    st.report = this.parking.update(ctx);
    // triggers (edge-triggered, maxTimes)
    step.triggers.forEach((trigger, i) => {
      const ts = st.triggers[i]!;
      const now = this.evaluate(trigger.when, st, ctx);
      if (now && !ts.prev && ts.count < trigger.maxTimes) {
        ts.count++;
        for (const action of trigger.do) {
          this.runAction(action, st, ctx);
          if (this.step !== st) break;
        }
      }
      ts.prev = now;
    });
    if (this.step !== st || this.state !== 'running') return;
    if (step.fail && this.evaluate(step.fail, st, ctx)) {
      this.failStep(ctx, this.dialogue.lines.line('lesson.restart'), false);
      return;
    }
    if (step.timeoutSeconds !== undefined && ctx.time - st.startTime > step.timeoutSeconds) {
      this.dialogue.sayLine('lesson.timeout', undefined, { priority: 2 });
      this.bus.emit('lesson:hint', { text: this.dialogue.lines.line('lesson.timeout.hint'), icon: 'retry', seconds: 5 });
      this.restartStep(ctx, false);
      return;
    }
    if (st.quiz.nextAt !== undefined && ctx.time >= st.quiz.nextAt) {
      st.quiz.nextAt = undefined;
      this.askNext();
    }
    if (this.evaluate(step.done, st, ctx) && this.quizSettled(st)) this.completeStep(ctx);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  // ---- steps ------------------------------------------------------------------------

  private beginStep(index: number, ctx: SimContext, restart: boolean): void {
    const lesson = this.lesson!;
    const step = lesson.steps[index]!;
    const prevRestarts = restart && this.step ? this.step.restarts : 0;
    this.step = {
      index,
      step,
      startTime: ctx.time,
      startPos: [ctx.player.pos[0], ctx.player.pos[1]],
      distance: 0,
      reversed: 0,
      violations: [],
      passed: [],
      glances: [],
      acknowledged: false,
      quiz: { remaining: [...step.quiz], askedOnce: new Set(), answered: 0, correct: 0, askable: 0, started: false },
      triggers: step.triggers.map(() => ({ prev: false, count: 0 })),
      timers: new WeakMap(),
      prevConnectorId: ctx.localisation.connectorId,
      restarts: prevRestarts,
    };
    this.pendingStepIndex = undefined;
    this.instructor.setFocus(step.focus);
    // the step event goes out first so the UI can reset per-step state (hints, pill) before the step's own hint
    this.bus.emit('lesson:step', { lessonId: lesson.id, stepId: step.id, index, total: lesson.steps.length, title: step.title });
    if (!restart) for (const text of step.say) this.dialogue.say({ who: 'instructor', text, priority: 2 });
    else if (step.say[0]) this.dialogue.say({ who: 'instructor', text: step.say[0], priority: 2 });
    if (step.instruction) this.bus.emit('lesson:hint', { text: step.instruction, icon: 'step', seconds: 8 });
    if (step.navigateTo) {
      const n = step.navigateTo;
      const target = n.spawnId ? { spawnId: n.spawnId } : n.junctionId ? { junctionId: n.junctionId } : n.pos ? { pos: n.pos } : undefined;
      if (target) this.navigator.setDestination(target, { via: n.via, speak: true, who: 'instructor' });
      else this.navigator.setRoute(null);
    } else this.navigator.setRoute(null);
    if (step.quiz.length > 0 && mentionsQuiz(step.done)) this.startQuiz(this.step);
  }

  /** Ask the step's questions (now when `done` waits for them, otherwise once the rest of the step is done). */
  private startQuiz(st: StepState): void {
    st.quiz.started = true;
    st.quiz.remaining = st.step.quiz.filter((id) => this.questionLookup?.(id)); // ids missing from the bank are skipped
    st.quiz.askable = st.quiz.remaining.length;
    if (st.quiz.askable > 0) this.dialogue.sayLine('lesson.quiz.intro', undefined, { priority: 1 });
    this.askNext();
  }

  /** True when the step's quiz (if any) does not hold the step back any more. */
  private quizSettled(st: StepState): boolean {
    if (st.step.quiz.length === 0) return true;
    if (!st.quiz.started) this.startQuiz(st);
    const q = st.quiz;
    if (q.askable === 0) return true;
    return q.waiting === undefined && q.nextAt === undefined && q.askedOnce.size >= q.askable && q.correct >= Math.min(this.minCorrect(st), q.askable);
  }

  private completeStep(ctx: SimContext): void {
    const st = this.step!;
    for (const text of st.step.onDone) this.dialogue.say({ who: 'instructor', text, priority: 1 });
    const next = st.index + 1;
    if (next < this.lesson!.steps.length) this.beginStep(next, ctx, false);
    else this.finishLesson(ctx);
  }

  private failStep(ctx: SimContext, reason: string, viaAction: boolean): void {
    const text = viaAction ? this.dialogue.lines.line('lesson.step_failed', { reason }) : reason;
    this.dialogue.say({ who: 'instructor', text, priority: 2 });
    this.restartStep(ctx, false);
  }

  private restartStep(ctx: SimContext, speak: boolean): void {
    const st = this.step!;
    st.restarts++;
    if (speak) this.dialogue.sayLine('lesson.restart', undefined, { priority: 2 });
    this.bus.emit('sim:reset', { reason: 'step_restart' });
    this.beginStep(st.index, ctx, true);
  }

  private finishLesson(ctx: SimContext): void {
    const lesson = this.lesson!;
    const counts = { minor: 0, major: 0, critical: 0 };
    let points = 0;
    for (const v of this.lessonViolations) {
      const sev = VIOLATIONS[v.type]?.severity ?? v.severity;
      if (sev === 'minor' || sev === 'major' || sev === 'critical') counts[sev]++;
      points += SEVERITY_POINTS[sev];
    }
    const passed = counts.minor <= lesson.pass.maxMinor && counts.major <= lesson.pass.maxMajor && (lesson.pass.allowCritical || counts.critical === 0);
    const score = Math.max(0, Math.min(100, Math.round(100 - points * 3 + this.scoreDelta)));
    for (const text of lesson.debrief) this.dialogue.say({ who: 'instructor', text, priority: 1 });
    this.dialogue.sayLine(passed ? 'lesson.completed.passed' : 'lesson.completed.failed', { score }, { priority: 1 });
    this.state = 'finished';
    this.step = undefined;
    this.navigator.setRoute(null);
    this.instructor.setFocus([]);
    this.bus.emit('lesson:completed', { lessonId: lesson.id, passed, score });
    void ctx;
  }

  // ---- events --------------------------------------------------------------------------

  private onAcknowledged(context: string): void {
    if (this.state === 'briefing') {
      this.ackBriefing = true;
      return;
    }
    if (this.state === 'running' && this.step && context !== 'briefing' && !context.startsWith('quiz') && !context.startsWith('theory')) this.step.acknowledged = true;
  }

  private onViolation(v: Violation): void {
    if (this.state !== 'running') return;
    this.lessonViolations.push(v);
    this.step?.violations.push(v);
  }

  private askNext(): void {
    const st = this.step;
    if (!st) return;
    const q = st.quiz;
    while (q.remaining.length > 0) {
      const id = q.remaining[0]!;
      const question = this.questionLookup?.(id);
      if (!question) {
        q.remaining.shift();
        continue;
      }
      q.waiting = id;
      q.askedOnce.add(id);
      this.bus.emit('theory:question', { questionId: id, text: question.text, answers: question.answers, image: question.image ?? null });
      return;
    }
    q.waiting = undefined;
  }

  private onAnswer(questionId: string, index: number): void {
    const st = this.step;
    if (!st || st.quiz.waiting !== questionId) return;
    const question = this.questionLookup?.(questionId);
    if (!question) return;
    const correct = index === question.correctIndex;
    st.quiz.answered++;
    st.quiz.remaining.shift();
    if (correct) {
      st.quiz.correct++;
      this.dialogue.sayLine('lesson.quiz.correct', undefined, { priority: 1 });
    } else {
      this.dialogue.sayLine('lesson.quiz.wrong', { answer: question.answers[question.correctIndex] ?? '' }, { priority: 1 });
      st.quiz.remaining.push(questionId); // ask it again later until answered correctly
    }
    this.bus.emit('theory:answered', { questionId, correct });
    st.quiz.waiting = undefined;
    const need = Math.min(this.minCorrect(st), st.quiz.askable);
    if (st.quiz.correct < need || st.quiz.remaining.some((id) => !st.quiz.askedOnce.has(id))) st.quiz.nextAt = (this.lastCtx?.time ?? 0) + QUIZ_NEXT_DELAY_S;
  }

  private minCorrect(st: StepState): number {
    let min = 1;
    const visit = (c: Condition): void => {
      if (c.kind === 'quiz_answered') min = Math.max(min, c.minCorrect ?? 1);
      else if (c.kind === 'all' || c.kind === 'any') for (const x of c.of as Condition[]) visit(x);
    };
    visit(st.step.done);
    return min;
  }

  // ---- actions ------------------------------------------------------------------------

  private runAction(action: Action, st: StepState, ctx: SimContext): void {
    switch (action.kind) {
      case 'say':
        this.dialogue.say({ who: 'instructor', text: action.text, priority: clampPriority(action.priority), key: action.key, cooldown: action.cooldown });
        break;
      case 'hint':
        this.bus.emit('lesson:hint', { text: action.text, icon: action.icon, seconds: action.seconds });
        break;
      case 'highlight':
        this.bus.emit('lesson:highlight', { target: action.target, seconds: action.seconds });
        break;
      case 'brake':
        this.bus.emit('coach:intervention', { kind: 'brake', reason: action.reason, time: ctx.time });
        this.dialogue.sayLine('lesson.brake', undefined, { priority: 3, key: 'intervention', cooldown: 2 });
        break;
      case 'slow_motion':
        this.onTimeScale?.(action.factor, action.seconds);
        this.bus.emit('coach:request', { kind: 'slow_motion', payload: { factor: action.factor, seconds: action.seconds } });
        break;
      case 'fail_step':
        this.failStep(ctx, action.reason, true);
        break;
      case 'restart_step':
        this.restartStep(ctx, true);
        break;
      case 'spawn_pedestrian': {
        const crossingId = action.crossingId ?? this.nearestCrossingAhead(ctx);
        this.bus.emit('coach:request', { kind: 'spawn_pedestrian', payload: { crossingId, nearest: action.nearest } });
        break;
      }
      case 'spawn_vehicle':
        this.bus.emit('coach:request', { kind: 'spawn_vehicle', payload: { where: action.where, distance: action.distance, speedKmh: action.speedKmh, vehicle: action.vehicle } });
        break;
      case 'set_signal': {
        const junctionId = action.junctionId ?? ctx.localisation.nextJunctionId;
        const junction = junctionId ? this.graph.junctions.get(junctionId) : undefined;
        const approach = ctx.localisation.laneId ? junction?.approaches.find((a) => a.laneIds.includes(ctx.localisation.laneId!)) : undefined;
        this.bus.emit('coach:request', { kind: 'set_signal', payload: { junctionId, controllerId: junction?.signalController, groupId: approach?.signalGroup, state: action.state } });
        break;
      }
      case 'score':
        this.scoreDelta += action.delta;
        break;
    }
  }

  private nearestCrossingAhead(ctx: SimContext): string | undefined {
    const laneId = ctx.localisation.laneId;
    if (!laneId) return undefined;
    const lane = this.graph.lane(laneId);
    let best: { id: string; d: number } | undefined;
    for (const c of this.graph.crossingsByLane.get(lane.id) ?? []) {
      const mid: Vec2 = [(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2];
      const d = dist2(mid, ctx.player.pos);
      if (!best || d < best.d) best = { id: c.id, d };
    }
    return best?.id;
  }

  // ---- conditions -----------------------------------------------------------------------

  evaluate(cond: Condition, st: StepState, ctx: SimContext): boolean {
    const p = ctx.player;
    switch (cond.kind) {
      case 'reach': {
        const target: Vec2 | undefined = cond.pos ?? (cond.spawnId ? this.graph.spawnPoints.get(cond.spawnId)?.pos : undefined) ?? (cond.junctionId ? this.graph.junctions.get(cond.junctionId)?.position : undefined);
        if (!target) return false;
        return dist2(p.pos, target) <= (cond.radius ?? 8);
      }
      case 'passed_junction':
        return st.passed.some((x) => (!cond.junctionId || x.junctionId === cond.junctionId) && ((cond.turn ?? 'any') === 'any' || coarseTurn(x.turn) === cond.turn));
      case 'stopped':
        return this.held(cond, st, ctx, Math.abs(p.speed) * 3.6 <= (cond.maxSpeedKmh ?? 1), cond.seconds ?? 1);
      case 'distance':
        return st.distance >= cond.metres;
      case 'speed_in_range': {
        const kmh = p.speed * 3.6;
        return this.held(cond, st, ctx, kmh >= cond.min && kmh <= cond.max, cond.seconds ?? 3);
      }
      case 'vehicle':
        return (
          (cond.gear === undefined || p.gear === cond.gear) &&
          (cond.seatbelt === undefined || p.seatbelt === cond.seatbelt) &&
          (cond.engineOn === undefined || p.engineOn === cond.engineOn) &&
          (cond.indicator === undefined || p.indicator === cond.indicator) &&
          (cond.lights === undefined || p.lights === cond.lights) &&
          (cond.handbrake === undefined || p.handbrake === cond.handbrake) &&
          (cond.wipers === undefined || p.wipers === cond.wipers)
        );
      case 'glanced':
        return st.glances.some((g) => (cond.target === 'any' || g.target === cond.target) && ctx.time - g.time <= (cond.withinSeconds ?? 5));
      case 'parked': {
        const r = st.report;
        if (!r || !r.parked) return false;
        if (r.kerbDistance !== undefined && r.kerbDistance > (cond.maxKerbDistance ?? 0.4)) return false;
        if (r.angleDeg !== undefined && r.angleDeg > (cond.maxAngleDeg ?? 8)) return false;
        if (cond.bayId && r.bayId !== cond.bayId) return false;
        return true;
      }
      case 'reversed':
        return st.reversed >= cond.metres;
      case 'violation':
        return st.violations.some((v) => (cond.types as string[]).includes(v.type));
      case 'no_violation':
        return !st.violations.some((v) => (cond.types ? (cond.types as string[]).includes(v.type) : (VIOLATIONS[v.type]?.severity ?? v.severity) !== 'info'));
      case 'elapsed':
        return ctx.time - st.startTime >= cond.seconds;
      case 'quiz_answered': {
        const q = st.quiz;
        if (st.step.quiz.length === 0 || q.askable === 0) return true;
        const need = Math.min(cond.minCorrect ?? 1, q.askable);
        return q.askedOnce.size >= q.askable && q.correct >= need;
      }
      case 'acknowledged':
        return st.acknowledged;
      case 'all':
        return (cond.of as Condition[]).every((c) => this.evaluate(c, st, ctx));
      case 'any':
        return (cond.of as Condition[]).some((c) => this.evaluate(c, st, ctx));
      default:
        return false;
    }
  }

  /** True once `predicate` has held continuously for `seconds` (timer keyed by the condition object). */
  private held(cond: object, st: StepState, ctx: SimContext, predicate: boolean, seconds: number): boolean {
    if (!predicate) {
      st.timers.delete(cond);
      return false;
    }
    const since = st.timers.get(cond);
    if (since === undefined) {
      st.timers.set(cond, ctx.time);
      return seconds <= 0;
    }
    return ctx.time - since >= seconds;
  }
}

function clampPriority(p: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.round(p))) as 0 | 1 | 2 | 3;
}

/** Does the condition tree wait for the step's quiz (`quiz_answered`)? */
export function mentionsQuiz(c: Condition): boolean {
  if (c.kind === 'quiz_answered') return true;
  if (c.kind === 'all' || c.kind === 'any') return (c.of as Condition[]).some(mentionsQuiz);
  return false;
}
