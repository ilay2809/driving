/**
 * Dev harness for the coach module (dev/coach.html): drives a car along the training-ground
 * tour with an auto-driver and shows what the coach emits — subtitles with their timing,
 * the speech queue, the navigation HUD, interventions and the event log — on a 2-D map.
 * Instructor mode (free drive) or examiner mode (test). The simulation is deterministic and
 * can be driven from Playwright through `window.__coach.step(seconds)`.
 */
import '@fontsource/heebo/400.css';
import '@fontsource/heebo/700.css';
import type { NavInstruction, SpeechRequest } from '@/core/events';
import type { System } from '@/core/sim';
import { forwardOf, type Vec2 } from '@/world/geo';
import { DialogueManager, Examiner, Instructor, Navigator, RouteModel, SilentTts, WebSpeechTts } from '@/coach';
import { createTestContext, type TestContext } from '@/coach/testUtils';

type Mode = 'instructor' | 'examiner';

interface Harness {
  t: TestContext;
  dialogue: DialogueManager;
  navigator: Navigator;
  instructor?: Instructor;
  examiner?: Examiner;
  route: RouteModel;
  systems: System[];
  mode: Mode;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map');
const subtitleEl = $<HTMLDivElement>('subtitle');
const hudEl = $<HTMLDivElement>('hud');
const speedEl = $<HTMLDivElement>('speed');
const interventionEl = $<HTMLDivElement>('intervention');
const queueEl = $<HTMLUListElement>('queue');
const logEl = $<HTMLUListElement>('log');
const statsEl = $<HTMLDivElement>('stats');
const modeSel = $<HTMLSelectElement>('mode');
const ttsBox = $<HTMLInputElement>('tts');
const speedRange = $<HTMLInputElement>('speed-range');

const KIND_ICON: Record<string, string> = { turn_left: '⬅', turn_right: '➡', straight: '⬆', roundabout_exit: '🔄', uturn: '↩', arrive: '🏁', pull_over: '🅿', reverse: '◀', park: '🅿', stop_here: '⏹' };

let h: Harness;
let running = false;
let targetSpeed = 40 / 3.6;
let currentSpeed = 0;
let stopUntil = -1;
let reverseLeft = 0;
let interventionUntil = -1;
let subtitleShownAt = -1;
const log: string[] = [];
let instruction: NavInstruction | undefined;
let lastSubtitle: SpeechRequest | undefined;

function addLog(text: string): void {
  const stamp = h ? h.t.ctx.time.toFixed(1).padStart(6) : '0.0';
  log.unshift(`${stamp}s  ${text}`);
  if (log.length > 40) log.pop();
}

function build(mode: Mode): Harness {
  const t = createTestContext({ mode: mode === 'examiner' ? 'test' : 'free', settings: { tts: ttsBox.checked } });
  const dialogue = new DialogueManager(t.bus, t.settings, { tts: ttsBox.checked ? new WebSpeechTts() : new SilentTts() });
  const navigator = new Navigator(t.graph, t.bus, dialogue);
  const tour = t.world.routes.find((r) => r.id === 'tg_tour')!;
  const path = t.graph.routeViaJunctions('r00_01:f0', tour.waypoints)!;
  const route = new RouteModel(t.graph, path);
  const systems: System[] = [];
  let instructor: Instructor | undefined;
  let examiner: Examiner | undefined;
  if (mode === 'examiner') {
    examiner = new Examiner(t.bus, dialogue, t.graph, navigator, { route: path, routeId: 'tg_tour' });
    systems.push(examiner);
  } else {
    instructor = new Instructor(t.bus, dialogue, t.graph, { navigator, verbosity: 'high' });
    navigator.setRoute(path, { speak: true, who: 'instructor' });
    systems.push(instructor);
  }
  systems.push(navigator, dialogue);
  t.placeOnRoute(route, 29.5, 0);
  t.bus.on('coach:say', (req) => {
    lastSubtitle = req;
    subtitleShownAt = t.ctx.time;
    addLog(`🗣 [${req.who} p${req.priority}] ${req.text}`);
  });
  t.bus.on('coach:said', (e) => {
    if (lastSubtitle?.id === e.id) lastSubtitle = undefined;
  });
  t.bus.on('coach:instruction', (i) => (instruction = i));
  t.bus.on('coach:intervention', (e) => {
    interventionUntil = t.ctx.time + 2.5;
    stopUntil = t.ctx.time + 3;
    addLog(`🛑 התערבות: ${e.reason}`);
  });
  t.bus.on('violation', (v) => addLog(`⚠ עבירה: ${v.type}`));
  t.bus.on('examiner:maneuver', (m) => addLog(`🧭 תמרון ${m.kind}: ${m.status}`));
  t.bus.on('test:finished', (r) => addLog(`🏁 המבחן הסתיים: ${r.passed ? 'עבר' : 'נכשל'} (${r.points} נק')`));
  t.bus.on('coach:request', (r) => addLog(`📨 בקשה: ${r.kind} ${JSON.stringify(r.payload)}`));
  return { t, dialogue, navigator, instructor, examiner, route, systems, mode };
}

function reset(): void {
  log.length = 0;
  instruction = undefined;
  lastSubtitle = undefined;
  currentSpeed = 0;
  stopUntil = -1;
  reverseLeft = 0;
  interventionUntil = -1;
  h = build(modeSel.value as Mode);
  addLog('איפוס — מגרש האימונים, מסלול tg_tour');
  render();
}

/** One deterministic simulation step: auto-driver + systems. */
function step(dt: number): void {
  const { t, route } = h;
  const ctx = t.ctx;
  const prevSpeed = currentSpeed;
  let want = targetSpeed;
  if (t.routeDistance >= route.length - 0.5) want = 0;
  if (ctx.time < stopUntil) want = 0;
  if (reverseLeft > 0) want = -1.5;
  const accel = want > currentSpeed ? 2.5 : currentSpeed - want > 4 ? 7 : 3.5;
  if (currentSpeed < want) currentSpeed = Math.min(want, currentSpeed + accel * dt);
  else if (currentSpeed > want) currentSpeed = Math.max(want, currentSpeed - accel * dt);
  if (reverseLeft > 0 && currentSpeed < 0) reverseLeft += currentSpeed * dt;
  t.routeDistance = Math.max(0, Math.min(route.length, t.routeDistance + currentSpeed * dt));
  const at = route.pointAt(t.routeDistance);
  ctx.player.pos = [at.p[0], at.p[1]];
  ctx.player.heading = at.h;
  ctx.player.speed = currentSpeed;
  ctx.player.accel = (currentSpeed - prevSpeed) / dt;
  ctx.player.brake = want < currentSpeed - 0.5 ? 0.6 : 0;
  ctx.player.throttle = want > currentSpeed + 0.2 ? 0.4 : 0;
  t.step(dt, h.systems);
}

// ---- rendering ---------------------------------------------------------------------------

function render(): void {
  const { t, route } = h;
  const ctx2d = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(hgt * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(hgt * dpr);
  }
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#0d1117';
  ctx2d.fillRect(0, 0, w, hgt);
  const bb = t.world.bbox;
  const pad = 30;
  const scale = Math.min((w - 2 * pad) / (bb.maxX - bb.minX), (hgt - 2 * pad) / (bb.maxZ - bb.minZ));
  const ox = (w - (bb.maxX - bb.minX) * scale) / 2;
  const oz = (hgt - (bb.maxZ - bb.minZ) * scale) / 2;
  const X = (p: Vec2) => ox + (p[0] - bb.minX) * scale;
  const Z = (p: Vec2) => oz + (p[1] - bb.minZ) * scale;
  const poly = (pts: Vec2[]) => {
    ctx2d.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx2d.moveTo(X(p), Z(p)) : ctx2d.lineTo(X(p), Z(p))));
    ctx2d.stroke();
  };
  // lanes
  ctx2d.lineWidth = Math.max(2, 3 * scale);
  ctx2d.strokeStyle = '#2a3340';
  ctx2d.lineCap = 'round';
  for (const lane of t.world.lanes) poly(lane.centre);
  ctx2d.lineWidth = Math.max(1, 2 * scale);
  for (const c of t.world.connectors) poly(c.path);
  // crossings
  ctx2d.strokeStyle = '#8a97a6';
  ctx2d.lineWidth = 2;
  for (const c of t.world.crossings) poly([c.line[0], c.line[1]]);
  // route
  ctx2d.strokeStyle = '#2f7fd6';
  ctx2d.lineWidth = Math.max(2, 2.2 * scale);
  for (const s of route.segments) poly(s.pts);
  // manoeuvre points
  for (const m of h.navigator.allManeuvers) {
    if (m.index < 0) continue;
    const p = route.pointAt(m.startDist).p;
    ctx2d.fillStyle = m.kind === 'straight' ? '#8a97a6' : '#ffb347';
    ctx2d.beginPath();
    ctx2d.arc(X(p), Z(p), 5, 0, Math.PI * 2);
    ctx2d.fill();
  }
  // junction labels
  ctx2d.fillStyle = '#5a6b7c';
  ctx2d.font = '11px Heebo, sans-serif';
  ctx2d.textAlign = 'center';
  for (const j of t.world.junctions) if (j.kind === 'junction' || j.kind === 'roundabout') ctx2d.fillText(j.id, X(j.position), Z(j.position) - 10);
  // agents
  for (const a of t.traffic) {
    ctx2d.fillStyle = a.kind === 'pedestrian' ? '#5ad37a' : '#c084fc';
    ctx2d.fillRect(X(a.pos) - 4, Z(a.pos) - 4, 8, 8);
  }
  // car
  const p = t.ctx.player;
  const f = forwardOf(p.heading);
  const r: Vec2 = [-f[1], f[0]];
  const nose: Vec2 = [p.pos[0] + f[0] * 4, p.pos[1] + f[1] * 4];
  const l: Vec2 = [p.pos[0] - f[0] * 2 + r[0] * 2, p.pos[1] - f[1] * 2 + r[1] * 2];
  const rr: Vec2 = [p.pos[0] - f[0] * 2 - r[0] * 2, p.pos[1] - f[1] * 2 - r[1] * 2];
  ctx2d.fillStyle = '#ff5a5a';
  ctx2d.beginPath();
  ctx2d.moveTo(X(nose), Z(nose));
  ctx2d.lineTo(X(l), Z(l));
  ctx2d.lineTo(X(rr), Z(rr));
  ctx2d.closePath();
  ctx2d.fill();

  // overlays
  const sub = lastSubtitle;
  subtitleEl.classList.toggle('visible', !!sub);
  subtitleEl.classList.toggle('examiner', sub?.who === 'examiner');
  if (sub) {
    subtitleEl.querySelector('.who')!.textContent = `${sub.who === 'examiner' ? 'הבוחן' : sub.who === 'instructor' ? 'המורה' : 'מערכת'} · ${(t.ctx.time - subtitleShownAt).toFixed(1)} ש׳`;
    subtitleEl.querySelector('.text')!.textContent = sub.text;
  }
  hudEl.querySelector('.kind')!.textContent = instruction ? (KIND_ICON[instruction.kind] ?? '•') : '•';
  hudEl.querySelector('.text')!.textContent = instruction?.text ?? '—';
  hudEl.querySelector('.dist')!.textContent = instruction ? `${instruction.distance} מ׳${instruction.streetName ? ' · ' + instruction.streetName : ''}${instruction.exitNumber ? ' · יציאה ' + instruction.exitNumber : ''}` : '';
  speedEl.innerHTML = `${Math.round(Math.abs(currentSpeed) * 3.6)} <small>קמ"ש</small>`;
  interventionEl.classList.toggle('visible', t.ctx.time < interventionUntil);
  queueEl.innerHTML = [h.dialogue.currentRequest ? `<li class="p${h.dialogue.currentRequest.priority}">▶ ${h.dialogue.currentRequest.text}</li>` : '', ...h.dialogue.pending.map((q) => `<li class="p${q.priority}">⏳ p${q.priority} · ${q.text}</li>`)].join('') || '<li style="color:var(--muted)">— ריק —</li>';
  const ex = h.examiner;
  statsEl.innerHTML = [
    `זמן סימולציה: ${t.ctx.time.toFixed(1)} ש׳`,
    `מרחק במסלול: ${t.routeDistance.toFixed(0)} / ${route.length.toFixed(0)} מ׳ · נותר ${h.navigator.remainingDistance().toFixed(0)} מ׳`,
    `על המסלול: ${h.navigator.onRoute ? 'כן' : 'לא'} · נתיב: ${t.ctx.localisation.laneId ?? t.ctx.localisation.connectorId ?? '—'}`,
    ex ? `טסט: ${ex.state} · נקודות ${ex.scorer.points} · תמרון פעיל: ${ex.activeManeuver ?? '—'} · מתוכנן: ${ex.plan.map((p) => p.kind).join(', ') || '—'}` : `התערבויות: ${h.instructor?.interventions ?? 0}`,
  ].join('<br>');
  logEl.innerHTML = log.map((l) => `<li>${l}</li>`).join('');
}

// ---- controls ----------------------------------------------------------------------------

function addPedestrian(): void {
  const { t } = h;
  const loc = t.ctx.localisation;
  const laneId = loc.laneId;
  const crossings = laneId ? (t.graph.crossingsByLane.get(laneId) ?? []) : [];
  const ap = laneId ? t.graph.approachOf(laneId) : undefined;
  const crossing = crossings[0] ?? (ap?.approach.crossingId ? t.graph.crossings.get(ap.approach.crossingId) : undefined) ?? t.world.crossings[0]!;
  t.addAgent({ id: `ped${t.traffic.length + 1}`, kind: 'pedestrian', pos: crossing.line[1], crossingId: crossing.id, pedState: 'waiting', length: 0.5, width: 0.5 });
  addLog(`🚶 הולך רגל ממתין במעבר ${crossing.id}`);
}

function addStoppedCar(): void {
  const { t } = h;
  const ahead = h.route.pointAt(t.routeDistance + 25);
  t.addAgent({ id: `car${t.traffic.length + 1}`, pos: ahead.p, heading: ahead.h, speed: 0 });
  addLog('🚗 רכב עצור 25 מ׳ לפנינו');
}

function bindControls(): void {
  $('btn-run').addEventListener('click', () => {
    running = !running;
    $('btn-run').textContent = running ? '⏸ השהה' : '▶ הפעל';
  });
  $('btn-reset').addEventListener('click', () => reset());
  modeSel.addEventListener('change', () => reset());
  ttsBox.addEventListener('change', () => reset());
  speedRange.addEventListener('input', () => {
    targetSpeed = Number(speedRange.value) / 3.6;
    $('speed-value').textContent = `${speedRange.value} קמ"ש`;
  });
  $('btn-repeat').addEventListener('click', () => h.navigator.announceNow());
  $('btn-explain').addEventListener('click', () => h.instructor?.explainHere(h.t.ctx) ?? h.dialogue.say({ who: 'examiner', text: 'הבוחן לא מסביר במהלך המבחן.', priority: 1 }));
  $('btn-stop').addEventListener('click', () => (stopUntil = h.t.ctx.time + 4));
  $('btn-reverse').addEventListener('click', () => (reverseLeft = 15));
  $('btn-speeding').addEventListener('click', () => h.t.bus.emit('violation', { type: 'SPEEDING_MAJOR', severity: 'major', time: h.t.ctx.time, pos: h.t.ctx.player.pos, details: { speed: 68, limit: 50 } }));
  $('btn-good').addEventListener('click', () => h.t.bus.emit('violation', { type: 'GOOD_STOP', severity: 'info', time: h.t.ctx.time, pos: h.t.ctx.player.pos }));
  $('btn-ped').addEventListener('click', addPedestrian);
  $('btn-red').addEventListener('click', () => {
    h.t.signals.setJunction('n11', 'red');
    addLog('🚦 n11 → אדום');
  });
  $('btn-car').addEventListener('click', addStoppedCar);
  for (const p of [0, 1, 2, 3] as const) $(`btn-say${p}`).addEventListener('click', () => h.dialogue.say({ who: 'instructor', text: `משפט בדיקה בעדיפות ${p}. זה נמשך קצת כדי לבדוק את התזמון.`, priority: p }));
}

// ---- loop ------------------------------------------------------------------------------

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    let acc = dt;
    while (acc > 0) {
      const s = Math.min(1 / 60, acc);
      step(s);
      acc -= s;
    }
  }
  render();
  requestAnimationFrame(frame);
}

reset();
bindControls();
requestAnimationFrame(frame);

// Playwright / console API
(window as unknown as { __coach: unknown }).__coach = {
  step(seconds: number, dt = 1 / 30) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) step(dt);
    render();
  },
  setMode(mode: Mode) {
    modeSel.value = mode;
    reset();
  },
  setSpeedKmh(v: number) {
    targetSpeed = v / 3.6;
    speedRange.value = String(v);
    $('speed-value').textContent = `${v} קמ"ש`;
  },
  stop: (seconds = 4) => (stopUntil = h.t.ctx.time + seconds),
  reverse: (metres = 15) => (reverseLeft = metres),
  pedestrian: addPedestrian,
  stoppedCar: addStoppedCar,
  redLight: () => h.t.signals.setJunction('n11', 'red'),
  repeat: () => h.navigator.announceNow(),
  explain: () => h.instructor?.explainHere(h.t.ctx),
  state: () => ({
    time: h.t.ctx.time,
    speedKmh: currentSpeed * 3.6,
    routeDistance: h.t.routeDistance,
    instruction,
    subtitle: lastSubtitle?.text,
    pending: h.dialogue.pending.map((q) => q.text),
    log: [...log],
    examiner: h.examiner ? { state: h.examiner.state, points: h.examiner.scorer.points, active: h.examiner.activeManeuver, plan: h.examiner.plan.map((p) => p.kind) } : undefined,
  }),
};
