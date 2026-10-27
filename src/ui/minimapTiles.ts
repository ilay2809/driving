/**
 * Pure tile bookkeeping for the minimap: which 200 m tiles are in view, and an LRU cache
 * of rendered tiles (the renderer is injected so this is testable without a canvas).
 */

export const TILE_SIZE_M = 200;

export interface TileCoord {
  tx: number;
  tz: number;
}

export function tileIndex(v: number, size = TILE_SIZE_M): number {
  return Math.floor(v / size);
}

export function tileKey(tx: number, tz: number): string {
  return `${tx},${tz}`;
}

/** Tiles intersecting the square window [cx±radius, cz±radius]. */
export function tilesInView(cx: number, cz: number, radius: number, size = TILE_SIZE_M): TileCoord[] {
  const x0 = tileIndex(cx - radius, size);
  const x1 = tileIndex(cx + radius, size);
  const z0 = tileIndex(cz - radius, size);
  const z1 = tileIndex(cz + radius, size);
  const out: TileCoord[] = [];
  for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) out.push({ tx, tz });
  return out;
}

export class TileCache<T> {
  private map = new Map<string, T>();
  /** Number of times the renderer was invoked (for tests / profiling). */
  renders = 0;
  evictions = 0;

  constructor(
    public readonly size: number,
    private readonly render: (tx: number, tz: number) => T,
    public readonly max = 48,
    private readonly onEvict?: (tile: T) => void,
  ) {}

  get count(): number {
    return this.map.size;
  }

  has(tx: number, tz: number): boolean {
    return this.map.has(tileKey(tx, tz));
  }

  /** Rendered tile; renders on a miss and refreshes LRU order on a hit. */
  get(tx: number, tz: number): T {
    const key = tileKey(tx, tz);
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const tile = this.render(tx, tz);
    this.renders++;
    this.map.set(key, tile);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      const t = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.evictions++;
      this.onEvict?.(t);
    }
    return tile;
  }

  clear(): void {
    if (this.onEvict) for (const t of this.map.values()) this.onEvict(t);
    this.map.clear();
  }
}
