/** Adapts the rules engine's parking verdict to the coach layer's ParkingReporter. */
import type { ParkingReport, ParkingReporter } from '@/coach';
import type { SimContext } from '@/core/sim';
import type { Judge } from '@/rules';

export function parkingReporterFor(judge: Judge): ParkingReporter {
  let stoppedSince: number | undefined;
  return (ctx: SimContext): ParkingReport | undefined => {
    const stopped = Math.abs(ctx.player.speed) < 0.15;
    if (!stopped) stoppedSince = undefined;
    else if (stoppedSince === undefined) stoppedSince = ctx.time;
    const stoppedFor = stoppedSince === undefined ? 0 : ctx.time - stoppedSince;
    const parked = stopped && (ctx.player.gear === 'P' || ctx.player.handbrake);
    const r = judge.parkingReport(ctx);
    if (!r) return { stopped, stoppedFor, parked, legal: true, reasons: [] };
    return {
      stopped,
      stoppedFor,
      parked,
      kerbDistance: r.kerbDistance,
      angleDeg: r.angleDeg,
      legal: r.legal,
      reasons: r.reasons,
      bayId: r.strip?.id,
      laneId: r.laneId,
    };
  };
}
