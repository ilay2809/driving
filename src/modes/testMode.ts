/** The practical driving test ("טסט") with the virtual examiner. */
import type { AppShell } from '@/app/AppShell';
import { getWorld, spawnLane } from '@/app/WorldSession';
import { Examiner } from '@/coach';
import { createRng } from '@/core/sim';
import type { SimEventMap } from '@/core/events';
import { TEST_RUBRIC } from '@/rules/violations';
import type { ManeuverResult } from '@/ui';
import type { PathResult, RoadGraph } from '@/world/graph';
import { projectOntoPolyline } from '@/world/geo';
import type { Route } from '@/world/schema';
import { generateRoute } from './routeGen';
import { parkingReporterFor } from '@/app/parking';

const MANEUVER_LABELS: Record<string, string> = {
  parallel_park: 'חניה מקבילה',
  pull_over: 'עצירה בצד הדרך',
  reverse: 'נסיעה לאחור בקו ישר',
  uturn: 'פניית פרסה',
  emergency_stop: 'בלימת חירום',
  hill_start: 'זינוק בעלייה',
};

/** The route's first turn is a U-turn (the car spawned facing away from the route). */
export function startsWithUturn(graph: RoadGraph, path: PathResult): boolean {
  const first = path.connectorIds[0];
  return !!first && graph.connectors.get(first)?.turn === 'uturn';
}

/** The lane running the other way on the same road, with the pose facing it at the spawn position. */
export function oppositeStart(graph: RoadGraph, laneId: string, pos: [number, number]): { laneId: string; pos: [number, number]; heading: number } | undefined {
  const lane = graph.lane(laneId);
  const road = graph.road(lane.roadId);
  const others = road.lanesForward.includes(laneId) ? road.lanesBackward : road.lanesForward;
  const target = others[others.length - 1]; // rightmost lane of the other direction
  if (!target) return undefined;
  const pr = projectOntoPolyline(graph.lane(target).centre, pos);
  const at = graph.laneAt(target, pr.s);
  return { laneId: target, pos: at.p, heading: at.h };
}

export class TestMode {
  private examiner?: Examiner;
  private offs: (() => void)[] = [];
  private lastChoice: { routeId: string | 'random' } = { routeId: 'random' };

  constructor(private readonly app: AppShell) {}

  async intro(): Promise<void> {
    const { ui } = this.app;
    ui.setLoading(0.2, 'טוען מסלולי מבחן…');
    let routes: { id: string; name: string }[];
    try {
      const world = await getWorld('north-tlv');
      routes = world.routes.filter((r) => r.kind === 'test').map((r) => ({ id: r.id, name: r.name }));
    } catch (err) {
      ui.setLoading(null);
      ui.toast(`טעינת העולם נכשלה: ${String(err)}`, 'danger', 8);
      this.app.showMainMenu();
      return;
    }
    ui.setLoading(null);
    ui.showScreen('testIntro', {
      routes,
      onStart: (choice) => void this.start(choice),
      onBack: () => this.app.showMainMenu(),
    });
  }

  async start(choice: { routeId: string | 'random' }): Promise<void> {
    this.lastChoice = choice;
    // a previous test (restart / "מבחן חדש") must not keep reacting to this one's events
    this.unsubscribe();
    const app = this.app;
    const world = await getWorld('north-tlv');
    const tests = world.routes.filter((r) => r.kind === 'test');
    const seed = app.nextSeed();
    const rng = createRng(seed);
    // "random" = an unknown route generated on the real network (like a real test); a hand-made
    // route is only the fallback when the generator cannot produce a long enough one
    let route: Route | undefined = choice.routeId === 'random' ? undefined : tests.find((r) => r.id === choice.routeId);
    const spawnId = route?.spawnId ?? world.spawnPoints.find((s) => s.id === 'tlv_test_start')?.id ?? world.spawnPoints[0]?.id ?? '';
    const session = await app.createSession({
      world: 'north-tlv',
      mode: 'test',
      spawn: spawnId,
      coachPresent: true,
      traffic: { density: 0.5, pedestrians: 0.4, seed },
      hour: 10,
      weather: 'clear',
    });
    if (!session) return;
    const { graph } = session;
    let startLane = spawnLane(graph, session.spawn.pos, session.spawn.heading);
    if (!startLane) {
      app.ui.toast('לא נמצא נתיב בנקודת ההתחלה', 'danger', 6);
      app.toMenu();
      return;
    }
    let path: PathResult | undefined;
    if (route) {
      path = graph.routeViaJunctions(startLane, route.waypoints) ?? undefined;
      // the route leaves the other way: start the car facing that direction instead of
      // opening the test with a U-turn at the first junction
      if (path && startsWithUturn(graph, path)) {
        const flipped = oppositeStart(graph, startLane, session.spawn.pos);
        const alt = flipped ? graph.routeViaJunctions(flipped.laneId, route.waypoints) : undefined;
        if (flipped && alt && !startsWithUturn(graph, alt)) {
          session.vehicle.teleport(flipped.pos, flipped.heading);
          startLane = flipped.laneId;
          path = alt;
        }
      }
    }
    if (!path || (choice.routeId === 'random' && path.length < 3000)) {
      path = generateRoute(graph, startLane, { rng, targetLength: 6500 });
      route = undefined;
    }
    if (path.length < 2000 && tests.length > 0) {
      // the generator got stuck (e.g. a tiny network): fall back to a hand-made route
      const fallback = tests[Math.floor(rng() * tests.length)]!;
      const p = graph.routeViaJunctions(startLane, fallback.waypoints);
      if (p && p.length > path.length) {
        path = p;
        route = fallback;
      }
    }
    const routeName = route?.name ?? 'מסלול אקראי';
    const maneuvers = new Map<string, ManeuverResult>();
    const startedAt = session.ctx.time;

    this.examiner = new Examiner(session.ctx.bus, session.dialogue, graph, session.navigator, { route: path, routeId: route?.id ?? `random-${seed}`, seed });
    this.examiner.setParkingReporter(parkingReporterFor(session.judge));
    session.modeSystems.push(this.examiner);
    session.onExplain = () => app.ui.toast('במבחן הבוחן לא מסביר — רק נותן הוראות.', 'info', 4);
    app.ui.setCoachPresence('examiner', 'הבוחן');
    app.ui.setRoute(path);

    this.offs.push(
      session.ctx.bus.on('examiner:maneuver', (m) => {
        maneuvers.set(m.kind, { kind: m.kind, label: MANEUVER_LABELS[m.kind] ?? m.kind, status: m.status });
      }),
      session.ctx.bus.on('test:finished', (ev: SimEventMap['test:finished']) => {
        session.setPaused(true);
        const verdict = this.examiner?.verdict;
        app.ui.showScreen('testResult', {
          passed: ev.passed,
          date: Date.now(),
          routeName,
          durationSec: ev.durationSec || session.ctx.time - startedAt,
          points: ev.points,
          maxPoints: TEST_RUBRIC.failPoints,
          violations: ev.violations.map((v) => ({ ...v, place: v.context })),
          maneuvers: [...maneuvers.values()],
          summary: verdict?.examinerSummary ?? (ev.passed ? 'עברת. נהיגה בטוחה.' : 'לא עברת הפעם. תרגל את הנקודות שצוינו ונסה שוב.'),
          examinerName: 'בוחן וירטואלי',
          onNewTest: () => void this.intro(),
          onMenu: () => app.toMenu(),
        });
      }),
    );
    session.start();
  }

  restart(): void {
    void this.start(this.lastChoice);
  }

  dispose(): void {
    this.unsubscribe();
    this.examiner?.dispose?.();
    this.examiner = undefined;
  }

  private unsubscribe(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }
}
