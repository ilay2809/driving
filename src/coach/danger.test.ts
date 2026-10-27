import { describe, expect, it } from 'vitest';
import { projectOntoPolyline } from '@/world/geo';
import { agentBehind, distanceToCrossing, predictDanger, stoppingDistance } from './danger';
import { LineTable } from './lines';
import { createTestContext } from './testUtils';

const lines = new LineTable(1);

describe('danger predictor', () => {
  it('computes the stopping distance', () => {
    expect(stoppingDistance(10, 5)).toBe(10);
    expect(stoppingDistance(50 / 3.6, 5)).toBeCloseTo(19.3, 1);
  });

  it('predicts a red signal ahead only within the stopping distance, at speed, without braking', () => {
    const t = createTestContext();
    const lane = t.graph.lane('r01_11:f0'); // eastbound approach to the signalised n11
    t.signals.setJunction('n11', 'red');
    const v = 50 / 3.6;
    t.placeOnLane(lane.id, lane.length - 60, { speed: v });
    t.step(0.1);
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
    t.placeOnLane(lane.id, lane.length - 20, { speed: v });
    t.step(0.1);
    const d = predictDanger(t.ctx, t.graph, lines);
    expect(d?.kind).toBe('red_signal');
    expect(d?.subject).toBe('n11');
    expect(d?.reason).toContain('אדום');
    t.ctx.player.brake = 0.5;
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
    t.ctx.player.brake = 0;
    t.signals.setJunction('n11', 'green');
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
    t.signals.setJunction('n11', 'red');
    t.ctx.player.speed = 10 / 3.6;
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
  });

  it('does not intervene on amber when stopping is physically impossible', () => {
    const t = createTestContext();
    const lane = t.graph.lane('r01_11:f0');
    t.signals.setJunction('n11', 'amber');
    t.placeOnLane(lane.id, lane.length - 5, { speed: 50 / 3.6 });
    t.step(0.1);
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
    t.placeOnLane(lane.id, lane.length - 20, { speed: 50 / 3.6 });
    t.step(0.1);
    expect(predictDanger(t.ctx, t.graph, lines)?.kind).toBe('red_signal');
  });

  it('predicts a pedestrian at a crossing ahead (mid-block and approach crossings)', () => {
    const t = createTestContext();
    const lane = t.graph.lane('r00_10:f0');
    const crossing = t.graph.crossings.get('c_mid')!;
    const mid: [number, number] = [(crossing.line[0][0] + crossing.line[1][0]) / 2, (crossing.line[0][1] + crossing.line[1][1]) / 2];
    const sC = projectOntoPolyline(lane.centre, mid).s;
    t.addAgent({ id: 'ped1', kind: 'pedestrian', pos: crossing.line[0], crossingId: 'c_mid', pedState: 'waiting', length: 0.5, width: 0.5 });
    t.placeOnLane(lane.id, sC - 30, { speed: 10 });
    t.step(0.1);
    expect(distanceToCrossing(t.ctx, t.graph, crossing)).toBeCloseTo(30 - 2.2, 0);
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
    t.placeOnLane(lane.id, sC - 12, { speed: 10 });
    t.step(0.1);
    const d = predictDanger(t.ctx, t.graph, lines);
    expect(d?.kind).toBe('pedestrian');
    expect(d?.subject).toBe('ped1');
    // a pedestrian just walking on the sidewalk is not a crossing conflict
    t.traffic[0]!.pedState = 'walking';
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
    // approach crossing before the stop sign at n12
    t.removeAgents();
    const ap = t.graph.lane('r11_12:f0');
    const stopCrossing = t.graph.crossings.get('c_stop')!;
    t.addAgent({ id: 'ped2', kind: 'pedestrian', pos: stopCrossing.line[1], crossingId: 'c_stop', pedState: 'crossing', length: 0.5, width: 0.5 });
    t.placeOnLane(ap.id, ap.length - 8, { speed: 8 });
    t.step(0.1);
    expect(predictDanger(t.ctx, t.graph, lines)?.kind).toBe('pedestrian');
  });

  it('predicts a priority conflict when entering a give-way junction as a prioritised agent arrives', () => {
    const t = createTestContext();
    const lane = t.graph.lane('r00_01:f0'); // southbound, give way at n01
    const left = t.graph.connectorsFrom(lane.id).find((c) => c.turn === 'left')!;
    expect(left.yieldTo.length).toBeGreaterThan(0);
    const priorityConn = t.graph.connector(left.yieldTo[0]!);
    const j = t.graph.junction('n01');
    const other = t.graph.lane(priorityConn.fromLane);
    t.placeOnLane(lane.id, lane.length - 8, { speed: 8 });
    t.step(0.1);
    expect(predictDanger(t.ctx, t.graph, lines, { preferredConnectorId: left.id })).toBeUndefined();
    // agent 60 m from the junction: no conflict yet
    const far = t.graph.laneAt(other.id, other.length - 60);
    const a = t.addAgent({ id: 'car1', pos: far.p, heading: far.h, speed: 10, laneId: other.id, s: other.length - 60 });
    expect(predictDanger(t.ctx, t.graph, lines, { preferredConnectorId: left.id })).toBeUndefined();
    // agent 12 m from the junction centre, arriving within 1.5 s
    const near = t.graph.laneAt(other.id, other.length - 2);
    a.pos = near.p;
    a.heading = near.h;
    a.s = other.length - 2;
    expect(Math.hypot(a.pos[0] - j.position[0], a.pos[1] - j.position[1])).toBeLessThan(20);
    const d = predictDanger(t.ctx, t.graph, lines, { preferredConnectorId: left.id });
    expect(d?.kind).toBe('yield');
    expect(d?.subject).toBe('car1');
    // the same agent already inside the junction on the priority path
    a.laneId = undefined;
    a.connectorId = priorityConn.id;
    a.pos = priorityConn.path[Math.floor(priorityConn.path.length / 2)]!;
    expect(predictDanger(t.ctx, t.graph, lines, { preferredConnectorId: left.id })?.kind).toBe('yield');
    // the player far from the junction: nothing
    t.placeOnLane(lane.id, 20, { speed: 8 });
    t.step(0.1);
    expect(predictDanger(t.ctx, t.graph, lines, { preferredConnectorId: left.id })).toBeUndefined();
  });

  it('predicts a collision course with a leader (TTC < 1.2 s) from the geometry', () => {
    const t = createTestContext();
    const lane = t.graph.lane('r01_11:f1');
    t.placeOnLane(lane.id, 20, { speed: 12 });
    t.step(0.1);
    const ahead = t.graph.laneAt(lane.id, 50);
    const a = t.addAgent({ id: 'lead', pos: ahead.p, heading: ahead.h, speed: 0, laneId: lane.id });
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
    const close = t.graph.laneAt(lane.id, 30);
    a.pos = close.p;
    const d = predictDanger(t.ctx, t.graph, lines);
    expect(d?.kind).toBe('collision');
    expect(d?.ttc).toBeLessThan(1.2);
    a.speed = 11.5; // same speed: no closing
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
    // a car in the adjacent lane is not in our path
    a.speed = 0;
    const side = t.graph.laneAt('r01_11:f0', 30);
    a.pos = side.p;
    expect(predictDanger(t.ctx, t.graph, lines)).toBeUndefined();
  });

  it('finds the nearest agent behind within a distance', () => {
    const t = createTestContext();
    const lane = t.graph.lane('r01_11:f1');
    t.placeOnLane(lane.id, 60, { speed: 10 });
    t.step(0.1);
    expect(agentBehind(t.ctx, 40)).toBeUndefined();
    const b = t.graph.laneAt(lane.id, 35);
    t.addAgent({ id: 'behind', pos: b.p, heading: b.h, speed: 10 });
    expect(agentBehind(t.ctx, 40)?.id).toBe('behind');
    expect(agentBehind(t.ctx, 20)).toBeUndefined();
  });
});
