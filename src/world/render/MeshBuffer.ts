/**
 * Growable triangle-soup accumulator with flat (per-face) normals, vertex colours and
 * optional UVs. Every static thing in a tile is appended to one MeshBuffer per material
 * and turned into a single indexed BufferGeometry — that is what keeps draw calls low.
 */
import * as THREE from 'three';
import type { Vec2 } from '@/world/geo';
import type { Ribbon, Strip, Triangle } from '@/world/roadGeometry';

export type RGB = [number, number, number];
export type Vec3 = [number, number, number];
export type UV = [number, number];

export class MeshBuffer {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];
  private n = 0;

  constructor(readonly hasUv = false) {}

  get vertexCount(): number {
    return this.n;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }
  get isEmpty(): boolean {
    return this.idx.length === 0;
  }

  vertex(p: Vec3, normal: Vec3, c: RGB, uv?: UV): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(normal[0], normal[1], normal[2]);
    this.col.push(c[0], c[1], c[2]);
    if (this.hasUv) this.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    return this.n++;
  }

  index(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /**
   * Triangle with a flat normal from its winding. When `normalHint` is given the winding
   * is flipped if needed so the face normal points along the hint.
   */
  triangle3(a: Vec3, b: Vec3, c: Vec3, colour: RGB, normalHint?: Vec3, uvs?: [UV, UV, UV]): void {
    const n = faceNormal(a, b, c);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return; // degenerate
    if (normalHint && n[0] * normalHint[0] + n[1] * normalHint[1] + n[2] * normalHint[2] < 0) {
      n[0] = -n[0];
      n[1] = -n[1];
      n[2] = -n[2];
      const i0 = this.vertex(a, n, colour, uvs?.[0]);
      const i1 = this.vertex(c, n, colour, uvs?.[2]);
      const i2 = this.vertex(b, n, colour, uvs?.[1]);
      this.index(i0, i1, i2);
      return;
    }
    const i0 = this.vertex(a, n, colour, uvs?.[0]);
    const i1 = this.vertex(b, n, colour, uvs?.[1]);
    const i2 = this.vertex(c, n, colour, uvs?.[2]);
    this.index(i0, i1, i2);
  }

  /** Horizontal triangle at height y, normal up (winding fixed automatically). */
  triangle2(a: Vec2, b: Vec2, c: Vec2, y: number, colour: RGB): void {
    this.triangle3([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], colour, [0, 1, 0]);
  }

  triangles2(tris: readonly Triangle[], y: number, colour: RGB): void {
    for (const t of tris) this.triangle2(t[0], t[1], t[2], y, colour);
  }

  /** Planar quad a-b-c-d (4 vertices, 2 triangles) with one flat normal. */
  quad3(a: Vec3, b: Vec3, c: Vec3, d: Vec3, colour: RGB, normalHint?: Vec3, uvs?: [UV, UV, UV, UV]): void {
    let n = faceNormal(a, b, c);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) n = faceNormal(a, c, d);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return;
    let flip = false;
    if (normalHint && n[0] * normalHint[0] + n[1] * normalHint[1] + n[2] * normalHint[2] < 0) {
      n = [-n[0], -n[1], -n[2]];
      flip = true;
    }
    const i0 = this.vertex(a, n, colour, uvs?.[0]);
    const i1 = this.vertex(b, n, colour, uvs?.[1]);
    const i2 = this.vertex(c, n, colour, uvs?.[2]);
    const i3 = this.vertex(d, n, colour, uvs?.[3]);
    if (flip) {
      this.index(i0, i2, i1);
      this.index(i0, i3, i2);
    } else {
      this.index(i0, i1, i2);
      this.index(i0, i2, i3);
    }
  }

  /** Horizontal quad strip between two corresponding polylines at height y. */
  ribbon(r: Ribbon, y: number, colour: RGB): void {
    this.stripXZ(r.left, r.right, y, colour);
  }

  strip(s: Strip, y: number, colour: RGB): void {
    this.stripXZ(s.inner, s.outer, y, colour);
  }

  /** Quad strip between two corresponding polylines with per-section heights. */
  stripXZ(a: Vec2[], b: Vec2[], y: number | number[], colour: RGB): void {
    const n = Math.min(a.length, b.length);
    const yAt = (i: number) => (typeof y === 'number' ? y : (y[i] ?? y[y.length - 1] ?? 0));
    for (let i = 0; i < n - 1; i++) {
      const a0 = a[i]!;
      const a1 = a[i + 1]!;
      const b0 = b[i]!;
      const b1 = b[i + 1]!;
      const y0 = yAt(i);
      const y1 = yAt(i + 1);
      const degA = Math.abs(a0[0] - a1[0]) < 1e-9 && Math.abs(a0[1] - a1[1]) < 1e-9;
      const degB = Math.abs(b0[0] - b1[0]) < 1e-9 && Math.abs(b0[1] - b1[1]) < 1e-9;
      if (degA && degB) continue;
      if (degA) this.triangle3([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], colour, [0, 1, 0]);
      else if (degB) this.triangle3([a0[0], y0, a0[1]], [a1[0], y1, a1[1]], [b0[0], y0, b0[1]], colour, [0, 1, 0]);
      else this.quad3([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], [a1[0], y1, a1[1]], colour, [0, 1, 0]);
    }
  }

  /** Vertical faces along `line` from y0 to y1, facing `towards` (per-vertex direction hints, e.g. inner - outer). */
  wall(line: Vec2[], towards: Vec2[], y0: number, y1: number, colour: RGB): void {
    for (let i = 0; i < line.length - 1; i++) {
      const p = line[i]!;
      const q = line[i + 1]!;
      if (Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9) continue;
      const t0 = towards[i] ?? towards[towards.length - 1]!;
      const t1 = towards[i + 1] ?? t0;
      const hint: Vec3 = [t0[0] + t1[0], 0, t0[1] + t1[1]];
      this.quad3([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], colour, hint);
    }
  }

  /** Axis-aligned box (before rotation) centred at (cx, cy, cz), rotated by rotY about its centre. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY: number, colour: RGB): void {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    // local → world (Ry: x' = x cos + z sin, z' = -x sin + z cos)
    const P = (x: number, y: number, z: number): Vec3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const corners = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)] as const;
    const faces: [number, number, number, number, Vec3][] = [
      [4, 5, 6, 7, [s, 0, c]], // +z local
      [1, 0, 3, 2, [-s, 0, -c]], // -z local
      [5, 1, 2, 6, [c, 0, -s]], // +x local
      [0, 4, 7, 3, [-c, 0, s]], // -x local
      [3, 7, 6, 2, [0, 1, 0]], // top
      [0, 1, 5, 4, [0, -1, 0]], // bottom
    ];
    for (const [a, b, cc, d, n] of faces) this.quad3(corners[a]!, corners[b]!, corners[cc]!, corners[d]!, colour, n);
  }

  /** Vertical cylinder / cone frustum between y0 and y1 (no bottom cap). */
  cylinder(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, segments: number, colour: RGB, capTop = true): void {
    const ring = (r: number, y: number): Vec3[] => {
      const out: Vec3[] = [];
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        out.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
      }
      return out;
    };
    const bottom = ring(r0, y0);
    const top = ring(r1, y1);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const a = (i + 0.5) / segments * Math.PI * 2;
      this.quad3(bottom[i]!, bottom[j]!, top[j]!, top[i]!, colour, [Math.cos(a), 0, Math.sin(a)]);
    }
    if (capTop && r1 > 0) {
      const c: Vec3 = [cx, y1, cz];
      for (let i = 0; i < segments; i++) this.triangle3(c, top[i]!, top[(i + 1) % segments]!, colour, [0, 1, 0]);
    }
  }

  /** Horizontal polygon with holes at height y (earcut via THREE.ShapeUtils). */
  polygon(ring: readonly Vec2[], holes: readonly (readonly Vec2[])[], y: number, colour: RGB): void {
    for (const t of triangulate(ring, holes)) this.triangle2(t[0], t[1], t[2], y, colour);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.hasUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return [0, 0, 0];
  return [nx / len, ny / len, nz / len];
}

/** Earcut triangulation of a ring with holes (first point not repeated). */
export function triangulate(ring: readonly Vec2[], holes: readonly (readonly Vec2[])[]): Triangle[] {
  const contour = ring.map((p) => new THREE.Vector2(p[0], p[1]));
  const hs = holes.filter((h) => h.length >= 3).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  const all = [...ring, ...holes.filter((h) => h.length >= 3).flat()];
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const out: Triangle[] = [];
  for (const t of tris) {
    const a = all[t[0]!];
    const b = all[t[1]!];
    const c = all[t[2]!];
    if (a && b && c) out.push([a, b, c]);
  }
  return out;
}
