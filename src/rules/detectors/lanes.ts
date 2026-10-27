/**
 * Lane discipline: drifting out of the lane, crossing solid lines, driving on the wrong side
 * of the road, against one-way streets / no-entry signs, in bus lanes, turning from the wrong
 * lane, mounting / striking the kerb, wide turns / cut corners and stopping inside junctions.
 *
 * WRONG_WAY vs CENTRE_LINE_CROSSED: on a two-way road "the wrong side" is reported as
 * CENTRE_LINE_CROSSED; WRONG_WAY is reserved for one-way streets (or a heading opposite to
 * every lane of the road) so the same situation is not reported twice.
 */
import type { SimContext } from '@/core/sim';
import type { LineType } from '@/world/schema';
import type { Detector, JudgeApi } from '../api';
import { degToRad, roadLateral } from '../geometry';
import { conflictAgents, pedestriansAtCrossing, vehiclesOn } from '../queries';
import { HE } from '../strings.he';
import { LANES as T, LOCALISER } from '../thresholds';
import { areSiblings, isLeftTurn, isRightTurn } from '../turns';

const SOLID: ReadonlySet<LineType> = new Set<LineType>(['solid', 'double_solid', 'solid_dashed', 'yellow_solid']);
const WRONG_WAY_HEADING = degToRad(LOCALISER.WRONG_WAY_HEADING_DEG);
const r1 = (x: number) => Math.round(x * 10) / 10;

export class LanesDetector implements Detector {
  readonly name = 'lanes';
  private departureTimer = 0;
  private centreTimer = 0;
  private centreReported = false;
  private wrongWayTimer = 0;
  private wrongWayReported = false;
  private busTimer = 0;
  private kerbTimer = 0;
  private kerbReported = false;
  private wideTimer = 0;
  private cutTimer = 0;
  private wideReported = false;
  private cutReported = false;
  private blockingReported = false;
  private prevLateral?: number;
  private lastLaneId?: string;
  private lastConnectorId?: string;
  private originLane?: { junctionId: string; laneId: string };

  reset(): void {
    this.departureTimer = 0;
    this.centreTimer = 0;
    this.centreReported = false;
    this.wrongWayTimer = 0;
    this.wrongWayReported = false;
    this.busTimer = 0;
    this.kerbTimer = 0;
    this.kerbReported = false;
    this.wideTimer = 0;
    this.cutTimer = 0;
    this.wideReported = false;
    this.cutReported = false;
    this.blockingReported = false;
    this.prevLateral = undefined;
    this.lastLaneId = undefined;
    this.lastConnectorId = undefined;
    this.originLane = undefined;
  }

  update(ctx: SimContext, api: JudgeApi): void {
    const loc = ctx.localisation;
    const p = ctx.player;
    const g = api.graph;
    const dt = ctx.dt;
    const moving = Math.abs(p.speed) > T.MOVING_MPS;

    for (const col of api.collisions) {
      if (col.with === 'kerb' && col.impulse >= T.KERB_STRIKE_MIN_IMPULSE) api.report('KERB_STRIKE', { details: { impulse: Math.round(col.impulse) }, pos: col.pos, time: col.time });
    }

    if (loc.laneId) {
      const lane = g.lane(loc.laneId);
      const road = g.road(lane.roadId);
      const laneChanged = this.lastLaneId !== undefined && this.lastLaneId !== lane.id;
      const old = laneChanged && this.lastLaneId ? g.lanes.get(this.lastLaneId) : undefined;
      const street = api.streetContext(lane.id);

      // ---- junction passage completed: turned from the right lane? ---------------------------
      if (old && !areSiblings(g, old, lane)) {
        let conn = g.connectorsFrom(old.id).find((c) => c.toLane === lane.id);
        if (!conn && this.lastConnectorId) {
          const lc = g.connectors.get(this.lastConnectorId);
          if (lc && lc.toLane === lane.id) conn = lc;
        }
        const origin = this.originLane && this.originLane.junctionId === lane.from ? this.originLane.laneId : undefined;
        if (conn && origin && conn.fromLane !== origin) {
          const ok = g.connectorsFrom(origin).some((c) => c.toLane === lane.id);
          if (!ok) api.report('WRONG_LANE_FOR_TURN', { details: { turn: conn.turn, fromLane: origin }, context: api.junctionContext(conn.junctionId) });
        }
        this.originLane = undefined;
        this.departureTimer = 0;
        this.centreTimer = 0;
      }

      // ---- no entry ------------------------------------------------------------------------------
      if (laneChanged && loc.s < T.NO_ENTRY_START_M) {
        const signs = g.signsByLane.get(lane.id);
        if (signs?.some((s) => s.code === '402')) api.report('NO_ENTRY', { details: { sign: '402' }, context: street });
      }

      // ---- remember the lane ~10 m before the stop line -------------------------------------------
      const ap = api.approach();
      if (ap && !ap.onConnector) {
        if (this.originLane && this.originLane.junctionId !== ap.junction.id) this.originLane = undefined;
        if (!this.originLane && ap.distToStopLine <= T.WRONG_LANE_LOOKBACK_M && ap.distToStopLine > -2) this.originLane = { junctionId: ap.junction.id, laneId: lane.id };
      }

      // ---- wrong side of the road? (computed first: it also silences the lane-departure timer) ---------
      const twoWay = !road.oneway && road.lanesBackward.length > 0;
      const rl = roadLateral(road, p.pos);
      const fwd = road.lanesForward.includes(lane.id);
      const wrongSide = twoWay && (fwd ? rl < -T.CENTRE_LINE_M : rl > T.CENTRE_LINE_M);

      // ---- lane departure ----------------------------------------------------------------------------
      const limit = lane.width / 2 - p.width / 2 + T.DEPARTURE_MARGIN_M;
      const intentional = p.indicator === 'left' || p.indicator === 'right';
      const absLat = Math.abs(loc.lateral);
      if (!laneChanged && absLat > limit && Math.abs(p.speed) >= T.DEPARTURE_MIN_SPEED_MPS && !intentional && !wrongSide) {
        this.departureTimer += dt;
        if (this.departureTimer > T.DEPARTURE_S) {
          api.report('LANE_DEPARTURE', { details: { side: loc.lateral > 0 ? 'right' : 'left', lateral: r1(loc.lateral) }, context: street });
          this.departureTimer = 0;
        }
      } else if (laneChanged || intentional || wrongSide || absLat < limit - 0.2) this.departureTimer = 0;

      // ---- solid line crossed ------------------------------------------------------------------------
      if (!laneChanged && this.prevLateral !== undefined && moving) {
        const half = lane.width / 2;
        let crossed: LineType | undefined;
        let side: 'left' | 'right' | undefined;
        if (this.prevLateral > -half && loc.lateral <= -half) {
          crossed = lane.leftLine;
          side = 'left';
        } else if (this.prevLateral < half && loc.lateral >= half) {
          crossed = lane.rightLine;
          side = 'right';
        }
        if (crossed && side && SOLID.has(crossed)) api.report('SOLID_LINE_CROSSED', { details: { line: crossed, side }, context: street });
      }

      // ---- wrong side of a two-way road (once per episode) ------------------------------------------------
      if (twoWay && moving) {
        if (!wrongSide) this.centreReported = false;
        this.centreTimer = wrongSide ? this.centreTimer + dt : 0;
        if (this.centreTimer > T.CENTRE_LINE_S && !this.centreReported) {
          this.centreReported = true;
          api.report('CENTRE_LINE_CROSSED', { details: { offset: r1(rl) }, context: street });
        }
      } else this.centreTimer = 0;

      // ---- against a one-way street (once per episode) ---------------------------------------------------
      if (loc.wrongWay && (road.oneway || road.lanesBackward.length === 0 || Math.abs(loc.headingError) > WRONG_WAY_HEADING)) {
        this.wrongWayTimer += dt;
        if (this.wrongWayTimer > T.WRONG_WAY_S && !this.wrongWayReported) {
          this.wrongWayReported = true;
          api.report('WRONG_WAY', { context: street });
        }
      } else {
        this.wrongWayTimer = 0;
        if (!loc.wrongWay) this.wrongWayReported = false;
      }

      // ---- bus lane ---------------------------------------------------------------------------------------
      if (lane.kind === 'bus' && moving) {
        this.busTimer += dt;
        const exempt = loc.distToLaneEnd < T.BUS_LANE_TURN_EXEMPT_M && p.indicator === 'right';
        if (this.busTimer > T.BUS_LANE_S && !exempt) {
          api.report('BUS_LANE', { context: street });
          this.busTimer = 0;
        }
      } else this.busTimer = 0;

      this.prevLateral = loc.lateral;
      this.lastLaneId = lane.id;
      this.lastConnectorId = undefined;
      this.wideTimer = 0;
      this.cutTimer = 0;
      this.wideReported = false;
      this.cutReported = false;
      this.blockingReported = false;
    } else {
      this.prevLateral = undefined;
      this.departureTimer = 0;
      this.centreTimer = 0;
      this.wrongWayTimer = 0;
      this.busTimer = 0;
    }

    // ---- kerb mount -----------------------------------------------------------------------------------------
    if (loc.onKerb) {
      this.kerbTimer += dt;
      if (this.kerbTimer > T.KERB_MOUNT_S && !this.kerbReported) {
        this.kerbReported = true;
        api.report('KERB_MOUNT');
      }
    } else {
      this.kerbTimer = 0;
      this.kerbReported = false;
    }

    // ---- inside a junction --------------------------------------------------------------------------------------
    if (loc.connectorId) {
      const c = g.connector(loc.connectorId);
      if (c.id !== this.lastConnectorId) {
        this.lastConnectorId = c.id;
        this.wideTimer = 0;
        this.cutTimer = 0;
        this.wideReported = false;
        this.cutReported = false;
      }
      const context = api.junctionContext(c.junctionId);
      const left = isLeftTurn(c.turn);
      const right = isRightTurn(c.turn);
      if ((left || right) && moving) {
        const inside = right ? loc.lateral : -loc.lateral; // positive = towards the inside of the turn
        if (inside > T.WIDE_TURN_M) {
          this.cutTimer += dt;
          this.wideTimer = 0;
        } else if (inside < -T.WIDE_TURN_M) {
          this.wideTimer += dt;
          this.cutTimer = 0;
        } else {
          this.cutTimer = 0;
          this.wideTimer = 0;
        }
        const details = { turn: c.turn, offset: r1(loc.lateral) };
        if (this.cutTimer > T.WIDE_TURN_S && !this.cutReported) {
          this.cutReported = true;
          api.report('CUT_CORNER', { details, context });
        }
        if (this.wideTimer > T.WIDE_TURN_S && !this.wideReported) {
          this.wideReported = true;
          api.report('WIDE_TURN', { details, context });
        }
      }

      if (api.stoppedFor > T.BLOCKING_S && !this.blockingReported) {
        this.blockingReported = true;
        const sFront = loc.s + p.length / 2;
        const exitBlocked =
          vehiclesOn(g, ctx, c.toLane).some((v) => v.s - v.agent.length / 2 < T.BLOCKING_EXIT_FREE_M) ||
          vehiclesOn(g, ctx, c.id).some((v) => v.s - v.agent.length / 2 > sFront && v.s - v.agent.length / 2 - sFront < T.BLOCKING_EXIT_FREE_M);
        if (exitBlocked) api.report('BLOCKING_JUNCTION', { context });
        else {
          // the intended movement may still be ambiguous: any conflict for any movement from the origin lane is a reason to wait
          const movements = g.connectorsFrom(c.fromLane);
          const reason =
            movements.some((k) => conflictAgents(g, ctx, k, 4).length > 0) ||
            movements.some((k) => k.crossings.some((id) => pedestriansAtCrossing(ctx, id).length > 0)) ||
            ctx.signals.stateForConnector(c.id) === 'red';
          if (!reason) api.report('ILLEGAL_STOP', { context: HE.insideJunction, details: { junction: c.junctionId } });
        }
      }
      if (api.stoppedFor === 0) this.blockingReported = false;
    }
  }
}
