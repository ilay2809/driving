/**
 * Dev harness for the world renderer: dev/world-viewer.html
 *
 *   ?world=training-ground (default) | north-tlv   (fetches /world/north-tlv.json.gz)
 *   ?view=orbit (default, bird's eye) | driver&x=&z=&h=   driver's eye 1.2 m above (x, z) looking along heading h (rad)
 *   ?hour=12  ?weather=clear|rain|fog  ?quality=low|medium|high  ?signals=cycle|off
 *
 * Exposes window.__worldViewer for Playwright (ready promise, stats, setView, setHour).
 */
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/700.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SignalStateProvider } from '@/core/sim';
import { forwardOf } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import { WorldRenderer, type Quality, type Weather } from '@/world/render';
import { SIGNAL_TIMING, type SignalState, type WorldFile } from '@/world/schema';
import { buildTrainingGround } from '@/world/testWorld';
import { loadWorldFile } from './devWorldLoader';
import { DEV_STRINGS } from './strings.he';

const params = new URLSearchParams(location.search);
const num = (key: string, def: number): number => {
  const v = params.get(key);
  if (v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

/**
 * Fake signal provider: replays each controller's phases with the standard transitions
 * (green → flashing green → amber → all red → red+amber → next phase) from world time 0.
 */
export function createCyclingSignals(world: WorldFile, speed = 1): SignalStateProvider & { setTime(t: number): void } {
  let time = 0;
  const overrides = new Map<string, SignalState | undefined>();
  const groupToController = new Map<string, WorldFile['signals'][number]>();
  for (const c of world.signals) for (const g of c.groups) groupToController.set(g.id, c);
  const T = SIGNAL_TIMING;
  const slot = T.flashingGreen + T.amber + T.allRed + T.redAmber;
  const stateOf = (groupId: string): SignalState => {
    const o = overrides.get(groupId);
    if (o) return o;
    const c = groupToController.get(groupId);
    if (!c) return 'off';
    const cycle = c.phases.reduce((acc, p) => acc + p.duration + slot, 0);
    let t = (((time * speed + c.offset) % cycle) + cycle) % cycle;
    for (let i = 0; i < c.phases.length; i++) {
      const p = c.phases[i]!;
      const nextP = c.phases[(i + 1) % c.phases.length]!;
      const len = p.duration + slot;
      if (t < len) {
        const inThis = p.green.includes(groupId);
        const inNext = nextP.green.includes(groupId);
        if (t < p.duration) return inThis ? 'green' : 'red';
        t -= p.duration;
        if (t < T.flashingGreen) return inThis ? 'flashing_green' : 'red';
        t -= T.flashingGreen;
        if (t < T.amber) return inThis ? 'amber' : 'red';
        t -= T.amber;
        if (t < T.allRed) return 'red';
        return inNext ? 'red_amber' : 'red';
      }
      t -= len;
    }
    return 'red';
  };
  return {
    stateOf,
    stateForConnector: (id) => {
      const c = world.connectors.find((k) => k.id === id);
      return c?.signalGroup ? stateOf(c.signalGroup) : undefined;
    },
    stateForCrossing: (id) => {
      const c = world.crossings.find((k) => k.id === id);
      return c?.signalGroup ? stateOf(c.signalGroup) : undefined;
    },
    timeToChange: () => 0,
    override: (groupId, state) => overrides.set(groupId, state),
    setTime: (t) => {
      time = t;
    },
  };
}

async function main(): Promise<void> {
  const overlay = document.getElementById('overlay')!;
  const message = document.getElementById('message')!;
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const show = (text: string) => {
    message.textContent = text;
    message.classList.add('show');
  };
  show(DEV_STRINGS.worldViewer.loading);

  const worldName = params.get('world') ?? 'training-ground';
  let world: WorldFile | undefined;
  if (worldName === 'north-tlv') {
    world = await loadWorldFile(`${import.meta.env.BASE_URL}world/north-tlv.json.gz`);
    if (!world) {
      show(DEV_STRINGS.worldViewer.worldMissing);
      return;
    }
  } else if (worldName === 'stress') {
    const { buildStressWorld } = await import('./stressWorld');
    world = buildStressWorld();
  } else world = buildTrainingGround();
  const graph = new RoadGraph(world);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 4000);
  const quality = (params.get('quality') ?? 'medium') as Quality;
  const weather = (params.get('weather') ?? 'clear') as Weather;
  const hour = num('hour', 12);
  const wr = new WorldRenderer(scene, renderer, world, graph, { quality });
  wr.setTimeOfDay(hour);
  wr.setWeather(weather);

  const signals = createCyclingSignals(world, 1);
  if (params.get('signals') !== 'off') wr.setSignalProvider(signals);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.maxPolarAngle = Math.PI / 2 - 0.01;

  const b = world.bbox;
  const centre = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  const setView = (view: string, x = centre.x, z = centre.z, h = 0): void => {
    if (view === 'driver') {
      // ?y= eye height (1.2 m = driver's eye), ?ty= / ?td= height and distance of the look-at point
      const f = forwardOf(h);
      const td = num('td', 40);
      camera.position.set(x, num('y', 1.2), z);
      controls.target.set(x + f[0] * td, num('ty', 1.0), z + f[1] * td);
    } else {
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 200);
      const alt = num('alt', span * 0.5);
      camera.position.set(x, alt, z + alt * 0.64);
      controls.target.set(x, 0, z);
    }
    camera.lookAt(controls.target);
    controls.update();
  };
  setView(params.get('view') ?? 'orbit', num('x', centre.x), num('z', centre.z), num('h', 0));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // initial synchronous load so screenshots are complete on the first frame (?preload=0 streams instead)
  const t0 = performance.now();
  if (params.get('preload') !== '0') wr.preload(camera.position);
  const preloadMs = performance.now() - t0;
  message.classList.remove('show');

  let last = performance.now();
  let frameMs = 0;
  let buildMsMax = 0;
  let simTime = 0;
  let frames = 0;
  let ready = false;
  let resolveReady: () => void = () => undefined;
  const readyPromise = new Promise<void>((r) => (resolveReady = r));
  const stats = () => ({ ...wr.stats(), frameMs: Math.round(frameMs * 100) / 100, fps: frameMs > 0 ? Math.round(1000 / frameMs) : 0, buildMsMax: Math.round(buildMsMax * 10) / 10, preloadMs: Math.round(preloadMs), frames });
  const api = {
    renderer,
    scene,
    camera,
    world,
    worldRenderer: wr,
    signals,
    setView,
    setHour: (h: number) => wr.setTimeOfDay(h),
    setWeather: (w: Weather) => wr.setWeather(w),
    stats,
    get ready() {
      return ready;
    },
    readyPromise,
    renderOnce: () => renderer.render(scene, camera),
    dispose: () => wr.dispose(),
    resetStats: () => {
      wr.resetStats();
      buildMsMax = 0;
    },
  };
  (window as unknown as { __worldViewer: typeof api }).__worldViewer = api;

  const loop = (): void => {
    const t = performance.now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    simTime += dt;
    signals.setTime(simTime);
    controls.update();
    wr.update(camera.position, dt);
    buildMsMax = Math.max(buildMsMax, wr.stats().buildMs);
    const r0 = performance.now();
    renderer.render(scene, camera);
    frameMs = frameMs * 0.9 + (performance.now() - r0 + (r0 - t)) * 0.1;
    frames++;
    if (frames % 10 === 0) {
      const s = stats();
      overlay.textContent = `world: ${world.name}  tiles: ${s.tilesLoaded} (+${s.tilesPending} pending)\ndraw calls: ${s.drawCalls}  triangles: ${s.triangles.toLocaleString('en')}\nframe: ${s.frameMs} ms (${s.fps} fps)  build: ${s.buildMs.toFixed(1)} ms (max ${s.buildMsMax} ms, preload ${s.preloadMs} ms)\nslowest step: ${s.slowestStep.name} ${s.slowestStep.ms.toFixed(1)} ms\nhour: ${wr.timeOfDay}  weather: ${wr.currentWeather}  quality: ${wr.quality}\ncam: ${camera.position.x.toFixed(1)}, ${camera.position.z.toFixed(1)}`;
    }
    if (!ready && frames >= 3 && stats().tilesPending === 0) {
      ready = true;
      resolveReady();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((err) => {
  console.error(err);
  const message = document.getElementById('message');
  if (message) {
    message.textContent = String(err);
    message.classList.add('show');
  }
});
