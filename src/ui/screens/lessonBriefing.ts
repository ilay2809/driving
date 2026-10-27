import { renderDiagram } from '../diagrams';
import { button, el, setText } from '../dom';
import { renderMarkdown } from '../markdown';
import { signImage } from '../signImage';
import { BRIEFING, COMMON } from '../strings.he';
import type { LessonBriefingProps, ScreenHandle, ScreenHost } from '../types';
import { footer, panel } from './common';

export function lessonBriefingScreen(host: ScreenHost, props: LessonBriefingProps): ScreenHandle {
  const slides = props.slides.length > 0 ? props.slides : [{ title: props.title, text: '', signs: [] as string[] }];
  let index = 0;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    host.bus.emit('ui:acknowledged', { context: 'briefing' });
    props.onStart?.();
    host.close();
  };

  const textEl = el('div', { class: 'briefing-text prose' });
  const asideEl = el('div', { class: 'briefing-aside' });
  const dots = el('div', { class: 'dots', attrs: { 'aria-hidden': 'true' } });
  const counter = el('span', { class: 'muted num' });
  const prevBtn = button(COMMON.prev, () => go(index - 1), { variant: 'ghost', icon: 'chevronRight' });
  const nextBtn = button(COMMON.next, () => go(index + 1), { variant: 'default', icon: 'chevronLeft' });
  const startBtn = button(BRIEFING.start, finish, { variant: 'primary', icon: 'play', kbd: 'Enter' });

  function render(): void {
    const s = slides[index]!;
    textEl.innerHTML = '';
    textEl.appendChild(el('h2', { text: s.title }));
    textEl.appendChild(renderMarkdown(s.text));
    asideEl.innerHTML = '';
    if (s.signs.length > 0) {
      const row = el('div', { class: 'sign-row' });
      for (const code of s.signs) row.appendChild(el('figure', {}, signImage(code, { size: 84 }), el('figcaption', { text: code })));
      asideEl.appendChild(el('div', { class: 'aside-label', text: BRIEFING.signsLabel }));
      asideEl.appendChild(row);
    }
    if (s.diagram) {
      const svg = renderDiagram(s.diagram);
      if (svg) asideEl.appendChild(el('div', { class: 'diagram' }, svg));
    }
    asideEl.hidden = asideEl.children.length === 0;
    dots.innerHTML = '';
    slides.forEach((_, i) => dots.appendChild(el('i', { class: i === index ? 'on' : '' })));
    setText(counter, BRIEFING.slide(index + 1, slides.length));
    prevBtn.disabled = index === 0;
    const last = index === slides.length - 1;
    nextBtn.hidden = last;
    startBtn.hidden = !last;
    if (last) startBtn.focus();
    else nextBtn.focus();
  }

  function go(i: number): void {
    index = Math.min(slides.length - 1, Math.max(0, i));
    render();
  }

  const { el: root, body } = panel({ title: props.title, icon: 'book', subtitle: BRIEFING.title, size: 'lg', className: 'briefing' });
  body.appendChild(el('div', { class: 'briefing-body' }, textEl, asideEl));
  body.appendChild(footer(el('div', { class: 'btn-row' }, prevBtn, dots, counter), el('div', { class: 'btn-row' }, nextBtn, startBtn)));
  render();

  return {
    el: root,
    kind: 'full',
    initialFocus: slides.length === 1 ? startBtn : nextBtn,
    onKey: (e) => {
      if (e.key === 'Escape') {
        finish();
        return true;
      }
      if (e.key === 'ArrowLeft') {
        if (index < slides.length - 1) go(index + 1);
        return true;
      }
      if (e.key === 'ArrowRight') {
        go(index - 1);
        return true;
      }
      if (e.key === 'Enter' && index === slides.length - 1 && document.activeElement === root) {
        finish();
        return true;
      }
      return false;
    },
  };
}
