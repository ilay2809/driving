import { describe, expect, it } from 'vitest';
import { DialogueManager } from './dialogue';
import { SilentTts, chunkSentences, estimateSpeechSeconds } from './tts';
import { LineTable, substitute } from './lines';
import { createTestContext, eventsNamed } from './testUtils';

function setup(opts: { tts?: boolean } = {}) {
  const t = createTestContext({ settings: { tts: opts.tts ?? true } });
  const backend = new SilentTts();
  const dm = new DialogueManager(t.bus, t.settings, { tts: backend, defaultLinger: 0 });
  const started = () => eventsNamed<{ id: string; text: string }>(t, 'coach:say');
  const ended = () => eventsNamed<{ id: string }>(t, 'coach:said');
  return { t, dm, backend, started, ended };
}

describe('DialogueManager', () => {
  it('plays one utterance at a time, FIFO for low priorities, and emits say/said with subtitle timing', () => {
    const { t, dm, started, ended } = setup();
    const a = dm.say({ who: 'instructor', text: 'שלום', priority: 1 });
    const b = dm.say({ who: 'instructor', text: 'נתחיל', priority: 0 });
    expect(started().map((e) => e.id)).toEqual([a]);
    const dur = estimateSpeechSeconds('שלום');
    t.advance(dur - 0.15, [dm]);
    expect(started().length).toBe(1);
    expect(ended().length).toBe(0);
    t.advance(0.3, [dm]);
    expect(ended().map((e) => e.id)).toEqual([a]);
    expect(started().map((e) => e.id)).toEqual([a, b]);
    t.advance(5, [dm]);
    expect(ended().map((e) => e.id)).toEqual([a, b]);
    expect(dm.speaking).toBe(false);
  });

  it('priority 2 jumps the queue and priority 3 interrupts the current utterance', () => {
    const { t, dm, started, ended } = setup();
    const a = dm.say({ who: 'instructor', text: 'משפט ראשון ארוך למדי', priority: 1 });
    const b = dm.say({ who: 'instructor', text: 'שני', priority: 0 });
    const c = dm.say({ who: 'instructor', text: 'שלישי', priority: 1 });
    const d = dm.say({ who: 'instructor', text: 'דחוף', priority: 2 });
    expect(dm.pending.map((q) => q.id)).toEqual([d, b, c]);
    t.step(0.1, [dm]);
    const e = dm.say({ who: 'instructor', text: 'אני בולם!', priority: 3 });
    // a was interrupted → said(a) then say(e)
    expect(ended().map((x) => x.id)).toEqual([a]);
    expect(started().map((x) => x.id)).toEqual([a, e]);
    t.advance(20, [dm]);
    expect(started().map((x) => x.id)).toEqual([a, e, d, b, c]);
  });

  it('drops repeats of the same key within the cooldown (and while one is pending)', () => {
    const { t, dm, started, ended } = setup();
    const a = dm.say({ who: 'instructor', text: 'מהר מדי', priority: 1, key: 'speed', cooldown: 10 });
    const b = dm.say({ who: 'instructor', text: 'מהר מדי שוב', priority: 1, key: 'speed', cooldown: 10 });
    expect(started().map((x) => x.id)).toEqual([a]);
    // the skipped one still gets a 'said' so callers can wait on it
    expect(ended().map((x) => x.id)).toEqual([b]);
    t.advance(8, [dm]);
    const c = dm.say({ who: 'instructor', text: 'מהר מדי', priority: 1, key: 'speed', cooldown: 10 });
    expect(started().map((x) => x.id)).toEqual([a]);
    expect(ended()).toContainEqual({ id: c });
    t.advance(3, [dm]);
    const d = dm.say({ who: 'instructor', text: 'מהר מדי', priority: 1, key: 'speed', cooldown: 10 });
    expect(started().map((x) => x.id)).toEqual([a, d]);
  });

  it('caps the queue at 4, dropping the oldest lowest-priority item', () => {
    const { t, dm, ended } = setup();
    dm.say({ who: 'instructor', text: 'נוכחי', priority: 1 });
    const q0 = dm.say({ who: 'instructor', text: 'א', priority: 0 });
    const q1 = dm.say({ who: 'instructor', text: 'ב', priority: 1 });
    const q2 = dm.say({ who: 'instructor', text: 'ג', priority: 0 });
    const q3 = dm.say({ who: 'instructor', text: 'ד', priority: 1 });
    expect(dm.pending.length).toBe(4);
    const q4 = dm.say({ who: 'instructor', text: 'ה', priority: 1 });
    expect(dm.pending.length).toBe(4);
    expect(dm.pending.map((q) => q.id)).toEqual([q1, q2, q3, q4]);
    expect(ended().map((x) => x.id)).toEqual([q0]);
    t.advance(30, [dm]);
    expect(dm.pending.length).toBe(0);
  });

  it('uses the silent backend when settings.tts is off and honours linger', () => {
    const { t, dm, backend, ended } = setup({ tts: false });
    expect(dm.backend).not.toBe(backend);
    const a = dm.say({ who: 'instructor', text: 'אב', priority: 1, linger: 1.0 });
    const dur = estimateSpeechSeconds('אב');
    t.advance(dur + 0.2, [dm]);
    expect(ended().length).toBe(0);
    t.advance(1.0, [dm]);
    expect(ended().map((x) => x.id)).toEqual([a]);
  });

  it('does not advance while paused and resumes afterwards', () => {
    const { t, dm, ended } = setup();
    const a = dm.say({ who: 'instructor', text: 'שלום לך', priority: 1 });
    t.ctx.paused = true;
    t.advance(10, [dm]);
    expect(ended().length).toBe(0);
    t.ctx.paused = false;
    t.advance(2, [dm]);
    expect(ended().map((x) => x.id)).toEqual([a]);
  });

  it('force-ends an utterance whose backend never reports the end', () => {
    const { t, ended } = setup();
    const stuck = { available: true, speak: () => {}, cancel: () => {} };
    const dm = new DialogueManager(t.bus, t.settings, { tts: stuck, defaultLinger: 0 });
    const a = dm.say({ who: 'instructor', text: 'תקוע', priority: 1 });
    t.advance(estimateSpeechSeconds('תקוע') * 2 + 3.2, [dm]);
    expect(ended().map((x) => x.id)).toEqual([a]);
  });

  it('cancelAll clears the queue and the current utterance', () => {
    const { t, dm, ended } = setup();
    const a = dm.say({ who: 'instructor', text: 'אחד', priority: 1 });
    const b = dm.say({ who: 'instructor', text: 'שתיים', priority: 1 });
    dm.cancelAll();
    expect(ended().map((x) => x.id).sort()).toEqual([a, b].sort());
    expect(dm.speaking).toBe(false);
    t.advance(1, [dm]);
    expect(dm.pending.length).toBe(0);
  });

  it('cancel(id) drops a pending utterance or cuts the playing one', () => {
    const { t, dm, started, ended } = setup();
    const a = dm.say({ who: 'instructor', text: 'משפט ארוך למדי שמתנגן עכשיו', priority: 1 });
    const b = dm.say({ who: 'instructor', text: 'ממתין', priority: 1 });
    const c = dm.say({ who: 'instructor', text: 'אחרון', priority: 1 });
    expect(dm.isActive(b)).toBe(true);
    expect(dm.cancel(b)).toBe(true);
    expect(dm.isActive(b)).toBe(false);
    expect(ended().map((x) => x.id)).toEqual([b]);
    expect(dm.cancel(a)).toBe(true); // playing → interrupted, next starts
    expect(started().map((x) => x.id)).toEqual([a, c]);
    expect(dm.cancel('nope')).toBe(false);
    t.advance(5, [dm]);
    expect(dm.speaking).toBe(false);
  });

  it('sayLine speaks table lines with the speaker from the table', () => {
    const { t, dm, started } = setup();
    dm.sayLine('examiner.greeting');
    expect(started()[0]!.text).toContain('אני הבוחן');
    expect(eventsNamed<{ who: string }>(t, 'coach:say')[0]!.who).toBe('examiner');
    expect(dm.sayLine('no.such.key')).toBeUndefined();
  });
});

describe('LineTable', () => {
  it('substitutes placeholders and picks variants deterministically per seed', () => {
    expect(substitute('בעוד {distance} מטר{streetPhrase}', { distance: 150, streetPhrase: ' לרחוב הדקל' })).toBe('בעוד 150 מטר לרחוב הדקל');
    const a = new LineTable(7);
    const b = new LineTable(7);
    const seqA = Array.from({ length: 8 }, () => a.line('praise.generic'));
    const seqB = Array.from({ length: 8 }, () => b.line('praise.generic'));
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBeGreaterThan(1);
    expect(a.line('no.such.key')).toBe('no.such.key');
    expect(a.who('examiner.greeting')).toBe('examiner');
  });

  it('overlays content lines and validates them', async () => {
    const t = new LineTable(1);
    const n = await t.load([{ key: 'greeting.free', who: 'instructor', variants: ['היי!'] }, { key: 'custom.key', who: 'system', variants: ['x'] }]);
    expect(n).toBe(2);
    expect(t.line('greeting.free')).toBe('היי!');
    expect(t.has('custom.key')).toBe(true);
    expect(await t.load({ not: 'valid' })).toBe(0);
  });
});

describe('tts helpers', () => {
  it('chunks long text at sentence boundaries', () => {
    const text = 'משפט ראשון. משפט שני! משפט שלישי? ' + 'מ'.repeat(170) + '. סוף.';
    const chunks = chunkSentences(text, 160);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.join(' ')).toBe(text.replace(/\s+/g, ' ').trim());
    expect(chunkSentences('קצר')).toEqual(['קצר']);
  });
});
