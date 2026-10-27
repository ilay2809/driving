/**
 * Build the North Tel Aviv world file from the cached raw data:
 *
 *   parse OSM tiles → semantic model (network, controls, features, signs)
 *   → overrides → buildWorld (pass 1) → spawn points + routes on the real graph
 *   → buildWorld (pass 2) → validation → public/world/north-tlv.json.gz + data/world-stats.json
 *
 * Usage: pnpm world:build   (expects data/raw/osm/*.osm and data/raw/tlv/*.geojson)
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildWorld } from '@/world/builder';
import { createProjector, WORLD_ORIGIN } from '@/world/geo';
import { parseWorld, type WorldFile } from '@/world/schema';
import { RAW_OSM_DIR, RAW_TLV_DIR } from './area';
import { loadOsmDir } from './osm/parse';
import { buildSemanticModel, type SemanticsResult } from './osm/semantics';
import { toBuildInput } from './osm/model';
import { loadOverrides, type OverridesFile } from './overrides';
import { resolvePlaces, type PlaceResolution } from './places';
import { ROUTE_SPECS, SPAWN_SPECS, WORLD_NAME, type RouteSpec, type WaypointSpec } from './places.he';
import { loadTlv } from './tlv';
import { validateWorld, type ValidationReport } from './validate';

export const WORLD_OUT = 'public/world/north-tlv.json.gz';
export const STATS_OUT = 'data/world-stats.json';
export const OVERRIDES_PATH = 'data/overrides/north-tlv.json';
export const WORLD_SEED = 20261027;

/**
 * JSON replacer: 2 decimals for metres, 4 for headings (0.01 rad is too coarse for a
 * car). Geographic degrees (`origin.lat` / `origin.lon`) are never rounded: 0.005° is
 * half a kilometre and the runtime projects with that origin.
 */
export function roundingReplacer(key: string, value: unknown): unknown {
  if (typeof value !== 'number') return value;
  if (!Number.isFinite(value)) return 0;
  if (key === 'lat' || key === 'lon') return value;
  const f = key === 'heading' ? 10000 : 100;
  return Math.round(value * f) / f;
}

export function overrideRoutesToSpecs(ov: OverridesFile): RouteSpec[] {
  return ov.extraRoutes.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    spawnId: r.spawnId,
    notes: r.notes,
    waypoints: r.waypoints.map((w): WaypointSpec => (typeof w === 'string' ? { junction: w } : Array.isArray(w) ? { near: w } : { streets: w.streets })),
  }));
}

export interface BuildResult {
  world: WorldFile;
  sem: SemanticsResult;
  places: PlaceResolution;
  validation: ValidationReport;
  json: string;
  gz: Buffer;
  timings: Record<string, number>;
}

/** Full pipeline in memory (used by the CLI and the integration test). */
export function buildNorthTlv(opts: { osmDir?: string; tlvDir?: string; overridesPath?: string; log?: (msg: string) => void } = {}): BuildResult {
  const log = opts.log ?? (() => {});
  const timings: Record<string, number> = {};
  const t = <T>(key: string, fn: () => T): T => {
    const t0 = performance.now();
    const r = fn();
    timings[key] = Math.round(performance.now() - t0);
    log(`${key}: ${timings[key]} ms`);
    return r;
  };
  const osmDir = opts.osmDir ?? RAW_OSM_DIR;
  const tlvDir = opts.tlvDir ?? RAW_TLV_DIR;
  const osm = t('parseOsm', () => loadOsmDir(osmDir, (f, ms) => log(`  ${f}: ${Math.round(ms)} ms`)));
  log(`  nodes ${osm.nodes.size}, ways ${osm.ways.size}, relations ${osm.relations.size}`);
  const tlv = t('loadTlv', () => loadTlv(tlvDir, createProjector(WORLD_ORIGIN)));
  log(`  layers: ${tlv.layers.join(', ') || 'none'}`);
  const overrides = loadOverrides(opts.overridesPath ?? OVERRIDES_PATH);
  const sem = t('semantics', () => buildSemanticModel(osm, tlv, { name: WORLD_NAME, seed: WORLD_SEED, overrides }));
  for (const [k, v] of Object.entries(sem.timings)) log(`  ${k}: ${v} ms`);
  const generatedAt = new Date().toISOString();
  const world1 = t('buildPass1', () => buildWorld(toBuildInput(sem.model, generatedAt)));
  const places = t('places', () => resolvePlaces(world1, SPAWN_SPECS, ROUTE_SPECS, { spawns: overrides.extraSpawnPoints, routes: overrideRoutesToSpecs(overrides) }));
  for (const n of places.notes) log(`  note: ${n}`);
  sem.model.spawnPoints = places.spawnPoints;
  sem.model.routes = places.routes;
  const world = t('buildPass2', () => buildWorld(toBuildInput(sem.model, generatedAt)));
  const validation = t('validate', () => validateWorld(world, { area: sem.model.area }));
  for (const p of validation.problems) log(`  problem: ${p}`);
  const json = t('serialise', () => JSON.stringify(world, roundingReplacer));
  t('verifyRoundTrip', () => parseWorld(JSON.parse(json)));
  const gz = t('gzip', () => gzipSync(json, { level: 9 }));
  return { world, sem, places, validation, json, gz, timings };
}

export function worldStats(r: BuildResult, osmFiles: string[]): Record<string, unknown> {
  const w = r.world;
  const kmByClass: Record<string, number> = {};
  for (const road of w.roads) kmByClass[road.cls] = Math.round(((kmByClass[road.cls] ?? 0) + road.length / 1000) * 100) / 100;
  let laneKm = 0;
  for (const l of w.lanes) laneKm += l.length / 1000;
  const spawnInfo = w.spawnPoints.map((s) => {
    const lane = w.lanes.find((l) => l.id === s.laneId);
    const road = lane ? w.roads.find((x) => x.id === lane.roadId) : undefined;
    return { id: s.id, laneId: s.laneId, street: road?.name ?? road?.nameEn ?? null, tags: s.tags };
  });
  const todos = [...r.sem.model.todos, ...r.places.notes, ...r.sem.overrideReport.failed.map((f) => `override failed: ${f}`)];
  if (r.validation.danglingLanes.length > 0) todos.push(`${r.validation.danglingLanes.length} dangling lanes (see validation)`);
  if (r.validation.unreachableLanes > 0) todos.push(`${r.validation.unreachableLanes} drive lanes outside the main component — usually roads cut by the data extent or one-way fragments; harmless for the player but unreachable for routing`);
  todos.push('Sign positions along a road (426/618/402/222/223/432/433/144/135/505/623) are derived from the network, not surveyed — real posts may differ by tens of metres.');
  todos.push('Mid-block signalised pedestrian crossings (crossing=traffic_signals away from junctions) are kept as crossings of kind "signals" without a signal controller.');
  todos.push('Each OSM node of a dual-carriageway junction gets its own signal controller; phases are not coordinated between the two carriageways.');
  todos.push('mini_roundabout nodes (1) and contraflow bus lanes (psv=opposite_lane, 2) are not modelled.');
  todos.push('Municipal one-way arrows (636) and parking-zone polygons (544) were not used (angle semantics / street-level OSM tags are more precise).');
  return {
    generatedAt: w.generatedAt,
    world: w.name,
    sources: { osmFiles: osmFiles.length, osmFileNames: osmFiles, tlvLayers: r.sem.model.stats.tlvLayers ?? undefined },
    bbox: w.bbox,
    counts: {
      roads: w.roads.length,
      lanes: w.lanes.length,
      junctions: w.junctions.length,
      connectors: w.connectors.length,
      signals: w.signals.length,
      crossings: w.crossings.length,
      signs: w.signs.length,
      parking: w.parking.length,
      buildings: w.buildings.length,
      areas: w.areas.length,
      props: w.props.length,
      spawnPoints: w.spawnPoints.length,
      routes: w.routes.length,
    },
    roadKmByClass: kmByClass,
    roadKmTotal: Math.round((Object.values(kmByClass).reduce((a, b) => a + b, 0) * 100)) / 100,
    laneKm: Math.round(laneKm * 100) / 100,
    junctionKinds: countBy(w.junctions.map((j) => j.kind)),
    approachControls: countBy(w.junctions.flatMap((j) => j.approaches.map((a) => a.control))),
    signsByCode: countBy(w.signs.map((s) => s.code)),
    propsByKind: countBy(w.props.map((p) => p.kind)),
    areasByKind: countBy(w.areas.map((a) => a.kind)),
    buildingsByKind: countBy(w.buildings.map((b) => b.kind)),
    fileSize: { jsonBytes: Buffer.byteLength(r.json), gzipBytes: r.gz.length, gzipMB: Math.round((r.gz.length / 1e6) * 100) / 100 },
    pipeline: r.sem.model.stats,
    unknownTags: r.sem.unknown.toJSON(),
    overrides: { applied: r.sem.overrideReport.applied, failed: r.sem.overrideReport.failed },
    routes: Object.fromEntries(w.routes.map((rt) => [rt.id, { name: rt.name, kind: rt.kind, waypoints: rt.waypoints.length, lengthM: r.places.routeLengths[rt.id] ?? null }])),
    spawnPoints: spawnInfo,
    validation: {
      problems: r.validation.problems,
      danglingLanes: r.validation.danglingLanes.length,
      danglingLaneIds: r.validation.danglingLanes.slice(0, 50),
      unreachableLanes: r.validation.unreachableLanes,
      unreachableByCategory: r.validation.unreachableByCategory,
      interiorUnreachableLaneIds: r.validation.interiorUnreachableLaneIds.slice(0, 100),
      largestSccLanes: r.validation.largestSccLanes,
      bigJunctions: r.validation.bigJunctions,
      zeroLengthRoads: r.validation.zeroLengthRoads.length,
      duplicateIds: r.validation.duplicateIds,
      invalidRoutes: r.validation.invalidRoutes,
    },
    todos,
    timingsMs: { ...r.timings, semantics: r.sem.timings },
  };
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function main(): void {
  if (!existsSync(RAW_OSM_DIR) || readdirSync(RAW_OSM_DIR).filter((f) => f.endsWith('.osm')).length === 0) {
    console.error(`no OSM tiles in ${RAW_OSM_DIR} — run \`pnpm world:fetch\` first`);
    process.exit(1);
  }
  const t0 = performance.now();
  const result = buildNorthTlv({ log: (m) => console.log(m) });
  mkdirSync(dirname(WORLD_OUT), { recursive: true });
  writeFileSync(WORLD_OUT, result.gz);
  const osmFiles = readdirSync(RAW_OSM_DIR).filter((f) => f.endsWith('.osm')).sort();
  const stats = worldStats(result, osmFiles);
  (stats as any).timingsMs.total = Math.round(performance.now() - t0);
  mkdirSync(dirname(STATS_OUT), { recursive: true });
  writeFileSync(STATS_OUT, JSON.stringify(stats, null, 2) + '\n');
  const c = (stats as any).counts;
  console.log(`\nwrote ${WORLD_OUT} (${(result.gz.length / 1e6).toFixed(2)} MB gzip, ${(Buffer.byteLength(result.json) / 1e6).toFixed(1)} MB json)`);
  console.log(`roads ${c.roads}, lanes ${c.lanes}, junctions ${c.junctions}, connectors ${c.connectors}, signals ${c.signals}, crossings ${c.crossings}, signs ${c.signs}, buildings ${c.buildings}, areas ${c.areas}, props ${c.props}, spawns ${c.spawnPoints}, routes ${c.routes}`);
  console.log(`validation: ${result.validation.problems.length === 0 ? 'clean' : result.validation.problems.join('; ')}`);
  console.log(`total ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && /build-world\.ts$/.test(process.argv[1])) main();
