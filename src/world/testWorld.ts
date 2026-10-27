/**
 * Synthetic "training ground" (מגרש אימונים): a small deterministic town used by unit
 * tests, by lessons that need a controlled environment, and as a fallback when the
 * real map is not available. Built with the same builder as the real world.
 *
 * Layout (x east, z south; 3×3 grid, 120 m blocks):
 *
 *   n00 ─── n10 ─── n20          row 0: residential streets (right-hand rule at n10)
 *    │       │       │
 *   n01 ═══ n11 ═══ n21 ── RB    row 1: "main road" (secondary, 2 lanes each way), signals at n11,
 *    │       │       │            give-way side streets, roundabout east of n21
 *   n02 ─── n12 ─── n22          row 2: one-way street (n02→n22), stop sign at n12 (vertical road)
 */
import { arcPoints, buildWorld, type BuildCrossing, type BuildInput, type BuildNode, type BuildRoad, type BuildSign } from './builder';
import type { Building, Prop, Route, SpawnPoint, WorldFile } from './schema';
import type { Vec2 } from './geo';

export const TRAINING_GROUND_NAME = 'training-ground';

export function buildTrainingGround(): WorldFile {
  const B = 120;
  const nodes: BuildNode[] = [];
  const nodeAt = (i: number, j: number): BuildNode => nodes.find((n) => n.id === `n${i}${j}`)!;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const control = i === 1 && j === 1 ? 'signals' : i === 1 && j === 0 ? 'right_hand_rule' : 'auto';
      nodes.push({ id: `n${i}${j}`, pos: [(i - 1) * B, (j - 1) * B], control, name: `צומת ${i}${j}` });
    }
  }
  // dead-end stub south of n22 (for U-turn / reversing practice)
  nodes.push({ id: 'n23', pos: [B, 2 * B], control: 'none', name: 'סוף רחוב' });

  const roads: BuildRoad[] = [];
  const residential = (id: string, a: BuildNode, b: BuildNode, name: string, extra: Partial<BuildRoad> = {}): BuildRoad => ({
    id,
    from: a.id,
    to: b.id,
    points: [a.pos, b.pos],
    cls: 'residential',
    name,
    oneway: false,
    lanesForward: 1,
    lanesBackward: 1,
    maxSpeed: 50,
    ...extra,
  });
  // row 0 — residential
  roads.push(residential('r00_10', nodeAt(0, 0), nodeAt(1, 0), 'רחוב הברוש'));
  roads.push(residential('r10_20', nodeAt(1, 0), nodeAt(2, 0), 'רחוב הברוש'));
  // row 1 — main road (secondary, 2+2)
  const main = (id: string, a: BuildNode, b: BuildNode): BuildRoad => ({
    id,
    from: a.id,
    to: b.id,
    points: [a.pos, b.pos],
    cls: 'secondary',
    name: 'שדרות הראשיים',
    oneway: false,
    lanesForward: 2,
    lanesBackward: 2,
    maxSpeed: 50,
    priorityRoad: true,
    turnLanesForward: [['left', 'straight'], ['straight', 'right']],
    turnLanesBackward: [['left', 'straight'], ['straight', 'right']],
  });
  roads.push(main('r01_11', nodeAt(0, 1), nodeAt(1, 1)));
  roads.push(main('r11_21', nodeAt(1, 1), nodeAt(2, 1)));
  // row 2 — one-way street eastbound, 30 zone
  roads.push(residential('r02_12', nodeAt(0, 2), nodeAt(1, 2), 'רחוב החצב', { oneway: true, lanesBackward: 0, zone: 'calming_30', maxSpeed: 30 }));
  roads.push(residential('r12_22', nodeAt(1, 2), nodeAt(2, 2), 'רחוב החצב', { oneway: true, lanesBackward: 0, zone: 'calming_30', maxSpeed: 30 }));
  // columns — residential
  roads.push(residential('r00_01', nodeAt(0, 0), nodeAt(0, 1), 'רחוב התמר'));
  roads.push(residential('r01_02', nodeAt(0, 1), nodeAt(0, 2), 'רחוב התמר'));
  roads.push(residential('r10_11', nodeAt(1, 0), nodeAt(1, 1), 'רחוב הדקל'));
  roads.push(residential('r11_12', nodeAt(1, 1), nodeAt(1, 2), 'רחוב הדקל', { controlAtTo: 'stop' })); // stop sign arriving at n12 from the north
  roads.push(residential('r20_21', nodeAt(2, 0), nodeAt(2, 1), 'רחוב האלון'));
  roads.push(residential('r21_22', nodeAt(2, 1), nodeAt(2, 2), 'רחוב האלון'));
  roads.push(residential('r22_23', nodeAt(2, 2), nodeAt(2, 3 as 2) ?? { id: 'n23', pos: [B, 2 * B] } as BuildNode, 'רחוב האלון', {}));
  roads[roads.length - 1]!.to = 'n23';
  roads[roads.length - 1]!.points = [nodeAt(2, 2).pos, [B, 2 * B]];

  // roundabout east of n21: centre at (2B, 0) + 70 m east, radius 14
  const rc: Vec2 = [2 * B + 70, 0];
  const R = 14;
  const ringNodes: BuildNode[] = [
    { id: 'rb_w', pos: [rc[0] - R, rc[1]], control: 'auto' },
    { id: 'rb_s', pos: [rc[0], rc[1] + R], control: 'auto' },
    { id: 'rb_e', pos: [rc[0] + R, rc[1]], control: 'auto' },
    { id: 'rb_n', pos: [rc[0], rc[1] - R], control: 'auto' },
  ];
  nodes.push(...ringNodes);
  // ring runs counter-clockwise seen from above with north up: W → S → E → N → W
  // in x/z (z south) terms: angles π (W) → π/2 (S) → 0 (E) → -π/2 (N) → -π (W), i.e. decreasing angle
  const ring = (id: string, from: BuildNode, to: BuildNode, a0: number, a1: number): BuildRoad => ({
    id,
    from: from.id,
    to: to.id,
    points: arcPoints(rc, R, a0, a1),
    cls: 'tertiary',
    name: 'כיכר האילנות',
    oneway: true,
    lanesForward: 1,
    lanesBackward: 0,
    maxSpeed: 30,
    roundabout: true,
  });
  roads.push(ring('rb1', ringNodes[0]!, ringNodes[1]!, Math.PI, Math.PI / 2));
  roads.push(ring('rb2', ringNodes[1]!, ringNodes[2]!, Math.PI / 2, 0));
  roads.push(ring('rb3', ringNodes[2]!, ringNodes[3]!, 0, -Math.PI / 2));
  roads.push(ring('rb4', ringNodes[3]!, ringNodes[0]!, -Math.PI / 2, -Math.PI));
  // arms of the roundabout
  roads.push({ id: 'r21_rbw', from: 'n21', to: 'rb_w', points: [nodeAt(2, 1).pos, ringNodes[0]!.pos], cls: 'secondary', name: 'שדרות הראשיים', oneway: false, lanesForward: 1, lanesBackward: 1, maxSpeed: 50 });
  nodes.push({ id: 'rb_e_end', pos: [rc[0] + R + 80, rc[1]], control: 'none', name: 'קצה מזרח' });
  nodes.push({ id: 'rb_n_end', pos: [rc[0], rc[1] - R - 80], control: 'none', name: 'קצה צפון' });
  nodes.push({ id: 'rb_s_end', pos: [rc[0], rc[1] + R + 80], control: 'none', name: 'קצה דרום' });
  roads.push({ id: 'rbe_out', from: 'rb_e', to: 'rb_e_end', points: [ringNodes[2]!.pos, [rc[0] + R + 80, rc[1]]], cls: 'tertiary', name: 'דרך המזרח', oneway: false, lanesForward: 1, lanesBackward: 1, maxSpeed: 50 });
  roads.push({ id: 'rbn_out', from: 'rb_n', to: 'rb_n_end', points: [ringNodes[3]!.pos, [rc[0], rc[1] - R - 80]], cls: 'tertiary', name: 'דרך הצפון', oneway: false, lanesForward: 1, lanesBackward: 1, maxSpeed: 50 });
  roads.push({ id: 'rbs_out', from: 'rb_s', to: 'rb_s_end', points: [ringNodes[1]!.pos, [rc[0], rc[1] + R + 80]], cls: 'tertiary', name: 'דרך הדרום', oneway: false, lanesForward: 1, lanesBackward: 1, maxSpeed: 50 });

  const crossings: BuildCrossing[] = [
    { id: 'c_main_w', roadId: 'r01_11', s: B - 8, kind: 'zebra' }, // approach crossing at n11 (west arm)
    { id: 'c_main_e', roadId: 'r11_21', s: 8, kind: 'zebra' }, // approach crossing at n11 (east arm)
    { id: 'c_dekel_n', roadId: 'r10_11', s: B - 8, kind: 'zebra' }, // north arm of n11
    { id: 'c_dekel_s', roadId: 'r11_12', s: 8, kind: 'zebra' }, // south arm of n11
    { id: 'c_mid', roadId: 'r00_10', s: 60, kind: 'zebra' }, // mid-block crossing on a quiet street
    { id: 'c_stop', roadId: 'r11_12', s: B - 8, kind: 'zebra' }, // before the stop sign at n12
  ];

  const signs: BuildSign[] = [
    { code: '426', roadId: 'r02_12', s: 15, direction: 'forward', value: 30 },
    { code: '618', roadId: 'r02_12', s: 6, direction: 'forward' }, // one-way street
    { code: '402', roadId: 'r12_22', s: B - 6, direction: 'backward' }, // no entry (seen from n22 looking west)
    { code: '402', roadId: 'r02_12', s: B - 6, direction: 'backward' },
    { code: '144', roadId: 'r02_12', s: 40, direction: 'forward' }, // speed bumps ahead
    { code: '135', roadId: 'r00_10', s: 35, direction: 'forward' }, // crossing ahead
    { code: '135', roadId: 'r00_10', s: 85, direction: 'backward' },
    { code: '433', roadId: 'r10_20', s: 20, direction: 'forward' }, // no stopping
  ];

  const parking = [
    { id: 'p1', roadId: 'r10_20', side: 'right' as const, s0: 20, s1: 70, kerb: 'red_white' as const, layout: 'parallel' as const, bays: [] },
    { id: 'p2', roadId: 'r00_01', side: 'right' as const, s0: 15, s1: 100, kerb: 'blue_white' as const, layout: 'parallel' as const, bays: [] },
    { id: 'p3', roadId: 'r20_21', side: 'right' as const, s0: 15, s1: 100, kerb: 'none' as const, layout: 'parallel' as const, bays: [] },
    { id: 'p4', roadId: 'r01_02', side: 'left' as const, s0: 20, s1: 60, kerb: 'red_yellow' as const, layout: 'parallel' as const, bays: [] },
  ];

  // buildings: one or two per block corner, set back from the roads
  const buildings: Building[] = [];
  let bid = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const x0 = (i - 1) * B + 14;
      const z0 = (j - 1) * B + 14;
      const w = B - 28;
      const n = 2 + ((i + j) % 2);
      for (let k = 0; k < n; k++) {
        const bw = (w - 10 * (n - 1)) / n;
        const bx = x0 + k * (bw + 10);
        buildings.push({ id: `b${bid++}`, footprint: [[bx, z0], [bx + bw, z0], [bx + bw, z0 + 30], [bx, z0 + 30]], holes: [], height: 9 + 3 * ((i + j + k) % 3), levels: 3 + ((i + j + k) % 3), kind: 'residential' });
        buildings.push({ id: `b${bid++}`, footprint: [[bx, z0 + w - 30], [bx + bw, z0 + w - 30], [bx + bw, z0 + w], [bx, z0 + w]], holes: [], height: 12, levels: 4, kind: (i + j + k) % 4 === 0 ? 'commercial' : 'residential' });
      }
    }
  }

  const props: Prop[] = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 10; k < B; k += 20) {
      props.push({ kind: 'tree', pos: [(i - 1) * B - 6, -B + k], heading: 0, scale: 1 });
      props.push({ kind: 'lamp', pos: [(i - 1) * B + 6, -B + k + 10], heading: 0, scale: 1 });
    }
  }
  props.push({ kind: 'speed_bump', pos: [-B + 45, B], heading: 0, scale: 1, roadId: 'r02_12' });
  props.push({ kind: 'bus_stop', pos: [-B + 70, B - 6], heading: 0, scale: 1, name: 'החצב/התמר' });

  const spawnPoints: SpawnPoint[] = [
    { id: 'tg_start', name: 'נקודת התחלה — רחוב התמר', pos: [-B - 1.5, -B + 30], heading: Math.PI / 2, tags: ['start', 'lesson', 'quiet'] },
    { id: 'tg_main_w', name: 'שדרות הראשיים — מערב', pos: [-B + 20, 1.6], heading: 0, tags: ['main_road', 'lesson'] },
    { id: 'tg_parking', name: 'רחוב האלון — תרגול חניה', pos: [B - 1.5, -B + 20], heading: Math.PI / 2, tags: ['parking', 'lesson'] },
    { id: 'tg_oneway', name: 'רחוב החצב — חד-סטרי', pos: [-B + 10, B], heading: 0, tags: ['lesson'] },
    { id: 'tg_roundabout', name: 'לפני הכיכר', pos: [2 * B + 10, 1.5], heading: 0, tags: ['lesson'] },
  ];

  const routes: Route[] = [{ id: 'tg_tour', name: 'סיבוב במגרש האימונים', kind: 'tour', spawnId: 'tg_start', waypoints: ['n01', 'n11', 'n21', 'rb_w', 'rb_n', 'n20', 'n10', 'n00'] }];

  const input: BuildInput = {
    name: TRAINING_GROUND_NAME,
    origin: { lat: 0, lon: 0 },
    attribution: ['Synthetic training ground'],
    nodes,
    roads,
    crossings,
    signs,
    parking,
    buildings,
    areas: [
      { id: 'a_park', kind: 'park', polygon: [[14, 14], [B - 14, 14], [B - 14, B - 14], [14, B - 14]], holes: [] },
    ],
    props,
    spawnPoints,
    routes,
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  return buildWorld(input);
}
