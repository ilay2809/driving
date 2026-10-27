// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechRequest } from '@/core/events';
import { DEFAULT_LINGER_S, Subtitles } from './subtitles';

const req = (id: string, text = 'שלום', priority: SpeechRequest['priority'] = 1, who: SpeechRequest['who'] = 'instructor'): SpeechRequest => ({ id, who, text, priority });

describe('Subtitles', () => {
  let s: Subtitles;
  beforeEach(() => {
    vi.useFakeTimers();
    s = new Subtitles();
    document.body.appendChild(s.el);
  });
  afterEach(() => {
    s.dispose();
    vi.useRealTimers();
  });

  it('shows the speaker and text on coach:say and hides after coach:said + linger', () => {
    s.say(req('a', 'בצומת הבא פנה ימינה'));
    expect(s.visible).toBe(true);
    const bar = s.el.querySelector('.subtitle-bar')!;
    expect(bar.querySelector('.subtitle-text')!.textContent).toBe('בצומת הבא פנה ימינה');
    expect(bar.querySelector('.subtitle-speaker')!.textContent).toBe('מורה נהיגה');
    s.said('a');
    expect(s.visible).toBe(true);
    vi.advanceTimersByTime(DEFAULT_LINGER_S * 1000 + 50);
    expect(bar.classList.contains('leaving')).toBe(true);
    vi.advanceTimersByTime(400);
    expect(s.visible).toBe(false);
    expect(s.current).toBeNull();
  });

  it('marks priority 3 and examiner speech', () => {
    s.say(req('x', 'עצור!', 3, 'examiner'));
    const bar = s.el.querySelector('.subtitle-bar')!;
    expect(bar.classList.contains('priority-3')).toBe(true);
    expect(bar.classList.contains('who-examiner')).toBe(true);
    expect(bar.querySelector('.subtitle-speaker')!.textContent).toBe('בוחן');
  });

  it('falls back to an earlier pending line when the later one finishes', () => {
    s.say(req('a', 'ראשון'));
    s.say(req('b', 'שני'));
    expect(s.current?.id).toBe('b');
    s.said('b');
    vi.advanceTimersByTime(DEFAULT_LINGER_S * 1000 + 50);
    expect(s.current?.id).toBe('a');
    expect(s.visible).toBe(true);
    s.said('a');
    vi.advanceTimersByTime(DEFAULT_LINGER_S * 1000 + 400);
    expect(s.visible).toBe(false);
  });

  it('ignores a request that was already reported as said (dropped synchronously)', () => {
    s.said('dropped');
    s.say(req('dropped'));
    expect(s.visible).toBe(false);
  });

  it('respects the subtitles setting and shows the idle prompt only when idle', () => {
    s.setIdlePrompt(true);
    const prompt = s.el.querySelector('.hint-prompt') as HTMLElement;
    expect(prompt.hidden).toBe(false);
    s.say(req('a'));
    expect(prompt.hidden).toBe(true);
    s.setEnabled(false);
    expect(s.visible).toBe(false);
    s.setEnabled(true);
    expect(s.visible).toBe(true);
  });

  it('stacks lesson hints above the bar and removes them after their duration', () => {
    s.hint('בדוק מראות', 'mirror', 2);
    expect(s.el.querySelectorAll('.hint')).toHaveLength(1);
    expect(s.el.querySelector('.hint .icon-mirror')).not.toBeNull();
    vi.advanceTimersByTime(2_400);
    expect(s.el.querySelectorAll('.hint')).toHaveLength(0);
  });
});
