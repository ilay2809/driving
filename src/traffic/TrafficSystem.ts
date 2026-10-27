/**
 * TrafficSystem — NPC vehicles and pedestrians around the player.
 *
 *   const traffic = new TrafficSystem(world, graph, bus, signals, { seed: 1, density: 0.5, pedestrians: 0.4 });
 *   each frame: traffic.update(ctx)  (reads ctx.player / ctx.localisation, writes ctx.traffic)
 *   traffic.agents → readonly TrafficAgentView[] (stable array instance, reused every frame)
 *
 * Deterministic: all randomness comes from createRng(seed); time from ctx.time / ctx.dt.
 * Listens to `coach:request` (spawn_vehicle, spawn_pedestrian, clear_traffic); the signal
 * requests are handled by SignalSystem.
 */
import type { EventBus, SimEventMap } from '@/core/events';
import { createRng, type SimContext, type System } from '@/core/sim';
import type { Localisation, TrafficAgentState, VehicleState } from '@/core/types';
import { forwardOf, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { WorldFile } from '@/world/schema';
import { Occupancy, SpatialHash, type Frame, type PlayerInfo, type TrafficAgentView } from './agents';
import { SPAWN, type VehicleKind } from './constants';
import { TrafficNetwork } from './network';
import { PedestrianAgent, updatePedestrian } from './pedestrians';
import { SidewalkNetwork } from './sidewalks';
import type { SignalSystem } from './signals';
import { spawnPedestrianAuto, spawnScriptedPedestrian, spawnVehicleAuto, spawnVehicleRelative, type Interest, type SpawnHost, type SpawnVehicleOptions } from './spawner';
import { VehicleAgent, updateVehicle } from './vehicles';

export interface TrafficOptions {
  seed: number;
  /** 0..1 → 0..60 vehicles around the player. */
  density: number;
  /** 0..1 → 0..40 pedestrians around the player. */
  pedestrians: number;
  /** 0..1 share-ish of e-scooters / bicycles among spawns (0 = none). */
  scooters?: number;
}

export interface TrafficStats {
  vehicles: number;
  pedestrians: number;
  spawned: number;
  despawned: number;
}

export class TrafficSystem implements System, SpawnHost {
  readonly name = 'traffic';
  readonly net: TrafficNetwork;
  readonly sidewalks: SidewalkNetwork;
  private readonly rng: () => number;
  private vehicleList: VehicleAgent[] = [];
  private pedList: PedestrianAgent[] = [];
  private readonly agentsArr: TrafficAgentView[] = [];
  private readonly occ = new Occupancy();
  private readonly vehHash = new SpatialHash<VehicleAgent>(40);
  private readonly pedHash = new SpatialHash<PedestrianAgent>(30);
  private readonly pedsByCrossingMap = new Map<string, PedestrianAgent[]>();
  private readonly frameObj: Frame;
  private playerOverride?: { state: VehicleState; loc: Localisation };
  private pending: SimEventMap['coach:request'][] = [];
  private bus?: EventBus;
  private unsubscribe?: () => void;
  private seqV = 0;
  private seqP = 0;
  private lastVehicleSpawn = -Infinity;
  private lastPedSpawn = -Infinity;
  private warm = false;
  private interestState: Interest;
  private statsState: TrafficStats = { vehicles: 0, pedestrians: 0, spawned: 0, despawned: 0 };
  density: number;
  pedestrianDensity: number;
  scooterShare: number;

  constructor(
    readonly world: WorldFile,
    readonly graph: RoadGraph,
    bus: EventBus,
    readonly signals: SignalSystem,
    opts: TrafficOptions,
  ) {
    this.rng = createRng(opts.seed);
    this.density = Math.max(0, Math.min(1, opts.density));
    this.pedestrianDensity = Math.max(0, Math.min(1, opts.pedestrians));
    this.scooterShare = Math.max(0, Math.min(1, opts.scooters ?? 0));
    this.net = new TrafficNetwork(world, graph);
    this.sidewalks = new SidewalkNetwork(world, graph);
    const centre: Vec2 = [(world.bbox.minX + world.bbox.maxX) / 2, (world.bbox.minZ + world.bbox.maxZ) / 2];
    this.interestState = { centre, offWorld: true };
    this.frameObj = {
      time: 0,
      dt: 0,
      graph,
      net: this.net,
      sidewalks: this.sidewalks,
      signals,
      occ: this.occ,
      player: undefined,
      rng: this.rng,
      vehicles: this.vehicleList,
      pedestrians: this.pedList,
      pedsByCrossing: this.pedsByCrossingMap,
      vehiclesNear: (pos, r) => this.vehHash.query(pos, r),
      pedestriansNear: (pos, r) => this.pedHash.query(pos, r),
    };
    this.attach(bus);
  }

  // ---- SpawnHost ------------------------------------------------------------------
  get frame(): Frame {
    return this.frameObj;
  }
  get vehicles(): readonly VehicleAgent[] {
    return this.vehicleList;
  }
  get pedestrians(): readonly PedestrianAgent[] {
    return this.pedList;
  }
  get interest(): Interest {
    return this.interestState;
  }
  nextVehicleId(): string {
    return `v${++this.seqV}`;
  }
  nextPedestrianId(): string {
    return `p${++this.seqP}`;
  }
  addVehicle(agent: VehicleAgent): void {
    this.vehicleList.push(agent);
    this.occ.add(agent.seg.id, agent.occEntry());
    this.vehHash.insert(agent);
    this.statsState.spawned++;
  }
  addPedestrian(p: PedestrianAgent): void {
    this.pedList.push(p);
    this.pedHash.insert(p);
    this.statsState.spawned++;
  }

  // ---- public API --------------------------------------------------------------------
  /** All agents (vehicles then pedestrians) as `TrafficAgentState` views — the same array instance every frame. */
  get agents(): readonly TrafficAgentView[] {
    return this.agentsArr;
  }

  get stats(): TrafficStats {
    this.statsState.vehicles = this.vehicleList.length;
    this.statsState.pedestrians = this.pedList.length;
    return this.statsState;
  }

  /** Provide the player's state explicitly (otherwise `update` reads ctx.player / ctx.localisation). */
  setPlayer(state: VehicleState, loc: Localisation): void {
    this.playerOverride = { state, loc };
  }

  setDensity(density: number): void {
    this.density = Math.max(0, Math.min(1, density));
  }

  setPedestrianDensity(density: number): void {
    this.pedestrianDensity = Math.max(0, Math.min(1, density));
  }

  attach(bus: EventBus): void {
    if (this.bus === bus) return;
    this.unsubscribe?.();
    this.bus = bus;
    this.unsubscribe = bus.on('coach:request', (req) => {
      if (req.kind === 'spawn_vehicle' || req.kind === 'spawn_pedestrian' || req.kind === 'clear_traffic') this.pending.push(req);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.bus = undefined;
  }

  update(ctx: SimContext): void {
    this.attach(ctx.bus);
    const player = this.playerOverride ?? { state: ctx.player, loc: ctx.localisation };
    this.step(ctx.time, ctx.dt, player);
    ctx.traffic = this.agentsArr;
  }

  /**
   * Advance the simulation to `time` with step `dt` (what `update` does with a SimContext).
   * `player` is optional: without it the whole world is populated and nobody yields to anyone.
   */
  step(time: number, dt: number, player?: { state: VehicleState; loc: Localisation }): void {
    this.signals.setTime(time);
    const f = this.frameObj;
    f.time = time;
    f.dt = dt;
    f.player = player ? this.buildPlayerInfo(player) : undefined;
    this.updateInterest(f.player);
    this.buildFrame();
    this.processPending();
    this.despawn();
    this.autoSpawn();
    for (const v of this.vehicleList) updateVehicle(v, f);
    for (const p of this.pedList) updatePedestrian(p, f);
    this.syncAgents();
  }

  /** Spawn a vehicle relative to the player (lesson scripting / harness). */
  spawnVehicle(opts: SpawnVehicleOptions): VehicleAgent | undefined {
    return spawnVehicleRelative(this, opts);
  }

  /** Spawn a scripted pedestrian at a crossing (nearest ahead of the player when omitted). */
  spawnPedestrian(crossingId?: string): PedestrianAgent | undefined {
    return spawnScriptedPedestrian(this, crossingId);
  }

  /** Spawn an automatic (random) vehicle / pedestrian now. */
  spawnRandomVehicle(): VehicleAgent | undefined {
    return spawnVehicleAuto(this);
  }
  spawnRandomPedestrian(): PedestrianAgent | undefined {
    return spawnPedestrianAuto(this);
  }

  /** Despawn everyone and stop automatic spawning until setDensity / setPedestrianDensity are called. */
  clear(): void {
    this.statsState.despawned += this.vehicleList.length + this.pedList.length;
    this.vehicleList.length = 0;
    this.pedList.length = 0;
    this.density = 0;
    this.pedestrianDensity = 0;
    this.occ.clear();
    this.vehHash.clear();
    this.pedHash.clear();
    this.syncAgents();
  }

  /** Vehicle agent by id (internal view). */
  vehicle(id: string): VehicleAgent | undefined {
    return this.vehicleList.find((v) => v.id === id);
  }
  pedestrian(id: string): PedestrianAgent | undefined {
    return this.pedList.find((p) => p.id === id);
  }

  /** Pedestrians waiting at / crossing a given crossing. */
  pedestriansAtCrossing(crossingId: string): readonly TrafficAgentState[] {
    return (this.pedsByCrossingMap.get(crossingId) ?? []).map((p) => p.state);
  }

  // ---- internals -----------------------------------------------------------------------
  private buildPlayerInfo(player: { state: VehicleState; loc: Localisation }): PlayerInfo {
    const { state, loc } = player;
    const f = forwardOf(state.heading);
    const info: PlayerInfo = {
      state,
      loc,
      obb: { pos: state.pos, heading: state.heading, length: state.length, width: state.width },
      vel: [f[0] * state.speed, f[1] * state.speed],
    };
    if (loc.connectorId && this.graph.connectors.has(loc.connectorId)) {
      const c = this.graph.connector(loc.connectorId);
      info.slot = { segId: c.id, s: loc.s, distToEnd: c.length - loc.s };
    } else if (loc.laneId && this.graph.lanes.has(loc.laneId)) {
      const l = this.graph.lane(loc.laneId);
      info.slot = { segId: l.id, s: loc.s, distToEnd: l.length - loc.s };
    } else {
      const m = this.graph.nearestLane(state.pos, { heading: state.heading, maxDist: 3.5 });
      if (m && Math.abs(m.headingError) < Math.PI / 3) info.slot = { segId: m.lane.id, s: m.s, distToEnd: m.lane.length - m.s };
      else {
        const c = this.graph.nearestConnector(state.pos, { heading: state.heading, maxDist: 3.5 });
        if (c && Math.abs(c.headingError) < Math.PI / 3) info.slot = { segId: c.connector.id, s: c.s, distToEnd: c.connector.length - c.s };
      }
    }
    return info;
  }

  private updateInterest(player?: PlayerInfo): void {
    if (!player) {
      this.interestState.offWorld = true;
      return;
    }
    const near = this.graph.lanesWithin(player.state.pos, SPAWN.vehicleRadius);
    if (near.length === 0) {
      this.interestState.offWorld = true;
    } else {
      this.interestState.offWorld = false;
      this.interestState.centre = player.state.pos;
    }
  }

  private buildFrame(): void {
    const f = this.frameObj;
    this.occ.clear();
    this.vehHash.clear();
    this.pedHash.clear();
    for (const v of this.vehicleList) {
      this.occ.add(v.seg.id, v.occEntry());
      if (v.laneChange && f.time - v.laneChange.t0 < 1.8) this.occ.add(v.laneChange.from, v.occEntry());
      this.vehHash.insert(v);
    }
    const pl = f.player;
    if (pl?.slot) {
      this.occ.add(pl.slot.segId, {
        player: true,
        s: pl.slot.s,
        speed: Math.max(0, pl.state.speed),
        length: pl.state.length,
        width: pl.state.width,
        waiting: Math.abs(pl.state.speed) < 0.3,
      });
    }
    this.pedsByCrossingMap.clear();
    for (const p of this.pedList) {
      this.pedHash.insert(p);
      const cid = p.state.crossingId;
      if (cid && (p.state.pedState === 'waiting' || p.state.pedState === 'crossing')) {
        let list = this.pedsByCrossingMap.get(cid);
        if (!list) {
          list = [];
          this.pedsByCrossingMap.set(cid, list);
        }
        list.push(p);
      }
    }
  }

  private processPending(): void {
    if (this.pending.length === 0) return;
    const reqs = this.pending;
    this.pending = [];
    for (const req of reqs) {
      const payload = req.payload ?? {};
      if (req.kind === 'clear_traffic') this.clear();
      else if (req.kind === 'spawn_pedestrian') {
        const crossingId = typeof payload['crossingId'] === 'string' ? (payload['crossingId'] as string) : undefined;
        this.spawnPedestrian(crossingId);
      } else if (req.kind === 'spawn_vehicle') {
        const where = payload['where'];
        if (typeof where !== 'string') continue;
        this.spawnVehicle({
          where: where as SpawnVehicleOptions['where'],
          distance: typeof payload['distance'] === 'number' ? (payload['distance'] as number) : undefined,
          speedKmh: typeof payload['speedKmh'] === 'number' ? (payload['speedKmh'] as number) : undefined,
          vehicle: typeof payload['vehicle'] === 'string' ? (payload['vehicle'] as VehicleKind) : undefined,
        });
      }
    }
  }

  private despawn(): void {
    const f = this.frameObj;
    const keepV = (v: VehicleAgent): boolean => {
      if (v.stuckSeconds > 8) return false;
      if (this.interestState.offWorld) return true;
      const dx = v.pos[0] - this.interestState.centre[0];
      const dz = v.pos[1] - this.interestState.centre[1];
      return dx * dx + dz * dz <= SPAWN.vehicleDespawn * SPAWN.vehicleDespawn;
    };
    const keepP = (p: PedestrianAgent): boolean => {
      if (this.interestState.offWorld) return true;
      const dx = p.pos[0] - this.interestState.centre[0];
      const dz = p.pos[1] - this.interestState.centre[1];
      return dx * dx + dz * dz <= SPAWN.pedestrianDespawn * SPAWN.pedestrianDespawn;
    };
    let removed = 0;
    for (let i = this.vehicleList.length - 1; i >= 0; i--) {
      if (!keepV(this.vehicleList[i]!)) {
        this.vehicleList.splice(i, 1);
        removed++;
      }
    }
    for (let i = this.pedList.length - 1; i >= 0; i--) {
      if (!keepP(this.pedList[i]!)) {
        this.pedList.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) {
      this.statsState.despawned += removed;
      this.buildFrame();
    }
    void f;
  }

  private countNear(list: readonly { pos: Vec2 }[], radius: number): number {
    if (this.interestState.offWorld) return list.length;
    const r2 = radius * radius;
    let n = 0;
    for (const it of list) {
      const dx = it.pos[0] - this.interestState.centre[0];
      const dz = it.pos[1] - this.interestState.centre[1];
      if (dx * dx + dz * dz <= r2) n++;
    }
    return n;
  }

  private autoSpawn(): void {
    const f = this.frameObj;
    const targetV = Math.round(this.density * SPAWN.maxVehicles);
    const targetP = Math.round(this.pedestrianDensity * SPAWN.maxPedestrians);
    let nV = this.countNear(this.vehicleList, SPAWN.vehicleRadius);
    let nP = this.countNear(this.pedList, SPAWN.pedestrianRadius);
    const burstV = this.warm ? 2 : targetV;
    const burstP = this.warm ? 2 : targetP;
    let spawnedV = 0;
    while (nV < targetV && this.vehicleList.length < SPAWN.maxVehicles && spawnedV < burstV && (!this.warm || f.time - this.lastVehicleSpawn >= SPAWN.vehicleInterval)) {
      const agent = spawnVehicleAuto(this);
      if (!agent) break;
      nV++;
      spawnedV++;
      this.lastVehicleSpawn = f.time;
    }
    let spawnedP = 0;
    while (nP < targetP && this.pedList.length < SPAWN.maxPedestrians && spawnedP < burstP && (!this.warm || f.time - this.lastPedSpawn >= SPAWN.pedestrianInterval)) {
      const p = spawnPedestrianAuto(this);
      if (!p) break;
      nP++;
      spawnedP++;
      this.lastPedSpawn = f.time;
    }
    this.warm = true;
  }

  private syncAgents(): void {
    const arr = this.agentsArr;
    arr.length = 0;
    for (const v of this.vehicleList) arr.push(v.state);
    for (const p of this.pedList) arr.push(p.state);
  }
}
