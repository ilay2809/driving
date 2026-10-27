/**
 * Instructions from the navigator / examiner: an expected movement at a junction (WRONG_TURN
 * when the player leaves it another way) and an expected stop point (MISSED_INSTRUCTION when
 * the player drives more than 30 m past it without stopping).
 */
import type { SimContext } from '@/core/sim';
import { dist2, type Vec2 } from '@/world/geo';
import type { Connector } from '@/world/schema';
import type { Detector, JudgeApi } from '../api';
import { aheadOf } from '../geometry';
import { HE } from '../strings.he';
import { INSTRUCTIONS as T } from '../thresholds';
import { areSiblings, turnClass, type TurnClass } from '../turns';

export type ExpectedTurn = TurnClass | 'any';

export interface ExpectedStop {
  pos: Vec2;
  radius: number;
  /** The player stopped within the radius. */
  reached: boolean;
}

export class InstructionsDetector implements Detector {
  readonly name = 'instructions';
  private expectedTurn?: { junctionId: string; turn: ExpectedTurn };
  private expectedStop?: ExpectedStop & { wasNear: boolean };
  private lastLaneId?: string;
  private lastConnectorId?: string;

  setExpectedTurn(junctionId: string, turn: ExpectedTurn | null): void {
    this.expectedTurn = turn ? { junctionId, turn } : undefined;
  }

  setExpectedStop(pos: Vec2, radius: number): void {
    this.expectedStop = { pos: [pos[0], pos[1]], radius, reached: false, wasNear: false };
  }

  clearExpectedStop(): void {
    this.expectedStop = undefined;
  }

  get expectations(): { turn?: { junctionId: string; turn: ExpectedTurn }; stop?: ExpectedStop } {
    return {
      turn: this.expectedTurn ? { ...this.expectedTurn } : undefined,
      stop: this.expectedStop ? { pos: [this.expectedStop.pos[0], this.expectedStop.pos[1]], radius: this.expectedStop.radius, reached: this.expectedStop.reached } : undefined,
    };
  }

  reset(): void {
    this.expectedTurn = undefined;
    this.expectedStop = undefined;
    this.lastLaneId = undefined;
    this.lastConnectorId = undefined;
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const loc = ctx.localisation;
    const g = api.graph;
    if (loc.connectorId) this.lastConnectorId = loc.connectorId;
    if (loc.laneId && loc.laneId !== this.lastLaneId) {
      const lane = g.lanes.get(loc.laneId);
      const old = this.lastLaneId ? g.lanes.get(this.lastLaneId) : undefined;
      if (lane && old && !areSiblings(g, old, lane)) {
        let conn: Connector | undefined = g.connectorsFrom(old.id).find((c) => c.toLane === lane.id);
        if (!conn && this.lastConnectorId) {
          const lc = g.connectors.get(this.lastConnectorId);
          if (lc && lc.toLane === lane.id) conn = lc;
        }
        if (conn && this.expectedTurn && conn.junctionId === this.expectedTurn.junctionId) {
          const actual = turnClass(conn.turn);
          const expected = this.expectedTurn.turn;
          if (expected !== 'any' && expected !== actual) {
            api.report('WRONG_TURN', { details: { expected, actual, expectedHe: HE.expectedTurn[expected] ?? expected, actualHe: HE.expectedTurn[actual] ?? actual }, context: api.junctionContext(conn.junctionId) });
          }
          this.expectedTurn = undefined;
        }
      }
      this.lastLaneId = loc.laneId;
      this.lastConnectorId = undefined;
    }

    const es = this.expectedStop;
    if (!es) return;
    const d = dist2(ctx.player.pos, es.pos);
    if (d <= es.radius) {
      es.wasNear = true;
      if (api.stoppedFor >= 1) {
        es.reached = true;
        this.expectedStop = undefined;
        return;
      }
    } else if (d <= es.radius + T.MISSED_STOP_OVERSHOOT_M) es.wasNear = true;
    const behind = -aheadOf(ctx.player, es.pos);
    if (es.wasNear && d > es.radius && behind > T.MISSED_STOP_OVERSHOOT_M) {
      api.report('MISSED_INSTRUCTION', { details: { kind: 'stop', overshoot: Math.round(behind) } });
      this.expectedStop = undefined;
    }
  }
}
