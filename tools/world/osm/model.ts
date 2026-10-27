/**
 * The semantic model: everything the pipeline knows about the world before the
 * builder turns it into lanes. Overrides (data/overrides/*.json) are applied to this
 * model; `toBuildInput` converts it into the builder's `BuildInput`.
 */
import type { BuildCrossing, BuildInput, BuildNode, BuildRoad, BuildSign } from '@/world/builder';
import type { Projector } from '@/world/geo';
import type { Area, Building, ParkingStrip, Prop, Route, SpawnPoint } from '@/world/schema';
import type { BBox } from '../geom';
import type { WayAttrs } from './attrs';
import type { Tags } from './parse';

export interface SemRoad extends BuildRoad {
  osmWayIds: number[];
  /** OSM node ids along the road (after merging), first/last = the junction nodes. */
  nodeIds: number[];
  link: boolean;
  attrs: WayAttrs;
  /** Arc length of `points` (kept in sync by the pipeline). */
  length: number;
}

export interface SemNode extends BuildNode {
  osmId: number;
  /** Number of road ends meeting here. */
  degree: number;
  tags?: Tags;
}

export interface SemanticModel {
  name: string;
  origin: { lat: number; lon: number };
  attribution: string[];
  proj: Projector;
  /** Projected extent of the fetch area. */
  area: BBox;
  nodes: Map<string, SemNode>;
  roads: SemRoad[];
  roadById: Map<string, SemRoad>;
  /** OSM node id → representative OSM node id after snapping / collapsing. */
  nodeRep: Map<number, number>;
  /** OSM node id → road id for nodes interior to a road. */
  interiorNodeRoad: Map<number, string>;
  crossings: BuildCrossing[];
  signs: BuildSign[];
  parking: ParkingStrip[];
  buildings: Building[];
  areas: Area[];
  props: Prop[];
  spawnPoints: SpawnPoint[];
  routes: Route[];
  stats: Record<string, number>;
  todos: string[];
}

export function semNodeId(osmNodeId: number): string {
  return `n${osmNodeId}`;
}

/** The SemNode an OSM node id maps to (after snapping), if it is a junction node. */
export function nodeOfOsmId(model: SemanticModel, osmNodeId: number): SemNode | undefined {
  const rep = model.nodeRep.get(osmNodeId) ?? osmNodeId;
  return model.nodes.get(semNodeId(rep));
}

export function toBuildInput(model: SemanticModel, generatedAt: string): BuildInput {
  const nodes: BuildNode[] = [...model.nodes.values()].map((n) => ({ id: n.id, pos: n.pos, control: n.control, name: n.name, osmId: n.osmId }));
  const roads: BuildRoad[] = model.roads.map((r) => ({
    id: r.id,
    from: r.from,
    to: r.to,
    points: r.points,
    cls: r.cls,
    name: r.name,
    nameEn: r.nameEn,
    oneway: r.oneway,
    lanesForward: r.lanesForward,
    lanesBackward: r.lanesBackward,
    laneWidth: r.laneWidth,
    maxSpeed: r.maxSpeed,
    turnLanesForward: r.turnLanesForward,
    turnLanesBackward: r.turnLanesBackward,
    busLaneForward: r.busLaneForward,
    busLaneBackward: r.busLaneBackward,
    kerbLeft: r.kerbLeft,
    kerbRight: r.kerbRight,
    zone: r.zone,
    sidewalkLeft: r.sidewalkLeft,
    sidewalkRight: r.sidewalkRight,
    bridge: r.bridge,
    tunnel: r.tunnel,
    lit: r.lit,
    roundabout: r.roundabout,
    priorityRoad: r.priorityRoad,
    controlAtTo: r.controlAtTo,
    controlAtFrom: r.controlAtFrom,
    osmWayIds: r.osmWayIds,
  }));
  return {
    name: model.name,
    origin: model.origin,
    attribution: model.attribution,
    nodes,
    roads,
    crossings: model.crossings,
    signs: model.signs,
    parking: model.parking,
    buildings: model.buildings,
    areas: model.areas,
    props: model.props,
    spawnPoints: model.spawnPoints,
    routes: model.routes,
    generatedAt,
  };
}
