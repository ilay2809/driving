/**
 * Street props as InstancedMesh per tile: trees (3 variants, seeded tint), lamps (pole +
 * arm, emissive head as a second instanced part), bus stops, speed bumps, bollards,
 * benches, bins, hydrants and barriers. Prototypes are built once from three.js
 * primitives with vertex colours and merged (BufferGeometryUtils.mergeGeometries).
 *
 * Prototype convention: local +x is the prop's forward direction (heading 0 = east), so
 * an instance with heading h gets rotation.y = -h.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '@/core/sim';
import type { RoadGraph } from '@/world/graph';
import type { Prop } from '@/world/schema';
import type { WorldMaterials } from './materials';
import { PALETTE, hashString, rgb } from './palette';
import type { RGB } from './MeshBuffer';

export interface PropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Apply a per-instance colour tint (trees). */
  tint: boolean;
}

export type PropKind = Prop['kind'];

/** Parts per kind; trees have several size variants. */
export interface PropPrototypes {
  tree: PropPart[][];
  lamp: PropPart[];
  bus_stop: PropPart[];
  bench: PropPart[];
  bollard: PropPart[];
  bin: PropPart[];
  hydrant: PropPart[];
  speed_bump: PropPart[];
  barrier: PropPart[];
}

function coloured(g: THREE.BufferGeometry, c: RGB): THREE.BufferGeometry {
  const n = g.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return g;
}

/** Flat-shaded, vertex-coloured, transformed copy of a primitive. */
function part(g: THREE.BufferGeometry, c: RGB, x = 0, y = 0, z = 0, rot?: THREE.Euler): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  if (rot) ng.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
  ng.translate(x, y, z);
  ng.computeVertexNormals();
  return coloured(ng, c);
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

export function createPropPrototypes(m: WorldMaterials): PropPrototypes {
  const trunk = rgb(PALETTE.treeTrunk);
  const canopy = PALETTE.treeCanopy.map(rgb) as [RGB, RGB, RGB];
  const treeSmall = merged([part(new THREE.CylinderGeometry(0.1, 0.14, 2.4, 6), trunk, 0, 1.2, 0), part(new THREE.IcosahedronGeometry(1.6, 0), canopy[0], 0, 3.2, 0)]);
  const treeFicus = merged([
    part(new THREE.CylinderGeometry(0.16, 0.22, 3.2, 6), trunk, 0, 1.6, 0),
    part(new THREE.IcosahedronGeometry(2.6, 0), canopy[1], 0, 4.6, 0),
    part(new THREE.IcosahedronGeometry(1.8, 0), canopy[2], 1.2, 5.6, 0.6),
    part(new THREE.IcosahedronGeometry(1.6, 0), canopy[0], -1.1, 5.4, -0.7),
  ]);
  const palmParts: THREE.BufferGeometry[] = [part(new THREE.CylinderGeometry(0.16, 0.24, 6.5, 6), trunk, 0, 3.25, 0)];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.BoxGeometry(2.6, 0.06, 0.5);
    leaf.translate(1.3, 0, 0);
    palmParts.push(part(leaf, canopy[2], 0, 6.5, 0, new THREE.Euler(0, a, -0.45, 'YXZ')));
  }
  palmParts.push(part(new THREE.IcosahedronGeometry(0.45, 0), canopy[1], 0, 6.5, 0));
  const treePalm = merged(palmParts);

  const poleC = rgb(PALETTE.lampPole);
  const lampPole = merged([
    part(new THREE.CylinderGeometry(0.14, 0.17, 0.6, 6), poleC, 0, 0.3, 0),
    part(new THREE.CylinderGeometry(0.06, 0.1, 7, 6), poleC, 0, 3.5, 0),
    part(new THREE.BoxGeometry(1.5, 0.08, 0.08), poleC, 0.75, 6.95, 0),
  ]);
  const lampHead = part(new THREE.BoxGeometry(0.6, 0.14, 0.28), rgb(PALETTE.lampHead), 1.35, 6.85, 0);
  lampHead.computeBoundingSphere();

  const busC = rgb(PALETTE.busStop);
  const glassC = rgb(PALETTE.busStopGlass);
  const benchC = rgb(PALETTE.bench);
  const busStop = merged([
    part(new THREE.CylinderGeometry(0.04, 0.04, 2.9, 6), poleC, 1.9, 1.45, -0.4),
    part(new THREE.BoxGeometry(0.03, 0.45, 0.5), busC, 1.9, 2.6, -0.4),
    part(new THREE.BoxGeometry(3.2, 0.08, 1.7), busC, 0, 2.5, 0.2),
    part(new THREE.BoxGeometry(3.2, 2.1, 0.06), glassC, 0, 1.4, 0.95),
    part(new THREE.BoxGeometry(0.06, 2.5, 0.06), poleC, -1.5, 1.25, 0.9),
    part(new THREE.BoxGeometry(0.06, 2.5, 0.06), poleC, 1.5, 1.25, 0.9),
    part(new THREE.BoxGeometry(2.2, 0.06, 0.4), benchC, 0, 0.48, 0.6),
  ]);

  const bump = merged([part(new THREE.BoxGeometry(0.5, 0.08, 3.4), rgb(PALETTE.speedBump), 0, 0.04, 0), ...[-1.2, 0, 1.2].map((z) => part(new THREE.BoxGeometry(0.5, 0.012, 0.6), rgb(PALETTE.speedBumpStripe), 0, 0.085, z))]);

  const bollard = merged([part(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 8), rgb(PALETTE.bollard), 0, 0.45, 0), part(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 8), rgb(PALETTE.bollardBand), 0, 0.78, 0)]);

  const bench = merged([
    part(new THREE.BoxGeometry(1.6, 0.06, 0.45), benchC, 0, 0.45, 0),
    part(new THREE.BoxGeometry(1.6, 0.4, 0.05), benchC, 0, 0.7, -0.22),
    part(new THREE.BoxGeometry(0.06, 0.45, 0.4), poleC, -0.7, 0.22, 0),
    part(new THREE.BoxGeometry(0.06, 0.45, 0.4), poleC, 0.7, 0.22, 0),
  ]);
  const bin = merged([part(new THREE.CylinderGeometry(0.25, 0.22, 0.8, 8), rgb(PALETTE.bin), 0, 0.4, 0)]);
  const hydrant = merged([part(new THREE.CylinderGeometry(0.12, 0.14, 0.75, 8), rgb(PALETTE.hydrant), 0, 0.375, 0), part(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 8), rgb(PALETTE.hydrant), 0, 0.82, 0)]);
  const barrier = merged([part(new THREE.BoxGeometry(1.5, 0.9, 0.08), rgb(PALETTE.barrier), 0, 0.5, 0), part(new THREE.BoxGeometry(1.5, 0.3, 0.09), rgb(PALETTE.barrierStripe), 0, 0.5, 0)]);

  const prop = (geometry: THREE.BufferGeometry, material: THREE.Material = m.prop, tint = false): PropPart => ({ geometry, material, tint });
  return {
    tree: [[prop(treeSmall, m.tree, true)], [prop(treeFicus, m.tree, true)], [prop(treePalm, m.tree, true)]],
    lamp: [prop(lampPole), prop(lampHead, m.lampHead)],
    bus_stop: [prop(busStop)],
    bench: [prop(bench)],
    bollard: [prop(bollard)],
    bin: [prop(bin)],
    hydrant: [prop(hydrant)],
    speed_bump: [prop(bump)],
    barrier: [prop(barrier)],
  };
}

export function disposePropPrototypes(p: PropPrototypes): void {
  for (const parts of Object.values(p)) {
    for (const v of parts as (PropPart | PropPart[])[]) {
      for (const part of Array.isArray(v) ? v : [v]) part.geometry.dispose();
    }
  }
}

/** Variant index of a tree, stable per position. */
export function treeVariant(prop: Prop): number {
  const h = hashString(`${prop.pos[0].toFixed(1)},${prop.pos[1].toFixed(1)}`);
  // ficus (medium) trees are the most common on Tel Aviv streets
  const r = h % 10;
  return r < 3 ? 0 : r < 8 ? 1 : 2;
}

/** Heading from a prop towards the nearest lane (the carriageway), or undefined when no lane is near. */
export function towardsRoadHeading(prop: Prop, graph: RoadGraph): number | undefined {
  const m = graph.nearestLane(prop.pos, { maxDist: 25 });
  if (!m) return undefined;
  const p = graph.laneAt(m.lane.id, m.s).p;
  const dx = p[0] - prop.pos[0];
  const dz = p[1] - prop.pos[1];
  if (Math.hypot(dx, dz) < 0.5) return undefined;
  return Math.atan2(dz, dx);
}

/** Lamp arms point at the carriageway. */
export function lampHeading(prop: Prop, graph: RoadGraph): number {
  return towardsRoadHeading(prop, graph) ?? prop.heading;
}

/** Bus shelters open towards the carriageway (the prototype's open side is local -z, i.e. left of its heading). */
export function busStopHeading(prop: Prop, graph: RoadGraph): number {
  const h = towardsRoadHeading(prop, graph);
  return h === undefined ? prop.heading : h + Math.PI / 2;
}

interface PropGroup {
  parts: PropPart[];
  matrices: THREE.Matrix4[];
  tints: THREE.Color[];
}

/**
 * Two-phase instancing so a tile's props can be prepared in small time-budgeted chunks
 * (`add`, which does the nearest-lane lookups) before the InstancedMeshes are created (`build`).
 */
export class PropInstancer {
  private readonly groups = new Map<string, PropGroup>();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private static readonly axisY = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly protos: PropPrototypes,
    private readonly graph: RoadGraph,
  ) {}

  add(props: readonly Prop[]): void {
    for (const p of props) {
      let key: string = p.kind;
      let parts: PropPart[] | undefined;
      if (p.kind === 'tree') {
        const v = treeVariant(p);
        key = `tree${v}`;
        parts = this.protos.tree[v];
      } else parts = this.protos[p.kind];
      if (!parts) continue;
      let g = this.groups.get(key);
      if (!g) {
        g = { parts, matrices: [], tints: [] };
        this.groups.set(key, g);
      }
      const rng = createRng(hashString(`${p.kind}:${p.pos[0].toFixed(2)},${p.pos[1].toFixed(2)}`));
      let heading = p.heading;
      if (p.kind === 'lamp') heading = lampHeading(p, this.graph);
      else if (p.kind === 'bus_stop') heading = busStopHeading(p, this.graph);
      else if (p.kind === 'tree') heading = rng() * Math.PI * 2;
      let scale = p.scale;
      if (p.kind === 'tree') scale *= 0.85 + rng() * 0.35;
      this.pos.set(p.pos[0], 0, p.pos[1]);
      this.quat.setFromAxisAngle(PropInstancer.axisY, -heading);
      this.scl.set(scale, scale, scale);
      g.matrices.push(new THREE.Matrix4().compose(this.pos, this.quat, this.scl));
      const k = 0.85 + rng() * 0.3;
      g.tints.push(new THREE.Color().setRGB(k * (0.95 + rng() * 0.1), k, k * (0.9 + rng() * 0.1)));
    }
  }

  build(castShadow: boolean): THREE.InstancedMesh[] {
    const meshes: THREE.InstancedMesh[] = [];
    for (const [key, g] of this.groups) {
      for (const part of g.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, g.matrices.length);
        mesh.name = `props:${key}`;
        g.matrices.forEach((m, i) => {
          mesh.setMatrixAt(i, m);
          if (part.tint) mesh.setColorAt(i, g.tints[i]!);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = castShadow;
        mesh.receiveShadow = false;
        meshes.push(mesh);
      }
    }
    this.groups.clear();
    return meshes;
  }
}

/** InstancedMeshes for the props of one tile (single-shot convenience over PropInstancer). */
export function buildPropInstances(props: readonly Prop[], protos: PropPrototypes, graph: RoadGraph, castShadow: boolean): THREE.InstancedMesh[] {
  const instancer = new PropInstancer(protos, graph);
  instancer.add(props);
  return instancer.build(castShadow);
}
