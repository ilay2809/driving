/**
 * Dense synthetic grid city for renderer performance measurements (dev harness
 * `?world=stress`): ~1.8 km², ~550 roads, ~1 300 buildings, ~10 000 props, signals every
 * third junction. Deterministic (createRng). Not used by the simulation.
 */
import { createRng } from '@/core/sim';
import { buildWorld, type BuildCrossing, type BuildInput, type BuildNode, type BuildRoad, type BuildSign } from '@/world/builder';
import type { Area, Building, ParkingStrip, Prop, WorldFile } from '@/world/schema';
import type { Vec2 } from '@/world/geo';

export function buildStressWorld(blocks = 16, block = 110): WorldFile {
  const rng = createRng(20261027);
  const nodes: BuildNode[] = [];
  const at = (i: number, j: number): Vec2 => [(i - blocks / 2) * block, (j - blocks / 2) * block];
  for (let i = 0; i <= blocks; i++) {
    for (let j = 0; j <= blocks; j++) {
      const signals = i % 3 === 1 && j % 3 === 1;
      nodes.push({ id: `n${i}_${j}`, pos: at(i, j), control: signals ? 'signals' : 'auto', name: `צומת ${i}/${j}` });
    }
  }
  const streetNames = ['הרצל', 'ויצמן', 'בן גוריון', 'אבן גבירול', 'דיזנגוף', 'ארלוזורוב', 'ז׳בוטינסקי', 'נמיר', 'איינשטיין', 'ברודצקי', 'לוי אשכול', 'פנקס', 'קק״ל', 'יהודה המכבי', 'רידינג', 'שי עגנון', 'רוקח'];
  const roads: BuildRoad[] = [];
  const crossings: BuildCrossing[] = [];
  const signs: BuildSign[] = [];
  const parking: ParkingStrip[] = [];
  const road = (id: string, a: string, b: string, p: Vec2[], j: number, horizontal: boolean): BuildRoad => {
    const major = j % 4 === 0;
    const minor = j % 5 === 2;
    const oneway = !major && !minor && j % 7 === 3;
    const name = `${horizontal ? 'רחוב' : 'שדרות'} ${streetNames[j % streetNames.length]!}`;
    if (major) return { id, from: a, to: b, points: p, cls: 'secondary', name, oneway: false, lanesForward: 2, lanesBackward: 2, maxSpeed: 50, priorityRoad: true, turnLanesForward: [['left', 'straight'], ['straight', 'right']], turnLanesBackward: [['left', 'straight'], ['straight', 'right']] };
    if (minor) return { id, from: a, to: b, points: p, cls: 'tertiary', name, oneway: false, lanesForward: 1, lanesBackward: 1, maxSpeed: 50 };
    return { id, from: a, to: b, points: p, cls: 'residential', name, oneway, lanesForward: 1, lanesBackward: oneway ? 0 : 1, maxSpeed: oneway ? 30 : 50, zone: oneway ? 'calming_30' : 'none' };
  };
  for (let i = 0; i <= blocks; i++) {
    for (let j = 0; j <= blocks; j++) {
      if (i < blocks) roads.push(road(`h${i}_${j}`, `n${i}_${j}`, `n${i + 1}_${j}`, [at(i, j), at(i + 1, j)], j, true));
      if (j < blocks) roads.push(road(`v${i}_${j}`, `n${i}_${j}`, `n${i}_${j + 1}`, [at(i, j), at(i, j + 1)], i, false));
    }
  }
  for (const r of roads) {
    const L = block;
    const toSignals = nodes.find((n) => n.id === r.to)?.control === 'signals';
    const fromSignals = nodes.find((n) => n.id === r.from)?.control === 'signals';
    if (toSignals) crossings.push({ id: `c_${r.id}_to`, roadId: r.id, s: L - 9, kind: 'zebra' });
    if (fromSignals) crossings.push({ id: `c_${r.id}_from`, roadId: r.id, s: 9, kind: 'zebra' });
    if (!toSignals && !fromSignals && rng() < 0.25) crossings.push({ id: `c_${r.id}_mid`, roadId: r.id, s: L / 2, kind: rng() < 0.3 ? 'raised' : 'zebra' });
    if (r.cls === 'secondary' && rng() < 0.5) signs.push({ code: '426', roadId: r.id, s: 20, direction: 'forward', value: 50 });
    if (r.oneway) {
      signs.push({ code: '618', roadId: r.id, s: 6, direction: 'forward' });
      signs.push({ code: '402', roadId: r.id, s: L - 6, direction: 'backward' });
    }
    if (rng() < 0.3) {
      const kerb = rng() < 0.6 ? 'blue_white' : rng() < 0.5 ? 'red_white' : 'red_yellow';
      parking.push({ id: `p_${r.id}`, roadId: r.id, side: rng() < 0.5 ? 'left' : 'right', s0: 15, s1: L - 15, kerb, layout: 'parallel', bays: [] });
    }
  }

  const buildings: Building[] = [];
  const areas: Area[] = [];
  const props: Prop[] = [];
  let bid = 0;
  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < blocks; j++) {
      const [x0, z0] = at(i, j);
      const inset = 9;
      const w = block - 2 * inset;
      if ((i * 7 + j * 3) % 11 === 0) {
        areas.push({ id: `park${i}_${j}`, kind: rng() < 0.7 ? 'park' : 'parking_lot', polygon: [[x0 + inset, z0 + inset], [x0 + inset + w, z0 + inset], [x0 + inset + w, z0 + inset + w], [x0 + inset, z0 + inset + w]], holes: [] });
        for (let k = 0; k < 12; k++) props.push({ kind: 'tree', pos: [x0 + inset + 5 + rng() * (w - 10), z0 + inset + 5 + rng() * (w - 10)], heading: 0, scale: 1 });
        continue;
      }
      // perimeter buildings: 2–3 per side, depth 14 m
      const perSide = 2 + Math.floor(rng() * 2);
      const depth = 14;
      const sides: { a: Vec2; b: Vec2; inward: Vec2 }[] = [
        { a: [x0 + inset, z0 + inset], b: [x0 + inset + w, z0 + inset], inward: [0, 1] },
        { a: [x0 + inset + w, z0 + inset + w], b: [x0 + inset, z0 + inset + w], inward: [0, -1] },
      ];
      for (const s of sides) {
        const len = Math.abs(s.b[0] - s.a[0]);
        const gap = 6;
        const bw = (len - gap * (perSide - 1)) / perSide;
        for (let k = 0; k < perSide; k++) {
          const dir = Math.sign(s.b[0] - s.a[0]);
          const bx0 = s.a[0] + dir * k * (bw + gap);
          const bx1 = bx0 + dir * bw;
          const z1 = s.a[1] + s.inward[1] * depth;
          const fp: Vec2[] = [[bx0, s.a[1]], [bx1, s.a[1]], [bx1, z1], [bx0, z1]];
          const levels = 3 + Math.floor(rng() * 6);
          const kind = rng() < 0.08 ? 'public' : rng() < 0.2 ? 'commercial' : 'residential';
          buildings.push({ id: `b${bid++}`, footprint: fp, holes: [], height: levels * 3, levels, kind });
        }
      }
      // a courtyard building in the middle with a hole
      if (rng() < 0.5) {
        const cx = x0 + block / 2;
        const cz = z0 + block / 2;
        const o = 16;
        const h = 7;
        buildings.push({ id: `b${bid++}`, footprint: [[cx - o, cz - o], [cx + o, cz - o], [cx + o, cz + o], [cx - o, cz + o]], holes: [[[cx - h, cz - h], [cx - h, cz + h], [cx + h, cz + h], [cx + h, cz - h]]], height: 12 + 3 * Math.floor(rng() * 4), kind: 'residential' });
      }
    }
  }
  // street furniture along every road
  for (const r of roads) {
    const [a, b] = [r.points[0]!, r.points[1]!];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    const ux = dx / L;
    const uz = dz / L;
    const rx = -uz; // right of travel = heading + 90°: (−sin h, cos h)
    const rz = ux;
    const half = (r.lanesForward + r.lanesBackward) * (r.cls === 'secondary' ? 3.3 : r.cls === 'tertiary' ? 3.2 : 3.0) / 2;
    const off = half + 1.3;
    for (let s = 12; s < L - 10; s += 12) {
      for (const side of [1, -1]) {
        if (rng() < 0.75) props.push({ kind: 'tree', pos: [a[0] + ux * s + rx * off * side, a[1] + uz * s + rz * off * side], heading: 0, scale: 1 });
      }
      if (s % 36 === 12) props.push({ kind: 'lamp', pos: [a[0] + ux * (s + 6) + rx * (half + 0.6), a[1] + uz * (s + 6) + rz * (half + 0.6)], heading: 0, scale: 1 });
    }
    if (r.cls === 'secondary' && rng() < 0.5) props.push({ kind: 'bus_stop', pos: [a[0] + ux * 40 + rx * (half + 1.8), a[1] + uz * 40 + rz * (half + 1.8)], heading: Math.atan2(uz, ux), scale: 1 });
    if (rng() < 0.2) props.push({ kind: 'bench', pos: [a[0] + ux * 50 + rx * (half + 2.0), a[1] + uz * 50 + rz * (half + 2.0)], heading: Math.atan2(uz, ux), scale: 1 });
    if (rng() < 0.3) props.push({ kind: 'bin', pos: [a[0] + ux * 30 - rx * (half + 1.0), a[1] + uz * 30 - rz * (half + 1.0)], heading: 0, scale: 1 });
    if (r.zone === 'calming_30') props.push({ kind: 'speed_bump', pos: [a[0] + ux * (L / 2), a[1] + uz * (L / 2)], heading: Math.atan2(uz, ux), scale: 1 });
  }

  const input: BuildInput = {
    name: 'stress-city',
    origin: { lat: 0, lon: 0 },
    attribution: ['Synthetic stress city'],
    nodes,
    roads,
    crossings,
    signs,
    parking,
    buildings,
    areas,
    props,
    spawnPoints: [{ id: 'stress_start', name: 'התחלה', pos: [-50, 1.65], heading: 0, tags: ['start'] }],
    routes: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  return buildWorld(input);
}
