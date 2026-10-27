/**
 * Traffic signs: a post plus a 0.6 m plate whose face looks AGAINST sign.heading (the
 * driver travelling with that heading sees it). Faces come from the shared PlateAtlas:
 * a procedural plate is drawn immediately and /signs/<code>.svg replaces it when the
 * file exists (loaded lazily, once per code).
 */
import { forwardOf, rightOf, type Vec2 } from '@/world/geo';
import type { Sign } from '@/world/schema';
import { PlateAtlas, SIGN_CELL_PX, type AtlasCell } from './atlas';
import type { MeshBuffer, RGB, Vec3 } from './MeshBuffer';
import { PALETTE, rgb } from './palette';
import { signCellKey, signStyle, type SignStyle } from './signStyles';

export const SIGN_PLATE_SIZE = 0.6;
export const SIGN_POST_HEIGHT = 2.2;
const CELL_PX = SIGN_CELL_PX;
const WHITE: RGB = [1, 1, 1];
const BACK = rgb(PALETTE.plateBack);
const POST = rgb(PALETTE.signPost);

export class SignFaces {
  private readonly requested = new Set<string>();
  private disposed = false;

  constructor(
    readonly atlas: PlateAtlas,
    /** Base URL of the sign SVGs, e.g. "/signs/". */
    readonly baseUrl: string,
  ) {}

  cellFor(sign: Sign): AtlasCell {
    const key = signCellKey(sign.code, sign.value);
    const existing = this.atlas.get(key);
    if (existing) return existing;
    const style = signStyle(sign.code, sign.value);
    const cell = this.atlas.cell(key, CELL_PX, CELL_PX, (ctx, c) => drawSignFace(ctx, c.x, c.y, c.w, style));
    this.loadSvg(sign, cell, style);
    return cell;
  }

  private loadSvg(sign: Sign, cell: AtlasCell, style: SignStyle): void {
    if (typeof Image === 'undefined' || !this.baseUrl) return;
    const key = cell.key;
    if (this.requested.has(key)) return;
    this.requested.add(key);
    const img = new Image();
    img.onload = () => {
      if (this.disposed) return;
      this.atlas.redraw(cell, (ctx, c) => {
        ctx.drawImage(img, c.x, c.y, c.w, c.h);
        // value signs (speed limit …) keep the painted value on top of the catalogue SVG
        if (sign.value !== undefined && sign.value !== '') drawPlateText(ctx, c.x, c.y, c.w, String(sign.value), style.textColour, 0.4);
      });
    };
    img.onerror = () => undefined;
    img.src = `${this.baseUrl}${encodeURIComponent(sign.code)}.svg`;
  }

  dispose(): void {
    this.disposed = true;
  }
}

/** Regular polygon path centred in a cell. */
function polygonPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, sides: number, rotation: number): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function shapePath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, shape: SignStyle['shape'], inset: number): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2 - inset;
  switch (shape) {
    case 'octagon':
      polygonPath(ctx, cx, cy, r, 8, Math.PI / 8);
      break;
    case 'triangle':
      polygonPath(ctx, cx, cy + size * 0.06, r, 3, -Math.PI / 2);
      break;
    case 'triangle_down':
      polygonPath(ctx, cx, cy - size * 0.06, r, 3, Math.PI / 2);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case 'diamond':
      polygonPath(ctx, cx, cy, r, 4, 0);
      break;
    case 'rect':
      ctx.beginPath();
      ctx.rect(x + inset, cy - size * 0.25 + inset, size - 2 * inset, size * 0.5 - 2 * inset);
      ctx.closePath();
      break;
    case 'square':
    default:
      ctx.beginPath();
      ctx.rect(x + inset, y + inset, size - 2 * inset, size - 2 * inset);
      ctx.closePath();
      break;
  }
}

export function drawPlateText(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, text: string, colour: string, scale = 0.36): void {
  if (!text) return;
  ctx.save();
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  let px = Math.round(size * scale);
  const maxW = size * 0.68;
  for (;;) {
    ctx.font = `700 ${px}px Rubik, Heebo, Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxW || px <= 8) break;
    px -= 2;
  }
  ctx.fillText(text, x + size / 2, y + size / 2 + size * 0.02);
  ctx.restore();
}

function drawSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, style: SignStyle): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.strokeStyle = style.textColour;
  ctx.fillStyle = style.textColour;
  ctx.lineCap = 'round';
  switch (style.symbol) {
    case 'bar':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - size * 0.3, cy - size * 0.08, size * 0.6, size * 0.16);
      break;
    case 'x':
      ctx.strokeStyle = style.border;
      ctx.lineWidth = size * 0.07;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.28, cy - size * 0.28);
      ctx.lineTo(cx + size * 0.28, cy + size * 0.28);
      ctx.moveTo(cx + size * 0.28, cy - size * 0.28);
      ctx.lineTo(cx - size * 0.28, cy + size * 0.28);
      ctx.stroke();
      break;
    case 'slash':
      ctx.strokeStyle = style.border;
      ctx.lineWidth = size * 0.07;
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.28, cy - size * 0.28);
      ctx.lineTo(cx - size * 0.28, cy + size * 0.28);
      ctx.stroke();
      break;
    case 'arrow_up':
      ctx.lineWidth = size * 0.07;
      ctx.beginPath();
      ctx.moveTo(cx, cy + size * 0.16);
      ctx.lineTo(cx, cy - size * 0.16);
      ctx.moveTo(cx - size * 0.12, cy - size * 0.04);
      ctx.lineTo(cx, cy - size * 0.17);
      ctx.lineTo(cx + size * 0.12, cy - size * 0.04);
      ctx.stroke();
      break;
    case 'pedestrian': {
      const s = size * 0.0055;
      ctx.lineWidth = size * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy - 18 * s, 7 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy - 10 * s);
      ctx.lineTo(cx, cy + 8 * s);
      ctx.moveTo(cx, cy - 6 * s);
      ctx.lineTo(cx - 12 * s, cy + 2 * s);
      ctx.moveTo(cx, cy - 6 * s);
      ctx.lineTo(cx + 10 * s, cy - 2 * s);
      ctx.moveTo(cx, cy + 8 * s);
      ctx.lineTo(cx - 10 * s, cy + 24 * s);
      ctx.moveTo(cx, cy + 8 * s);
      ctx.lineTo(cx + 9 * s, cy + 22 * s);
      ctx.stroke();
      break;
    }
    case 'bump':
      ctx.lineWidth = size * 0.05;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.24, cy + size * 0.18);
      ctx.quadraticCurveTo(cx - size * 0.1, cy + size * 0.18, cx - size * 0.05, cy + size * 0.02);
      ctx.quadraticCurveTo(cx, cy - size * 0.1, cx + size * 0.05, cy + size * 0.02);
      ctx.quadraticCurveTo(cx + size * 0.1, cy + size * 0.18, cx + size * 0.24, cy + size * 0.18);
      ctx.stroke();
      break;
    case 'roundabout': {
      ctx.lineWidth = size * 0.07;
      const r = size * 0.2;
      for (let k = 0; k < 3; k++) {
        const a0 = (k / 3) * Math.PI * 2;
        const a1 = a0 + Math.PI * 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a1);
        ctx.stroke();
        // arrow head at the end of each arc (counter-clockwise on the map = the Israeli direction)
        const hx = cx + Math.cos(a1) * r;
        const hy = cy + Math.sin(a1) * r;
        const tx = -Math.sin(a1);
        const ty = Math.cos(a1);
        ctx.beginPath();
        ctx.moveTo(hx + tx * size * 0.09, hy + ty * size * 0.09);
        ctx.lineTo(hx - Math.cos(a1) * size * 0.07, hy - Math.sin(a1) * size * 0.07);
        ctx.lineTo(hx + Math.cos(a1) * size * 0.07, hy + Math.sin(a1) * size * 0.07);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'bus':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - size * 0.22, cy - size * 0.3, size * 0.44, size * 0.2);
      ctx.fillStyle = style.fill;
      ctx.fillRect(cx - size * 0.17, cy - size * 0.27, size * 0.34, size * 0.08);
      break;
    default:
      break;
  }
  ctx.restore();
}

/** Procedural plate: shape + border, symbol and/or text, transparent outside the shape. */
export function drawSignFace(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, style: SignStyle): void {
  ctx.save();
  // white backing for the coloured border families keeps the alpha cut-out crisp
  shapePath(ctx, x, y, size, style.shape, size * 0.03);
  ctx.fillStyle = style.border;
  ctx.fill();
  shapePath(ctx, x, y, size, style.shape, size * 0.03 + size * style.borderWidth);
  ctx.fillStyle = style.fill;
  ctx.fill();
  if (style.symbol) drawSymbol(ctx, x, y, size, style);
  if (style.text) drawPlateText(ctx, x, y, size, style.text, style.textColour, style.text.length > 3 ? 0.28 : 0.36);
  ctx.restore();
}

/**
 * A plate quad whose front face (texture) looks along `normal`, with a grey back face
 * (same alpha cut-out via the vertex-coloured atlas material).
 */
export function addPlate(centre: Vec3, right: Vec2, width: number, height: number, normal: Vec2, cell: AtlasCell, plate: MeshBuffer): void {
  const hw = width / 2;
  const hh = height / 2;
  const l: Vec3 = [centre[0] - right[0] * hw, centre[1], centre[2] - right[1] * hw];
  const r: Vec3 = [centre[0] + right[0] * hw, centre[1], centre[2] + right[1] * hw];
  const n: Vec3 = [normal[0], 0, normal[1]];
  plate.quad3([l[0], l[1] - hh, l[2]], [r[0], r[1] - hh, r[2]], [r[0], r[1] + hh, r[2]], [l[0], l[1] + hh, l[2]], WHITE, n, [
    [cell.u0, cell.v0],
    [cell.u1, cell.v0],
    [cell.u1, cell.v1],
    [cell.u0, cell.v1],
  ]);
  const back = 0.012;
  const bl: Vec3 = [l[0] - n[0] * back, l[1], l[2] - n[2] * back];
  const br: Vec3 = [r[0] - n[0] * back, r[1], r[2] - n[2] * back];
  plate.quad3([bl[0], bl[1] - hh, bl[2]], [br[0], br[1] - hh, br[2]], [br[0], br[1] + hh, br[2]], [bl[0], bl[1] + hh, bl[2]], BACK, [-n[0], 0, -n[2]], [
    [cell.u1, cell.v0],
    [cell.u0, cell.v0],
    [cell.u0, cell.v1],
    [cell.u1, cell.v1],
  ]);
}

/** Post + plate for one sign. */
export function addSign(sign: Sign, cell: AtlasCell, plate: MeshBuffer, solid: MeshBuffer): void {
  const f = forwardOf(sign.heading);
  const r = rightOf(sign.heading);
  const normal: Vec2 = [-f[0], -f[1]];
  const size = SIGN_PLATE_SIZE;
  let bottom = SIGN_POST_HEIGHT;
  if (sign.mount === 'overhead') bottom = 5.2;
  else if (sign.mount === 'ground') bottom = 0.3;
  const top = bottom + size;
  // the post stands just behind the plate (on the +forward side, away from the approaching driver)
  const px = sign.pos[0] + f[0] * 0.05;
  const pz = sign.pos[1] + f[1] * 0.05;
  solid.cylinder(px, pz, 0.035, 0.035, 0, top - 0.05, 6, POST);
  addPlate([sign.pos[0], (bottom + top) / 2, sign.pos[1]], r, size, size, normal, cell, plate);
}
