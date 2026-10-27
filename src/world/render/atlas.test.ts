import { describe, expect, it } from 'vitest';
import { ShelfPacker, atlasSizeFor } from './atlas';
import { signCellKey, signStyle } from './signStyles';

describe('ShelfPacker', () => {
  it('packs cells into shelves of equal height and reports exhaustion', () => {
    const p = new ShelfPacker(256, 128);
    expect(p.allocate(128, 128)).toEqual({ x: 0, y: 0 });
    expect(p.allocate(128, 128)).toEqual({ x: 128, y: 0 });
    expect(p.allocate(128, 128)).toBeUndefined();
    const q = new ShelfPacker(512, 512);
    expect(q.allocate(256, 104)).toEqual({ x: 0, y: 0 });
    expect(q.allocate(128, 128)).toEqual({ x: 0, y: 104 });
    expect(q.allocate(256, 104)).toEqual({ x: 256, y: 0 });
    expect(q.allocate(256, 104)).toEqual({ x: 0, y: 232 });
    expect(q.allocate(1024, 10)).toBeUndefined();
  });

  it('grows the atlas for worlds with many street names', () => {
    expect(atlasSizeFor(20, 30)).toBe(2048);
    expect(atlasSizeFor(120, 60)).toBe(2048); // ≈3.5 Mpx incl. packing slack
    expect(atlasSizeFor(200, 60)).toBe(4096); // ≈5.1 Mpx: beyond 2048²
    expect(atlasSizeFor(600, 80)).toBe(4096);
  });
});

describe('sign styles', () => {
  it('uses the Israeli catalogue shapes', () => {
    expect(signStyle('302').shape).toBe('octagon');
    expect(signStyle('302').text).toBe('עצור');
    expect(signStyle('301').shape).toBe('triangle_down');
    expect(signStyle('426', 30).shape).toBe('circle');
    expect(signStyle('426', 30).text).toBe('30');
    expect(signStyle('402').symbol).toBe('bar');
    expect(signStyle('618').symbol).toBe('arrow_up');
    expect(signStyle('135').shape).toBe('triangle');
    expect(signStyle('612').shape).toBe('square');
    expect(signStyle('999').shape).toBe('diamond');
    expect(signStyle('abc').shape).toBe('circle');
  });

  it('keys atlas cells by code and value', () => {
    expect(signCellKey('426', 30)).toBe('sign:426:30');
    expect(signCellKey('302')).toBe('sign:302');
    expect(signCellKey('302', '')).toBe('sign:302');
  });
});
