import { describe, expect, it } from 'vitest';
import { TILE_SIZE_M, TileCache, tileIndex, tileKey, tilesInView } from './minimapTiles';

describe('minimap tiles', () => {
  it('computes tile indices including negatives', () => {
    expect(tileIndex(0)).toBe(0);
    expect(tileIndex(199.9)).toBe(0);
    expect(tileIndex(200)).toBe(1);
    expect(tileIndex(-1)).toBe(-1);
    expect(tileIndex(-200)).toBe(-1);
    expect(tileKey(-1, 2)).toBe('-1,2');
  });

  it('lists the tiles intersecting the view window', () => {
    expect(tilesInView(100, 100, 50)).toEqual([{ tx: 0, tz: 0 }]);
    const around = tilesInView(0, 0, 180);
    expect(around).toHaveLength(4);
    expect(around).toContainEqual({ tx: -1, tz: -1 });
    expect(around).toContainEqual({ tx: 0, tz: 0 });
    expect(tilesInView(250, 250, 180, TILE_SIZE_M)).toHaveLength(9);
  });

  it('caches rendered tiles with LRU eviction', () => {
    const evicted: string[] = [];
    const cache = new TileCache<string>(TILE_SIZE_M, (tx, tz) => `tile${tx},${tz}`, 3, (t) => evicted.push(t));
    expect(cache.get(0, 0)).toBe('tile0,0');
    expect(cache.get(0, 0)).toBe('tile0,0');
    expect(cache.renders).toBe(1);
    cache.get(1, 0);
    cache.get(2, 0);
    expect(cache.count).toBe(3);
    cache.get(0, 0); // refresh LRU order: (1,0) is now the oldest
    cache.get(3, 0);
    expect(cache.count).toBe(3);
    expect(cache.has(1, 0)).toBe(false);
    expect(cache.has(0, 0)).toBe(true);
    expect(evicted).toEqual(['tile1,0']);
    expect(cache.evictions).toBe(1);
    cache.clear();
    expect(cache.count).toBe(0);
    expect(evicted).toHaveLength(4);
  });
});
