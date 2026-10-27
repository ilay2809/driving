/**
 * Regulatory / warning signs and kerb parking strips derived from the network:
 *   426 speed limit (where the limit changes), 618 one-way / 402 no entry,
 *   432 / 433 no parking / no stopping, 144 speed bumps, 135 crossing ahead,
 *   222 / 223 traffic-calming zone start / end, 505 bus stop, 623 dead end,
 *   439 loading zone (municipal layer). 301 / 302 / 303 come from the builder.
 */
import { classifyTurn, type BuildCrossing } from '@/world/builder';
import { angleDiff, projectOntoPolyline, type Vec2 } from '@/world/geo';
import type { ParkingStrip } from '@/world/schema';
import { GridIndex } from '../geom';
import type { TlvData } from '../tlv';
import { arrivalHeading, departureHeading, roadsByNode, sign } from './controls';
import type { BusStopMatch, BumpMatch } from './features';
import type { SemanticModel, SemRoad } from './model';

export const SPEED_SIGN_OFFSET = 8;
export const ENTRY_SIGN_OFFSET = 6;
export const BUMP_SIGN_DISTANCE = 25;
export const CROSSING_SIGN_DISTANCE = 30;
export const DEAD_END_EDGE_MARGIN = 60;
export const PARKING_JUNCTION_GAP = 12;

type Dir = 'forward' | 'backward';

interface Pred {
  road: SemRoad;
  /** |turn angle| from the predecessor into this road (rad). */
  dev: number;
}

export interface SignContext {
  midBlock: BuildCrossing[];
  busStops: BusStopMatch[];
  bumps: BumpMatch[];
  tlv: TlvData;
}

export function generateSigns(model: SemanticModel, ctx: SignContext): void {
  const byNode = roadsByNode(model);
  const counts: Record<string, number> = {};
  const push = (code: string, road: SemRoad, s: number, dir: Dir, value?: number | string, mount?: 'post_right' | 'post_left'): void => {
    const bs = sign(code, road, s, dir, value);
    if (mount) bs.mount = mount;
    model.signs.push(bs);
    counts[code] = (counts[code] ?? 0) + 1;
  };

  /** Roads that can deliver traffic into `road` travelling in `dir`, with the turn deviation. */
  const predecessors = (road: SemRoad, dir: Dir): Pred[] => {
    const entryNode = dir === 'forward' ? road.from : road.to;
    const depH = departureHeading(road, dir === 'forward' ? 'from' : 'to');
    const out: Pred[] = [];
    for (const q of byNode.get(entryNode) ?? []) {
      if (q === road) continue;
      if (q.to === entryNode) out.push({ road: q, dev: Math.abs(angleDiff(arrivalHeading(q, 'to'), depH)) });
      if (q.from === entryNode && !q.oneway) out.push({ road: q, dev: Math.abs(angleDiff(arrivalHeading(q, 'from'), depH)) });
    }
    return out;
  };
  const straightPred = (preds: Pred[]): Pred | undefined => {
    let best: Pred | undefined;
    for (const p of preds) if (p.dev <= (45 * Math.PI) / 180 && (!best || p.dev < best.dev)) best = p;
    return best;
  };
  const entryS = (road: SemRoad, dir: Dir, offset: number): number => (dir === 'forward' ? Math.min(offset, road.length / 2) : Math.max(road.length - offset, road.length / 2));
  const nearAreaEdge = (p: Vec2): boolean => p[0] < model.area.minX + DEAD_END_EDGE_MARGIN || p[0] > model.area.maxX - DEAD_END_EDGE_MARGIN || p[1] < model.area.minZ + DEAD_END_EDGE_MARGIN || p[1] > model.area.maxZ - DEAD_END_EDGE_MARGIN;

  const isMain = (r: SemRoad) => r.cls === 'motorway' || r.cls === 'trunk';
  for (const road of model.roads) {
    const dirs: Dir[] = road.oneway ? ['forward'] : ['forward', 'backward'];
    for (const dir of dirs) {
      const preds = predecessors(road, dir);
      const sp = straightPred(preds);
      const exitNode = dir === 'forward' ? road.to : road.from;
      const exit = model.nodes.get(exitNode);

      // 426 speed limit where it changes along the way (zones use 222/223)
      if (road.cls !== 'service' && road.zone === 'none' && !road.roundabout) {
        const relevant = preds.filter((p) => p.road.cls !== 'service' && !p.road.roundabout);
        let changed: boolean;
        if (sp && sp.road.cls !== 'service') changed = sp.road.zone === 'none' && sp.road.maxSpeed !== road.maxSpeed;
        else if (relevant.length > 0) changed = relevant.every((p) => p.road.zone === 'none' && p.road.maxSpeed !== road.maxSpeed);
        else changed = road.maxSpeed !== 50 && road.length > 40;
        if (changed) push('426', road, entryS(road, dir, SPEED_SIGN_OFFSET), dir, road.maxSpeed);
      }

      // 222 / 223 traffic-calming zone boundaries
      if (road.zone !== 'none') {
        const outside = sp ? sp.road.zone === 'none' && sp.road.cls !== 'service' : preds.some((p) => p.road.zone === 'none' && p.road.cls !== 'service');
        if (outside) push('222', road, entryS(road, dir, ENTRY_SIGN_OFFSET), dir, 30);
      } else if (road.cls !== 'service') {
        const fromZone = sp ? sp.road.zone !== 'none' : preds.length > 0 && preds.every((p) => p.road.zone !== 'none');
        if (fromZone) push('223', road, entryS(road, dir, ENTRY_SIGN_OFFSET), dir);
      }

      // 618 one-way at the start of a one-way street, 402 no entry at its far end
      // (not on service roads: parking-lot aisles and alleys are rarely signed)
      if (road.oneway && !road.roundabout && !isMain(road) && road.cls !== 'service' && dir === 'forward') {
        // a straight one-way predecessor of the same street = the same one-way street continues (no repeated sign)
        const continues = sp?.road.oneway === true && (sp.road.name ?? sp.road.nameEn) === (road.name ?? road.nameEn);
        if (!continues && preds.length > 0) push('618', road, entryS(road, 'forward', ENTRY_SIGN_OFFSET), 'forward');
        if (exit && exit.degree >= 2) {
          const others = (byNode.get(exitNode) ?? []).filter((q) => q !== road);
          const pureContinuation = exit.degree === 2 && others.length === 1 && others[0]!.oneway && others[0]!.from === exitNode && Math.abs(angleDiff(arrivalHeading(road, 'to'), departureHeading(others[0]!, 'from'))) < (45 * Math.PI) / 180;
          if (!pureContinuation) push('402', road, Math.max(road.length / 2, road.length - ENTRY_SIGN_OFFSET), 'backward');
        }
      }

      // 623 dead end (not where the road is merely cut by the data extent)
      if (exit && exit.degree === 1 && road.length >= 25 && !isMain(road) && !nearAreaEdge(exit.pos) && (road.cls === 'residential' || road.cls === 'living_street' || road.cls === 'unclassified')) {
        push('623', road, entryS(road, dir, SPEED_SIGN_OFFSET), dir);
      }
    }

    // 432 / 433 parking restrictions + kerb strips
    const strips: { side: 'left' | 'right'; info: NonNullable<SemRoad['attrs']['parkingRight']> }[] = [];
    if (road.attrs.parkingRight) strips.push({ side: 'right', info: road.attrs.parkingRight });
    if (road.attrs.parkingLeft) strips.push({ side: 'left', info: road.attrs.parkingLeft });
    for (const { side, info } of strips) {
      const dir: Dir = side === 'right' || road.oneway ? 'forward' : 'backward';
      const mount = side === 'left' && road.oneway ? 'post_left' : undefined;
      if (info.kind === 'no') push('432', road, entryS(road, dir, 10), dir, undefined, mount);
      else if (info.kind === 'no_stopping') push('433', road, entryS(road, dir, 10), dir, undefined, mount);
      if (road.length > 2 * PARKING_JUNCTION_GAP + 6) {
        const strip: ParkingStrip = {
          id: `p_${road.id}_${side[0]}`,
          roadId: road.id,
          side,
          s0: PARKING_JUNCTION_GAP,
          s1: road.length - PARKING_JUNCTION_GAP,
          kerb: info.kind === 'paid' ? 'blue_white' : info.kind === 'free' ? 'none' : 'red_white',
          layout: info.layout ?? 'parallel',
          bays: [],
        };
        model.parking.push(strip);
      }
    }
  }

  // 144 speed bumps ahead (first bump per road and direction)
  const bumpsByRoad = new Map<string, number[]>();
  for (const b of ctx.bumps) {
    const list = bumpsByRoad.get(b.road.id) ?? [];
    list.push(b.s);
    bumpsByRoad.set(b.road.id, list);
  }
  for (const [roadId, list] of bumpsByRoad) {
    const road = model.roadById.get(roadId)!;
    if (road.length < 15) continue;
    const first = Math.min(...list);
    const last = Math.max(...list);
    push('144', road, Math.max(2, first - BUMP_SIGN_DISTANCE), 'forward');
    if (!road.oneway) push('144', road, Math.min(road.length - 2, last + BUMP_SIGN_DISTANCE), 'backward');
  }

  // 135 pedestrian crossing ahead (mid-block crossings only; junction crossings are expected)
  for (const c of ctx.midBlock) {
    const road = model.roadById.get(c.roadId)!;
    if (c.s >= CROSSING_SIGN_DISTANCE + 5) push('135', road, c.s - CROSSING_SIGN_DISTANCE, 'forward');
    if (!road.oneway && road.length - c.s >= CROSSING_SIGN_DISTANCE + 5) push('135', road, c.s + CROSSING_SIGN_DISTANCE, 'backward');
  }

  // 505 bus stops + red/yellow kerb
  for (const b of ctx.busStops) {
    push('505', b.road, b.s, b.direction);
    const side = b.direction === 'forward' || b.road.oneway ? 'right' : 'left';
    const s0 = Math.max(1, b.direction === 'forward' ? b.s - 15 : b.s - 10);
    const s1 = Math.min(b.road.length - 1, b.direction === 'forward' ? b.s + 10 : b.s + 15);
    if (s1 - s0 >= 6) model.parking.push({ id: `pb_${b.road.id}_${side[0]}_${Math.round(b.s)}`, roadId: b.road.id, side, s0, s1, kerb: 'red_yellow', layout: 'parallel', bays: [] });
  }

  // 439 loading zones (municipal sign survey)
  const roadGrid = new GridIndex<SemRoad>(25);
  for (const r of model.roads) roadGrid.insertPolyline(r.points, r);
  let loading = 0;
  for (const z of ctx.tlv.loadingZones) {
    let best: { road: SemRoad; s: number; lateral: number; d: number } | undefined;
    for (const r of roadGrid.query(z.pos, 15)) {
      if (r.cls === 'motorway' || r.cls === 'trunk') continue;
      const pr = projectOntoPolyline(r.points, z.pos);
      if (pr.distance <= 15 && (!best || pr.distance < best.d)) best = { road: r, s: pr.s, lateral: pr.lateral, d: pr.distance };
    }
    if (!best) continue;
    const dir: Dir = best.road.oneway || best.lateral >= 0 ? 'forward' : 'backward';
    const side = dir === 'forward' ? 'right' : 'left';
    push('439', best.road, best.s, dir);
    const s0 = Math.max(1, best.s - 8);
    const s1 = Math.min(best.road.length - 1, best.s + 8);
    if (s1 - s0 >= 6) model.parking.push({ id: `pl_${best.road.id}_${side[0]}_${Math.round(best.s)}`, roadId: best.road.id, side, s0, s1, kerb: 'loading', layout: 'parallel', bays: [] });
    loading++;
  }
  model.stats.loadingZones = loading;
  for (const [code, n] of Object.entries(counts)) model.stats[`signs_${code}`] = n;
  model.stats.signsGenerated = model.signs.length;
  model.stats.parkingStrips = model.parking.length;
}

/** Turn a sign's straight-line reading of a junction into a Turn (exported for tests). */
export function turnBetween(from: SemRoad, fromEnd: 'from' | 'to', to: SemRoad, toEnd: 'from' | 'to') {
  return classifyTurn(arrivalHeading(from, fromEnd), departureHeading(to, toEnd));
}
