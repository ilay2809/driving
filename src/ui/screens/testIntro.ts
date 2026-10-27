import { button, el } from '../dom';
import { COMMON, TEST_INTRO } from '../strings.he';
import type { ScreenHandle, ScreenHost, TestIntroProps } from '../types';
import { field, footer, panel, section, select } from './common';

export function testIntroScreen(_host: ScreenHost, props: TestIntroProps): ScreenHandle {
  let routeId: string | 'random' = 'random';
  const { el: root, body } = panel({ title: TEST_INTRO.title, icon: 'examiner', size: 'lg', onClose: props.onBack, closeLabel: COMMON.back });
  body.appendChild(el('p', { class: 'prose', text: TEST_INTRO.intro }));
  const icons = ['list', 'car', 'warning'] as const;
  const grid = el('div', { class: 'intro-grid' });
  TEST_INTRO.sections.forEach((s, i) => {
    const ul = el('ul', { class: 'prose' });
    for (const b of s.bullets) ul.appendChild(el('li', { text: b }));
    grid.appendChild(section(s.title, icons[i] ?? 'info', ul));
  });
  body.appendChild(grid);
  const routeSel = select(
    [{ value: 'random', label: TEST_INTRO.randomRoute }, ...props.routes.map((r) => ({ value: r.id, label: r.name }))],
    'random',
    (v) => (routeId = v),
    TEST_INTRO.route,
  );
  body.appendChild(el('div', { class: 'form' }, field(TEST_INTRO.route, routeSel)));
  const start = button(TEST_INTRO.start, () => props.onStart({ routeId }), { variant: 'primary', icon: 'play', class: 'btn-lg' });
  body.appendChild(footer(button(TEST_INTRO.back, props.onBack, { variant: 'ghost', icon: 'chevronRight', kbd: 'Esc' }), start));
  return { el: root, kind: 'full', initialFocus: start, onKey: (e) => (e.key === 'Escape' ? (props.onBack(), true) : false) };
}
