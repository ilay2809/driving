import type { TheoryQuestion } from '@/content/schema';
import { baseUrl, button, el, setText, toggleClass } from '../dom';
import { formatClock } from '../format';
import { icon } from '../icons';
import { THEORY, TOPIC_LABELS } from '../strings.he';
import type { ScreenHandle, ScreenHost, TheoryQuizProps, TheoryQuizResult } from '../types';
import { badge, footer, panel } from './common';

export const DEFAULT_EXAM_SECONDS = 40 * 60;
/** Official pass mark: 26 of 30. */
export const PASS_RATIO = 26 / 30;

/** Hebrew label for a question's topic chips (known tags translated, else the official category). */
export function topicLabels(q: TheoryQuestion): string[] {
  const known = q.topics.map((t) => TOPIC_LABELS[t]).filter((t): t is string => !!t);
  if (known.length > 0) return [...new Set(known)];
  return q.category ? [q.category] : [THEORY.untagged];
}

/** Pure: per-topic breakdown (official category, Hebrew) and pass/fail for a set of answers. */
export function summarise(questions: TheoryQuestion[], chosen: (number | null)[], passMark: number, timedOut: boolean): TheoryQuizResult {
  const byTopicMap = new Map<string, { total: number; correct: number }>();
  const answers = questions.map((q, i) => {
    const index = chosen[i] ?? null;
    const correct = index !== null && index === q.correctIndex;
    const topic = q.category || topicLabels(q)[0] || THEORY.untagged;
    const e = byTopicMap.get(topic) ?? { total: 0, correct: 0 };
    e.total++;
    if (correct) e.correct++;
    byTopicMap.set(topic, e);
    return { questionId: q.id, index, correct };
  });
  const correct = answers.filter((a) => a.correct).length;
  const byTopic = [...byTopicMap.entries()].map(([topic, v]) => ({ topic, ...v })).sort((a, b) => a.correct / a.total - b.correct / b.total);
  return { total: questions.length, correct, answers, byTopic, passed: correct >= passMark, timedOut };
}

/** Renders one question card into `container`; returns the answer buttons. */
export function questionCard(
  container: HTMLElement,
  q: TheoryQuestion,
  onChoose: (index: number) => void,
  opts: { image?: string | null; compact?: boolean } = {},
): HTMLButtonElement[] {
  const image = opts.image === undefined ? q.image : opts.image;
  const bodyEl = el('div', { class: `quiz-body${image ? ' has-image' : ''}` });
  const left = el('div', { class: 'quiz-main' });
  left.appendChild(el('div', { class: 'quiz-question', text: q.text }));
  const answers = el('div', { class: 'answers', attrs: { role: 'group', 'data-nav-group': '' } });
  const buttons: HTMLButtonElement[] = [];
  q.answers.forEach((a, i) => {
    const b = el('button', { class: 'answer', attrs: { type: 'button' }, dataset: { index: String(i) }, on: { click: () => onChoose(i) } }, el('span', { class: 'answer-num num', text: String(i + 1) }), el('span', { text: a }));
    buttons.push(b);
    answers.appendChild(b);
  });
  left.appendChild(answers);
  bodyEl.appendChild(left);
  if (image) {
    const img = el('img', { attrs: { src: `${baseUrl()}theory/${image}`, alt: THEORY.imageAlt } });
    const box = el('div', { class: 'quiz-image' }, img);
    img.addEventListener('error', () => box.remove());
    bodyEl.appendChild(box);
  }
  container.appendChild(bodyEl);
  return buttons;
}

export function theoryQuizScreen(host: ScreenHost, props: TheoryQuizProps): ScreenHandle {
  const questions = props.questions;
  const passMark = props.passMark ?? Math.ceil(questions.length * PASS_RATIO);
  const chosen: (number | null)[] = questions.map(() => null);
  let index = 0;
  let answered = false;
  let finished = false;
  let timeLeft = props.mode === 'exam' ? (props.timeLimitSec ?? DEFAULT_EXAM_SECONDS) : 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let answerButtons: HTMLButtonElement[] = [];
  let nextBtn: HTMLButtonElement | undefined;

  const { el: root, body } = panel({ title: `${THEORY.title} — ${props.mode === 'exam' ? THEORY.exam : THEORY.practice}`, icon: 'book', size: 'md', onClose: () => close(), className: 'theory-quiz' });
  const timerEl = el('span', { class: 'quiz-timer num' });

  function close(): void {
    stopTimer();
    props.onClose();
  }

  function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function startTimer(): void {
    if (props.mode !== 'exam') return;
    renderTimer();
    timer = setInterval(() => {
      timeLeft--;
      renderTimer();
      if (timeLeft <= 0) finish(true);
    }, 1000);
  }

  function renderTimer(): void {
    setText(timerEl, formatClock(timeLeft));
    toggleClass(timerEl, 'low', timeLeft <= 120);
  }

  function choose(i: number): void {
    if (answered || finished) return;
    answered = true;
    chosen[index] = i;
    const q = questions[index]!;
    const correct = i === q.correctIndex;
    answerButtons.forEach((b, k) => {
      b.disabled = true;
      if (k === q.correctIndex) b.classList.add('correct');
      else if (k === i) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    host.bus.emit('theory:answer', { questionId: q.id, index: i });
    props.onAnswer?.(q.id, i, correct);
    const explanation = props.explanations?.[q.id];
    const fb = el('div', { class: `feedback ${correct ? 'correct' : 'wrong'}`, attrs: { role: 'status' } }, icon(correct ? 'check' : 'close', { size: 22 }), el('div', {}, el('b', { text: correct ? THEORY.correct : THEORY.wrong }), el('span', { text: explanation ?? (correct ? '' : THEORY.correctIs) })));
    feedbackSlot.replaceChildren(fb);
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.focus();
    }
  }

  function next(): void {
    if (!answered) return;
    if (index >= questions.length - 1) finish(false);
    else {
      index++;
      answered = false;
      render();
    }
  }

  function finish(timedOut: boolean): void {
    if (finished) return;
    finished = true;
    stopTimer();
    const result = summarise(questions, chosen, passMark, timedOut);
    renderResults(result);
    props.onFinish(result);
  }

  const feedbackSlot = el('div');
  const content = el('div', { class: 'quiz-content', style: { display: 'contents' } });
  body.appendChild(content);

  function render(): void {
    content.innerHTML = '';
    const q = questions[index]!;
    const top = el('div', { class: 'quiz-top' });
    top.appendChild(el('div', { class: 'quiz-progress' }, el('span', { class: 'num', text: THEORY.question(index + 1, questions.length) }), el('div', { class: 'progress-bar', attrs: { 'aria-hidden': 'true' } }, el('i', { style: { width: `${Math.round((index / Math.max(1, questions.length)) * 100)}%` } }))));
    const right = el('div', { class: 'btn-row' });
    const topics = el('div', { class: 'topics' });
    for (const t of topicLabels(q)) topics.appendChild(badge(t, 'accent'));
    right.appendChild(topics);
    if (props.mode === 'exam') right.appendChild(el('span', { class: 'quiz-timer-wrap' }, icon('clock', { size: 16 }), timerEl));
    top.appendChild(right);
    content.appendChild(top);
    answerButtons = questionCard(content, q, choose);
    feedbackSlot.innerHTML = '';
    content.appendChild(feedbackSlot);
    nextBtn = button(index >= questions.length - 1 ? THEORY.finish : THEORY.next, next, { variant: 'primary', icon: 'chevronLeft', kbd: 'Enter', disabled: true });
    content.appendChild(footer(el('span', { class: 'muted', text: THEORY.keysHint }), nextBtn));
    answerButtons[0]?.focus();
  }

  function renderResults(r: TheoryQuizResult): void {
    content.innerHTML = '';
    const hero = el(
      'div',
      { class: 'results-hero' },
      el('div', { class: `score-ring${r.passed ? '' : ' fail'}` }, el('div', { class: 'score-val num', text: `${r.correct}/${r.total}` })),
      el('div', {}, el('h2', { class: r.passed ? 'pass' : 'fail', text: r.timedOut ? THEORY.timeUp : r.passed ? THEORY.passed : THEORY.failed }), el('p', { class: 'muted', text: THEORY.scoreLine(r.correct, r.total) }), el('p', { class: 'muted', text: THEORY.passMark(passMark, r.total) })),
    );
    content.appendChild(hero);
    const breakdown = el('div', { class: 'topic-breakdown' });
    for (const t of r.byTopic) {
      const pct = t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0;
      breakdown.appendChild(el('div', { class: `topic-row${pct < 70 ? ' weak' : ''}` }, el('span', { text: t.topic }), el('div', { class: 'progress-bar' }, el('i', { style: { width: `${pct}%` } })), el('span', { class: 'num muted', text: `${t.correct}/${t.total}` })));
    }
    content.appendChild(el('section', { class: 'section' }, el('h2', { text: THEORY.byTopic }), breakdown));
    const closeBtn = button(THEORY.close, close, { variant: 'primary', icon: 'check' });
    content.appendChild(footer(el('span'), closeBtn));
    closeBtn.focus();
  }

  render();
  startTimer();

  return {
    el: root,
    kind: 'full',
    initialFocus: answerButtons[0],
    dispose: stopTimer,
    onKey: (e) => {
      if (e.key === 'Escape') {
        close();
        return true;
      }
      if (finished) return false;
      if (/^[1-5]$/.test(e.key) && !answered) {
        const i = Number(e.key) - 1;
        if (i < answerButtons.length) choose(i);
        return true;
      }
      if (e.key === 'Enter' && answered && !(document.activeElement instanceof HTMLButtonElement && document.activeElement !== nextBtn)) {
        next();
        return true;
      }
      return false;
    },
  };
}
