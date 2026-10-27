/**
 * Shared agent-side types: the public agent view (TrafficAgentState + traffic-only extras),
 * the per-frame occupancy index and the frame context handed to the behaviour functions.
 */
import type { SignalStateProvider } from '@/core/sim';
import type { Localisation, TrafficAgentState, VehicleState } from '@/core/types';
import type { Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { TrafficNetwork } from './network';
import type { PedestrianAgent } from './pedestrians';
import type { SidewalkNetwork } from './sidewalks';
import type { Obb } from './util';
import { insertSorted } from './util';
import type { VehicleAgent } from './vehicles';

export type HoldReason = 'red' | 'amber' | 'stop_sign' | 'yield' | 'exit_blocked' | 'pedestrian' | 'leader' | 'player' | 'bus_stop' | 'path_end' | 'obstacle';

/**
 * What `TrafficSystem.agents` contains. Everything the shared contract (`TrafficAgentState`)
 * defines plus a few traffic-only extras that the rules engine / HUD may use when present.
 */
export interface TrafficAgentView extends TrafficAgentState {
  /** Vehicles/pedestrians: within 1 m of the player's body this frame (and someone is moving). */
  nearMissWithPlayer?: boolean;
  /** Vehicles: held (≈ stopped) by a stop line / obstacle. */
  waiting?: boolean;
  /** Vehicles: giving way at a junction (give way / roundabout / left turn / right-hand rule). */
  yielding?: boolean;
  /** Vehicles: decelerating harder than 1 m/s². */
  braking?: boolean;
  /** Vehicles: what limits the vehicle right now (debug / HUD). */
  holdReason?: HoldReason;
  /** Vehicles: a "bad driver" (speeds, tailgates, sloppy indicators). */
  badDriver?: boolean;
  /** Vehicles: the lane it is moving into while a lane change is in progress. */
  laneChangeTo?: string;
  /** Vehicles: a scripted parked car at the kerb (never moves). */
  parked?: boolean;
  /** Pedestrians: 0..1 progress along the crossing while `pedState === 'crossing'`. */
  crossingProgress?: number;
  /** Pedestrians: crossing outside a marked crossing (jaywalking). */
  jaywalking?: boolean;
}

export interface OccEntry {
  agent?: VehicleAgent;
  player?: boolean;
  /** Arc-length along the segment. */
  s: number;
  speed: number;
  length: number;
  width: number;
  /** Stopped because of a stop line / obstacle (not a free-flowing stop). */
  waiting: boolean;
  /** When the vehicle started waiting (seniority at junctions: first come, first served). */
  waitingSince?: number;
}

/** Segment id → vehicles on it (sorted by s). Rebuilt every frame. */
export class Occupancy {
  private map = new Map<string, OccEntry[]>();
  add(segId: string, e: OccEntry): void {
    let list = this.map.get(segId);
    if (!list) {
      list = [];
      this.map.set(segId, list);
    }
    insertSorted(list, e, (x) => x.s);
  }
  get(segId: string): readonly OccEntry[] {
    return this.map.get(segId) ?? EMPTY;
  }
  clear(): void {
    this.map.clear();
  }
}
const EMPTY: readonly OccEntry[] = Object.freeze([]);

export interface PlayerInfo {
  state: VehicleState;
  loc: Localisation;
  obb: Obb;
  /** Where the player sits on the network (from the localisation, else map-matched). */
  slot?: { segId: string; s: number; distToEnd: number };
  /** Velocity vector (m/s). */
  vel: Vec2;
}

/** Everything a behaviour function may read during one frame. */
export interface Frame {
  time: number;
  dt: number;
  graph: RoadGraph;
  net: TrafficNetwork;
  sidewalks: SidewalkNetwork;
  signals: SignalStateProvider;
  occ: Occupancy;
  player?: PlayerInfo;
  rng: () => number;
  vehicles: readonly VehicleAgent[];
  pedestrians: readonly PedestrianAgent[];
  pedsByCrossing: ReadonlyMap<string, PedestrianAgent[]>;
  /** Vehicles within `radius` of a point (coarse spatial hash). */
  vehiclesNear(pos: Vec2, radius: number): VehicleAgent[];
  pedestriansNear(pos: Vec2, radius: number): PedestrianAgent[];
}

/** Coarse spatial hash for per-frame neighbour queries. */
export class SpatialHash<T extends { pos: Vec2 }> {
  private cells = new Map<string, T[]>();
  constructor(readonly size = 40) {}
  clear(): void {
    this.cells.clear();
  }
  insert(item: T): void {
    const k = `${Math.floor(item.pos[0] / this.size)},${Math.floor(item.pos[1] / this.size)}`;
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(item);
  }
  query(pos: Vec2, radius: number): T[] {
    const out: T[] = [];
    const r = Math.ceil(radius / this.size);
    const cx = Math.floor(pos[0] / this.size);
    const cz = Math.floor(pos[1] / this.size);
    const r2 = radius * radius;
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const list = this.cells.get(`${cx + i},${cz + j}`);
        if (!list) continue;
        for (const it of list) {
          const dx = it.pos[0] - pos[0];
          const dz = it.pos[1] - pos[1];
          if (dx * dx + dz * dz <= r2) out.push(it);
        }
      }
    }
    return out;
  }
}
