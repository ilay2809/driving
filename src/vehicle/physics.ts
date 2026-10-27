/**
 * Rapier physics world wrapper.
 *
 *  - fixed 60 Hz stepping (FixedStep) — `advance(dt)` is called ONCE per frame by the
 *    PlayerVehicle system; nobody else steps the world.
 *  - static colliders built lazily from a WorldFile: specs are bucketed on a 100 m grid
 *    and only cells within ~400 m of the focus (the player) are instantiated.
 *  - collider classification via a handle → tag map (Rapier colliders carry no user
 *    data), used to label collision events ('kerb' | 'building' | 'object' | 'vehicle' | 'pedestrian').
 *  - helpers for tests / other modules: dynamic obstacles, kinematic boxes for NPC
 *    vehicles and pedestrians (`createKinematicBox` + `setKinematicPose`).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { FixedStep } from '@/core/sim';
import { headingToRotationY, type Vec2 } from '@/world/geo';
import type { WorldFile } from '@/world/schema';
import { DEFAULT_ACTIVE_RADIUS, DEFAULT_CELL_SIZE, bucketSpecs, cellKey, cellsAround, worldColliderSpecs, type ColliderKind, type ColliderSpec } from './colliders';

export interface ColliderTag {
  kind: ColliderKind;
  id: string;
}

export interface CollisionRecord {
  with: ColliderKind;
  id: string;
  /** Approximate impulse (N·s). */
  impulse: number;
  /** World position of the contact [x, z]. */
  pos: [number, number];
}

export type CollisionListener = (rec: CollisionRecord) => void;
export type StepHook = (h: number) => void;

export const PHYSICS_STEP = 1 / 60;

/** Quaternion (x, y, z, w) for a rotation about world y. */
export function quatFromRotY(rotY: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) };
}

/** Quaternion for a vehicle heading (geo.ts convention, model forward = −z). */
export function quatFromHeading(heading: number): { x: number; y: number; z: number; w: number } {
  return quatFromRotY(headingToRotationY(heading));
}

export class PhysicsWorld {
  readonly fixed = new FixedStep(PHYSICS_STEP, 4);
  /** Seconds of physics simulated so far. */
  time = 0;
  private tags = new Map<number, ColliderTag>();
  private specCells = new Map<string, ColliderSpec[]>();
  private active = new Map<string, RAPIER.Collider[]>();
  private focusKey: string | null = null;
  private focus: Vec2 = [0, 0];
  private radius = DEFAULT_ACTIVE_RADIUS;
  private cellSize = DEFAULT_CELL_SIZE;
  private ground: RAPIER.Collider | null = null;
  private listeners = new Set<CollisionListener>();
  private preHooks = new Set<StepHook>();
  private postHooks = new Set<StepHook>();
  private bodies = new Map<number, RAPIER.RigidBody>();
  private playerColliders = new Set<number>();
  private recent = new Map<number, { time: number; impulse: number }>();
  private pendingKerb: CollisionRecord[] = [];

  constructor(
    public readonly world: RAPIER.World,
    public readonly eventQueue: RAPIER.EventQueue,
  ) {
    world.timestep = PHYSICS_STEP;
  }

  // ---- tags ---------------------------------------------------------------------

  tag(collider: RAPIER.Collider, tag: ColliderTag): void {
    this.tags.set(collider.handle, tag);
  }

  tagOf(handle: number): ColliderTag | undefined {
    return this.tags.get(handle);
  }

  /** Mark a collider as part of the player's car and enable contact-force events on it. */
  registerPlayerCollider(collider: RAPIER.Collider, threshold = 600): void {
    collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS | RAPIER.ActiveEvents.COLLISION_EVENTS);
    collider.setContactForceEventThreshold(threshold);
    this.playerColliders.add(collider.handle);
    this.tag(collider, { kind: 'player', id: 'player' });
  }

  // ---- static world -------------------------------------------------------------

  /** Flat ground: a thick cuboid whose top face is y = 0. */
  addGroundPlane(halfSize = 6000): RAPIER.Collider {
    if (this.ground) return this.ground;
    const desc = RAPIER.ColliderDesc.cuboid(halfSize, 0.5, halfSize).setTranslation(0, -0.5, 0).setFriction(1.0);
    this.ground = this.world.createCollider(desc);
    this.tag(this.ground, { kind: 'ground', id: 'ground' });
    return this.ground;
  }

  /**
   * Register the static colliders of a world. Nothing is instantiated until `setFocus`
   * places the player; cells are created / removed lazily when the focus crosses a cell.
   */
  addWorldColliders(world: WorldFile, opts: { radius?: number; cellSize?: number } = {}): void {
    this.removeWorldColliders();
    this.radius = opts.radius ?? DEFAULT_ACTIVE_RADIUS;
    this.cellSize = opts.cellSize ?? DEFAULT_CELL_SIZE;
    this.specCells = bucketSpecs(worldColliderSpecs(world), this.cellSize);
    if (this.focusKey !== null) {
      this.focusKey = null;
      this.setFocus(this.focus);
    }
  }

  removeWorldColliders(): void {
    for (const list of this.active.values()) for (const c of list) this.destroyCollider(c);
    this.active.clear();
    this.specCells.clear();
    this.focusKey = null;
  }

  /** Move the collider window to follow the player (cheap unless the 100 m cell changed). */
  setFocus(pos: Vec2): void {
    this.focus = pos;
    const key = cellKey(pos[0], pos[1], this.cellSize);
    if (key === this.focusKey) return;
    this.focusKey = key;
    const wanted = new Set(cellsAround(pos[0], pos[1], this.radius, this.cellSize));
    for (const [k, list] of this.active) {
      if (wanted.has(k)) continue;
      for (const c of list) this.destroyCollider(c);
      this.active.delete(k);
    }
    for (const k of wanted) {
      if (this.active.has(k)) continue;
      const specs = this.specCells.get(k);
      if (!specs || specs.length === 0) continue;
      const made: RAPIER.Collider[] = [];
      for (const s of specs) {
        const c = this.createStatic(s);
        if (c) made.push(c);
      }
      this.active.set(k, made);
    }
  }

  /** Ad-hoc static colliders (harness / tests) — never removed by the cell window. */
  addStaticSpecs(specs: ColliderSpec[]): RAPIER.Collider[] {
    const out: RAPIER.Collider[] = [];
    for (const s of specs) {
      const c = this.createStatic(s);
      if (c) out.push(c);
    }
    return out;
  }

  get activeColliderCount(): number {
    let n = 0;
    for (const list of this.active.values()) n += list.length;
    return n;
  }

  get activeCellCount(): number {
    return this.active.size;
  }

  private createStatic(s: ColliderSpec): RAPIER.Collider | null {
    let desc: RAPIER.ColliderDesc | null;
    if (s.shape === 'box') {
      desc = RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]).setRotation(quatFromRotY(s.rotY));
    } else if (s.shape === 'cylinder') {
      desc = RAPIER.ColliderDesc.cylinder(s.halfHeight, s.radius);
    } else {
      desc = RAPIER.ColliderDesc.convexHull(s.points);
      if (!desc) return null;
      const c = this.world.createCollider(desc.setFriction(0.6));
      this.tag(c, { kind: s.kind, id: s.id });
      return c;
    }
    desc.setTranslation(s.centre[0], s.centre[1], s.centre[2]).setFriction(s.kind === 'kerb' ? 0.9 : 0.6);
    const c = this.world.createCollider(desc);
    this.tag(c, { kind: s.kind, id: s.id });
    return c;
  }

  private destroyCollider(c: RAPIER.Collider): void {
    this.tags.delete(c.handle);
    this.world.removeCollider(c, false);
  }

  // ---- dynamic / kinematic helpers ------------------------------------------------

  /** A pushable box (e.g. a traffic cone) for tests and the harness. */
  addDynamicObstacle(pos: [number, number, number], size: [number, number, number], opts: { mass?: number; id?: string; kind?: ColliderKind } = {}): RAPIER.RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]).setLinearDamping(0.5).setAngularDamping(0.8));
    const desc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setMass(opts.mass ?? 3)
      .setFriction(0.8);
    const c = this.world.createCollider(desc, body);
    this.tag(c, { kind: opts.kind ?? 'object', id: opts.id ?? `obstacle:${body.handle}` });
    this.bodies.set(body.handle, body);
    return body;
  }

  /** Kinematic box for NPC vehicles / pedestrians (moved with `setKinematicPose`). Returns the body handle. */
  createKinematicBox(size: [number, number, number], kind: 'vehicle' | 'pedestrian' = 'vehicle', id?: string): number {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, size[1] / 2, 0));
    const desc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setFriction(0.6);
    const c = this.world.createCollider(desc, body);
    this.tag(c, { kind, id: id ?? `${kind}:${body.handle}` });
    this.bodies.set(body.handle, body);
    return body.handle;
  }

  /** Move a kinematic body: `pos` is [x, z] at ground level (box bottom on the ground) or [x, y, z]. */
  setKinematicPose(handle: number, pos: Vec2 | [number, number, number], heading: number): void {
    const body = this.bodies.get(handle);
    if (!body) return;
    const c = body.numColliders() > 0 ? body.collider(0) : null;
    const halfH = c ? ((c.shape as { halfExtents?: { y: number } }).halfExtents?.y ?? 0) : 0;
    const [x, y, z] = pos.length === 3 ? pos : [pos[0], halfH, pos[1]];
    body.setNextKinematicTranslation({ x, y, z });
    body.setNextKinematicRotation(quatFromHeading(heading));
  }

  removeBody(handle: number): void {
    const body = this.bodies.get(handle);
    if (!body) return;
    for (let i = 0; i < body.numColliders(); i++) this.tags.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
    this.bodies.delete(handle);
  }

  // ---- stepping -----------------------------------------------------------------

  onPreStep(fn: StepHook): () => void {
    this.preHooks.add(fn);
    return () => this.preHooks.delete(fn);
  }

  onPostStep(fn: StepHook): () => void {
    this.postHooks.add(fn);
    return () => this.postHooks.delete(fn);
  }

  onCollision(fn: CollisionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Report a collision detected outside the contact pipeline (e.g. a wheel mounting a kerb). */
  reportCollision(rec: CollisionRecord): void {
    this.pendingKerb.push(rec);
  }

  /** Advance by a frame's wall-clock delta using the fixed-step accumulator. */
  advance(dt: number): void {
    this.fixed.run(dt, (h) => this.stepOnce(h));
  }

  /** One fixed step (tests call this directly). */
  stepOnce(h = PHYSICS_STEP): void {
    for (const fn of this.preHooks) fn(h);
    this.world.step(this.eventQueue);
    this.time += h;
    this.drainEvents(h);
    for (const fn of this.postHooks) fn(h);
    if (this.pendingKerb.length) {
      const list = this.pendingKerb;
      this.pendingKerb = [];
      for (const rec of list) this.dispatch(rec);
    }
  }

  private drainEvents(h: number): void {
    this.eventQueue.drainCollisionEvents(() => {
      /* started / stopped pairs are not needed yet; draining keeps the queue empty */
    });
    this.eventQueue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      const mine = this.playerColliders.has(h1) ? h1 : this.playerColliders.has(h2) ? h2 : -1;
      if (mine < 0) return;
      const other = mine === h1 ? h2 : h1;
      const tag = this.tags.get(other);
      if (!tag || tag.kind === 'ground' || tag.kind === 'player' || tag.kind === 'bump') return;
      const impulse = ev.totalForceMagnitude() * h;
      // debounce: a scrape along a wall produces one event per step — report once per 0.5 s
      const prev = this.recent.get(other);
      if (prev && this.time - prev.time < 0.5 && impulse < prev.impulse * 2) return;
      this.recent.set(other, { time: this.time, impulse });
      const pos = this.contactPosition(mine, other);
      this.dispatch({ with: tag.kind, id: tag.id, impulse, pos });
    });
    if (this.recent.size > 64) {
      for (const [k, v] of this.recent) if (this.time - v.time > 2) this.recent.delete(k);
    }
  }

  private contactPosition(a: number, b: number): [number, number] {
    const ca = this.world.getCollider(a);
    const cb = this.world.getCollider(b);
    let out: [number, number] | null = null;
    if (ca && cb) {
      this.world.contactPair(ca, cb, (manifold) => {
        if (out) return;
        if (manifold.numSolverContacts() > 0) {
          const p = manifold.solverContactPoint(0);
          if (p) out = [p.x, p.z];
        }
      });
      if (!out) {
        const t = cb.translation();
        out = [t.x, t.z];
      }
    }
    return out ?? [0, 0];
  }

  private dispatch(rec: CollisionRecord): void {
    for (const fn of Array.from(this.listeners)) {
      try {
        fn(rec);
      } catch (err) {
        console.error('[physics] collision listener threw', err);
      }
    }
  }

  dispose(): void {
    this.removeWorldColliders();
    this.preHooks.clear();
    this.postHooks.clear();
    this.listeners.clear();
    this.eventQueue.free();
    this.world.free();
  }
}

let initPromise: Promise<void> | null = null;

/** Initialise the WASM module (once) and create a world with gravity −9.81 m/s². */
export async function createPhysics(): Promise<PhysicsWorld> {
  if (!initPromise) initPromise = RAPIER.init();
  await initPromise;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const queue = new RAPIER.EventQueue(true);
  return new PhysicsWorld(world, queue);
}

export { RAPIER };
