/**
 * Hand-authored corrections (data/overrides/<world>.json), applied after parsing and
 * before building. Positions are [lon, lat] so they can be copied from any map.
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { angleDiff, compassDegToHeading, dist2, projectOntoPolyline, type Vec2 } from '@/world/geo';
import { ControlKindSchema, SpawnTagSchema } from '@/world/schema';
import { GridIndex, normaliseName } from './geom';
import { reverseAttrs } from './osm/attrs';
import { roadsByNode } from './osm/controls';
import type { SemanticModel, SemNode, SemRoad } from './osm/model';

const LonLat = z.tuple([z.number(), z.number()]);

export const OverridesSchema = z.object({
  $comment: z.string().optional(),
  nodeControls: z
    .array(
      z.object({
        at: LonLat.optional(),
        osmNodeId: z.number().optional(),
        control: z.enum(['auto', 'signals', 'all_stop', 'right_hand_rule', 'roundabout', 'none']),
        note: z.string().optional(),
      }),
    )
    .default([]),
  approachControls: z
    .array(
      z.object({
        osmWayId: z.number().optional(),
        roadName: z.string().optional(),
        nearJunctionAt: LonLat,
        control: ControlKindSchema,
        note: z.string().optional(),
      }),
    )
    .default([]),
  removeWays: z.array(z.number()).default([]),
  extraCrossings: z.array(z.object({ at: LonLat, kind: z.enum(['zebra', 'signals', 'unmarked', 'raised']).default('zebra'), refuge: z.boolean().default(false), note: z.string().optional() })).default([]),
  extraSigns: z
    .array(
      z.object({
        at: LonLat,
        code: z.string(),
        value: z.union([z.number(), z.string()]).optional(),
        /** Compass bearing of the traffic that reads the sign; default = the side of the road the point is on. */
        bearingDeg: z.number().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  extraSpawnPoints: z.array(z.object({ id: z.string(), name: z.string(), at: LonLat, bearingDeg: z.number().optional(), tags: z.array(SpawnTagSchema).default([]) })).default([]),
  extraRoutes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(['test', 'lesson', 'tour']),
        spawnId: z.string(),
        waypoints: z.array(z.union([z.string(), LonLat, z.object({ streets: z.tuple([z.string(), z.string()]) })])).min(1),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  laneOverrides: z
    .array(
      z.object({
        osmWayId: z.number(),
        lanesForward: z.number().int().min(1).optional(),
        lanesBackward: z.number().int().min(0).optional(),
        /** true / false, or -1 to reverse the drawing direction. */
        oneway: z.union([z.boolean(), z.literal(-1)]).optional(),
        maxSpeed: z.number().positive().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
});

export type OverridesFile = z.infer<typeof OverridesSchema>;

export function emptyOverrides(): OverridesFile {
  return OverridesSchema.parse({});
}

export function loadOverrides(path: string): OverridesFile {
  if (!existsSync(path)) return emptyOverrides();
  return OverridesSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export interface OverrideReport {
  applied: number;
  failed: string[];
}

const JUNCTION_MATCH_DIST = 25;
const ROAD_MATCH_DIST = 15;

/** Reverse a road's drawing direction in place (for laneOverrides.oneway = -1). */
export function reverseRoad(r: SemRoad): void {
  r.points = r.points.slice().reverse();
  r.nodeIds = r.nodeIds.slice().reverse();
  [r.from, r.to] = [r.to, r.from];
  const a = reverseAttrs(r.attrs);
  r.attrs = a;
  r.lanesForward = a.lanesForward;
  r.lanesBackward = a.lanesBackward;
  r.turnLanesForward = a.turnLanesForward;
  r.turnLanesBackward = a.turnLanesBackward;
  r.busLaneForward = a.busLaneForward;
  r.busLaneBackward = a.busLaneBackward;
  r.kerbLeft = a.kerbLeft;
  r.kerbRight = a.kerbRight;
  r.sidewalkLeft = a.sidewalkLeft;
  r.sidewalkRight = a.sidewalkRight;
  [r.controlAtFrom, r.controlAtTo] = [r.controlAtTo, r.controlAtFrom];
}

/**
 * Apply node / approach / lane / crossing / sign overrides to the semantic model
 * (removeWays is consumed by the network step; spawn points and routes by places.ts).
 */
export function applyModelOverrides(model: SemanticModel, ov: OverridesFile): OverrideReport {
  const report: OverrideReport = { applied: 0, failed: [] };
  const byNode = roadsByNode(model);
  const nodeGrid = new GridIndex<SemNode>(50);
  for (const n of model.nodes.values()) nodeGrid.insertPoint(n.pos, n);
  const roadGrid = new GridIndex<SemRoad>(25);
  for (const r of model.roads) roadGrid.insertPolyline(r.points, r);
  const junctionNear = (lonLat: [number, number], minDegree = 3): SemNode | undefined => {
    const p = model.proj.toWorld(lonLat[0], lonLat[1]);
    let best: SemNode | undefined;
    let bestD = JUNCTION_MATCH_DIST;
    for (const n of nodeGrid.query(p, JUNCTION_MATCH_DIST)) {
      if (n.degree < minDegree) continue;
      const d = dist2(n.pos, p);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  };
  const roadNear = (p: Vec2): { road: SemRoad; s: number; lateral: number; h: number } | undefined => {
    let best: { road: SemRoad; s: number; lateral: number; h: number; d: number } | undefined;
    for (const r of roadGrid.query(p, ROAD_MATCH_DIST)) {
      const pr = projectOntoPolyline(r.points, p);
      if (pr.distance <= ROAD_MATCH_DIST && (!best || pr.distance < best.d)) best = { road: r, s: pr.s, lateral: pr.lateral, h: pr.h, d: pr.distance };
    }
    return best;
  };

  for (const o of ov.nodeControls) {
    let node: SemNode | undefined;
    if (o.osmNodeId !== undefined) node = model.nodes.get(`n${model.nodeRep.get(o.osmNodeId) ?? o.osmNodeId}`);
    else if (o.at) node = junctionNear(o.at, 2);
    if (!node) {
      report.failed.push(`nodeControls: no junction for ${o.osmNodeId ?? o.at?.join(',')}`);
      continue;
    }
    node.control = o.control;
    report.applied++;
  }

  for (const o of ov.approachControls) {
    const node = junctionNear(o.nearJunctionAt);
    if (!node) {
      report.failed.push(`approachControls: no junction near ${o.nearJunctionAt.join(',')}`);
      continue;
    }
    const roads = (byNode.get(node.id) ?? []).filter((r) => (o.osmWayId !== undefined ? r.osmWayIds.includes(o.osmWayId) : o.roadName ? [r.name, r.nameEn].some((n) => n && normaliseName(n).includes(normaliseName(o.roadName!))) : false));
    if (roads.length === 0) {
      report.failed.push(`approachControls: no road ${o.osmWayId ?? o.roadName} at junction ${node.id}`);
      continue;
    }
    for (const r of roads) {
      if (r.to === node.id) r.controlAtTo = o.control;
      else r.controlAtFrom = o.control;
    }
    report.applied++;
  }

  for (const o of ov.laneOverrides) {
    const roads = model.roads.filter((r) => r.osmWayIds.includes(o.osmWayId));
    if (roads.length === 0) {
      report.failed.push(`laneOverrides: way ${o.osmWayId} is not in the network`);
      continue;
    }
    for (const r of roads) {
      if (o.oneway === -1) reverseRoad(r);
      if (o.oneway === true || o.oneway === -1) {
        r.oneway = true;
        r.attrs.oneway = true;
        r.lanesBackward = 0;
        r.attrs.lanesBackward = 0;
        r.turnLanesBackward = undefined;
        r.busLaneBackward = false;
      } else if (o.oneway === false) {
        r.oneway = false;
        r.attrs.oneway = false;
        if (r.lanesBackward < 1) r.lanesBackward = 1;
      }
      if (o.lanesForward !== undefined) r.lanesForward = o.lanesForward;
      if (o.lanesBackward !== undefined && !r.oneway) r.lanesBackward = o.lanesBackward;
      if (o.maxSpeed !== undefined) r.maxSpeed = o.maxSpeed;
      r.attrs.lanesForward = r.lanesForward;
      r.attrs.lanesBackward = r.lanesBackward;
      if (r.turnLanesForward && r.turnLanesForward.length !== r.lanesForward) r.turnLanesForward = undefined;
      if (r.turnLanesBackward && r.turnLanesBackward.length !== r.lanesBackward) r.turnLanesBackward = undefined;
    }
    report.applied++;
  }

  for (const [i, o] of ov.extraCrossings.entries()) {
    const p = model.proj.toWorld(o.at[0], o.at[1]);
    const near = roadNear(p);
    if (!near) {
      report.failed.push(`extraCrossings: no road within ${ROAD_MATCH_DIST} m of ${o.at.join(',')}`);
      continue;
    }
    model.crossings.push({ id: `c_ov${i}`, roadId: near.road.id, s: near.s, kind: o.kind, refuge: o.refuge });
    report.applied++;
  }

  for (const [i, o] of ov.extraSigns.entries()) {
    const p = model.proj.toWorld(o.at[0], o.at[1]);
    const near = roadNear(p);
    if (!near) {
      report.failed.push(`extraSigns: no road within ${ROAD_MATCH_DIST} m of ${o.at.join(',')}`);
      continue;
    }
    let direction: 'forward' | 'backward';
    if (o.bearingDeg !== undefined) direction = Math.abs(angleDiff(near.h, compassDegToHeading(o.bearingDeg))) < Math.PI / 2 ? 'forward' : 'backward';
    else direction = near.road.oneway || near.lateral >= 0 ? 'forward' : 'backward';
    model.signs.push({ id: `sg_ov${i}`, code: o.code, roadId: near.road.id, s: near.s, direction, value: o.value });
    report.applied++;
  }
  return report;
}
