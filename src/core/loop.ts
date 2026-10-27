/**
 * Frame loop: drives all systems with a clamped, scalable delta and keeps the
 * simulation clock. Rendering is a callback so the loop stays testable.
 */
import type { SimContext, System } from './sim';

export class GameLoop {
  private raf = 0;
  private last = 0;
  private running = false;
  /** Temporary time-scale override (e.g. slow motion in lessons). */
  private scaleUntil = 0;
  private scaleValue = 1;

  constructor(
    public readonly ctx: SimContext,
    public systems: System[],
    private readonly render: (ctx: SimContext) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = this.now();
    const tick = () => {
      if (!this.running) return;
      const t = this.now();
      const realDt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
      this.last = t;
      this.step(realDt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Advance the simulation by one frame of real time. */
  step(realDt: number): void {
    const ctx = this.ctx;
    ctx.dt = ctx.paused ? 0 : realDt * ctx.timeScale;
    if (!ctx.paused) ctx.time += ctx.dt;
    if (this.scaleUntil > 0 && ctx.time >= this.scaleUntil) {
      // slow-motion window elapsed: back to real time from the next frame on
      this.scaleUntil = 0;
      this.scaleValue = 1;
      ctx.timeScale = 1;
    }
    for (const s of this.systems) {
      try {
        s.update(ctx);
      } catch (err) {
        console.error(`[loop] system ${s.name} failed`, err);
      }
    }
    this.render(ctx);
  }

  setTimeScale(factor: number, seconds: number): void {
    this.scaleValue = factor;
    this.ctx.timeScale = factor;
    this.scaleUntil = this.ctx.time + seconds;
  }

  get timeScale(): number {
    return this.scaleValue;
  }

  setPaused(paused: boolean): void {
    this.ctx.paused = paused;
    this.ctx.bus.emit('sim:paused', { paused });
  }
}
