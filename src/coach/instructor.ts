/**
 * Instructor — the virtual driving teacher sitting next to the player.
 *
 *  - greets at the start (mode-dependent; the LessonRunner calls `greet('lesson')` after the briefing)
 *  - reacts to 'violation' events: speaks the catalogue advice (or a dialogue variant
 *    'violation.<TYPE>') with a priority by severity, de-duplicated per type (catalogue
 *    cooldown × 2) and without nagging (≤ 1 minor remark per 8 s); praises GOOD_* events
 *    sometimes (seeded); turns APPROACHING_* infos into proactive tips in lessons / high verbosity
 *  - `explainHere(ctx)`: 1–3 sentences about the current situation (the '?' key)
 *  - interventions: predicts danger every tick (src/coach/danger.ts), emits 'coach:intervention'
 *    {kind:'brake'}, says "אני בולם!" and a one-line explanation afterwards
 *  - `setFocus(types)`: the lesson's focus violations get extra emphasis (higher priority,
 *    shorter cooldown, the "זה בדיוק מה שאנחנו מתרגלים" suffix)
 *  - `setMuted(true)`: no remarks / interventions (the lesson mode mutes the instructor while
 *    the briefing is on screen, so the first thing the player hears is the greeting)
 */
import type { EventBus } from '@/core/events';
import { createRng, type SimContext, type System } from '@/core/sim';
import type { SimMode } from '@/core/types';
import { projectOntoPolyline } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import { VIOLATIONS, type Violation, type ViolationType } from '@/rules/violations';
import { predictDanger } from './danger';
import type { DialogueManager } from './dialogue';
import type { LineParams } from './lines';
import type { Navigator } from './navigator';
import type { DangerPrediction } from './types';

export type Verbosity = 'low' | 'normal' | 'high';

export interface InstructorOptions {
  verbosity?: Verbosity;
  seed?: number;
  /** Greet automatically on the first update in free / training-ground modes (default true). */
  autoGreet?: boolean;
  /** Predict danger and press the dual brake (default true). */
  interventions?: boolean;
  /** When set, the route's expected connector sharpens the yield / crossing predictions. */
  navigator?: Navigator;
}

const PRAISE_PROBABILITY: Record<Verbosity, number> = { low: 0.25, normal: 0.5, high: 0.85 };
const MINOR_NAG_INTERVAL = 8;
const INTERVENTION_INTERVAL = 4;

export class Instructor implements System {
  readonly name = 'instructor';
  private verbosity: Verbosity;
  private readonly rng: () => number;
  private readonly autoGreet: boolean;
  private readonly interventionsEnabled: boolean;
  private navigator?: Navigator;
  private greeted = false;
  private muted = false;
  private lastMinorAt = -Infinity;
  private lastInterventionAt = -Infinity;
  private readonly focus = new Set<ViolationType>();
  private lastCtx?: SimContext;
  private lastDanger?: DangerPrediction;
  private interventionCount = 0;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly bus: EventBus,
    private readonly dialogue: DialogueManager,
    private readonly graph: RoadGraph,
    opts: InstructorOptions = {},
  ) {
    this.verbosity = opts.verbosity ?? 'normal';
    this.rng = createRng(opts.seed ?? 11);
    this.autoGreet = opts.autoGreet ?? true;
    this.interventionsEnabled = opts.interventions ?? true;
    this.navigator = opts.navigator;
    this.offs.push(bus.on('violation', (v) => this.onViolation(v)));
    this.offs.push(
      bus.on('mode:changed', () => {
        this.greeted = false;
        this.focus.clear();
      }),
    );
  }

  setNavigator(nav: Navigator | undefined): void {
    this.navigator = nav;
  }
  setVerbosity(v: Verbosity): void {
    this.verbosity = v;
  }
  setFocus(types: ViolationType[]): void {
    this.focus.clear();
    for (const t of types) this.focus.add(t);
  }
  get focusTypes(): ViolationType[] {
    return [...this.focus];
  }
  /** While muted the instructor neither comments on violations nor intervenes. */
  setMuted(on: boolean): void {
    this.muted = on;
  }
  get isMuted(): boolean {
    return this.muted;
  }
  get interventions(): number {
    return this.interventionCount;
  }
  get lastIntervention(): DangerPrediction | undefined {
    return this.lastDanger;
  }

  /** Mode-dependent greeting (once per mode). */
  greet(mode: SimMode): void {
    if (this.greeted) return;
    this.greeted = true;
    const key = mode === 'lesson' ? 'greeting.lesson' : mode === 'training_ground' ? 'greeting.training_ground' : 'greeting.free';
    this.dialogue.sayLine(key, undefined, { priority: 2, key: 'greeting', cooldown: 60 });
  }

  /** Speak 1–3 sentences about the current situation; returns the text. */
  explainHere(ctx: SimContext): string {
    const lines = this.dialogue.lines;
    const parts: string[] = [];
    const loc = ctx.localisation;
    if (loc.insideJunction || !loc.laneId || !this.graph.lanes.has(loc.laneId)) parts.push(lines.line('explain.inside_junction'));
    else {
      const lane = this.graph.lane(loc.laneId);
      const road = this.graph.road(lane.roadId);
      const ap = this.graph.approachOf(loc.laneId);
      if (ap && loc.distToLaneEnd < 80 && ap.junction.kind !== 'bend' && ap.junction.kind !== 'merge' && ap.junction.kind !== 'dead_end') {
        const c = ap.approach.control;
        if (c === 'signals') {
          const st = ap.approach.signalGroup ? ctx.signals.stateOf(ap.approach.signalGroup) : 'off';
          parts.push(lines.line('explain.signals', { stateText: lines.line(`explain.signal_state.${st}`) }));
        } else if (c !== 'none') parts.push(lines.line(`explain.control.${c}`));
      }
      // The control explanation is two sentences; keep the whole thing at ≤ 3 sentences by
      // adding the situational sentence only when there is no control to explain.
      if (parts.length === 0) {
        const crossingAhead = this.nearestCrossingAhead(ctx);
        const forward = road.lanesForward.includes(lane.id);
        const kerb = forward ? road.kerbRight : road.kerbLeft;
        if (crossingAhead !== undefined && crossingAhead < 60) parts.push(lines.line('explain.crossing', { distance: Math.max(5, Math.round(crossingAhead / 5) * 5) }));
        else if (lane.kind === 'bus') parts.push(lines.line('explain.bus_lane'));
        else if (road.oneway && !this.isRingLane(lane.id)) parts.push(lines.line('explain.oneway'));
        else if (road.zone === 'calming_30' || road.zone === 'school' || road.zone === 'living_street') parts.push(lines.line('explain.zone30'));
        else if (lane.turns && lane.turns.length > 0 && loc.distToLaneEnd < 80) parts.push(lines.line('explain.lane_turns', { turns: this.turnsText(lane.turns) }));
        else if (kerb === 'red_white' || kerb === 'red_yellow' || kerb === 'blue_white') parts.push(lines.line(`explain.kerb.${kerb}`));
      }
      parts.push(lines.line('explain.speed', { limit: loc.speedLimit }));
    }
    if (parts.length === 0) parts.push(lines.line('explain.nothing'));
    const text = parts.join(' ');
    this.dialogue.say({ who: 'instructor', text, priority: 2, key: 'explain', cooldown: 2 });
    return text;
  }

  update(ctx: SimContext): void {
    this.lastCtx = ctx;
    if (!this.greeted && this.autoGreet && ctx.coachPresent && (ctx.mode === 'free' || ctx.mode === 'training_ground')) this.greet(ctx.mode);
    if (!this.interventionsEnabled || !ctx.coachPresent || ctx.paused || this.muted) return;
    if (ctx.time - this.lastInterventionAt < INTERVENTION_INTERVAL) return;
    const preferred = ctx.localisation.laneId ? this.navigator?.expectedConnectorFrom(ctx.localisation.laneId)?.id : undefined;
    const danger = predictDanger(ctx, this.graph, this.dialogue.lines, { preferredConnectorId: preferred });
    if (!danger) return;
    this.lastInterventionAt = ctx.time;
    this.lastDanger = danger;
    this.interventionCount++;
    this.bus.emit('coach:intervention', { kind: 'brake', reason: danger.reason, time: ctx.time });
    this.dialogue.sayLine('intervention.brake', undefined, { priority: 3, key: 'intervention', cooldown: 2 });
    this.dialogue.sayLine(`intervention.explain.${danger.kind}`, undefined, { priority: 2, key: `intervention.explain.${danger.kind}`, cooldown: 15 });
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  // ---- internals ----------------------------------------------------------------------

  private onViolation(v: Violation): void {
    const info = VIOLATIONS[v.type];
    if (!info || this.muted) return;
    const time = this.lastCtx?.time ?? v.time;
    const focused = this.focus.has(v.type);
    const params: LineParams = { ...(v.details ?? {}), limit: v.details?.limit ?? this.lastCtx?.localisation.speedLimit ?? '' };
    const key = `violation.${v.type}`;
    if (info.severity === 'info') {
      if (v.type.startsWith('GOOD_')) {
        const prob = focused ? 1 : PRAISE_PROBABILITY[this.verbosity];
        if (this.rng() > prob) return;
        const text = this.dialogue.lines.has(key) ? this.dialogue.lines.line(key, params) : this.dialogue.lines.line('praise.generic');
        this.dialogue.say({ who: 'instructor', text, priority: 0, key, cooldown: info.cooldown * 2 });
        return;
      }
      const inLesson = this.lastCtx?.mode === 'lesson';
      if (v.type.startsWith('APPROACHING_')) {
        if (!(this.verbosity === 'high' || inLesson || focused)) return;
        this.dialogue.say({ who: 'instructor', text: this.textFor(v, params), priority: inLesson || focused ? 1 : 0, key, cooldown: info.cooldown * 2 });
        return;
      }
      if (this.verbosity !== 'high' && !focused) return;
      this.dialogue.say({ who: 'instructor', text: this.textFor(v, params), priority: 0, key, cooldown: info.cooldown * 2 });
      return;
    }
    let priority: 0 | 1 | 2 | 3 = info.severity === 'critical' ? 3 : info.severity === 'major' ? 2 : 1;
    if (focused && priority < 3) priority = (priority + 1) as 2 | 3;
    if (info.severity === 'minor' && !focused) {
      if (time - this.lastMinorAt < MINOR_NAG_INTERVAL) return;
      this.lastMinorAt = time;
    }
    let text = this.textFor(v, params);
    if (focused) text = this.dialogue.lines.line('violation.focus', { advice: text });
    this.dialogue.say({ who: 'instructor', text, priority, key, cooldown: info.cooldown * (focused ? 1 : 2) });
  }

  private textFor(v: Violation, params: LineParams): string {
    const key = `violation.${v.type}`;
    const lines = this.dialogue.lines;
    const base = lines.has(key) ? lines.line(key, params) : VIOLATIONS[v.type].advice;
    return v.context && !base.includes(v.context) && this.verbosity === 'high' ? `${base} (${v.context})` : base;
  }

  private turnsText(turns: string[]): string {
    const lines = this.dialogue.lines;
    const words = turns.map((t) => (t.includes('left') ? lines.line('explain.turn.left') : t.includes('right') ? lines.line('explain.turn.right') : t === 'uturn' ? lines.line('explain.turn.uturn') : lines.line('explain.turn.straight')));
    return [...new Set(words)].join(lines.line('explain.turn.join'));
  }

  private isRingLane(laneId: string): boolean {
    for (const j of this.graph.junctions.values()) if (j.roundabout?.ringLaneIds.includes(laneId)) return true;
    return false;
  }

  /** Distance to the next crossing ahead on the current lane (approach crossing included). */
  private nearestCrossingAhead(ctx: SimContext): number | undefined {
    const loc = ctx.localisation;
    if (!loc.laneId) return undefined;
    const lane = this.graph.lane(loc.laneId);
    let best: number | undefined;
    for (const c of this.graph.crossingsByLane.get(lane.id) ?? []) {
      const mid: [number, number] = [(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2];
      const s = projectOntoPolyline(lane.centre, mid).s;
      const d = s >= lane.length - 0.1 ? loc.distToLaneEnd + 2.5 : s - loc.s;
      if (d > -c.width && (best === undefined || d < best)) best = Math.max(0, d);
    }
    return best;
  }
}
