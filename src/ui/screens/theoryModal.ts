/**
 * In-drive theory question ('theory:question' → modal → 'theory:answer').
 * Feedback comes from the engine's 'theory:answered' (correct flag); the modal shows it
 * briefly and closes. If no 'theory:answered' arrives, it closes after a short grace period.
 */
import type { SimEventMap } from '@/core/events';
import type { TheoryQuestion } from '@/content/schema';
import { el } from '../dom';
import { icon } from '../icons';
import { THEORY } from '../strings.he';
import type { ScreenHandle, ScreenHost } from '../types';
import { panel } from './common';
import { questionCard } from './theoryQuiz';

export const FEEDBACK_MS = 2200;
export const NO_FEEDBACK_GRACE_MS = 1500;

export function theoryModalScreen(host: ScreenHost, q: SimEventMap['theory:question']): ScreenHandle {
  const question: TheoryQuestion = { id: q.questionId, text: q.text, answers: q.answers, correctIndex: -1, category: '', classes: ['B'], image: q.image, signs: [], topics: [] };
  let answered = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let offAnswered: (() => void) | undefined;

  const { el: root, body } = panel({ title: THEORY.inDriveTitle, icon: 'question', size: 'md', className: 'theory-modal' });
  const feedback = el('div');
  const buttons = questionCard(body, question, choose);
  body.appendChild(feedback);
  body.appendChild(el('p', { class: 'muted', text: THEORY.inDriveHint }));

  function choose(i: number): void {
    if (answered) return;
    answered = true;
    buttons.forEach((b, k) => {
      b.disabled = true;
      if (k !== i) b.classList.add('dim');
    });
    host.bus.emit('theory:answer', { questionId: q.questionId, index: i });
    closeTimer = setTimeout(() => host.close(), NO_FEEDBACK_GRACE_MS);
    offAnswered = host.bus.on('theory:answered', (res) => {
      if (res.questionId !== q.questionId) return;
      offAnswered?.();
      if (closeTimer) clearTimeout(closeTimer);
      buttons[i]?.classList.remove('dim');
      buttons[i]?.classList.add(res.correct ? 'correct' : 'wrong');
      feedback.replaceChildren(el('div', { class: `feedback ${res.correct ? 'correct' : 'wrong'}`, attrs: { role: 'status' } }, icon(res.correct ? 'check' : 'close', { size: 22 }), el('b', { text: res.correct ? THEORY.correct : THEORY.wrong })));
      closeTimer = setTimeout(() => host.close(), FEEDBACK_MS);
    });
  }

  return {
    el: root,
    kind: 'modal',
    initialFocus: buttons[0],
    dispose: () => {
      if (closeTimer) clearTimeout(closeTimer);
      offAnswered?.();
    },
    onKey: (e) => {
      if (/^[1-5]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < buttons.length) choose(i);
        return true;
      }
      return false;
    },
  };
}
