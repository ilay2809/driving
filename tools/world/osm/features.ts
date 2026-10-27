/**
 * Non-network features: buildings (OSM footprints + municipal heights, plus municipal
 * footprints OSM lacks), ground areas (parks, water, sand, …, the sea from the
 * coastline) and props (trees, lamps, bus stops, speed bumps).
 */
import { createRng } from '@/core/sim';
import { dist2, pointAlong, projectOntoPolyline, rightOf, wrapAngle, type Vec2 } from '@/world/geo';
import { ROAD_DEFAULTS, type Area } from '@/world/schema';
import { bboxContains, bboxOf, centroidOf, GridIndex, joinChains, pointInRing, ringArea, roundPoint, simplifyRing, type BBox } from '../geom';
import { tlvHeightOf, type TlvBuilding, type TlvData } from '../tlv';
import type { SemanticModel, SemRoad } from './model';
import type { OsmData, OsmRelation, OsmWay } from './parse';
import { areaKindOf, buildingKindOf, defaultBuildingHeight, parseHeightTag } from './tags';
import { locateOsmNode } from './controls';

export const MAX_TREES = 9000;
export const MAX_LAMPS = 4000;
export const BUILDING_MIN_AREA = 12;
export const BUILDING_MAX_VERTICES = 40;
export const AREA_MAX_VERTICES = 200;
export const TLV_BUILDING_DEDUPE_DIST = 6;
export const TREE_ROAD_CLEARANCE = 2;

function wayRing(osm: OsmData, way: OsmWay, proj: SemanticModel['proj']): Vec2[] | undefined {
  if (way.nodes.length < 4 || way.nodes[0] !== way.nodes[way.nodes.length - 1]) return undefined;
  const pts: Vec2[] = [];
  for (const id of way.nodes.slice(0, -1)) {
    const n = osm.nodes.get(id);
    if (!n) return undefined;
    pts.push(proj.toWorld(n.lon, n.lat));
  }
  return pts.length >= 3 ? pts : undefined;
}

interface RingSet {
  outer: Vec2[];
  holes: Vec2[][];
}

/** Assemble the outer rings (with their holes) of a multipolygon relation; incomplete rings are dropped. */
function relationRings(osm: OsmData, rel: OsmRelation, proj: SemanticModel['proj']): RingSet[] {
  const pieces = (role: 'outer' | 'inner') =>
    rel.members
      .filter((m) => m.type === 'way' && (role === 'outer' ? m.role === 'outer' || m.role === '' : m.role === 'inner'))
      .map((m) => osm.ways.get(m.ref))
      .filter((w): w is OsmWay => !!w && w.nodes.length >= 2)
      .map((w) => {
        const nodeIds = w.nodes.filter((id) => osm.nodes.has(id));
        return { first: nodeIds[0]!, last: nodeIds[nodeIds.length - 1]!, nodeIds, points: nodeIds.map((id) => proj.toWorld(osm.nodes.get(id)!.lon, osm.nodes.get(id)!.lat)) };
      })
      .filter((p) => p.nodeIds.length >= 2);
  const outers = joinChains(pieces('outer')).rings.map((r) => r.points);
  const inners = joinChains(pieces('inner')).rings.map((r) => r.points);
  const sets: RingSet[] = outers.filter((o) => o.length >= 3).map((outer) => ({ outer, holes: [] }));
  for (const hole of inners) {
    if (hole.length < 3) continue;
    const host = sets.find((s) => pointInRing(hole[0]!, s.outer));
    if (host) host.holes.push(hole);
  }
  return sets;
}

interface TlvPoly {
  b: TlvBuilding;
  outer: Vec2[];
  holes: Vec2[][];
  centroid: Vec2;
  key: string;
}

export function extractBuildings(model: SemanticModel, osm: OsmData, tlv: TlvData): void {
  const proj = model.proj;
  // --- municipal index -----------------------------------------------------------------
  const tlvGrid = new GridIndex<TlvPoly>(40);
  const tlvPolys: TlvPoly[] = [];
  for (const b of tlv.buildings) {
    b.polygons.forEach((poly, i) => {
      const outer = poly[0]!;
      if (outer.length < 3) return;
      const tp: TlvPoly = { b, outer, holes: poly.slice(1), centroid: centroidOf(outer), key: b.polygons.length > 1 ? `${b.id}_${i}` : b.id };
      tlvPolys.push(tp);
      tlvGrid.insertBBox(bboxOf(outer), tp);
    });
  }
  const matchTlv = (c: Vec2): TlvPoly | undefined => {
    let nearest: TlvPoly | undefined;
    let nearestD = 5;
    for (const tp of tlvGrid.query(c, 6)) {
      if (pointInRing(c, tp.outer)) return tp;
      const d = dist2(c, tp.centroid);
      if (d < nearestD) {
        nearestD = d;
        nearest = tp;
      }
    }
    return nearest;
  };

  // --- OSM footprints ----------------------------------------------------------------------
  const osmGrid = new GridIndex<{ ring: Vec2[]; centroid: Vec2 }>(40);
  let tlvMatched = 0;
  let fromLevels = 0;
  let fromHeightTag = 0;
  let defaulted = 0;
  let tooSmall = 0;
  const usedTlv = new Set<string>();
  const addOsmBuilding = (id: string, tags: Record<string, string>, rawOuter: Vec2[], rawHoles: Vec2[][]): void => {
    const footprint = simplifyRing(rawOuter, 0.3, BUILDING_MAX_VERTICES);
    if (footprint.length < 3 || ringArea(footprint) < BUILDING_MIN_AREA) {
      tooSmall++;
      return;
    }
    const c = centroidOf(footprint);
    if (!bboxContains(model.area, c)) return;
    const match = matchTlv(c);
    const levelsTag = Number(tags['building:levels']);
    const levels = Number.isInteger(levelsTag) && levelsTag > 0 ? levelsTag : match?.b.floors && Number.isInteger(match.b.floors) ? match.b.floors : undefined;
    let height = match ? tlvHeightOf(match.b) : undefined;
    if (height !== undefined) tlvMatched++;
    else if (Number.isFinite(levelsTag) && levelsTag > 0) {
      height = levelsTag * 3 + 1;
      fromLevels++;
    } else {
      const h = parseHeightTag(tags.height);
      if (h !== undefined) {
        height = h;
        fromHeightTag++;
      } else {
        height = defaultBuildingHeight(tags);
        defaulted++;
      }
    }
    let kind = buildingKindOf(tags);
    if ((tags.building ?? 'yes') === 'yes' && match && match.b.kind !== 'residential' && kind === 'residential') kind = match.b.kind;
    if (match) usedTlv.add(match.key);
    const holes = rawHoles.map((h) => simplifyRing(h, 0.3, 20)).filter((h) => h.length >= 3 && ringArea(h) >= 4);
    const name = tags['name:he'] ?? (tags.name && /[֐-׿]/.test(tags.name) ? tags.name : undefined) ?? match?.b.name;
    model.buildings.push({ id, footprint: footprint.map((p) => roundPoint(p)), holes: holes.map((h) => h.map((p) => roundPoint(p))), height: Math.round(height * 10) / 10, levels, kind, name });
    osmGrid.insertBBox(bboxOf(footprint), { ring: footprint, centroid: c });
  };
  for (const w of osm.ways.values()) {
    const b = w.tags.building;
    if (!b || b === 'no') continue;
    const ring = wayRing(osm, w, proj);
    if (!ring) continue;
    addOsmBuilding(`b${w.id}`, w.tags, ring, []);
  }
  let relBuildings = 0;
  for (const rel of osm.relations.values()) {
    if (rel.tags.type !== 'multipolygon' || !rel.tags.building || rel.tags.building === 'no') continue;
    for (const [i, set] of relationRings(osm, rel, proj).entries()) {
      addOsmBuilding(i === 0 ? `br${rel.id}` : `br${rel.id}_${i}`, rel.tags, set.outer, set.holes);
      relBuildings++;
    }
  }
  model.stats.buildingsFromOsm = model.buildings.length;
  model.stats.buildingsFromOsmRelations = relBuildings;
  model.stats.buildingsHeightFromTlv = tlvMatched;
  model.stats.buildingsHeightFromLevels = fromLevels;
  model.stats.buildingsHeightFromTag = fromHeightTag;
  model.stats.buildingsHeightDefault = defaulted;
  model.stats.buildingsTooSmall = tooSmall;

  // --- municipal footprints missing from OSM ------------------------------------------------
  let added = 0;
  for (const tp of tlvPolys) {
    if (usedTlv.has(tp.key)) continue;
    const c = tp.centroid;
    if (!bboxContains(model.area, c)) continue;
    let dup = false;
    for (const o of osmGrid.query(c, TLV_BUILDING_DEDUPE_DIST)) {
      if (dist2(o.centroid, c) < TLV_BUILDING_DEDUPE_DIST || pointInRing(c, o.ring)) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    const footprint = simplifyRing(tp.outer, 0.3, BUILDING_MAX_VERTICES);
    if (footprint.length < 3 || ringArea(footprint) < BUILDING_MIN_AREA) continue;
    const holes = tp.holes.map((h) => simplifyRing(h, 0.3, 20)).filter((h) => h.length >= 3 && ringArea(h) >= 4);
    const height = tlvHeightOf(tp.b) ?? 7;
    model.buildings.push({ id: `bt${tp.key}`, footprint: footprint.map((p) => roundPoint(p)), holes: holes.map((h) => h.map((p) => roundPoint(p))), height: Math.round(height * 10) / 10, levels: tp.b.floors && Number.isInteger(tp.b.floors) ? tp.b.floors : undefined, kind: tp.b.kind, name: tp.b.name });
    osmGrid.insertBBox(bboxOf(footprint), { ring: footprint, centroid: c });
    added++;
  }
  model.stats.buildingsFromTlvOnly = added;
  model.stats.buildings = model.buildings.length;
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export function extractAreas(model: SemanticModel, osm: OsmData, names: { sea: string }): void {
  const proj = model.proj;
  const counts: Record<string, number> = {};
  const add = (id: string, kind: Area['kind'], rawOuter: Vec2[], rawHoles: Vec2[][], name?: string): void => {
    const polygon = simplifyRing(rawOuter, 0.5, AREA_MAX_VERTICES);
    if (polygon.length < 3 || ringArea(polygon) < 30) return;
    if (!bboxIntersects(bboxOf(polygon), model.area)) return;
    const holes = rawHoles.map((h) => simplifyRing(h, 0.5, 60)).filter((h) => h.length >= 3 && ringArea(h) >= 30);
    model.areas.push({ id, kind, polygon: polygon.map((p) => roundPoint(p)), holes: holes.map((h) => h.map((p) => roundPoint(p))), name });
    counts[kind] = (counts[kind] ?? 0) + 1;
  };
  const nameOf = (tags: Record<string, string>): string | undefined => tags['name:he'] ?? (tags.name && /[֐-׿]/.test(tags.name) ? tags.name : undefined);
  for (const w of osm.ways.values()) {
    const kind = areaKindOf(w.tags);
    if (!kind) continue;
    const ring = wayRing(osm, w, proj);
    if (!ring) continue;
    add(`a${w.id}`, kind, ring, [], nameOf(w.tags));
  }
  for (const rel of osm.relations.values()) {
    if (rel.tags.type !== 'multipolygon') continue;
    const kind = areaKindOf(rel.tags);
    if (!kind) continue;
    for (const [i, set] of relationRings(osm, rel, proj).entries()) add(i === 0 ? `ar${rel.id}` : `ar${rel.id}_${i}`, kind, set.outer, set.holes, nameOf(rel.tags));
  }
  // the sea: everything west of the coastline
  const coast = [...osm.ways.values()]
    .filter((w) => w.tags.natural === 'coastline')
    .map((w) => {
      const nodeIds = w.nodes.filter((id) => osm.nodes.has(id));
      return { first: nodeIds[0]!, last: nodeIds[nodeIds.length - 1]!, nodeIds, points: nodeIds.map((id) => proj.toWorld(osm.nodes.get(id)!.lon, osm.nodes.get(id)!.lat)) };
    })
    .filter((p) => p.nodeIds.length >= 2);
  if (coast.length > 0) {
    const chains = joinChains(coast).open.sort((a, b) => b.points.length - a.points.length);
    const chain = chains[0];
    if (chain) {
      const margin = 600;
      const pts = chain.points.filter((p) => p[1] >= model.area.minZ - margin && p[1] <= model.area.maxZ + margin);
      if (pts.length >= 2) {
        const westX = Math.min(model.area.minX, ...pts.map((p) => p[0])) - 1500;
        const polygon = [...pts, [westX, pts[pts.length - 1]![1]] as Vec2, [westX, pts[0]![1]] as Vec2];
        add('a_sea', 'water', polygon, [], names.sea);
        model.stats.seaPolygon = 1;
      }
    }
  }
  for (const [k, v] of Object.entries(counts)) model.stats[`areas_${k}`] = v;
  model.stats.areas = model.areas.length;
}

export interface BusStopMatch {
  pos: Vec2;
  name?: string;
  road: SemRoad;
  s: number;
  direction: 'forward' | 'backward';
}

export interface BumpMatch {
  road: SemRoad;
  s: number;
}

function roadHalfWidth(r: SemRoad): number {
  return ((r.lanesForward + r.lanesBackward) * (r.laneWidth ?? ROAD_DEFAULTS[r.cls].laneWidth)) / 2;
}

export function extractProps(model: SemanticModel, osm: OsmData, tlv: TlvData, seed: number): { busStops: BusStopMatch[]; bumps: BumpMatch[] } {
  const proj = model.proj;
  const rng = createRng(seed);
  const roadGrid = new GridIndex<SemRoad>(25);
  for (const r of model.roads) roadGrid.insertPolyline(r.points, r);
  const nearRoad = (p: Vec2, extra: number): boolean => {
    for (const r of roadGrid.query(p, 15)) {
      const pr = projectOntoPolyline(r.points, p);
      if (pr.distance < roadHalfWidth(r) + extra) return true;
    }
    return false;
  };
  const nearestRoad = (p: Vec2, maxDist: number): { road: SemRoad; s: number; lateral: number; h: number } | undefined => {
    let best: { road: SemRoad; s: number; lateral: number; h: number; d: number } | undefined;
    for (const r of roadGrid.query(p, maxDist)) {
      if (r.cls === 'motorway' || r.cls === 'trunk') continue;
      const pr = projectOntoPolyline(r.points, p);
      const d = Math.max(0, pr.distance - roadHalfWidth(r));
      if (d <= maxDist && (!best || d < best.d)) best = { road: r, s: pr.s, lateral: pr.lateral, h: pr.h, d };
    }
    return best;
  };

  // ---- trees ---------------------------------------------------------------------------------
  const treeCandidates: Vec2[] = [];
  for (const n of osm.nodes.values()) if (n.tags?.natural === 'tree') treeCandidates.push(proj.toWorld(n.lon, n.lat));
  const osmTrees = treeCandidates.length;
  for (const t of tlv.trees) treeCandidates.push(t);
  const treeGrid = new GridIndex<Vec2>(5);
  const trees: Vec2[] = [];
  let nearCarriageway = 0;
  let duplicates = 0;
  for (const p of treeCandidates) {
    if (!bboxContains(model.area, p)) continue;
    if (treeGrid.query(p, 1.5).some((q) => dist2(p, q) < 1.5)) {
      duplicates++;
      continue;
    }
    if (nearRoad(p, TREE_ROAD_CLEARANCE)) {
      nearCarriageway++;
      continue;
    }
    treeGrid.insertPoint(p, p);
    trees.push(p);
  }
  const keepP = Math.min(1, MAX_TREES / Math.max(1, trees.length));
  let kept = 0;
  for (const p of trees) {
    if (rng() > keepP || kept >= MAX_TREES) continue;
    kept++;
    model.props.push({ kind: 'tree', pos: roundPoint(p), heading: Math.round(rng() * Math.PI * 200) / 100, scale: Math.round((0.8 + rng() * 0.5) * 100) / 100 });
  }
  model.stats.treesOsm = osmTrees;
  model.stats.treesTlv = tlv.trees.length;
  model.stats.treesDuplicate = duplicates;
  model.stats.treesNearCarriageway = nearCarriageway;
  model.stats.trees = kept;

  // ---- lamps -----------------------------------------------------------------------------------
  const lamps: Vec2[] = [];
  for (const n of osm.nodes.values()) {
    if (n.tags?.highway !== 'street_lamp') continue;
    const p = proj.toWorld(n.lon, n.lat);
    if (bboxContains(model.area, p)) lamps.push(p);
  }
  const lampP = Math.min(1, MAX_LAMPS / Math.max(1, lamps.length));
  let lampCount = 0;
  for (const p of lamps) {
    if (rng() > lampP || lampCount >= MAX_LAMPS) continue;
    lampCount++;
    const nr = nearestRoad(p, 12);
    model.props.push({ kind: 'lamp', pos: roundPoint(p), heading: nr ? Math.round((nr.lateral > 0 ? nr.h : wrapAngle(nr.h + Math.PI)) * 100) / 100 : 0, scale: 1, roadId: nr?.road.id });
  }
  model.stats.lamps = lampCount;

  // ---- bus stops --------------------------------------------------------------------------------
  interface StopSrc {
    pos: Vec2;
    name?: string;
    tlv: boolean;
  }
  const stopSources: StopSrc[] = [];
  for (const n of osm.nodes.values()) {
    const t = n.tags;
    if (!t) continue;
    const isStop = t.highway === 'bus_stop' || ((t.public_transport === 'platform' || t.public_transport === 'stop_position') && (t.bus === 'yes' || t.highway === 'bus_stop'));
    if (!isStop) continue;
    const p = proj.toWorld(n.lon, n.lat);
    if (!bboxContains(model.area, p)) continue;
    stopSources.push({ pos: p, name: t['name:he'] ?? t.name, tlv: false });
  }
  for (const s of tlv.busStops) if (bboxContains(model.area, s.pos)) stopSources.push({ pos: s.pos, name: s.name, tlv: true });
  const tlvStopGrid = new GridIndex<StopSrc>(25);
  for (const s of stopSources) if (s.tlv) tlvStopGrid.insertPoint(s.pos, s);
  const placedGrid = new GridIndex<BusStopMatch>(25);
  const busStops: BusStopMatch[] = [];
  let unmatchedStops = 0;
  // OSM positions first (they sit at the kerb), municipal stops fill the gaps
  for (const src of [...stopSources.filter((s) => !s.tlv), ...stopSources.filter((s) => s.tlv)]) {
    const nr = nearestRoad(src.pos, 25);
    if (!nr) {
      unmatchedStops++;
      continue;
    }
    const direction: 'forward' | 'backward' = nr.road.oneway || nr.lateral >= 0 ? 'forward' : 'backward';
    // one stop per road/direction within 12 m
    if (placedGrid.query(src.pos, 12).some((m) => m.road === nr.road && m.direction === direction && Math.abs(m.s - nr.s) < 25)) continue;
    let name = src.name;
    if (!src.tlv) {
      let best: StopSrc | undefined;
      let bestD = 25;
      for (const t of tlvStopGrid.query(src.pos, 25)) {
        const d = dist2(t.pos, src.pos);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best?.name) name = best.name;
    }
    const h = direction === 'forward' ? nr.h : wrapAngle(nr.h + Math.PI);
    const at = pointAlong(nr.road.points, nr.s);
    const rt = rightOf(h);
    const off = roadHalfWidth(nr.road) + 1.2;
    const pos: Vec2 = [at.p[0] + rt[0] * off, at.p[1] + rt[1] * off];
    const m: BusStopMatch = { pos, name, road: nr.road, s: nr.s, direction };
    busStops.push(m);
    placedGrid.insertPoint(src.pos, m);
    model.props.push({ kind: 'bus_stop', pos: roundPoint(pos), heading: Math.round(h * 100) / 100, scale: 1, name, roadId: nr.road.id });
  }
  model.stats.busStops = busStops.length;
  model.stats.busStopsUnmatched = unmatchedStops;

  // ---- speed bumps -------------------------------------------------------------------------------
  const bumps: BumpMatch[] = [];
  for (const n of osm.nodes.values()) {
    const tc = n.tags?.traffic_calming;
    if (!tc || tc === 'island' || tc === 'chicane' || tc === 'choker' || tc === 'no') continue;
    if (n.tags?.highway === 'crossing') continue; // raised crossings are modelled as crossings
    const p = proj.toWorld(n.lon, n.lat);
    const loc = locateOsmNode(model, n.id, p);
    if (!loc || loc.kind !== 'interior') continue;
    const at = pointAlong(loc.road.points, loc.s);
    bumps.push({ road: loc.road, s: loc.s });
    model.props.push({ kind: 'speed_bump', pos: roundPoint(at.p), heading: Math.round(at.h * 100) / 100, scale: 1, roadId: loc.road.id });
  }
  model.stats.speedBumps = bumps.length;
  model.stats.props = model.props.length;
  return { busStops, bumps };
}
