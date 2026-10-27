/**
 * Everything that lives while a world is loaded and the player is driving:
 * world + graph, physics, player vehicle, camera/mirrors/audio, traffic & signals,
 * world renderer, rules engine, dialogue/navigation and the active coach persona.
 *
 * Modes (lesson / free / test / training ground) build a session, add their own
 * systems (Instructor, Examiner, LessonRunner) and dispose it when they end.
 */
import * as THREE from 'three';
import type { EventBus } from '@/core/events';
import { GameLoop } from '@/core/loop';
import { defaultVehicleState, emptyLocalisation, type Settings, type SimContext, type System } from '@/core/sim';
import type { EnvironmentState, SimMode, VehicleState } from '@/core/types';
import { RoadGraph } from '@/world/graph';
import { loadTrainingGround, loadWorld } from '@/world/loader';
import type { SpawnPoint, WorldFile } from '@/world/schema';
import { WorldRenderer } from '@/world/render';
import { createPhysics, PlayerVehicle, InputSystem, CameraRig, MirrorSystem, VehicleAudio, type PhysicsWorld } from '@/vehicle';
import { SignalSystem, TrafficSystem, TrafficRenderer } from '@/traffic';
import { Judge, Localiser } from '@/rules';
import { DialogueManager, Navigator, type Profile } from '@/coach';
import type { UISystem } from '@/ui';

export type WorldName = 'north-tlv' | 'training-ground';

export interface SessionOptions {
  world: WorldName;
  mode: SimMode;
  /** Spawn point id, or an explicit pose. */
  spawn: string | { pos: [number, number]; heading: number };
  coachPresent: boolean;
  traffic: { density: number; pedestrians: number; seed: number };
  hour: number;
  weather: EnvironmentState['weather'];
  onProgress?: (progress: number, label: string) => void;
}

export interface SessionDeps {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  bus: EventBus;
  settings: Settings;
  profile: Profile;
  ui: UISystem;
}

const worldCache = new Map<WorldName, Promise<WorldFile>>();

export function getWorld(name: WorldName): Promise<WorldFile> {
  let p = worldCache.get(name);
  if (!p) {
    p = name === 'training-ground' ? Promise.resolve(loadTrainingGround()) : loadWorld();
    p.catch(() => worldCache.delete(name));
    worldCache.set(name, p);
  }
  return p;
}

export class WorldSession {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly ctx: SimContext;
  readonly loop: GameLoop;
  readonly systems: System[] = [];
  /** Systems a mode adds after the core ones (coach persona, lesson runner); run before UI. */
  readonly modeSystems: System[] = [];

  readonly physics: PhysicsWorld;
  readonly vehicle: PlayerVehicle;
  readonly input: InputSystem;
  readonly cameraRig: CameraRig;
  readonly mirrors: MirrorSystem;
  readonly audio: VehicleAudio;
  readonly signals: SignalSystem;
  readonly traffic: TrafficSystem;
  readonly trafficRenderer: TrafficRenderer;
  readonly worldRenderer: WorldRenderer;
  readonly localiser: Localiser;
  readonly judge: Judge;
  readonly dialogue: DialogueManager;
  readonly navigator: Navigator;
  readonly spawn: { pos: [number, number]; heading: number; point?: SpawnPoint };

  private disposers: (() => void)[] = [];
  private disposed = false;

  private constructor(
    readonly deps: SessionDeps,
    readonly opts: SessionOptions,
    readonly world: WorldFile,
    readonly graph: RoadGraph,
    physics: PhysicsWorld,
  ) {
    const { renderer, bus, settings, canvas } = deps;
    this.physics = physics;
    this.spawn = resolveSpawn(world, graph, opts.spawn);

    this.camera = new THREE.PerspectiveCamera(70, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 2500);

    const player: VehicleState = defaultVehicleState(this.spawn.pos, this.spawn.heading);
    this.ctx = {
      time: 0,
      dt: 0,
      mode: opts.mode,
      world,
      graph,
      bus,
      player,
      localisation: emptyLocalisation(),
      traffic: [],
      signals: undefined as unknown as SignalSystem,
      env: { time: 0, hour: opts.hour, weather: opts.weather, wetRoad: opts.weather === 'rain' },
      settings,
      coachPresent: opts.coachPresent,
      timeScale: 1,
      paused: false,
    };

    // --- world rendering -------------------------------------------------------
    this.worldRenderer = new WorldRenderer(this.scene, renderer, world, graph, { quality: settings.quality });
    this.worldRenderer.setTimeOfDay(opts.hour);
    this.worldRenderer.setWeather(opts.weather);

    // --- player car -------------------------------------------------------------
    physics.addGroundPlane();
    physics.addWorldColliders(world);
    this.vehicle = new PlayerVehicle(physics, this.scene, bus, { pos: this.spawn.pos, heading: this.spawn.heading });
    this.input = new InputSystem(canvas, bus, settings);
    this.vehicle.bindInput(this.input);
    this.cameraRig = new CameraRig(this.camera, { originHeight: this.vehicle.body.restHeight });
    this.mirrors = new MirrorSystem({ enabled: settings.mirrors });
    this.mirrors.attach(this.vehicle.model.mirrorGlass, this.vehicle.model.root);
    this.audio = new VehicleAudio(settings, bus);

    // --- traffic ------------------------------------------------------------------
    this.signals = new SignalSystem(world, graph);
    this.signals.attach(bus);
    this.ctx.signals = this.signals;
    this.worldRenderer.setSignalProvider(this.signals);
    this.traffic = new TrafficSystem(world, graph, bus, this.signals, { seed: opts.traffic.seed, density: opts.traffic.density, pedestrians: opts.traffic.pedestrians, scooters: 0.1 });
    this.traffic.attach(bus);
    this.trafficRenderer = new TrafficRenderer(this.scene);

    // --- rules + coach core -----------------------------------------------------------
    this.localiser = new Localiser(graph);
    this.judge = new Judge(graph, bus, { coachPresent: opts.coachPresent });
    this.dialogue = new DialogueManager(bus, settings);
    this.navigator = new Navigator(graph, bus, this.dialogue);

    const trafficBridge: System = {
      name: 'traffic-bridge',
      update: (ctx) => {
        this.traffic.update(ctx);
        (ctx as { traffic: SimContext['traffic'] }).traffic = this.traffic.agents;
      },
    };
    const profileSystem: System = { name: 'profile', update: (ctx) => deps.profile.update(ctx) };
    const uiSystem: System = { name: 'ui', update: (ctx) => deps.ui.update(ctx) };
    const modeBridge: System = {
      name: 'mode-systems',
      update: (ctx) => {
        for (const s of this.modeSystems) s.update(ctx);
      },
    };
    this.systems.push(this.input, this.vehicle, this.localiser, this.signals, trafficBridge, this.judge, this.dialogue, this.navigator, modeBridge, profileSystem, uiSystem);

    this.loop = new GameLoop(this.ctx, this.systems, (ctx) => this.render(ctx));

    // explain-here key ('?' or '/') is handled by the active coach via this hook
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' || e.key === '/') this.onExplain?.(this.ctx);
    };
    window.addEventListener('keydown', onKey);
    this.disposers.push(() => window.removeEventListener('keydown', onKey));

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.disposers.push(() => window.removeEventListener('resize', onResize));
    this.resize();
  }

  /** Set by the mode: what to do when the player asks for an explanation. */
  onExplain?: (ctx: SimContext) => void;

  static async create(deps: SessionDeps, opts: SessionOptions): Promise<WorldSession> {
    const progress = opts.onProgress ?? (() => {});
    progress(0.05, 'טוען את העולם…');
    const world = await getWorld(opts.world);
    progress(0.35, 'בונה את רשת הכבישים…');
    const graph = new RoadGraph(world);
    progress(0.5, 'מפעיל פיזיקה…');
    const physics = await createPhysics();
    progress(0.6, 'בונה את הסביבה…');
    const session = new WorldSession(deps, opts, world, graph, physics);
    // Build the tiles around the spawn before the first frame so the player does not see an empty world.
    session.worldRenderer.preload(new THREE.Vector3(session.spawn.pos[0], 1.5, session.spawn.pos[1]));
    progress(0.9, 'מכין את הרכב…');
    await session.dialogue.lines.load().catch(() => undefined);
    progress(1, 'מוכן');
    return session;
  }

  start(): void {
    this.deps.ui.setMode(this.opts.mode);
    this.loop.start();
  }

  setPaused(paused: boolean): void {
    this.loop.setPaused(paused);
  }

  get paused(): boolean {
    return this.ctx.paused;
  }

  setTimeOfDay(hour: number): void {
    this.ctx.env.hour = hour;
    this.worldRenderer.setTimeOfDay(hour);
  }

  setWeather(weather: EnvironmentState['weather']): void {
    this.ctx.env.weather = weather;
    this.ctx.env.wetRoad = weather === 'rain';
    this.worldRenderer.setWeather(weather);
  }

  applySettings(settings: Settings): void {
    this.mirrors.setEnabled(settings.mirrors);
    this.audio.setVolume(settings.volume);
  }

  private resize(): void {
    const { canvas, renderer } = this.deps;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private render(ctx: SimContext): void {
    if (this.disposed) return;
    const { renderer } = this.deps;
    this.cameraRig.update(ctx.dt, ctx.player, this.input.state, this.vehicle.pose);
    this.worldRenderer.update(this.camera.position, ctx.dt);
    this.trafficRenderer.update(this.traffic.agents, ctx.dt);
    if (!ctx.paused) this.mirrors.render(renderer, this.scene);
    renderer.render(this.scene, this.camera);
    this.audio.update(ctx.player, { slip: this.vehicle.body.slip, time: ctx.time, indicatorSince: this.vehicle.body.indicators.since });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    for (const d of this.disposers) d();
    for (const s of [...this.modeSystems, ...this.systems]) s.dispose?.();
    this.navigator.dispose?.();
    this.dialogue.dispose?.();
    this.judge.dispose?.();
    this.traffic.dispose();
    this.signals.dispose();
    this.trafficRenderer.dispose();
    this.worldRenderer.dispose();
    this.mirrors.dispose();
    this.audio.dispose();
    this.input.dispose();
    this.vehicle.dispose();
    this.physics.dispose();
    this.scene.clear();
  }
}

export function resolveSpawn(world: WorldFile, graph: RoadGraph, spawn: SessionOptions['spawn']): { pos: [number, number]; heading: number; point?: SpawnPoint } {
  if (typeof spawn !== 'string') return { pos: spawn.pos, heading: spawn.heading };
  const point = world.spawnPoints.find((s) => s.id === spawn) ?? world.spawnPoints[0];
  if (!point) {
    const lane = world.lanes[0]!;
    return { pos: lane.centre[0]!, heading: Math.atan2(lane.centre[1]![1] - lane.centre[0]![1], lane.centre[1]![0] - lane.centre[0]![0]) };
  }
  // snap to the lane centre so the car starts aligned with the road
  const m = graph.nearestLane(point.pos, { heading: point.heading, maxDist: 8 });
  if (m && m.distance < 6) {
    const at = graph.laneAt(m.lane.id, m.s);
    return { pos: at.p, heading: at.h, point };
  }
  return { pos: point.pos, heading: point.heading, point };
}

/** Lane id a spawn point sits on (for routing). */
export function spawnLane(graph: RoadGraph, pos: [number, number], heading: number): string | undefined {
  return graph.nearestLane(pos, { heading, maxDist: 10 })?.lane.id;
}
