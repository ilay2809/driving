/**
 * Minimap (bottom left, 220×220): lanes within ~180 m from the RoadGraph (static render
 * cached per 200 m tile), junction control markers, signal states, the route polyline,
 * the next-junction highlight, the player arrow, traffic and pedestrians.
 * North-up or heading-up (UI preference).
 */
import type { SimContext } from '@/core/sim';
import type { TrafficAgentState } from '@/core/types';
import { dist2, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Junction, Lane, SignalState, WorldFile } from '@/world/schema';
import { el, setText } from './dom';
import { HUD } from './strings.he';
import { TILE_SIZE_M, TileCache, tilesInView } from './minimapTiles';

export interface MinimapOptions {
  sizePx?: number;
  radiusM?: number;
  headingUp?: boolean;
  /** Redraw rate (Hz). */
  fps?: number;
}

export type RoutePath = Vec2[] | { laneIds: string[]; connectorIds: string[] };

const LANE_COLOURS: Record<Lane['kind'], string> = {
  drive: '#3f4b58',
  bus: '#5b4a1c',
  bike: '#1e3d35',
  parking: '#2b333c',
  shoulder: '#2b333c',
};
const AREA_COLOURS: Partial<Record<WorldFile['areas'][number]['kind'], string>> = {
  park: '#15301f',
  grass: '#15301f',
  forest: '#123020',
  water: '#0f2a40',
  sand: '#3a3421',
  school: '#2a2a3a',
  sports: '#1b3328',
  cemetery: '#1d2a22',
};
const SIGNAL_COLOURS: Record<SignalState, string> = {
  red: '#ef4444',
  red_amber: '#f59e0b',
  green: '#22c55e',
  flashing_green: '#22c55e',
  amber: '#f59e0b',
  flashing_amber: '#f59e0b',
  off: '#334155',
};

type TileCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): TileCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(w, h);
    } catch {
      /* fall through */
    }
  }
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Build the route polyline from lane/connector ids (lanes and connectors alternate). */
export function routeToPolyline(graph: RoadGraph, path: { laneIds: string[]; connectorIds: string[] }): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < path.laneIds.length; i++) {
    const lane = graph.lanes.get(path.laneIds[i]!);
    if (lane) out.push(...lane.centre);
    const cid = path.connectorIds[i];
    if (cid) {
      const c = graph.connectors.get(cid);
      if (c) out.push(...c.path);
    }
  }
  return out;
}

export class Minimap {
  readonly el: HTMLElement;
  readonly streetEl: HTMLElement;
  headingUp: boolean;
  private canvas: HTMLCanvasElement;
  private c2d: CanvasRenderingContext2D | null = null;
  private c2dTried = false;
  private northEl: HTMLElement;
  private sizePx: number;
  private radiusM: number;
  private pxPerM: number;
  private dpr = 1;
  private tiles: TileCache<TileCanvas | null>;
  private graph?: RoadGraph;
  private world?: WorldFile;
  private areaBoxes: { minX: number; minZ: number; maxX: number; maxZ: number; idx: number }[] = [];
  private routeRaw: RoutePath | null = null;
  private route: Vec2[] | null = null;
  private nextJunctionId?: string;
  private acc = 0;
  private drawnOnce = false;
  private interval: number;
  private lastStreet = '';
  private lastRotationDeg = NaN;

  constructor(opts: MinimapOptions = {}) {
    this.sizePx = opts.sizePx ?? 220;
    this.radiusM = opts.radiusM ?? 180;
    this.headingUp = opts.headingUp ?? true;
    this.interval = 1 / (opts.fps ?? 15);
    this.pxPerM = this.sizePx / 2 / this.radiusM;
    this.canvas = el('canvas', { attrs: { role: 'img', 'aria-label': HUD.minimap } });
    this.canvas.width = this.sizePx;
    this.canvas.height = this.sizePx;
    this.northEl = el('div', { class: 'minimap-north', attrs: { 'aria-hidden': 'true' }, text: HUD.north });
    const scale = el('div', { class: 'minimap-scale', attrs: { 'aria-hidden': 'true' } }, el('i'), el('span', { text: HUD.scale(50) }));
    this.el = el('div', { class: 'minimap glass' }, this.canvas, this.northEl, scale);
    this.streetEl = el('div', { class: 'minimap-street glass', attrs: { role: 'status' } });
    this.streetEl.hidden = true;
    this.tiles = new TileCache<TileCanvas | null>(TILE_SIZE_M, (tx, tz) => this.renderTile(tx, tz), 48);
  }

  setRoute(path: RoutePath | null): void {
    this.routeRaw = path;
    this.route = null;
    this.resolveRoute();
  }

  setNextJunction(id: string | undefined): void {
    this.nextJunctionId = id;
  }

  /** Pixel scale (px per metre) — exposed for tests. */
  get scale(): number {
    return this.pxPerM;
  }

  private resolveRoute(): void {
    if (!this.routeRaw) {
      this.route = null;
      return;
    }
    if (Array.isArray(this.routeRaw)) {
      this.route = this.routeRaw;
      return;
    }
    if (this.graph) this.route = routeToPolyline(this.graph, this.routeRaw);
  }

  private ctx2d(): CanvasRenderingContext2D | null {
    if (this.c2dTried) return this.c2d;
    this.c2dTried = true;
    try {
      this.c2d = this.canvas.getContext('2d');
    } catch {
      this.c2d = null;
    }
    return this.c2d;
  }

  private bindWorld(ctx: SimContext): void {
    if (ctx.graph === this.graph && ctx.world === this.world) return;
    this.graph = ctx.graph;
    this.world = ctx.world;
    this.tiles.clear();
    this.areaBoxes = this.world.areas.map((a, idx) => {
      let minX = Infinity,
        minZ = Infinity,
        maxX = -Infinity,
        maxZ = -Infinity;
      for (const p of a.polygon) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1];
        if (p[1] > maxZ) maxZ = p[1];
      }
      return { minX, minZ, maxX, maxZ, idx };
    });
    this.resolveRoute();
  }

  update(ctx: SimContext): void {
    this.bindWorld(ctx);
    const wallDt = ctx.timeScale > 0 ? ctx.dt / ctx.timeScale : ctx.dt;
    this.acc += wallDt;
    if (this.drawnOnce && this.acc < this.interval - 1e-4) return;
    this.drawnOnce = true;
    this.acc = 0;
    this.updateStreet(ctx);
    const c = this.ctx2d();
    if (!c) return;
    this.draw(c, ctx);
  }

  private updateStreet(ctx: SimContext): void {
    let name = '';
    const loc = ctx.localisation;
    if (loc.roadId) name = ctx.graph.roads.get(loc.roadId)?.name ?? '';
    if (!name && loc.laneId) {
      const lane = ctx.graph.lanes.get(loc.laneId);
      if (lane) name = ctx.graph.roads.get(lane.roadId)?.name ?? '';
    }
    if (!name && loc.junctionId) name = ctx.graph.junctions.get(loc.junctionId)?.name ?? '';
    if (name === this.lastStreet) return;
    this.lastStreet = name;
    setText(this.streetEl, name);
    this.streetEl.hidden = !name;
  }

  // ------------------------------------------------------------ drawing
  private draw(c: CanvasRenderingContext2D, ctx: SimContext): void {
    const dpr = typeof devicePixelRatio === 'number' ? Math.min(2, Math.max(1, devicePixelRatio)) : 1;
    if (dpr !== this.dpr || this.canvas.width !== this.sizePx * dpr) {
      this.dpr = dpr;
      this.canvas.width = this.sizePx * dpr;
      this.canvas.height = this.sizePx * dpr;
      this.tiles.clear();
    }
    const size = this.sizePx;
    const half = size / 2;
    const s = this.pxPerM;
    const p = ctx.player;
    const px = p.pos[0];
    const pz = p.pos[1];
    const rot = this.headingUp ? -Math.PI / 2 - p.heading : 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const toScreen = (wx: number, wz: number): [number, number] => {
      const dx = (wx - px) * s;
      const dz = (wz - pz) * s;
      return [half + dx * cos - dz * sin, half + dx * sin + dz * cos];
    };

    c.save();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0d1219';
    c.fillRect(0, 0, size, size);

    // static tiles (world space)
    c.save();
    c.translate(half, half);
    c.rotate(rot);
    c.scale(s, s);
    c.translate(-px, -pz);
    const viewRadius = this.headingUp ? this.radiusM * 1.42 : this.radiusM;
    for (const t of tilesInView(px, pz, viewRadius, TILE_SIZE_M)) {
      const tile = this.tiles.get(t.tx, t.tz);
      if (tile) c.drawImage(tile as CanvasImageSource, t.tx * TILE_SIZE_M, t.tz * TILE_SIZE_M, TILE_SIZE_M, TILE_SIZE_M);
    }
    c.restore();

    // route (screen space)
    if (this.route && this.route.length > 1) {
      c.beginPath();
      let started = false;
      for (const pt of this.route) {
        if (Math.abs(pt[0] - px) > viewRadius * 1.5 || Math.abs(pt[1] - pz) > viewRadius * 1.5) {
          started = false;
          continue;
        }
        const [sx, sy] = toScreen(pt[0], pt[1]);
        if (!started) {
          c.moveTo(sx, sy);
          started = true;
        } else c.lineTo(sx, sy);
      }
      c.lineWidth = 3.5;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      c.stroke();
    }

    // junction control markers (screen space, fixed pixel size)
    const graph = ctx.graph;
    for (const j of graph.junctionsWithin(p.pos, viewRadius)) this.drawJunctionMarkers(c, j, toScreen);

    // next junction highlight
    if (this.nextJunctionId) {
      const j = graph.junctions.get(this.nextJunctionId);
      if (j) {
        const [sx, sy] = toScreen(j.position[0], j.position[1]);
        const pulse = 0.5 + 0.5 * Math.sin(ctx.time * 4);
        c.beginPath();
        c.arc(sx, sy, 9 + pulse * 3, 0, Math.PI * 2);
        c.lineWidth = 2;
        c.strokeStyle = `rgba(56, 189, 248, ${0.5 + pulse * 0.5})`;
        c.stroke();
      }
    }

    // signal heads
    for (const ctrl of ctx.world.signals) {
      const j = graph.junctions.get(ctrl.junctionId);
      if (j && dist2(j.position, p.pos) > viewRadius + 40) continue;
      for (const g of ctrl.groups) {
        if (g.pedestrian) continue;
        const state = ctx.signals.stateOf(g.id);
        let colour = SIGNAL_COLOURS[state] ?? SIGNAL_COLOURS.off;
        if ((state === 'flashing_green' || state === 'flashing_amber') && Math.floor(ctx.time * 3) % 2 === 1) colour = SIGNAL_COLOURS.off;
        for (const h of g.heads) {
          const [sx, sy] = toScreen(h.pos[0], h.pos[1]);
          c.beginPath();
          c.arc(sx, sy, 3.2, 0, Math.PI * 2);
          c.fillStyle = colour;
          c.fill();
          c.lineWidth = 1;
          c.strokeStyle = 'rgba(0,0,0,0.6)';
          c.stroke();
        }
      }
    }

    // traffic
    for (const a of ctx.traffic) this.drawAgent(c, a, toScreen, rot, s, viewRadius, p.pos);

    // player arrow (always at the centre)
    c.save();
    c.translate(half, half);
    c.rotate(this.headingUp ? -Math.PI / 2 : p.heading);
    c.beginPath();
    c.moveTo(9, 0);
    c.lineTo(-7, -6);
    c.lineTo(-4, 0);
    c.lineTo(-7, 6);
    c.closePath();
    c.fillStyle = '#3b82f6';
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = '#fff';
    c.stroke();
    c.restore();

    c.restore();

    const deg = Math.round((rot * 180) / Math.PI);
    if (deg !== this.lastRotationDeg) {
      this.lastRotationDeg = deg;
      this.northEl.style.transform = `rotate(${deg}deg)`;
    }
  }

  private drawJunctionMarkers(c: CanvasRenderingContext2D, j: Junction, toScreen: (x: number, z: number) => [number, number]): void {
    for (const a of j.approaches) {
      if (a.control !== 'stop' && a.control !== 'give_way') continue;
      let pos: Vec2;
      if (a.stopLine) pos = [(a.stopLine[0][0] + a.stopLine[1][0]) / 2, (a.stopLine[0][1] + a.stopLine[1][1]) / 2];
      else pos = [j.position[0] - Math.cos(a.heading) * 8, j.position[1] - Math.sin(a.heading) * 8];
      const [sx, sy] = toScreen(pos[0], pos[1]);
      c.beginPath();
      if (a.control === 'stop') {
        const r = 4;
        for (let k = 0; k < 8; k++) {
          const ang = Math.PI / 8 + (k * Math.PI) / 4;
          const x = sx + Math.cos(ang) * r;
          const y = sy + Math.sin(ang) * r;
          if (k === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.closePath();
        c.fillStyle = '#ef4444';
      } else {
        c.moveTo(sx - 4, sy - 3.5);
        c.lineTo(sx + 4, sy - 3.5);
        c.lineTo(sx, sy + 4);
        c.closePath();
        c.fillStyle = '#f59e0b';
      }
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = '#fff';
      c.stroke();
    }
  }

  private drawAgent(c: CanvasRenderingContext2D, a: TrafficAgentState, toScreen: (x: number, z: number) => [number, number], rot: number, s: number, viewRadius: number, ppos: Vec2): void {
    if (Math.abs(a.pos[0] - ppos[0]) > viewRadius || Math.abs(a.pos[1] - ppos[1]) > viewRadius) return;
    const [sx, sy] = toScreen(a.pos[0], a.pos[1]);
    if (a.kind === 'pedestrian') {
      c.beginPath();
      c.arc(sx, sy, 1.8, 0, Math.PI * 2);
      c.fillStyle = a.pedState === 'crossing' ? '#fde68a' : '#f8fafc';
      c.fill();
      return;
    }
    c.save();
    c.translate(sx, sy);
    c.rotate(a.heading + rot);
    const L = Math.max(3.5, a.length * s);
    const W = Math.max(2, a.width * s);
    c.fillStyle = a.kind === 'bus' || a.kind === 'truck' ? '#fbbf24' : a.kind === 'emergency' ? '#f87171' : a.kind === 'bicycle' || a.kind === 'scooter' || a.kind === 'motorcycle' ? '#a3e635' : '#cbd5e1';
    c.fillRect(-L / 2, -W / 2, L, W);
    c.restore();
  }

  // -------------------------------------------------------------- tiles
  private renderTile(tx: number, tz: number): TileCanvas | null {
    const graph = this.graph;
    const world = this.world;
    if (!graph || !world) return null;
    const s = this.pxPerM * this.dpr;
    const px = Math.ceil(TILE_SIZE_M * s);
    const canvas = makeCanvas(px, px);
    if (!canvas) return null;
    const c = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null;
    if (!c) return null;
    const x0 = tx * TILE_SIZE_M;
    const z0 = tz * TILE_SIZE_M;
    const x1 = x0 + TILE_SIZE_M;
    const z1 = z0 + TILE_SIZE_M;
    c.scale(px / TILE_SIZE_M, px / TILE_SIZE_M);
    c.translate(-x0, -z0);
    c.fillStyle = '#0d1219';
    c.fillRect(x0, z0, TILE_SIZE_M, TILE_SIZE_M);

    // areas
    for (const b of this.areaBoxes) {
      if (b.maxX < x0 || b.minX > x1 || b.maxZ < z0 || b.minZ > z1) continue;
      const a = world.areas[b.idx]!;
      const colour = AREA_COLOURS[a.kind];
      if (!colour) continue;
      c.beginPath();
      a.polygon.forEach((p, i) => (i === 0 ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1])));
      c.closePath();
      c.fillStyle = colour;
      c.fill();
    }

    const centre: Vec2 = [x0 + TILE_SIZE_M / 2, z0 + TILE_SIZE_M / 2];
    // junction pavements
    for (const j of graph.junctionsWithin(centre, TILE_SIZE_M)) {
      if (!j.polygon) continue;
      c.beginPath();
      j.polygon.forEach((p, i) => (i === 0 ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1])));
      c.closePath();
      c.fillStyle = LANE_COLOURS.drive;
      c.fill();
    }
    // lanes
    c.lineCap = 'butt';
    c.lineJoin = 'round';
    const lanes = graph.lanesWithin(centre, TILE_SIZE_M);
    for (const lane of lanes) {
      c.beginPath();
      lane.centre.forEach((p, i) => (i === 0 ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1])));
      c.lineWidth = lane.width + 0.4;
      c.strokeStyle = LANE_COLOURS[lane.kind];
      c.stroke();
    }
    // lane edge hint: thin lighter centre line for drive lanes
    c.lineWidth = 0.35;
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    for (const lane of lanes) {
      if (lane.kind !== 'drive' || lane.index !== 0) continue;
      c.beginPath();
      lane.centre.forEach((p, i) => (i === 0 ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1])));
      c.stroke();
    }
    // crossings
    for (const cr of graph.crossingsWithin(centre, TILE_SIZE_M)) {
      c.beginPath();
      c.moveTo(cr.line[0][0], cr.line[0][1]);
      c.lineTo(cr.line[1][0], cr.line[1][1]);
      c.lineWidth = Math.max(1.5, cr.width * 0.8);
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.stroke();
    }
    return canvas;
  }

  /** Static tile cache (exposed for tests / profiling). */
  get tileCache(): TileCache<TileCanvas | null> {
    return this.tiles;
  }

  dispose(): void {
    this.tiles.clear();
    this.el.remove();
    this.streetEl.remove();
  }
}
