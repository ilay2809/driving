/**
 * Traffic lights. Poles and housings are static (merged into the tile's solid buffer);
 * the lamps are InstancedMesh planes whose instance colour is switched when a group's
 * state changes. Pure helpers (lampStates / pedLampStates / blinkOn) are unit-tested.
 */
import * as THREE from 'three';
import { forwardOf, rightOf, type Vec2 } from '@/world/geo';
import type { SignalState } from '@/world/schema';
import type { WorldMaterials } from './materials';
import type { MeshBuffer } from './MeshBuffer';
import { PALETTE, rgb } from './palette';
import type { SignalHeadRef } from './tiles';

export const SIGNAL_UPDATE_RADIUS = 200;
export const BLINK_HZ = 2;

export interface LampStates {
  red: boolean;
  amber: boolean;
  green: boolean;
}

/** Vehicle head lamps for a signal state; flashing states use the 2 Hz blink phase. */
export function lampStates(state: SignalState, blink: boolean): LampStates {
  switch (state) {
    case 'red':
      return { red: true, amber: false, green: false };
    case 'red_amber':
      return { red: true, amber: true, green: false };
    case 'green':
      return { red: false, amber: false, green: true };
    case 'flashing_green':
      return { red: false, amber: false, green: blink };
    case 'amber':
      return { red: false, amber: true, green: false };
    case 'flashing_amber':
      return { red: false, amber: blink, green: false };
    case 'off':
    default:
      return { red: false, amber: false, green: false };
  }
}

/** Pedestrian heads only know red (standing figure) and green (walking figure). */
export function pedLampStates(state: SignalState, blink: boolean): { red: boolean; green: boolean } {
  switch (state) {
    case 'green':
      return { red: false, green: true };
    case 'flashing_green':
      return { red: false, green: blink };
    case 'off':
      return { red: false, green: false };
    case 'flashing_amber':
      return { red: blink, green: false };
    default:
      return { red: true, green: false };
  }
}

/** 2 Hz square wave: on for the first half of every 0.5 s. */
export function blinkOn(time: number): boolean {
  return Math.floor(time * BLINK_HZ * 2) % 2 === 0;
}

const LIT = { red: new THREE.Color(0xff2a1f), amber: new THREE.Color(0xffb300), green: new THREE.Color(0x2bff5a) };
const DARK = { red: new THREE.Color(0x3a0c0a), amber: new THREE.Color(0x3a2a06), green: new THREE.Color(0x0a3a14) };
const HOUSING = rgb(PALETTE.signalHousing);
const POLE = rgb(PALETTE.signalPole);

type LampColour = 'red' | 'amber' | 'green';

interface LampRef {
  mesh: THREE.InstancedMesh;
  index: number;
  colour: LampColour;
}

interface HeadRecord {
  groupId: string;
  pedestrian: boolean;
  pos: Vec2;
  lamps: LampRef[];
  lastKey: string;
}

/** rotation.y that turns a +z-facing plane towards unit direction n (x, z). */
function facingRotation(n: Vec2): number {
  return Math.atan2(n[0], n[1]);
}

/** Lamps of all signal heads in one tile. */
export class SignalLampSet {
  readonly meshes: THREE.InstancedMesh[] = [];
  private readonly heads: HeadRecord[] = [];
  private readonly dirty = new Set<THREE.InstancedMesh>();

  constructor(refs: readonly SignalHeadRef[], materials: WorldMaterials, solid: MeshBuffer) {
    const vehicle = refs.filter((r) => !r.group.pedestrian);
    const ped = refs.filter((r) => r.group.pedestrian);
    const discGeom = new THREE.CircleGeometry(0.12, 12);
    const figGeom = new THREE.PlaneGeometry(0.26, 0.26);
    const vMesh = vehicle.length > 0 ? new THREE.InstancedMesh(discGeom, materials.signalLamp, vehicle.length * 3) : undefined;
    const standing = ped.length > 0 ? new THREE.InstancedMesh(figGeom, materials.pedLampStanding, ped.length) : undefined;
    const walking = ped.length > 0 ? new THREE.InstancedMesh(figGeom, materials.pedLampWalking, ped.length) : undefined;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const axisY = new THREE.Vector3(0, 1, 0);
    const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, n: Vec2, colour: LampColour, lamps: LampRef[]) => {
      q.setFromAxisAngle(axisY, facingRotation(n));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, DARK[colour]);
      lamps.push({ mesh, index: i, colour });
    };

    vehicle.forEach((ref, k) => {
      const h = ref.head.heading;
      const f = forwardOf(h);
      const r = rightOf(h);
      const n: Vec2 = [-f[0], -f[1]]; // the face looks against the traffic heading
      const [x, z] = ref.head.pos;
      const lamps: LampRef[] = [];
      let hx = x;
      let hz = z;
      let hy = 3.2;
      if (ref.head.overhead) {
        // mast arm over the carriageway (to the left of the post, which stands on the right kerb)
        solid.cylinder(x, z, 0.1, 0.13, 0, 6.2, 8, POLE);
        const armLen = 4.6;
        solid.box(x - r[0] * (armLen / 2), 6.0, z - r[1] * (armLen / 2), 0.12, 0.12, armLen, -h - Math.PI / 2, POLE);
        hx = x - r[0] * (armLen - 0.3);
        hz = z - r[1] * (armLen - 0.3);
        hy = 5.3;
      } else {
        solid.cylinder(x, z, 0.06, 0.08, 0, 3.9, 8, POLE);
      }
      // housing: 0.26 deep (local x = along the heading), 1.05 high, 0.32 wide; its face is on the -forward side
      solid.box(hx, hy, hz, 0.26, 1.05, 0.32, -h, HOUSING);
      const faceX = hx - f[0] * 0.15;
      const faceZ = hz - f[1] * 0.15;
      place(vMesh!, k * 3, faceX, hy + 0.33, faceZ, n, 'red', lamps);
      place(vMesh!, k * 3 + 1, faceX, hy, faceZ, n, 'amber', lamps);
      place(vMesh!, k * 3 + 2, faceX, hy - 0.33, faceZ, n, 'green', lamps);
      this.heads.push({ groupId: ref.group.id, pedestrian: false, pos: ref.head.pos, lamps, lastKey: '' });
    });

    ped.forEach((ref, k) => {
      const [x, z] = ref.head.pos;
      // face across the crossing towards the other end (where the waiting pedestrian stands)
      let n: Vec2;
      if (ref.crossing) {
        const [a, b] = ref.crossing.line;
        const other = Math.hypot(a[0] - x, a[1] - z) < Math.hypot(b[0] - x, b[1] - z) ? b : a;
        const len = Math.hypot(other[0] - x, other[1] - z) || 1;
        n = [(other[0] - x) / len, (other[1] - z) / len];
      } else {
        const f = forwardOf(ref.head.heading);
        n = [-f[0], -f[1]];
      }
      const lamps: LampRef[] = [];
      solid.cylinder(x, z, 0.045, 0.06, 0, 2.95, 8, POLE);
      const hy = 2.45;
      solid.box(x, hy, z, 0.3, 0.64, 0.22, Math.atan2(n[0], n[1]), HOUSING);
      const faceX = x + n[0] * 0.13;
      const faceZ = z + n[1] * 0.13;
      place(standing!, k, faceX, hy + 0.16, faceZ, n, 'red', lamps);
      place(walking!, k, faceX, hy - 0.16, faceZ, n, 'green', lamps);
      this.heads.push({ groupId: ref.group.id, pedestrian: true, pos: ref.head.pos, lamps, lastKey: '' });
    });

    for (const mesh of [vMesh, standing, walking]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      mesh.name = 'signal-lamps';
      this.meshes.push(mesh);
    }
  }

  get headCount(): number {
    return this.heads.length;
  }

  /** Refresh lamps of heads within `radius` of the camera. Returns the number of heads updated. */
  update(stateOf: (groupId: string) => SignalState, blink: boolean, cameraPos: Vec2, radius = SIGNAL_UPDATE_RADIUS): number {
    const r2 = radius * radius;
    let changed = 0;
    for (const head of this.heads) {
      const dx = head.pos[0] - cameraPos[0];
      const dz = head.pos[1] - cameraPos[1];
      if (dx * dx + dz * dz > r2) continue;
      const state = stateOf(head.groupId);
      const flashing = state === 'flashing_green' || state === 'flashing_amber';
      const key = flashing ? `${state}:${blink ? 1 : 0}` : state;
      if (key === head.lastKey) continue;
      head.lastKey = key;
      changed++;
      if (head.pedestrian) {
        const s = pedLampStates(state, blink);
        for (const lamp of head.lamps) this.setLamp(lamp, lamp.colour === 'red' ? s.red : s.green);
      } else {
        const s = lampStates(state, blink);
        for (const lamp of head.lamps) this.setLamp(lamp, s[lamp.colour]);
      }
    }
    for (const mesh of this.dirty) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.dirty.clear();
    return changed;
  }

  /** Forget cached states so the next update re-colours every lamp (e.g. after the provider changed). */
  reset(): void {
    for (const head of this.heads) {
      head.lastKey = '';
      for (const lamp of head.lamps) this.setLamp(lamp, false);
    }
    for (const mesh of this.dirty) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.dirty.clear();
  }

  private setLamp(lamp: LampRef, lit: boolean): void {
    lamp.mesh.setColorAt(lamp.index, lit ? LIT[lamp.colour] : DARK[lamp.colour]);
    this.dirty.add(lamp.mesh);
  }

  dispose(): void {
    const geoms = new Set<THREE.BufferGeometry>();
    for (const m of this.meshes) {
      geoms.add(m.geometry);
      m.dispose();
    }
    for (const g of geoms) g.dispose();
  }
}
