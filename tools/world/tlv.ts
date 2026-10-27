/**
 * Tel Aviv municipal GIS layers (data/raw/tlv/*.geojson, fetched by fetch-tlv.ts),
 * projected into world metres. Every layer is optional: a missing file yields an
 * empty collection so the pipeline also runs from OSM alone.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Projector, Vec2 } from '@/world/geo';
import type { Building } from '@/world/schema';

export interface TlvBuilding {
  id: string;
  /** Polygons of the feature; each polygon = [outer, ...holes] without closing point. */
  polygons: Vec2[][][];
  floors?: number;
  /** gova_simplex_2019 (m). */
  height?: number;
  kind: Building['kind'];
  name?: string;
}

export interface TlvAxis {
  name: string;
  nameEn?: string;
  points: Vec2[];
}

export interface TlvPoint {
  pos: Vec2;
  name?: string;
}

export interface TlvBusLane {
  street: string;
  /** 'ימני' = kerb-side lane of a street, 'מסלול' = separate busway. */
  type: string;
  /** Compass direction name of travel, e.g. 'S', 'NW'. */
  direction: string;
  points: Vec2[];
}

export interface TlvData {
  buildings: TlvBuilding[];
  streetAxes: TlvAxis[];
  mainAxes: TlvAxis[];
  signalized: TlvPoint[];
  junctions: TlvPoint[];
  busStops: TlvPoint[];
  trees: Vec2[];
  busLanes: TlvBusLane[];
  loadingZones: TlvPoint[];
  /** Which layers were found. */
  layers: string[];
}

type Geometry = { type: string; coordinates: any } | null;
type Feature = { properties: Record<string, any>; geometry: Geometry };

function readLayer(dir: string, name: string): Feature[] | undefined {
  const path = join(dir, `${name}.geojson`);
  if (!existsSync(path)) return undefined;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return (json.features ?? []) as Feature[];
}

function ringOf(coords: number[][], proj: Projector): Vec2[] {
  const pts = coords.map((c) => proj.toWorld(c[0]!, c[1]!));
  if (pts.length >= 2) {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) pts.pop();
  }
  return pts;
}

function polygonsOf(g: Geometry, proj: Projector): Vec2[][][] {
  if (!g) return [];
  if (g.type === 'Polygon') return [(g.coordinates as number[][][]).map((r) => ringOf(r, proj))];
  if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).map((poly) => poly.map((r) => ringOf(r, proj)));
  return [];
}

function linesOf(g: Geometry, proj: Projector): Vec2[][] {
  if (!g) return [];
  if (g.type === 'LineString') return [(g.coordinates as number[][]).map((c) => proj.toWorld(c[0]!, c[1]!))];
  if (g.type === 'MultiLineString') return (g.coordinates as number[][][]).map((l) => l.map((c) => proj.toWorld(c[0]!, c[1]!)));
  return [];
}

function pointOf(g: Geometry, proj: Projector): Vec2 | undefined {
  if (!g || g.type !== 'Point') return undefined;
  const c = g.coordinates as number[];
  return proj.toWorld(c[0]!, c[1]!);
}

const TLV_KIND: Record<string, Building['kind']> = {
  'מבנה ציבור': 'public',
  'מבנה רגיל': 'residential',
  'מבנה מסחרי': 'commercial',
  'מבנה תעשיה': 'industrial',
  'מבנה חינוך': 'education',
  'מבנה דת': 'religious',
};

export function tlvBuildingKind(sug: string | undefined): Building['kind'] {
  if (!sug) return 'residential';
  const k = TLV_KIND[sug.trim()];
  if (k) return k;
  if (/ציבור/.test(sug)) return 'public';
  if (/מסחר/.test(sug)) return 'commercial';
  if (/תעשי/.test(sug)) return 'industrial';
  if (/חינוך|בית ספר|גן ילדים/.test(sug)) return 'education';
  if (/דת|כנסת/.test(sug)) return 'religious';
  return 'residential';
}

/** Height rule shared with the OSM buildings: TLV height if plausible, else floors. */
export function tlvHeightOf(b: { floors?: number; height?: number }): number | undefined {
  if (b.height !== undefined && b.height > 3) return b.height;
  if (b.floors !== undefined && b.floors > 0) return b.floors * 3 + 1;
  return undefined;
}

function cleanName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : undefined;
}

export function emptyTlv(): TlvData {
  return { buildings: [], streetAxes: [], mainAxes: [], signalized: [], junctions: [], busStops: [], trees: [], busLanes: [], loadingZones: [], layers: [] };
}

export function loadTlv(dir: string, proj: Projector): TlvData {
  const data = emptyTlv();
  const buildings = readLayer(dir, 'buildings');
  if (buildings) {
    data.layers.push('buildings');
    for (const f of buildings) {
      const p = f.properties ?? {};
      const polygons = polygonsOf(f.geometry, proj).filter((poly) => poly.length > 0 && poly[0]!.length >= 3);
      if (polygons.length === 0) continue;
      const floors = Number(p.ms_komot);
      const height = Number(p.gova_simplex_2019);
      data.buildings.push({
        id: String(p.id_binyan ?? p.oid_mivne ?? p.UniqueId ?? data.buildings.length),
        polygons,
        floors: Number.isFinite(floors) && floors > 0 ? floors : undefined,
        height: Number.isFinite(height) && height > 0 ? height : undefined,
        kind: tlvBuildingKind(p.t_sug_mivne),
        name: cleanName(p.shem_mivne),
      });
    }
  }
  const axes = readLayer(dir, 'street_axes');
  if (axes) {
    data.layers.push('street_axes');
    for (const f of axes) {
      const name = cleanName(f.properties?.t_rechov);
      if (!name) continue;
      for (const points of linesOf(f.geometry, proj)) if (points.length >= 2) data.streetAxes.push({ name, nameEn: cleanName(f.properties?.shem_angli), points });
    }
  }
  const main = readLayer(dir, 'main_street_axes');
  if (main) {
    data.layers.push('main_street_axes');
    for (const f of main) {
      const name = cleanName(f.properties?.t_rechov) ?? '';
      for (const points of linesOf(f.geometry, proj)) if (points.length >= 2) data.mainAxes.push({ name, nameEn: cleanName(f.properties?.shem_angli), points });
    }
  }
  const sig = readLayer(dir, 'signalized_junctions');
  if (sig) {
    data.layers.push('signalized_junctions');
    for (const f of sig) {
      const pos = pointOf(f.geometry, proj);
      if (pos) data.signalized.push({ pos, name: cleanName(f.properties?.shem_tzomet_win) });
    }
  }
  const junctions = readLayer(dir, 'junctions');
  if (junctions) {
    data.layers.push('junctions');
    for (const f of junctions) {
      const pos = pointOf(f.geometry, proj);
      if (pos) data.junctions.push({ pos, name: cleanName(f.properties?.shem_tzomet_win) });
    }
  }
  const stops = readLayer(dir, 'bus_stops');
  if (stops) {
    data.layers.push('bus_stops');
    for (const f of stops) {
      const pos = pointOf(f.geometry, proj);
      if (pos) data.busStops.push({ pos, name: cleanName(f.properties?.stop_name) });
    }
  }
  const trees = readLayer(dir, 'trees');
  if (trees) {
    data.layers.push('trees');
    for (const f of trees) {
      const pos = pointOf(f.geometry, proj);
      if (pos) data.trees.push(pos);
    }
  }
  const lanes = readLayer(dir, 'bus_lanes');
  if (lanes) {
    data.layers.push('bus_lanes');
    for (const f of lanes) {
      const p = f.properties ?? {};
      if (p.status && typeof p.status === 'string' && !/פעיל/.test(p.status)) continue;
      for (const points of linesOf(f.geometry, proj)) if (points.length >= 2) data.busLanes.push({ street: cleanName(p.street_name) ?? '', type: cleanName(p.type_of_nataz) ?? '', direction: cleanName(p.direction_name) ?? '', points });
    }
  }
  const loading = readLayer(dir, 'loading_zones');
  if (loading) {
    data.layers.push('loading_zones');
    for (const f of loading) {
      const pos = pointOf(f.geometry, proj);
      if (pos) data.loadingZones.push({ pos, name: cleanName(f.properties?.traffic_sign_text) });
    }
  }
  return data;
}
