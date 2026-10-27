/**
 * Shelf-packed canvas atlas shared by sign faces and street-name plates, so every plate in
 * a tile is one draw call. ShelfPacker is pure (unit-tested); PlateAtlas needs a canvas.
 */
import * as THREE from 'three';

export interface AtlasCell {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Simple shelf packer: rows of equal height, filled left to right. */
export class ShelfPacker {
  private shelves: { y: number; h: number; x: number }[] = [];
  private nextY = 0;

  constructor(readonly width: number, readonly height: number) {}

  allocate(w: number, h: number): { x: number; y: number } | undefined {
    if (w > this.width || h > this.height) return undefined;
    for (const s of this.shelves) {
      if (s.h === h && s.x + w <= this.width) {
        const x = s.x;
        s.x += w;
        return { x, y: s.y };
      }
    }
    if (this.nextY + h > this.height) return undefined;
    const shelf = { y: this.nextY, h, x: w };
    this.shelves.push(shelf);
    this.nextY += h;
    return { x: 0, y: shelf.y };
  }
}

export const SIGN_CELL_PX = 128;
export const NAME_CELL_W = 192;
export const NAME_CELL_H = 80;

/** Atlas edge (2048 or 4096) large enough for the given number of street names and sign faces. */
export function atlasSizeFor(names: number, signs: number): number {
  const area = (names * NAME_CELL_W * NAME_CELL_H + signs * SIGN_CELL_PX * SIGN_CELL_PX) * 1.25;
  return area <= 2048 * 2048 ? 2048 : 4096;
}

export class PlateAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private readonly packer: ShelfPacker;
  private readonly cells = new Map<string, AtlasCell>();
  private overflow?: AtlasCell;

  constructor(readonly size = 2048) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.packer = new ShelfPacker(size, size);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }

  get(key: string): AtlasCell | undefined {
    return this.cells.get(key);
  }

  /**
   * Allocate (once) a cell for `key` and draw it with `draw(ctx, cell)`. When the atlas is
   * full every further key shares one "overflow" cell so geometry stays valid.
   */
  cell(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, cell: AtlasCell) => void): AtlasCell {
    const existing = this.cells.get(key);
    if (existing) return existing;
    const slot = this.packer.allocate(w, h);
    if (!slot) {
      if (!this.overflow) {
        const s = this.packer.allocate(0, 0);
        this.overflow = { key: '__overflow', x: s?.x ?? 0, y: s?.y ?? 0, w: 0, h: 0, u0: 0, v0: 1, u1: 0, v1: 1 };
      }
      this.cells.set(key, this.overflow);
      return this.overflow;
    }
    const S = this.size;
    const cell: AtlasCell = { key, x: slot.x, y: slot.y, w, h, u0: slot.x / S, u1: (slot.x + w) / S, v0: 1 - (slot.y + h) / S, v1: 1 - slot.y / S };
    this.cells.set(key, cell);
    this.redraw(cell, draw);
    return cell;
  }

  /** (Re)draw a cell — clears it first; marks the texture for upload. */
  redraw(cell: AtlasCell, draw: (ctx: CanvasRenderingContext2D, cell: AtlasCell) => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(cell.x, cell.y, cell.w, cell.h);
    ctx.beginPath();
    ctx.rect(cell.x, cell.y, cell.w, cell.h);
    ctx.clip();
    draw(ctx, cell);
    ctx.restore();
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
