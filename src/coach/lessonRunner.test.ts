import { describe, expect, it } from 'vitest';
import type { SpeechRequest } from '@/core/events';
import type { TheoryQuestion } from '@/content/schema';
import { DialogueManager } from './dialogue';
import { Instructor } from './instructor';
import { LessonRunner } from './lessonRunner';
import { LessonSchema, type Lesson, type LessonInput } from './lessonSchema';
import { Navigator } from './navigator';
import { createTestContext, eventsNamed, spokenTexts } from './testUtils';

const QUESTIONS: TheoryQuestion[] = [
  { id: 'q1', text: 'מה המשמעות של תמרור עצור?', answers: ['להאט', 'לעצור עצירה מוחלטת', 'להמשיך'], correctIndex: 1, category: 'תמרורים', classes: ['B'], image: null, signs: ['302'], topics: ['priority'] },
];

const THREE_STEPS: LessonInput = {
  id: 'L_test',
  order: 1,
  title: 'שיעור בדיקה',
  summary: 'שלושה שלבים',
  spawnId: 'tg_start',
  world: 'training-ground',
  briefing: [{ title: 'ברוכים הבאים', text: 'נלמד להתחיל לנסוע.', signs: ['302'] }],
  steps: [
    {
      id: 'prep',
      title: 'הכנה',
      say: ['חגור חגורה.', 'ושים D.'],
      instruction: 'חגורה + D',
      done: { kind: 'all', of: [{ kind: 'vehicle', seatbelt: true }, { kind: 'vehicle', gear: 'D' }] },
      triggers: [{ when: { kind: 'elapsed', seconds: 2 }, do: [{ kind: 'hint', text: 'חגורה!', seconds: 4 }] }],
      onDone: ['יפה.'],
    },
    {
      id: 'drive',
      title: 'נסיעה לצומת',
      say: ['סע לצומת הראשון.'],
      navigateTo: { junctionId: 'n01' },
      done: { kind: 'all', of: [{ kind: 'reach', junctionId: 'n01', radius: 30 }, { kind: 'no_violation', types: ['SPEEDING_MAJOR'] }] },
      fail: { kind: 'violation', types: ['COLLISION'] },
      triggers: [{ when: { kind: 'distance', metres: 20 }, do: [{ kind: 'say', text: 'יופי, ממשיכים.', priority: 1 }, { kind: 'highlight', target: 'speedometer' }] }],
      focus: ['NO_INDICATOR_TURN'],
      timeoutSeconds: 300,
    },
    {
      id: 'stop',
      title: 'עצירה ושאלה',
      say: ['עצור כאן.'],
      done: { kind: 'all', of: [{ kind: 'stopped', seconds: 1 }, { kind: 'quiz_answered', minCorrect: 1 }] },
      quiz: ['q1'],
      onDone: ['סיימנו.'],
    },
  ],
  debrief: ['כל הכבוד על השיעור.'],
};

function setup(input: LessonInput = THREE_STEPS, opts: { lookup?: boolean } = {}) {
  const t = createTestContext({ mode: 'lesson' });
  const dm = new DialogueManager(t.bus, t.settings, { defaultLinger: 0 });
  const nav = new Navigator(t.graph, t.bus, dm);
  const ins = new Instructor(t.bus, dm, t.graph, { autoGreet: false });
  const timeScales: [number, number][] = [];
  const runner = new LessonRunner(t.bus, dm, nav, ins, t.graph, { questionLookup: opts.lookup === false ? undefined : (id) => QUESTIONS.find((q) => q.id === id), onTimeScale: (f, s) => timeScales.push([f, s]) });
  const lesson: Lesson = LessonSchema.parse(input);
  const systems = [runner, nav, ins, dm];
  const steps = () => eventsNamed<{ stepId: string; index: number; total: number }>(t, 'lesson:step');
  const says = () => eventsNamed<SpeechRequest>(t, 'coach:say');
  return { t, dm, nav, ins, runner, lesson, systems, steps, says, timeScales };
}

describe('LessonRunner', () => {
  it('shows the briefing, waits for the acknowledgement, then runs the first step', () => {
    const { t, runner, lesson, systems, steps, says, ins } = setup();
    t.ctx.player.seatbelt = false;
    runner.start(lesson);
    const briefing = eventsNamed<{ lessonId: string; slides: { title: string }[] }>(t, 'lesson:briefing');
    expect(briefing.length).toBe(1);
    expect(briefing[0]!.slides[0]!.title).toBe('ברוכים הבאים');
    t.advance(1, systems);
    expect(runner.runnerState).toBe('briefing');
    expect(steps().length).toBe(0);
    t.bus.emit('ui:acknowledged', { context: 'briefing' });
    t.step(0.1, systems);
    expect(runner.runnerState).toBe('running');
    expect(steps()).toEqual([{ lessonId: 'L_test', stepId: 'prep', index: 0, total: 3 }]);
    expect(runner.progress.stepId).toBe('prep');
    // greeting first, then the step's sentences at priority 2
    t.advance(20, systems);
    const texts = says().map((s) => s.text);
    expect(texts[0]).toMatch(/חגור|חגורה/);
    expect(texts).toContain('חגור חגורה.');
    expect(texts).toContain('ושים D.');
    expect(says().find((s) => s.text === 'ושים D.')!.priority).toBe(2);
    expect(eventsNamed<{ text: string }>(t, 'lesson:hint').map((h) => h.text)).toEqual(['חגורה + D', 'חגורה!']);
    expect(ins.focusTypes).toEqual([]);
  });

  it('completes the three steps: vehicle checks, navigation + triggers, stop + quiz; passes with a full score', () => {
    const { t, runner, lesson, systems, steps, says, nav, ins } = setup();
    t.ctx.player.seatbelt = false;
    runner.start(lesson);
    t.bus.emit('ui:acknowledged', { context: 'briefing' });
    t.advance(3, systems);
    expect(steps().length).toBe(1);
    t.ctx.player.seatbelt = true;
    t.step(0.1, systems);
    expect(steps().map((s) => s.stepId)).toEqual(['prep', 'drive']);
    expect(ins.focusTypes).toEqual(['NO_INDICATOR_TURN']);
    expect(nav.hasRoute).toBe(true);
    expect(t.graph.lane(nav.path!.laneIds[nav.path!.laneIds.length - 1]!).to).toBe('n01');
    t.advance(25, systems); // let the greeting / step sentences / route announcement play out
    // drive south on רחוב התמר towards n01: the distance trigger fires once
    t.ctx.player.speed = 8;
    t.advance(4, systems);
    expect(says().some((s) => s.text === 'יופי, ממשיכים.')).toBe(true);
    expect(eventsNamed<{ target: string }>(t, 'lesson:highlight')).toEqual([{ target: 'speedometer', seconds: 5 }]);
    t.advance(6, systems);
    expect(says().filter((s) => s.text === 'יופי, ממשיכים.').length).toBe(1);
    expect(steps().map((s) => s.stepId)).toEqual(['prep', 'drive', 'stop']);
    // step 3: a question is asked; a wrong answer is corrected and the question returns
    const questions = () => eventsNamed<{ questionId: string }>(t, 'theory:question');
    expect(questions().length).toBe(1);
    t.bus.emit('theory:answer', { questionId: 'q1', index: 0 });
    expect(eventsNamed<{ correct: boolean }>(t, 'theory:answered')).toEqual([{ questionId: 'q1', correct: false }]);
    expect(questions().length).toBe(2);
    t.ctx.player.speed = 0;
    t.advance(2, systems);
    expect(runner.runnerState).toBe('running');
    t.bus.emit('theory:answer', { questionId: 'q1', index: 1 });
    expect(eventsNamed<{ correct: boolean }>(t, 'theory:answered')[1]!.correct).toBe(true);
    t.step(0.1, systems);
    expect(runner.runnerState).toBe('finished');
    expect(eventsNamed(t, 'lesson:completed')).toEqual([{ lessonId: 'L_test', passed: true, score: 100 }]);
    t.advance(30, systems);
    const texts = spokenTexts(t);
    expect(texts).toContain('סיימנו.');
    expect(texts).toContain('כל הכבוד על השיעור.');
    expect(texts.some((x) => x.includes('100'))).toBe(true);
    expect(texts.some((x) => x.includes('לא בדיוק'))).toBe(true);
    expect(nav.hasRoute).toBe(false);
  });

  it('restarts a step on its fail condition and counts the violations for the pass criteria', () => {
    const { t, runner, lesson, systems, steps } = setup();
    runner.start(lesson);
    t.bus.emit('ui:acknowledged', { context: 'briefing' });
    t.step(0.1, systems); // prep completes immediately (seatbelt + D already set)
    expect(steps().map((s) => s.stepId)).toEqual(['prep', 'drive']);
    t.bus.emit('violation', { type: 'COLLISION', severity: 'critical', time: t.ctx.time, pos: [0, 0] });
    t.step(0.1, systems);
    expect(eventsNamed(t, 'sim:reset')).toEqual([{ reason: 'step_restart' }]);
    expect(steps().map((s) => s.stepId)).toEqual(['prep', 'drive', 'drive']);
    expect(runner.progress.restarts).toBe(1);
    t.advance(25, systems);
    expect(spokenTexts(t).some((x) => x.includes('מחדש'))).toBe(true);
    // finish the lesson: the critical violation fails it even though every step completed
    runner.skipStep();
    t.ctx.player.speed = 0;
    t.bus.emit('theory:answer', { questionId: 'q1', index: 1 });
    t.advance(1.5, systems);
    expect(runner.runnerState).toBe('finished');
    const done = eventsNamed<{ passed: boolean; score: number }>(t, 'lesson:completed')[0]!;
    expect(done.passed).toBe(false);
    expect(done.score).toBe(0);
  });

  it('restarts on timeout with a "try again" hint', () => {
    const input: LessonInput = { ...THREE_STEPS, briefing: [], steps: [{ id: 'slow', title: 'שלב', done: { kind: 'elapsed', seconds: 1000 }, timeoutSeconds: 5 }] };
    const { t, runner, lesson, systems, steps } = setup(input);
    runner.start(lesson);
    t.advance(4, systems);
    expect(steps().length).toBe(1);
    t.advance(1.5, systems);
    expect(steps().length).toBe(2);
    expect(eventsNamed<{ reason: string }>(t, 'sim:reset')).toEqual([{ reason: 'step_restart' }]);
    expect(eventsNamed<{ text: string }>(t, 'lesson:hint').some((h) => h.text === 'נסה שוב')).toBe(true);
    t.advance(20, systems);
    expect(spokenTexts(t).some((x) => x.includes('נגמר הזמן'))).toBe(true);
  });

  it('runs the fail_step / brake / slow_motion / spawn / set_signal / score actions', () => {
    const input: LessonInput = {
      ...THREE_STEPS,
      briefing: [],
      steps: [
        {
          id: 'one',
          title: 'שלב',
          done: { kind: 'elapsed', seconds: 1000 },
          triggers: [
            { when: { kind: 'elapsed', seconds: 1 }, do: [{ kind: 'slow_motion', factor: 0.5, seconds: 2 }, { kind: 'brake', reason: 'בדיקה' }, { kind: 'spawn_pedestrian' }, { kind: 'spawn_vehicle', where: 'ahead', distance: 30 }, { kind: 'set_signal', state: 'red' }, { kind: 'score', delta: -10 }] },
            { when: { kind: 'elapsed', seconds: 3 }, do: [{ kind: 'fail_step', reason: 'לא ככה.' }] },
          ],
        },
      ],
    };
    const { t, runner, lesson, systems, steps, timeScales } = setup(input);
    t.placeOnLane('r01_11:f0', 50, { speed: 3 });
    runner.start(lesson); // no briefing → starts on the next update
    t.advance(2, systems);
    expect(steps().length).toBe(1);
    expect(timeScales).toEqual([[0.5, 2]]);
    expect(eventsNamed<{ kind: string; reason: string }>(t, 'coach:intervention')).toEqual([{ kind: 'brake', reason: 'בדיקה', time: expect.any(Number) }]);
    const reqs = eventsNamed<{ kind: string; payload: Record<string, unknown> }>(t, 'coach:request').map((r) => r.kind);
    expect(reqs).toEqual(['slow_motion', 'spawn_pedestrian', 'spawn_vehicle', 'set_signal']);
    const signal = eventsNamed<{ kind: string; payload: Record<string, unknown> }>(t, 'coach:request').find((r) => r.kind === 'set_signal')!;
    expect(signal.payload.junctionId).toBe('n11');
    expect(signal.payload.state).toBe('red');
    expect(typeof signal.payload.groupId).toBe('string');
    t.advance(1.5, systems);
    expect(steps().length).toBe(2); // fail_step restarted it
    expect(eventsNamed<{ reason: string }>(t, 'sim:reset')).toEqual([{ reason: 'step_restart' }]);
    t.advance(20, systems);
    expect(spokenTexts(t)).toContain('לא ככה. ננסה שוב.');
    const before = steps().length;
    runner.abort();
    expect(runner.runnerState).toBe('finished');
    t.advance(5, systems);
    expect(steps().length).toBe(before);
    expect(spokenTexts(t).some((x) => x.includes('הפסקנו'))).toBe(true);
  });

  it('evaluates the remaining condition kinds: glanced, reversed, passed_junction, parked, speed_in_range, acknowledged, any', () => {
    const input: LessonInput = {
      ...THREE_STEPS,
      briefing: [],
      steps: [
        { id: 'glance', title: 'מראות', done: { kind: 'glanced', target: 'left_mirror', withinSeconds: 5 } },
        { id: 'rev', title: 'רוורס', done: { kind: 'reversed', metres: 5 } },
        { id: 'junction', title: 'צומת', done: { kind: 'passed_junction', junctionId: 'n01', turn: 'left' } },
        { id: 'speed', title: 'מהירות', done: { kind: 'any', of: [{ kind: 'speed_in_range', min: 20, max: 40, seconds: 2 }, { kind: 'acknowledged' }] } },
        { id: 'park', title: 'חניה', done: { kind: 'parked', maxKerbDistance: 0.4, maxAngleDeg: 8 } },
      ],
    };
    const { t, runner, lesson, systems, steps } = setup(input, { lookup: false });
    runner.start(lesson);
    t.step(0.1, systems);
    expect(steps().length).toBe(1);
    t.bus.emit('input:glance', { target: 'right_mirror', time: t.ctx.time });
    t.step(0.1, systems);
    expect(steps().length).toBe(1);
    t.bus.emit('input:glance', { target: 'left_mirror', time: t.ctx.time });
    t.step(0.1, systems);
    expect(steps().map((s) => s.stepId)).toEqual(['glance', 'rev']);
    t.ctx.player.speed = -2;
    t.advance(3, systems);
    expect(steps().map((s) => s.stepId)).toEqual(['glance', 'rev', 'junction']);
    // pass through n01 turning left: lane end → connector → next lane
    t.ctx.player.speed = 8;
    const left = t.graph.connectorsFrom('r00_01:f0').find((c) => c.turn === 'left')!;
    t.placeOnLane('r00_01:f0', 100);
    t.step(0.1, systems);
    t.place(left.path[Math.floor(left.path.length / 2)]!, Math.PI / 4);
    t.step(0.1, systems);
    expect(t.ctx.localisation.connectorId).toBe(left.id);
    t.placeOnLane(left.toLane, 5);
    t.step(0.1, systems);
    expect(steps().map((s) => s.stepId)).toEqual(['glance', 'rev', 'junction', 'speed']);
    t.ctx.player.speed = 30 / 3.6;
    t.advance(1.5, systems);
    expect(steps().length).toBe(4);
    t.ctx.player.speed = 50 / 3.6; // out of range resets the timer
    t.step(0.5, systems);
    t.ctx.player.speed = 30 / 3.6;
    t.advance(1.5, systems);
    expect(steps().length).toBe(4);
    t.bus.emit('ui:acknowledged', { context: 'continue' });
    t.step(0.1, systems);
    expect(steps().map((s) => s.stepId)[4]).toBe('park');
    // park legally by the kerb on רחוב האלון
    t.placeOnLane('r20_21:f0', 50, { speed: 0, lateral: 0.4 });
    t.ctx.player.gear = 'P';
    t.advance(1.5, systems);
    expect(runner.runnerState).toBe('finished');
    expect(eventsNamed<{ passed: boolean }>(t, 'lesson:completed')[0]!.passed).toBe(true);
  });
});
