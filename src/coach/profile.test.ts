import { describe, expect, it } from 'vitest';
import { LocalStorageStore, MemoryStore, PROFILE_KEY, Profile, ProfileDataSchema } from './profile';
import { createTestContext } from './testUtils';

describe('Profile', () => {
  it('records lessons, tests, violations and driving totals, and lists weak points', () => {
    let t = 1000;
    const p = new Profile(undefined, new MemoryStore(), { now: () => t });
    p.recordLesson('L01', false, 40);
    t += 10;
    p.recordLesson('L01', true, 85);
    expect(p.data.lessons.L01).toEqual({ attempts: 2, completed: true, bestScore: 85, lastScore: 85, lastAt: 1010 });
    expect(p.isLessonCompleted('L01')).toBe(true);
    expect(p.lessonsCompleted()).toEqual(['L01']);
    p.recordTest({ passed: false, points: 101, byType: { RED_LIGHT: 1 }, mainReasons: ['x'], examinerSummary: 'y', majors: 0, criticals: 1, minors: 0 }, { routeId: 'r1', durationSec: 900 });
    expect(p.lastTest?.passed).toBe(false);
    expect(p.lastTest?.byType).toEqual({ RED_LIGHT: 1 });
    p.recordViolation('TAILGATING');
    p.recordViolation('TAILGATING');
    p.recordViolation('NO_INDICATOR_TURN');
    p.recordViolation('GOOD_STOP'); // infos are not weak points
    expect(p.weakPoints(1)).toEqual([{ type: 'TAILGATING', count: 2, label: 'מרחק עקיבה קצר' }]);
    p.recordDriving(120, 1500);
    expect(p.data.driving.totalMetres).toBe(1500);
    p.updateSettings({ tts: false });
    expect(p.settings.tts).toBe(false);
    expect(p.settings.volume).toBe(0.8);
  });

  it('exports and imports a round trip, rejecting invalid data', () => {
    const p = new Profile(undefined, new MemoryStore(), { now: () => 5 });
    p.recordLesson('L02', true, 90);
    p.recordTheoryAnswer('q1', false, 5);
    p.recordViolation('SPEEDING_MINOR');
    const json = p.export();
    const q = new Profile(undefined, new MemoryStore(), { now: () => 9 });
    expect(q.import(json)).toBe(true);
    expect(q.data.lessons.L02?.bestScore).toBe(90);
    expect(q.theoryEntry('q1')?.wrong).toBe(1);
    expect(q.data.violations.SPEEDING_MINOR).toBe(1);
    expect(JSON.parse(q.export())).toEqual({ ...JSON.parse(json), updatedAt: 9 });
    expect(q.import('{not json')).toBe(false);
    expect(q.import({ version: 2 })).toBe(false);
    expect(q.data.lessons.L02?.bestScore).toBe(90);
    expect(ProfileDataSchema.safeParse(JSON.parse(json)).success).toBe(true);
  });

  it('getOrCreate loads a stored profile or creates and saves a new one', async () => {
    const store = new MemoryStore();
    const fresh = await Profile.getOrCreate(store, { now: () => 1 });
    expect(fresh.data.createdAt).toBe(1);
    expect(store.map.has(PROFILE_KEY)).toBe(true);
    fresh.recordLesson('L03', true, 70);
    await fresh.save();
    const again = await Profile.getOrCreate(store, { now: () => 2 });
    expect(again.data.lessons.L03?.completed).toBe(true);
    await store.set(PROFILE_KEY, { garbage: true });
    const recovered = await Profile.getOrCreate(store, { now: () => 3 });
    expect(recovered.data.createdAt).toBe(3);
    // localStorage-like backend
    const mem = new Map<string, string>();
    const ls = new LocalStorageStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
    const viaLs = await Profile.getOrCreate(ls, { key: 'k', now: () => 4 });
    viaLs.recordViolation('TAILGATING');
    await viaLs.save();
    expect((await Profile.getOrCreate(ls, { key: 'k' })).data.violations.TAILGATING).toBe(1);
  });

  it('records bus events and accumulates driving time as a system', () => {
    const t = createTestContext();
    const store = new MemoryStore();
    const p = new Profile(undefined, store, { now: () => 7 });
    const detach = p.attach(t.bus);
    t.bus.emit('violation', { type: 'LANE_DEPARTURE', severity: 'minor', time: 0, pos: [0, 0] });
    t.bus.emit('lesson:completed', { lessonId: 'L04', passed: true, score: 88 });
    t.bus.emit('test:finished', { passed: true, points: 3, violations: [{ type: 'TAILGATING', severity: 'minor', time: 0, pos: [0, 0] }], durationSec: 1200 });
    t.bus.emit('theory:answered', { questionId: 'q7', correct: true });
    expect(p.data.violations.LANE_DEPARTURE).toBe(1);
    expect(p.data.lessons.L04?.completed).toBe(true);
    expect(p.lastTest?.byType).toEqual({ TAILGATING: 1 });
    expect(p.theoryEntry('q7')?.correct).toBe(1);
    t.ctx.player.speed = 10;
    t.advance(35, [p]);
    expect(p.data.driving.totalSeconds).toBeCloseTo(35, 1);
    expect(p.data.driving.totalMetres).toBeCloseTo(350, 0);
    expect(p.data.driving.sessions).toBe(1);
    detach();
    t.bus.emit('violation', { type: 'LANE_DEPARTURE', severity: 'minor', time: 0, pos: [0, 0] });
    expect(p.data.violations.LANE_DEPARTURE).toBe(1);
  });
});
