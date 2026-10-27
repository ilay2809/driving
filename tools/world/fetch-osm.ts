/**
 * Fetch raw OpenStreetMap data for the North Tel Aviv area via the main OSM API
 * (Overpass is not reachable from the build environment). Tiles are cached in
 * data/raw/osm/ (git-ignored). Re-running only fetches missing tiles.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm world:fetch
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AREA, OSM_TILE_DEG as TILE, RAW_OSM_DIR as OUT } from './area';
const UA = 'driving-sim-il/0.1 (educational driving simulator; https://github.com/ilay2809/driving)';

type Box = { minLon: number; minLat: number; maxLon: number; maxLat: number };

function tileName(b: Box): string {
  return `tile_${b.minLon.toFixed(4)}_${b.minLat.toFixed(4)}_${b.maxLon.toFixed(4)}_${b.maxLat.toFixed(4)}.osm`;
}

async function fetchBox(b: Box, depth = 0): Promise<void> {
  const name = tileName(b);
  const path = join(OUT, name);
  if (existsSync(path)) {
    console.log('cached', name);
    return;
  }
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' } });
  } catch (err) {
    console.log('network error, retrying once in 5s:', name, String(err));
    await new Promise((r) => setTimeout(r, 5000));
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' } });
  }
  if (res.status === 400 || res.status === 509 || res.status === 503) {
    const text = await res.text();
    if (depth >= 4) throw new Error(`cannot split further: ${name} ${res.status} ${text.slice(0, 200)}`);
    console.log(`split (${res.status}) ${name}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
    const midLon = (b.minLon + b.maxLon) / 2;
    const midLat = (b.minLat + b.maxLat) / 2;
    const quads: Box[] = [
      { minLon: b.minLon, minLat: b.minLat, maxLon: midLon, maxLat: midLat },
      { minLon: midLon, minLat: b.minLat, maxLon: b.maxLon, maxLat: midLat },
      { minLon: b.minLon, minLat: midLat, maxLon: midLon, maxLat: b.maxLat },
      { minLon: midLon, minLat: midLat, maxLon: b.maxLon, maxLat: b.maxLat },
    ];
    for (const q of quads) await fetchBox(q, depth + 1);
    return;
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}: ${(await res.text()).slice(0, 300)}`);
  const xml = await res.text();
  writeFileSync(path, xml);
  console.log('saved', name, (xml.length / 1e6).toFixed(1), 'MB');
  await new Promise((r) => setTimeout(r, 1500)); // be polite to the OSM API
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const tiles: Box[] = [];
  for (let lon = AREA.minLon; lon < AREA.maxLon - 1e-9; lon += TILE) {
    for (let lat = AREA.minLat; lat < AREA.maxLat - 1e-9; lat += TILE) {
      tiles.push({
        minLon: +lon.toFixed(4),
        minLat: +lat.toFixed(4),
        maxLon: +Math.min(lon + TILE, AREA.maxLon).toFixed(4),
        maxLat: +Math.min(lat + TILE, AREA.maxLat).toFixed(4),
      });
    }
  }
  console.log(`fetching ${tiles.length} tiles for`, AREA);
  for (const t of tiles) await fetchBox(t);
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ area: AREA, tile: TILE, fetchedAt: new Date().toISOString(), source: 'https://api.openstreetmap.org/api/0.6/map', license: 'ODbL 1.0 — © OpenStreetMap contributors' }, null, 2));
  console.log('done');
}

if (process.argv[1] && /fetch-osm\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
