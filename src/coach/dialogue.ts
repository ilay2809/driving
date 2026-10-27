/**
 * DialogueManager — the single mouth of the coach layer.
 *
 * Everything the instructor / examiner / navigator / lesson runner says goes through
 * `say()`. One utterance plays at a time; the manager handles priorities, per-key
 * cooldowns, interrupts, the queue cap and subtitle timing, and tells the UI what is
 * being said through the EventBus:
 *
 *   'coach:say'  { ...SpeechRequest }  — an utterance STARTED (show the subtitle)
 *   'coach:said' { id }                — it ended, was skipped or interrupted (hide it)
 *
 * Priorities: 3 interrupts the current utterance (TTS cancelled), 2 jumps the queue,
 * 0–1 are FIFO. Timing uses the simulation clock (pauses with the sim); the TTS end
 * callback (wall clock) only marks the utterance as finished, the manager then waits
 * `linger` sim-seconds before 'coach:said' and the next utterance.
 */
import type { EventBus, SpeechRequest, Speaker } from '@/core/events';
import type { Settings, SimContext, System } from '@/core/sim';
import { LineTable, type LineParams } from './lines';
import { SilentTts, WebSpeechTts, estimateSpeechSeconds, type TtsBackend } from './tts';

export interface DialogueOptions {
  /** Audio backend (default: WebSpeechTts when the browser has speechSynthesis). */
  tts?: TtsBackend;
  /** Seed for variant selection. */
  seed?: number;
  lang?: string;
  /** Default extra seconds a subtitle stays visible after speech ends. */
  defaultLinger?: number;
  /** Maximum pending utterances (oldest low-priority ones are dropped beyond it). */
  maxQueue?: number;
}

interface Current {
  req: SpeechRequest;
  startedAt: number;
  /** Sim time after which the utterance is force-ended if the backend never reports. */
  deadline: number;
  backend: TtsBackend;
  /** Sim time at which 'coach:said' is emitted (set when the backend reports the end). */
  lingerUntil?: number;
}

export class DialogueManager implements System {
  readonly name = 'dialogue';
  readonly lines: LineTable;
  private readonly queue: SpeechRequest[] = [];
  private current?: Current;
  private readonly lastKeyTime = new Map<string, number>();
  private time = 0;
  private paused = false;
  private lastVolume = -1;
  private seq = 0;
  private readonly silent = new SilentTts();
  private readonly external?: TtsBackend;
  private readonly lang: string;
  private readonly defaultLinger: number;
  private readonly maxQueue: number;
  /** Utterances spoken so far (id → text), for the dev harness / debugging. Bounded. */
  readonly history: { id: string; who: Speaker; text: string; time: number }[] = [];

  constructor(
    private readonly bus: EventBus,
    private readonly settings: Settings,
    opts: DialogueOptions = {},
  ) {
    this.lines = new LineTable(opts.seed ?? 1);
    this.external = opts.tts ?? (typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis ? new WebSpeechTts() : undefined);
    this.lang = opts.lang ?? 'he-IL';
    this.defaultLinger = opts.defaultLinger ?? 0.4;
    this.maxQueue = opts.maxQueue ?? 4;
  }

  /** Backend that will play the next utterance (depends on settings.tts and availability). */
  get backend(): TtsBackend {
    return this.settings.tts && this.external?.available ? this.external : this.silent;
  }

  get speaking(): boolean {
    return this.current !== undefined;
  }
  get currentRequest(): SpeechRequest | undefined {
    return this.current?.req;
  }
  get pending(): readonly SpeechRequest[] {
    return this.queue;
  }
  get now(): number {
    return this.time;
  }

  /** Queue (or play) an utterance. Returns its id; 'coach:said' is emitted for it even if skipped. */
  say(input: Omit<SpeechRequest, 'id'>): string {
    const id = `say${++this.seq}`;
    const req: SpeechRequest = { ...input, id, text: input.text.trim() };
    if (!req.text) {
      this.bus.emit('coach:said', { id });
      return id;
    }
    if (req.key) {
      const last = this.lastKeyTime.get(req.key);
      const cooldown = req.cooldown ?? 0;
      const pendingSameKey = this.queue.some((q) => q.key === req.key) || this.current?.req.key === req.key;
      if (pendingSameKey || (last !== undefined && this.time - last < cooldown)) {
        this.bus.emit('coach:said', { id });
        return id;
      }
      this.lastKeyTime.set(req.key, this.time);
    }
    if (req.priority >= 3 && this.current && this.current.req.priority < 3) {
      this.interruptCurrent();
      if (this.paused) this.enqueue(req);
      else this.start(req);
      return id;
    }
    if (!this.current && !this.paused) {
      this.start(req);
      return id;
    }
    this.enqueue(req);
    return id;
  }

  /** Convenience: speak a line from the table (who/text from the table unless overridden). */
  sayLine(key: string, params?: LineParams, overrides: Partial<Omit<SpeechRequest, 'id' | 'text'>> = {}): string | undefined {
    const got = this.lines.get(key, params);
    if (!got) {
      console.warn(`[coach] missing dialogue line: ${key}`);
      return undefined;
    }
    return this.say({ who: overrides.who ?? got.who, text: got.text, priority: overrides.priority ?? 1, key: overrides.key, cooldown: overrides.cooldown, linger: overrides.linger });
  }

  /** Drop one utterance (pending or playing). Returns false when it is not known. */
  cancel(id: string): boolean {
    const i = this.queue.findIndex((q) => q.id === id);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.bus.emit('coach:said', { id });
      return true;
    }
    if (this.current?.req.id === id) {
      this.interruptCurrent();
      if (!this.paused) this.startNext();
      return true;
    }
    return false;
  }

  /** True while the utterance is pending or playing. */
  isActive(id: string): boolean {
    return this.current?.req.id === id || this.queue.some((q) => q.id === id);
  }

  /** Stop the current utterance and drop the queue (mode change, reset). */
  cancelAll(): void {
    for (const q of this.queue.splice(0)) this.bus.emit('coach:said', { id: q.id });
    this.interruptCurrent();
  }

  /** Forget key cooldowns (e.g. a new lesson starts). */
  resetCooldowns(): void {
    this.lastKeyTime.clear();
  }

  update(ctx: SimContext): void {
    this.time = ctx.time;
    if (ctx.paused !== this.paused) {
      this.paused = ctx.paused;
      this.current?.backend.setPaused?.(this.paused);
    }
    if (ctx.settings.volume !== this.lastVolume) {
      this.lastVolume = ctx.settings.volume;
      this.external?.setVolume?.(this.lastVolume);
    }
    if (this.paused) return;
    const cur = this.current;
    if (cur) {
      cur.backend.tick?.(ctx.dt);
      if (this.current !== cur) return; // tick ended it and the next one started
      if (cur.lingerUntil === undefined && this.time >= cur.deadline) {
        // backend never reported the end — move on
        cur.backend.cancel();
        this.onEnded(cur);
      }
      if (cur.lingerUntil !== undefined && this.time >= cur.lingerUntil) this.finish(cur);
    }
    if (!this.current) this.startNext();
  }

  dispose(): void {
    this.cancelAll();
  }

  // ---- internals ----------------------------------------------------------------------

  private enqueue(req: SpeechRequest): void {
    if (req.priority >= 3) this.queue.unshift(req);
    else if (req.priority === 2) {
      const i = this.queue.findIndex((q) => q.priority < 2);
      if (i < 0) this.queue.push(req);
      else this.queue.splice(i, 0, req);
    } else this.queue.push(req);
    while (this.queue.length > this.maxQueue) {
      const minP = Math.min(...this.queue.map((q) => q.priority));
      const i = this.queue.findIndex((q) => q.priority === minP);
      const [dropped] = this.queue.splice(i, 1);
      if (dropped) this.bus.emit('coach:said', { id: dropped.id });
    }
  }

  private startNext(): void {
    const next = this.queue.shift();
    if (next) this.start(next);
  }

  private start(req: SpeechRequest): void {
    const backend = this.backend;
    const estimate = estimateSpeechSeconds(req.text);
    const cur: Current = { req, startedAt: this.time, deadline: this.time + estimate * 2 + 3, backend };
    this.current = cur;
    if (req.key) this.lastKeyTime.set(req.key, this.time);
    this.history.push({ id: req.id, who: req.who, text: req.text, time: this.time });
    if (this.history.length > 50) this.history.shift();
    this.bus.emit('coach:say', req);
    backend.speak(
      req.text,
      this.lang,
      () => this.onEnded(cur),
      (err) => {
        console.warn('[coach] tts error, falling back to subtitles only', err);
        if (this.current !== cur) return;
        // keep the subtitle up for the estimated reading time
        const remaining = Math.max(0, estimate - (this.time - cur.startedAt));
        cur.lingerUntil = this.time + remaining + (cur.req.linger ?? this.defaultLinger);
      },
    );
  }

  private onEnded(cur: Current): void {
    if (this.current !== cur || cur.lingerUntil !== undefined) return;
    cur.lingerUntil = this.time + (cur.req.linger ?? this.defaultLinger);
    if (this.time >= cur.lingerUntil) this.finish(cur);
  }

  private finish(cur: Current): void {
    if (this.current !== cur) return;
    this.current = undefined;
    this.bus.emit('coach:said', { id: cur.req.id });
    this.startNext();
  }

  private interruptCurrent(): void {
    const cur = this.current;
    if (!cur) return;
    this.current = undefined;
    cur.backend.cancel();
    this.bus.emit('coach:said', { id: cur.req.id });
  }
}
