/** Structured lessons with the virtual instructor (Lesson DSL → LessonRunner). */
import type { AppShell } from '@/app/AppShell';
import { Instructor, LessonRunner, TheoryEngine } from '@/coach';
import type { Lesson } from '@/coach/lessonSchema';
import type { SimEventMap } from '@/core/events';
import { VIOLATIONS, type Severity, type Violation, type ViolationType } from '@/rules/violations';
import type { DebriefError, LessonCardData } from '@/ui';
import { parkingReporterFor } from '@/app/parking';

export class LessonMode {
  private current?: Lesson;
  private instructor?: Instructor;
  private runner?: LessonRunner;
  private offs: (() => void)[] = [];

  constructor(private readonly app: AppShell) {}

  private async catalogue(): Promise<Lesson[]> {
    return this.app.content.lessons();
  }

  private status(lesson: Lesson, all: Lesson[]): LessonCardData['status'] {
    const p = this.app.profile;
    if (p.isLessonCompleted(lesson.id)) return 'completed';
    const prereqs = lesson.prerequisites.length > 0 ? lesson.prerequisites : all.filter((l) => l.order < lesson.order).slice(-1).map((l) => l.id);
    return prereqs.every((id) => p.isLessonCompleted(id)) ? 'unlocked' : 'locked';
  }

  async showList(): Promise<void> {
    const { ui } = this.app;
    ui.setLoading(0.3, 'טוען שיעורים…');
    let lessons: Lesson[];
    try {
      lessons = await this.catalogue();
    } catch (err) {
      ui.setLoading(null);
      ui.toast(`טעינת השיעורים נכשלה: ${String(err)}`, 'danger', 8);
      this.app.showMainMenu();
      return;
    }
    ui.setLoading(null);
    const cards: LessonCardData[] = lessons.map((l) => ({
      id: l.id,
      order: l.order,
      title: l.title,
      subtitle: l.subtitle,
      minutes: l.minutes,
      status: this.status(l, lessons),
      score: this.app.profile.data.lessons[l.id]?.bestScore,
    }));
    const resume = cards.find((c) => c.status === 'unlocked');
    ui.setMode('menu');
    ui.showScreen('lessonList', {
      lessons: cards,
      resumeId: resume?.id,
      onSelect: (id) => void this.start(id),
      onBack: () => this.app.showMainMenu(),
    });
  }

  async start(lessonId: string): Promise<void> {
    const app = this.app;
    const lessons = await this.catalogue();
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) return;
    this.dispose();
    app.setActive(this);
    this.current = lesson;
    const session = await app.createSession({
      world: lesson.world,
      mode: 'lesson',
      spawn: lesson.spawnId,
      coachPresent: true,
      traffic: { density: lesson.traffic.density, pedestrians: lesson.traffic.pedestrians, seed: lesson.traffic.seed },
      hour: lesson.hour,
      weather: lesson.weather,
    });
    if (!session) return;
    const theory = await app.content.theory().catch(() => []);
    const engine = new TheoryEngine(theory, app.profile);
    const { bus } = session.ctx;
    this.instructor = new Instructor(bus, session.dialogue, session.graph, { navigator: session.navigator, autoGreet: false, verbosity: 'high' });
    const focus = new Set<ViolationType>();
    for (const step of lesson.steps) for (const t of step.focus) focus.add(t);
    this.instructor.setFocus([...focus]);
    this.runner = new LessonRunner(bus, session.dialogue, session.navigator, this.instructor, session.graph, {
      questionLookup: engine.lookup,
      onTimeScale: (factor, seconds) => session.loop.setTimeScale(factor, seconds),
      parkingReporter: parkingReporterFor(session.judge),
    });
    session.modeSystems.push(this.instructor, this.runner);
    session.onExplain = (ctx) => void this.instructor?.explainHere(ctx);
    app.ui.setCoachPresence('instructor', app.instructorName);

    const startTime = session.ctx.time;
    let lastPath = session.navigator.path;
    session.modeSystems.push({
      name: 'lesson-route-sync',
      update: () => {
        if (session.navigator.path !== lastPath) {
          lastPath = session.navigator.path;
          app.ui.setRoute(lastPath ?? null);
        }
      },
    });
    this.offs.push(
      bus.on('lesson:completed', (ev: SimEventMap['lesson:completed']) => {
        if (ev.lessonId !== lesson.id) return;
        session.setPaused(true);
        const since = session.judge.history.filter((v) => v.time >= startTime && v.severity !== 'info');
        const next = lessons.find((l) => l.order > lesson.order);
        app.ui.showScreen('lessonDebrief', {
          lessonTitle: lesson.title,
          score: ev.score,
          passed: ev.passed,
          counts: countBySeverity(since),
          errors: groupErrors(since),
          summary: lesson.debrief[0],
          onAgain: () => void this.start(lesson.id),
          onNext: next && ev.passed ? () => void this.start(next.id) : undefined,
          onMenu: () => void this.backToList(),
        });
      }),
    );
    session.start();
    this.runner.start(lesson);
  }

  private async backToList(): Promise<void> {
    this.app.setActive(null);
    this.app.endSession();
    await this.showList();
  }

  restart(): void {
    if (this.current) void this.start(this.current.id);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.runner?.abort();
    this.runner?.dispose?.();
    this.instructor?.dispose?.();
    this.runner = undefined;
    this.instructor = undefined;
  }
}

function countBySeverity(vs: Violation[]): { minor: number; major: number; critical: number } {
  const c = { minor: 0, major: 0, critical: 0 };
  for (const v of vs) if (v.severity !== 'info') c[v.severity as Exclude<Severity, 'info'>]++;
  return c;
}

function groupErrors(vs: Violation[]): DebriefError[] {
  const map = new Map<ViolationType, DebriefError>();
  for (const v of vs) {
    if (v.severity === 'info') continue;
    const e = map.get(v.type);
    if (e) e.count++;
    else map.set(v.type, { type: v.type, label: VIOLATIONS[v.type].label, advice: VIOLATIONS[v.type].advice, count: 1, severity: v.severity as Exclude<Severity, 'info'> });
  }
  const rank: Record<string, number> = { critical: 0, major: 1, minor: 2 };
  return [...map.values()].sort((a, b) => rank[a.severity]! - rank[b.severity]! || b.count - a.count);
}
