/**
 * Yielding (זכות קדימה) at give-way / stop / right-hand-rule / roundabout approaches and for
 * left turns anywhere (connector.yieldTo non-empty).
 *
 * A "passage" starts when the front bumper crosses the stop line (or the car is inside the
 * junction). The movement being made is identified from the connectors leaving the approach
 * lane (the only one within 1.5 m / 60°, or the one leading to the exit lane once that is
 * matched). The conflict check runs at the COMMIT point of that movement: within the first
 * 2 m past a yield line, or — for left turns at priority / signalised junctions — where the
 * connector first crosses a priority path, so that waiting in the middle of the junction for
 * oncoming traffic is not penalised. While the movement is still ambiguous, agents that
 * conflict with every possible movement are reported at once.
 *
 * A conflict = an agent on a yieldTo connector, or on its feeding lane with TTC < 3 s while
 * moving (and whose own signal is not red). Agents flagged `disturbedByPlayer` within 25 m are
 * FAILED_TO_YIELD regardless. GOOD_YIELD is reported when the player waited at the line while
 * a conflicting agent passed and then went.
 */
import type { SimContext } from '@/core/sim';
import { angleDiff, dist2, projectOntoPolyline } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Connector, ControlKind } from '@/world/schema';
import type { Detector, JudgeApi } from '../api';
import { degToRad, segmentsIntersect } from '../geometry';
import { conflictAgents, isVehicle, type Conflict } from '../queries';
import { HE } from '../strings.he';
import { YIELD as T } from '../thresholds';
import { isLeftTurn } from '../turns';

const YIELD_CONTROLS: ReadonlySet<ControlKind> = new Set<ControlKind>(['give_way', 'stop', 'right_hand_rule', 'roundabout_entry']);
const CANDIDATE_DIST_M = 1.5;
const CANDIDATE_HEADING = degToRad(60);
const UTURN_MIN_TURNED = degToRad(70);
/** Past this distance along a connector the localiser's choice is trusted. */
const LOCALISER_TRUST_M = 4;
const PASSAGE_TIMEOUT_S = 12;
/** At a yield line the commitment is entering the junction, not the exact crossing point. */
const YIELD_LINE_COMMIT_M = 2.0;

interface Passage {
  junctionId: string;
  laneId: string;
  control: ControlKind;
  enteredAt: number;
  evaluated: boolean;
  commonChecked: boolean;
  waited: boolean;
  conflictWhileWaiting: boolean;
}

/**
 * Arc length along `c.path` where it first crosses one of its priority (yieldTo) paths;
 * 0 when the movements merge rather than cross.
 */
export function commitDistance(graph: RoadGraph, c: Connector): number {
  let best = Infinity;
  for (const yid of c.yieldTo) {
    const y = graph.connectors.get(yid);
    if (!y) continue;
    let acc = 0;
    outer: for (let i = 1; i < c.path.length; i++) {
      const a = c.path[i - 1]!;
      const b = c.path[i]!;
      for (let j = 1; j < y.path.length; j++) {
        if (segmentsIntersect(a, b, y.path[j - 1]!, y.path[j]!)) {
          best = Math.min(best, acc + dist2(a, b) / 2);
          break outer;
        }
      }
      acc += dist2(a, b);
    }
  }
  return Number.isFinite(best) ? best : 0;
}

export class YieldingDetector implements Detector {
  readonly name = 'yielding';
  private passage?: Passage;
  private waitKey?: string;
  private waited = false;
  private conflictWhileWaiting = false;
  private infoKey?: string;
  private disturbedSeen = new Map<string, number>();
  private commitCache = new Map<string, number>();

  reset(): void {
    this.passage = undefined;
    this.waitKey = undefined;
    this.waited = false;
    this.conflictWhileWaiting = false;
    this.infoKey = undefined;
    this.disturbedSeen.clear();
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const g = api.graph;
    const loc = ctx.localisation;
    const p = ctx.player;

    // agents that had to brake / swerve because of the player
    for (const a of ctx.traffic) {
      if (!a.disturbedByPlayer || !isVehicle(a) || dist2(a.pos, p.pos) > T.DISTURBED_RADIUS_M) continue;
      const last = this.disturbedSeen.get(a.id);
      if (last !== undefined && api.time - last < T.DISTURBED_REPEAT_S) continue;
      this.disturbedSeen.set(a.id, api.time);
      api.report('FAILED_TO_YIELD', { details: { agent: a.id, disturbed: true } });
    }

    const ap = api.approach();
    const key = ap ? `${ap.junction.id}:${ap.approach.roadId}` : undefined;

    // before the line: roundabout hint + waiting bookkeeping
    if (ap && key && !ap.onConnector && ap.distToStopLine > 0) {
      if (ap.approach.control === 'roundabout_entry' && this.infoKey !== key && ap.distToStopLine <= T.APPROACH_INFO_M) {
        this.infoKey = key;
        api.report('APPROACHING_ROUNDABOUT', { details: { distance: Math.round(ap.distToStopLine) }, context: api.junctionContext(ap.junction.id) });
      }
      if (this.waitKey !== key) {
        this.waitKey = key;
        this.waited = false;
        this.conflictWhileWaiting = false;
      }
      if (ap.distToStopLine < 8 && Math.abs(p.speed) < T.WAIT_SPEED_MPS) {
        this.waited = true;
        if (!this.conflictWhileWaiting) {
          for (const c of g.connectorsFrom(ap.laneId)) {
            if (this.conflicts(ctx, api, c).length > 0) {
              this.conflictWhileWaiting = true;
              break;
            }
          }
        }
      }
    }

    // passage start: the front bumper is past the line / the car is in the junction
    if (!this.passage && ap && key && ap.stopLine && (ap.onConnector || loc.insideJunction || ap.distToStopLine < 0)) {
      const sameKey = this.waitKey === key;
      this.passage = { junctionId: ap.junction.id, laneId: ap.laneId, control: ap.approach.control, enteredAt: api.time, evaluated: false, commonChecked: false, waited: sameKey && this.waited, conflictWhileWaiting: sameKey && this.conflictWhileWaiting };
    }
    const ps = this.passage;
    if (!ps) return;

    const exitLaneId = loc.laneId && loc.laneId !== ps.laneId ? loc.laneId : undefined;
    const backOnApproach = loc.laneId === ps.laneId && !loc.insideJunction && ap !== undefined && ap.distToStopLine > 0.5;
    if (backOnApproach || api.time - ps.enteredAt > PASSAGE_TIMEOUT_S) {
      this.passage = undefined;
      return;
    }

    const conns = g.connectorsFrom(ps.laneId);
    let decided: Connector | undefined;
    if (exitLaneId) decided = conns.find((c) => c.toLane === exitLaneId);
    const turned = Math.abs(angleDiff(g.laneEndHeading(ps.laneId), p.heading));
    const cands = conns.filter((c) => {
      // a U-turn is only a plausible intent once the car has visibly swung round
      if (c.turn === 'uturn' && turned < UTURN_MIN_TURNED) return false;
      const pr = projectOntoPolyline(c.path, p.pos);
      return pr.distance <= CANDIDATE_DIST_M && Math.abs(angleDiff(pr.h, p.heading)) < CANDIDATE_HEADING;
    });
    if (!decided && cands.length === 1) decided = cands[0];
    // Off every candidate path (a very wide turn): fall back to the localiser's match, but only
    // once it is well into the junction — never as a tie-breaker while paths still overlap.
    if (!decided && cands.length === 0 && loc.connectorId) {
      const lc = g.connectors.get(loc.connectorId);
      if (lc && lc.fromLane === ps.laneId && loc.s >= LOCALISER_TRUST_M) decided = lc;
    }

    if (!ps.evaluated) {
      if (decided) {
        const sFront = exitLaneId ? Infinity : projectOntoPolyline(decided.path, p.pos).s + p.length / 2;
        let commit = this.commit(g, decided);
        if (YIELD_CONTROLS.has(ps.control)) commit = Math.min(commit, YIELD_LINE_COMMIT_M);
        if (sFront >= commit - 0.5) {
          ps.evaluated = true;
          this.evaluate(ctx, api, ps, decided);
        }
      } else if (cands.length > 1 && !ps.commonChecked && YIELD_CONTROLS.has(ps.control)) {
        ps.commonChecked = true;
        const lists = cands.map((c) => this.conflicts(ctx, api, c));
        const common = lists[0]!.filter((k) => lists.every((l) => l.some((x) => x.agent.id === k.agent.id)));
        if (common.length > 0) {
          ps.evaluated = true;
          this.reportConflict(api, ps, cands[0]!, common);
        }
      }
    }

    if (exitLaneId) this.passage = undefined;
  }

  private commit(g: RoadGraph, c: Connector): number {
    let v = this.commitCache.get(c.id);
    if (v === undefined) {
      v = commitDistance(g, c);
      this.commitCache.set(c.id, v);
    }
    return v;
  }

  private conflicts(ctx: SimContext, api: JudgeApi, c: Connector): Conflict[] {
    return conflictAgents(api.graph, ctx, c, T.TTC_S, T.MIN_AGENT_SPEED_MPS).filter((k) => ctx.signals.stateForConnector(k.via.id) !== 'red');
  }

  private evaluate(ctx: SimContext, api: JudgeApi, ps: Passage, c: Connector): void {
    const applies = YIELD_CONTROLS.has(ps.control) || (isLeftTurn(c.turn) && c.yieldTo.length > 0);
    if (!applies) return;
    const ks = this.conflicts(ctx, api, c);
    if (ks.length > 0) this.reportConflict(api, ps, c, ks);
    else if (ps.waited && ps.conflictWhileWaiting) api.report('GOOD_YIELD', { context: api.junctionContext(ps.junctionId) });
  }

  private reportConflict(api: JudgeApi, ps: Passage, c: Connector, ks: Conflict[]): void {
    const k = ks[0]!;
    const context = api.junctionContext(ps.junctionId);
    const details = { agent: k.agent.id, ttc: Math.round(k.ttc * 10) / 10, turn: c.turn };
    if (ps.control === 'roundabout_entry') api.report('ROUNDABOUT_NO_YIELD', { details: { ...details, who: HE.inRoundabout }, context });
    else if (isLeftTurn(c.turn) && ks.some((x) => x.oncoming)) api.report('LEFT_TURN_NO_YIELD', { details: { ...details, who: HE.oncoming }, context });
    else api.report('FAILED_TO_YIELD', { details: { ...details, who: HE.crossTraffic }, context });
  }
}
