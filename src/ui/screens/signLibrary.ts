import type { SignDef } from '@/content/schema';
import { button, el } from '../dom';
import { signImage } from '../signImage';
import { COMMON, SIGNS } from '../strings.he';
import type { ScreenHandle, ScreenHost, SignLibraryProps } from '../types';
import { badge, panel } from './common';

const CATEGORY_ORDER = ['warning', 'mandatory', 'priority', 'prohibition', 'public_transport', 'information', 'signals', 'markings', 'work_zone'];

export function filterSigns(signs: SignDef[], category: string, query: string): SignDef[] {
  const q = query.trim().toLowerCase();
  return signs.filter((s) => (category === 'all' || s.category === category) && (!q || s.code.includes(q) || s.name.toLowerCase().includes(q) || s.meaning.toLowerCase().includes(q)));
}

export function signLibraryScreen(_host: ScreenHost, props: SignLibraryProps): ScreenHandle {
  let category = 'all';
  let query = '';
  let selected: string | undefined = props.selected;
  const { el: root, body } = panel({ title: SIGNS.title, icon: 'stop', size: 'xl', onClose: props.onClose });

  const categories = CATEGORY_ORDER.filter((c) => props.signs.some((s) => s.category === c));
  const chips = el('div', { class: 'filter-row', attrs: { role: 'group', 'data-nav-group': '' } });
  const chipButtons: HTMLButtonElement[] = [];
  const mkChip = (value: string, label: string) => {
    const b = el('button', { class: 'filter-chip', attrs: { type: 'button', 'aria-pressed': String(value === category) }, dataset: { value }, text: label, on: { click: () => setCategory(value) } });
    chipButtons.push(b);
    return b;
  };
  chips.appendChild(mkChip('all', SIGNS.all));
  for (const c of categories) chips.appendChild(mkChip(c, SIGNS.categories[c] ?? c));
  const search = el('input', { class: 'search-input', attrs: { type: 'search', placeholder: SIGNS.search, 'aria-label': SIGNS.search }, style: { maxWidth: '280px' } });
  search.addEventListener('input', () => {
    query = search.value;
    renderGrid();
  });
  const countEl = el('span', { class: 'muted num' });
  body.appendChild(el('div', { class: 'filter-row' }, search, chips, countEl));

  const grid = el('div', { class: 'sign-grid', attrs: { 'data-nav-group': '', role: 'listbox', 'aria-label': SIGNS.title } });
  const detail = el('div', { class: 'sign-detail' });
  body.appendChild(el('div', { class: 'sign-layout' }, grid, detail));

  function setCategory(v: string): void {
    category = v;
    for (const b of chipButtons) b.setAttribute('aria-pressed', String(b.dataset.value === v));
    renderGrid();
  }

  function renderGrid(): void {
    grid.innerHTML = '';
    const list = filterSigns(props.signs, category, query);
    countEl.textContent = SIGNS.count(list.length);
    if (list.length === 0) grid.appendChild(el('p', { class: 'muted', text: SIGNS.empty }));
    for (const s of list) {
      const card = el(
        'button',
        { class: 'sign-card', attrs: { type: 'button', role: 'option', 'aria-selected': String(s.code === selected), 'aria-pressed': String(s.code === selected) }, dataset: { code: s.code }, on: { click: () => select(s.code) } },
        signImage(s.code, { svgName: s.svg, alt: s.name }),
        el('span', { class: 'sign-name', text: s.name }),
        el('span', { class: 'sign-code num', text: s.code }),
      );
      grid.appendChild(card);
    }
  }

  function select(code: string): void {
    selected = code;
    for (const b of grid.querySelectorAll<HTMLButtonElement>('.sign-card')) {
      const on = b.dataset.code === code;
      b.setAttribute('aria-selected', String(on));
      b.setAttribute('aria-pressed', String(on));
    }
    renderDetail();
  }

  function renderDetail(): void {
    detail.innerHTML = '';
    const s = props.signs.find((x) => x.code === selected);
    if (!s) {
      detail.appendChild(el('p', { class: 'muted', text: SIGNS.pick }));
      return;
    }
    detail.appendChild(signImage(s.code, { svgName: s.svg, alt: s.name, size: 120 }));
    detail.appendChild(el('h3', { text: s.name }));
    detail.appendChild(el('div', { class: 'topics' }, badge(SIGNS.code(s.code), 'accent'), badge(SIGNS.categories[s.category] ?? s.category)));
    detail.appendChild(el('dl', {}, el('dt', { text: SIGNS.meaning }), el('dd', { text: s.meaning }), el('dt', { text: SIGNS.action }), el('dd', { text: s.action })));
  }

  renderGrid();
  renderDetail();
  body.appendChild(el('div', { class: 'screen-foot' }, el('span'), button(COMMON.close, props.onClose, { variant: 'ghost', icon: 'close', kbd: 'Esc' })));
  return { el: root, kind: 'full', initialFocus: search, onKey: (e) => (e.key === 'Escape' ? (props.onClose(), true) : false) };
}
