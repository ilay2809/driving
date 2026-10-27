/**
 * Navigator — turn-by-turn guidance on the lane graph.
 *
 * Given a route (PathResult) it tracks the player along it, computes the next
 * manoeuvre (turn / roundabout exit / U-turn / arrival), emits 'coach:instruction'
 * every tick for the HUD and speaks through the DialogueManager at 150 m ("בעוד 150
 * מטר פנה ימינה לרחוב X"), at 40 m ("עכשיו פנה ימינה") and before straight-through
 * passages of signalised / complex junctions ("המשך ישר בצומת"). Leaving the route for
 * more than 15 m / 3 s re-routes from the current lane ("לא נורא, נמשיך מכאן").
 *
 * Roundabouts: Israeli roundabouts circulate counter-clockwise (seen from above);
 * exits are counted in travel order — the non-ring exit roads passed from the entry
 * junction to the exit junction along the ring lanes, the taken exit included.
 *
 * Speaker style: `who: 'examiner'` selects terse phrasing ("ימינה.").
 */
import type { EventBus, NavInstruction, Speaker } from '@/core/events';
import type { SimContext, System } from '@/core/sim';
import { dist2, projectOntoPolyline, type Vec2 } from '@/world/geo';
import type { PathResult, RoadGraph } from '@/world/graph';
import type { Connector, Junction, Turn } from '@/world/schema';
import type { DialogueManager } from './dialogue';
import { RouteModel } from './routeModel';
import type { NavKind } from './types';

export interface NavManeuver {
  kind: NavKind;
  /** 'slight' for slight turns (affects phrasing only). */
  flavour?: 'slight';
  /** Segment index of the connector that starts the manoeuvre (-1 for 'arrive'). */
  index: number;
  /** Route distance at which the manoeuvre starts (end of the approach lane). */
  startDist: number;
  /** Route distance after which the manoeuvre is complete. */
  endDist: number;
  junctionId?: string;
  exitNumber?: number;
  streetName?: string;
  turn?: Turn;
  /** The next manoeuvre follows within 50 m ("ומיד שמאלה"). */
  thenKind?: NavKind;
}

export interface DeviationInfo {
  junctionId: string;
  expected?: Turn;
  taken?: Turn;
  time: number;
}

export type Destination = string | Vec2 | { laneId?: string; junctionId?: string; spawnId?: string; pos?: Vec2 };

export interface RouteOptions {
  speak?: boolean;
  who?: Speaker;
  /** Junction ids to pass through before the destination. */
  via?: string[];
}

export interface NavigatorOptions {
  farDistance?: number;
  nearDistance?: number;
  straightDistance?: number;
  /** Metres off the route before re-routing. */
  offRouteMetres?: number;
  /** Seconds off the route before re-routing. */
  offRouteSeconds?: number;
}

const TURN_KINDS = new Set<NavKind>(['turn_left', 'turn_right']);

export class Navigator implements System {
  readonly name = 'navigator';
  private route?: RouteModel;
  private maneuvers: NavManeuver[] = [];
  private speakEnabled = true;
  private who: Speaker = 'instructor';
  private hintIndex = 0;
  private lastDist = 0;
  private located = false;
  private offRouteSince?: number;
  private offRouteMetres = 0;
  private rerouteRetryAt = -Infinity;
  private rerouteSaid = false;
  private announced = new Map<number, { far: boolean; near: boolean; farId?: string }>();
  private override?: NavInstruction;
  private destination?: { laneId: string; endS?: number };
  private pending?: { target: Destination; opts: RouteOptions };
  private lastCtx?: SimContext;
  private lastInstruction?: NavInstruction;
  private prevConnectorId?: string;
  private readonly deviationHandlers = new Set<(info: DeviationInfo) => void>();
  private readonly deviationJunctions = new Set<string>();
  private readonly ringLanes = new Set<string>();
  private readonly far: number;
  private readonly near: number;
  private readonly straightAt: number;
  private readonly offMetres: number;
  private readonly offSeconds: number;

  constructor(
    private readonly graph: RoadGraph,
    private readonly bus: EventBus,
    private readonly dialogue: DialogueManager,
    opts: NavigatorOptions = {},
  ) {
    this.far = opts.farDistance ?? 150;
    this.near = opts.nearDistance ?? 40;
    this.straightAt = opts.straightDistance ?? 60;
    this.offMetres = opts.offRouteMetres ?? 15;
    this.offSeconds = opts.offRouteSeconds ?? 3;
    for (const j of graph.junctions.values()) if (j.roundabout) for (const id of j.roundabout.ringLaneIds) this.ringLanes.add(id);
  }

  // ---- public API ------------------------------------------------------------------

  get hasRoute(): boolean {
    return this.route !== undefined;
  }
  get routeModel(): RouteModel | undefined {
    return this.route;
  }
  get path(): PathResult | undefined {
    return this.route?.path;
  }
  get allManeuvers(): readonly NavManeuver[] {
    return this.maneuvers;
  }
  get instruction(): NavInstruction | undefined {
    return this.lastInstruction;
  }
  /** Route distance of the player at the last update. */
  get distanceAlongRoute(): number {
    return this.lastDist;
  }
  get onRoute(): boolean {
    return this.located;
  }
  get speaker(): Speaker {
    return this.who;
  }

  /** Follow a path (null clears the route). */
  setRoute(path: PathResult | null, opts: RouteOptions & { endS?: number } = {}): void {
    this.pending = undefined;
    this.resetRouteState();
    if (!path || path.laneIds.length === 0) {
      this.route = undefined;
      this.maneuvers = [];
      this.destination = undefined;
      this.lastInstruction = undefined;
      return;
    }
    this.speakEnabled = opts.speak ?? true;
    this.who = opts.who ?? this.who;
    this.route = new RouteModel(this.graph, path, { endS: opts.endS });
    this.destination = { laneId: this.route.destinationLaneId, endS: opts.endS };
    this.maneuvers = this.buildManeuvers(this.route);
  }

  /**
   * Path-find from the player's current lane to a lane / junction / spawn point / position
   * (optionally via junctions). Before the first update the request is kept pending.
   * Returns false when no route exists.
   */
  setDestination(target: Destination, opts: RouteOptions = {}): boolean {
    const start = this.currentLaneId();
    if (!start) {
      this.pending = { target, opts };
      return true;
    }
    const built = this.buildRoute(start, target, opts.via ?? []);
    if (!built) return false;
    this.setRoute(built.path, { speak: opts.speak, who: opts.who, endS: built.endS });
    return true;
  }

  /** Route through an ordered list of junction ids from the current lane. */
  routeViaJunctions(waypoints: string[], opts: Omit<RouteOptions, 'via'> = {}): boolean {
    if (waypoints.length === 0) return false;
    const last = waypoints[waypoints.length - 1]!;
    return this.setDestination({ junctionId: last }, { ...opts, via: waypoints.slice(0, -1) });
  }

  /** Repeat the current instruction (the player pressed "repeat"). */
  announceNow(): void {
    if (this.override) {
      this.dialogue.say({ who: this.who, text: this.override.text, priority: 2 });
      return;
    }
    const m = this.currentManeuver();
    if (!this.route || !m) {
      this.dialogue.sayLine(this.key('no_route'), undefined, { priority: 2 });
      return;
    }
    const distance = this.distanceTo(m);
    if (m.kind === 'straight') {
      this.dialogue.sayLine(this.key(distance <= this.near ? 'now.straight' : 'far.straight'), undefined, { priority: 2 });
      return;
    }
    if (distance > this.near) this.dialogue.sayLine(this.key(`far.${this.phraseKind(m)}`), this.params(m, distance), { priority: 2 });
    else this.dialogue.sayLine(this.key(`now.${this.phraseKind(m)}`), this.params(m, distance), { priority: 2 });
  }

  /** Metres left to the destination along the route (from the last located position). */
  remainingDistance(): number {
    if (!this.route) return 0;
    return Math.max(0, this.route.length - this.lastDist);
  }

  /** Within 8 m of the route end. */
  get atDestination(): boolean {
    if (!this.route) return false;
    if (this.located && this.remainingDistance() <= 8) return true;
    return this.lastCtx ? this.route.distanceToEnd(this.lastCtx.player.pos) <= 8 : false;
  }

  /** Turn the route takes at a junction (first passage at/after the player's position). */
  expectedTurnAt(junctionId: string): Turn | undefined {
    return this.expectedConnectorAt(junctionId)?.turn;
  }

  expectedConnectorAt(junctionId: string): Connector | undefined {
    if (!this.route) return undefined;
    let fallback: Connector | undefined;
    for (const s of this.route.segments) {
      if (s.kind !== 'connector') continue;
      const c = this.graph.connector(s.id);
      if (c.junctionId !== junctionId) continue;
      if (s.index >= this.hintIndex) return c;
      fallback = c;
    }
    return fallback;
  }

  /** The route connector leaving a lane (for the danger predictor / lane checks). */
  expectedConnectorFrom(laneId: string): Connector | undefined {
    if (!this.route) return undefined;
    for (const s of this.route.segments) {
      if (s.kind !== 'connector') continue;
      const c = this.graph.connector(s.id);
      if (c.fromLane === laneId && s.index >= this.hintIndex) return c;
    }
    return undefined;
  }

  /** The manoeuvre the player is heading for. */
  currentManeuver(): NavManeuver | undefined {
    for (const m of this.maneuvers) if (m.endDist > this.lastDist - 0.5) return m;
    return this.maneuvers[this.maneuvers.length - 1];
  }

  /** Route distance from the front of the car to the manoeuvre. */
  distanceTo(m: NavManeuver): number {
    const half = this.lastCtx ? this.lastCtx.player.length / 2 : 2.2;
    return Math.max(0, m.startDist - this.lastDist - half);
  }

  /**
   * Replace the guidance with a manual instruction (e.g. the examiner's "עצור בצד").
   * While set, route announcements and off-route handling are paused; null restores them.
   */
  setOverride(instr: Omit<NavInstruction, 'distance'> & { distance?: number } | null): void {
    this.override = instr ? { distance: 0, ...instr } : undefined;
  }

  get overrideInstruction(): NavInstruction | undefined {
    return this.override;
  }

  /** Re-route from the current lane to the stored destination (e.g. after a planned U-turn). */
  reroute(opts: { silent?: boolean } = {}): boolean {
    if (!this.destination) return false;
    const start = this.currentLaneId();
    if (!start) return false;
    const built = this.buildRoute(start, { laneId: this.destination.laneId }, [], this.destination.endS);
    if (!built) return false;
    const speak = this.speakEnabled;
    const who = this.who;
    this.setRoute(built.path, { speak, who, endS: built.endS });
    if (!opts.silent && speak && !this.rerouteSaid) {
      this.rerouteSaid = true;
      this.dialogue.sayLine(this.key('reroute'), undefined, { priority: 2, key: 'nav.reroute', cooldown: 20 });
    }
    this.rerouteSaid = true;
    return true;
  }

  /** Subscribe to route deviations at junctions (a turn different from the planned one). */
  onDeviation(handler: (info: DeviationInfo) => void): () => void {
    this.deviationHandlers.add(handler);
    return () => this.deviationHandlers.delete(handler);
  }

  update(ctx: SimContext): void {
    this.lastCtx = ctx;
    if (this.pending) {
      const p = this.pending;
      const start = this.currentLaneId();
      if (start) {
        this.pending = undefined;
        this.setDestination(p.target, p.opts);
      }
    }
    if (!this.route) return;
    if (this.override) {
      this.lastInstruction = this.override;
      this.bus.emit('coach:instruction', this.override);
      this.detectDeviation(ctx);
      return;
    }
    const loc = ctx.localisation;
    const found = loc.wrongWay ? undefined : this.route.locate(loc, this.hintIndex);
    if (found) {
      this.located = true;
      this.hintIndex = found.index;
      this.lastDist = found.dist;
      this.offRouteSince = undefined;
      this.offRouteMetres = 0;
    } else {
      this.located = false;
      if (this.offRouteSince === undefined) {
        this.offRouteSince = ctx.time;
        this.offRouteMetres = 0;
      } else this.offRouteMetres += Math.abs(ctx.player.speed) * ctx.dt;
      const over = ctx.time - this.offRouteSince > this.offSeconds || this.offRouteMetres > this.offMetres;
      if (over && ctx.time >= this.rerouteRetryAt && this.currentLaneId()) {
        if (!this.reroute()) this.rerouteRetryAt = ctx.time + 5;
        else {
          // the new route starts on the current lane: locate again right away
          const again = this.route.locate(loc, 0);
          if (again) {
            this.located = true;
            this.hintIndex = again.index;
            this.lastDist = again.dist;
          }
        }
      }
    }
    this.detectDeviation(ctx);
    const m = this.currentManeuver();
    if (!m) return;
    const distance = this.distanceTo(m);
    const instr = this.instructionFor(m, distance);
    this.lastInstruction = instr;
    this.bus.emit('coach:instruction', instr);
    if (this.speakEnabled && this.located) this.announce(m, distance);
  }

  // ---- internals ----------------------------------------------------------------------

  private resetRouteState(): void {
    this.hintIndex = 0;
    this.lastDist = 0;
    this.located = false;
    this.offRouteSince = undefined;
    this.offRouteMetres = 0;
    this.rerouteSaid = false;
    this.announced.clear();
    this.deviationJunctions.clear();
  }

  private currentLaneId(): string | undefined {
    const loc = this.lastCtx?.localisation;
    if (!loc) return undefined;
    if (loc.laneId && this.graph.lanes.has(loc.laneId)) return loc.laneId;
    if (loc.connectorId) return this.graph.connectors.get(loc.connectorId)?.toLane;
    if (this.lastCtx) return this.graph.nearestLane(this.lastCtx.player.pos, { heading: this.lastCtx.player.heading, maxDist: 15 })?.lane.id;
    return undefined;
  }

  private resolveTarget(target: Destination): { laneId?: string; junctionId?: string; endS?: number } | undefined {
    if (typeof target === 'string') {
      if (this.graph.lanes.has(target)) return { laneId: target };
      if (this.graph.junctions.has(target)) return { junctionId: target };
      const sp = this.graph.spawnPoints.get(target);
      if (sp) return this.resolveTarget({ spawnId: target });
      return undefined;
    }
    if (Array.isArray(target)) return this.resolveTarget({ pos: target });
    if (target.laneId) return { laneId: target.laneId };
    if (target.junctionId) return { junctionId: target.junctionId };
    if (target.spawnId) {
      const sp = this.graph.spawnPoints.get(target.spawnId);
      if (!sp) return undefined;
      if (sp.laneId && this.graph.lanes.has(sp.laneId)) {
        const pr = projectOntoPolyline(this.graph.lane(sp.laneId).centre, sp.pos);
        return { laneId: sp.laneId, endS: pr.s };
      }
      const m = this.graph.nearestLane(sp.pos, { heading: sp.heading, maxDist: 20, kinds: ['drive'] });
      return m ? { laneId: m.lane.id, endS: m.s } : undefined;
    }
    if (target.pos) {
      const m = this.graph.nearestLane(target.pos, { maxDist: 30, kinds: ['drive'] });
      return m ? { laneId: m.lane.id, endS: m.s } : undefined;
    }
    return undefined;
  }

  private buildRoute(startLane: string, target: Destination, via: string[], endSOverride?: number): { path: PathResult; endS?: number } | undefined {
    const t = this.resolveTarget(target);
    if (!t) return undefined;
    const endS = endSOverride ?? t.endS;
    let path: PathResult | undefined;
    if (t.junctionId) {
      path = this.graph.routeViaJunctions(startLane, [...via, t.junctionId]);
      return path ? { path } : undefined;
    }
    const dest = t.laneId!;
    if (via.length > 0) {
      const first = this.graph.routeViaJunctions(startLane, via);
      if (!first) return undefined;
      const last = first.laneIds[first.laneIds.length - 1]!;
      const rest = this.findPathMaybeLoop(last, dest, endS);
      if (!rest) return undefined;
      path = { laneIds: first.laneIds.concat(rest.laneIds.slice(1)), connectorIds: first.connectorIds.concat(rest.connectorIds), length: first.length + rest.length - this.graph.lane(last).length };
    } else path = this.findPathMaybeLoop(startLane, dest, endS);
    return path ? { path, endS } : undefined;
  }

  /** findPath, but when the destination is the current lane behind the car, loop around the block. */
  private findPathMaybeLoop(from: string, to: string, endS?: number): PathResult | undefined {
    if (from === to && endS !== undefined && this.lastCtx?.localisation.laneId === from && this.lastCtx.localisation.s > endS + 2) {
      let best: PathResult | undefined;
      for (const c of this.graph.connectorsFrom(from)) {
        const rest = this.graph.findPath(c.toLane, to);
        if (!rest) continue;
        const p: PathResult = { laneIds: [from, ...rest.laneIds], connectorIds: [c.id, ...rest.connectorIds], length: this.graph.lane(from).length + c.length + rest.length };
        if (!best || p.length < best.length) best = p;
      }
      return best;
    }
    return this.graph.findPath(from, to);
  }

  private isComplex(j: Junction): boolean {
    const roads = new Set<string>();
    for (const a of j.approaches) roads.add(a.roadId);
    for (const e of j.exits) roads.add(e.roadId);
    return roads.size >= 3 || j.approaches.some((a) => a.control === 'signals');
  }

  private roadName(laneId: string): string | undefined {
    return this.graph.road(this.graph.lane(laneId).roadId).name;
  }

  private buildManeuvers(route: RouteModel): NavManeuver[] {
    const segs = route.segments;
    const list: NavManeuver[] = [];
    let i = 0;
    while (i < segs.length) {
      const s = segs[i]!;
      if (s.kind !== 'connector') {
        i++;
        continue;
      }
      const conn = this.graph.connector(s.id);
      const j = this.graph.junction(conn.junctionId);
      const fromRing = this.ringLanes.has(conn.fromLane);
      const toRing = this.ringLanes.has(conn.toLane);
      if (toRing || fromRing) {
        if (fromRing && toRing) {
          i++;
          continue; // circulating without an entry on this route (handled by the exit case)
        }
        const rb = this.walkRoundabout(route, i);
        list.push({ kind: 'roundabout_exit', index: i, startDist: s.start, endDist: rb.endDist, junctionId: conn.junctionId, exitNumber: rb.exitNumber, streetName: rb.streetName });
        i = rb.exitIndex + 1;
        continue;
      }
      const fromName = this.roadName(conn.fromLane);
      const toName = this.roadName(conn.toLane);
      const streetName = toName && toName !== fromName ? toName : undefined;
      const base = { index: i, startDist: s.start, endDist: s.start + s.length, junctionId: conn.junctionId, turn: conn.turn, streetName };
      switch (conn.turn) {
        case 'left':
        case 'sharp_left':
          list.push({ kind: 'turn_left', ...base });
          break;
        case 'right':
        case 'sharp_right':
          list.push({ kind: 'turn_right', ...base });
          break;
        case 'slight_left':
          list.push({ kind: 'turn_left', flavour: 'slight', ...base });
          break;
        case 'slight_right':
          list.push({ kind: 'turn_right', flavour: 'slight', ...base });
          break;
        case 'uturn':
          list.push({ kind: 'uturn', ...base });
          break;
        default:
          if (j.kind === 'junction' && this.isComplex(j)) list.push({ kind: 'straight', ...base, streetName: undefined });
      }
      i++;
    }
    list.push({ kind: 'arrive', index: -1, startDist: route.length, endDist: route.length + 1, streetName: this.roadName(route.destinationLaneId) });
    for (let k = 0; k + 1 < list.length; k++) {
      const a = list[k]!;
      const b = list[k + 1]!;
      if (TURN_KINDS.has(b.kind) && b.startDist - a.endDist < 50 && TURN_KINDS.has(a.kind)) a.thenKind = b.kind;
    }
    return list;
  }

  /**
   * From segment `from` (the entry connector, or the current position on the ring),
   * count the exit roads passed along the ring until the route leaves it.
   */
  private walkRoundabout(route: RouteModel, from: number): { exitNumber?: number; exitIndex: number; endDist: number; streetName?: string } {
    const segs = route.segments;
    let count = 0;
    for (let k = from; k < segs.length; k++) {
      const s = segs[k]!;
      if (s.kind !== 'connector') continue;
      const c = this.graph.connector(s.id);
      if (!this.ringLanes.has(c.fromLane)) continue; // the entry movement: exits at the entry node are not counted
      const j = this.graph.junction(c.junctionId);
      if (this.ringLanes.has(c.toLane)) {
        count += j.exits.filter((e) => !e.laneIds.some((id) => this.ringLanes.has(id))).length;
        continue;
      }
      count += 1;
      return { exitNumber: count, exitIndex: k, endDist: s.start + s.length, streetName: this.roadName(c.toLane) };
    }
    const last = segs[segs.length - 1]!;
    return { exitNumber: undefined, exitIndex: segs.length - 1, endDist: last.start + last.length };
  }

  private key(suffix: string): string {
    return `nav.${this.who === 'examiner' ? 'e' : 'i'}.${suffix}`;
  }

  private phraseKind(m: NavManeuver): string {
    if (m.flavour === 'slight') return m.kind === 'turn_left' ? 'slight_left' : 'slight_right';
    return m.kind;
  }

  private ordinal(n: number | undefined): string {
    if (!n) return '';
    return this.dialogue.lines.line(`nav.ordinal.${Math.min(6, Math.max(1, n))}`);
  }

  private params(m: NavManeuver, distance: number): Record<string, string | number> {
    // "רחוב האלון" → " לרחוב האלון"; a bare name ("הדקל") → " לרחוב הדקל"
    const named = m.streetName ? /^(רחוב|שדרות|שדרת|דרך|סמטת|כיכר|שביל)\s/.test(m.streetName) : false;
    const streetPhrase = m.streetName ? this.dialogue.lines.line(named ? 'nav.street_named' : 'nav.street', { street: m.streetName }) : '';
    const thenPhrase = m.thenKind === 'turn_right' ? this.dialogue.lines.line('nav.then_right') : m.thenKind === 'turn_left' ? this.dialogue.lines.line('nav.then_left') : '';
    return { distance: roundDistance(distance), streetPhrase, thenPhrase, ordinal: this.ordinal(m.exitNumber), street: m.streetName ?? '' };
  }

  private instructionFor(m: NavManeuver, distance: number): NavInstruction {
    const p = this.params(m, distance);
    const text = this.dialogue.lines.line(`nav.hud.${this.phraseKind(m)}`, p);
    return { kind: m.kind, text, distance: Math.round(distance), junctionId: m.junctionId, exitNumber: m.exitNumber, streetName: m.streetName };
  }

  /**
   * Announcements. The far line ("בעוד 150 מטר…") carries a distance, so it is only
   * spoken when the instructor is free to say it right away (between 150 m and 60 m);
   * a queued copy would be stale by the time it played. The near line ("עכשיו…") is
   * time-critical: it cuts a far line that is still playing and interrupts chit-chat
   * (priority 3) while the car is moving.
   */
  private announce(m: NavManeuver, distance: number): void {
    const idx = this.maneuvers.indexOf(m);
    let st = this.announced.get(idx);
    if (!st) {
      st = { far: false, near: false };
      this.announced.set(idx, st);
    }
    const busy = this.dialogue.speaking || this.dialogue.pending.length > 0;
    const moving = (this.lastCtx?.player.speed ?? 0) > 2;
    if (m.kind === 'straight') {
      if (!st.near && distance <= this.straightAt && (!busy || distance <= this.near)) {
        st.near = st.far = true;
        this.dialogue.sayLine(this.key('far.straight'), undefined, { priority: 2, key: `nav.m${idx}.far` });
      }
      return;
    }
    if (!st.far && distance <= this.far) {
      if (distance < 60) st.far = true; // too late for a distance announcement
      else if (!busy) {
        st.far = true;
        st.farId = this.dialogue.sayLine(this.key(`far.${this.phraseKind(m)}`), this.params(m, distance), { priority: 2, key: `nav.m${idx}.far` });
      }
    }
    if (!st.near && distance <= this.near) {
      st.near = true;
      if (st.farId) this.dialogue.cancel(st.farId);
      this.dialogue.sayLine(this.key(`now.${this.phraseKind(m)}`), this.params(m, distance), { priority: moving ? 3 : 2, key: `nav.m${idx}.near` });
    }
  }

  private detectDeviation(ctx: SimContext): void {
    const cid = ctx.localisation.connectorId;
    if (cid === this.prevConnectorId) return;
    this.prevConnectorId = cid;
    if (!cid || !this.route) return;
    const conn = this.graph.connectors.get(cid);
    if (!conn || this.deviationJunctions.has(conn.junctionId)) return;
    if (this.route.indexOf('connector', cid, 0) >= 0) return;
    const expected = this.expectedConnectorAt(conn.junctionId);
    if (!expected || expected.id === cid || expected.fromLane !== conn.fromLane) return;
    this.deviationJunctions.add(conn.junctionId);
    const info: DeviationInfo = { junctionId: conn.junctionId, expected: expected.turn, taken: conn.turn, time: ctx.time };
    for (const h of this.deviationHandlers) h(info);
  }
}

/** Round an announcement distance to a spoken-friendly value (10 m steps, 150 cap). */
export function roundDistance(d: number): number {
  if (d >= 145) return 150;
  return Math.max(10, Math.round(d / 10) * 10);
}

export function samePoint(a: Vec2, b: Vec2, tol = 0.5): boolean {
  return dist2(a, b) <= tol;
}
