/**
 * Signalling and observation (תקנה 38 + the instructor's "מראות – איתות – נקודה מתה").
 *
 *  - Turns: judged when the car leaves the junction onto the exit lane (the movement is then
 *    certain). The indicator of the required side must have been on when the car entered the
 *    junction: not at all → NO_INDICATOR_TURN; on for < 1.5 s and switched on less than 20 m
 *    before the stop line → INDICATOR_LATE. Indicator still on 10 s after the turn with no new
 *    manoeuvre (and no junction within 40 m) → INDICATOR_LEFT_ON.
 *  - Lane changes (the localiser switching to a sibling lane): side indicator on for ≥ 1 s, a
 *    glance at that side's mirror and over that shoulder within the last 5 s.
 *  - Pulling out: moving off after ≥ 3 s standing at the kerb (parked: P / handbrake / engine
 *    off, or stopped with no traffic reason) → same checks towards the traffic side, reported
 *    with `details.maneuver = 'pull_out'` (the ViolationTypes stay NO_INDICATOR_LANE_CHANGE /
 *    NO_MIRROR_CHECK / NO_SHOULDER_CHECK) so the coach can phrase them as "יציאה מחניה".
 *    In free drive / on the training ground the very first move-off of a session (the car has
 *    not driven anywhere yet, or the session is < 3 s old) is not judged: nobody has shown the
 *    pupil the routine yet — the instructor briefs it instead (Instructor 'pull_out.briefing').
 */
import type { SimContext } from '@/core/sim';
import type { Connector, Lane } from '@/world/schema';
import type { Detector, JudgeApi } from '../api';
import { carriagewayEdges, roadLateral } from '../geometry';
import { agentsAhead, isVehicle } from '../queries';
import { HE } from '../strings.he';
import { SIGNALLING as T } from '../thresholds';
import { areSiblings, requiredIndicator, type Side } from '../turns';

interface Interval {
  side: Side;
  from: number;
  to?: number;
  /** Distance to the stop line of the approach when the indicator was switched on. */
  distToLine?: number;
}

const INTERVAL_MEMORY_S = 60;
/** An indicator switched on up to this long after entering the junction still counts (as late). */
const LATE_START_GRACE_S = 1.0;
const NEXT_JUNCTION_INTENT_M = 40;
/** The first move-off of a free-drive session is briefed, not judged: odometer / age limits. */
const FIRST_PULL_OUT_ODOMETER_M = 2;
const FIRST_PULL_OUT_SESSION_S = 3;
/** Details attached to the three pull-out observations (`manoeuvre` kept for existing readers). */
const PULL_OUT_DETAILS = { manoeuvre: 'pull_out', maneuver: 'pull_out' } as const;

export class SignallingDetector implements Detector {
  readonly name = 'signalling';
  private intervals: Interval[] = [];
  private current?: Interval;
  private lastLaneId?: string;
  private lastLaneLeftAt?: number;
  private lastConnectorId?: string;
  private turnDone?: { time: number; side: Side; junctionId: string };
  private parked = false;
  private parkedSide: Side = 'right';

  reset(): void {
    this.intervals = [];
    this.current = undefined;
    this.lastLaneId = undefined;
    this.lastLaneLeftAt = undefined;
    this.lastConnectorId = undefined;
    this.turnDone = undefined;
    this.parked = false;
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const p = ctx.player;
    const loc = ctx.localisation;
    const g = api.graph;
    const now = api.time;

    // ---- indicator intervals ---------------------------------------------------------------
    const side: Side | undefined = p.indicator === 'left' || p.indicator === 'right' ? p.indicator : undefined;
    if (this.current && this.current.side !== side) {
      this.current.to = now;
      this.current = undefined;
    }
    if (side && !this.current) {
      const ap = api.approach();
      this.current = { side, from: now, distToLine: ap && !ap.onConnector ? ap.distToStopLine : undefined };
      this.intervals.push(this.current);
    }
    const first = this.intervals[0];
    if (first && first.to !== undefined && first.to < now - INTERVAL_MEMORY_S) this.intervals = this.intervals.filter((iv) => iv.to === undefined || iv.to >= now - INTERVAL_MEMORY_S);

    // ---- lane / junction transitions --------------------------------------------------------
    if (!loc.laneId && this.lastLaneId !== undefined && this.lastLaneLeftAt === undefined) this.lastLaneLeftAt = now;
    if (loc.connectorId) this.lastConnectorId = loc.connectorId;
    if (loc.laneId && loc.laneId !== this.lastLaneId) {
      const lane = g.lanes.get(loc.laneId);
      const old = this.lastLaneId ? g.lanes.get(this.lastLaneId) : undefined;
      if (lane && old) {
        if (areSiblings(g, old, lane)) this.onLaneChange(api, old, lane);
        else {
          let conn: Connector | undefined = g.connectorsFrom(old.id).find((c) => c.toLane === lane.id);
          if (!conn && this.lastConnectorId) {
            const lc = g.connectors.get(this.lastConnectorId);
            if (lc && lc.fromLane === old.id) conn = lc;
          }
          if (conn) this.onTurnCompleted(api, conn, this.lastLaneLeftAt ?? now);
        }
      }
      this.lastLaneId = loc.laneId;
      this.lastLaneLeftAt = undefined;
      this.lastConnectorId = undefined;
    }

    // ---- indicator left on after a turn -------------------------------------------------------
    if (this.turnDone) {
      if (side !== this.turnDone.side) this.turnDone = undefined;
      else if (now - this.turnDone.time > T.LEFT_ON_S) {
        const ap = api.approach();
        const intent = !!ap && ap.distToStopLine < NEXT_JUNCTION_INTENT_M;
        if (!intent) api.report('INDICATOR_LEFT_ON', { details: { side, seconds: Math.round(now - this.turnDone.time) } });
        this.turnDone = undefined;
      }
    }

    this.updatePullOut(ctx, api);
  }

  /** The earliest interval of `side` that was active at time t (allowing a late start and a recent switch-off). */
  private intervalActiveAt(side: Side, t: number, lateGrace: number): Interval | undefined {
    let best: Interval | undefined;
    for (const iv of this.intervals) {
      if (iv.side !== side || iv.from > t + lateGrace) continue;
      if (iv.to !== undefined && iv.to < t - T.RECENT_OFF_GRACE_S) continue;
      if (!best || iv.from < best.from) best = iv;
    }
    return best;
  }

  private onTurnCompleted(api: JudgeApi, conn: Connector, entryTime: number): void {
    const need = requiredIndicator(api.graph, conn);
    this.turnDone = undefined;
    if (!need) return;
    const iv = this.intervalActiveAt(need, entryTime, LATE_START_GRACE_S);
    const context = api.junctionContext(conn.junctionId);
    if (!iv) api.report('NO_INDICATOR_TURN', { details: { turn: conn.turn, side: need }, context });
    else {
      const dur = entryTime - iv.from;
      const early = iv.distToLine !== undefined && iv.distToLine >= T.TURN_INDICATOR_MIN_M;
      if (dur < T.TURN_INDICATOR_MIN_S && !early) api.report('INDICATOR_LATE', { details: { turn: conn.turn, seconds: Math.round(Math.max(0, dur) * 10) / 10 }, context });
    }
    this.turnDone = { time: api.time, side: need, junctionId: conn.junctionId };
  }

  private onLaneChange(api: JudgeApi, old: Lane, lane: Lane): void {
    const dir: Side = lane.index > old.index ? 'right' : 'left';
    const now = api.time;
    const context = api.streetContext(lane.id);
    const iv = this.intervalActiveAt(dir, now, 0);
    if (!iv) api.report('NO_INDICATOR_LANE_CHANGE', { details: { side: dir }, context });
    else if (now - iv.from < T.LANE_CHANGE_INDICATOR_MIN_S) api.report('INDICATOR_LATE', { details: { side: dir, seconds: Math.round((now - iv.from) * 10) / 10 }, context });
    this.checkGlances(api, dir, context);
    this.turnDone = undefined;
  }

  private checkGlances(api: JudgeApi, dir: Side, context: string | undefined, extra: Record<string, string> = {}): void {
    const glances = api.glancesWithin(T.GLANCE_WINDOW_S);
    if (!glances.some((gl) => gl.target === `${dir}_mirror`)) api.report('NO_MIRROR_CHECK', { details: { side: dir, ...extra }, context });
    if (!glances.some((gl) => gl.target === `${dir}_shoulder`)) api.report('NO_SHOULDER_CHECK', { details: { side: dir, ...extra }, context });
  }

  /** Free drive / training ground: the first move-off of the session is briefed by the instructor, not judged. */
  private isFirstPullOut(ctx: SimContext, api: JudgeApi): boolean {
    if (ctx.mode !== 'free' && ctx.mode !== 'training_ground') return false;
    return api.odometer < FIRST_PULL_OUT_ODOMETER_M || api.time < FIRST_PULL_OUT_SESSION_S;
  }

  private updatePullOut(ctx: SimContext, api: JudgeApi): void {
    const p = ctx.player;
    if (api.stoppedFor >= T.PULL_OUT_STOPPED_S) {
      const k = parkedAtKerb(ctx, api);
      if (k) {
        this.parked = true;
        this.parkedSide = k;
      }
      return;
    }
    if (!this.parked) return;
    if (p.speed > T.PULL_OUT_SPEED_MPS) {
      this.parked = false;
      if (this.isFirstPullOut(ctx, api)) return;
      const dir: Side = this.parkedSide === 'right' ? 'left' : 'right';
      const context = HE.pullOut;
      const iv = this.intervalActiveAt(dir, api.time, 0);
      if (!iv) api.report('NO_INDICATOR_LANE_CHANGE', { details: { side: dir, ...PULL_OUT_DETAILS }, context });
      this.checkGlances(api, dir, context, PULL_OUT_DETAILS);
    } else if (p.speed < -T.PULL_OUT_SPEED_MPS) {
      // reversing out of a bay — the glance rules of the reversing lesson apply instead
      this.parked = false;
    }
  }
}

/**
 * Is the car standing at the kerb like a parked / pulled-over car? Returns the kerb side.
 * Stops that look like traffic (at a stop line, before a crossing, behind another vehicle)
 * do not count unless the car is in P / handbrake / engine off.
 */
export function parkedAtKerb(ctx: SimContext, api: JudgeApi): Side | undefined {
  const loc = ctx.localisation;
  const p = ctx.player;
  if (!loc.laneId || loc.insideJunction) return undefined;
  const g = api.graph;
  const lane = g.lanes.get(loc.laneId);
  const road = lane ? g.roads.get(lane.roadId) : undefined;
  if (!lane || !road) return undefined;
  const rl = roadLateral(road, p.pos);
  const e = carriagewayEdges(road);
  const fwd = road.lanesForward.includes(lane.id);
  const hw = p.width / 2;
  const rightDist = fwd ? e.right - (rl + hw) : rl - hw - e.left;
  const leftDist = fwd ? rl - hw - e.left : e.right - (rl + hw);
  const side: Side = rightDist <= leftDist ? 'right' : 'left';
  const d = Math.min(rightDist, leftDist);
  if (d > T.PULL_OUT_KERB_M) return undefined;
  if (side === 'left' && !road.oneway) return undefined;
  const parkedState = p.gear === 'P' || p.handbrake || !p.engineOn;
  if (!parkedState) {
    const ap = api.approach();
    if (ap && ap.distToStopLine < T.PULL_OUT_NOT_NEAR_LINE_M && ap.approach.control !== 'none') return undefined;
    if (api.crossingsAhead(T.PULL_OUT_NO_CROSSING_M).length > 0) return undefined;
    if (agentsAhead(ctx, T.PULL_OUT_NO_AGENT_AHEAD_M, 2.5, isVehicle).length > 0) return undefined;
  }
  return side;
}
