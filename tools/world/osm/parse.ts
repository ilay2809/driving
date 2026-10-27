/**
 * OSM XML parsing (the raw `api/0.6/map` tiles cached in data/raw/osm).
 *
 * Tiles overlap in the elements they return (a way is returned by every tile that
 * contains one of its nodes, together with ALL of its nodes), so elements are
 * de-duplicated by id across tiles. The parser is deliberately lossy about
 * metadata (user, changeset, timestamp…): only ids, coordinates, tags and members
 * are kept, which keeps the in-memory model small (~180k nodes for North Tel Aviv).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export type Tags = Record<string, string>;

export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}

export interface OsmWay {
  id: number;
  /** Node ids in order (closed ways repeat the first id at the end, as in OSM). */
  nodes: number[];
  tags: Tags;
}

export interface OsmMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
}

export interface OsmRelation {
  id: number;
  members: OsmMember[];
  tags: Tags;
}

export interface OsmData {
  nodes: Map<number, OsmNode>;
  ways: Map<number, OsmWay>;
  relations: Map<number, OsmRelation>;
  /** Source files that were merged in (for the stats). */
  files: string[];
}

export function createOsmData(): OsmData {
  return { nodes: new Map(), ways: new Map(), relations: new Map(), files: [] };
}

const ARRAY_ELEMENTS = new Set(['node', 'way', 'relation', 'tag', 'nd', 'member']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  ignoreDeclaration: true,
  processEntities: true,
  isArray: (name) => ARRAY_ELEMENTS.has(name),
});

function tagsOf(el: any): Tags | undefined {
  const list: any[] | undefined = el.tag;
  if (!list || list.length === 0) return undefined;
  const tags: Tags = {};
  for (const t of list) {
    if (typeof t.k === 'string') tags[t.k] = String(t.v ?? '');
  }
  return tags;
}

/**
 * Parse one OSM XML document and merge it into `into` (elements already present are
 * kept — all tiles were fetched at the same time so versions are identical).
 */
export function parseOsmXml(xml: string, into: OsmData = createOsmData()): OsmData {
  const doc = parser.parse(xml);
  const osm = doc?.osm;
  if (!osm) throw new Error('not an OSM XML document (missing <osm> root)');
  for (const n of (osm.node ?? []) as any[]) {
    const id = Number(n.id);
    if (!Number.isFinite(id) || into.nodes.has(id)) continue;
    const lat = Number(n.lat);
    const lon = Number(n.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const node: OsmNode = { id, lat, lon };
    const tags = tagsOf(n);
    if (tags) node.tags = tags;
    into.nodes.set(id, node);
  }
  for (const w of (osm.way ?? []) as any[]) {
    const id = Number(w.id);
    if (!Number.isFinite(id) || into.ways.has(id)) continue;
    const nodes: number[] = [];
    for (const nd of (w.nd ?? []) as any[]) {
      const ref = Number(nd.ref);
      if (Number.isFinite(ref)) nodes.push(ref);
    }
    into.ways.set(id, { id, nodes, tags: tagsOf(w) ?? {} });
  }
  for (const r of (osm.relation ?? []) as any[]) {
    const id = Number(r.id);
    if (!Number.isFinite(id) || into.relations.has(id)) continue;
    const members: OsmMember[] = [];
    for (const m of (r.member ?? []) as any[]) {
      const ref = Number(m.ref);
      const type = m.type;
      if (!Number.isFinite(ref) || (type !== 'node' && type !== 'way' && type !== 'relation')) continue;
      members.push({ type, ref, role: String(m.role ?? '') });
    }
    into.relations.set(id, { id, members, tags: tagsOf(r) ?? {} });
  }
  return into;
}

/** Load and merge every `*.osm` file of a directory (sorted by name for determinism). */
export function loadOsmDir(dir: string, onFile?: (name: string, ms: number) => void): OsmData {
  const data = createOsmData();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.osm'))
    .sort();
  for (const f of files) {
    const t0 = performance.now();
    parseOsmXml(readFileSync(join(dir, f), 'utf8'), data);
    data.files.push(f);
    onFile?.(f, performance.now() - t0);
  }
  return data;
}

/** Nodes of a way in order (skipping references to nodes missing from the extract). */
export function wayNodes(osm: OsmData, way: OsmWay): OsmNode[] {
  const out: OsmNode[] = [];
  for (const id of way.nodes) {
    const n = osm.nodes.get(id);
    if (n) out.push(n);
  }
  return out;
}

export function isClosedWay(way: OsmWay): boolean {
  return way.nodes.length >= 4 && way.nodes[0] === way.nodes[way.nodes.length - 1];
}
