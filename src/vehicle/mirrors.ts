/**
 * MirrorSystem — three mirror cameras (left / right door mirrors, interior rear-view)
 * rendered into WebGLRenderTargets at ≤ 20 Hz each (round-robin: at most one mirror
 * per frame) and shown on the mirror glass meshes of the CarModel.
 *
 * Reflection: a camera at the mirror position looking backwards renders the car's left
 * on the image's right; the glass geometry has its U coordinate flipped so the picture
 * reads like a real mirror. The cameras are children of the car root, so they follow it.
 */
import * as THREE from 'three';

export interface MirrorSurfaces {
  left: THREE.Mesh;
  right: THREE.Mesh;
  rear: THREE.Mesh;
}

export type MirrorName = keyof MirrorSurfaces;

export interface MirrorPlacement {
  /** Camera position in the car frame. */
  position: [number, number, number];
  /** Rotation about y in the car frame (π = looking straight back). */
  yaw: number;
  pitch: number;
  /** Vertical field of view (deg). */
  fov: number;
  width: number;
  height: number;
}

/** Positions are in the car frame whose origin sits 0.6 m above the ground (see CarModel). */
export const DEFAULT_MIRROR_PLACEMENTS: Record<MirrorName, MirrorPlacement> = {
  left: { position: [-1.0, 0.38, -1.1], yaw: Math.PI - 0.23, pitch: -0.04, fov: 22, width: 256, height: 144 },
  right: { position: [1.0, 0.38, -1.1], yaw: Math.PI + 0.26, pitch: -0.04, fov: 26, width: 256, height: 144 },
  rear: { position: [-0.05, 0.62, -0.8], yaw: Math.PI, pitch: 0.02, fov: 13, width: 384, height: 144 },
};

/** Flip the U coordinate of a plane so a backwards render reads as a mirror image. */
export function flipUVsHorizontally(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  uv.needsUpdate = true;
}

export class MirrorSystem {
  enabled: boolean;
  hz: number;
  readonly cameras: Record<MirrorName, THREE.PerspectiveCamera>;
  readonly targets: Record<MirrorName, THREE.WebGLRenderTarget>;
  private surfaces: MirrorSurfaces | null = null;
  private lastRender: Record<MirrorName, number> = { left: -1, right: -1, rear: -1 };
  private order: MirrorName[] = ['left', 'rear', 'right'];
  private cursor = 0;
  private offMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.2, metalness: 0.8 });
  private materials: Partial<Record<MirrorName, THREE.MeshBasicMaterial>> = {};

  constructor(opts: { enabled?: boolean; hz?: number; placements?: Partial<Record<MirrorName, Partial<MirrorPlacement>>> } = {}) {
    this.enabled = opts.enabled ?? true;
    this.hz = opts.hz ?? 20;
    const make = (name: MirrorName): [THREE.PerspectiveCamera, THREE.WebGLRenderTarget] => {
      const p = { ...DEFAULT_MIRROR_PLACEMENTS[name], ...(opts.placements?.[name] ?? {}) };
      const cam = new THREE.PerspectiveCamera(p.fov, p.width / p.height, 0.35, 400);
      cam.position.set(p.position[0], p.position[1], p.position[2]);
      cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      cam.name = `mirror:${name}`;
      const rt = new THREE.WebGLRenderTarget(p.width, p.height, { depthBuffer: true, stencilBuffer: false });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      return [cam, rt];
    };
    const [lc, lt] = make('left');
    const [rc, rtg] = make('right');
    const [bc, bt] = make('rear');
    this.cameras = { left: lc, right: rc, rear: bc };
    this.targets = { left: lt, right: rtg, rear: bt };
  }

  /** Attach to the car: cameras become children of `carRoot`, the glass meshes show the targets. */
  attach(surfaces: MirrorSurfaces, carRoot: THREE.Object3D): void {
    this.surfaces = surfaces;
    for (const name of this.order) {
      const cam = this.cameras[name];
      if (cam.parent !== carRoot) carRoot.add(cam);
      const mesh = surfaces[name];
      if (!this.materials[name]) {
        flipUVsHorizontally(mesh.geometry);
        this.materials[name] = new THREE.MeshBasicMaterial({ map: this.targets[name].texture, toneMapped: false });
      }
    }
    this.applyMaterials();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.applyMaterials();
  }

  private applyMaterials(): void {
    if (!this.surfaces) return;
    for (const name of this.order) {
      const mesh = this.surfaces[name];
      mesh.material = this.enabled ? this.materials[name]! : this.offMaterial;
    }
  }

  /** Call before the main render. Renders at most one mirror per call, each at ≤ `hz`. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, now: number = performance.now() / 1000): void {
    if (!this.enabled || !this.surfaces) return;
    const period = 1 / this.hz;
    for (let k = 0; k < this.order.length; k++) {
      const name = this.order[(this.cursor + k) % this.order.length]!;
      if (now - this.lastRender[name] < period) continue;
      this.cursor = (this.cursor + k + 1) % this.order.length;
      this.lastRender[name] = now;
      const prevTarget = renderer.getRenderTarget();
      const prevXr = renderer.xr.enabled;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(this.targets[name]);
      renderer.render(scene, this.cameras[name]);
      renderer.setRenderTarget(prevTarget);
      renderer.xr.enabled = prevXr;
      return;
    }
  }

  /** Force every mirror to render now (screenshots / after a teleport). */
  renderAll(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.enabled || !this.surfaces) return;
    const prevTarget = renderer.getRenderTarget();
    for (const name of this.order) {
      renderer.setRenderTarget(this.targets[name]);
      renderer.render(scene, this.cameras[name]);
      this.lastRender[name] = performance.now() / 1000;
    }
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    for (const name of this.order) {
      this.targets[name].dispose();
      this.materials[name]?.dispose();
      this.cameras[name].removeFromParent();
    }
    this.offMaterial.dispose();
  }
}
