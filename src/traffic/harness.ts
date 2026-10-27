/**
 * Test / dev harness: builds the training ground, a SignalSystem, a TrafficSystem and a
 * minimal SimContext with a scripted player (no physics), plus a simple map-matcher
 * (`localisePlayer`) standing in for the real localiser.
 */
import { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS, defaultVehicleState, emptyLocalisation, type SimContext } from '@/core/sim';
import type { Localisation, VehicleState } from '@/core/types';
import { forwardOf, type Vec2 } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import type { WorldFile } from '@/world/schema';
import { buildTrainingGround } from '@/world/testWorld';
import { SignalSystem } from './signals';
import { TrafficSystem, type TrafficOptions } from './TrafficSystem';

/** Simple map-matching of the player onto the road graph (the real localiser is another module). */
export function localisePlayer(graph: RoadGraph, state: VehicleState): Localisation {
  const loc = emptyLocalisation();
  const m = graph.nearestLane(state.pos, { heading: state.heading, maxDist: 4 });
  if (m && Math.abs(m.headingError) < Math.PI / 2) {
    loc.laneId = m.lane.id;
    loc.roadId = m.lane.roadId;
    loc.s = m.s;
    loc.lateral = m.lateral;
    loc.headingError = m.headingError;
    loc.distToLaneEnd = m.lane.length - m.s;
    loc.nextJunctionId = m.lane.to;
    loc.speedLimit = m.lane.maxSpeed;
    return loc;
  }
  const c = graph.nearestConnector(state.pos, { heading: state.heading, maxDist: 6 });
  if (c) {
    loc.connectorId = c.connector.id;
    loc.junctionId = c.connector.junctionId;
    loc.s = c.s;
    loc.lateral = c.lateral;
    loc.headingError = c.headingError;
    loc.insideJunction = true;
    loc.distToLaneEnd = c.connector.length - c.s;
    loc.speedLimit = c.connector.maxSpeed;
  }
  return loc;
}

export interface TrafficHarness {
  world: WorldFile;
  graph: RoadGraph;
  bus: EventBus;
  signals: SignalSystem;
  traffic: TrafficSystem;
  ctx: SimContext;
  /** Scripted player: set pos/heading/speed; `step` moves it along its heading when `drive` is true. */
  player: VehicleState;
  drive: boolean;
  /** Advance one frame of `dt` seconds (signals → traffic). */
  step(dt?: number): void;
  /** Run `seconds` of simulation in steps of `dt`. */
  run(seconds: number, dt?: number, each?: (ctx: SimContext) => void): void;
  /** Teleport the player. */
  place(pos: Vec2, heading: number, speed?: number): void;
}

export function createTrafficHarness(opts: Partial<TrafficOptions> & { world?: WorldFile; playerPos?: Vec2; playerHeading?: number } = {}): TrafficHarness {
  const world = opts.world ?? buildTrainingGround();
  const graph = new RoadGraph(world);
  const bus = new EventBus();
  const signals = new SignalSystem(world, graph);
  const traffic = new TrafficSystem(world, graph, bus, signals, { seed: opts.seed ?? 1, density: opts.density ?? 0, pedestrians: opts.pedestrians ?? 0, scooters: opts.scooters ?? 0 });
  const player = defaultVehicleState(opts.playerPos ?? [5000, 5000], opts.playerHeading ?? 0);
  player.engineOn = true;
  player.gear = 'D';
  player.handbrake = false;
  player.seatbelt = true;
  const ctx: SimContext = {
    time: 0,
    dt: 0,
    mode: 'free',
    world,
    graph,
    bus,
    player,
    localisation: localisePlayer(graph, player),
    traffic: [],
    signals,
    env: { time: 0, hour: 10, weather: 'clear', wetRoad: false },
    settings: { ...DEFAULT_SETTINGS },
    coachPresent: false,
    timeScale: 1,
    paused: false,
  };
  const h: TrafficHarness = {
    world,
    graph,
    bus,
    signals,
    traffic,
    ctx,
    player,
    drive: false,
    step(dt = 1 / 30) {
      ctx.dt = dt;
      ctx.time += dt;
      ctx.env.time = ctx.time;
      if (h.drive && player.speed !== 0) {
        const f = forwardOf(player.heading);
        player.pos = [player.pos[0] + f[0] * player.speed * dt, player.pos[1] + f[1] * player.speed * dt];
      }
      ctx.localisation = localisePlayer(graph, player);
      signals.update(ctx);
      traffic.update(ctx);
    },
    run(seconds, dt = 1 / 30, each) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) {
        h.step(dt);
        each?.(ctx);
      }
    },
    place(pos, heading, speed = 0) {
      player.pos = [pos[0], pos[1]];
      player.heading = heading;
      player.speed = speed;
      ctx.localisation = localisePlayer(graph, player);
    },
  };
  return h;
}
