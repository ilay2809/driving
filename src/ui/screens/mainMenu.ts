import { el } from '../dom';
import { icon, type IconName } from '../icons';
import { MENU } from '../strings.he';
import type { MainMenuProps, MenuItemId, ScreenHandle, ScreenHost } from '../types';

const ITEMS: { id: MenuItemId; icon: IconName }[] = [
  { id: 'lessons', icon: 'school' },
  { id: 'free', icon: 'car' },
  { id: 'test', icon: 'examiner' },
  { id: 'theory', icon: 'book' },
  { id: 'training', icon: 'map' },
  { id: 'settings', icon: 'settings' },
];

export function mainMenuScreen(_host: ScreenHost, props: MainMenuProps): ScreenHandle {
  const cards = el('div', { class: 'cards', attrs: { 'data-nav-group': '', role: 'menu' } });
  let first: HTMLElement | undefined;
  for (const item of ITEMS) {
    const copy = MENU.items[item.id];
    const card = el(
      'button',
      { class: 'card', attrs: { type: 'button', role: 'menuitem' }, dataset: { item: item.id }, on: { click: () => props.onSelect(item.id) } },
      el('span', { class: 'card-icon' }, icon(item.icon, { size: 26 })),
      el('span', { class: 'card-body' }, el('span', { class: 'card-title', text: copy.title }), el('span', { class: 'card-text', text: copy.text })),
    );
    first ??= card;
    cards.appendChild(card);
  }
  const root = el(
    'div',
    { class: 'screen screen-lg main-menu', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': MENU.title, tabindex: '-1' } },
    el('div', { class: 'menu-hero' }, el('div', { class: 'menu-logo' }, icon('car', { size: 38 })), el('h1', { text: MENU.title }), el('p', { text: MENU.subtitle })),
    cards,
    el('div', { class: 'menu-foot' }, el('span', { text: props.progressText ?? '' }), el('span', { text: MENU.footer }), el('span', { text: props.version ? MENU.version(props.version) : '' })),
  );
  return { el: root, kind: 'full', initialFocus: first };
}
