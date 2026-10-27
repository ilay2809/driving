/**
 * Inspect a built world file from the command line (developer utility).
 *
 *   tsx tools/world/query.ts sizes                  bytes of JSON per collection
 *   tsx tools/world/query.ts junctions <name>       junctions whose streets match <name>
 *   tsx tools/world/query.ts roads <name>           roads whose name matches
 *   tsx tools/world/query.ts road <id> | lane <id> | junction <id>
 *   tsx tools/world/query.ts dangling               lanes without connectors (with their turns)
 *   tsx tools/world/query.ts unreachable            lanes outside the main component, by class / edge
 *   tsx tools/world/query.ts near <lon> <lat> [r]   junctions and roads near a position
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createProjector, dist2, type Vec2 } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import { parseWorld, type WorldFile } from '@/world/schema';
import { RAW_OSM_DIR } from './area';
import { normaliseName } from './geom';
import { loadOsmDir } from './osm/parse';
import { RIVER_NAME, riverPolyline } from './osm/river';
import { projectedArea } from './osm/semantics';
import { validateWorld } from './validate';
import { WORLD_OUT } from './build-world';

export function readWorldGz(path = WORLD_OUT): WorldFile {
  return parseWorld(JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')));
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  const world = readWorldGz();
  const g = new RoadGraph(world);
  const proj = createProjector(world.origin);
  const fmtLonLat = (p: Vec2) => {
    const ll = proj.toLonLat(p[0], p[1]);
    return `${ll.lon.toFixed(5)},${ll.lat.toFixed(5)}`;
  };
  switch (cmd) {
    case 'sizes': {
      for (const [k, v] of Object.entries(world)) {
        const s = JSON.stringify(v);
        console.log(`${k.padEnd(14)} ${(s.length / 1e6).toFixed(2)} MB${Array.isArray(v) ? ` (${v.length} items, ${Math.round(s.length / Math.max(1, v.length))} B each)` : ''}`);
      }
      break;
    }
    case 'junctions': {
      const q = normaliseName(args.join(' '));
      for (const j of world.junctions) {
        const names = new Set<string>();
        for (const rid of [...j.approaches.map((a) => a.roadId), ...j.exits.map((e) => e.roadId)]) {
          const r = g.road(rid);
          if (r.name) names.add(r.name);
          if (r.nameEn) names.add(r.nameEn);
        }
        const all = [...names].map(normaliseName).join(' | ');
        if (all.includes(q)) console.log(`${j.id.padEnd(12)} ${j.kind.padEnd(10)} arms=${new Set([...j.approaches.map((a) => a.roadId), ...j.exits.map((e) => e.roadId)]).size} ctrl=${j.approaches.map((a) => a.control[0]).join('')} @${fmtLonLat(j.position)}  ${[...names].join(' | ')}  ${j.name ?? ''}`);
      }
      break;
    }
    case 'roads': {
      const q = normaliseName(args.join(' '));
      for (const r of world.roads) {
        const n = [r.name, r.nameEn].filter(Boolean).map((x) => normaliseName(x!)).join('|');
        if (n.includes(q)) console.log(`${r.id.padEnd(16)} ${r.cls.padEnd(12)} ${r.oneway ? '1w' : '2w'} ${r.lanesForward.length}+${r.lanesBackward.length} ${Math.round(r.length)}m ${r.name ?? ''} / ${r.nameEn ?? ''} @${fmtLonLat(r.centre[0]!)}`);
      }
      break;
    }
    case 'road':
      console.log(JSON.stringify(g.road(args[0]!), null, 1));
      break;
    case 'lane':
      console.log(JSON.stringify(g.lane(args[0]!), null, 1));
      break;
    case 'junction':
      console.log(JSON.stringify(g.junction(args[0]!), null, 1));
      break;
    case 'dangling': {
      const rep = validateWorld(world);
      for (const id of rep.danglingLanes) {
        const l = g.lane(id);
        const r = g.road(l.roadId);
        const j = g.junction(l.to);
        console.log(`${id.padEnd(20)} turns=${JSON.stringify(l.turns)} road ${r.cls} ${r.oneway ? '1w' : '2w'} ${r.lanesForward.length}+${r.lanesBackward.length} ${r.name ?? ''} → ${j.kind} arms=${new Set([...j.approaches.map((a) => a.roadId), ...j.exits.map((e) => e.roadId)]).size} @${fmtLonLat(j.position)}`);
      }
      break;
    }
    case 'unreachable': {
      const rep = validateWorld(world, { area: projectedArea(proj) });
      const byClass: Record<string, number> = {};
      for (const id of rep.interiorUnreachableLaneIds) {
        const r = g.road(g.lane(id).roadId);
        byClass[r.cls] = (byClass[r.cls] ?? 0) + 1;
      }
      console.log('unreachable', rep.unreachableLaneIds.length, rep.unreachableByCategory, 'interior by class', byClass);
      // interior lanes grouped by weak component of their roads, largest first
      const parent = new Map<string, string>();
      const find = (x: string): string => {
        while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!;
        return x;
      };
      const union = (a: string, b: string) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
      };
      const ids = new Set(rep.interiorUnreachableLaneIds);
      const roadsOf = new Set([...ids].map((id) => g.lane(id).roadId));
      for (const rid of roadsOf) {
        const r = g.road(rid);
        if (!parent.has(r.from)) parent.set(r.from, r.from);
        if (!parent.has(r.to)) parent.set(r.to, r.to);
        union(r.from, r.to);
      }
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        const r = g.road(g.lane(id).roadId);
        const c = find(r.from);
        groups.set(c, [...(groups.get(c) ?? []), id]);
      }
      const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
      console.log('interior groups', sorted.length);
      for (const [, lanes] of sorted.slice(0, Number(args[0] ?? 12))) {
        const l = g.lane(lanes[0]!);
        const r = g.road(l.roadId);
        const classes = new Set(lanes.map((id) => g.road(g.lane(id).roadId).cls));
        const names = new Set(lanes.map((id) => g.road(g.lane(id).roadId).name).filter(Boolean));
        console.log(`  ${lanes.length} lanes  ${[...classes].join('/')}  @${fmtLonLat(l.centre[0]!)}  ${[...names].slice(0, 4).join(', ')}  first=${lanes[0]} next=${l.next.length} prev=${l.prev.length} ${r.oneway ? '1w' : '2w'}`);
      }
      break;
    }
    case 'near': {
      const p = proj.toWorld(Number(args[0]), Number(args[1]));
      const r = Number(args[2] ?? 60);
      for (const j of g.junctionsWithin(p, r)) console.log(`J ${j.id} ${j.kind} ${Math.round(dist2(j.position, p))}m ${j.name ?? ''} ctrl=${j.approaches.map((a) => a.control).join(',')}`);
      for (const l of g.lanesWithin(p, r)) {
        const rd = g.road(l.roadId);
        console.log(`L ${l.id} ${rd.cls} ${rd.name ?? ''} ${Math.round(l.length)}m`);
      }
      break;
    }
    case 'river': {
      // diagnose the Yarkon polyline used for clipping (loads the raw OSM data)
      const osm = loadOsmDir(RAW_OSM_DIR);
      const pieces = [...osm.ways.values()].filter((w) => w.tags.waterway === 'river' && RIVER_NAME.test(`${w.tags.name ?? ''} ${w.tags['name:he'] ?? ''}`));
      console.log('river ways', pieces.length);
      for (const w of pieces) {
        const n0 = osm.nodes.get(w.nodes[0]!);
        const n1 = osm.nodes.get(w.nodes[w.nodes.length - 1]!);
        console.log(`  way ${w.id} ${w.tags.name} nodes=${w.nodes.length} ${n0?.lon.toFixed(4)},${n0?.lat.toFixed(4)} → ${n1?.lon.toFixed(4)},${n1?.lat.toFixed(4)}`);
      }
      const river = riverPolyline(osm, proj);
      if (!river) {
        console.log('no river polyline');
        break;
      }
      console.log('joined polyline points', river.length);
      for (let i = 0; i < river.length; i += Math.max(1, Math.floor(river.length / 25))) console.log(`  ${fmtLonLat(river[i]!)}`);
      console.log(`  last ${fmtLonLat(river[river.length - 1]!)}`);
      break;
    }
    default:
      console.log('commands: sizes | junctions <name> | roads <name> | road <id> | lane <id> | junction <id> | dangling | unreachable | near <lon> <lat> [r] | river');
  }
}

if (process.argv[1] && /query\.ts$/.test(process.argv[1])) main();
