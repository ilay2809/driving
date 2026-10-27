/**
 * Street-name plates (Tel Aviv style: blue plate, white Hebrew name) at junction corners,
 * one per mouth corner (≤ 2 per arm), on a 2.6 m post, facing the junction. Text is drawn
 * into the shared PlateAtlas with ctx.direction = 'rtl' once the Rubik font is ready.
 */
import { dist2, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { Junction } from '@/world/schema';
import { junctionMouths, KERB_WIDTH, type JunctionMouth } from '@/world/roadGeometry';
import { NAME_CELL_H, NAME_CELL_W, type AtlasCell, type PlateAtlas } from './atlas';
import type { MeshBuffer } from './MeshBuffer';
import { PALETTE, rgb } from './palette';
import { addPlate } from './signs';

export const NAME_PLATE_W = 0.6;
export const NAME_PLATE_H = 0.25;
export const NAME_POST_HEIGHT = 2.6;
const CELL_W = NAME_CELL_W;
const CELL_H = NAME_CELL_H;
const POST = rgb(PALETTE.signPost);
const FONT = '500 36px Rubik, Heebo, Arial, sans-serif';
/** Cells redrawn per timeout slice once the web font arrives (keeps the redraw off a single frame). */
const REDRAW_BATCH = 24;

export class NamePlates {
  private fontsReady = false;
  private pending: AtlasCell[] = [];
  private disposed = false;

  constructor(readonly atlas: PlateAtlas) {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) {
      this.fontsReady = true;
      return;
    }
    // ask for the face explicitly so a page without visible Rubik text still loads it
    const load = fonts.load ? fonts.load(FONT).catch(() => undefined) : Promise.resolve();
    Promise.all([load, fonts.ready])
      .catch(() => undefined)
      .then(() => {
        if (this.disposed) return;
        this.fontsReady = true;
        this.flushPending();
      });
  }

  /** Draw plates for many names up front (at load time, so streaming never draws text). */
  prepare(names: Iterable<string>): void {
    for (const n of names) this.cellFor(n);
  }

  cellFor(name: string): AtlasCell {
    const key = `name:${name}`;
    const existing = this.atlas.get(key);
    if (existing) return existing;
    const cell = this.atlas.cell(key, CELL_W, CELL_H, (ctx, c) => drawNamePlate(ctx, c, name));
    if (!this.fontsReady) this.pending.push(cell);
    return cell;
  }

  private flushPending(): void {
    if (this.disposed) return;
    const batch = this.pending.splice(0, REDRAW_BATCH);
    for (const cell of batch) this.atlas.redraw(cell, (ctx, c) => drawNamePlate(ctx, c, cell.key.slice('name:'.length)));
    if (this.pending.length > 0) setTimeout(() => this.flushPending(), 0);
  }

  dispose(): void {
    this.disposed = true;
  }
}

export function drawNamePlate(ctx: CanvasRenderingContext2D, cell: AtlasCell, name: string): void {
  ctx.save();
  ctx.fillStyle = '#1b4f9e';
  ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(cell.x + 4, cell.y + 4, cell.w - 8, cell.h - 8);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  let px = 36;
  for (;;) {
    ctx.font = `500 ${px}px Rubik, Heebo, Arial, sans-serif`;
    if (ctx.measureText(name).width <= cell.w - 22 || px <= 12) break;
    px -= 2;
  }
  ctx.fillText(name, cell.x + cell.w / 2, cell.y + cell.h / 2 + 2);
  ctx.restore();
}

export interface NamePlateSpot {
  name: string;
  pos: Vec2;
  /** Unit direction the face looks along. */
  facing: Vec2;
}

/** Where to put name plates around a junction: both mouth corners of every named arm. */
export function namePlateSpots(junction: Junction, graph: RoadGraph): NamePlateSpot[] {
  if (junction.kind !== 'junction' && junction.kind !== 'roundabout') return [];
  const mouths = junctionMouths(junction, (id) => graph.roads.get(id), graph.lanes);
  const roadIds = new Set(mouths.map((m) => m.roadId));
  if (roadIds.size < 3) return [];
  const out: NamePlateSpot[] = [];
  const centre = junction.position;
  const seen: Vec2[] = [];
  // the circulating carriageway of a roundabout gets no plates (only its arms do)
  const ringLanes = new Set(junction.roundabout?.ringLaneIds ?? []);
  for (const m of mouths) {
    const road = graph.roads.get(m.roadId);
    const name = road?.name;
    if (!name) continue;
    if ([...road.lanesForward, ...road.lanesBackward].some((id) => ringLanes.has(id))) continue;
    for (const corner of cornersOf(m)) {
      // 0.8 m back into the arm and 1.4 m outside the carriageway: on the sidewalk, clear of the kerb fan
      const lateral: Vec2 = [corner[0] - m.centre[0], corner[1] - m.centre[1]];
      const ll = Math.hypot(lateral[0], lateral[1]) || 1;
      const pos: Vec2 = [corner[0] + m.outward[0] * 0.8 + (lateral[0] / ll) * (KERB_WIDTH + 1.15), corner[1] + m.outward[1] * 0.8 + (lateral[1] / ll) * (KERB_WIDTH + 1.15)];
      if (seen.some((p) => dist2(p, pos) < 2)) continue;
      seen.push(pos);
      const fx = centre[0] - pos[0];
      const fz = centre[1] - pos[1];
      const fl = Math.hypot(fx, fz) || 1;
      out.push({ name, pos, facing: [fx / fl, fz / fl] });
    }
  }
  return out;
}

function cornersOf(m: JunctionMouth): Vec2[] {
  return [m.left, m.right];
}

export function addNamePlate(spot: NamePlateSpot, cell: AtlasCell, plate: MeshBuffer, solid: MeshBuffer): void {
  const n = spot.facing;
  // "right" of the viewer who looks at the face (viewer looks along -n): right = (-n.z, n.x) rotated… use the perpendicular
  const right: Vec2 = [-n[1], n[0]];
  const px = spot.pos[0] - n[0] * 0.04;
  const pz = spot.pos[1] - n[1] * 0.04;
  solid.cylinder(px, pz, 0.03, 0.03, 0, NAME_POST_HEIGHT + NAME_PLATE_H, 6, POST);
  addPlate([spot.pos[0], NAME_POST_HEIGHT + NAME_PLATE_H / 2, spot.pos[1]], right, NAME_PLATE_W, NAME_PLATE_H, n, cell, plate);
}
