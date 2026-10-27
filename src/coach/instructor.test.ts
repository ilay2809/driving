import { describe, expect, it } from 'vitest';
import type { SpeechRequest } from '@/core/events';
import type { SimMode } from '@/core/types';
import type { Violation, ViolationType } from '@/rules/violations';
import { DialogueManager } from './dialogue';
import { Instructor, type Verbosity } from './instructor';
import { createTestContext, eventsNamed, spokenTexts } from './testUtils';

function setup(opts: { mode?: SimMode; verbosity?: Verbosity; autoGreet?: boolean } = {}) {
  const t = createTestContext({ mode: opts.mode ?? 'free' });
  const dm = new DialogueManager(t.bus, t.settings, { defaultLinger: 0 });
  const ins = new Instructor(t.bus, dm, t.graph, { verbosity: opts.verbosity ?? 'normal', autoGreet: opts.autoGreet, seed: 3 });
  const violation = (type: ViolationType, details?: Violation['details']): void => {
    const sev = { SPEEDING_MAJOR: 'major', RED_LIGHT: 'critical', NO_INDICATOR_TURN: 'minor', LANE_DEPARTURE: 'minor', GOOD_STOP: 'info', APPROACHING_STOP_SIGN: 'info', SPEED_LIMIT_CHANGED: 'info', STOP_SIGN_NO_STOP: 'critical' }[type as string] ?? 'minor';
    t.bus.emit('violation', { type, severity: sev as Violation['severity'], time: t.ctx.time, pos: [0, 0], details });
  };
  const says = () => eventsNamed<SpeechRequest>(t, 'coach:say');
  return { t, dm, ins, violation, says, systems: [ins, dm] };
}

describe('Instructor', () => {
  it('greets once in free mode, and on request for lessons', () => {
    const { t, ins, says, systems } = setup({ mode: 'free' });
    t.step(0.1, systems);
    t.step(0.1, systems);
    expect(says().length).toBe(1);
    expect(says()[0]!.who).toBe('instructor');
    const lesson = setup({ mode: 'lesson' });
    lesson.t.step(0.1, lesson.systems);
    expect(lesson.says().length).toBe(0);
    lesson.ins.greet('lesson');
    expect(lesson.says().length).toBe(1);
    expect(lesson.says()[0]!.text).toMatch(/חגור|חגורה/);
    ins.dispose();
  });

  it('speaks violation advice with a priority by severity and de-duplicates per type', () => {
    const { t, dm, violation, says, systems } = setup({ autoGreet: false });
    t.step(0.1, systems);
    violation('RED_LIGHT');
    expect(says().length).toBe(1);
    expect(says()[0]!.priority).toBe(3);
    expect(says()[0]!.text).toContain('אדום');
    violation('SPEEDING_MAJOR', { speed: 72, limit: 50 });
    expect(dm.pending.length).toBe(1); // queued behind the critical one
    t.advance(6, systems);
    expect(says().length).toBe(2);
    expect(says()[1]!.priority).toBe(2);
    expect(says()[1]!.text).toContain('50');
    // same type again within cooldown × 2 (10 s × 2): dropped
    t.advance(8, systems);
    violation('SPEEDING_MAJOR', { speed: 72, limit: 50 });
    expect(says().length).toBe(2);
    t.advance(12, systems);
    violation('SPEEDING_MAJOR', { speed: 72, limit: 50 });
    t.advance(1, systems);
    expect(says().length).toBe(3);
  });

  it('limits minor remarks to one per 8 s and uses the catalogue advice for types without variants', () => {
    const { t, violation, says, systems } = setup({ autoGreet: false });
    t.step(0.1, systems);
    violation('NO_INDICATOR_TURN');
    violation('LANE_DEPARTURE');
    expect(says().length).toBe(1);
    expect(says()[0]!.priority).toBe(1);
    t.advance(9, systems);
    violation('WIDE_TURN');
    expect(says().length).toBe(2);
    expect(says()[1]!.text).toBe('בפנייה ימינה הישאר צמוד לימין; בפנייה שמאלה אל תחתוך לנתיב הנגדי.');
  });

  it('praises good behaviour sometimes and reserves infos for lessons / high verbosity', () => {
    const { t, violation, says, systems } = setup({ autoGreet: false, verbosity: 'normal' });
    t.step(0.1, systems);
    violation('APPROACHING_STOP_SIGN');
    violation('SPEED_LIMIT_CHANGED', { limit: 30 });
    expect(says().length).toBe(0);
    let praised = 0;
    for (let i = 0; i < 12; i++) {
      t.advance(25, systems);
      violation('GOOD_STOP');
      praised = says().length;
    }
    expect(praised).toBeGreaterThan(2);
    expect(praised).toBeLessThan(12);
    const lesson = setup({ mode: 'lesson', autoGreet: false });
    lesson.t.step(0.1, lesson.systems);
    lesson.violation('APPROACHING_STOP_SIGN');
    expect(lesson.says().length).toBe(1);
    expect(lesson.says()[0]!.text).toContain('עצור');
    const high = setup({ verbosity: 'high', autoGreet: false });
    high.t.step(0.1, high.systems);
    high.violation('SPEED_LIMIT_CHANGED', { limit: 30 });
    expect(high.says().length).toBe(1);
    expect(high.says()[0]!.text).toContain('30');
  });

  it('emphasises the lesson focus', () => {
    const { t, ins, violation, says, systems } = setup({ autoGreet: false });
    ins.setFocus(['NO_INDICATOR_TURN']);
    t.step(0.1, systems);
    violation('NO_INDICATOR_TURN');
    expect(says().length).toBe(1);
    expect(says()[0]!.priority).toBe(2);
    expect(says()[0]!.text).toContain('מתרגלים');
    expect(ins.focusTypes).toEqual(['NO_INDICATOR_TURN']);
  });

  it('explains the current situation on request', () => {
    const { t, ins, systems } = setup({ autoGreet: false });
    const stopLane = t.graph.lane('r11_12:f0');
    t.placeOnLane(stopLane.id, stopLane.length - 40, { speed: 5 });
    t.step(0.1, systems);
    const text = ins.explainHere(t.ctx);
    expect(text).toContain('תמרור עצור');
    expect(text).toContain('קמ"ש');
    expect((text.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(3);
    t.placeOnLane('r02_12:f0', 15, { speed: 5 });
    t.step(0.1, systems);
    const oneWay = ins.explainHere(t.ctx);
    expect(oneWay).toContain('חד-סטרי');
    expect(oneWay).toContain('30');
    const sig = t.graph.lane('r01_11:f0');
    t.signals.setJunction('n11', 'red');
    t.placeOnLane(sig.id, sig.length - 30, { speed: 0 });
    t.step(0.1, systems);
    t.advance(3, systems);
    expect(ins.explainHere(t.ctx)).toContain('אדום');
    expect(spokenTexts(t).length).toBeGreaterThanOrEqual(1);
  });

  it('presses the dual brake on a red signal ahead and explains, at most once per 4 s', () => {
    const { t, says, systems } = setup({ autoGreet: false });
    const lane = t.graph.lane('r01_11:f0');
    t.signals.setJunction('n11', 'red');
    t.placeOnLane(lane.id, lane.length - 18, { speed: 50 / 3.6 });
    t.step(0.1, systems);
    const interventions = eventsNamed<{ kind: string; reason: string }>(t, 'coach:intervention');
    expect(interventions.length).toBe(1);
    expect(interventions[0]!.kind).toBe('brake');
    expect(interventions[0]!.reason).toContain('אדום');
    expect(says()[0]!.text).toBe('אני בולם!');
    expect(says()[0]!.priority).toBe(3);
    t.step(0.1, systems);
    t.step(0.1, systems);
    expect(eventsNamed(t, 'coach:intervention').length).toBe(1);
    t.advance(2, systems);
    expect(says().some((s) => s.text.includes('אור אדום'))).toBe(true);
  });
});
