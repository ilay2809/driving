// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS } from '@/core/sim';
import type { TheoryQuestion } from '@/content/schema';
import { key, stubCanvas } from '../testing';
import { UISystem } from '../uiSystem';
import { summarise, topicLabels } from './theoryQuiz';

const Q: TheoryQuestion[] = [
  { id: '1', text: 'שאלה 1', answers: ['א', 'ב', 'ג', 'ד'], correctIndex: 1, category: 'חוקי התנועה', classes: ['B'], image: null, signs: [], topics: ['priority'] },
  { id: '2', text: 'שאלה 2', answers: ['א', 'ב', 'ג', 'ד'], correctIndex: 0, category: 'חוקי התנועה', classes: ['B'], image: null, signs: [], topics: ['speed'] },
  { id: '3', text: 'שאלה 3', answers: ['א', 'ב', 'ג', 'ד'], correctIndex: 3, category: 'תמרורים', classes: ['B'], image: null, signs: [], topics: [] },
];

describe('summarise', () => {
  it('counts correct answers per official category and applies the pass mark', () => {
    const r = summarise(Q, [1, 2, null], 2, false);
    expect(r.correct).toBe(1);
    expect(r.total).toBe(3);
    expect(r.passed).toBe(false);
    expect(r.answers[2]).toEqual({ questionId: '3', index: null, correct: false });
    const laws = r.byTopic.find((t) => t.topic === 'חוקי התנועה')!;
    expect(laws).toEqual({ topic: 'חוקי התנועה', total: 2, correct: 1 });
    expect(summarise(Q, [1, 0, 3], 3, false).passed).toBe(true);
  });

  it('translates known topic tags and falls back to the category', () => {
    expect(topicLabels(Q[0]!)).toEqual(['זכות קדימה']);
    expect(topicLabels(Q[2]!)).toEqual(['תמרורים']);
  });
});

describe('theoryQuiz screen', () => {
  let ui: UISystem;
  let bus: EventBus;
  let root: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    stubCanvas();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    bus = new EventBus();
    ui = new UISystem(root, bus, { ...DEFAULT_SETTINGS }, { prefsKey: null });
  });
  afterEach(() => {
    ui.dispose();
    vi.useRealTimers();
  });

  it('emits theory:answer with the chosen index, gives feedback and finishes with a result', () => {
    const answers: { questionId: string; index: number }[] = [];
    bus.on('theory:answer', (a) => answers.push(a));
    const onFinish = vi.fn();
    ui.showScreen('theoryQuiz', { questions: Q, mode: 'exam', timeLimitSec: 600, explanations: { '1': 'הסבר' }, onFinish, onClose: () => undefined });
    expect(root.querySelector('.quiz-progress')!.textContent).toContain('שאלה 1/3');
    expect(root.querySelector('.quiz-timer')!.textContent).toBe('10:00');
    vi.advanceTimersByTime(1000);
    expect(root.querySelector('.quiz-timer')!.textContent).toBe('9:59');

    (root.querySelector('.answer[data-index="2"]') as HTMLButtonElement).click();
    expect(answers).toEqual([{ questionId: '1', index: 2 }]);
    expect(root.querySelector('.answer[data-index="2"]')!.classList.contains('wrong')).toBe(true);
    expect(root.querySelector('.answer[data-index="1"]')!.classList.contains('correct')).toBe(true);
    expect(root.querySelector('.feedback')!.textContent).toContain('הסבר');
    (root.querySelector('.answer[data-index="0"]') as HTMLButtonElement).click();
    expect(answers).toHaveLength(1);

    key(window, 'Enter');
    expect(root.querySelector('.quiz-progress')!.textContent).toContain('שאלה 2/3');
    key(window, '1');
    expect(answers[1]).toEqual({ questionId: '2', index: 0 });
    expect(root.querySelector('.feedback.correct')).not.toBeNull();
    key(window, 'Enter');
    key(window, '4');
    key(window, 'Enter');
    expect(onFinish).toHaveBeenCalledTimes(1);
    const result = onFinish.mock.calls[0]![0];
    expect(result.correct).toBe(2);
    expect(root.querySelector('.results-hero')).not.toBeNull();
    expect(root.querySelector('.topic-breakdown')!.children.length).toBe(2);
  });

  it('finishes with timedOut when the exam timer runs out', () => {
    const onFinish = vi.fn();
    ui.showScreen('theoryQuiz', { questions: Q, mode: 'exam', timeLimitSec: 3, onFinish, onClose: () => undefined });
    vi.advanceTimersByTime(3_100);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0]![0].timedOut).toBe(true);
  });
});
