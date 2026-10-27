// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { focusFirst, rovingArrows, trapTab } from './focus';

function keyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

describe('focus helpers', () => {
  let root: HTMLElement;
  let buttons: HTMLButtonElement[];
  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    root.innerHTML = '<button class="screen-close">x</button><div data-nav-group><button id="a">a</button><button id="b">b</button><button id="c">c</button></div>';
    document.body.appendChild(root);
    buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-nav-group] button'));
  });

  it('focuses the first real control, not the header close button', () => {
    focusFirst(root);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('moves focus with arrows inside a nav group (DOM order fallback without layout)', () => {
    buttons[0]!.focus();
    expect(rovingArrows(keyEvent('ArrowDown'))).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
    expect(rovingArrows(keyEvent('ArrowLeft'))).toBe(true);
    expect(document.activeElement).toBe(buttons[2]);
    expect(rovingArrows(keyEvent('ArrowDown'))).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    expect(rovingArrows(keyEvent('ArrowUp'))).toBe(true);
    expect(document.activeElement).toBe(buttons[2]);
    expect(rovingArrows(keyEvent('Enter'))).toBe(false);
  });

  it('traps Tab inside the container', () => {
    buttons[2]!.focus();
    const e = keyEvent('Tab');
    expect(trapTab(root, e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('.screen-close'));
    root.querySelector<HTMLElement>('.screen-close')!.focus();
    expect(trapTab(root, keyEvent('Tab'))).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    expect(trapTab(root, new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }))).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('.screen-close'));
  });
});
