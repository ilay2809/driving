/**
 * WorldRenderer — draws a WorldFile with three.js in a clean low-poly style.
 *
 * Integration: the vehicle module owns the WebGLRenderer, scene and camera and calls
 * `update(cameraPos, dt)` once per frame; the traffic module provides the
 * SignalStateProvider; the app sets time of day and weather. Everything the renderer adds
 * lives under `root` (a Group) so `dispose()` removes it cleanly.
 *
 * Performance model: the world is split into square tiles (250 m). Each tile becomes a
 * fixed, small set of meshes (asphalt, solids, markings, facades, roofs, plates, a few
 * InstancedMeshes for props and the traffic-light lamps). Tiles are built lazily around
 * the camera, at most one tile per frame and in time-budgeted steps so a frame never
 * hitches, and are disposed when they fall out of `viewRadius`. The camera's frustum
 * culling then works per tile mesh.
 *
 * Camera notes for the integrator: near ≥ 0.3 m, far ≥ 1000 m (the sky dome ignores depth
 * and follows the camera, so `far` only limits the terrain you can see through the fog).
 * In quality 'high' the renderer's shadow map is enabled here.
 */
import * as THREE from 'three';
import type { SignalStateProvider } from '@/core/sim';
import { dist2, type Vec2 } from '@/world/geo';
import type { RoadGraph } from '@/world/graph';
import type { SignalState, WorldFile } from '@/world/schema';
import { PlateAtlas, atlasSizeFor } from './atlas';
import { signCellKey } from './signStyles';
import { addBuilding } from './buildings';
import { Environment, type Quality, type Weather } from './environment';
import { createMaterials, disposeMaterials, type WorldMaterials } from './materials';
import { MeshBuffer } from './MeshBuffer';
import { PALETTE, rgb } from './palette';
import { PropInstancer, createPropPrototypes, disposePropPrototypes, type PropPrototypes } from './props';
import { SignFaces, addSign } from './signs';
import { SignalLampSet, blinkOn, SIGNAL_UPDATE_RADIUS } from './signals';
import { NamePlates, addNamePlate, namePlateSpots } from './streetNames';
import { addCrossing, addJunction, addRoad, addRoundaboutIsland } from './surfaces';
import { TileIndex, tileDistance, tilesWithin, type TileContent, type TileWish } from './tiles';

export interface WorldRendererOptions {
  quality?: Quality;
  /** Tile edge length in metres (default 250). */
  tileSize?: number;
  /** Tiles are loaded while within this distance of the camera (default 650 m; 450 m on 'low'). */
  viewRadius?: number;
  /** Base URL of the sign SVGs (default `${import.meta.env.BASE_URL}signs/`). */
  signsUrl?: string;
  /** CPU budget per frame for incremental tile building, ms (default 8). */
  buildBudgetMs?: number;
  /** Shadow-casting radius around the camera in quality 'high' (default 150 m). */
  shadowRadius?: number;
}

export interface WorldRendererStats {
  tilesLoaded: number;
  drawCalls: number;
  triangles: number;
  /** Tiles still to be built for the current camera position. */
  tilesPending: number;
  /** Milliseconds spent building tiles in the last update. */
  buildMs: number;
  /** Longest single build step so far (name + ms) — the worst hitch the streaming can cause. */
  slowestStep: { name: string; ms: number };
}

interface TileStep {
  name: string;
  run: () => void;
}

/** An object of a tile with the camera distance beyond which it is hidden (detail LOD). */
interface TileObject {
  object: THREE.Object3D;
  maxDistance: number;
}

interface LoadedTile {
  key: string;
  content: TileContent;
  objects: TileObject[];
  casters: THREE.Object3D[];
  geometries: THREE.BufferGeometry[];
  signals?: SignalLampSet;
  distance: number;
  shadows: boolean;
}

interface TileJob {
  content: TileContent;
  steps: TileStep[];
  next: number;
  asphalt: MeshBuffer;
  solid: MeshBuffer;
  marking: MeshBuffer;
  facade: MeshBuffer;
  roof: MeshBuffer;
  plate: MeshBuffer;
  objects: TileObject[];
  casters: THREE.Object3D[];
  geometries: THREE.BufferGeometry[];
  signals?: SignalLampSet;
}

/** Work-chunk sizes per build step (each step should stay well under 10 ms on a mid-range laptop). */
const ROADS_PER_STEP = 6;
const JUNCTIONS_PER_STEP = 4;
const BUILDINGS_PER_STEP = 50;
const PROPS_PER_STEP = 250;
const SIGNS_PER_STEP = 40;
const AREA_Y: Record<string, number> = { water: -0.05 };

/**
 * Detail distances (m): small things are not drawn for far tiles, which keeps the draw-call
 * count of a dense city view around the 150 target. Big geometry (asphalt, solids, buildings)
 * is always drawn out to viewRadius.
 */
const LOD = { markings: 420, plates: 330, props: 480, signalLamps: 300 } as const;

function chunks<T>(arr: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function defaultSignsUrl(): string {
  const base = typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.BASE_URL as string | undefined) : undefined;
  return `${base ?? '/'}signs/`;
}

export class WorldRenderer {
  /** Everything the renderer adds to the scene is parented here. */
  readonly root = new THREE.Group();
  readonly quality: Quality;
  readonly tileSize: number;
  readonly viewRadius: number;
  private readonly buildBudgetMs: number;
  private readonly shadowRadius: number;
  private readonly index: TileIndex;
  private readonly materials: WorldMaterials;
  private readonly atlas: PlateAtlas;
  private readonly signFaces: SignFaces;
  private readonly namePlates: NamePlates;
  private readonly protos: PropPrototypes;
  private readonly env: Environment;
  private readonly tiles = new Map<string, LoadedTile>();
  private readonly staticObjects: THREE.Object3D[] = [];
  private readonly staticGeometries: THREE.BufferGeometry[] = [];
  private wanted: TileWish[] = [];
  private lastPlanAt?: Vec2;
  private job?: TileJob;
  private provider?: SignalStateProvider;
  private time = 0;
  private hour = 12;
  private weather: Weather = 'clear';
  private buildMs = 0;
  private slowestStep = { name: '', ms: 0 };
  private disposed = false;

  constructor(
    readonly scene: THREE.Scene,
    readonly renderer: THREE.WebGLRenderer,
    readonly world: WorldFile,
    readonly graph: RoadGraph,
    opts: WorldRendererOptions = {},
  ) {
    this.quality = opts.quality ?? 'medium';
    this.tileSize = opts.tileSize ?? 250;
    this.viewRadius = opts.viewRadius ?? (this.quality === 'low' ? 450 : 650);
    this.buildBudgetMs = opts.buildBudgetMs ?? 8;
    this.shadowRadius = opts.shadowRadius ?? 150;
    this.root.name = 'world';
    // Every plate face the world needs is drawn now (load time): canvas allocation, text
    // layout and the first SVG requests would otherwise land inside a streamed frame.
    const names = new Set<string>();
    for (const r of world.roads) if (r.name) names.add(r.name);
    const signKeys = new Set(world.signs.map((s) => signCellKey(s.code, s.value)));
    this.atlas = new PlateAtlas(atlasSizeFor(names.size, signKeys.size));
    this.materials = createMaterials(this.atlas.texture);
    this.protos = createPropPrototypes(this.materials);
    this.signFaces = new SignFaces(this.atlas, opts.signsUrl ?? defaultSignsUrl());
    this.namePlates = new NamePlates(this.atlas);
    this.namePlates.prepare(names);
    for (const s of world.signs) this.signFaces.cellFor(s);
    this.index = new TileIndex(world, graph, this.tileSize);
    this.env = new Environment(scene, this.quality, this.shadowRadius);
    this.root.add(this.env.group);
    if (this.quality === 'high') {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    this.buildGround();
    this.buildAreas();
    scene.add(this.root);
    this.applyTimeOfDay();
  }

  // ---------------------------------------------------------------------------------
  // Public API

  /** Per-frame: stream tiles around the camera, animate signal lamps. */
  update(cameraPos: THREE.Vector3, dt: number): void {
    if (this.disposed) return;
    this.time += Math.max(0, dt);
    this.env.update(cameraPos);
    const cam: Vec2 = [cameraPos.x, cameraPos.z];
    if (!this.lastPlanAt || dist2(cam, this.lastPlanAt) > this.tileSize / 5) this.plan(cam);
    const t0 = now();
    this.work(t0, this.buildBudgetMs, 1);
    this.buildMs = now() - t0;
    this.updateSignals(cam);
  }

  /** Build every tile around `cameraPos` synchronously (initial load / screenshots). */
  preload(cameraPos: THREE.Vector3): void {
    const cam: Vec2 = [cameraPos.x, cameraPos.z];
    this.env.update(cameraPos);
    this.plan(cam);
    this.work(now(), Infinity, Infinity);
    this.updateSignals(cam);
  }

  setSignalProvider(p: SignalStateProvider | undefined): void {
    this.provider = p;
    for (const t of this.tiles.values()) t.signals?.reset();
  }

  setTimeOfDay(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    this.applyTimeOfDay();
  }

  setWeather(w: Weather): void {
    this.weather = w;
    this.applyTimeOfDay();
  }

  get timeOfDay(): number {
    return this.hour;
  }

  get currentWeather(): Weather {
    return this.weather;
  }

  /** Forget the slowest-step record (e.g. after the initial preload). */
  resetStats(): void {
    this.slowestStep = { name: '', ms: 0 };
    this.buildMs = 0;
  }

  stats(): WorldRendererStats {
    const info = this.renderer.info.render;
    let pending = 0;
    for (const w of this.wanted) if (!this.tiles.has(w.key)) pending++;
    return { tilesLoaded: this.tiles.size, drawCalls: info.calls, triangles: info.triangles, tilesPending: pending, buildMs: this.buildMs, slowestStep: { ...this.slowestStep } };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of [...this.tiles.keys()]) this.unload(key);
    this.job = undefined;
    for (const o of this.staticObjects) this.root.remove(o);
    for (const g of this.staticGeometries) g.dispose();
    this.env.dispose();
    this.root.remove(this.env.group);
    this.scene.remove(this.root);
    this.signFaces.dispose();
    this.namePlates.dispose();
    disposePropPrototypes(this.protos);
    disposeMaterials(this.materials);
    this.atlas.dispose();
  }

  // ---------------------------------------------------------------------------------
  // Environment

  private applyTimeOfDay(): void {
    this.env.setHour(this.hour);
    this.env.setWeather(this.weather);
    const night = this.env.night;
    const m = this.materials;
    m.lampHead.emissiveIntensity = 1.4 * night;
    m.facade.emissiveIntensity = 1.0 * night;
    m.plate.emissiveIntensity = 0.35 + 0.35 * night;
    m.marking.emissiveIntensity = 0.08 + 0.12 * night;
    const wet = this.weather === 'rain' ? 1 : 0;
    m.asphalt.color.set(PALETTE.asphalt).lerp(new THREE.Color(PALETTE.asphaltWet), wet);
  }

  // ---------------------------------------------------------------------------------
  // Static (untiled) geometry: ground plane and land-use areas

  private buildGround(): void {
    const b = this.world.bbox;
    const margin = 1500;
    const w = b.maxX - b.minX + 2 * margin;
    const h = b.maxZ - b.minZ + 2 * margin;
    const geom = new THREE.PlaneGeometry(w, h);
    geom.rotateX(-Math.PI / 2);
    geom.translate((b.minX + b.maxX) / 2, -0.02, (b.minZ + b.maxZ) / 2);
    const mesh = new THREE.Mesh(geom, this.materials.ground);
    mesh.name = 'ground';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    this.staticObjects.push(mesh);
    this.staticGeometries.push(geom);
  }

  private buildAreas(): void {
    if (this.world.areas.length === 0) return;
    const buf = new MeshBuffer();
    for (const a of this.world.areas) {
      if (a.polygon.length < 3) continue;
      buf.polygon(a.polygon, a.holes, AREA_Y[a.kind] ?? 0, rgb(PALETTE.area[a.kind] ?? PALETTE.ground));
    }
    if (buf.isEmpty) return;
    const geom = buf.build();
    const mesh = new THREE.Mesh(geom, this.materials.area);
    mesh.name = 'areas';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    this.staticObjects.push(mesh);
    this.staticGeometries.push(geom);
  }

  // ---------------------------------------------------------------------------------
  // Tile streaming

  private plan(cam: Vec2): void {
    this.lastPlanAt = cam;
    this.wanted = tilesWithin(cam, this.viewRadius, this.tileSize).filter((w) => this.index.tiles.has(w.key));
    const unloadBeyond = this.viewRadius + this.tileSize * 0.6;
    for (const t of this.tiles.values()) {
      t.distance = tileDistance(cam, t.content.ix, t.content.iz, this.tileSize);
      if (t.distance > unloadBeyond) {
        this.unload(t.key);
        continue;
      }
      this.applyDetail(t);
    }
    if (this.job && !this.wanted.some((w) => w.key === this.job!.content.key)) this.job = undefined;
  }

  /** Run build steps until the budget is spent or `maxTiles` tiles were completed. */
  private work(start: number, budgetMs: number, maxTiles: number): void {
    let completed = 0;
    for (;;) {
      if (!this.job) {
        const next = this.wanted.find((w) => !this.tiles.has(w.key));
        if (!next) return;
        const content = this.index.get(next.key);
        if (!content) return;
        this.job = this.createJob(content);
      }
      const job = this.job;
      const step = job.steps[job.next];
      if (step) {
        const t0 = now();
        step.run();
        const ms = now() - t0;
        if (ms > this.slowestStep.ms) this.slowestStep = { name: `${job.content.key}:${step.name}`, ms };
        job.next++;
      }
      if (job.next >= job.steps.length) {
        this.finishJob(job);
        this.job = undefined;
        if (++completed >= maxTiles) return;
      }
      if (now() - start >= budgetMs) return;
    }
  }

  private createJob(content: TileContent): TileJob {
    const job: TileJob = {
      content,
      steps: [],
      next: 0,
      asphalt: new MeshBuffer(),
      solid: new MeshBuffer(),
      marking: new MeshBuffer(),
      facade: new MeshBuffer(true),
      roof: new MeshBuffer(),
      plate: new MeshBuffer(true),
      objects: [],
      casters: [],
      geometries: [],
    };
    const bufs = { asphalt: job.asphalt, solid: job.solid, marking: job.marking };
    const castShadow = this.quality === 'high';
    const steps = job.steps;
    const step = (name: string, run: () => void) => steps.push({ name, run });
    for (const roads of chunks(content.roads, ROADS_PER_STEP)) step('roads', () => roads.forEach((r) => addRoad(r, this.graph, bufs)));
    for (const junctions of chunks(content.junctions, JUNCTIONS_PER_STEP)) step('junctions', () => junctions.forEach((j) => addJunction(j, this.graph, bufs)));
    if (content.crossings.length > 0 || content.islands.length > 0) {
      step('crossings', () => {
        content.crossings.forEach((c) => addCrossing(c, bufs));
        content.islands.forEach((r) => addRoundaboutIsland(r, bufs));
      });
    }
    for (const buildings of chunks(content.buildings, BUILDINGS_PER_STEP)) step('buildings', () => buildings.forEach((b) => addBuilding(b, job.facade, job.roof)));
    if (content.props.length > 0) {
      const instancer = new PropInstancer(this.protos, this.graph);
      for (const props of chunks(content.props, PROPS_PER_STEP)) step('props', () => instancer.add(props));
      step('props:instances', () => {
        for (const mesh of instancer.build(castShadow)) {
          job.objects.push({ object: mesh, maxDistance: LOD.props });
          job.casters.push(mesh);
        }
      });
    }
    for (const signs of chunks(content.signs, SIGNS_PER_STEP)) step('signs', () => signs.forEach((s) => addSign(s, this.signFaces.cellFor(s), job.plate, job.solid)));
    for (const junctions of chunks(content.junctions, JUNCTIONS_PER_STEP)) {
      step('names', () => {
        for (const j of junctions) for (const spot of namePlateSpots(j, this.graph)) addNamePlate(spot, this.namePlates.cellFor(spot.name), job.plate, job.solid);
      });
    }
    if (content.heads.length > 0) {
      step('signals', () => {
        job.signals = new SignalLampSet(content.heads, this.materials, job.solid);
        for (const mesh of job.signals.meshes) job.objects.push({ object: mesh, maxDistance: LOD.signalLamps });
      });
    }
    const m = this.materials;
    const make = (buf: MeshBuffer, material: THREE.Material, name: string, cast: boolean, receive: boolean, maxDistance: number) => {
      if (buf.isEmpty) return;
      const geom = buf.build();
      const mesh = new THREE.Mesh(geom, material);
      mesh.name = `tile:${content.key}:${name}`;
      mesh.castShadow = cast && this.quality === 'high';
      mesh.receiveShadow = receive;
      job.objects.push({ object: mesh, maxDistance });
      job.geometries.push(geom);
      if (cast) job.casters.push(mesh);
    };
    // one geometry upload per step keeps the final frames of a tile build short too
    step('mesh:asphalt', () => make(job.asphalt, m.asphalt, 'asphalt', false, true, Infinity));
    step('mesh:solid', () => make(job.solid, m.solid, 'solid', true, true, Infinity));
    step('mesh:marking', () => make(job.marking, m.marking, 'marking', false, true, LOD.markings));
    step('mesh:facade', () => make(job.facade, m.facade, 'facade', true, true, Infinity));
    step('mesh:roof', () => make(job.roof, m.roof, 'roof', true, true, Infinity));
    step('mesh:plate', () => make(job.plate, m.plate, 'plate', true, false, LOD.plates));
    return job;
  }

  private finishJob(job: TileJob): void {
    const tile: LoadedTile = {
      key: job.content.key,
      content: job.content,
      objects: job.objects,
      casters: job.casters,
      geometries: job.geometries,
      signals: job.signals,
      distance: this.lastPlanAt ? tileDistance(this.lastPlanAt, job.content.ix, job.content.iz, this.tileSize) : 0,
      shadows: false,
    };
    for (const { object } of tile.objects) {
      object.updateMatrix();
      object.matrixAutoUpdate = false;
      this.root.add(object);
    }
    this.applyDetail(tile, true);
    this.tiles.set(tile.key, tile);
  }

  /** Shadow casting and detail visibility of a tile from its current camera distance. */
  private applyDetail(t: LoadedTile, force = false): void {
    const shadows = this.quality === 'high' && t.distance <= this.shadowRadius;
    if (force || shadows !== t.shadows) {
      t.shadows = shadows;
      for (const o of t.casters) o.castShadow = shadows;
    }
    const lodScale = this.quality === 'low' ? 0.7 : 1;
    for (const { object, maxDistance } of t.objects) object.visible = t.distance <= maxDistance * lodScale;
  }

  private unload(key: string): void {
    const t = this.tiles.get(key);
    if (!t) return;
    this.tiles.delete(key);
    for (const { object } of t.objects) {
      this.root.remove(object);
      if (object instanceof THREE.InstancedMesh && object.name.startsWith('props:')) object.dispose();
    }
    for (const g of t.geometries) g.dispose();
    t.signals?.dispose();
  }

  // ---------------------------------------------------------------------------------
  // Traffic lights

  private updateSignals(cam: Vec2): void {
    const provider = this.provider;
    if (!provider) return;
    const blink = blinkOn(this.time);
    const cache = new Map<string, SignalState>();
    const stateOf = (id: string): SignalState => {
      let s = cache.get(id);
      if (s === undefined) {
        s = provider.stateOf(id);
        cache.set(id, s);
      }
      return s;
    };
    const reach = SIGNAL_UPDATE_RADIUS + this.tileSize;
    for (const t of this.tiles.values()) {
      if (!t.signals) continue;
      if (tileDistance(cam, t.content.ix, t.content.iz, this.tileSize) > reach) continue;
      t.signals.update(stateOf, blink, cam, SIGNAL_UPDATE_RADIUS);
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
