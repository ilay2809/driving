import { describe, expect, it } from 'vitest';
import { projectOntoPolyline } from '@/world/geo';
import { LineTable } from './lines';
import { ParkingMonitor, estimateParking } from './parking';
import { createTestContext } from './testUtils';

const lines = new LineTable(1);

/** Lane arc-length corresponding to a road arc-length (straight roads). */
function laneSForRoadS(t: ReturnType<typeof createTestContext>, laneId: string, roadS: number): number {
  const lane = t.graph.lane(laneId);
  const road = t.graph.road(lane.roadId);
  const at = projectOntoPolyline(road.centre, road.centre[0]!);
  void at;
  const p = t.graph.laneAt(laneId, 0).p;
  const start = projectOntoPolyline(road.centre, p).s;
  return road.lanesForward.includes(laneId) ? roadS - start : start - roadS;
}

describe('parking estimator', () => {
  it('reports a legal, parallel kerb stop on a plain kerb', () => {
    const t = createTestContext();
    const s = laneSForRoadS(t, 'r20_21:f0', 55); // strip p3 (kerb 'none', 15..100)
    t.placeOnLane('r20_21:f0', s, { speed: 0, lateral: 0.4 });
    t.ctx.player.gear = 'P';
    t.step(0.1);
    const r = estimateParking(t.ctx, t.graph, lines, true, 2);
    expect(r.legal).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.parked).toBe(true);
    expect(r.kerbDistance).toBeCloseTo(1.5 - 0.4 - 0.9, 1);
    expect(r.angleDeg).toBeLessThan(1);
    expect(r.laneId).toBe('r20_21:f0');
  });

  it('flags red-white kerbs and no-stopping signs', () => {
    const t = createTestContext();
    const s = laneSForRoadS(t, 'r10_20:f0', 45); // strip p1 red_white 20..70 + sign 433 at s=20
    t.placeOnLane('r10_20:f0', s, { speed: 0 });
    t.step(0.1);
    const r = estimateParking(t.ctx, t.graph, lines, true, 2);
    expect(r.legal).toBe(false);
    expect(r.reasons).toContain(lines.line('parking.reason.red_white'));
    expect(r.reasons).toContain(lines.line('parking.reason.sign'));
  });

  it('flags the 12 m junction rule, crossings, bus stops and junction interiors', () => {
    const t = createTestContext();
    const toJunction = t.graph.lane('r20_21:f0'); // ends at the real junction n21 (it starts at the bend n20)
    t.placeOnLane(toJunction.id, toJunction.length - 6, { speed: 0 });
    t.step(0.1);
    expect(t.ctx.localisation.laneId).toBe(toJunction.id);
    expect(estimateParking(t.ctx, t.graph, lines, true, 2).reasons).toContain(lines.line('parking.reason.junction'));
    t.placeOnLane(toJunction.id, 6, { speed: 0 });
    t.step(0.1);
    expect(estimateParking(t.ctx, t.graph, lines, true, 2).reasons).not.toContain(lines.line('parking.reason.junction'));
    const lane = t.graph.lane('r00_10:f0');
    const c = t.graph.crossings.get('c_mid')!;
    const mid: [number, number] = [(c.line[0][0] + c.line[1][0]) / 2, (c.line[0][1] + c.line[1][1]) / 2];
    const sC = projectOntoPolyline(lane.centre, mid).s;
    t.placeOnLane(lane.id, sC - 6, { speed: 0 });
    t.step(0.1);
    expect(estimateParking(t.ctx, t.graph, lines, true, 2).reasons).toContain(lines.line('parking.reason.crossing'));
    t.placeOnLane(lane.id, sC - 30, { speed: 0 });
    t.step(0.1);
    expect(estimateParking(t.ctx, t.graph, lines, true, 2).reasons).not.toContain(lines.line('parking.reason.crossing'));
    // r01_02 left side strip p4 is a bus stop (red_yellow) — the northbound lane's right-hand kerb
    const sBus = laneSForRoadS(t, 'r01_02:b0', 40);
    t.placeOnLane('r01_02:b0', sBus, { speed: 0 });
    t.step(0.1);
    expect(estimateParking(t.ctx, t.graph, lines, true, 2).reasons).toContain(lines.line('parking.reason.red_yellow'));
    // inside a junction
    const conn = t.graph.connectorsFrom('r00_01:f0').find((x) => x.turn === 'left')!;
    t.place(conn.path[Math.floor(conn.path.length / 2)]!, Math.PI / 4, 0);
    t.step(0.1);
    const r = estimateParking(t.ctx, t.graph, lines, true, 2);
    expect(r.legal).toBe(false);
    expect(r.reasons).toContain(lines.line('parking.reason.in_junction'));
  });

  it('is not legal from a non-kerb lane', () => {
    const t = createTestContext();
    t.placeOnLane('r01_11:f0', 50, { speed: 0 }); // left lane of the 2+2 main road
    t.step(0.1);
    expect(estimateParking(t.ctx, t.graph, lines, true, 2).reasons).toContain(lines.line('parking.reason.not_kerb_lane'));
  });
});

describe('ParkingMonitor', () => {
  it('tracks the stop duration and prefers the external reporter', () => {
    const t = createTestContext();
    const m = new ParkingMonitor(t.graph, lines);
    t.placeOnLane('r20_21:f0', 50, { speed: 5 });
    t.step(0.1);
    expect(m.update(t.ctx).stopped).toBe(false);
    t.ctx.player.speed = 0;
    t.step(0.1);
    m.update(t.ctx);
    t.step(1.5);
    const r = m.update(t.ctx);
    expect(r.stopped).toBe(true);
    expect(r.stoppedFor).toBeCloseTo(1.5, 5);
    expect(r.parked).toBe(false); // gear D, no handbrake
    t.ctx.player.handbrake = true;
    expect(m.update(t.ctx).parked).toBe(true);
    m.setReporter(() => ({ stopped: true, stoppedFor: 9, parked: true, legal: false, reasons: ['x'], kerbDistance: 0.1, angleDeg: 2 }));
    const ext = m.update(t.ctx);
    expect(ext.legal).toBe(false);
    expect(ext.reasons).toEqual(['x']);
    expect(ext.stoppedFor).toBe(9);
    expect(m.report).toBe(ext);
  });
});
