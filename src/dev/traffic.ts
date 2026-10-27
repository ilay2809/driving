/**
 * Dev harness for the traffic module (dev/traffic.html): the training ground with NPC traffic,
 * a 2D top-down canvas (lanes, signal-coloured stop lines, crossings, agents by state), a fake
 * keyboard-driven player, coach:request buttons and an optional three.js view that uses the
 * real TrafficRenderer.
 *
 * URL parameters (for Playwright): ?autorun=30 simulates 30 s as fast as possible before the
 * first frame, ?seed=7, ?density=1, ?peds=0.5, ?three=1 (start in the 3D view), ?player=x,z,h.
 * Exposes window.__trafficDebug = { time, vehicles, pedestrians, overlaps, redRuns, done, … }.
 */
import * as THREE from 'three';
import { EventBus } from '@/core/events';
import { DEFAULT_SETTINGS, defaultVehicleState, type SimContext } from '@/core/sim';
import { forwardOf, headingToRotationY, type Vec2 } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import type { SignalState } from '@/world/schema';
import { buildTrainingGround } from '@/world/testWorld';
import { SignalSystem } from '@/traffic/signals';
import { TrafficSystem } from '@/traffic/TrafficSystem';
import { TrafficRenderer } from '@/traffic/render';
import { localisePlayer } from '@/traffic/harness';
import { obbGap } from '@/traffic/util';
import type { TrafficAgentView } from '@/traffic/agents';
import { JUNCTION } from '@/traffic/constants';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

const STR = {
  pause: 'השהה',
  resume: 'המשך',
  followOn: 'עקוב אחרי הנהג ✓',
  followOff: 'עקוב אחרי הנהג',
  threeOn: 'תצוגה דו-ממדית',
  threeOff: 'תצוגה תלת-ממדית',
};

// ---------------------------------------------------------------------------------------------
// Simulation setup
// ---------------------------------------------------------------------------------------------
const world = buildTrainingGround();
const graph = new RoadGraph(world);
const bus = new EventBus();
let seed = num('seed', 1);
const signals = new SignalSystem(world, graph);
let traffic = new TrafficSystem(world, graph, bus, signals, { seed, density: num('density', 0.5), pedestrians: num('peds', 0.4), scooters: 0.3 });

const playerParam = params.get('player')?.split(',').map(Number);
const player = defaultVehicleState(playerParam && playerParam.length >= 2 ? [playerParam[0]!, playerParam[1]!] : [-100, 1.6], playerParam?.[2] ?? 0);
player.engineOn = true;
player.gear = 'D';
player.handbrake = false;
player.seatbelt = true;

const ctx: SimContext = {
  time: 0,
  dt: 0,
  mode: 'free',
  world,
  graph,
  bus,
  player,
  localisation: localisePlayer(graph, player),
  traffic: [],
  signals,
  env: { time: 0, hour: 10, weather: 'clear', wetRoad: false },
  settings: { ...DEFAULT_SETTINGS },
  coachPresent: false,
  timeScale: 1,
  paused: false,
};

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  keys.add(e.key);
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

/** Fake player: kinematic bicycle model driven by the arrow keys. */
function drivePlayer(dt: number): void {
  const accel = keys.has('ArrowUp') ? 2.5 : keys.has('ArrowDown') ? -4.5 : -0.6 * Math.sign(player.speed);
  player.speed = Math.max(-3, Math.min(16, player.speed + accel * dt));
  if (Math.abs(player.speed) < 0.05 && !keys.has('ArrowUp') && !keys.has('ArrowDown')) player.speed = 0;
  const steerTarget = keys.has('ArrowLeft') ? -1 : keys.has('ArrowRight') ? 1 : 0;
  player.steering += (steerTarget - player.steering) * Math.min(1, dt * 6);
  const delta = player.steering * 0.45;
  const yawRate = (player.speed / player.wheelbase) * Math.tan(delta);
  player.heading += yawRate * dt;
  player.yawRate = yawRate;
  const f = forwardOf(player.heading);
  player.pos = [player.pos[0] + f[0] * player.speed * dt, player.pos[1] + f[1] * player.speed * dt];
  player.accel = accel;
  player.throttle = keys.has('ArrowUp') ? 1 : 0;
  player.brake = keys.has('ArrowDown') ? 1 : 0;
  player.indicator = keys.has('ArrowLeft') ? 'left' : keys.has('ArrowRight') ? 'right' : 'off';
}

const debug = { time: 0, vehicles: 0, pedestrians: 0, overlaps: 0, redRuns: 0, disturbed: 0, nearMisses: 0, waitingPeds: 0, frames: 0, done: false, drawCalls: 0 };
(window as unknown as { __trafficDebug: typeof debug }).__trafficDebug = debug;
const prevSeg = new Map<string, string | undefined>();

function step(dt: number): void {
  ctx.dt = dt;
  ctx.time += dt;
  ctx.env.time = ctx.time;
  drivePlayer(dt);
  ctx.localisation = localisePlayer(graph, player);
  signals.update(ctx);
  traffic.update(ctx);
  // invariants for the debug readout
  const vehicles = ctx.traffic.filter((a) => a.kind !== 'pedestrian');
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i]!;
      const b = vehicles[j]!;
      if (Math.abs(a.pos[0] - b.pos[0]) > 20 || Math.abs(a.pos[1] - b.pos[1]) > 20) continue;
      if (obbGap({ pos: a.pos, heading: a.heading, length: a.length, width: a.width }, { pos: b.pos, heading: b.heading, length: b.length, width: b.width }) < -0.01) debug.overlaps++;
    }
  }
  for (const a of vehicles) {
    const seg = a.laneId ?? a.connectorId;
    const prev = prevSeg.get(a.id);
    if (prev && prev !== seg && a.connectorId) {
      const st = signals.stateForConnector(a.connectorId);
      if (st === 'red' || st === 'red_amber') debug.redRuns++;
    }
    prevSeg.set(a.id, seg);
    if (a.disturbedByPlayer) debug.disturbed++;
    if ((a as TrafficAgentView).nearMissWithPlayer) debug.nearMisses++;
  }
  debug.time = ctx.time;
  debug.vehicles = vehicles.length;
  debug.pedestrians = ctx.traffic.length - vehicles.length;
  debug.waitingPeds = ctx.traffic.filter((a) => a.pedState === 'waiting').length;
  debug.frames++;
}

// ---------------------------------------------------------------------------------------------
// 2D map
// ---------------------------------------------------------------------------------------------
const map = document.getElementById('map') as HTMLCanvasElement;
const mctx = map.getContext('2d')!;
let scale = 1.6; // px per metre
let centre: Vec2 = [(world.bbox.minX + world.bbox.maxX) / 2, (world.bbox.minZ + world.bbox.maxZ) / 2];
let follow = false;

map.addEventListener('wheel', (e) => {
  e.preventDefault();
  scale = Math.max(0.4, Math.min(12, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
});
let drag: { x: number; y: number; c: Vec2 } | undefined;
map.addEventListener('mousedown', (e) => (drag = { x: e.clientX, y: e.clientY, c: [centre[0], centre[1]] }));
window.addEventListener('mouseup', () => (drag = undefined));
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  centre = [drag.c[0] - (e.clientX - drag.x) / scale, drag.c[1] - (e.clientY - drag.y) / scale];
  follow = false;
});

const SIGNAL_COLOUR: Record<SignalState, string> = { red: '#e53935', red_amber: '#f57c00', green: '#43a047', flashing_green: '#9ccc65', amber: '#fdd835', flashing_amber: '#ffb300', off: '#777' };

function toScreen(p: Vec2): [number, number] {
  return [map.width / 2 + (p[0] - centre[0]) * scale, map.height / 2 + (p[1] - centre[1]) * scale];
}

function drawPolyline(pts: Vec2[], colour: string, width: number): void {
  mctx.beginPath();
  pts.forEach((p, i) => {
    const s = toScreen(p);
    if (i === 0) mctx.moveTo(s[0], s[1]);
    else mctx.lineTo(s[0], s[1]);
  });
  mctx.strokeStyle = colour;
  mctx.lineWidth = width;
  mctx.stroke();
}

function drawBox(pos: Vec2, heading: number, length: number, width: number, fill: string, stroke?: string): void {
  const s = toScreen(pos);
  mctx.save();
  mctx.translate(s[0], s[1]);
  mctx.rotate(heading);
  mctx.fillStyle = fill;
  mctx.fillRect((-length / 2) * scale, (-width / 2) * scale, length * scale, width * scale);
  if (stroke) {
    mctx.strokeStyle = stroke;
    mctx.lineWidth = 1.5;
    mctx.strokeRect((-length / 2) * scale, (-width / 2) * scale, length * scale, width * scale);
  }
  // nose marker
  mctx.fillStyle = 'rgba(255,255,255,0.7)';
  mctx.fillRect((length / 2 - 0.5) * scale, (-width / 2) * scale, 0.5 * scale, width * scale);
  mctx.restore();
}

function agentColour(a: TrafficAgentView): string {
  if (a.kind === 'bus') return '#42a5f5';
  if (a.kind === 'truck') return '#8d6e63';
  if (a.waiting) return '#e53935';
  if (a.yielding) return '#ef6c00';
  if (a.braking) return '#fdd835';
  if (a.badDriver) return '#ab47bc';
  return '#66bb6a';
}

function drawMap(): void {
  const w = map.clientWidth;
  const h = map.clientHeight;
  if (map.width !== w || map.height !== h) {
    map.width = w;
    map.height = h;
  }
  if (follow) centre = [player.pos[0], player.pos[1]];
  mctx.fillStyle = '#14171c';
  mctx.fillRect(0, 0, w, h);
  // roads
  for (const r of world.roads) drawPolyline(r.centre, '#2a2f38', Math.max(2, r.width * scale));
  for (const j of world.junctions) {
    if (!j.polygon) continue;
    mctx.beginPath();
    j.polygon.forEach((p, i) => {
      const s = toScreen(p);
      if (i === 0) mctx.moveTo(s[0], s[1]);
      else mctx.lineTo(s[0], s[1]);
    });
    mctx.closePath();
    mctx.fillStyle = '#2f3540';
    mctx.fill();
  }
  for (const l of world.lanes) drawPolyline(l.centre, l.kind === 'bus' ? '#8a7a2a' : '#3d4452', 1);
  for (const c of world.connectors) drawPolyline(c.path, 'rgba(90,100,120,0.5)', 1);
  // crossings
  for (const c of world.crossings) {
    drawPolyline([c.line[0], c.line[1]], c.kind === 'signals' ? '#9fa8da' : '#e0e0e0', Math.max(2, c.width * scale * 0.6));
    const st = signals.stateForCrossing(c.id);
    if (st) {
      const m = toScreen([(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2]);
      mctx.fillStyle = SIGNAL_COLOUR[st];
      mctx.beginPath();
      mctx.arc(m[0], m[1], 3, 0, Math.PI * 2);
      mctx.fill();
    }
  }
  // stop lines coloured by signal state
  for (const j of world.junctions) {
    for (const a of j.approaches) {
      if (!a.stopLine) continue;
      let colour = '#cfd8dc';
      if (a.signalGroup) colour = SIGNAL_COLOUR[signals.stateOf(a.signalGroup)];
      else if (a.control === 'stop') colour = '#ff8a80';
      else if (a.control === 'give_way' || a.control === 'roundabout_entry') colour = '#ffe082';
      else if (a.control === 'right_hand_rule') colour = '#80cbc4';
      drawPolyline([a.stopLine[0], a.stopLine[1]], colour, 3);
    }
  }
  // agents
  for (const a of ctx.traffic as readonly TrafficAgentView[]) {
    if (a.kind === 'pedestrian') {
      const s = toScreen(a.pos);
      mctx.fillStyle = a.pedState === 'crossing' ? '#ff5252' : a.pedState === 'waiting' ? '#ffd740' : '#eceff1';
      mctx.beginPath();
      mctx.arc(s[0], s[1], Math.max(2, 0.35 * scale), 0, Math.PI * 2);
      mctx.fill();
      continue;
    }
    drawBox(a.pos, a.heading, a.length, a.width, agentColour(a), a.indicator && a.indicator !== 'off' ? '#ffb300' : undefined);
    if (a.indicator && a.indicator !== 'off' && Math.floor(ctx.time * 2.5) % 2 === 0) {
      const s = toScreen(a.pos);
      mctx.fillStyle = '#ffb300';
      mctx.beginPath();
      mctx.arc(s[0], s[1], 2.5, 0, Math.PI * 2);
      mctx.fill();
    }
  }
  // player
  drawBox(player.pos, player.heading, player.length, player.width, '#29b6f6', '#ffffff');
}

// ---------------------------------------------------------------------------------------------
// three.js view (optional)
// ---------------------------------------------------------------------------------------------
const gl = document.getElementById('gl') as HTMLCanvasElement;
let three: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; traffic: TrafficRenderer; playerMesh: THREE.Mesh } | undefined;

function setupThree(): void {
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b4d8);
  scene.fog = new THREE.Fog(0x87b4d8, 250, 600);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 1000);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x556b2f, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(100, 160, -80);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0x6f8f4e }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);
  // road ribbons from lane centres
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
  for (const r of world.roads) {
    const shape = ribbon(r.centre, r.width);
    const mesh = new THREE.Mesh(shape, roadMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.0;
    scene.add(mesh);
  }
  const junctionMat = new THREE.MeshLambertMaterial({ color: 0x3f4248 });
  for (const j of world.junctions) {
    if (!j.polygon) continue;
    const sh = new THREE.Shape(j.polygon.map((p) => new THREE.Vector2(p[0], p[1])));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(sh), junctionMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.01;
    scene.add(mesh);
  }
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  for (const c of world.crossings) {
    const m = new THREE.Mesh(ribbon([c.line[0], c.line[1]], c.width), lineMat);
    m.rotation.x = Math.PI / 2;
    m.position.y = 0.02;
    scene.add(m);
  }
  const bMat = new THREE.MeshLambertMaterial({ color: 0xd9cdb8 });
  for (const b of world.buildings) {
    const sh = new THREE.Shape(b.footprint.map((p) => new THREE.Vector2(p[0], -p[1])));
    const g = new THREE.ExtrudeGeometry(sh, { depth: b.height, bevelEnabled: false });
    const mesh = new THREE.Mesh(g, bMat);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
  }
  const playerMesh = new THREE.Mesh(new THREE.BoxGeometry(player.width, 1.4, player.length), new THREE.MeshLambertMaterial({ color: 0x29b6f6 }));
  playerMesh.position.y = 0.7;
  scene.add(playerMesh);
  const trafficRenderer = new TrafficRenderer(scene);
  three = { renderer, scene, camera, traffic: trafficRenderer, playerMesh };
}

function ribbon(pts: Vec2[], width: number): THREE.BufferGeometry {
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const h = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const nx = -Math.sin(h) * (width / 2);
    const nz = Math.cos(h) * (width / 2);
    left.push(new THREE.Vector2(pts[i]![0] + nx, pts[i]![1] + nz));
    right.push(new THREE.Vector2(pts[i]![0] - nx, pts[i]![1] - nz));
  }
  const shape = new THREE.Shape([...left, ...right.reverse()]);
  return new THREE.ShapeGeometry(shape);
}

function drawThree(dt: number): void {
  if (!three) setupThree();
  const t = three!;
  const w = gl.clientWidth;
  const h = gl.clientHeight;
  if (gl.width !== w || gl.height !== h) {
    t.renderer.setSize(w, h, false);
    t.camera.aspect = w / h;
    t.camera.updateProjectionMatrix();
  }
  const f = forwardOf(player.heading);
  t.camera.position.set(player.pos[0] - f[0] * 14, 7, player.pos[1] - f[1] * 14);
  t.camera.lookAt(player.pos[0] + f[0] * 20, 1, player.pos[1] + f[1] * 20);
  t.playerMesh.position.set(player.pos[0], 0.7, player.pos[1]);
  t.playerMesh.rotation.y = headingToRotationY(player.heading);
  t.traffic.viewer = player.pos;
  t.traffic.update(ctx.traffic, dt);
  t.renderer.render(t.scene, t.camera);
  debug.drawCalls = t.renderer.info.render.calls;
}

// ---------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
let paused = false;
let threeMode = params.get('three') === '1';
document.body.classList.toggle('three', threeMode);
const densityInput = $<HTMLInputElement>('density');
const pedsInput = $<HTMLInputElement>('peds');
const scaleInput = $<HTMLInputElement>('scale');
densityInput.value = String(traffic.density);
pedsInput.value = String(traffic.pedestrianDensity);
$('densityVal').textContent = densityInput.value;
$('pedVal').textContent = pedsInput.value;
densityInput.oninput = () => {
  traffic.setDensity(Number(densityInput.value));
  $('densityVal').textContent = densityInput.value;
};
pedsInput.oninput = () => {
  traffic.setPedestrianDensity(Number(pedsInput.value));
  $('pedVal').textContent = pedsInput.value;
};
scaleInput.oninput = () => {
  ctx.timeScale = Number(scaleInput.value);
  $('scaleVal').textContent = scaleInput.value;
};
$('pause').onclick = () => {
  paused = !paused;
  $('pause').textContent = paused ? STR.resume : STR.pause;
};
$('follow').onclick = () => {
  follow = !follow;
  $('follow').textContent = follow ? STR.followOn : STR.followOff;
};
$('three').onclick = () => {
  threeMode = !threeMode;
  document.body.classList.toggle('three', threeMode);
  $('three').textContent = threeMode ? STR.threeOn : STR.threeOff;
};
$('reset').onclick = () => {
  seed = (seed * 7919 + 13) % 100000;
  traffic.dispose();
  traffic = new TrafficSystem(world, graph, bus, signals, { seed, density: Number(densityInput.value), pedestrians: Number(pedsInput.value), scooters: 0.3 });
  prevSeg.clear();
  debug.overlaps = 0;
  debug.redRuns = 0;
};
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-spawn]'))) {
  b.onclick = () => bus.emit('coach:request', { kind: 'spawn_vehicle', payload: { where: b.dataset['spawn'], distance: 50 } });
}
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-signal]'))) {
  b.onclick = () => bus.emit('coach:request', { kind: 'set_signal', payload: { state: b.dataset['signal'] } });
}
$('spawnPed').onclick = () => bus.emit('coach:request', { kind: 'spawn_pedestrian', payload: { nearest: true } });
$('clear').onclick = () => bus.emit('coach:request', { kind: 'clear_traffic', payload: {} });

function stats(): void {
  const st = traffic.stats;
  const hold = new Map<string, number>();
  for (const a of ctx.traffic as readonly TrafficAgentView[]) if (a.holdReason) hold.set(a.holdReason, (hold.get(a.holdReason) ?? 0) + 1);
  const loc = ctx.localisation;
  $('stats').textContent = [
    `t=${ctx.time.toFixed(1)}s  vehicles=${st.vehicles}  peds=${st.pedestrians}`,
    `spawned=${st.spawned} despawned=${st.despawned}`,
    `overlaps=${debug.overlaps} redRuns=${debug.redRuns}`,
    `disturbedByPlayer=${debug.disturbed} nearMiss=${debug.nearMisses}`,
    `holds: ${Array.from(hold.entries()).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}`,
    `player: ${(player.speed * 3.6).toFixed(0)} km/h lane=${loc.laneId ?? loc.connectorId ?? '-'} s=${loc.s.toFixed(0)}`,
    `ttc horizon=${JUNCTION.ttcHorizon}s  draw calls=${debug.drawCalls}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------------------------
const autorun = num('autorun', 0);
if (autorun > 0) {
  const n = Math.round(autorun * 30);
  for (let i = 0; i < n; i++) step(1 / 30);
}
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused && ctx.timeScale > 0) {
    acc += real * ctx.timeScale;
    let n = 0;
    while (acc >= 1 / 30 && n < 8) {
      step(1 / 30);
      acc -= 1 / 30;
      n++;
    }
  }
  if (threeMode) drawThree(real);
  else drawMap();
  stats();
  debug.done = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
