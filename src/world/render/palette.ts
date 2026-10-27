/**
 * Colour palette of the stylised low-poly world. Vertex colours must be LINEAR (three.js
 * samples colour attributes as-is), so every entry goes through THREE.Color which converts
 * the sRGB hex to linear under the default colour management.
 */
import * as THREE from 'three';
import type { RGB } from './MeshBuffer';
import type { KerbColour, MarkingColour } from '@/world/roadGeometry';
import type { Area, Building } from '@/world/schema';

export function rgb(hex: number): RGB {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

export function scaleRgb(c: RGB, k: number): RGB {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

export const PALETTE = {
  asphalt: 0x5a5c61,
  asphaltWet: 0x35373c,
  ground: 0xddd0b2,
  sidewalk: 0xc9c7c0,
  island: 0x7cb267,
  islandMound: 0x5f9a4b,
  kerb: {
    grey: 0xbdb9ae,
    red: 0xd23b2f,
    white: 0xf4f3ee,
    blue: 0x2f6fd0,
    yellow: 0xe8c22a,
  } satisfies Record<KerbColour, number>,
  marking: { white: 0xf6f6f1, yellow: 0xf3c431 } satisfies Record<MarkingColour, number>,
  area: {
    park: 0x7cb267,
    grass: 0x8bbf6e,
    forest: 0x5d9a4b,
    water: 0x58a3dc,
    sand: 0xe6d7a6,
    parking_lot: 0x6d6f73,
    plaza: 0xe2dccf,
    school: 0xe8e2d4,
    sports: 0xc9a56a,
    construction: 0xc4b59b,
    cemetery: 0xa8b898,
  } satisfies Record<Area['kind'], number>,
  buildings: [0xf3e6d3, 0xe9dcc6, 0xf1e4e0, 0xdfe6ea, 0xede3cf, 0xe7ded6],
  buildingPublic: 0xf8f5ee,
  roof: 0xb6b0a5,
  roofPublic: 0xc9c3b8,
  window: 0x3f4a5a,
  windowLit: 0xffd27a,
  treeTrunk: 0x6a4a30,
  treeCanopy: [0x5f9f4b, 0x6fae52, 0x4f8c45],
  lampPole: 0x6d7074,
  lampHead: 0xfff2cc,
  signalPole: 0x5d6166,
  signalHousing: 0x2b2d31,
  signPost: 0x8a8d91,
  plateBack: 0x9a9da1,
  busStop: 0x3b6fb6,
  busStopGlass: 0xbcd6ea,
  speedBump: 0x4a4b4f,
  speedBumpStripe: 0xe8c22a,
  bollard: 0x7d8186,
  bollardBand: 0xd23b2f,
  bench: 0x8c6a46,
  bin: 0x3f5d3a,
  hydrant: 0xd23b2f,
  barrier: 0xd9d9d9,
  barrierStripe: 0xd23b2f,
} as const;

export function buildingColour(id: string, kind: Building['kind']): { facade: RGB; roof: RGB } {
  const isPublic = kind === 'public' || kind === 'education' || kind === 'religious';
  if (isPublic) return { facade: rgb(PALETTE.buildingPublic), roof: rgb(PALETTE.roofPublic) };
  const variant = hashString(id) % PALETTE.buildings.length;
  return { facade: rgb(PALETTE.buildings[variant]!), roof: rgb(PALETTE.roof) };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
