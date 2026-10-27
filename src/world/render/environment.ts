/**
 * Sky, sun/moon, hemisphere + ambient light, fog and the day/night + weather state.
 * The pure parts (sunDirection, daylightFactor, skyColours) are unit-tested; Environment
 * owns the three.js objects.
 */
import * as THREE from 'three';
import type { Vec3 } from './MeshBuffer';
import { PALETTE } from './palette';

export type Weather = 'clear' | 'rain' | 'fog';
export type Quality = 'low' | 'medium' | 'high';

const MAX_SUN_ELEVATION = (62 * Math.PI) / 180;

/** Sun elevation (rad) for an hour of the day: 0 at 06:00 and 18:00, max at noon, negative at night. */
export function sunElevation(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return Math.sin((Math.PI * (h - 6)) / 12) * MAX_SUN_ELEVATION;
}

/** Unit vector from the scene towards the sun (+x east, +z south, y up). */
export function sunDirection(hour: number): Vec3 {
  const h = ((hour % 24) + 24) % 24;
  const elev = sunElevation(h);
  const az = (Math.PI * (h - 6)) / 12; // east (0) → south (π/2) → west (π)
  const c = Math.cos(elev);
  return [c * Math.cos(az), Math.sin(elev), c * Math.sin(az)];
}

/** Moon: opposite side of the sky, 40° up. */
export function moonDirection(hour: number): Vec3 {
  const h = ((hour % 24) + 24) % 24;
  const az = (Math.PI * (h - 18)) / 12;
  const elev = (40 * Math.PI) / 180;
  return [Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az)];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 0 at night … 1 in full daylight (twilight in between). */
export function daylightFactor(hour: number): number {
  const elevDeg = (sunElevation(hour) * 180) / Math.PI;
  return smoothstep(-6, 8, elevDeg);
}

export interface SkyColours {
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  moonIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  ambient: number;
  fogNear: number;
  fogFar: number;
  /** 1 at night: drives emissive lamps and windows. */
  night: number;
}

export function skyColours(hour: number, weather: Weather): SkyColours {
  const day = daylightFactor(hour);
  const elev = sunElevation(hour);
  const lowSun = 1 - smoothstep(0, 0.35, elev); // warm tint near sunrise / sunset
  const zenithDay = new THREE.Color(0x4a8bdc).lerp(new THREE.Color(0xf0a060), lowSun * 0.35);
  const horizonDay = new THREE.Color(0xd2e5f6).lerp(new THREE.Color(0xf6b07a), lowSun * 0.6);
  const zenithNight = new THREE.Color(0x070d22);
  const horizonNight = new THREE.Color(0x1a2745);
  let zenith = zenithNight.clone().lerp(zenithDay, day);
  let horizon = horizonNight.clone().lerp(horizonDay, day);
  let sunIntensity = 3.2 * day;
  let ambient = 0.12 + 0.25 * day;
  let fogNear = 450;
  let fogFar = 2800;
  if (weather === 'rain') {
    zenith = zenith.lerp(new THREE.Color(0x5e6872), 0.75 * day);
    horizon = horizon.lerp(new THREE.Color(0x9ea7af), 0.8 * day);
    sunIntensity *= 0.4;
    ambient *= 0.9;
    fogNear = 120;
    fogFar = 1100;
  } else if (weather === 'fog') {
    zenith = zenith.lerp(new THREE.Color(0xc3c7cb), 0.9 * day);
    horizon = horizon.lerp(new THREE.Color(0xd3d6d9), 0.95 * day);
    sunIntensity *= 0.3;
    fogNear = 8;
    fogFar = 210;
  }
  const sun = new THREE.Color(0xfff2dc).lerp(new THREE.Color(0xffa040), lowSun * 0.7);
  return {
    zenith,
    horizon,
    sun,
    sunIntensity,
    moonIntensity: 0.32 * (1 - day),
    hemiSky: horizon.clone().lerp(zenith, 0.4),
    hemiGround: new THREE.Color(PALETTE.ground).multiplyScalar(0.25 + 0.55 * day),
    ambient,
    fogNear,
    fogFar,
    night: 1 - day,
  };
}

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly sky: THREE.Mesh;
  readonly fog: THREE.Fog;
  private readonly lightRig = new THREE.Group();
  private hour = 12;
  private weather: Weather = 'clear';
  private colours: SkyColours;

  constructor(
    private readonly scene: THREE.Scene,
    readonly quality: Quality,
    readonly shadowRadius = 150,
  ) {
    this.group.name = 'environment';
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.moon = new THREE.DirectionalLight(0x9fb4e0, 0);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.7);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.3);
    // the rig follows the camera so the shadow frustum (and the lights' targets) stay around the player
    this.lightRig.add(this.sun, this.sun.target, this.moon, this.moon.target);
    this.group.add(this.lightRig, this.hemi, this.ambient);
    if (quality === 'high') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const cam = this.sun.shadow.camera;
      cam.left = -shadowRadius;
      cam.right = shadowRadius;
      cam.top = shadowRadius;
      cam.bottom = -shadowRadius;
      cam.near = 10;
      cam.far = 900;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.3;
    }
    this.sky = makeSkyDome();
    this.group.add(this.sky);
    this.fog = new THREE.Fog(0xffffff, 450, 2800);
    scene.fog = this.fog;
    this.colours = skyColours(this.hour, this.weather);
    this.apply();
  }

  get night(): number {
    return this.colours.night;
  }

  setHour(hour: number): void {
    this.hour = hour;
    this.apply();
  }

  setWeather(w: Weather): void {
    this.weather = w;
    this.apply();
  }

  /** Call every frame: keeps the sky dome and the light rig centred on the camera. */
  update(cameraPos: THREE.Vector3): void {
    this.sky.position.set(cameraPos.x, 0, cameraPos.z);
    this.lightRig.position.set(cameraPos.x, 0, cameraPos.z);
  }

  private apply(): void {
    const c = (this.colours = skyColours(this.hour, this.weather));
    const sd = sunDirection(this.hour);
    const md = moonDirection(this.hour);
    this.sun.position.set(sd[0] * 400, Math.max(sd[1], 0.05) * 400, sd[2] * 400);
    this.sun.color.copy(c.sun);
    this.sun.intensity = c.sunIntensity;
    this.sun.visible = c.sunIntensity > 0.01;
    this.moon.position.set(md[0] * 400, md[1] * 400, md[2] * 400);
    this.moon.intensity = c.moonIntensity;
    this.moon.visible = c.moonIntensity > 0.01;
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = 0.25 + 0.55 * (1 - c.night);
    this.ambient.intensity = c.ambient;
    this.fog.color.copy(c.horizon);
    this.fog.near = c.fogNear;
    this.fog.far = c.fogFar;
    this.scene.background = c.horizon.clone();
    paintSkyDome(this.sky, c.zenith, c.horizon);
  }

  dispose(): void {
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.sun.dispose();
    this.moon.dispose();
    this.hemi.dispose();
    this.ambient.dispose();
    if (this.scene.fog === this.fog) this.scene.fog = null;
  }
}

/** Inside-out sphere with vertex-coloured gradient; drawn first, ignores depth, follows the camera. */
function makeSkyDome(): THREE.Mesh {
  const geom = new THREE.SphereGeometry(400, 24, 14);
  const n = geom.attributes.position!.count;
  geom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return mesh;
}

function paintSkyDome(mesh: THREE.Mesh, zenith: THREE.Color, horizon: THREE.Color): void {
  const geom = mesh.geometry;
  const pos = geom.attributes.position!;
  const col = geom.attributes.color as THREE.BufferAttribute;
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = pos.getY(i) / 400;
    const t = smoothstep(0.0, 0.55, ny);
    tmp.copy(horizon).lerp(zenith, t);
    col.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  col.needsUpdate = true;
}
