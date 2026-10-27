import { button, el, kbd } from '../dom';
import { HELP } from '../strings.he';
import type { HelpProps, ScreenHandle, ScreenHost } from '../types';
import { footer, panel, section } from './common';

export function helpScreen(_host: ScreenHost, props: HelpProps): ScreenHandle {
  const close = () => props.onClose?.();
  const { el: root, body } = panel({ title: HELP.title, icon: 'question', size: 'lg', onClose: close });
  const keymap = props.keymap ?? HELP.defaultKeymap;
  const table = el('table', { class: 'table' });
  table.appendChild(el('thead', {}, el('tr', {}, el('th', { text: HELP.colKeys }), el('th', { text: HELP.colAction }))));
  const tbody = el('tbody');
  for (const k of keymap) {
    const keys = el('td', { class: 'keys' });
    k.keys.forEach((key, i) => {
      if (i > 0) keys.appendChild(el('span', { class: 'muted', text: ' / ' }));
      keys.appendChild(kbd(key));
    });
    tbody.appendChild(el('tr', {}, keys, el('td', { text: k.action })));
  }
  table.appendChild(tbody);
  const notes = (items: string[]) => {
    const ul = el('ul');
    for (const n of items) ul.appendChild(el('li', { text: n }));
    return ul;
  };
  body.appendChild(el('div', { class: 'help-cols' }, section(HELP.keyboard, 'keyboard', table), el('div', { class: 'help-notes' }, section(HELP.gamepad, 'gamepad', notes(props.gamepadNotes ?? HELP.defaultGamepadNotes)), section(HELP.wheel, 'wheel', notes(props.wheelNotes ?? HELP.defaultWheelNotes)))));
  const closeBtn = button(HELP.close, close, { variant: 'primary', icon: 'check' });
  body.appendChild(footer(el('span'), closeBtn));
  return { el: root, kind: 'modal', initialFocus: closeBtn, onKey: (e) => (e.key === 'Escape' || e.key === 'F1' ? (close(), true) : false) };
}
