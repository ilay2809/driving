import { button, el } from '../dom';
import { PAUSE } from '../strings.he';
import type { PauseMenuProps, ScreenHandle, ScreenHost } from '../types';
import { panel } from './common';

export function pauseMenuScreen(_host: ScreenHost, props: PauseMenuProps): ScreenHandle {
  const { el: root, body } = panel({ title: PAUSE.title, icon: 'pause', size: 'sm' });
  const resume = button(PAUSE.resume, props.onResume, { variant: 'primary', icon: 'play', kbd: 'Esc' });
  const list = el(
    'div',
    { class: 'pause-list', attrs: { 'data-nav-group': '' } },
    resume,
    button(PAUSE.restart, props.onRestart, { icon: 'replay' }),
    button(PAUSE.settings, props.onSettings, { icon: 'settings' }),
    props.onHelp ? button(PAUSE.help, props.onHelp, { icon: 'question', kbd: 'F1' }) : null,
    button(PAUSE.menu, props.onMenu, { variant: 'danger', icon: 'home' }),
  );
  body.appendChild(list);
  return { el: root, kind: 'modal', initialFocus: resume, onKey: (e) => (e.key === 'Escape' ? (props.onResume(), true) : false) };
}
