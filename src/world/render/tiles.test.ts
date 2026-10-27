import { describe, expect, it } from 'vitest';
import { RoadGraph } from '@/world/graph';
import { buildTrainingGround } from '@/world/testWorld';
import { TileIndex, polylineMidpoint, tileCoord, tileDistance, tileKey, tilesWithin } from './tiles';

describe('tile maths', () => {
  it('maps coordinates to tiles', () => {
    expect(tileCoord(0, 250)).toBe(0);
    expect(tileCoord(-1, 250)).toBe(-1);
    expect(tileCoord(499, 250)).toBe(1);
    expect(tileKey(-1, 2)).toBe('-1,2');
    expect(tileDistance([125, 125], 0, 0, 250)).toBe(0);
    expect(tileDistance([300, 125], 0, 0, 250)).toBe(50);
    expect(tileDistance([-30, -40], 0, 0, 250)).toBe(50);
  });

  it('lists tiles within a radius, nearest first', () => {
    const wishes = tilesWithin([10, 10], 300, 250);
    expect(wishes[0]!.key).toBe('0,0');
    expect(wishes.some((w) => w.key === '-1,-1')).toBe(true);
    expect(wishes.some((w) => w.key === '2,2')).toBe(false); // 490 m away
    for (let i = 1; i < wishes.length; i++) expect(wishes[i]!.dist).toBeGreaterThanOrEqual(wishes[i - 1]!.dist);
  });

  it('finds the midpoint of a polyline by arc length', () => {
    expect(polylineMidpoint([[0, 0], [10, 0]])).toEqual([5, 0]);
    expect(polylineMidpoint([[0, 0], [10, 0], [10, 10]])).toEqual([10, 0]);
  });
});

describe('TileIndex', () => {
  const world = buildTrainingGround();
  const graph = new RoadGraph(world);
  const index = new TileIndex(world, graph, 250);

  it('assigns every item to exactly one tile', () => {
    const count = (f: (t: ReturnType<TileIndex['get']> & object) => number) => [...index.tiles.values()].reduce((acc, t) => acc + f(t), 0);
    expect(count((t) => t.roads.length)).toBe(world.roads.length);
    expect(count((t) => t.junctions.length)).toBe(world.junctions.length);
    expect(count((t) => t.buildings.length)).toBe(world.buildings.length);
    expect(count((t) => t.props.length)).toBe(world.props.length);
    expect(count((t) => t.signs.length)).toBe(world.signs.length);
    expect(count((t) => t.crossings.length)).toBe(world.crossings.length);
    const heads = world.signals.flatMap((c) => c.groups.flatMap((g) => g.heads)).length;
    expect(count((t) => t.heads.length)).toBe(heads);
  });

  it('attaches the crossing to pedestrian heads', () => {
    const peds = [...index.tiles.values()].flatMap((t) => t.heads).filter((h) => h.group.pedestrian);
    expect(peds.length).toBe(8);
    for (const h of peds) expect(h.crossing).toBeDefined();
  });
});
