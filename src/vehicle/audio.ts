/**
 * VehicleAudio — fully procedural WebAudio: engine (two oscillators + filtered noise
 * following rpm / load), indicator tick-tock, horn, tyre squeal, collision thud,
 * wiper swish, starter whirr. The AudioContext is created on the first user gesture
 * (browser autoplay policy); until then every call is a no-op.
 */
import type { EventBus } from '@/core/events';
import type { Settings } from '@/core/sim';
import type { VehicleState } from '@/core/types';
import { indicatorLampOn } from './indicator';

export interface AudioFrameInfo {
  /** Friction-circle utilisation (≥ ~0.8 squeals). */
  slip?: number;
  /** Simulation time (s) — used for the indicator phase. */
  time?: number;
  /** Time the indicator was switched on (vehicle.body.indicators.since). */
  indicatorSince?: number;
}

type Ctx = AudioContext;

export class VehicleAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private engine: { osc1: OscillatorNode; osc2: OscillatorNode; sub: OscillatorNode; noise: AudioBufferSourceNode; noiseBp: BiquadFilterNode; noiseGain: GainNode; lp: BiquadFilterNode; gain: GainNode } | null = null;
  private squeal: { src: AudioBufferSourceNode; bp: BiquadFilterNode; gain: GainNode } | null = null;
  private horn: { a: OscillatorNode; b: OscillatorNode; gain: GainNode } | null = null;
  private lampWasOn = false;
  private wasEngineOn = false;
  private wiperPhase = 0;
  private wiperLast = -1;
  private disposers: (() => void)[] = [];
  private unsub: (() => void)[] = [];
  private gestureListeners: (() => void)[] = [];
  private lastTime = 0;
  private wasHorn = false;

  constructor(
    private readonly settings: Settings,
    bus?: EventBus,
  ) {
    if (typeof window !== 'undefined') {
      const start = () => this.ensureContext();
      for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
        window.addEventListener(ev, start, { passive: true });
        this.gestureListeners.push(() => window.removeEventListener(ev, start));
      }
    }
    if (bus) {
      this.unsub.push(bus.on('vehicle:collision', (ev) => this.thud(ev.impulse, ev.with === 'kerb')));
    }
  }

  /** Create (or resume) the context — call from a user gesture. */
  ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AC();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise(this.ctx);
      this.buildEngine();
      this.buildSqueal();
      for (const off of this.gestureListeners) off();
      this.gestureListeners.length = 0;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v: number): void {
    this.settings.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private makeNoise(ctx: Ctx): AudioBuffer {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // deterministic LCG noise (no Math.random in sim code, and it keeps the buffer reproducible)
    let s = 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
    return buf;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const g1 = ctx.createGain();
    g1.gain.value = 0.5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    const g3 = ctx.createGain();
    g3.gain.value = 0.35;
    const noise = this.noiseSource();
    const noiseBp = ctx.createBiquadFilter();
    noiseBp.type = 'bandpass';
    noiseBp.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc1.connect(g1).connect(lp);
    osc2.connect(g2).connect(lp);
    sub.connect(g3).connect(lp);
    noise.connect(noiseBp).connect(noiseGain).connect(lp);
    lp.connect(gain).connect(this.master!);
    osc1.start();
    osc2.start();
    sub.start();
    noise.start();
    this.engine = { osc1, osc2, sub, noise, noiseBp, noiseGain, lp, gain };
    this.disposers.push(() => {
      osc1.stop();
      osc2.stop();
      sub.stop();
      noise.stop();
    });
  }

  private buildSqueal(): void {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 9;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'peaking';
    bp2.frequency.value = 2900;
    bp2.Q.value = 6;
    bp2.gain.value = 8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(bp).connect(bp2).connect(gain).connect(this.master!);
    src.start();
    this.squeal = { src, bp, gain };
    this.disposers.push(() => src.stop());
  }

  private blip(freq: number, seconds: number, volume: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  private click(volume: number, freq = 2500, seconds = 0.012): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + seconds + 0.02);
  }

  /** Collision thud (impulse in N·s). */
  thud(impulse: number, soft = false): void {
    if (!this.ensureContext()) return;
    const ctx = this.ctx!;
    const v = Math.min(1, impulse / (soft ? 2500 : 5000)) * (soft ? 0.45 : 0.9);
    if (v < 0.02) return;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(soft ? 500 : 320, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (soft ? 0.18 : 0.3));
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.4);
    this.blip(soft ? 110 : 70, soft ? 0.15 : 0.35, v * 0.8);
  }

  private starter(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(18, t);
    osc.frequency.linearRampToValueAtTime(26, t + 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.05);
    g.gain.setValueAtTime(0.35, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    osc.connect(lp).connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  private setHorn(on: boolean): void {
    const ctx = this.ctx!;
    if (on && !this.horn) {
      const a = ctx.createOscillator();
      a.type = 'sawtooth';
      a.frequency.value = 420;
      const b = ctx.createOscillator();
      b.type = 'sawtooth';
      b.frequency.value = 505;
      const bp = ctx.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.value = 1400;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.03);
      a.connect(bp);
      b.connect(bp);
      bp.connect(gain).connect(this.master!);
      a.start();
      b.start();
      this.horn = { a, b, gain };
    } else if (!on && this.horn) {
      const h = this.horn;
      this.horn = null;
      const t = ctx.currentTime;
      h.gain.gain.cancelScheduledValues(t);
      h.gain.gain.setValueAtTime(h.gain.gain.value, t);
      h.gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      h.a.stop(t + 0.1);
      h.b.stop(t + 0.1);
    }
  }

  update(state: VehicleState, info: AudioFrameInfo = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine || !this.master) return;
    const now = ctx.currentTime;
    const time = info.time ?? this.lastTime + 1 / 60;
    this.lastTime = time;
    if (this.master.gain.value !== this.settings.volume) this.master.gain.setTargetAtTime(this.settings.volume, now, 0.05);

    // engine
    const e = this.engine;
    const rpm = Math.max(0, state.rpm);
    const firing = rpm / 30; // 4-cylinder: two firings per rev
    const load = Math.min(1, state.throttle * 0.75 + (rpm / 6200) * 0.35);
    const on = state.engineOn && rpm > 50;
    e.osc1.frequency.setTargetAtTime(Math.max(5, firing), now, 0.03);
    e.osc2.frequency.setTargetAtTime(Math.max(10, firing * 2.01), now, 0.03);
    e.sub.frequency.setTargetAtTime(Math.max(2.5, firing / 2), now, 0.03);
    e.noiseBp.frequency.setTargetAtTime(250 + rpm * 0.45, now, 0.05);
    e.noiseGain.gain.setTargetAtTime(on ? 0.05 + 0.3 * load : 0, now, 0.05);
    e.lp.frequency.setTargetAtTime(on ? 280 + rpm * 0.55 + state.throttle * 1500 : 100, now, 0.05);
    e.gain.gain.setTargetAtTime(on ? 0.07 + 0.2 * load : 0, now, on ? 0.08 : 0.25);
    if (state.engineOn && !this.wasEngineOn) this.starter();
    this.wasEngineOn = state.engineOn;

    // indicator tick-tock on the lamp edges
    const ind = state.indicator !== 'off';
    const lampOn = ind && indicatorLampOn(time, info.indicatorSince ?? 0);
    if (lampOn && !this.lampWasOn) {
      this.click(0.22, 2800, 0.01);
      this.blip(1250, 0.03, 0.08, 'square');
    } else if (!lampOn && this.lampWasOn) {
      this.click(0.16, 1800, 0.01);
      this.blip(950, 0.03, 0.06, 'square');
    }
    this.lampWasOn = lampOn;

    // horn
    if (state.horn !== this.wasHorn) {
      this.setHorn(state.horn);
      this.wasHorn = state.horn;
    }

    // tyre squeal
    if (this.squeal) {
      const slip = info.slip ?? 0;
      const fast = Math.abs(state.speed) > 2;
      const target = fast ? Math.min(1, Math.max(0, (slip - 0.78) * 3.5)) * 0.4 : 0;
      this.squeal.gain.gain.setTargetAtTime(target, now, target > 0 ? 0.04 : 0.12);
      this.squeal.bp.frequency.setTargetAtTime(1900 + Math.min(1, Math.abs(state.speed) / 25) * 700, now, 0.1);
    }

    // wipers: a swish every half cycle
    if (state.wipers) {
      const phase = (time % 1.3) / 1.3;
      const half = phase < 0.5 ? 0 : 1;
      if (half !== this.wiperLast) {
        this.wiperLast = half;
        this.swish();
      }
    } else {
      this.wiperLast = -1;
    }
  }

  private swish(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(1300, t + 0.4);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.5);
  }

  dispose(): void {
    for (const off of this.unsub) off();
    for (const off of this.gestureListeners) off();
    for (const d of this.disposers) {
      try {
        d();
      } catch {
        /* already stopped */
      }
    }
    this.setHorn(false);
    void this.ctx?.close();
    this.ctx = null;
    this.engine = null;
    this.squeal = null;
  }
}
