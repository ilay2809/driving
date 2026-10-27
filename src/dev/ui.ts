/**
 * UI dev harness (dev/ui.html): a fake SimContext on the training ground with a scripted
 * player driving the tour route, fake traffic, cycling signals, and buttons that open every
 * screen with sample data. Exposes `window.__uiHarness` for Playwright screenshots.
 */
import '@/ui/styles.css';
import { EventBus, type NavInstruction, type SpeechRequest } from '@/core/events';
import { DEFAULT_SETTINGS, createRng, defaultVehicleState, emptyLocalisation, type SignalStateProvider, type SimContext } from '@/core/sim';
import type { SimMode, TrafficAgentState } from '@/core/types';
import { kmhToMps, pointAlong, polylineLength, type Vec2 } from '@/world/geo';
import { RoadGraph } from '@/world/graph';
import type { SignalState } from '@/world/schema';
import { buildTrainingGround } from '@/world/testWorld';
import { VIOLATIONS, type Violation, type ViolationType } from '@/rules/violations';
import type { SignDef, TheoryQuestion } from '@/content/schema';
import { routeToPolyline, UISystem, type LessonCardData } from '@/ui';

// ---------------------------------------------------------------- world + ui
const world = buildTrainingGround();
const graph = new RoadGraph(world);
const bus = new EventBus();
const settings = { ...DEFAULT_SETTINGS };
const root = document.getElementById('ui')!;
const ui = new UISystem(root, bus, settings, { prefsKey: null });
const rng = createRng(7);

// ---------------------------------------------------------------- fake scene
const scene = document.getElementById('scene') as HTMLCanvasElement;
function drawScene(): void {
  const w = (scene.width = scene.clientWidth || innerWidth);
  const h = (scene.height = scene.clientHeight || innerHeight);
  const c = scene.getContext('2d')!;
  const sky = c.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, '#5aa7e8');
  sky.addColorStop(1, '#cfe6f7');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  const horizon = h * 0.52;
  // distant buildings
  const r = createRng(3);
  c.fillStyle = '#9fb3c4';
  for (let x = 0; x < w; x += 0) {
    const bw = 40 + r() * 120;
    const bh = 30 + r() * 110;
    c.fillRect(x, horizon - bh, bw - 6, bh);
    x += bw;
  }
  // ground / sidewalks
  c.fillStyle = '#b9b2a3';
  c.fillRect(0, horizon, w, h - horizon);
  // road trapezoid
  c.fillStyle = '#4a4e55';
  c.beginPath();
  c.moveTo(w * 0.46, horizon);
  c.lineTo(w * 0.54, horizon);
  c.lineTo(w * 1.05, h);
  c.lineTo(-w * 0.05, h);
  c.closePath();
  c.fill();
  // edge lines
  c.strokeStyle = '#e8e8e8';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(w * 0.465, horizon);
  c.lineTo(-w * 0.02, h);
  c.moveTo(w * 0.535, horizon);
  c.lineTo(w * 1.02, h);
  c.stroke();
  // centre dashes
  c.strokeStyle = '#f5f5f5';
  for (let i = 0; i < 12; i++) {
    const t0 = i / 12;
    const t1 = (i + 0.4) / 12;
    const y0 = horizon + (h - horizon) * t0 * t0;
    const y1 = horizon + (h - horizon) * t1 * t1;
    c.lineWidth = 1 + 5 * t0;
    c.beginPath();
    c.moveTo(w * 0.5, y0);
    c.lineTo(w * 0.5, y1);
    c.stroke();
  }
  // bonnet + dashboard
  c.fillStyle = '#1b2430';
  c.beginPath();
  c.moveTo(0, h);
  c.lineTo(0, h * 0.86);
  c.quadraticCurveTo(w * 0.5, h * 0.74, w, h * 0.86);
  c.lineTo(w, h);
  c.closePath();
  c.fill();
  c.fillStyle = '#0f151d';
  c.fillRect(0, h * 0.93, w, h * 0.07);
}
drawScene();
addEventListener('resize', drawScene);

// ---------------------------------------------------------------- fake signals
class FakeSignals implements SignalStateProvider {
  time = 0;
  private overrides = new Map<string, SignalState | undefined>();
  private cycle: SignalState[] = ['green', 'flashing_green', 'amber', 'red', 'red', 'red_amber'];
  stateOf(groupId: string): SignalState {
    const o = this.overrides.get(groupId);
    if (o) return o;
    let hsh = 0;
    for (let i = 0; i < groupId.length; i++) hsh = (hsh * 31 + groupId.charCodeAt(i)) | 0;
    const offset = Math.abs(hsh) % 6;
    const idx = (Math.floor(this.time / 4) + offset) % this.cycle.length;
    return this.cycle[idx]!;
  }
  stateForConnector(connectorId: string): SignalState | undefined {
    const g = graph.connectorSignalGroup.get(connectorId);
    return g ? this.stateOf(g) : undefined;
  }
  stateForCrossing(crossingId: string): SignalState | undefined {
    const c = graph.crossings.get(crossingId);
    return c?.signalGroup ? this.stateOf(c.signalGroup) : undefined;
  }
  timeToChange(): number {
    return 4 - (this.time % 4);
  }
  override(groupId: string, state: SignalState | undefined): void {
    this.overrides.set(groupId, state);
  }
}
const signals = new FakeSignals();

// ---------------------------------------------------------------- scripted player
const spawn = world.spawnPoints[0]!;
const startLane = graph.nearestLane(spawn.pos, { heading: spawn.heading })!.lane;
const routeRes = graph.routeViaJunctions(startLane.id, world.routes[0]!.waypoints)!;
const routePts = routeToPolyline(graph, routeRes);
const routeLen = polylineLength(routePts);
ui.setRoute(routeRes);

// cumulative length at the start of each lane / connector on the route (to find "next turn")
interface RouteLeg {
  kind: 'lane' | 'connector';
  id: string;
  s0: number;
  s1: number;
}
const legs: RouteLeg[] = [];
{
  let acc = 0;
  for (let i = 0; i < routeRes.laneIds.length; i++) {
    const lane = graph.lane(routeRes.laneIds[i]!);
    legs.push({ kind: 'lane', id: lane.id, s0: acc, s1: acc + lane.length });
    acc += lane.length;
    const cid = routeRes.connectorIds[i];
    if (cid) {
      const c = graph.connector(cid);
      legs.push({ kind: 'connector', id: cid, s0: acc, s1: acc + c.length });
      acc += c.length;
    }
  }
}

const player = defaultVehicleState(spawn.pos, spawn.heading);
player.engineOn = true;
player.seatbelt = true;
player.handbrake = false;
player.gear = 'D';
player.lights = 'low';

let routeS = 5;
let simTime = 0;
let auto = true;
let scenarioMode: SimMode = 'lesson';
let coachPresent = true;
let paused = false;
const traffic: TrafficAgentState[] = [];

// fake traffic on lanes
const laneList = world.lanes.filter((l) => l.kind === 'drive');
const carsOnLanes: { agent: TrafficAgentState; s: number; laneIdx: number; v: number }[] = [];
for (let i = 0; i < 14; i++) {
  const laneIdx = Math.floor(rng() * laneList.length);
  const lane = laneList[laneIdx]!;
  const agent: TrafficAgentState = { id: `car${i}`, kind: i % 5 === 0 ? 'bus' : i % 7 === 0 ? 'motorcycle' : 'car', pos: [...lane.centre[0]!] as Vec2, heading: 0, speed: 8, length: i % 5 === 0 ? 11 : 4.4, width: i % 5 === 0 ? 2.5 : 1.8, laneId: lane.id };
  carsOnLanes.push({ agent, s: rng() * lane.length, laneIdx, v: 6 + rng() * 6 });
  traffic.push(agent);
}
const peds: { agent: TrafficAgentState; a: Vec2; b: Vec2; t: number; dir: number }[] = [];
for (const cr of world.crossings) {
  for (let k = 0; k < 2; k++) {
    const agent: TrafficAgentState = { id: `ped-${cr.id}-${k}`, kind: 'pedestrian', pos: [...cr.line[0]] as Vec2, heading: 0, speed: 1.2, length: 0.5, width: 0.5, crossingId: cr.id, pedState: 'walking' };
    peds.push({ agent, a: cr.line[0], b: cr.line[1], t: rng(), dir: k === 0 ? 1 : -1 });
    traffic.push(agent);
  }
}

function stepTraffic(dt: number): void {
  for (const c of carsOnLanes) {
    const lane = laneList[c.laneIdx]!;
    c.s += c.v * dt;
    if (c.s > lane.length) {
      c.s = 0;
      c.laneIdx = (c.laneIdx + 7) % laneList.length;
    }
    const p = pointAlong(laneList[c.laneIdx]!.centre, c.s);
    c.agent.pos = p.p;
    c.agent.heading = p.h;
    c.agent.laneId = laneList[c.laneIdx]!.id;
    c.agent.speed = c.v;
  }
  for (const p of peds) {
    p.t += (p.dir * dt) / 6;
    if (p.t > 1.2 || p.t < -0.2) p.dir *= -1;
    const t = Math.min(1, Math.max(0, p.t));
    p.agent.pos = [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t];
    p.agent.pedState = t > 0 && t < 1 ? 'crossing' : 'waiting';
  }
}

function currentLeg(): { leg: RouteLeg; index: number } {
  for (let i = 0; i < legs.length; i++) if (routeS < legs[i]!.s1) return { leg: legs[i]!, index: i };
  return { leg: legs[legs.length - 1]!, index: legs.length - 1 };
}

function nextTurn(): { connector: ReturnType<typeof graph.connector>; distance: number } | undefined {
  const { index } = currentLeg();
  for (let i = index; i < legs.length; i++) {
    const leg = legs[i]!;
    if (leg.kind === 'connector' && leg.s0 >= routeS - 1) return { connector: graph.connector(leg.id), distance: Math.max(0, leg.s0 - routeS) };
  }
  return undefined;
}

let lastInstrAt = -10;
let lastViolationAt = 0;
let lastSayAt = -4;
let sayIdx = 0;
let violationIdx = 0;

const SAY_LINES: { who: SpeechRequest['who']; text: string; priority: SpeechRequest['priority'] }[] = [
  { who: 'instructor', text: 'שלום, אני יוסי. היום נתרגל צמתים ומתן זכות קדימה. קודם כול — חגורה, מראות, ויוצאים לדרך.', priority: 1 },
  { who: 'instructor', text: 'יפה. בצומת הבא פנה ימינה. אל תשכח לאותת מספיק מוקדם.', priority: 1 },
  { who: 'instructor', text: 'עצור! הולך רגל במעבר החצייה.', priority: 3 },
  { who: 'instructor', text: 'מצוין, נתת לו לחצות. ממשיכים ישר.', priority: 1 },
  { who: 'examiner', text: 'בכיכר — צא ביציאה השנייה.', priority: 2 },
];
const VIOLATION_SAMPLE: ViolationType[] = ['SPEEDING_MINOR', 'NO_INDICATOR_TURN', 'GOOD_STOP', 'STOP_SIGN_ROLLING', 'TAILGATING', 'GOOD_YIELD', 'PEDESTRIAN_NOT_YIELDED', 'LANE_DEPARTURE', 'SPEEDING_MAJOR'];

function mkViolation(type: ViolationType, time = simTime): Violation {
  return { type, severity: VIOLATIONS[type].severity, time, pos: [player.pos[0], player.pos[1]], context: 'רחוב התמר' };
}

function stepPlayer(dt: number): void {
  // speed profile: slow near turns, otherwise cruise with gentle variation
  const turn = nextTurn();
  const limit = kmhToMps(50);
  let target = limit * (0.75 + 0.2 * Math.sin(simTime / 7));
  if (turn && turn.distance < 25 && turn.connector.turn !== 'straight') target = Math.min(target, kmhToMps(18));
  if (simTime % 40 > 34) target = kmhToMps(58); // occasionally over the limit
  const v = player.speed + Math.max(-4 * dt, Math.min(2.2 * dt, target - player.speed));
  player.speed = Math.max(0, v);
  player.accel = (player.speed - v) / Math.max(dt, 1e-3);
  routeS += player.speed * dt;
  if (routeS > routeLen - 2) routeS = 5;
  const p = pointAlong(routePts, routeS);
  player.pos = p.p;
  player.heading = p.h;
  player.rpm = 800 + (player.speed / limit) * 2600 + (player.throttle > 0 ? 200 : 0);
  player.throttle = target > player.speed ? 0.4 : 0;
  player.brake = target < player.speed - 1 ? 0.3 : 0;
  player.indicator = turn && turn.distance < 45 && turn.connector.turn !== 'straight' ? (turn.connector.turn.includes('left') || turn.connector.turn === 'uturn' ? 'left' : 'right') : 'off';
  // periodic nav instruction
  if (turn && simTime - lastInstrAt > 0.5) {
    lastInstrAt = simTime;
    const to = graph.lane(turn.connector.toLane);
    const kind = turn.connector.turn === 'straight' ? 'straight' : turn.connector.turn === 'uturn' ? 'uturn' : turn.connector.turn.includes('left') ? 'turn_left' : 'turn_right';
    const j = graph.junctions.get(turn.connector.junctionId);
    const instr: NavInstruction = { kind: j?.kind === 'roundabout' ? 'roundabout_exit' : kind, text: '', distance: turn.distance, junctionId: turn.connector.junctionId, streetName: graph.roads.get(to.roadId)?.name, exitNumber: j?.kind === 'roundabout' ? 2 : undefined };
    bus.emit('coach:instruction', instr);
  }
}

function stepEvents(): void {
  if (simTime - lastViolationAt > 7) {
    lastViolationAt = simTime;
    bus.emit('violation', mkViolation(VIOLATION_SAMPLE[violationIdx++ % VIOLATION_SAMPLE.length]!));
  }
  if (simTime - lastSayAt > 11) {
    lastSayAt = simTime;
    const line = SAY_LINES[sayIdx++ % SAY_LINES.length]!;
    const id = `say-${sayIdx}`;
    bus.emit('coach:say', { id, who: line.who, text: line.text, priority: line.priority });
    setTimeout(() => bus.emit('coach:said', { id }), 3500 + line.text.length * 45);
  }
  if (Math.floor(simTime) % 9 === 0 && Math.floor(simTime * 30) % 30 === 0) {
    const targets = ['left_mirror', 'rear_mirror', 'right_mirror', 'left_shoulder'] as const;
    bus.emit('input:glance', { target: targets[Math.floor(simTime / 9) % targets.length]!, time: simTime });
  }
}

function localise(): SimContext['localisation'] {
  const loc = emptyLocalisation();
  const m = graph.nearestLane(player.pos, { heading: player.heading });
  if (m) {
    loc.laneId = m.lane.id;
    loc.roadId = m.lane.roadId;
    loc.s = m.s;
    loc.lateral = m.lateral;
    loc.headingError = m.headingError;
    loc.distToLaneEnd = m.lane.length - m.s;
    loc.speedLimit = m.lane.maxSpeed;
    loc.nextJunctionId = m.lane.to;
  }
  const { leg } = currentLeg();
  if (leg.kind === 'connector') {
    loc.connectorId = leg.id;
    loc.junctionId = graph.connector(leg.id).junctionId;
    loc.insideJunction = true;
    loc.speedLimit = 50;
  }
  return loc;
}

function makeCtx(dt: number): SimContext {
  return {
    time: simTime,
    dt,
    mode: scenarioMode,
    world,
    graph,
    bus,
    player,
    localisation: localise(),
    traffic,
    signals,
    env: { time: simTime, hour: 10, weather: 'clear', wetRoad: false },
    settings,
    coachPresent,
    timeScale: 1,
    paused,
  };
}

function tick(dt: number): void {
  if (!paused) {
    simTime += dt;
    signals.time = simTime;
    stepPlayer(dt);
    stepTraffic(dt);
    stepEvents();
  }
  ui.update(makeCtx(dt));
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (auto) tick(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- sample data
const LESSONS: LessonCardData[] = [
  { id: 'L00', order: 0, title: 'היכרות עם הרכב', subtitle: 'חגורה, מראות, הילוכים, יציאה לדרך', minutes: 8, status: 'completed', score: 92 },
  { id: 'L01', order: 1, title: 'נסיעה ברחוב שקט', subtitle: 'מיקום בנתיב, מהירות ועצירה', minutes: 10, status: 'completed', score: 81 },
  { id: 'L02', order: 2, title: 'פניות ימינה ושמאלה', subtitle: 'איתות, מראות, האטה', minutes: 12, status: 'completed', score: 64 },
  { id: 'L03', order: 3, title: 'תמרור עצור ותן זכות קדימה', subtitle: 'עצירה מלאה וסריקת הצומת', minutes: 12, status: 'unlocked' },
  { id: 'L04', order: 4, title: 'צומת ללא תמרורים', subtitle: 'זכות קדימה לבא מימין', minutes: 10, status: 'unlocked' },
  { id: 'L05', order: 5, title: 'רמזורים', subtitle: 'אדום, ירוק מהבהב, צהוב', minutes: 12, status: 'locked' },
  { id: 'L06', order: 6, title: 'כיכרות', subtitle: 'בחירת נתיב ומתן זכות קדימה', minutes: 12, status: 'locked' },
  { id: 'L07', order: 7, title: 'חניה מקבילה', subtitle: 'התמרון המלא ב-5 צעדים', minutes: 15, status: 'locked' },
];

const BRIEFING = {
  lessonId: 'L03',
  title: 'תמרור עצור ותן זכות קדימה',
  slides: [
    { title: 'מה לומדים היום', text: 'בשיעור הזה נלמד להבדיל בין **תמרור עצור** (302) לבין **תן זכות קדימה** (301).\n\nבתמרור עצור חייבים לעצור עצירה **מוחלטת** לפני קו העצירה — גם כשהדרך נראית פנויה.\n\n- סורקים שמאלה, ימינה ושוב שמאלה\n- ממשיכים רק כשבטוח', signs: ['302', '301'], diagram: undefined },
    { title: 'איפה עוצרים?', text: 'עוצרים לפני הראשון שקיים: **קו העצירה**, ואם אין — לפני **מעבר החצייה**, ואם אין — לפני **הצומת** עצמו.', signs: ['302'], diagram: 'stop_line_order' },
    { title: 'צומת ללא תמרורים', text: 'כשאין תמרורים, **זכות הקדימה לרכב הבא מימין** (תקנה 64). האט, הסתכל ימינה, ותן לו לעבור.', signs: [], diagram: 'right_hand_rule' },
  ],
};

const SIGN_DEFS: SignDef[] = [
  { code: '101', name: 'עקומה חדה ימינה', category: 'warning', meaning: 'לפניך עקומה חדה ימינה.', action: 'האט לפני העקומה.', shape: 'triangle', svg: '101.svg', hasValue: false, topics: [] },
  { code: '135', name: 'מעבר חצייה לפניך', category: 'warning', meaning: 'לפניך מעבר חצייה להולכי רגל.', action: 'האט ובדוק אם יש הולכי רגל שמתכוונים לחצות.', shape: 'triangle', svg: '135.svg', hasValue: false, topics: [] },
  { code: '144', name: 'פסי האטה', category: 'warning', meaning: 'לפניך פסי האטה בכביש.', action: 'האט.', shape: 'triangle', svg: '144.svg', hasValue: false, topics: [] },
  { code: '206', name: 'סע ימינה', category: 'mandatory', meaning: 'חובה לפנות ימינה.', action: 'פנה ימינה.', shape: 'circle', svg: '206.svg', hasValue: false, topics: [] },
  { code: '301', name: 'תן זכות קדימה', category: 'priority', meaning: 'תן זכות קדימה לתנועה בדרך החוצה.', action: 'האט, ואם צריך — עצור, ותן זכות קדימה.', shape: 'inverted_triangle', svg: '301.svg', hasValue: false, topics: [] },
  { code: '302', name: 'עצור', category: 'priority', meaning: 'עצור ותן זכות קדימה לתנועה בדרך החוצה.', action: 'עצור עצירה מוחלטת לפני קו העצירה.', shape: 'octagon', svg: '302.svg', hasValue: false, topics: [] },
  { code: '303', name: 'תן זכות קדימה בכיכר', category: 'priority', meaning: 'תן זכות קדימה לרכב הנמצא בכיכר.', action: 'האט ותן זכות קדימה לרכב בכיכר.', shape: 'inverted_triangle', svg: '303.svg', hasValue: false, topics: [] },
  { code: '402', name: 'אין כניסה', category: 'prohibition', meaning: 'הכניסה אסורה לכל רכב.', action: 'אל תיכנס.', shape: 'circle', svg: '402.svg', hasValue: false, topics: [] },
  { code: '426', name: 'מהירות מרבית', category: 'prohibition', meaning: 'אסור לנסוע במהירות העולה על המצוין.', action: 'שמור על מהירות נמוכה מהמצוין.', shape: 'circle', svg: '426.svg', hasValue: true, topics: [] },
  { code: '433', name: 'אסורה העצירה', category: 'prohibition', meaning: 'אסור לעצור בצד הדרך.', action: 'אל תעצור.', shape: 'circle', svg: '433.svg', hasValue: false, topics: [] },
  { code: '501', name: 'נתיב לתחבורה ציבורית', category: 'public_transport', meaning: 'הנתיב מיועד לתחבורה ציבורית בלבד.', action: 'אל תיסע בנתיב.', shape: 'rectangle', svg: '501.svg', hasValue: false, topics: [] },
  { code: '618', name: 'דרך חד-סטרית', category: 'information', meaning: 'התנועה בדרך מותרת בכיוון החץ בלבד.', action: 'סע בכיוון החץ.', shape: 'rectangle', svg: '618.svg', hasValue: false, topics: [] },
  { code: '701', name: 'אור אדום', category: 'signals', meaning: 'עצור לפני קו העצירה.', action: 'עצור והמתן לירוק.', shape: 'light', svg: '701.svg', hasValue: false, topics: [] },
  { code: '705', name: 'אור צהוב', category: 'signals', meaning: 'האור עומד להתחלף לאדום.', action: 'עצור, אלא אם אי אפשר לעצור בבטחה.', shape: 'light', svg: '705.svg', hasValue: false, topics: [] },
  { code: '803', name: 'קו הפרדה רצוף', category: 'markings', meaning: 'אסור לחצות את הקו.', action: 'הישאר בנתיב.', shape: 'marking', svg: '803.svg', hasValue: false, topics: [] },
  { code: '901', name: 'עבודות בדרך', category: 'work_zone', meaning: 'לפניך אתר עבודה.', action: 'האט ונהג בזהירות.', shape: 'diamond', svg: '901.svg', hasValue: false, topics: [] },
];

const QUESTIONS: TheoryQuestion[] = [
  { id: '0012', text: 'כיצד ינהג נהג המתקרב לצומת שבו מוצב תמרור "עצור"?', answers: ['יאט ויעבור את הצומת אם הדרך פנויה', 'יעצור לפני קו העצירה, ייתן זכות קדימה וימשיך רק כשבטוח', 'יצפור ויעבור', 'יעצור רק אם יש תנועה מימין'], correctIndex: 1, category: 'חוקי התנועה', classes: ['B'], image: null, signs: ['302'], topics: ['priority'] },
  { id: '0348', text: 'מהי המהירות המרבית המותרת בדרך עירונית, אלא אם סומן אחרת?', answers: ['40 קמ״ש', '50 קמ״ש', '60 קמ״ש', '70 קמ״ש'], correctIndex: 1, category: 'חוקי התנועה', classes: ['B'], image: null, signs: [], topics: ['speed'] },
  { id: '0771', text: 'מה משמעות אור ירוק מהבהב ברמזור?', answers: ['מותר לנסוע במהירות גבוהה', 'האור הירוק עומד להסתיים — התכונן לעצור', 'יש לעצור מיד', 'הרמזור מקולקל'], correctIndex: 1, category: 'תמרורים', classes: ['B'], image: 'q0771.png', signs: ['704'], topics: ['signals'] },
  { id: '1102', text: 'באיזה מרחק מצומת אסור לחנות?', answers: ['5 מטרים', '12 מטרים', '20 מטרים', '30 מטרים'], correctIndex: 1, category: 'חוקי התנועה', classes: ['B'], image: null, signs: [], topics: ['parking'] },
  { id: '1459', text: 'מי חייב לתת זכות קדימה בצומת שאין בו תמרורים?', answers: ['הרכב הבא משמאל', 'הרכב הגדול יותר', 'הרכב המגיע ראשון לצומת', 'הרכב שמימינו מגיע רכב אחר'], correctIndex: 3, category: 'חוקי התנועה', classes: ['B'], image: null, signs: [], topics: ['priority'] },
  { id: '1620', text: 'מהו מרחק העקיבה המינימלי המומלץ מהרכב שלפניך?', answers: ['שנייה אחת', 'שתי שניות (שלוש בגשם)', 'חמש שניות', 'אין הגדרה'], correctIndex: 1, category: 'בטיחות', classes: ['B'], image: null, signs: [], topics: ['distance'] },
];

function nearestRoadName(pos: Vec2): string {
  const m = graph.nearestLane(pos, { maxDist: 30 });
  return m ? (graph.roads.get(m.lane.roadId)?.name ?? '') : '';
}

// ---------------------------------------------------------------- scenarios
const noop = () => undefined;
const backToMenu = () => scenario('mainMenu');

const scenarios: Record<string, () => void> = {
  driving: () => {
    ui.hideScreens();
    setMode('lesson', true);
  },
  free: () => {
    ui.hideScreens();
    setMode('free', false);
  },
  test: () => {
    ui.hideScreens();
    setMode('test', true);
    bus.emit('examiner:maneuver', { kind: 'parallel_park', text: 'חניה מקבילה', status: 'requested' });
  },
  violations: () => {
    scenarios.driving!();
    const types: ViolationType[] = ['SPEEDING_MINOR', 'NO_INDICATOR_TURN', 'STOP_SIGN_ROLLING', 'GOOD_STOP', 'PEDESTRIAN_NOT_YIELDED'];
    types.forEach((t, i) => setTimeout(() => bus.emit('violation', mkViolation(t)), i * 120));
  },
  coach: () => {
    scenarios.driving!();
    bus.emit('coach:say', { id: 'demo-say', who: 'instructor', text: SAY_LINES[0]!.text, priority: 1 });
    bus.emit('lesson:hint', { text: 'בדוק מראות לפני שאתה יוצא מהחניה', icon: 'mirror', seconds: 8 });
    bus.emit('input:glance', { target: 'rear_mirror', time: simTime });
    bus.emit('lesson:step', { lessonId: 'L03', stepId: 's2', index: 1, total: 5 });
  },
  critical: () => {
    scenarios.driving!();
    bus.emit('coach:say', { id: 'demo-crit', who: 'instructor', text: 'עצור! הולך רגל במעבר החצייה!', priority: 3 });
    bus.emit('violation', mkViolation('PEDESTRIAN_NOT_YIELDED'));
    bus.emit('coach:intervention', { kind: 'brake', reason: 'pedestrian', time: simTime });
  },
  theoryQuestion: () => {
    scenarios.driving!();
    bus.emit('theory:question', { questionId: QUESTIONS[4]!.id, text: QUESTIONS[4]!.text, answers: QUESTIONS[4]!.answers, image: null });
    const off = bus.on('theory:answer', ({ questionId, index }) => {
      off();
      bus.emit('theory:answered', { questionId, correct: index === 3 });
    });
  },
  mainMenu: () => {
    setMode('menu', false);
    ui.showScreen('mainMenu', { onSelect: (item) => scenario(item === 'lessons' ? 'lessonList' : item === 'free' ? 'freeDrive' : item === 'test' ? 'testIntro' : item === 'theory' ? 'theoryQuiz' : item === 'settings' ? 'settings' : 'driving'), version: '0.1.0', progressText: '3 מתוך 8 שיעורים הושלמו' });
  },
  lessonList: () => {
    setMode('menu', false);
    ui.showScreen('lessonList', { lessons: LESSONS, resumeId: 'L03', onSelect: () => scenario('briefing'), onBack: backToMenu });
  },
  briefing: () => {
    setMode('lesson', true);
    ui.hideScreens();
    bus.emit('lesson:briefing', BRIEFING);
  },
  debrief: () => {
    setMode('lesson', true);
    ui.showScreen('lessonDebrief', {
      lessonTitle: 'תמרור עצור ותן זכות קדימה',
      score: 78,
      passed: true,
      counts: { minor: 3, major: 1, critical: 0 },
      summary: 'נהיגה טובה בסך הכול. שים לב לעצירה מלאה בתמרור עצור.',
      errors: [
        { type: 'STOP_SIGN_ROLLING', label: VIOLATIONS.STOP_SIGN_ROLLING.label, advice: VIOLATIONS.STOP_SIGN_ROLLING.advice, count: 1, severity: 'major' },
        { type: 'NO_INDICATOR_TURN', label: VIOLATIONS.NO_INDICATOR_TURN.label, advice: VIOLATIONS.NO_INDICATOR_TURN.advice, count: 2, severity: 'minor' },
        { type: 'LANE_DEPARTURE', label: VIOLATIONS.LANE_DEPARTURE.label, advice: VIOLATIONS.LANE_DEPARTURE.advice, count: 1, severity: 'minor' },
      ],
      onAgain: () => scenario('driving'),
      onNext: () => scenario('lessonList'),
      onMenu: backToMenu,
    });
  },
  freeDrive: () => {
    setMode('menu', false);
    ui.showScreen('freeDriveSetup', { spawnPoints: world.spawnPoints.map((s) => ({ id: s.id, name: s.name })), onStart: () => scenario('free'), onBack: backToMenu });
  },
  testIntro: () => {
    setMode('menu', false);
    ui.showScreen('testIntro', { routes: [{ id: 'r1', name: 'מסלול 1 — רמת אביב' }, { id: 'r2', name: 'מסלול 2 — נווה אביבים' }], onStart: () => scenario('test'), onBack: backToMenu });
  },
  testResult: () => {
    setMode('test', true);
    const vs: ViolationType[] = ['NO_INDICATOR_LANE_CHANGE', 'STOP_LINE_OVERRUN', 'SPEEDING_MINOR', 'NO_MIRROR_CHECK', 'WRONG_LANE_FOR_TURN', 'PEDESTRIAN_NOT_YIELDED'];
    ui.showScreen('testResult', {
      passed: false,
      date: Date.now(),
      routeName: 'מסלול 2 — נווה אביבים',
      durationSec: 23 * 60 + 41,
      points: 9,
      maxPoints: 12,
      examinerName: 'בוחן מס׳ 7',
      violations: vs.map((t, i) => ({ ...mkViolation(t, 120 + i * 190), place: nearestRoadName(routePts[(i * 50) % routePts.length]!) || 'רחוב הדקל' })),
      maneuvers: [
        { kind: 'parallel_park', status: 'completed' },
        { kind: 'pull_over', status: 'completed' },
        { kind: 'reverse', status: 'failed' },
        { kind: 'uturn', status: 'skipped' },
      ],
      summary: 'הנהיגה הכללית סבירה, אך נרשמה עבירה קריטית: לא ניתנה זכות קדימה להולך רגל במעבר חצייה ברחוב הדקל. יש לחזור על תרגול מעברי חצייה ונסיעה לאחור לפני מבחן חוזר.',
      onNewTest: () => scenario('testIntro'),
      onReplay: noop,
      onMenu: backToMenu,
    });
  },
  theoryQuiz: () => {
    setMode('theory', false);
    ui.showScreen('theoryQuiz', { questions: QUESTIONS, mode: 'exam', timeLimitSec: 20 * 60, explanations: { '0012': 'תמרור 302 מחייב עצירה מוחלטת גם כשהדרך פנויה.' }, onFinish: noop, onClose: backToMenu });
  },
  signLibrary: () => {
    setMode('menu', false);
    ui.showScreen('signLibrary', { signs: SIGN_DEFS, selected: '302', onClose: backToMenu });
  },
  settings: () => {
    setMode('menu', false);
    ui.showScreen('settings', { settings, voices: ['Carmit (he-IL)', 'Google עברית'], gamepadStatus: 'לא מחובר', onChange: (s) => Object.assign(settings, s), onClose: backToMenu });
  },
  help: () => {
    scenarios.driving!();
    ui.pushScreen('help', { onClose: () => ui.popScreen() });
  },
  pause: () => {
    scenarios.driving!();
    paused = true;
    bus.emit('sim:paused', { paused: true });
    ui.showScreen('pauseMenu', {
      onResume: () => {
        paused = false;
        bus.emit('sim:paused', { paused: false });
        ui.hideScreens();
      },
      onRestart: () => scenario('driving'),
      onSettings: () => scenario('settings'),
      onHelp: () => ui.pushScreen('help', { onClose: () => ui.popScreen() }),
      onMenu: backToMenu,
    });
  },
  loading: () => {
    ui.hideScreens();
    ui.setLoading(0.62, 'טוען את צפון תל אביב… (מבנים)');
  },
  toast: () => {
    scenarios.driving!();
    ui.toast('ההגדרות נשמרו', 'ok');
    ui.toast('הבקר נותק', 'warn', 5);
  },
};

function setMode(mode: SimMode, coach: boolean): void {
  scenarioMode = mode;
  coachPresent = coach;
  paused = false;
  ui.setLoading(null);
  bus.emit('mode:changed', { mode });
}

function scenario(name: string): void {
  const fn = scenarios[name];
  if (!fn) throw new Error(`unknown scenario ${name}`);
  for (const b of bar.querySelectorAll('button')) b.classList.toggle('active', b.dataset.scenario === name);
  fn();
}

// ---------------------------------------------------------------- control bar
const bar = document.getElementById('harness-bar')!;
for (const name of Object.keys(scenarios)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.dataset.scenario = name;
  b.addEventListener('click', () => scenario(name));
  bar.appendChild(b);
}
const autoBtn = document.createElement('button');
autoBtn.textContent = 'auto: on';
autoBtn.addEventListener('click', () => {
  auto = !auto;
  autoBtn.textContent = `auto: ${auto ? 'on' : 'off'}`;
});
bar.appendChild(autoBtn);
const hideBtn = document.createElement('button');
hideBtn.textContent = 'hide bar (H)';
hideBtn.addEventListener('click', () => (bar.hidden = true));
bar.appendChild(hideBtn);
addEventListener('keydown', (e) => {
  if (e.key === 'h' && !ui.currentScreen) bar.hidden = !bar.hidden;
});

declare global {
  interface Window {
    __uiHarness: {
      ui: UISystem;
      bus: EventBus;
      scenario: (name: string) => void;
      scenarios: string[];
      tick: (seconds: number) => void;
      setAuto: (on: boolean) => void;
      bar: (visible: boolean) => void;
      ready: Promise<void>;
    };
  }
}

window.__uiHarness = {
  ui,
  bus,
  scenario,
  scenarios: Object.keys(scenarios),
  tick: (seconds) => {
    const n = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < n; i++) tick(1 / 30);
  },
  setAuto: (on) => {
    auto = on;
    autoBtn.textContent = `auto: ${on ? 'on' : 'off'}`;
  },
  bar: (visible) => (bar.hidden = !visible),
  ready: document.fonts ? document.fonts.ready.then(() => undefined) : Promise.resolve(),
};

scenario('driving');
tick(1 / 30);
