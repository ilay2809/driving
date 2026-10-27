/**
 * Semantics: OSM + municipal data → SemanticModel (→ BuildInput). This is the
 * orchestration of the network, controls, features and signs steps; each step is a
 * pure function over the model so it can be tested on small fixtures.
 */
import { createProjector, WORLD_ORIGIN, angleDiff, compassDegToHeading, pointAlong, projectOntoPolyline } from '@/world/geo';
import { AREA } from '../area';
import { GridIndex, type BBox } from '../geom';
import { applyModelOverrides, emptyOverrides, type OverrideReport, type OverridesFile } from '../overrides';
import { STRINGS } from '../places.he';
import type { TlvData } from '../tlv';
import { UnknownCollector } from './attrs';
import { applyPriorityRoads, applySignals, applyStopAndGiveWay, applyTurnRestrictions, extractCrossings, nameJunctions, sanitiseTurnLanes } from './controls';
import { extractAreas, extractBuildings, extractProps } from './features';
import type { SemanticModel } from './model';
import { buildNetwork, type NetworkOptions } from './network';
import type { OsmData } from './parse';
import { northOfRiverFilter, riverPolyline } from './river';
import { generateSigns } from './signs';

export interface SemanticsOptions {
  name: string;
  seed: number;
  overrides?: OverridesFile;
  network?: Partial<NetworkOptions>;
  attribution?: string[];
  /** Drop roads south of the Yarkon (default true; the fetch area extends a little south of the river). */
  clipToRiver?: boolean;
}

export interface SemanticsResult {
  model: SemanticModel;
  unknown: UnknownCollector;
  overrideReport: OverrideReport;
  timings: Record<string, number>;
}

export const ATTRIBUTION = ['© OpenStreetMap contributors (ODbL 1.0)', 'מקור: עיריית תל אביב-יפו — נתונים פתוחים'];

export const STREET_AXIS_MATCH_DIST = 12;
export const BUS_LANE_MATCH_DIST = 10;

export function projectedArea(proj = createProjector(WORLD_ORIGIN), area = AREA): BBox {
  const a = proj.toWorld(area.minLon, area.maxLat);
  const b = proj.toWorld(area.maxLon, area.minLat);
  return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[1], b[1]), maxZ: Math.max(a[1], b[1]) };
}

/** Unnamed roads take the name of the nearest municipal street axis with a similar heading. */
export function applyStreetAxisNames(model: SemanticModel, tlv: TlvData): void {
  const grid = new GridIndex<{ axis: TlvData['streetAxes'][number]; a: [number, number]; b: [number, number] }>(50);
  for (const axis of tlv.streetAxes) {
    if (/^\d+$/.test(axis.name)) continue; // numeric placeholders for unnamed axes
    for (let i = 1; i < axis.points.length; i++) grid.insertPolyline([axis.points[i - 1]!, axis.points[i]!], { axis, a: axis.points[i - 1]!, b: axis.points[i]! });
  }
  let named = 0;
  for (const r of model.roads) {
    if (r.name || r.cls === 'motorway' || r.cls === 'trunk' || r.roundabout) continue;
    const mid = pointAlong(r.points, r.length / 2);
    let best: { name: string; nameEn?: string; d: number } | undefined;
    for (const seg of grid.query(mid.p, STREET_AXIS_MATCH_DIST)) {
      const pr = projectOntoPolyline([seg.a, seg.b], mid.p);
      if (pr.distance > STREET_AXIS_MATCH_DIST) continue;
      const dh = Math.abs(angleDiff(pr.h, mid.h));
      if (Math.min(dh, Math.PI - dh) > (25 * Math.PI) / 180) continue;
      if (!best || pr.distance < best.d) best = { name: seg.axis.name, nameEn: seg.axis.nameEn, d: pr.distance };
    }
    if (best) {
      r.name = best.name;
      r.attrs.name = best.name;
      if (!r.nameEn && best.nameEn) {
        r.nameEn = best.nameEn;
        r.attrs.nameEn = best.nameEn;
      }
      named++;
    }
  }
  model.stats.roadsNamedFromTlvAxes = named;
  model.stats.roadsUnnamed = model.roads.filter((r) => !r.name).length;
}

const COMPASS: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

/** Municipal kerb-side bus lanes ('ימני') → busLaneForward/Backward on roads that already have ≥ 2 lanes in that direction. */
export function applyTlvBusLanes(model: SemanticModel, tlv: TlvData): void {
  const grid = new GridIndex<SemanticModel['roads'][number]>(25);
  for (const r of model.roads) grid.insertPolyline(r.points, r);
  let marked = 0;
  for (const lane of tlv.busLanes) {
    if (!/ימני/.test(lane.type)) continue;
    const dirDeg = COMPASS[lane.direction.toUpperCase()];
    const dirH = dirDeg !== undefined ? compassDegToHeading(dirDeg) : undefined;
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1]!;
      const b = lane.points[i]!;
      const segH = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= L; s += 20) {
        const p: [number, number] = [a[0] + ((b[0] - a[0]) * s) / Math.max(L, 1e-6), a[1] + ((b[1] - a[1]) * s) / Math.max(L, 1e-6)];
        for (const r of grid.query(p, BUS_LANE_MATCH_DIST)) {
          const pr = projectOntoPolyline(r.points, p);
          if (pr.distance > BUS_LANE_MATCH_DIST) continue;
          const dh = Math.abs(angleDiff(pr.h, segH));
          if (Math.min(dh, Math.PI - dh) > (20 * Math.PI) / 180) continue;
          const travelH = dirH ?? segH;
          const forward = Math.abs(angleDiff(pr.h, travelH)) < Math.PI / 2;
          if (forward && r.lanesForward >= 2 && !r.busLaneForward) {
            r.busLaneForward = true;
            r.attrs.busLaneForward = true;
            marked++;
          } else if (!forward && !r.oneway && r.lanesBackward >= 2 && !r.busLaneBackward) {
            r.busLaneBackward = true;
            r.attrs.busLaneBackward = true;
            marked++;
          }
        }
      }
    }
  }
  model.stats.busLanesFromTlv = marked;
}

export function buildSemanticModel(osm: OsmData, tlv: TlvData, opts: SemanticsOptions): SemanticsResult {
  const timings: Record<string, number> = {};
  const time = <T>(key: string, fn: () => T): T => {
    const t0 = performance.now();
    const r = fn();
    timings[key] = Math.round(performance.now() - t0);
    return r;
  };
  const overrides = opts.overrides ?? emptyOverrides();
  const proj = createProjector(WORLD_ORIGIN);
  const unknown = new UnknownCollector();
  const area = projectedArea(proj);
  const river = opts.clipToRiver === false ? undefined : riverPolyline(osm, proj);
  const keepRoad = river ? northOfRiverFilter(river, area) : undefined;
  const net = time('network', () => buildNetwork(osm, proj, area, unknown, { ...opts.network, removeWays: new Set(overrides.removeWays), keepRoad }));
  net.stats.riverPoints = river?.length ?? 0;
  const model: SemanticModel = {
    name: opts.name,
    origin: WORLD_ORIGIN,
    attribution: opts.attribution ?? ATTRIBUTION,
    proj,
    area: projectedArea(proj),
    nodes: net.nodes,
    roads: net.roads,
    roadById: new Map(net.roads.map((r) => [r.id, r])),
    nodeRep: net.nodeRep,
    interiorNodeRoad: net.interiorNodeRoad,
    crossings: [],
    signs: [],
    parking: [],
    buildings: [],
    areas: [],
    props: [],
    spawnPoints: [],
    routes: [],
    stats: { ...net.stats },
    todos: [],
  };
  time('names', () => applyStreetAxisNames(model, tlv));
  time('busLanes', () => applyTlvBusLanes(model, tlv));
  time('signals', () => applySignals(model, osm, tlv));
  time('stopGiveWay', () => applyStopAndGiveWay(model, osm));
  time('priority', () => applyPriorityRoads(model, tlv));
  time('restrictions', () => applyTurnRestrictions(model, osm));
  const crossings = time('crossings', () => extractCrossings(model, osm));
  const overrideReport = time('overrides', () => applyModelOverrides(model, overrides));
  time('turnLanes', () => sanitiseTurnLanes(model));
  time('junctionNames', () => nameJunctions(model));
  time('buildings', () => extractBuildings(model, osm, tlv));
  time('areas', () => extractAreas(model, osm, { sea: STRINGS.sea }));
  const props = time('props', () => extractProps(model, osm, tlv, opts.seed));
  time('signs', () => generateSigns(model, { midBlock: crossings.midBlock, busStops: props.busStops, bumps: props.bumps, tlv }));
  const busOnly = model.roads.filter((r) => r.attrs.busOnly).length;
  model.stats.busOnlyRoads = busOnly;
  if (busOnly > 0) model.todos.push(`${busOnly} roads are bus-only in OSM (access=no + psv=yes) but are drivable in the world file: the runtime has no bus-only road kind yet.`);
  model.stats.roadsWithSignalsControl = [...model.nodes.values()].filter((n) => n.control === 'signals').length;
  return { model, unknown, overrideReport, timings };
}
