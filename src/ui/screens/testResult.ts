import { VIOLATIONS } from '@/rules/violations';
import { button, el } from '../dom';
import { formatClock, formatDateHe, formatDuration } from '../format';
import { COMMON, MANEUVER, SEVERITY_LABEL, TEST_RESULT } from '../strings.he';
import type { ScreenHandle, ScreenHost, TestResultProps } from '../types';
import { footer, panel, section } from './common';

export function testResultScreen(_host: ScreenHost, props: TestResultProps): ScreenHandle {
  const { el: root, body } = panel({ title: TEST_RESULT.title, icon: 'examiner', size: 'lg', className: 'test-result' });
  const { date, time } = formatDateHe(props.date);
  const maxPoints = props.maxPoints ?? 12;

  const stamp = el('div', { class: `stamp ${props.passed ? 'pass' : 'fail'}`, attrs: { role: 'img', 'aria-label': props.passed ? TEST_RESULT.passed : TEST_RESULT.failed }, text: props.passed ? TEST_RESULT.passed : TEST_RESULT.failed });
  const meta = el('dl', { class: 'sheet-meta' });
  const metaItem = (k: string, v: string, cls = '') => meta.appendChild(el('div', {}, el('dt', { text: k }), el('dd', { class: cls, text: v })));
  metaItem(TEST_RESULT.date, date, 'num');
  metaItem(TEST_RESULT.time, time, 'num');
  metaItem(TEST_RESULT.route, props.routeName);
  metaItem(TEST_RESULT.duration, formatDuration(props.durationSec));
  metaItem(TEST_RESULT.points, TEST_RESULT.pointsOf(props.points, maxPoints), `num ${props.points > maxPoints ? 'danger' : ''}`);
  if (props.examinerName) metaItem(TEST_RESULT.examiner, props.examinerName);

  const violationsTable = el('table', { class: 'table' });
  violationsTable.appendChild(el('thead', {}, el('tr', {}, el('th', { text: TEST_RESULT.colTime }), el('th', { text: TEST_RESULT.colPlace }), el('th', { text: TEST_RESULT.colLabel }), el('th', { text: TEST_RESULT.colSeverity }))));
  const tbody = el('tbody');
  for (const v of props.violations) {
    const info = VIOLATIONS[v.type as keyof typeof VIOLATIONS];
    const sev = v.severity ?? info?.severity ?? 'minor';
    tbody.appendChild(
      el('tr', {}, el('td', { class: 'num', text: formatClock(v.time) }), el('td', { text: v.place ?? v.context ?? COMMON.none }), el('td', { text: info?.label ?? String(v.type) }), el('td', {}, el('span', { class: `sev-text ${sev}`, text: SEVERITY_LABEL[sev] ?? sev }))),
    );
  }
  violationsTable.appendChild(tbody);
  const violationsBlock = props.violations.length > 0 ? violationsTable : el('p', { class: 'muted', text: TEST_RESULT.noViolations });

  const manTable = el('table', { class: 'table' });
  manTable.appendChild(el('thead', {}, el('tr', {}, el('th', { text: TEST_RESULT.colManeuver }), el('th', { text: TEST_RESULT.colStatus }))));
  const mbody = el('tbody');
  for (const m of props.maneuvers) {
    mbody.appendChild(el('tr', {}, el('td', { text: m.label ?? MANEUVER[m.kind] ?? m.kind }), el('td', {}, el('span', { class: `status-text ${m.status}`, text: TEST_RESULT.maneuverStatus[m.status] ?? m.status }))));
  }
  manTable.appendChild(mbody);
  const manBlock = props.maneuvers.length > 0 ? manTable : el('p', { class: 'muted', text: TEST_RESULT.noManeuvers });

  const sheet = el(
    'div',
    { class: 'sheet' },
    el('div', { class: 'sheet-head' }, el('div', {}, el('div', { class: 'sheet-title', text: TEST_RESULT.title }), el('div', { class: 'sheet-authority', text: TEST_RESULT.authority })), stamp),
    meta,
    el('div', { class: 'sheet-cols' }, section(TEST_RESULT.violations, 'warning', violationsBlock), section(TEST_RESULT.maneuvers, 'car', manBlock)),
    section(TEST_RESULT.summary, 'examiner', el('div', { class: 'sheet-summary', text: props.summary })),
    el('div', { class: 'sheet-note', text: TEST_RESULT.note }),
  );
  body.appendChild(sheet);

  const newTest = button(TEST_RESULT.newTest, props.onNewTest, { variant: 'primary', icon: 'replay' });
  const replay = props.onReplay ? button(TEST_RESULT.replay, props.onReplay, { icon: 'play' }) : null;
  body.appendChild(footer(button(TEST_RESULT.menu, props.onMenu, { variant: 'ghost', icon: 'home', kbd: 'Esc' }), el('div', { class: 'btn-row' }, replay, newTest)));
  return { el: root, kind: 'full', initialFocus: newTest, onKey: (e) => (e.key === 'Escape' ? (props.onMenu(), true) : false) };
}
