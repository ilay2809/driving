/**
 * Text-to-speech backends for the DialogueManager.
 *
 *  - WebSpeechTts: the browser's speechSynthesis with a Hebrew voice (handles Chrome's
 *    asynchronous voice list, chunks long texts at sentence boundaries, watchdog for
 *    missing `onend` callbacks).
 *  - SilentTts: no audio; "speaks" for the estimated duration of the text, advanced by
 *    `tick(dt)` from the simulation clock (deterministic — used in tests and when
 *    settings.tts is off / no voice is available).
 */

export interface TtsBackend {
  readonly available: boolean;
  speak(text: string, lang: string, onEnd: () => void, onError: (err: unknown) => void): void;
  cancel(): void;
  /** Optional: advance an internal clock by `dt` simulation seconds (SilentTts). */
  tick?(dt: number): void;
  /** Optional: pause / resume playback (the sim is paused). */
  setPaused?(paused: boolean): void;
  /** Optional: master volume 0..1. */
  setVolume?(volume: number): void;
}

/** Reading-time estimate used for subtitles when there is no audio: 0.065 s/char + 0.4 s. */
export function estimateSpeechSeconds(text: string): number {
  return 0.065 * text.length + 0.4;
}

/** Split text into chunks at sentence boundaries, each at most ~`maxLen` chars. */
export function chunkSentences(text: string, maxLen = 160): string[] {
  const parts = text
    .split(/(?<=[.!?؟…])\s+/u)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + ' ' + p).length > maxLen) {
      out.push(cur);
      cur = p;
    } else cur = cur ? cur + ' ' + p : p;
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

export class SilentTts implements TtsBackend {
  readonly available = true;
  private current?: { remaining: number; onEnd: () => void };
  private paused = false;
  /** Multiplier on the estimated duration (tests may speed it up). */
  constructor(public speedFactor = 1) {}

  speak(text: string, _lang: string, onEnd: () => void): void {
    this.current = { remaining: estimateSpeechSeconds(text) * this.speedFactor, onEnd };
  }
  cancel(): void {
    this.current = undefined;
  }
  tick(dt: number): void {
    if (!this.current || this.paused) return;
    this.current.remaining -= dt;
    if (this.current.remaining <= 0) {
      const c = this.current;
      this.current = undefined;
      c.onEnd();
    }
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
  }
  get speaking(): boolean {
    return this.current !== undefined;
  }
}

export interface WebSpeechOptions {
  rate?: number;
  pitch?: number;
  /** Preferred voice name substring (e.g. "Carmit", "Google"). */
  preferVoice?: string;
}

export class WebSpeechTts implements TtsBackend {
  private readonly synth: SpeechSynthesis | undefined;
  private voice: SpeechSynthesisVoice | null = null;
  private generation = 0;
  private volume = 1;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  readonly rate: number;
  readonly pitch: number;
  private readonly preferVoice?: string;

  constructor(opts: WebSpeechOptions = {}) {
    this.rate = opts.rate ?? 1.0;
    this.pitch = opts.pitch ?? 1.0;
    this.preferVoice = opts.preferVoice;
    this.synth = typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis ? (globalThis as unknown as { speechSynthesis: SpeechSynthesis }).speechSynthesis : undefined;
    if (this.synth) {
      this.pickVoice();
      // Chrome populates getVoices() asynchronously and fires 'voiceschanged' when ready.
      try {
        this.synth.addEventListener?.('voiceschanged', () => this.pickVoice());
      } catch {
        /* older browsers */
      }
    }
  }

  get available(): boolean {
    return this.synth !== undefined;
  }

  /** The Hebrew voice in use (null = browser default for lang he-IL). */
  get currentVoice(): SpeechSynthesisVoice | null {
    return this.voice;
  }

  private pickVoice(): void {
    if (!this.synth) return;
    let voices: SpeechSynthesisVoice[];
    try {
      voices = this.synth.getVoices();
    } catch {
      return;
    }
    const he = voices.filter((v) => v.lang === 'he-IL' || v.lang.toLowerCase().startsWith('he'));
    if (he.length === 0) return;
    const score = (v: SpeechSynthesisVoice): number =>
      (this.preferVoice && v.name.includes(this.preferVoice) ? 8 : 0) + (v.lang === 'he-IL' ? 4 : 0) + (v.localService ? 2 : 0) + (v.default ? 1 : 0);
    he.sort((a, b) => score(b) - score(a));
    this.voice = he[0]!;
  }

  speak(text: string, lang: string, onEnd: () => void, onError: (err: unknown) => void): void {
    const synth = this.synth;
    if (!synth) {
      onError(new Error('speechSynthesis unavailable'));
      return;
    }
    this.cancel();
    const gen = ++this.generation;
    const chunks = chunkSentences(text);
    let i = 0;
    const armWatchdog = (chunk: string) => {
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => {
        if (gen !== this.generation) return;
        // Chrome sometimes never fires onend (e.g. tab in background) — move on.
        next();
      }, (estimateSpeechSeconds(chunk) * 2 + 3) * 1000);
    };
    const next = () => {
      if (gen !== this.generation) return;
      if (i >= chunks.length) {
        if (this.watchdog) clearTimeout(this.watchdog);
        this.watchdog = undefined;
        onEnd();
        return;
      }
      const chunk = chunks[i++]!;
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = this.voice?.lang ?? lang;
      if (this.voice) u.voice = this.voice;
      u.rate = this.rate;
      u.pitch = this.pitch;
      u.volume = this.volume;
      u.onend = () => {
        if (gen !== this.generation) return;
        next();
      };
      u.onerror = (ev: SpeechSynthesisErrorEvent) => {
        if (gen !== this.generation) return;
        if (ev.error === 'interrupted' || ev.error === 'canceled') return; // our own cancel
        if (this.watchdog) clearTimeout(this.watchdog);
        onError(ev.error);
      };
      armWatchdog(chunk);
      try {
        // Chrome quirk: a paused synthesiser silently drops new utterances.
        if (synth.paused) synth.resume();
        synth.speak(u);
      } catch (err) {
        onError(err);
      }
    };
    next();
  }

  cancel(): void {
    this.generation++;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
  }

  setPaused(paused: boolean): void {
    try {
      if (paused) this.synth?.pause();
      else this.synth?.resume();
    } catch {
      /* ignore */
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }
}
