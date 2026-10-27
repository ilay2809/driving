/**
 * Traffic-signal runtime: turns the static controllers of the world file into
 * time-dependent signal states. Implements `SignalStateProvider` for the rules engine,
 * the coach and the renderer, and `System` for the frame loop.
 *
 * Cycle of a controller = for each phase in order:
 *   red_amber (1.5 s, vehicle groups turning green) → green (phase.duration)
 *   → flashing_green (3 s) → amber (3 s) → all-red (2 s)
 * (constants: SIGNAL_TIMING in src/world/schema.ts). The cycle starts at world time
 * `controller.offset`.
 *
 * Pedestrian groups are green while their phase is green, flashing_green during the
 * last 5 s of the green and red otherwise (they never show red_amber / amber).
 *
 * The state of a group is computed on demand from `ctx.time` (per-group interval
 * tables built once; results cached per frame), so no per-frame iteration over the
 * controllers is needed.
 *
 * Overrides (lesson scripting): `override(groupId, state)` forces a group. When any
 * group of a controller is forced into a "go" state (green / flashing_green / amber /
 * red_amber), every group of that controller that is not compatible with it (= never
 * green together in any phase) is forced red. Forcing a group red leaves the others on
 * their normal cycle.
 *
 * `coach:request` {kind:'set_signal', payload:{junctionId?, groupId?, state}}:
 *   - groupId      → override that group (state 'release' / undefined clears it).
 *   - junctionId   → the whole controller is frozen: the vehicle group of the player's
 *                    approach gets `state`, every other vehicle group red, pedestrian
 *                    groups compatible with the player's group get green when `state`
 *                    is green and red otherwise, all other pedestrian groups red.
 *                    The player's approach = the approach of `localisation.laneId`
 *                    when that lane ends at the junction, else the approach whose stop
 *                    line is nearest to the player and roughly in its heading.
 *   - neither      → the junction ahead of the player (localisation.nextJunctionId /
 *                    the end of the player's lane), same behaviour as junctionId.
 *   - state 'release' clears all overrides of the addressed controller (or everything).
 */
import type { EventBus, SimEventMap } from '@/core/events';
import type { SignalStateProvider, SimContext, System } from '@/core/sim';
import type { Localisation, VehicleState } from '@/core/types';
import { angleDiff, dist2, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import { SIGNAL_TIMING, type SignalController, type SignalGroup, type SignalState, type WorldFile } from '@/world/schema';
import { mod } from './util';

/** Last 5 s of a pedestrian green flash (pedestrian signals 718/719 in Israel blink before red). */
export const PEDESTRIAN_FLASH_SECONDS = 5;

const GO_STATES: ReadonlySet<SignalState> = new Set<SignalState>(['green', 'flashing_green', 'amber', 'red_amber']);

interface Interval {
  start: number;
  end: number;
  state: SignalState;
}

interface ControllerPlan {
  controller: SignalController;
  cycle: number;
  /** Merged state intervals per group over one cycle (sorted, contiguous, covering [0, cycle)). */
  intervals: Map<string, Interval[]>;
  /** For each group: groups that are green together with it in at least one phase (incl. itself). */
  compatible: Map<string, Set<string>>;
  groups: Map<string, SignalGroup>;
}

/** Build the per-group interval table of one controller (exported for tests). */
export function buildControllerPlan(controller: SignalController): ControllerPlan {
  const { redAmber, flashingGreen, amber, allRed } = SIGNAL_TIMING;
  const groups = new Map(controller.groups.map((g) => [g.id, g]));
  const raw = new Map<string, Interval[]>();
  for (const g of controller.groups) raw.set(g.id, []);
  const compatible = new Map<string, Set<string>>();
  for (const g of controller.groups) compatible.set(g.id, new Set([g.id]));

  let t = 0;
  for (const phase of controller.phases) {
    const greenStart = t + redAmber;
    const greenEnd = greenStart + phase.duration;
    const flashEnd = greenEnd + flashingGreen;
    const amberEnd = flashEnd + amber;
    for (const gid of phase.green) {
      const g = groups.get(gid);
      if (!g) continue;
      const list = raw.get(gid)!;
      if (g.pedestrian) {
        const flashStart = Math.max(greenStart, greenEnd - PEDESTRIAN_FLASH_SECONDS);
        if (flashStart > greenStart) list.push({ start: greenStart, end: flashStart, state: 'green' });
        list.push({ start: flashStart, end: greenEnd, state: 'flashing_green' });
      } else {
        list.push({ start: t, end: greenStart, state: 'red_amber' });
        list.push({ start: greenStart, end: greenEnd, state: 'green' });
        list.push({ start: greenEnd, end: flashEnd, state: 'flashing_green' });
        list.push({ start: flashEnd, end: amberEnd, state: 'amber' });
      }
      for (const other of phase.green) compatible.get(gid)?.add(other);
    }
    t = amberEnd + allRed;
  }
  const cycle = Math.max(t, 1);
  const intervals = new Map<string, Interval[]>();
  for (const [gid, list] of raw) {
    list.sort((a, b) => a.start - b.start);
    const filled: Interval[] = [];
    let cursor = 0;
    for (const iv of list) {
      if (iv.start > cursor + 1e-9) filled.push({ start: cursor, end: iv.start, state: 'red' });
      filled.push({ start: Math.max(iv.start, cursor), end: iv.end, state: iv.state });
      cursor = Math.max(cursor, iv.end);
    }
    if (cursor < cycle - 1e-9) filled.push({ start: cursor, end: cycle, state: 'red' });
    // merge neighbours with the same state
    const merged: Interval[] = [];
    for (const iv of filled) {
      const last = merged[merged.length - 1];
      if (last && last.state === iv.state && Math.abs(last.end - iv.start) < 1e-9) last.end = iv.end;
      else merged.push({ ...iv });
    }
    intervals.set(gid, merged);
  }
  return { controller, cycle, intervals, compatible, groups };
}

export class SignalSystem implements SignalStateProvider, System {
  readonly name = 'signals';
  private time = 0;
  private plans = new Map<string, ControllerPlan>();
  private groupController = new Map<string, string>();
  private overrides = new Map<string, SignalState>();
  /** Controllers with at least one "go" override → set of forced-go group ids. */
  private goOverrides = new Map<string, Set<string>>();
  private cache = new Map<string, SignalState>();
  private cacheTime = NaN;
  private bus?: EventBus;
  private unsubscribe?: () => void;
  private lastPlayer?: { state: VehicleState; loc: Localisation };

  constructor(
    readonly world: WorldFile,
    readonly graph: RoadGraph,
  ) {
    for (const c of world.signals) {
      const plan = buildControllerPlan(c);
      this.plans.set(c.id, plan);
      for (const g of c.groups) this.groupController.set(g.id, c.id);
    }
  }

  /** Attach to a bus explicitly (the frame loop does this automatically through `update`). */
  attach(bus: EventBus): void {
    if (this.bus === bus) return;
    this.unsubscribe?.();
    this.bus = bus;
    this.unsubscribe = bus.on('coach:request', (req) => this.onCoachRequest(req));
  }

  update(ctx: SimContext): void {
    this.attach(ctx.bus);
    this.lastPlayer = { state: ctx.player, loc: ctx.localisation };
    this.setTime(ctx.time);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.bus = undefined;
  }

  /** Set the simulation time directly (tests / harnesses without a frame loop). */
  setTime(time: number): void {
    this.time = time;
  }

  /** Let the coach-request handler know where the player is (when no frame loop runs). */
  setPlayer(state: VehicleState, loc: Localisation): void {
    this.lastPlayer = { state, loc };
  }

  get currentTime(): number {
    return this.time;
  }

  /** Cycle length of a controller (s). */
  cycleLength(controllerId: string): number {
    return this.plans.get(controllerId)?.cycle ?? 0;
  }

  controllerOf(groupId: string): string | undefined {
    return this.groupController.get(groupId);
  }

  private phaseTime(plan: ControllerPlan): number {
    return mod(this.time - plan.controller.offset, plan.cycle);
  }

  private scheduled(plan: ControllerPlan, groupId: string, t: number): Interval | undefined {
    const list = plan.intervals.get(groupId);
    if (!list) return undefined;
    for (const iv of list) if (t >= iv.start && t < iv.end) return iv;
    return list[list.length - 1];
  }

  private forcedRed(controllerId: string, groupId: string): boolean {
    const go = this.goOverrides.get(controllerId);
    if (!go || go.size === 0) return false;
    const plan = this.plans.get(controllerId)!;
    const compat = plan.compatible.get(groupId);
    for (const g of go) if (!compat?.has(g)) return true;
    return false;
  }

  stateOf(groupId: string): SignalState {
    if (this.cacheTime !== this.time) {
      this.cache.clear();
      this.cacheTime = this.time;
    }
    const cached = this.cache.get(groupId);
    if (cached) return cached;
    const state = this.compute(groupId);
    this.cache.set(groupId, state);
    return state;
  }

  private compute(groupId: string): SignalState {
    const ov = this.overrides.get(groupId);
    if (ov) return ov;
    const cid = this.groupController.get(groupId);
    if (!cid) return 'off';
    if (this.forcedRed(cid, groupId)) return 'red';
    const plan = this.plans.get(cid)!;
    return this.scheduled(plan, groupId, this.phaseTime(plan))?.state ?? 'off';
  }

  stateForConnector(connectorId: string): SignalState | undefined {
    const gid = this.graph.connectorSignalGroup.get(connectorId);
    return gid ? this.stateOf(gid) : undefined;
  }

  stateForCrossing(crossingId: string): SignalState | undefined {
    const gid = this.graph.crossings.get(crossingId)?.signalGroup;
    return gid ? this.stateOf(gid) : undefined;
  }

  timeToChange(groupId: string): number {
    const cid = this.groupController.get(groupId);
    if (!cid) return Infinity;
    if (this.overrides.has(groupId) || this.forcedRed(cid, groupId)) return Infinity;
    const plan = this.plans.get(cid)!;
    const list = plan.intervals.get(groupId);
    if (!list || list.length <= 1) return Infinity;
    const t = this.phaseTime(plan);
    let idx = list.findIndex((iv) => t >= iv.start && t < iv.end);
    if (idx < 0) idx = list.length - 1;
    let remaining = list[idx]!.end - t;
    // walk forward (wrapping) while the state does not change
    let i = idx;
    for (let n = 0; n < list.length; n++) {
      const next = list[(i + 1) % list.length]!;
      if (next.state !== list[idx]!.state) break;
      remaining += next.end - next.start;
      i = (i + 1) % list.length;
    }
    return remaining;
  }

  override(groupId: string, state: SignalState | undefined): void {
    const cid = this.groupController.get(groupId);
    if (!cid) return;
    if (state === undefined) this.overrides.delete(groupId);
    else this.overrides.set(groupId, state);
    let go = this.goOverrides.get(cid);
    if (!go) {
      go = new Set();
      this.goOverrides.set(cid, go);
    }
    if (state !== undefined && GO_STATES.has(state)) go.add(groupId);
    else go.delete(groupId);
    this.cacheTime = NaN;
  }

  /** Clear overrides of one controller (or all). */
  release(controllerId?: string): void {
    for (const gid of Array.from(this.overrides.keys())) {
      if (!controllerId || this.groupController.get(gid) === controllerId) this.overrides.delete(gid);
    }
    if (controllerId) this.goOverrides.delete(controllerId);
    else this.goOverrides.clear();
    this.cacheTime = NaN;
  }

  /** Ids of groups currently overridden. */
  get overriddenGroups(): string[] {
    return Array.from(this.overrides.keys());
  }

  /** Vehicle signal group of the player's approach at a junction (see the class comment). */
  playerGroupAt(junctionId: string, player?: { state: VehicleState; loc: Localisation }): string | undefined {
    const junction = this.graph.junctions.get(junctionId);
    if (!junction) return undefined;
    const p = player ?? this.lastPlayer;
    if (p?.loc.laneId) {
      const ap = this.graph.approachOf(p.loc.laneId);
      if (ap && ap.junction.id === junctionId && ap.approach.signalGroup) return ap.approach.signalGroup;
    }
    let best: { id: string; score: number } | undefined;
    for (const a of junction.approaches) {
      if (!a.signalGroup) continue;
      let score = 0;
      if (p) {
        const mid: Vec2 = a.stopLine ? [(a.stopLine[0][0] + a.stopLine[1][0]) / 2, (a.stopLine[0][1] + a.stopLine[1][1]) / 2] : junction.position;
        score = dist2(p.state.pos, mid) + Math.abs(angleDiff(p.state.heading, a.heading)) * 20;
      }
      if (!best || score < best.score) best = { id: a.signalGroup, score };
    }
    return best?.id;
  }

  /** Freeze a whole controller around the player's approach (see the class comment). */
  setJunction(junctionId: string, state: SignalState, player?: { state: VehicleState; loc: Localisation }): void {
    const junction = this.graph.junctions.get(junctionId);
    const cid = junction?.signalController;
    if (!cid) return;
    const plan = this.plans.get(cid);
    if (!plan) return;
    const mine = this.playerGroupAt(junctionId, player);
    this.release(cid);
    for (const g of plan.controller.groups) {
      if (g.id === mine) this.override(g.id, state);
      else if (g.pedestrian) this.override(g.id, mine && state === 'green' && plan.compatible.get(mine)?.has(g.id) ? 'green' : 'red');
      else this.override(g.id, 'red');
    }
  }

  private onCoachRequest(req: SimEventMap['coach:request']): void {
    if (req.kind !== 'set_signal') return;
    const payload = req.payload ?? {};
    const rawState = payload['state'];
    const state = typeof rawState === 'string' && rawState !== 'release' ? (rawState as SignalState) : undefined;
    const groupId = typeof payload['groupId'] === 'string' ? (payload['groupId'] as string) : undefined;
    let junctionId = typeof payload['junctionId'] === 'string' ? (payload['junctionId'] as string) : undefined;
    if (groupId) {
      if (state) this.override(groupId, state);
      else this.override(groupId, undefined);
      return;
    }
    if (!junctionId) {
      const loc = this.lastPlayer?.loc;
      junctionId = loc?.nextJunctionId ?? (loc?.laneId ? this.graph.lanes.get(loc.laneId)?.to : undefined) ?? loc?.junctionId;
      if (!junctionId && this.lastPlayer) {
        const near = this.graph.junctionsWithin(this.lastPlayer.state.pos, 80).filter((j) => j.signalController);
        near.sort((a, b) => dist2(a.position, this.lastPlayer!.state.pos) - dist2(b.position, this.lastPlayer!.state.pos));
        junctionId = near[0]?.id;
      }
    }
    if (!junctionId) {
      if (!state) this.release();
      return;
    }
    const cid = this.graph.junctions.get(junctionId)?.signalController;
    if (!state) {
      this.release(cid);
      return;
    }
    this.setJunction(junctionId, state);
  }
}
