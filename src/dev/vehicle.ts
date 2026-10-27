/**
 * Dev harness for the vehicle module: /dev/vehicle.html
 *
 * Draws the training ground minimally (lanes, markings, kerbs, sidewalks, buildings,
 * trees, lamps) plus a 100 m straight test road, spawns the player's car and runs
 * input → vehicle → camera → mirrors → render. An overlay shows the live state and
 * `window.__vehicleDebug` exposes it for Playwright.
 *
 * Query params:
 *   ?autodrive=1   scripted run (sim-time based): engine on, D, full throttle 1.0–5.0 s, then full brake
 *   ?chase=1       chase camera        ?night=1  night lighting (hour 21)
 *   ?lights=low|high|parking           ?indicator=left|right|hazard
 *   ?engine=1      engine running in D ?wipers=1 ?spawn=<spawnPointId> ?road=1 (straight test road)
 *   ?mirrors=0     disable mirrors     ?seatbelt=1
 */
import '@/ui/styles.css';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS, defaultVehicleState, emptyLocalisation, type SignalStateProvider, type SimContext } from '@/core/sim';
import type { Indicator, Lights } from '@/core/types';
import { densify, offsetPolyline, type Vec2 } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import type { WorldFile } from '@/world/schema';
import { buildTrainingGround } from '@/world/testWorld';
import { CameraRig, InputSystem, KEYMAP, MirrorSystem, PlayerVehicle, VehicleAudio, createPhysics, emptyInputState, kerbSegments, type InputState } from '@/vehicle';
import { KERB_HEIGHT, KERB_WIDTH, boxesAlongPolyline, type BoxSpec } from '@/vehicle/colliders';
import { KEY_LABELS_HE } from '@/vehicle/strings.he';

const params = new URLSearchParams(location.search);
const AUTODRIVE = params.get('autodrive') === '1';
const NIGHT = params.get('night') === '1';
const CHASE = params.get('chase') === '1';
const MIRRORS = params.get('mirrors') !== '0';
const ROAD = params.get('road') === '1';
const THROTTLE_START = 1.0;
const BRAKE_START = 5.0;
/** ?yaw=<deg>&pitch=<deg>: hold the head at a fixed look direction (screenshots of the mirrors). */
const FIXED_LOOK = params.has('yaw') || params.has('pitch') ? { lookYaw: Number(params.get('yaw') ?? 0) / 120, lookPitch: Number(params.get('pitch') ?? 0) / 40 } : null;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const help = document.getElementById('help')!;
const boot = document.getElementById('boot')!;

// ---- geometry helpers ------------------------------------------------------------------

function ribbon(pts: Vec2[], left: number, right: number, y: number): THREE.BufferGeometry {
  const a = offsetPolyline(pts, left);
  const b = offsetPolyline(pts, right);
  const n = Math.min(a.length, b.length);
  const pos = new Float32Array(n * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    pos.set([a[i]![0], y, a[i]![1]], i * 6);
    pos.set([b[i]![0], y, b[i]![1]], i * 6 + 3);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function polygon(poly: Vec2[], y: number): THREE.BufferGeometry {
  const v2 = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(v2, []);
  const pos = new Float32Array(poly.length * 3);
  poly.forEach((p, i) => pos.set([p[0], y, p[1]], i * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(tris.flat());
  g.computeVertexNormals();
  return g;
}

function dashed(pts: Vec2[], offset: number, halfWidth: number, y: number, on = 3, off = 6): THREE.BufferGeometry[] {
  const line = densify(offsetPolyline(pts, offset), 0.5);
  const out: THREE.BufferGeometry[] = [];
  let s = 0;
  let segStart: Vec2[] | null = null;
  for (let i = 0; i < line.length; i++) {
    const p = line[i]!;
    const phase = s % (on + off);
    if (phase < on) {
      if (!segStart) segStart = [];
      segStart.push(p);
    } else if (segStart) {
      if (segStart.length >= 2) out.push(ribbon(segStart, -halfWidth, halfWidth, y));
      segStart = null;
    }
    if (i < line.length - 1) s += Math.hypot(line[i + 1]![0] - p[0], line[i + 1]![1] - p[1]);
  }
  if (segStart && segStart.length >= 2) out.push(ribbon(segStart, -halfWidth, halfWidth, y));
  return out;
}

function boxGeometry(b: BoxSpec): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.half[0] * 2, b.half[1] * 2, b.half[2] * 2);
  g.rotateY(b.rotY);
  g.translate(b.centre[0], b.centre[1], b.centre[2]);
  return g;
}

function addMerged(scene: THREE.Scene, geos: THREE.BufferGeometry[], material: THREE.Material): void {
  if (geos.length === 0) return;
  // mergeGeometries needs identical attribute sets: keep position + normal only, non-indexed
  const bare = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    return n;
  });
  const merged = mergeGeometries(bare, false);
  if (!merged) return;
  const mesh = new THREE.Mesh(merged, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  for (const g of geos) g.dispose();
}

// ---- world drawing ------------------------------------------------------------------

function drawWorld(scene: THREE.Scene, world: WorldFile, graph: RoadGraph): void {
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.95, side: THREE.DoubleSide });
  const pavement = new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.95, side: THREE.DoubleSide });
  const kerbMat = new THREE.MeshStandardMaterial({ color: 0xc8c6c0, roughness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.8, side: THREE.DoubleSide });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe6c21a, roughness: 0.8, side: THREE.DoubleSide });
  const building = new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 0.9 });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 });
  const crown = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 1 });
  const pole = new THREE.MeshStandardMaterial({ color: 0x6d7278, roughness: 0.6, metalness: 0.5 });

  const lanes: THREE.BufferGeometry[] = [];
  const walks: THREE.BufferGeometry[] = [];
  const whites: THREE.BufferGeometry[] = [];
  const yellows: THREE.BufferGeometry[] = [];
  for (const lane of world.lanes) {
    const hw = lane.width / 2;
    lanes.push(ribbon(lane.centre, -hw - 0.05, hw + 0.05, 0.005));
    if (lane.rightLine === 'kerb') walks.push(ribbon(lane.centre, hw + KERB_WIDTH, hw + 3.2, 0.1));
    if (lane.leftLine === 'kerb' && lane.index === 0) walks.push(ribbon(lane.centre, -hw - 3.2, -hw - KERB_WIDTH, 0.1));
    const l = lane.leftLine;
    if (l === 'solid' || l === 'double_solid' || l === 'solid_dashed') whites.push(ribbon(lane.centre, -hw - 0.08, -hw + 0.08, 0.012));
    else if (l === 'yellow_solid') yellows.push(ribbon(lane.centre, -hw - 0.08, -hw + 0.08, 0.012));
    else if (l === 'dashed' || l === 'dashed_solid') whites.push(...dashed(lane.centre, -hw, 0.07, 0.012));
  }
  for (const j of world.junctions) {
    if (j.polygon && j.polygon.length >= 3) lanes.push(polygon(j.polygon, 0.004));
    for (const a of j.approaches) {
      if (a.stopLine) whites.push(ribbon([a.stopLine[0], a.stopLine[1]], -0.2, 0.2, 0.013));
    }
  }
  for (const c of world.crossings) {
    const [a, b] = c.line;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    for (let s = 0.3; s < len - 0.3; s += 1.0) {
      const p: Vec2 = [a[0] + d[0] * s, a[1] + d[1] * s];
      const q: Vec2 = [a[0] + d[0] * (s + 0.5), a[1] + d[1] * (s + 0.5)];
      whites.push(ribbon([p, q], -c.width / 2, c.width / 2, 0.013));
    }
  }
  addMerged(scene, lanes, asphalt);
  addMerged(scene, walks, pavement);
  addMerged(scene, whites, white);
  addMerged(scene, yellows, yellow);
  addMerged(scene, kerbSegments(world).map(boxGeometry), kerbMat);

  const builds: THREE.BufferGeometry[] = [];
  for (const b of world.buildings) {
    const shape = new THREE.Shape(b.footprint.map((p) => new THREE.Vector2(p[0], -p[1])));
    const g = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    builds.push(g);
  }
  addMerged(scene, builds, building);

  const trunks: THREE.BufferGeometry[] = [];
  const crowns: THREE.BufferGeometry[] = [];
  const poles: THREE.BufferGeometry[] = [];
  for (const p of world.props) {
    if (p.kind === 'tree') {
      trunks.push(new THREE.CylinderGeometry(0.18, 0.22, 3, 7).translate(p.pos[0], 1.5, p.pos[1]));
      crowns.push(new THREE.SphereGeometry(2.2, 8, 6).translate(p.pos[0], 4.2, p.pos[1]));
    } else if (p.kind === 'lamp') {
      poles.push(new THREE.CylinderGeometry(0.08, 0.12, 6, 6).translate(p.pos[0], 3, p.pos[1]));
      poles.push(new THREE.BoxGeometry(0.5, 0.15, 0.25).translate(p.pos[0], 6, p.pos[1]));
    } else if (p.kind === 'bus_stop') {
      poles.push(new THREE.CylinderGeometry(0.06, 0.06, 3, 6).translate(p.pos[0], 1.5, p.pos[1]));
      poles.push(new THREE.BoxGeometry(0.6, 0.4, 0.05).translate(p.pos[0], 2.6, p.pos[1]));
    } else if (p.kind === 'speed_bump') {
      const road = p.roadId ? graph.roads.get(p.roadId) : undefined;
      lanes.push(new THREE.BoxGeometry(road?.width ?? 6, 0.07, 0.4).rotateY(-Math.PI / 2 - p.heading).translate(p.pos[0], 0.035, p.pos[1]));
    }
  }
  addMerged(scene, trunks, trunk);
  addMerged(scene, crowns, crown);
  addMerged(scene, poles, pole);
}

/** A 100 m straight road south of the training ground (east–west at z = 400). */
function drawTestRoad(scene: THREE.Scene): BoxSpec[] {
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.95, side: THREE.DoubleSide });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.8, side: THREE.DoubleSide });
  const kerbMat = new THREE.MeshStandardMaterial({ color: 0xc8c6c0, roughness: 0.9 });
  const centre: Vec2[] = [
    [-70, 400],
    [70, 400],
  ];
  scene.add(new THREE.Mesh(ribbon(centre, -3.5, 3.5, 0.005), asphalt));
  addMerged(scene, dashed(centre, 0, 0.07, 0.012), white);
  const kerbs = [...boxesAlongPolyline(offsetPolyline(centre, 3.5 + KERB_WIDTH / 2), 'road:r', 'kerb', KERB_WIDTH / 2, KERB_HEIGHT), ...boxesAlongPolyline(offsetPolyline(centre, -3.5 - KERB_WIDTH / 2), 'road:l', 'kerb', KERB_WIDTH / 2, KERB_HEIGHT)];
  addMerged(scene, kerbs.map(boxGeometry), kerbMat);
  return kerbs;
}

// ---- main -------------------------------------------------------------------------------

const signalsStub: SignalStateProvider = {
  stateOf: () => 'off',
  stateForConnector: () => undefined,
  stateForCrossing: () => undefined,
  timeToChange: () => 0,
  override: () => undefined,
};

async function main(): Promise<void> {
  const world = buildTrainingGround();
  const graph = new RoadGraph(world);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = NIGHT ? 0.9 : 1.05;

  const scene = new THREE.Scene();
  const sky = NIGHT ? 0x070a14 : 0x8fc0ee;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, NIGHT ? 60 : 200, NIGHT ? 350 : 1100);
  const hemi = new THREE.HemisphereLight(NIGHT ? 0x1b2744 : 0xcfe3ff, NIGHT ? 0x05060a : 0x6f7a58, NIGHT ? 0.35 : 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(NIGHT ? 0x8ea2d6 : 0xfff1dc, NIGHT ? 0.18 : 2.4);
  sun.position.set(120, 180, 70);
  scene.add(sun);
  // subdivided: one 4 km triangle crossing the near plane loses depth precision in software GL
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 80, 80), new THREE.MeshStandardMaterial({ color: NIGHT ? 0x27331f : 0x5e8a43, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.04;
  scene.add(ground);
  drawWorld(scene, world, graph);
  const roadKerbs = drawTestRoad(scene);

  const physics = await createPhysics();
  physics.addGroundPlane();
  physics.addWorldColliders(world);
  physics.addStaticSpecs(roadKerbs);

  const bus = new EventBus();
  const settings = { ...DEFAULT_SETTINGS, mirrors: MIRRORS };
  const spawnId = params.get('spawn') ?? 'tg_start';
  const sp = graph.spawnPoints.get(spawnId) ?? graph.spawnPoints.get('tg_start')!;
  const spawn = ROAD ? { pos: [-50, 401.75] as Vec2, heading: 0 } : { pos: sp.pos, heading: sp.heading };
  const engineOn = params.get('engine') === '1' || AUTODRIVE === false && params.has('lights');
  const vehicle = new PlayerVehicle(physics, scene, bus, spawn, {
    colour: 0x2f6fde,
    spawn: { engineOn, gear: engineOn ? 'D' : 'P', handbrake: !engineOn, seatbelt: params.get('seatbelt') === '1' },
  });
  const lights = params.get('lights') as Lights | null;
  if (lights === 'low' || lights === 'high' || lights === 'parking') vehicle.body.setLights(lights);
  if (params.get('wipers') === '1') vehicle.body.toggleWipers();
  const ind = params.get('indicator') as Indicator | null;

  // cones: pushable obstacles (two near the spawn, three on the test road)
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.7 });
  const coneGeo = new THREE.ConeGeometry(0.22, 0.7, 10);
  const cones: { body: ReturnType<typeof physics.addDynamicObstacle>; mesh: THREE.Mesh }[] = [];
  const conePositions: Vec2[] = ROAD ? [[-20, 399], [-5, 402.5], [10, 400.5]] : [[spawn.pos[0] + 1.2, spawn.pos[1] + 25], [spawn.pos[0] - 1.0, spawn.pos[1] + 40]];
  for (const [x, z] of conePositions) {
    const body = physics.addDynamicObstacle([x, 0.36, z], [0.4, 0.7, 0.4], { mass: 2 });
    const mesh = new THREE.Mesh(coneGeo, coneMat);
    scene.add(mesh);
    cones.push({ body, mesh });
  }

  const input = new InputSystem(canvas, bus, settings);
  vehicle.bindInput(AUTODRIVE || ind ? null : input); // with ?indicator= the first frame is scripted
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2500);
  const rig = new CameraRig(camera, { originHeight: vehicle.body.restHeight });
  if (CHASE) rig.toggleChase();
  const mirrors = new MirrorSystem({ enabled: MIRRORS });
  mirrors.attach(vehicle.model.mirrorGlass, vehicle.model.root);
  const audio = new VehicleAudio(settings, bus);

  const ctx: SimContext = {
    time: 0,
    dt: 0,
    mode: 'free',
    world,
    graph,
    bus,
    player: defaultVehicleState([spawn.pos[0], spawn.pos[1]], spawn.heading),
    localisation: emptyLocalisation(),
    traffic: [],
    signals: signalsStub,
    env: { time: 0, hour: NIGHT ? 21 : 11, weather: 'clear', wetRoad: false },
    settings,
    coachPresent: false,
    timeScale: 1,
    paused: false,
  };

  // event log for the overlay
  const events: string[] = [];
  const log = (s: string) => {
    events.unshift(`${ctx.time.toFixed(1)}s ${s}`);
    if (events.length > 4) events.pop();
  };
  bus.on('vehicle:gear', (e) => log(`gear → ${e.gear}`));
  bus.on('vehicle:indicator', (e) => log(`indicator → ${e.indicator}`));
  bus.on('vehicle:collision', (e) => log(`collision ${e.with} ${e.impulse.toFixed(0)} N·s`));
  bus.on('vehicle:horn', () => log('horn'));
  bus.on('input:glance', (e) => log(`glance ${e.target}`));

  help.innerHTML = KEYMAP.map((k) => `<kbd>${k.keys.map((key) => KEY_LABELS_HE[key] ?? key.replace(/^Key|^Digit/, '')).join(' / ')}</kbd> ${k.labelHe}`).join('<br>');
  boot.remove();

  // scripted drive (sim-time based so SwiftShader frame rates do not matter)
  const script = emptyInputState();
  let scriptPhase = 'start';
  let pulsed = { ignition: false, gear: false, indicator: false };
  const autodrive = (t: number): InputState => {
    const s = script;
    s.ignitionToggle = false;
    s.gearRequest = undefined;
    s.indicatorRequest = undefined;
    if (t < 0.5) {
      s.brake = 1;
      scriptPhase = 'start';
    } else if (t < 0.8) {
      if (!pulsed.ignition) {
        s.ignitionToggle = true;
        pulsed.ignition = true;
      }
    } else if (t < THROTTLE_START) {
      if (!pulsed.gear) {
        s.gearRequest = 'D';
        pulsed.gear = true;
      }
      s.handbrake = false;
    } else if (t < BRAKE_START) {
      s.brake = 0;
      s.throttle = 1;
      scriptPhase = 'accelerate';
    } else {
      s.throttle = 0;
      s.brake = 1;
      scriptPhase = 'brake';
    }
    return s;
  };
  if (ind && !AUTODRIVE) {
    // one-frame request on the first update
    const once = emptyInputState();
    once.indicatorRequest = ind;
    once.handbrake = vehicle.state.handbrake;
    vehicle.setInput(once);
    pulsed = { ...pulsed, indicator: true };
  }

  const debug: Record<string, unknown> = {};
  (window as unknown as { __vehicleDebug: Record<string, unknown> }).__vehicleDebug = debug;
  (window as unknown as { __vehicle: unknown }).__vehicle = { vehicle, rig, mirrors, physics, ctx, input };

  let last = performance.now();
  let frames = 0;
  let fps = 0;
  let fpsAt = last;
  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  const frame = (now: number) => {
    // clamp to the FixedStep budget (4 × 1/60 s) so simulation time never outruns the physics
    // on very slow frames (SwiftShader in CI renders at a few fps)
    const dt = Math.min(4 / 60, Math.max(0, (now - last) / 1000));
    last = now;
    ctx.dt = dt;
    ctx.time += dt;
    ctx.env.time = ctx.time;
    if (AUTODRIVE) vehicle.setInput(autodrive(ctx.time));
    else input.update(ctx);
    vehicle.update(ctx);
    if (ind && pulsed.indicator) {
      // the one-frame indicator request has been consumed → hand control to the InputSystem
      vehicle.setInput(null);
      vehicle.bindInput(input);
      pulsed.indicator = false;
    }
    rig.update(dt, ctx.player, FIXED_LOOK ?? (AUTODRIVE ? { lookYaw: 0, lookPitch: 0 } : input.state), vehicle.pose);
    for (const c of cones) {
      const t = c.body.translation();
      const q = c.body.rotation();
      c.mesh.position.set(t.x, t.y, t.z);
      c.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    mirrors.render(renderer, scene);
    renderer.render(scene, camera);
    audio.update(ctx.player, { slip: vehicle.body.slip, time: ctx.time, indicatorSince: vehicle.body.indicators.since });

    frames++;
    if (now - fpsAt > 1000) {
      fps = (frames * 1000) / (now - fpsAt);
      frames = 0;
      fpsAt = now;
    }
    const p = ctx.player;
    const kmh = p.speed * 3.6;
    Object.assign(debug, {
      time: ctx.time,
      speedKmh: kmh,
      rpm: p.rpm,
      gear: p.gear,
      autoGear: vehicle.body.drivetrain.gearIndex,
      throttle: p.throttle,
      brake: p.brake,
      steer: p.steering,
      indicator: p.indicator,
      lights: p.lights,
      engineOn: p.engineOn,
      handbrake: p.handbrake,
      pos: [p.pos[0], p.pos[1]],
      heading: p.heading,
      phase: scriptPhase,
      throttleStart: THROTTLE_START,
      brakeStart: BRAKE_START,
      colliders: physics.activeColliderCount,
      fps,
      mode: rig.mode,
      source: input.state.source,
      slip: vehicle.body.slip,
    });
    overlay.innerHTML =
      `<b>speed</b> ${kmh.toFixed(1)} km/h<br>` +
      `<b>rpm</b> ${p.rpm.toFixed(0)}<br>` +
      `<b>gear</b> ${p.gear}${p.gear === 'D' ? vehicle.body.drivetrain.gearIndex : ''} · engine ${p.engineOn ? 'on' : 'off'}<br>` +
      `<b>pedals</b> gas ${(p.throttle * 100).toFixed(0)}% · brake ${(p.brake * 100).toFixed(0)}% ${p.handbrake ? '· HB' : ''}<br>` +
      `<b>steer</b> ${(p.steering * 100).toFixed(0)}% · yaw ${((p.yawRate * 180) / Math.PI).toFixed(0)}°/s<br>` +
      `<b>indicator</b> ${p.indicator} · lights ${p.lights}${p.wipers ? ' · wipers' : ''}${p.seatbelt ? ' · belt' : ''}<br>` +
      `<b>pos</b> ${p.pos[0].toFixed(1)}, ${p.pos[1].toFixed(1)} · h ${((p.heading * 180) / Math.PI).toFixed(0)}°<br>` +
      `<b>fps</b> ${fps.toFixed(0)} · colliders ${physics.activeColliderCount} · slip ${vehicle.body.slip.toFixed(2)}<br>` +
      `<b>input</b> ${AUTODRIVE ? `script:${scriptPhase}` : input.state.source} · cam ${rig.mode}<br>` +
      events.map((e) => `<span style="color:#9aa7b4">${e}</span>`).join('<br>');
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  boot.textContent = `שגיאה: ${String(err)}`;
});

export {};
