/**
 * 2-D canvas debug viewer for world files (dev/world-map.html).
 *
 *   ?world=north-tlv|training-ground   which world (default north-tlv)
 *   &x=&z=&zoom=                        initial centre (world metres) and pixels per metre
 *   &lon=&lat=                          alternatively a geographic centre
 *   &route=<id>                         highlight one route (default: all routes)
 *
 * Mouse: drag to pan, wheel to zoom, hover for ids. Exposes window.__worldMap for
 * Playwright (ready flag, setView, world).
 */
import { createProjector, dist2, pointAlong, type Vec2 } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import type { Crossing, Junction, Lane, Road, Sign, WorldFile } from '@/world/schema';
import { loadTrainingGround, loadWorld, WORLD_URL } from '@/world/loader';

interface View {
  cx: number;
  cz: number;
  /** pixels per metre */
  zoom: number;
}

const ROAD_WIDTH_PX: Record<string, number> = { motorway: 4, trunk: 3.5, primary: 3, secondary: 2.5, tertiary: 2, unclassified: 1.5, residential: 1.5, living_street: 1.2, service: 1, pedestrian: 1 };
const AREA_FILL: Record<string, string> = {
  park: 'rgba(76, 140, 76, 0.45)',
  grass: 'rgba(96, 150, 80, 0.35)',
  forest: 'rgba(40, 110, 60, 0.5)',
  water: 'rgba(60, 110, 190, 0.6)',
  sand: 'rgba(214, 190, 120, 0.5)',
  parking_lot: 'rgba(120, 120, 130, 0.35)',
  plaza: 'rgba(150, 140, 120, 0.35)',
  sports: 'rgba(130, 100, 80, 0.4)',
  construction: 'rgba(150, 120, 60, 0.3)',
  cemetery: 'rgba(90, 120, 90, 0.4)',
  school: 'rgba(130, 110, 170, 0.3)',
};
const LANE_COLOUR: Record<string, string> = { drive: '#6fa8dc', bus: '#f2c230', bike: '#7bd389', parking: '#b0b0b0', shoulder: '#808080' };
const CONTROL_COLOUR: Record<string, string> = { signals: '#2ecc71', stop: '#e04c4c', give_way: '#f0f0f0', priority: '#6fa8dc', right_hand_rule: '#f39c12', roundabout_entry: '#c58af9', none: '#555' };
const ROUTE_COLOURS = ['#ff7a45', '#ff4d9d', '#45d9ff', '#b4ff45', '#ffd245', '#c58af9'];

function params(): URLSearchParams {
  return new URLSearchParams(location.search);
}

class WorldMap {
  readonly canvas = document.getElementById('map') as HTMLCanvasElement;
  readonly ctx = this.canvas.getContext('2d')!;
  readonly status = document.getElementById('status')!;
  readonly tooltip = document.getElementById('tooltip')!;
  readonly graph: RoadGraph;
  readonly proj;
  view: View;
  private dirty = true;
  private dragging?: { x: number; y: number; cx: number; cz: number };
  private hover?: { x: number; y: number };
  private routePaths: { id: string; name: string; pts: Vec2[]; colour: string }[] = [];
  private laneBBox = new Map<string, [number, number, number, number]>();
  private signGrid = new Map<string, Sign[]>();
  private buildingBBox: [number, number, number, number][] = [];
  private areaBBox: [number, number, number, number][] = [];
  ready = false;

  constructor(
    readonly world: WorldFile,
    initial: Partial<View>,
    routeFilter?: string,
  ) {
    this.graph = new RoadGraph(world);
    this.proj = createProjector(world.origin);
    const b = world.bbox;
    const fitZoom = Math.min(innerWidth / Math.max(1, b.maxX - b.minX), innerHeight / Math.max(1, b.maxZ - b.minZ)) * 0.95;
    this.view = { cx: initial.cx ?? (b.minX + b.maxX) / 2, cz: initial.cz ?? (b.minZ + b.maxZ) / 2, zoom: initial.zoom ?? fitZoom };
    for (const l of world.lanes) this.laneBBox.set(l.id, bboxOf(l.centre));
    for (const bld of world.buildings) this.buildingBBox.push(bboxOf(bld.footprint));
    for (const a of world.areas) this.areaBBox.push(bboxOf(a.polygon));
    for (const s of world.signs) {
      const k = `${Math.floor(s.pos[0] / 50)},${Math.floor(s.pos[1] / 50)}`;
      const list = this.signGrid.get(k) ?? [];
      list.push(s);
      this.signGrid.set(k, list);
    }
    this.resolveRoutes(routeFilter);
    this.bind();
    this.resize();
  }

  private resolveRoutes(filter?: string): void {
    for (const [i, r] of this.world.routes.entries()) {
      if (filter && r.id !== filter) continue;
      const sp = this.graph.spawnPoints.get(r.spawnId);
      if (!sp?.laneId) continue;
      const path = this.graph.routeViaJunctions(sp.laneId, r.waypoints);
      if (!path) continue;
      // Walk lane by lane; sibling lane changes have no connector (findPath records them
      // without one), so look the connector up between consecutive lanes instead of
      // zipping the two id lists.
      const pts: Vec2[] = [];
      const laneIds = path.laneIds;
      for (let k = 0; k < laneIds.length; k++) {
        const lane = this.graph.lane(laneIds[k]!);
        pts.push(...lane.centre);
        const nextId = laneIds[k + 1];
        if (!nextId) break;
        const conn = this.graph.connectorsFrom(lane.id).find((c) => c.toLane === nextId);
        if (conn) pts.push(...conn.path);
      }
      this.routePaths.push({ id: r.id, name: r.name, pts, colour: ROUTE_COLOURS[i % ROUTE_COLOURS.length]! });
    }
  }

  private bind(): void {
    addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('mousedown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz };
      this.canvas.classList.add('dragging');
    });
    addEventListener('mouseup', () => {
      this.dragging = undefined;
      this.canvas.classList.remove('dragging');
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        this.view.cx = this.dragging.cx - (e.clientX - this.dragging.x) / this.view.zoom;
        this.view.cz = this.dragging.cz - (e.clientY - this.dragging.y) / this.view.zoom;
        this.invalidate();
      }
      this.hover = { x: e.clientX, y: e.clientY };
      this.updateTooltip();
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.hover = undefined;
      this.tooltip.style.display = 'none';
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        const before = this.toWorld(e.clientX, e.clientY);
        this.view.zoom = Math.min(40, Math.max(0.02, this.view.zoom * factor));
        const after = this.toWorld(e.clientX, e.clientY);
        this.view.cx += before[0] - after[0];
        this.view.cz += before[1] - after[1];
        this.invalidate();
      },
      { passive: false },
    );
    addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') this.view.zoom *= 1.5;
      else if (e.key === '-') this.view.zoom /= 1.5;
      else return;
      this.invalidate();
    });
  }

  setView(cx: number, cz: number, zoom?: number): void {
    this.view.cx = cx;
    this.view.cz = cz;
    if (zoom) this.view.zoom = zoom;
    this.invalidate();
  }

  toScreen(p: Vec2): [number, number] {
    return [(p[0] - this.view.cx) * this.view.zoom + innerWidth / 2, (p[1] - this.view.cz) * this.view.zoom + innerHeight / 2];
  }
  toWorld(x: number, y: number): Vec2 {
    return [(x - innerWidth / 2) / this.view.zoom + this.view.cx, (y - innerHeight / 2) / this.view.zoom + this.view.cz];
  }

  private resize(): void {
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.floor(innerWidth * dpr);
    this.canvas.height = Math.floor(innerHeight * dpr);
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
    this.invalidate();
  }

  invalidate(): void {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => this.render());
  }

  /** Visible world rectangle (with margin). */
  private visible(): [number, number, number, number] {
    const a = this.toWorld(-40, -40);
    const b = this.toWorld(innerWidth + 40, innerHeight + 40);
    return [a[0], a[1], b[0], b[1]];
  }

  render(): void {
    this.dirty = false;
    const ctx = this.ctx;
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1f27';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    const z = this.view.zoom;
    const vis = this.visible();
    const inView = (b: [number, number, number, number]) => b[2] >= vis[0] && b[0] <= vis[2] && b[3] >= vis[1] && b[1] <= vis[3];
    const S = (p: Vec2) => this.toScreen(p);
    const poly = (pts: Vec2[], close = false) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = S(p);
        if (i === 0) ctx.moveTo(s[0], s[1]);
        else ctx.lineTo(s[0], s[1]);
      });
      if (close) ctx.closePath();
    };
    const w = this.world;

    // areas
    if (z > 0.08) {
      for (const [i, a] of w.areas.entries()) {
        if (!inView(this.areaBBox[i]!)) continue;
        ctx.fillStyle = AREA_FILL[a.kind] ?? 'rgba(120,120,120,0.3)';
        poly(a.polygon, true);
        ctx.fill();
        for (const h of a.holes) {
          ctx.fillStyle = '#1b1f27';
          poly(h, true);
          ctx.fill();
        }
      }
    }
    // buildings
    if (z > 0.35) {
      ctx.fillStyle = 'rgba(150, 140, 130, 0.35)';
      ctx.strokeStyle = 'rgba(200, 190, 180, 0.5)';
      ctx.lineWidth = 1;
      for (const [i, b] of w.buildings.entries()) {
        if (!inView(this.buildingBBox[i]!)) continue;
        poly(b.footprint, true);
        ctx.fill();
        if (z > 1.5) ctx.stroke();
      }
    }
    // roads (carriageway)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of w.roads) {
      const b = bboxOf(r.centre);
      if (!inView(b)) continue;
      const wPx = z > 1 ? r.width * z : ROAD_WIDTH_PX[r.cls] ?? 1.5;
      ctx.strokeStyle = r.cls === 'service' ? '#6b7280' : r.cls === 'motorway' || r.cls === 'trunk' ? '#b7bcc8' : '#9aa3b2';
      ctx.lineWidth = Math.max(0.8, wPx);
      poly(r.centre);
      ctx.stroke();
    }
    // junction polygons
    if (z > 1) {
      ctx.fillStyle = 'rgba(160, 170, 190, 0.45)';
      for (const j of w.junctions) {
        if (!j.polygon) continue;
        if (!inView(bboxOf(j.polygon))) continue;
        poly(j.polygon, true);
        ctx.fill();
      }
    }
    // lanes + direction ticks
    if (z > 0.6) {
      for (const l of w.lanes) {
        if (!inView(this.laneBBox.get(l.id)!)) continue;
        ctx.strokeStyle = LANE_COLOUR[l.kind] ?? '#888';
        ctx.lineWidth = l.kind === 'bus' ? 1.8 : 1;
        poly(l.centre);
        ctx.stroke();
        if (z > 2.5) {
          const step = z > 8 ? 8 : 20;
          for (let s = step / 2; s < l.length; s += step) {
            const at = pointAlong(l.centre, s);
            const p = S(at.p);
            const d = 4;
            ctx.beginPath();
            ctx.moveTo(p[0] - Math.cos(at.h - 2.5) * d, p[1] - Math.sin(at.h - 2.5) * d);
            ctx.lineTo(p[0], p[1]);
            ctx.lineTo(p[0] - Math.cos(at.h + 2.5) * d, p[1] - Math.sin(at.h + 2.5) * d);
            ctx.stroke();
          }
        }
      }
    }
    // connectors
    if (z > 2) {
      ctx.lineWidth = 0.8;
      for (const c of w.connectors) {
        if (!inView(bboxOf(c.path))) continue;
        ctx.strokeStyle = c.turn === 'uturn' ? 'rgba(200, 120, 255, 0.35)' : c.signalGroup ? 'rgba(46, 204, 113, 0.6)' : 'rgba(111, 168, 220, 0.55)';
        poly(c.path);
        ctx.stroke();
      }
    }
    // crossings (striped) + stop lines + controls
    if (z > 1.2) {
      for (const c of w.crossings) {
        if (!inView(bboxOf(c.line))) continue;
        this.drawCrossing(c);
      }
      for (const j of w.junctions) {
        if (!inView([j.position[0] - 30, j.position[1] - 30, j.position[0] + 30, j.position[1] + 30])) continue;
        for (const a of j.approaches) {
          if (a.stopLine) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1.5, 0.4 * z);
            poly(a.stopLine);
            ctx.stroke();
          }
          this.drawControl(j, a);
        }
        if (j.kind === 'roundabout' && j.roundabout) {
          const c = S(j.roundabout.centre);
          ctx.strokeStyle = '#c58af9';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c[0], c[1], Math.max(4, j.roundabout.radius * z * 0.5), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    } else {
      // low zoom: signals as dots
      ctx.fillStyle = '#2ecc71';
      for (const j of w.junctions) {
        if (!j.signalController) continue;
        const p = S(j.position);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // signs
    if (z > 2.5) {
      ctx.font = `${Math.max(9, Math.min(14, 3 * z))}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const s of w.signs) {
        if (!inView([s.pos[0], s.pos[1], s.pos[0], s.pos[1]])) continue;
        const p = S(s.pos);
        ctx.fillStyle = s.code === '302' ? '#e04c4c' : s.code === '301' || s.code === '303' ? '#f5f5f5' : '#ffd166';
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(s.value !== undefined ? `${s.code}:${s.value}` : s.code, p[0], p[1] - 9);
      }
    }
    // props
    if (z > 3) {
      for (const p of w.props) {
        if (!inView([p.pos[0], p.pos[1], p.pos[0], p.pos[1]])) continue;
        const s = S(p.pos);
        ctx.fillStyle = p.kind === 'tree' ? '#3b9d5a' : p.kind === 'lamp' ? '#ffe08a' : p.kind === 'bus_stop' ? '#4aa3ff' : p.kind === 'speed_bump' ? '#ff9f43' : '#aaa';
        ctx.beginPath();
        ctx.arc(s[0], s[1], p.kind === 'tree' ? 2.5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // routes
    for (const r of this.routePaths) {
      ctx.strokeStyle = r.colour;
      ctx.lineWidth = Math.max(2, Math.min(6, 1.5 * z));
      ctx.globalAlpha = 0.8;
      poly(r.pts);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // spawn points
    for (const sp of w.spawnPoints) {
      const p = S(sp.pos);
      ctx.fillStyle = '#3ddc84';
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3ddc84';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[0] + Math.cos(sp.heading) * 14, p[1] + Math.sin(sp.heading) * 14);
      ctx.stroke();
      if (z > 0.5) {
        ctx.fillStyle = '#d8ffe8';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(sp.id, p[0] + 7, p[1] - 4);
      }
    }
    // street names
    if (z > 1.4) {
      ctx.fillStyle = '#f3f4f6';
      ctx.font = `${Math.max(10, Math.min(13, 4 * z))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = 'rtl';
      const placed: [number, number][] = [];
      for (const r of w.roads) {
        if (!r.name || r.length < 25 / Math.min(1, z)) continue;
        if (!inView(bboxOf(r.centre))) continue;
        const at = pointAlong(r.centre, r.length / 2);
        const p = S(at.p);
        if (placed.some((q) => Math.abs(q[0] - p[0]) < 90 && Math.abs(q[1] - p[1]) < 14)) continue;
        placed.push(p);
        let h = at.h;
        if (h > Math.PI / 2 || h < -Math.PI / 2) h += Math.PI;
        ctx.save();
        ctx.translate(p[0], p[1]);
        ctx.rotate(h);
        ctx.fillText(r.name, 0, -Math.max(4, r.width * z * 0.5 + 6));
        ctx.restore();
      }
      ctx.direction = 'ltr';
    }
    this.updateStatus();
  }

  private drawCrossing(c: Crossing): void {
    const ctx = this.ctx;
    const z = this.view.zoom;
    const a = this.toScreen(c.line[0]);
    const b = this.toScreen(c.line[1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    const n = Math.max(2, Math.floor(L / Math.max(4, 1.0 * z)));
    const wPx = Math.max(3, c.width * z);
    const nx = -dy / L;
    const ny = dx / L;
    ctx.strokeStyle = c.kind === 'signals' ? '#2ecc71' : '#ffe08a';
    ctx.lineWidth = Math.max(1, wPx * 0.4);
    for (let i = 0; i < n; i++) {
      if (i % 2 === 1) continue;
      const t0 = i / n;
      const t1 = (i + 1) / n;
      ctx.beginPath();
      ctx.moveTo(a[0] + dx * t0 + (nx * wPx) / 2, a[1] + dy * t0 + (ny * wPx) / 2);
      ctx.lineTo(a[0] + dx * t1 + (nx * wPx) / 2, a[1] + dy * t1 + (ny * wPx) / 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 224, 138, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  private drawControl(j: Junction, a: Junction['approaches'][number]): void {
    const ctx = this.ctx;
    if (!a.stopLine) return;
    const z = this.view.zoom;
    const mid: Vec2 = [(a.stopLine[0][0] + a.stopLine[1][0]) / 2, (a.stopLine[0][1] + a.stopLine[1][1]) / 2];
    // marker a few metres before the stop line (against the traffic heading)
    const back: Vec2 = [mid[0] - Math.cos(a.heading) * 2.5, mid[1] - Math.sin(a.heading) * 2.5];
    const p = this.toScreen(back);
    const r = Math.max(3.5, Math.min(9, 1.2 * z));
    ctx.fillStyle = CONTROL_COLOUR[a.control] ?? '#888';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (a.control === 'stop') {
      for (let k = 0; k < 8; k++) {
        const ang = (Math.PI / 4) * k + Math.PI / 8;
        const x = p[0] + Math.cos(ang) * r;
        const y = p[1] + Math.sin(ang) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    } else if (a.control === 'give_way' || a.control === 'roundabout_entry') {
      ctx.moveTo(p[0], p[1] + r);
      ctx.lineTo(p[0] - r, p[1] - r * 0.8);
      ctx.lineTo(p[0] + r, p[1] - r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e04c4c';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (a.control === 'signals') {
      ctx.arc(p[0], p[1], r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (a.control === 'right_hand_rule') {
      ctx.rect(p[0] - r * 0.6, p[1] - r * 0.6, r * 1.2, r * 1.2);
      ctx.fill();
    } else if (a.control === 'priority') {
      ctx.rect(p[0] - r * 0.5, p[1] - r * 0.5, r, r);
      ctx.fillStyle = 'rgba(111,168,220,0.5)';
      ctx.fill();
    }
    void j;
  }

  private updateStatus(): void {
    const w = this.world;
    const c = this.hover ? this.toWorld(this.hover.x, this.hover.y) : [this.view.cx, this.view.cz];
    const ll = this.proj.toLonLat(c[0]!, c[1]!);
    this.status.textContent = `${w.name} · roads ${w.roads.length} · lanes ${w.lanes.length} · junctions ${w.junctions.length} · connectors ${w.connectors.length} · signals ${w.signals.length} · crossings ${w.crossings.length} · signs ${w.signs.length} · buildings ${w.buildings.length} · routes ${w.routes.length} | x ${c[0]!.toFixed(1)} z ${c[1]!.toFixed(1)} | lon ${ll.lon.toFixed(5)} lat ${ll.lat.toFixed(5)} | zoom ${this.view.zoom.toFixed(2)} px/m`;
  }

  private updateTooltip(): void {
    if (!this.hover) return;
    const p = this.toWorld(this.hover.x, this.hover.y);
    const tol = 8 / this.view.zoom;
    const lines: string[] = [];
    const j = this.graph.junctionsWithin(p, Math.max(tol, 3)).sort((a, b) => dist2(a.position, p) - dist2(b.position, p))[0];
    if (j) lines.push(`junction ${j.id} (${j.kind}) ${j.name ?? ''}`, `  approaches: ${j.approaches.map((a) => `${a.roadId}=${a.control}${a.crossingId ? ' +crossing' : ''}`).join(', ')}`, j.signalController ? `  signals: ${j.signalController}` : '');
    const m = this.graph.nearestLane(p, { maxDist: tol });
    if (m) {
      const road = this.graph.road(m.lane.roadId) as Road;
      const lane = m.lane as Lane;
      lines.push(`lane ${lane.id} (${lane.kind}, ${lane.maxSpeed} km/h, turns ${lane.turns ? lane.turns.join('/') : 'any'}) s=${m.s.toFixed(1)}`, `road ${road.id} ${road.cls} ${road.oneway ? 'oneway' : 'two-way'} ${road.lanesForward.length}+${road.lanesBackward.length} ${road.name ?? ''} ${road.nameEn ?? ''} zone=${road.zone} kerb L/R=${road.kerbLeft}/${road.kerbRight} osm=${road.osmWayIds.join(',')}`, `  next ${lane.next.length} prev ${lane.prev.length}`);
    }
    const cm = this.graph.nearestConnector(p, { maxDist: tol });
    if (cm) lines.push(`connector ${cm.connector.id} turn=${cm.connector.turn} yieldTo=${cm.connector.yieldTo.length}${cm.connector.signalGroup ? ' sg=' + cm.connector.signalGroup : ''}`);
    for (const c of this.graph.crossingsWithin(p, tol)) lines.push(`crossing ${c.id} ${c.kind}${c.refuge ? ' refuge' : ''} ${c.junctionId ?? 'mid-block'}`);
    const k = `${Math.floor(p[0] / 50)},${Math.floor(p[1] / 50)}`;
    for (const s of this.signGrid.get(k) ?? []) if (dist2(s.pos, p) < tol) lines.push(`sign ${s.id} code=${s.code}${s.value !== undefined ? ' value=' + s.value : ''} road=${s.roadId ?? ''}`);
    for (const sp of this.world.spawnPoints) if (dist2(sp.pos, p) < Math.max(tol, 4)) lines.push(`spawn ${sp.id} ${sp.name} lane=${sp.laneId}`);
    const text = lines.filter(Boolean).join('\n');
    if (!text) {
      this.tooltip.style.display = 'none';
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.style.display = 'block';
    const left = Math.min(innerWidth - 440, this.hover.x + 14);
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${Math.min(innerHeight - 140, this.hover.y + 14)}px`;
  }
}

function bboxOf(pts: readonly Vec2[]): [number, number, number, number] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return [minX, minZ, maxX, maxZ];
}

declare global {
  interface Window {
    __worldMap?: { ready: boolean; world?: WorldFile; map?: WorldMap; error?: string };
  }
}

async function main(): Promise<void> {
  const q = params();
  const which = q.get('world') ?? 'north-tlv';
  window.__worldMap = { ready: false };
  const loading = document.getElementById('loading')!;
  try {
    const world = which === 'training-ground' ? loadTrainingGround() : await loadWorld(q.get('url') ?? WORLD_URL);
    const initial: Partial<View> = {};
    const proj = createProjector(world.origin);
    if (q.get('lon') && q.get('lat')) {
      const p = proj.toWorld(Number(q.get('lon')), Number(q.get('lat')));
      initial.cx = p[0];
      initial.cz = p[1];
    }
    if (q.get('x')) initial.cx = Number(q.get('x'));
    if (q.get('z')) initial.cz = Number(q.get('z'));
    if (q.get('zoom')) initial.zoom = Number(q.get('zoom'));
    const map = new WorldMap(world, initial, q.get('route') ?? undefined);
    loading.remove();
    map.render();
    window.__worldMap = { ready: true, world, map };
    document.title = `${world.name} — world map`;
  } catch (err) {
    loading.textContent = `שגיאה: ${String(err)}`;
    window.__worldMap = { ready: true, error: String(err) };
    console.error(err);
  }
}

main();
