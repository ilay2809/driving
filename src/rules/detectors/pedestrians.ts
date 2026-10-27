/**
 * Pedestrian crossings (תקנה 67): a pedestrian waiting at or crossing a crossing ahead must
 * be let through — the front bumper has to stay 0.5 m before the crossing band. Passing that
 * point faster than walking pace while such a pedestrian is there → PEDESTRIAN_NOT_YIELDED.
 * At signalised crossings a waiting pedestrian on a red pedestrian signal has no priority.
 * Also: near misses with any pedestrian and the "crossing ahead" hint when someone is near it.
 */
import type { SimContext } from '@/core/sim';
import type { Detector, JudgeApi } from '../api';
import { bodyPointDistance, relativeSpeed } from '../geometry';
import { pedestriansAtCrossing, pedestriansNearLine } from '../queries';
import { PEDESTRIANS as T } from '../thresholds';

const NEAR_MISS_REPEAT_S = 5;

export class PedestriansDetector implements Detector {
  readonly name = 'pedestrians';
  private prevDist = new Map<string, number>();
  private infoSent = new Set<string>();
  private nearMissSeen = new Map<string, number>();

  reset(): void {
    this.prevDist.clear();
    this.infoSent.clear();
    this.nearMissSeen.clear();
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const p = ctx.player;
    const ahead = api.crossingsAhead(Math.max(T.LOOKAHEAD_M, T.INFO_M));
    const current = new Set<string>();
    for (const ca of ahead) {
      const c = ca.crossing;
      current.add(c.id);
      const peds = pedestriansAtCrossing(ctx, c.id);
      const near = peds.length > 0 || pedestriansNearLine(ctx, c.line, T.NEAR_CROSSING_M).length > 0;
      if (near && !this.infoSent.has(c.id) && ca.distance > 0 && ca.distance <= T.INFO_M) {
        this.infoSent.add(c.id);
        api.report('APPROACHING_CROSSING', { details: { crossing: c.id, distance: Math.round(ca.distance), pedestrians: peds.length } });
      }
      const prev = this.prevDist.get(c.id);
      if (prev !== undefined && prev > T.STOP_MARGIN_M && ca.distance <= T.STOP_MARGIN_M && p.speed > T.PASS_SPEED_MPS && peds.length > 0) {
        const pedSignal = c.signalGroup ? ctx.signals.stateOf(c.signalGroup) : undefined;
        const onCarriageway = peds.some((x) => x.pedState === 'crossing');
        if (!(pedSignal === 'red' && !onCarriageway)) {
          api.report('PEDESTRIAN_NOT_YIELDED', { details: { crossing: c.id, speed: Math.round(p.speed * 3.6), pedestrians: peds.length } });
        }
      }
      this.prevDist.set(c.id, ca.distance);
    }
    for (const id of Array.from(this.prevDist.keys())) {
      if (!current.has(id)) {
        this.prevDist.delete(id);
        this.infoSent.delete(id);
      }
    }

    for (const a of ctx.traffic) {
      if (a.kind !== 'pedestrian') continue;
      const d = bodyPointDistance(p, a.pos, a.width / 2);
      if (d >= T.NEAR_MISS_M) continue;
      if (relativeSpeed(p, a) <= T.NEAR_MISS_REL_SPEED_MPS) continue;
      const last = this.nearMissSeen.get(a.id);
      if (last !== undefined && api.time - last < NEAR_MISS_REPEAT_S) continue;
      this.nearMissSeen.set(a.id, api.time);
      api.report('PEDESTRIAN_NEAR_MISS', { details: { agent: a.id, distance: Math.round(d * 100) / 100 } });
    }
  }
}
