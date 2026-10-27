import { button, el } from '../dom';
import { icon } from '../icons';
import { COMMON, LESSONS } from '../strings.he';
import type { LessonCardData, LessonListProps, ScreenHandle, ScreenHost } from '../types';
import { badge, footer, panel, scoreRing } from './common';

function lessonCard(l: LessonCardData, onSelect: (id: string) => void): HTMLButtonElement {
  const locked = l.status === 'locked';
  const meta = el('span', { class: 'card-meta' });
  meta.appendChild(el('span', { text: COMMON.minutes(l.minutes) }));
  if (l.status === 'completed') meta.appendChild(badge(LESSONS.completed, 'ok', 'check'));
  else if (locked) meta.appendChild(badge(COMMON.locked, '', 'lock'));
  else meta.appendChild(badge(LESSONS.available, 'accent', 'play'));
  const card = el(
    'button',
    {
      class: `card lesson-card ${l.status}`,
      attrs: { type: 'button', 'aria-disabled': locked ? 'true' : undefined, 'aria-label': `${LESSONS.lesson(l.order)}: ${l.title}${locked ? ' — ' + LESSONS.locked : ''}` },
      dataset: { lesson: l.id },
      on: {
        click: () => {
          if (!locked) onSelect(l.id);
        },
      },
    },
    el('span', { class: 'lesson-order num', text: String(l.order) }),
    el('span', { class: 'card-body' }, el('span', { class: 'card-title', text: l.title }), l.subtitle ? el('span', { class: 'card-text', text: l.subtitle }) : null, meta),
    l.status === 'completed' && l.score !== undefined ? scoreRing(l.score, { mini: true, label: COMMON.score }) : locked ? el('span', { class: 'muted' }, icon('lock', { size: 20 })) : null,
  );
  return card;
}

export function lessonListScreen(_host: ScreenHost, props: LessonListProps): ScreenHandle {
  const { el: root, body } = panel({ title: LESSONS.title, icon: 'school', subtitle: LESSONS.subtitle, size: 'lg', onClose: props.onBack, closeLabel: COMMON.back });
  const sorted = [...props.lessons].sort((a, b) => a.order - b.order);
  let initialFocus: HTMLElement | undefined;
  if (props.resumeId) {
    const resume = sorted.find((l) => l.id === props.resumeId);
    if (resume) {
      const cta = button(LESSONS.resumeCta, () => props.onSelect(resume.id), { variant: 'primary', icon: 'play' });
      body.appendChild(el('div', { class: 'resume-bar' }, el('div', { class: 'resume-text' }, el('span', { class: 'muted', text: LESSONS.resume }), el('span', { class: 'resume-title', text: `${LESSONS.lesson(resume.order)} — ${resume.title}` })), cta));
      initialFocus = cta;
    }
  }
  if (sorted.length === 0) body.appendChild(el('p', { class: 'muted', text: LESSONS.empty }));
  const grid = el('div', { class: 'cards', attrs: { 'data-nav-group': '' } });
  for (const l of sorted) {
    const card = lessonCard(l, props.onSelect);
    grid.appendChild(card);
    if (!initialFocus && l.status === 'unlocked') initialFocus = card;
  }
  body.appendChild(grid);
  body.appendChild(footer(el('span'), button(COMMON.back, props.onBack, { variant: 'ghost', icon: 'chevronRight', kbd: 'Esc' })));
  return {
    el: root,
    kind: 'full',
    initialFocus,
    onKey: (e) => {
      if (e.key === 'Escape') {
        props.onBack();
        return true;
      }
      return false;
    },
  };
}
