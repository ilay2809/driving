/**
 * Test helpers for the coach module: a fake SimContext on the synthetic training
 * ground with a controllable signal provider, a traffic array and a tiny map-matching
 * localiser, plus helpers to move the player and step the systems.
 *
 * Also used by the dev harness (src/dev/coach.ts) to drive a car along a route.
 */
import { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS, defaultVehicleState, emptyLocalisation, type Settings, type SignalStateProvider, type SimContext, type System } from '@/core/sim';
import type { Localisation, SimMode, TrafficAgentState, VehicleState } from '@/core/types';
import { angleDiff, forwardOf, type Vec2 } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import type { SignalState, WorldFile } from '@/world/schema';
import { buildTrainingGround } from '@/world/testWorld';
import type { RouteModel } from './routeModel';

export class FakeSignals implements SignalStateProvider {
  readonly states = new Map<string, SignalState>();
  readonly overrides = new Map<string, SignalState>();
  defaultState: SignalState = 'green';
  ttc = 10;
  constructor(private readonly graph: RoadGraph) {}
  set(groupId: string, state: SignalState): void {
    this.states.set(groupId, state);
  }
  /** Set every group of a junction's controller (vehicle groups only unless `all`). */
  setJunction(junctionId: string, state: SignalState, all = false): void {
    const j = this.graph.junction(junctionId);
    const ctrl = j.signalController ? this.graph.signals.get(j.signalController) : undefined;
    if (!ctrl) return;
    for (const g of ctrl.groups) if (all || !g.pedestrian) this.states.set(g.id, state);
  }
  stateOf(groupId: string): SignalState {
    return this.overrides.get(groupId) ?? this.states.get(groupId) ?? this.defaultState;
  }
  stateForConnector(connectorId: string): SignalState | undefined {
    const g = this.graph.connectorSignalGroup.get(connectorId);
    return g ? this.stateOf(g) : undefined;
  }
  stateForCrossing(crossingId: string): SignalState | undefined {
    const g = this.graph.crossings.get(crossingId)?.signalGroup;
    return g ? this.stateOf(g) : undefined;
  }
  timeToChange(): number {
    return this.ttc;
  }
  override(groupId: string, state: SignalState | undefined): void {
    if (state) this.overrides.set(groupId, state);
    else this.overrides.delete(groupId);
  }
}

/** Minimal map-matching localiser (the real one lives in src/rules/localiser.ts). */
export function localise(graph: RoadGraph, player: VehicleState, prev?: Localisation): Localisation {
  const loc = emptyLocalisation();
  const lane = graph.nearestLane(player.pos, { heading: player.heading, maxDist: 6, preferLaneId: prev?.laneId });
  const conn = graph.nearestConnector(player.pos, { heading: player.heading, maxDist: 5 });
  let useConn = false;
  if (conn) {
    const j = graph.junctions.get(conn.connector.junctionId);
    const inside = j ? graph.insideJunction(player.pos, j) : false;
    useConn = !lane || conn.distance + 0.3 < lane.distance || (inside && conn.distance < 3.5);
    // a connector that merely overlaps the end of the lane we are on: prefer the lane unless inside the junction
    if (useConn && lane && !inside && lane.distance < 1.0 && conn.distance > 0.3) useConn = false;
  }
  if (useConn && conn) {
    const c = conn.connector;
    loc.connectorId = c.id;
    loc.junctionId = c.junctionId;
    loc.s = conn.s;
    loc.lateral = conn.lateral;
    loc.headingError = conn.headingError;
    loc.wrongWay = Math.abs(conn.headingError) > Math.PI / 2;
    loc.distToLaneEnd = Math.max(0, c.length - conn.s);
    loc.nextJunctionId = graph.lane(c.toLane).to;
    loc.speedLimit = c.maxSpeed;
    loc.insideJunction = true;
    return loc;
  }
  if (lane) {
    loc.laneId = lane.lane.id;
    loc.roadId = lane.lane.roadId;
    loc.s = lane.s;
    loc.lateral = lane.lateral;
    loc.headingError = lane.headingError;
    loc.wrongWay = Math.abs(lane.headingError) > Math.PI / 2;
    loc.distToLaneEnd = Math.max(0, lane.lane.length - lane.s);
    loc.nextJunctionId = lane.lane.to;
    loc.speedLimit = lane.lane.maxSpeed;
    const half = lane.lane.width / 2;
    loc.onKerb = lane.lateral > half + player.width / 2 - 0.2 && lane.lane.rightLine === 'kerb';
  }
  return loc;
}

export interface TestContext {
  ctx: SimContext;
  world: WorldFile;
  graph: RoadGraph;
  bus: EventBus;
  signals: FakeSignals;
  traffic: TrafficAgentState[];
  settings: Settings;
  /** Teleport the player (and re-localise). Speed in m/s. */
  place(pos: Vec2, heading: number, speed?: number): void;
  /** Place the player on a lane at arc-length s (lateral offset in m, positive = right). */
  placeOnLane(laneId: string, s: number, opts?: { speed?: number; lateral?: number }): void;
  /** Place the player at route distance d. */
  placeOnRoute(route: RouteModel, d: number, speed?: number): void;
  /** Advance one tick: time += dt, re-localise, update the systems in order. */
  step(dt: number, systems?: System[]): void;
  /** Advance `seconds` in ticks of `dt`, moving the player straight ahead at its speed. */
  advance(seconds: number, systems?: System[], dt?: number): void;
  /** Drive along a route at `speed` m/s for `seconds`, stepping the systems (returns the route distance reached). */
  drive(route: RouteModel, speed: number, seconds: number, systems?: System[], dt?: number): number;
  addAgent(a: Partial<TrafficAgentState> & { id: string; pos: Vec2 }): TrafficAgentState;
  removeAgents(): void;
  /** Collected events, for assertions. */
  events: { name: string; payload: unknown }[];
  routeDistance: number;
}

export function createTestContext(opts: { world?: WorldFile; mode?: SimMode; coachPresent?: boolean; settings?: Partial<Settings>; spawnId?: string } = {}): TestContext {
  const world = opts.world ?? buildTrainingGround();
  const graph = new RoadGraph(world);
  const bus = new EventBus();
  const signals = new FakeSignals(graph);
  const traffic: TrafficAgentState[] = [];
  const settings: Settings = { ...DEFAULT_SETTINGS, tts: false, ...opts.settings };
  const spawn = graph.spawnPoints.get(opts.spawnId ?? 'tg_start') ?? world.spawnPoints[0]!;
  const player = defaultVehicleState([spawn.pos[0], spawn.pos[1]], spawn.heading);
  player.engineOn = true;
  player.seatbelt = true;
  player.handbrake = false;
  player.gear = 'D';
  const ctx: SimContext = {
    time: 0,
    dt: 0,
    mode: opts.mode ?? 'free',
    world,
    graph,
    bus,
    player,
    localisation: localise(graph, player),
    traffic,
    signals,
    env: { time: 0, hour: 10, weather: 'clear', wetRoad: false },
    settings,
    coachPresent: opts.coachPresent ?? true,
    timeScale: 1,
    paused: false,
  };
  const events: { name: string; payload: unknown }[] = [];
  const watched = ['coach:say', 'coach:said', 'coach:instruction', 'coach:intervention', 'coach:request', 'violation', 'lesson:step', 'lesson:completed', 'lesson:briefing', 'lesson:hint', 'lesson:highlight', 'examiner:maneuver', 'test:started', 'test:finished', 'theory:question', 'theory:answered', 'sim:reset'] as const;
  for (const name of watched) bus.on(name, (payload) => events.push({ name, payload }));

  const t: TestContext = {
    ctx,
    world,
    graph,
    bus,
    signals,
    traffic,
    settings,
    events,
    routeDistance: 0,
    place(pos, heading, speed = ctx.player.speed) {
      ctx.player.pos = [pos[0], pos[1]];
      ctx.player.heading = heading;
      ctx.player.speed = speed;
      ctx.localisation = localise(graph, ctx.player, ctx.localisation);
    },
    placeOnLane(laneId, s, o = {}) {
      const lane = graph.lane(laneId);
      const at = graph.laneAt(laneId, Math.min(s, lane.length));
      const lat = o.lateral ?? 0;
      const r: Vec2 = [Math.cos(at.h + Math.PI / 2), Math.sin(at.h + Math.PI / 2)];
      t.place([at.p[0] + r[0] * lat, at.p[1] + r[1] * lat], at.h, o.speed ?? ctx.player.speed);
    },
    placeOnRoute(route, d, speed = ctx.player.speed) {
      const at = route.pointAt(d);
      t.routeDistance = d;
      t.place(at.p, at.h, speed);
    },
    step(dt, systems = []) {
      ctx.dt = dt;
      ctx.time += dt;
      ctx.env.time = ctx.time;
      ctx.localisation = localise(graph, ctx.player, ctx.localisation);
      for (const s of systems) s.update(ctx);
    },
    advance(seconds, systems = [], dt = 0.1) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) {
        const f = forwardOf(ctx.player.heading);
        const v = ctx.player.speed;
        ctx.player.pos = [ctx.player.pos[0] + f[0] * v * dt, ctx.player.pos[1] + f[1] * v * dt];
        t.step(dt, systems);
      }
    },
    drive(route, speed, seconds, systems = [], dt = 0.1) {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) {
        t.routeDistance = Math.min(route.length, t.routeDistance + speed * dt);
        const at = route.pointAt(t.routeDistance);
        const prevHeading = ctx.player.heading;
        ctx.player.pos = [at.p[0], at.p[1]];
        ctx.player.heading = at.h;
        ctx.player.speed = speed;
        ctx.player.yawRate = angleDiff(prevHeading, at.h) / dt;
        t.step(dt, systems);
      }
      return t.routeDistance;
    },
    addAgent(a) {
      const agent: TrafficAgentState = { kind: 'car', heading: 0, speed: 0, length: 4.4, width: 1.8, ...a };
      traffic.push(agent);
      return agent;
    },
    removeAgents() {
      traffic.splice(0);
    },
  };
  return t;
}

/** Events of one name, payload-typed by the caller. */
export function eventsNamed<T = unknown>(t: TestContext, name: string): T[] {
  return t.events.filter((e) => e.name === name).map((e) => e.payload as T);
}

/** Texts of all 'coach:say' events so far. */
export function spokenTexts(t: TestContext): string[] {
  return eventsNamed<{ text: string }>(t, 'coach:say').map((e) => e.text);
}
