/**
 * TrafficRenderer — low-poly instanced rendering of NPC agents.
 *
 * Draw calls (≤ 10 in total): cars, buses, trucks, two-wheelers (each one InstancedMesh
 * of merged boxes; body colour via instance colour, fixed parts via vertex colours),
 * one InstancedMesh for ALL vehicle lights (brake lights + indicators, encoded in the
 * instance colour: r = brake, g = left, b = right, decoded by a tiny shader patch),
 * pedestrian bodies (capsule, 6 clothing colours) and pedestrian heads.
 *
 *   const renderer = new TrafficRenderer(scene);
 *   renderer.viewer = ctx.player.pos;        // optional: only agents within 400 m are drawn
 *   renderer.update(traffic.agents, ctx.dt); // every frame
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TrafficAgentState } from '@/core/types';
import { headingToRotationY, type Vec2 } from '@/world/geo';
import { RENDER, VEHICLE_DIMS, type VehicleKind } from './constants';
import type { TrafficAgentView } from './agents';

const CAR_COLOURS = [0xf2f2f2, 0x1f1f23, 0x9ea3a8, 0xb01e24, 0x1f4e9c, 0x2f6f3e, 0xd8c47a, 0x6b4a2b].map((c) => new THREE.Color(c));
const BUS_COLOURS = [0x3cb043, 0x1f6fd1, 0xf0d02c, 0x7ac142].map((c) => new THREE.Color(c));
const TRUCK_COLOURS = [0xffffff, 0xd9d9d9, 0xb22222, 0x2b4b8c, 0xf2a900, 0x4c4c4c].map((c) => new THREE.Color(c));
const BIKE_COLOURS = [0x222222, 0x8e1b1b, 0x1b5e8e, 0x3d7a2f, 0xd0d0d0, 0xe39a1c].map((c) => new THREE.Color(c));
const PED_COLOURS = [0xe04b3f, 0x2f6fd3, 0x3aa65c, 0xe8c547, 0x7b4fb8, 0xf2f2f2].map((c) => new THREE.Color(c));
const SKIN = new THREE.Color(0xd9a983);

function colouredBox(w: number, h: number, d: number, x: number, y: number, z: number, colour: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const n = g.attributes['position']!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = colour.r;
    arr[i * 3 + 1] = colour.g;
    arr[i * 3 + 2] = colour.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const WHITE = new THREE.Color(1, 1, 1);
const DARK = new THREE.Color(0.08, 0.08, 0.09);
const GLASS = new THREE.Color(0.25, 0.3, 0.36);

/** Local frame: +x right, +y up, −z forward (see headingToRotationY). */
function carGeometry(kind: 'car' | 'emergency'): THREE.BufferGeometry {
  const { length: L, width: W, height: H } = VEHICLE_DIMS[kind];
  const parts: THREE.BufferGeometry[] = [];
  parts.push(colouredBox(W, H * 0.42, L, 0, 0.3 + H * 0.21, 0, WHITE)); // lower body
  parts.push(colouredBox(W * 0.9, H * 0.36, L * 0.52, 0, 0.3 + H * 0.42 + H * 0.18, L * 0.04, GLASS)); // cabin / glass
  parts.push(colouredBox(W * 0.92, H * 0.08, L * 0.48, 0, 0.3 + H * 0.42 + H * 0.36 + H * 0.02, L * 0.04, WHITE)); // roof
  const wr = 0.32;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(colouredBox(0.22, wr * 2, wr * 2, (sx * W) / 2, wr, sz * L * 0.32, DARK));
  if (kind === 'emergency') parts.push(colouredBox(W * 0.6, 0.18, 0.4, 0, 0.3 + H * 0.42 + H * 0.46, -L * 0.05, new THREE.Color(0.1, 0.3, 1)));
  return mergeGeometries(parts, false)!;
}

function busGeometry(): THREE.BufferGeometry {
  const { length: L, width: W, height: H } = VEHICLE_DIMS.bus;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(colouredBox(W, H * 0.8, L, 0, 0.35 + H * 0.4, 0, WHITE));
  parts.push(colouredBox(W + 0.02, H * 0.3, L * 0.96, 0, 0.35 + H * 0.55, 0, GLASS)); // window band
  parts.push(colouredBox(W * 0.96, 0.15, L * 0.98, 0, 0.35 + H * 0.8 + 0.07, 0, WHITE)); // roof
  for (const sx of [-1, 1]) for (const z of [-L * 0.36, L * 0.3]) parts.push(colouredBox(0.26, 0.9, 0.9, (sx * W) / 2, 0.45, z, DARK));
  return mergeGeometries(parts, false)!;
}

function truckGeometry(): THREE.BufferGeometry {
  const { length: L, width: W, height: H } = VEHICLE_DIMS.truck;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(colouredBox(W, H * 0.55, L * 0.3, 0, 0.4 + H * 0.28, -L * 0.33, WHITE)); // cab
  parts.push(colouredBox(W * 0.95, H * 0.25, L * 0.26, 0, 0.4 + H * 0.55 + H * 0.12, -L * 0.33, GLASS));
  parts.push(colouredBox(W, H * 0.85, L * 0.64, 0, 0.4 + H * 0.43, L * 0.17, new THREE.Color(0.9, 0.9, 0.9))); // cargo box
  for (const sx of [-1, 1]) for (const z of [-L * 0.33, L * 0.25, L * 0.4]) parts.push(colouredBox(0.26, 0.8, 0.8, (sx * W) / 2, 0.4, z, DARK));
  return mergeGeometries(parts, false)!;
}

function bikeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(colouredBox(0.12, 0.5, 0.5, 0, 0.3, -0.55, DARK)); // front wheel
  parts.push(colouredBox(0.12, 0.5, 0.5, 0, 0.3, 0.55, DARK)); // rear wheel
  parts.push(colouredBox(0.1, 0.1, 1.1, 0, 0.55, 0, WHITE)); // frame
  parts.push(colouredBox(0.4, 0.55, 0.3, 0, 1.05, 0.1, WHITE)); // rider torso (clothing = instance colour)
  parts.push(colouredBox(0.22, 0.22, 0.22, 0, 1.45, 0.05, SKIN)); // head
  return mergeGeometries(parts, false)!;
}

/** Unit-space lights: scaled per instance by (width, height, length). Vertex colour encodes the channel. */
function lightsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const R = new THREE.Color(1, 0, 0);
  const G = new THREE.Color(0, 1, 0);
  const B = new THREE.Color(0, 0, 1);
  for (const sx of [-1, 1]) {
    parts.push(colouredBox(0.14, 0.09, 0.03, sx * 0.34, 0.5, 0.5, R)); // brake lights (rear)
    parts.push(colouredBox(0.08, 0.07, 0.03, sx * 0.47, 0.5, 0.5, sx < 0 ? G : B)); // rear indicators
    parts.push(colouredBox(0.08, 0.07, 0.03, sx * 0.47, 0.5, -0.5, sx < 0 ? G : B)); // front indicators
  }
  return mergeGeometries(parts, false)!;
}

function pedestrianBodyGeometry(): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(0.21, 0.85, 2, 6);
  g.translate(0, 0.85, 0);
  return g;
}

function pedestrianHeadGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.13, 7, 6);
  g.translate(0, 1.6, 0);
  return g;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  colours: THREE.Color[];
  count: number;
}

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpColor = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class TrafficRenderer {
  readonly group = new THREE.Group();
  /** When set, only agents within RENDER.maxDistance of this point are drawn. */
  viewer?: Vec2;
  private time = 0;
  private batches = new Map<string, Batch>();
  private lights: THREE.InstancedMesh;
  private pedBodies: THREE.InstancedMesh;
  private pedHeads: THREE.InstancedMesh;
  private disposables: { dispose(): void }[] = [];

  constructor(scene: THREE.Scene) {
    this.group.name = 'traffic';
    scene.add(this.group);
    const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(bodyMat);
    const make = (key: string, geometry: THREE.BufferGeometry, colours: THREE.Color[], max: number): void => {
      const mesh = new THREE.InstancedMesh(geometry, bodyMat, max);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = `traffic-${key}`;
      this.group.add(mesh);
      this.batches.set(key, { mesh, colours, count: 0 });
      this.disposables.push(geometry);
    };
    make('car', carGeometry('car'), CAR_COLOURS, RENDER.maxVehicles);
    make('bus', busGeometry(), BUS_COLOURS, 24);
    make('truck', truckGeometry(), TRUCK_COLOURS, 24);
    make('bike', bikeGeometry(), BIKE_COLOURS, 32);
    make('emergency', carGeometry('emergency'), [new THREE.Color(0xffffff)], 4);

    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    lightMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          float onAmount = clamp(vColor.r + vColor.g + vColor.b, 0.0, 1.0);
          vec3 lit = vec3(1.0, 0.08, 0.05) * vColor.r + vec3(1.0, 0.62, 0.05) * (vColor.g + vColor.b);
          diffuseColor.rgb = mix(vec3(0.16, 0.05, 0.04), lit, onAmount);
        #endif`,
      );
    };
    this.disposables.push(lightMat);
    const lg = lightsGeometry();
    this.disposables.push(lg);
    this.lights = new THREE.InstancedMesh(lg, lightMat, RENDER.maxVehicles + 40);
    this.lights.count = 0;
    this.lights.frustumCulled = false;
    this.lights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lights.name = 'traffic-lights';
    this.group.add(this.lights);

    const pedMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const headMat = new THREE.MeshLambertMaterial({ color: SKIN });
    const pg = pedestrianBodyGeometry();
    const hg = pedestrianHeadGeometry();
    this.disposables.push(pedMat, headMat, pg, hg);
    this.pedBodies = new THREE.InstancedMesh(pg, pedMat, RENDER.maxPedestrians);
    this.pedHeads = new THREE.InstancedMesh(hg, headMat, RENDER.maxPedestrians);
    for (const m of [this.pedBodies, this.pedHeads]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.pedBodies.name = 'traffic-pedestrians';
    this.pedHeads.name = 'traffic-pedestrian-heads';
  }

  /** Number of draw calls this renderer issues at most. */
  get drawCalls(): number {
    return this.batches.size + 3;
  }

  private batchFor(kind: VehicleKind): Batch {
    switch (kind) {
      case 'bus':
        return this.batches.get('bus')!;
      case 'truck':
        return this.batches.get('truck')!;
      case 'bicycle':
      case 'scooter':
      case 'motorcycle':
        return this.batches.get('bike')!;
      case 'emergency':
        return this.batches.get('emergency')!;
      default:
        return this.batches.get('car')!;
    }
  }

  update(agents: readonly TrafficAgentState[], dt: number): void {
    this.time += dt;
    for (const b of this.batches.values()) b.count = 0;
    let lightCount = 0;
    let pedCount = 0;
    const blinkOn = (this.time % RENDER.blinkPeriod) < RENDER.blinkPeriod / 2;
    const maxD2 = RENDER.maxDistance * RENDER.maxDistance;
    for (const a of agents) {
      if (this.viewer) {
        const dx = a.pos[0] - this.viewer[0];
        const dz = a.pos[1] - this.viewer[1];
        if (dx * dx + dz * dz > maxD2) continue;
      }
      const view = a as TrafficAgentView;
      if (a.kind === 'pedestrian') {
        if (pedCount >= RENDER.maxPedestrians) continue;
        const bob = a.speed > 0.05 ? Math.abs(Math.sin(this.time * 7 + pedCount)) * 0.04 : 0;
        tmpPos.set(a.pos[0], bob, a.pos[1]);
        tmpQuat.setFromAxisAngle(Y_AXIS, headingToRotationY(a.heading));
        tmpScale.set(1, 1, 1);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        this.pedBodies.setMatrixAt(pedCount, tmpMatrix);
        this.pedHeads.setMatrixAt(pedCount, tmpMatrix);
        this.pedBodies.setColorAt(pedCount, PED_COLOURS[hashId(a.id) % PED_COLOURS.length]!);
        pedCount++;
        continue;
      }
      const batch = this.batchFor(a.kind);
      if (batch.count >= batch.mesh.count || batch.count >= (batch.mesh.instanceMatrix.count ?? 0)) {
        if (batch.count >= batch.mesh.instanceMatrix.count) continue;
      }
      tmpPos.set(a.pos[0], 0, a.pos[1]);
      tmpQuat.setFromAxisAngle(Y_AXIS, headingToRotationY(a.heading));
      tmpScale.set(1, 1, 1);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      batch.mesh.setMatrixAt(batch.count, tmpMatrix);
      batch.mesh.setColorAt(batch.count, batch.colours[hashId(a.id) % batch.colours.length]!);
      batch.count++;
      // lights (unit space scaled to the body)
      if (lightCount < this.lights.instanceMatrix.count) {
        const dims = VEHICLE_DIMS[a.kind as VehicleKind] ?? VEHICLE_DIMS.car;
        tmpScale.set(dims.width, dims.height, dims.length);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        this.lights.setMatrixAt(lightCount, tmpMatrix);
        const braking = view.braking || (a.speed < 0.2 && view.waiting);
        const ind = a.indicator ?? 'off';
        const left = blinkOn && (ind === 'left' || ind === 'hazard') ? 1 : 0;
        const right = blinkOn && (ind === 'right' || ind === 'hazard') ? 1 : 0;
        tmpColor.setRGB(braking ? 1 : 0, left, right);
        this.lights.setColorAt(lightCount, tmpColor);
        lightCount++;
      }
    }
    for (const b of this.batches.values()) {
      b.mesh.count = b.count;
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    }
    this.lights.count = lightCount;
    this.lights.instanceMatrix.needsUpdate = true;
    if (this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true;
    this.pedBodies.count = pedCount;
    this.pedHeads.count = pedCount;
    this.pedBodies.instanceMatrix.needsUpdate = true;
    this.pedHeads.instanceMatrix.needsUpdate = true;
    if (this.pedBodies.instanceColor) this.pedBodies.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const b of this.batches.values()) b.mesh.dispose();
    this.lights.dispose();
    this.pedBodies.dispose();
    this.pedHeads.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
