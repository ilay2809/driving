import { button, el } from '../dom';
import { icon } from '../icons';
import { iconForViolation } from '../lawMonitor';
import { DEBRIEF } from '../strings.he';
import type { LessonDebriefProps, ScreenHandle, ScreenHost } from '../types';
import { footer, panel, scoreRing, section } from './common';

export function lessonDebriefScreen(_host: ScreenHost, props: LessonDebriefProps): ScreenHandle {
  const { el: root, body } = panel({ title: DEBRIEF.title, icon: 'flag', subtitle: props.lessonTitle, size: 'md' });
  const verdict = el('div', { class: `debrief-verdict ${props.passed ? 'pass' : 'fail'}` }, icon(props.passed ? 'check' : 'warning', { size: 26 }), el('span', { text: props.passed ? DEBRIEF.passed : DEBRIEF.failed }));
  const counts = el(
    'div',
    { class: 'sev-counts' },
    el('div', { class: 'sev-count minor' }, el('b', { class: 'num', text: String(props.counts.minor) }), el('span', { text: DEBRIEF.minor })),
    el('div', { class: 'sev-count major' }, el('b', { class: 'num', text: String(props.counts.major) }), el('span', { text: DEBRIEF.major })),
    el('div', { class: 'sev-count critical' }, el('b', { class: 'num', text: String(props.counts.critical) }), el('span', { text: DEBRIEF.critical })),
  );
  body.appendChild(el('div', { class: 'debrief-top' }, scoreRing(props.score, { pass: props.passed, label: DEBRIEF.score }), el('div', {}, verdict, props.summary ? el('p', { class: 'muted', text: props.summary, style: { marginTop: '6px' } }) : null, counts)));

  const list = el('div', { class: 'error-list' });
  if (props.errors.length === 0) list.appendChild(el('p', { class: 'ok', text: DEBRIEF.noErrors }));
  for (const err of props.errors.slice(0, 6)) {
    list.appendChild(
      el(
        'div',
        { class: `error-item sev-${err.severity}` },
        icon(iconForViolation(err.type, err.severity), { size: 20 }),
        el('div', {}, el('div', { class: 'error-label', text: err.label }), el('div', { class: 'error-advice', text: err.advice })),
        el('span', { class: 'error-count num', text: err.count > 1 ? DEBRIEF.times(err.count) : '' }),
      ),
    );
  }
  body.appendChild(section(DEBRIEF.errorsTitle, 'list', list));

  const again = button(DEBRIEF.again, props.onAgain, { variant: props.passed ? 'default' : 'primary', icon: 'replay' });
  const next = props.onNext ? button(DEBRIEF.next, props.onNext, { variant: 'primary', icon: 'chevronLeft' }) : null;
  const menu = button(DEBRIEF.menu, props.onMenu, { variant: 'ghost', icon: 'home' });
  body.appendChild(footer(menu, el('div', { class: 'btn-row' }, again, next)));
  return { el: root, kind: 'full', initialFocus: props.passed && next ? next : again, onKey: (e) => (e.key === 'Escape' ? (props.onMenu(), true) : false) };
}
