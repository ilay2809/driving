/** Free drive (North Tel Aviv or the training ground), with or without the instructor. */
import type { AppShell } from '@/app/AppShell';
import { getWorld, type WorldName } from '@/app/WorldSession';
import { Instructor } from '@/coach';
import type { FreeDriveConfig } from '@/ui';

export class FreeMode {
  private instructor?: Instructor;
  private lastConfig?: FreeDriveConfig;
  private worldName: WorldName = 'north-tlv';

  constructor(private readonly app: AppShell) {}

  async setup(worldName: WorldName = 'north-tlv'): Promise<void> {
    this.worldName = worldName;
    const { ui } = this.app;
    ui.setLoading(0.2, 'טוען רשימת נקודות התחלה…');
    let spawnPoints: { id: string; name: string }[];
    try {
      const world = await getWorld(worldName);
      spawnPoints = world.spawnPoints.map((s) => ({ id: s.id, name: s.name }));
    } catch (err) {
      ui.setLoading(null);
      ui.toast(`טעינת העולם נכשלה: ${String(err)}`, 'danger', 8);
      this.app.showMainMenu();
      return;
    }
    ui.setLoading(null);
    const defaults: Partial<FreeDriveConfig> = this.lastConfig ?? {
      spawnId: spawnPoints[0]?.id,
      traffic: 0.5,
      pedestrians: 0.4,
      hour: 10,
      weather: 'clear',
      coach: worldName === 'training-ground',
      lawMonitor: true,
    };
    ui.showScreen('freeDriveSetup', {
      spawnPoints,
      defaults,
      onStart: (config) => void this.start(config),
      onBack: () => this.app.showMainMenu(),
    });
  }

  async start(config: FreeDriveConfig): Promise<void> {
    this.lastConfig = config;
    const app = this.app;
    app.settings.showLawMonitor = config.lawMonitor;
    const session = await app.createSession({
      world: this.worldName,
      mode: this.worldName === 'training-ground' ? 'training_ground' : 'free',
      spawn: config.spawnId,
      coachPresent: config.coach,
      traffic: { density: config.traffic, pedestrians: config.pedestrians, seed: app.nextSeed() },
      hour: config.hour,
      weather: config.weather,
    });
    if (!session) return;
    if (config.coach) {
      this.instructor = new Instructor(session.ctx.bus, session.dialogue, session.graph, { navigator: session.navigator, verbosity: 'normal' });
      session.modeSystems.push(this.instructor);
      session.onExplain = (ctx) => void this.instructor?.explainHere(ctx);
      app.ui.setCoachPresence('instructor', app.instructorName);
    } else {
      app.ui.setCoachPresence('none');
    }
    session.start();
  }

  restart(): void {
    if (this.lastConfig) void this.start(this.lastConfig);
  }

  dispose(): void {
    this.instructor?.dispose?.();
    this.instructor = undefined;
  }
}
