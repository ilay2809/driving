/**
 * Cross-module integration: rules engine (localiser + judge) running together with the
 * coach layer (navigator + instructor + dialogue) on the training ground, driven by a
 * scripted drive. Verifies the modules built in parallel actually cooperate through the
 * shared contracts (SimContext, EventBus).
 */
import { describe, expect, it } from 'vitest';
import { buildTrainingGround } from '@/world/testWorld';
import { RoadGraph } from '@/world/graph';
import { Judge, ScriptedDrive, makeTestContext, runDrive } from '@/rules';
import { DialogueManager, Instructor, Navigator, SilentTts } from '@/coach';
import { DEFAULT_SETTINGS } from '@/core/sim';
import type { NavInstruction, SpeechRequest } from '@/core/events';

describe('coach + rules on the training ground', () => {
  const world = buildTrainingGround();
  const graph = new RoadGraph(world);
  const tour = world.routes.find((r) => r.id === 'tg_tour')!;
  const route = graph.routeViaJunctions('r00_01:f0', tour.waypoints)!;

  function drivePath(): string[] {
    const path: string[] = [];
    route.laneIds.forEach((laneId, i) => {
      path.push(laneId);
      const c = route.connectorIds[i];
      if (c) path.push(c);
    });
    return path;
  }

  it('navigator guides, judge flags the missing indicators, instructor reacts — no criticals', () => {
    const ctx = makeTestContext(world, graph, { coachPresent: true, mode: 'lesson' });
    const dialogue = new DialogueManager(ctx.bus, { ...DEFAULT_SETTINGS, tts: false }, { tts: new SilentTts() });
    const navigator = new Navigator(graph, ctx.bus, dialogue);
    const instructor = new Instructor(ctx.bus, dialogue, graph, { navigator, autoGreet: false, seed: 7 });
    const judge = new Judge(graph, ctx.bus);
    navigator.setRoute(route, { speak: true });

    const said: SpeechRequest[] = [];
    ctx.bus.on('coach:say', (s) => said.push(s));
    const kinds: string[] = [];
    ctx.bus.on('coach:instruction', (i: NavInstruction) => {
      if (kinds[kinds.length - 1] !== i.kind) kinds.push(i.kind);
    });
    let interventions = 0;
    ctx.bus.on('coach:intervention', () => interventions++);

    const drive = new ScriptedDrive(graph, drivePath(), { profile: [{ atS: 0, speedKmh: 35 }] });
    const violations = runDrive(ctx, drive, judge, {
      maxSeconds: 900,
      onTick: (c) => {
        navigator.update(c);
        instructor.update(c);
        dialogue.update(c);
      },
    });

    // navigation covered the route
    expect(kinds).toContain('turn_left');
    expect(kinds).toContain('roundabout_exit');
    expect(kinds[kinds.length - 1]).toBe('arrive');
    expect(navigator.atDestination).toBe(true);
    // the judge noticed turns without indicators, but nothing critical happened on a clean drive
    const types = violations.map((v) => v.type);
    expect(types).toContain('NO_INDICATOR_TURN');
    expect(violations.some((v) => v.severity === 'critical')).toBe(false);
    expect(interventions).toBe(0);
    // the instructor spoke navigation and advice (Hebrew) through the dialogue manager
    expect(said.some((s) => /פנה|המשך ישר|כיכר/.test(s.text))).toBe(true);
    expect(said.some((s) => /איתות|מאותתים/.test(s.text))).toBe(true);
    expect(said.every((s) => s.who === 'instructor')).toBe(true);
  });

  it('a drive with correct indicators produces no signalling violations', () => {
    const ctx = makeTestContext(world, graph, { coachPresent: true, mode: 'lesson' });
    const judge = new Judge(graph, ctx.bus);
    // schedule indicator events 30 m before every turning connector along the drive
    const path = drivePath();
    const events: { atS: number; indicator: 'left' | 'right' | 'off' }[] = [];
    let s = 0;
    for (const id of path) {
      const lane = graph.lanes.get(id);
      if (lane) {
        s += lane.length;
        continue;
      }
      const c = graph.connector(id);
      if (c.turn !== 'straight') {
        const side = c.turn.includes('left') || c.turn === 'uturn' ? 'left' : 'right';
        events.push({ atS: Math.max(0, s - 30), indicator: side });
        events.push({ atS: s + c.length + 5, indicator: 'off' });
      }
      s += c.length;
    }
    const drive = new ScriptedDrive(graph, path, { profile: [{ atS: 0, speedKmh: 35 }], events });
    const violations = runDrive(ctx, drive, judge, { maxSeconds: 900 });
    const signalling = violations.filter((v) => v.type === 'NO_INDICATOR_TURN' || v.type === 'INDICATOR_LATE');
    expect(signalling).toEqual([]);
  });
});
