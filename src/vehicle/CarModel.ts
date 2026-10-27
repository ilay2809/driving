/**
 * Procedural low-poly car: exterior (body, chamfered cabin, bonnet, bumpers, wheels
 * with tread, lamps) and the interior seen from the driver's seat (dashboard with the
 * instrument cluster texture, steering wheel, A-pillars, roof, seats, door panels,
 * rear-view and door mirrors, wipers).
 *
 * Frame: `root` sits at the physics body origin (restHeight above the ground);
 * local forward is −z, right is +x. Ground is at local y = −restHeight.
 *
 * Proportions (compact family car, driver's eye at x −0.37, 1.22 m above ground, z +0.12 —
 * see DEFAULT_CAMERA_OPTIONS): windscreen base 1.17 m ahead of the eye at 0.85 m, header
 * 0.37 m ahead at 1.45 m (rake ≈ 53° from vertical); dashboard top 0.97 m, its rear edge
 * 0.67 m ahead of the eye so a strip of bonnet stays visible over it; A-pillars 8 cm wide
 * along the windscreen edges; door mirrors on the front doors just behind the pillar base
 * (≈ 33° left / 55° right of straight ahead); rear-view mirror hanging top-right of the eye line.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleState } from '@/core/types';
import { DashboardTexture } from './dashboard';
import type { MirrorSurfaces } from './mirrors';
import { DEFAULT_VEHICLE_SPEC, type VehicleSpec } from './VehicleBody';

export interface CarModelOptions {
  colour: number;
  /** Build the interior (dashboard, seats, pillars …). */
  interior: boolean;
}

export interface WheelVisual {
  x: number;
  y: number;
  z: number;
  /** Steer angle (rad), positive = right. */
  steer: number;
  /** Spin (rad), positive = rolling forward. */
  spin: number;
}

export interface CarModelFrame {
  lampOn: boolean;
  night: boolean;
  autoGear?: number;
}

const STEERING_WHEEL_LOCK = (450 * Math.PI) / 180;

/** z (local, −forward) of the windscreen base and of its top edge (the header). */
export const WINDSCREEN_BASE_Z = -1.05;
export const WINDSCREEN_TOP_Z = -0.25;
/** Height above ground of the windscreen base. */
export const WINDSCREEN_BASE_Y = 0.85;
/** Rotation about x that lays a vertical plane along the windscreen (local +y → up the glass). */
export function windscreenRake(roofHeight: number): number {
  return Math.atan2(WINDSCREEN_TOP_Z - WINDSCREEN_BASE_Z, roofHeight - WINDSCREEN_BASE_Y);
}
/** Door mirror housings sit on the front doors, 0.2 m behind the A-pillar base (seen past the pillar, ≈ 33° left / 55° right). */
export const DOOR_MIRROR_Z = -0.85;
/** Door mirror centre height above ground: the glass sits above the door sill (0.95 m) and below the pillar line of sight. */
export const DOOR_MIRROR_Y = 1.0;
/** Interior rear-view mirror centre (x, height above ground, z). */
export const REAR_MIRROR_X = -0.05;
export const REAR_MIRROR_Y = 1.32;
export const REAR_MIRROR_Z = -0.38;

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export class CarModel {
  readonly root = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  readonly mirrorGlass: MirrorSurfaces;
  readonly headlights: THREE.SpotLight[] = [];
  readonly dashboard = new DashboardTexture();
  readonly steeringWheel = new THREE.Group();
  readonly opts: CarModelOptions;
  readonly restHeight: number;
  private spec: Pick<VehicleSpec, 'length' | 'width' | 'height' | 'wheelbase' | 'track' | 'wheelRadius' | 'wheelWidth'>;
  private tyres: THREE.Mesh[] = [];
  private wiperArms: THREE.Group[] = [];
  private lampMats: Record<'head' | 'tail' | 'brake' | 'brakeHigh' | 'indL' | 'indR' | 'reverse', THREE.MeshStandardMaterial>;
  private disposables: (THREE.Material | THREE.BufferGeometry)[] = [];

  constructor(opts: Partial<CarModelOptions> = {}, dims: { spec?: Partial<VehicleSpec>; restHeight?: number } = {}) {
    this.opts = { colour: 0x2f6fde, interior: true, ...opts };
    this.spec = { ...DEFAULT_VEHICLE_SPEC, ...(dims.spec ?? {}) };
    this.restHeight = dims.restHeight ?? 0.6;
    this.root.name = 'player-car';
    this.lampMats = {
      head: this.lampMaterial(0xe9eef5, 0xffffff),
      tail: this.lampMaterial(0x8a1010, 0xff2020),
      brake: this.lampMaterial(0x8a1010, 0xff2a2a),
      brakeHigh: this.lampMaterial(0x8a1010, 0xff2a2a),
      indL: this.lampMaterial(0x9a5a10, 0xffa000),
      indR: this.lampMaterial(0x9a5a10, 0xffa000),
      reverse: this.lampMaterial(0xd8dce2, 0xffffff),
    };
    this.mirrorGlass = this.buildExterior();
    this.buildWheels();
    if (this.opts.interior) this.buildInterior();
  }

  private mat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial(params);
    this.disposables.push(m);
    return m;
  }

  private lampMaterial(color: number, emissive: number): THREE.MeshStandardMaterial {
    return this.mat({ color, emissive, emissiveIntensity: 0, roughness: 0.3, metalness: 0.1 });
  }

  private g(x: number, y: number, z: number): [number, number, number] {
    // helper: a point given as (x, height above ground, z) → local frame
    return [x, y - this.restHeight, z];
  }

  private buildExterior(): MirrorSurfaces {
    const s = this.spec;
    const body = this.mat({ color: this.opts.colour, roughness: 0.35, metalness: 0.45 });
    const dark = this.mat({ color: 0x15171a, roughness: 0.7, metalness: 0.2 });
    const glass = this.mat({ color: 0x1b2a3a, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.55 });
    const chrome = this.mat({ color: 0xc9ced4, roughness: 0.25, metalness: 0.9 });
    const plate = this.mat({ color: 0xf2c200, roughness: 0.6 });

    const L = s.length;
    const Wd = s.width;
    const groundClear = 0.25;
    const bodyTop = 0.85;
    // lower body: slightly narrower at the sills, with a bevel via two boxes
    // lower body = bonnet block + boot block + door sills; the cabin stays hollow so the
    // interior floor (not the body's top face) is what the driver sees looking down
    const hollow0 = WINDSCREEN_BASE_Z;
    const hollow1 = 1.75;
    const bodyH = bodyTop - groundClear;
    const bodyMidY = (bodyTop + groundClear) / 2;
    this.root.add(box(Wd, bodyH, hollow0 + L / 2, body, ...this.g(0, bodyMidY, (-L / 2 + hollow0) / 2)));
    this.root.add(box(Wd, bodyH, L / 2 - hollow1, body, ...this.g(0, bodyMidY, (hollow1 + L / 2) / 2)));
    for (const x of [-1, 1]) this.root.add(box(0.06, bodyH, hollow1 - hollow0, body, ...this.g(x * (Wd / 2 - 0.03), bodyMidY, (hollow0 + hollow1) / 2))); // door skins (x 0.84–0.90), hidden by the door panels inside
    this.root.add(box(Wd - 0.1, 0.12, L - 0.6, dark, ...this.g(0, groundClear + 0.06, 0)));
    const floorMat = this.mat({ color: 0x1a1c20, roughness: 1 });
    this.root.add(box(Wd - 0.2, 0.04, hollow1 - hollow0, floorMat, ...this.g(0, 0.4, (hollow0 + hollow1) / 2)));
    this.root.add(box(Wd - 0.2, bodyH, 0.04, floorMat, ...this.g(0, bodyMidY, hollow0 + 0.02))); // firewall
    this.root.add(box(Wd - 0.2, bodyH, 0.04, floorMat, ...this.g(0, bodyMidY, hollow1 - 0.02))); // rear bulkhead
    // bumpers
    this.root.add(box(Wd - 0.05, 0.22, 0.12, dark, ...this.g(0, 0.5, -L / 2 - 0.03)));
    this.root.add(box(Wd - 0.05, 0.22, 0.12, dark, ...this.g(0, 0.5, L / 2 + 0.03)));
    // plates
    this.root.add(box(0.5, 0.11, 0.02, plate, ...this.g(0, 0.42, -L / 2 - 0.1)));
    this.root.add(box(0.5, 0.11, 0.02, plate, ...this.g(0, 0.62, L / 2 + 0.1)));
    // grille
    this.root.add(box(0.9, 0.16, 0.03, dark, ...this.g(0, 0.72, -L / 2 - 0.005)));

    // cabin: chamfered box (top face pulled inwards for the windscreen / rear window slopes)
    const cabinW = Wd - 0.2;
    const cabinH = s.height - bodyTop;
    const cabinZ0 = WINDSCREEN_BASE_Z; // front (windscreen base)
    const cabinZ1 = 1.75; // rear (rear window base)
    const wsRun = WINDSCREEN_TOP_Z - WINDSCREEN_BASE_Z; // horizontal run of the windscreen
    const cabinGeo = new THREE.BoxGeometry(cabinW, cabinH, cabinZ1 - cabinZ0);
    const pos = cabinGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        const z = pos.getZ(i);
        pos.setZ(i, z < 0 ? z + wsRun : z - 0.45);
        pos.setX(i, pos.getX(i) * 0.93);
      }
    }
    cabinGeo.computeVertexNormals();
    this.disposables.push(cabinGeo);
    const cabin = new THREE.Mesh(cabinGeo, glass);
    cabin.position.set(...this.g(0, bodyTop + cabinH / 2, (cabinZ0 + cabinZ1) / 2));
    this.root.add(cabin);
    // roof skin (opaque) on top of the cabin glass
    this.root.add(box(cabinW * 0.93 - 0.02, 0.04, cabinZ1 - cabinZ0 - wsRun - 0.45, body, ...this.g(0, s.height + 0.02, (cabinZ0 + wsRun + cabinZ1 - 0.45) / 2)));
    // B-pillars
    for (const x of [-1, 1]) this.root.add(box(0.08, cabinH, 0.1, dark, ...this.g(x * (cabinW / 2 - 0.02), bodyTop + cabinH / 2, 0.45)));

    // lamps
    const lampY = 0.7;
    for (const x of [-1, 1]) {
      this.root.add(box(0.36, 0.12, 0.05, this.lampMats.head, ...this.g(x * (Wd / 2 - 0.3), lampY, -L / 2 - 0.02)));
      this.root.add(box(0.16, 0.08, 0.05, x < 0 ? this.lampMats.indL : this.lampMats.indR, ...this.g(x * (Wd / 2 - 0.08), lampY - 0.02, -L / 2 - 0.02)));
      this.root.add(box(0.3, 0.1, 0.05, this.lampMats.tail, ...this.g(x * (Wd / 2 - 0.28), lampY, L / 2 + 0.02)));
      this.root.add(box(0.3, 0.06, 0.05, this.lampMats.brake, ...this.g(x * (Wd / 2 - 0.28), lampY + 0.09, L / 2 + 0.02)));
      this.root.add(box(0.14, 0.07, 0.05, x < 0 ? this.lampMats.indL : this.lampMats.indR, ...this.g(x * (Wd / 2 - 0.08), lampY - 0.02, L / 2 + 0.02)));
      // side repeaters on the wings
      this.root.add(box(0.03, 0.05, 0.1, x < 0 ? this.lampMats.indL : this.lampMats.indR, ...this.g(x * (Wd / 2 + 0.005), 0.8, -1.35)));
      // headlight spot
      const spot = new THREE.SpotLight(0xfff2d6, 0, 70, (32 * Math.PI) / 180, 0.45, 1.3);
      spot.position.set(...this.g(x * (Wd / 2 - 0.3), lampY, -L / 2));
      spot.target.position.set(x * 0.4, -this.restHeight - 0.2, -L / 2 - 18);
      this.root.add(spot);
      this.root.add(spot.target);
      this.headlights.push(spot);
    }
    this.root.add(box(0.2, 0.06, 0.05, this.lampMats.reverse, ...this.g(0.45, lampY - 0.1, L / 2 + 0.02)));
    // high-mounted brake light
    this.root.add(box(0.35, 0.03, 0.03, this.lampMats.brakeHigh, ...this.g(0, 1.26, 1.45))); // on the rear glass slope

    // door mirrors: housing + glass facing the driver, at the windscreen base corners
    // (the glass is angled towards the eye at x −0.37 / z +0.12: ≈ 30° for the left, 52° for the right)
    const mirrorGlassMat = this.mat({ color: 0x9aa3ad, roughness: 0.1, metalness: 0.9 });
    const mkDoorMirror = (side: -1 | 1): THREE.Mesh => {
      const grp = new THREE.Group();
      grp.position.set(...this.g(side * (Wd / 2 + 0.1), DOOR_MIRROR_Y, DOOR_MIRROR_Z));
      grp.rotation.y = side < 0 ? 0.58 : -0.95; // the whole housing faces the driver's eye
      grp.add(box(0.1, 0.03, 0.03, dark, side * -0.08, -0.02, 0)); // stalk
      grp.add(box(0.2, 0.13, 0.08, body, 0, 0, -0.03));
      const glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.11), mirrorGlassMat);
      glassMesh.position.set(0, 0, 0.012); // flush on the housing's rear face
      glassMesh.rotation.x = -0.1;
      glassMesh.name = side < 0 ? 'mirror-left' : 'mirror-right';
      grp.add(glassMesh);
      this.root.add(grp);
      return glassMesh;
    };
    const leftGlass = mkDoorMirror(-1);
    const rightGlass = mkDoorMirror(1);
    // interior rear-view mirror: hangs from the windscreen header, right of the driver's eye line
    // (0.54 m ahead of the eye, ≈ 31° right and 8° up — it covers sky, not road)
    const rearGrp = new THREE.Group();
    rearGrp.position.set(...this.g(REAR_MIRROR_X, REAR_MIRROR_Y, REAR_MIRROR_Z));
    rearGrp.rotation.y = -0.5;
    rearGrp.rotation.x = -0.1;
    rearGrp.add(box(0.24, 0.07, 0.025, dark, 0, 0, -0.014));
    const rearGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.06), mirrorGlassMat);
    rearGlass.position.set(0, 0, 0.001);
    rearGlass.name = 'mirror-rear';
    rearGrp.add(rearGlass);
    this.root.add(rearGrp);
    const stem = box(0.02, 0.12, 0.02, dark, ...this.g(REAR_MIRROR_X, REAR_MIRROR_Y + 0.07, REAR_MIRROR_Z + 0.04)); // stem up to the glass
    stem.rotation.x = 0.6;
    this.root.add(stem);

    void chrome;
    return { left: leftGlass, right: rightGlass, rear: rearGlass };
  }

  private buildWheels(): void {
    const s = this.spec;
    const rubber = this.mat({ color: 0x1a1a1c, roughness: 0.95, metalness: 0 });
    const rim = this.mat({ color: 0xb9bec5, roughness: 0.35, metalness: 0.8 });
    // tyre with tread blocks merged into one geometry
    const parts: THREE.BufferGeometry[] = [];
    const tyre = new THREE.CylinderGeometry(s.wheelRadius, s.wheelRadius, s.wheelWidth, 20);
    tyre.rotateZ(Math.PI / 2);
    parts.push(tyre);
    for (let i = 0; i < 12; i++) {
      const lug = new THREE.BoxGeometry(s.wheelWidth + 0.02, 0.05, 0.03);
      const a = (i / 12) * Math.PI * 2;
      lug.translate(0, s.wheelRadius - 0.005, 0);
      lug.rotateX(a);
      parts.push(lug);
    }
    const tyreGeo = mergeGeometries(parts, false)!;
    this.disposables.push(tyreGeo);
    const rimGeo = new THREE.CylinderGeometry(s.wheelRadius * 0.62, s.wheelRadius * 0.62, s.wheelWidth + 0.02, 12);
    rimGeo.rotateZ(Math.PI / 2);
    this.disposables.push(rimGeo);
    const spokeGeo = new THREE.BoxGeometry(s.wheelWidth + 0.03, s.wheelRadius * 1.1, 0.04);
    this.disposables.push(spokeGeo);
    const half = s.track / 2;
    const pts = [
      [-half, -s.wheelbase / 2],
      [half, -s.wheelbase / 2],
      [-half, s.wheelbase / 2],
      [half, s.wheelbase / 2],
    ];
    for (const [x, z] of pts) {
      const grp = new THREE.Group();
      grp.position.set(x!, -0.3, z!);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyreGeo, rubber);
      spin.add(t);
      const r = new THREE.Mesh(rimGeo, rim);
      spin.add(r);
      const sp = new THREE.Mesh(spokeGeo, rim);
      spin.add(sp);
      const sp2 = new THREE.Mesh(spokeGeo, rim);
      sp2.rotation.x = Math.PI / 3;
      spin.add(sp2);
      const sp3 = new THREE.Mesh(spokeGeo, rim);
      sp3.rotation.x = -Math.PI / 3;
      spin.add(sp3);
      grp.add(spin);
      this.tyres.push(t);
      this.wheels.push(grp);
      this.root.add(grp);
      // the spin group is the first child
    }
    // wheel arches (dark) so the wheels sit in a recess
    const arch = this.mat({ color: 0x101214, roughness: 0.9 });
    for (const [x, z] of pts) this.root.add(box(0.26, 0.5, 0.78, arch, ...this.g(x! * 1.02, 0.5, z!)));
  }

  private buildInterior(): void {
    const dash = this.mat({ color: 0x1c1f24, roughness: 0.9, metalness: 0.05 });
    const trim = this.mat({ color: 0x2a2d33, roughness: 0.85 });
    const seat = this.mat({ color: 0x30343a, roughness: 0.95 });
    const black = this.mat({ color: 0x121416, roughness: 0.6, metalness: 0.2 });
    const liner = this.mat({ color: 0x9a9da3, roughness: 1, side: THREE.DoubleSide });
    const wiperMat = this.mat({ color: 0x0a0a0a, roughness: 0.8 });
    const glassTint = this.mat({ color: 0x8fb3d9, transparent: true, opacity: 0.08, roughness: 0, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    const rake = windscreenRake(this.spec.height);
    const wsLen = Math.hypot(WINDSCREEN_TOP_Z - WINDSCREEN_BASE_Z, this.spec.height - WINDSCREEN_BASE_Y);
    const wsMidY = (WINDSCREEN_BASE_Y + this.spec.height) / 2;
    const wsMidZ = (WINDSCREEN_BASE_Z + WINDSCREEN_TOP_Z) / 2;

    // dashboard: top 0.97 m above ground, from the windscreen base back to z −0.55 (0.67 m ahead of
    // the eye) so the strip of bonnet beyond the dash front edge stays visible; knee panel set back
    const dashRear = -0.55;
    const dashDepth = dashRear - WINDSCREEN_BASE_Z;
    const dashMidZ = (WINDSCREEN_BASE_Z + dashRear) / 2;
    this.root.add(box(1.7, 0.18, dashDepth, dash, ...this.g(0, 0.86, dashMidZ))); // upper body 0.77–0.95
    this.root.add(box(1.7, 0.025, dashDepth + 0.02, trim, ...this.g(0, 0.9575, dashMidZ))); // padded top, 0.97
    this.root.add(box(1.7, 0.36, 0.3, dash, ...this.g(0, 0.59, WINDSCREEN_BASE_Z + 0.15))); // knee panel 0.41–0.77
    // driver's instrument binnacle: cluster face flush with the dash rear edge, tilted back towards the eye,
    // with a shallow hood that does not rise into the line of sight over the bonnet
    const binnacleW = 0.4;
    const binnacle = new THREE.Mesh(new THREE.PlaneGeometry(binnacleW, binnacleW / this.dashboard.aspect), this.mat({ map: this.dashboard.texture, roughness: 0.4, metalness: 0, emissive: 0xffffff, emissiveMap: this.dashboard.texture, emissiveIntensity: 0.9 }));
    binnacle.position.set(...this.g(-0.37, 0.9, dashRear + 0.005));
    binnacle.rotation.x = -0.28;
    this.root.add(binnacle);
    this.root.add(box(0.5, 0.025, 0.3, black, ...this.g(-0.37, 0.985, dashRear - 0.13))); // hood lip, top at ≈ 1.0
    // centre stack screen (slightly proud of the dash face) and the centre console between the seats
    this.root.add(box(0.36, 0.2, 0.03, black, ...this.g(0.12, 0.85, dashRear + 0.01)));
    this.root.add(box(0.3, 0.28, 0.75, trim, ...this.g(0, 0.52, -0.2)));
    // steering column + wheel (torus + 3 spokes + hub), tilted towards the driver; rim top ≈ 1.0 m,
    // 0.37 m ahead of the eye → the cluster is read through the upper half of the wheel
    const column = new THREE.Group();
    column.position.set(...this.g(-0.37, 0.84, -0.33));
    column.rotation.x = -0.45; // top of the wheel leans back towards the driver
    const wheelTorus = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.02, 10, 32), black);
    this.steeringWheel.add(wheelTorus);
    for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
      const spoke = box(0.04, 0.17, 0.022, black, 0, -0.095, 0);
      spoke.rotation.z = a + Math.PI; // three spokes: bottom, upper-left, upper-right
      const holder = new THREE.Group();
      holder.add(spoke);
      holder.rotation.z = a;
      this.steeringWheel.add(holder);
    }
    this.steeringWheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 16).rotateX(Math.PI / 2), black));
    column.add(this.steeringWheel);
    column.add(box(0.1, 0.1, 0.3, black, 0, 0, -0.17));
    this.root.add(column);
    // gear lever on the console
    this.root.add(box(0.03, 0.18, 0.03, black, ...this.g(0.02, 0.75, -0.3)));
    this.root.add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), black).translateX(0.02).translateY(0.86 - this.restHeight).translateZ(-0.3));
    // A-pillars: thin (8 cm) posts along the windscreen side edges, from the dash corners to the header
    for (const x of [-1, 1]) {
      const pillar = box(0.065, wsLen, 0.06, trim);
      pillar.position.set(...this.g(x * 0.79, wsMidY, wsMidZ));
      pillar.rotation.x = rake;
      pillar.rotation.z = x * 0.03; // the glass narrows towards the roof
      this.root.add(pillar);
    }
    // windscreen (tinted plane on the glass rake), header bar, headliner
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.6, wsLen), glassTint);
    ws.position.set(...this.g(0, wsMidY, wsMidZ));
    ws.rotation.x = rake;
    this.root.add(ws);
    this.root.add(box(1.56, 0.05, 0.1, trim, ...this.g(0, this.spec.height - 0.025, WINDSCREEN_TOP_Z + 0.03)));
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.5), liner);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(...this.g(0, this.spec.height - 0.03, 0.55));
    this.root.add(roof);
    // door panels and window sills (front door from the A-pillar base to the B-pillar at z 0.45)
    for (const x of [-1, 1]) {
      this.root.add(box(0.06, 0.6, 2.7, trim, ...this.g(x * 0.81, 0.62, 0.35))); // door panel, inboard of the skin
      this.root.add(box(0.1, 0.04, 2.7, dash, ...this.g(x * 0.83, 0.93, 0.35)));
      this.root.add(box(0.08, 0.86, 0.09, trim, ...this.g(x * 0.84, 1.17, 0.45))); // B-pillar inside
    }
    // seats (driver left, passenger right): cushion + reclined backrest; the passenger gets a headrest
    // (the driver's own would sit on the camera)
    for (const x of [-0.37, 0.37]) {
      this.root.add(box(0.5, 0.16, 0.5, seat, ...this.g(x, 0.5, 0.45)));
      const back = box(0.5, 0.62, 0.1, seat, ...this.g(x, 0.84, 0.72));
      back.rotation.x = 0.25;
      this.root.add(back);
      if (x > 0) this.root.add(box(0.24, 0.13, 0.1, seat, ...this.g(x, 1.2, 0.82)));
    }
    // rear bench + parcel shelf
    this.root.add(box(1.5, 0.5, 0.14, seat, ...this.g(0, 0.75, 1.55)));
    this.root.add(box(1.5, 0.04, 0.45, trim, ...this.g(0, 0.86, 1.95)));
    // wipers: two arms pivoting at the windscreen base, lying on the outside of the glass; parked
    // horizontally (mostly hidden behind the dash front edge), sweeping up the glass when running
    for (const x of [-0.6, 0.12]) {
      const arm = new THREE.Group();
      arm.position.set(...this.g(x, WINDSCREEN_BASE_Y + 0.02, WINDSCREEN_BASE_Z - 0.02));
      arm.rotation.x = rake; // local +y runs up the glass, local −z is outside
      const blade = box(0.62, 0.02, 0.012, wiperMat, 0.31, 0.03, -0.02);
      arm.add(blade);
      this.wiperArms.push(arm);
      this.root.add(arm);
    }
  }

  /** Per-frame update from the vehicle state. */
  update(state: VehicleState, wheels: readonly WheelVisual[], time: number, frame: CarModelFrame): void {
    for (let i = 0; i < this.wheels.length && i < wheels.length; i++) {
      const w = wheels[i]!;
      const grp = this.wheels[i]!;
      grp.position.set(w.x, w.y, w.z);
      grp.rotation.y = -w.steer;
      const spin = grp.children[0] as THREE.Group;
      spin.rotation.x = -w.spin;
    }
    this.steeringWheel.rotation.z = -state.steering * STEERING_WHEEL_LOCK;

    const lightsOn = state.lights === 'low' || state.lights === 'high';
    const parking = state.lights !== 'off';
    this.lampMats.head.emissiveIntensity = state.lights === 'high' ? 2.5 : lightsOn ? 1.4 : parking ? 0.35 : 0;
    this.lampMats.tail.emissiveIntensity = parking ? 0.9 : 0;
    this.lampMats.brake.emissiveIntensity = state.brake > 0.04 ? 2.2 : parking ? 0.6 : 0;
    this.lampMats.brakeHigh.emissiveIntensity = state.brake > 0.04 ? 2.2 : 0;
    const l = (state.indicator === 'left' || state.indicator === 'hazard') && frame.lampOn;
    const r = (state.indicator === 'right' || state.indicator === 'hazard') && frame.lampOn;
    this.lampMats.indL.emissiveIntensity = l ? 2.4 : 0;
    this.lampMats.indR.emissiveIntensity = r ? 2.4 : 0;
    this.lampMats.reverse.emissiveIntensity = state.gear === 'R' ? 1.6 : 0;
    // beams are faint in daylight (the sun washes them out) and strong at night
    const spotI = (state.lights === 'high' ? 1600 : lightsOn ? 650 : 0) * (frame.night ? 1 : 0.25);
    for (const s of this.headlights) {
      s.intensity = spotI;
      s.visible = spotI > 0;
    }

    if (state.wipers && this.wiperArms.length) {
      const phase = (time % 1.3) / 1.3;
      const a = (0.5 - 0.5 * Math.cos(phase * Math.PI * 2)) * 1.25;
      this.wiperArms[0]!.rotation.z = a;
      this.wiperArms[1]!.rotation.z = a;
    } else {
      for (const arm of this.wiperArms) arm.rotation.z = 0;
    }
    this.dashboard.draw(state, time, { lampOn: frame.lampOn, autoGear: frame.autoGear });
  }

  setColour(colour: number): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.color.getHex() === this.opts.colour) o.material.color.setHex(colour);
    });
    this.opts.colour = colour;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.dashboard.dispose();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
