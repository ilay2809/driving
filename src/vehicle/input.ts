/**
 * InputSystem — keyboard / gamepad / steering wheel → InputState, once per frame.
 *
 * Edge-triggered fields (gearRequest, indicatorRequest, toggles, glance, pause, help,
 * acknowledge, chaseToggle, gearCycle) are set for exactly one `update()` and cleared
 * on the next, so consumers must read them in the same frame (input runs first).
 *
 * Keyboard: pedals ramp (progressive), steering is rate based with self-centring
 * (see steering.ts), P/R/N/D letters act as the lever only while (nearly) stopped
 * because A/D also steer. Mouse drag (or holding the right button) = free look.
 */
import type { EventBus } from '@/core/events';
import type { Settings, SimContext, System } from '@/core/sim';
import type { Gear, GlanceTarget, Indicator } from '@/core/types';
import { DEFAULT_WHEEL_CONFIG, buttonSnapshot, describeGamepads, isWheelId, mapStandardGamepad, mapWheel, wheelConfigFor, type GamepadDescription, type GamepadLike, type MappedInput, type WheelConfig } from './gamepad';
import { KEY_TO_ACTIONS, PREVENT_DEFAULT_KEYS, type InputAction } from './keymap';
import { KeyboardSteering, rampPedal, smoothAnalog } from './steering';

export type InputSource = 'keyboard' | 'gamepad' | 'wheel';

export interface InputState {
  steer: number;
  throttle: number;
  brake: number;
  /** Parking-brake lever position wanted by the driver (toggled by Space / LS / wheel button). */
  handbrake: boolean;
  gearRequest?: Gear;
  /** Shift+↑ / Shift+↓ (or paddles): move the lever one notch towards P (−1) or D (+1). */
  gearCycle: 0 | 1 | -1;
  indicatorRequest?: Indicator;
  lightsToggle: boolean;
  wipersToggle: boolean;
  horn: boolean;
  ignitionToggle: boolean;
  seatbeltToggle: boolean;
  /** Free look −1..1 (positive = right / up). */
  lookYaw: number;
  lookPitch: number;
  glance?: GlanceTarget;
  pause: boolean;
  help: boolean;
  acknowledge: boolean;
  chaseToggle: boolean;
  source: InputSource;
}

export function emptyInputState(): InputState {
  return {
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: true,
    gearCycle: 0,
    lightsToggle: false,
    wipersToggle: false,
    horn: false,
    ignitionToggle: false,
    seatbeltToggle: false,
    lookYaw: 0,
    lookPitch: 0,
    pause: false,
    help: false,
    acknowledge: false,
    chaseToggle: false,
    source: 'keyboard',
  };
}

const STOPPED_SPEED = 0.5; // m/s: below this the P/R/N/D letters act as the lever
const PEDAL_RISE = 0.28;
const PEDAL_FALL = 0.12;
const MOUSE_YAW_PX = 420;
const MOUSE_PITCH_PX = 320;

interface Pending {
  gearRequest?: Gear;
  gearCycle: 0 | 1 | -1;
  indicatorRequest?: Indicator;
  lightsToggle: boolean;
  wipersToggle: boolean;
  ignitionToggle: boolean;
  seatbeltToggle: boolean;
  glance?: GlanceTarget;
  pause: boolean;
  help: boolean;
  acknowledge: boolean;
  chaseToggle: boolean;
  handbrakeToggle: boolean;
}

function freshPending(): Pending {
  return { gearCycle: 0, lightsToggle: false, wipersToggle: false, ignitionToggle: false, seatbeltToggle: false, pause: false, help: false, acknowledge: false, chaseToggle: false, handbrakeToggle: false };
}

export class InputSystem implements System {
  readonly name = 'input';
  readonly state: InputState = emptyInputState();
  /** Wheel button layout (editable from a settings UI). */
  wheelConfig: WheelConfig = DEFAULT_WHEEL_CONFIG;
  /** Speed used for speed-sensitive keyboard steering (taken from ctx.player). */
  speed = 0;

  private keys = new Set<string>();
  private keyDAsGear = false;
  private pending = freshPending();
  private kb = new KeyboardSteering();
  private pedalT = 0;
  private pedalB = 0;
  private gpSteer = 0;
  private lastGamepadActivity = -Infinity;
  private prevButtons = new Map<number, boolean[]>();
  private wheelRest = new Map<number, number[]>();
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private dragNow = { x: 0, y: 0 };
  private enabled = true;
  private readonly disposers: (() => void)[] = [];
  private getPads: () => Iterable<GamepadLike | null | undefined>;

  constructor(
    private readonly target: HTMLElement,
    private readonly bus: EventBus,
    private readonly settings: Settings,
    opts: { getGamepads?: () => Iterable<GamepadLike | null | undefined>; keyTarget?: EventTarget } = {},
  ) {
    this.getPads = opts.getGamepads ?? (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()) : []));
    const keyTarget = opts.keyTarget ?? (typeof window !== 'undefined' ? window : target);
    const on = <K extends keyof GlobalEventHandlersEventMap>(el: EventTarget, type: K, fn: (e: GlobalEventHandlersEventMap[K]) => void, options?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, options);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, options));
    };
    on(keyTarget, 'keydown', (e) => this.onKeyDown(e));
    on(keyTarget, 'keyup', (e) => this.onKeyUp(e));
    on(keyTarget, 'blur', () => this.releaseAll());
    on(target, 'pointerdown', (e) => this.onPointerDown(e));
    on(target, 'pointermove', (e) => this.onPointerMove(e));
    on(target, 'pointerup', (e) => this.onPointerUp(e));
    on(target, 'pointercancel', (e) => this.onPointerUp(e));
    on(target, 'contextmenu', (e) => e.preventDefault());
  }

  /** Pause key handling (e.g. while a menu owns the keyboard). Held keys are released. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  /** Keep the lever in sync when the vehicle changes the handbrake itself (spawn / respawn). */
  setHandbrake(on: boolean): void {
    this.state.handbrake = on;
  }

  /** Calibration info for the settings UI. */
  describeGamepads(): GamepadDescription[] {
    return describeGamepads(this.getPads(), (i) => this.wheelRest.get(i));
  }

  // ---- DOM handlers ----------------------------------------------------------------

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t || typeof t.tagName !== 'string') return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.enabled || this.isTyping(e)) return;
    const code = e.code;
    if (PREVENT_DEFAULT_KEYS.has(code)) e.preventDefault();
    if (e.repeat) return;
    const p = this.pending;
    const stopped = Math.abs(this.speed) < STOPPED_SPEED;
    if (e.shiftKey && code === 'ArrowUp') {
      p.gearCycle = -1;
      return;
    }
    if (e.shiftKey && code === 'ArrowDown') {
      p.gearCycle = 1;
      return;
    }
    const actions = KEY_TO_ACTIONS.get(code) ?? [];
    for (const a of actions) {
      switch (a) {
        case 'gear_P':
          p.gearRequest = 'P';
          break;
        case 'gear_R':
          p.gearRequest = 'R';
          break;
        case 'gear_N':
          p.gearRequest = 'N';
          break;
        case 'gear_D':
          if (stopped) {
            p.gearRequest = 'D';
            this.keyDAsGear = true;
          }
          break;
        case 'handbrake':
          p.handbrakeToggle = true;
          break;
        case 'indicator_left':
          p.indicatorRequest = 'left';
          break;
        case 'indicator_right':
          p.indicatorRequest = 'right';
          break;
        case 'hazard':
          p.indicatorRequest = 'hazard';
          break;
        case 'lights':
          p.lightsToggle = true;
          break;
        case 'wipers':
          p.wipersToggle = true;
          break;
        case 'ignition':
          p.ignitionToggle = true;
          break;
        case 'seatbelt':
          p.seatbeltToggle = true;
          break;
        case 'glance_left_mirror':
          p.glance = 'left_mirror';
          break;
        case 'glance_rear_mirror':
          p.glance = 'rear_mirror';
          break;
        case 'glance_right_mirror':
          p.glance = 'right_mirror';
          break;
        case 'shoulder_left':
          p.glance = 'left_shoulder';
          break;
        case 'shoulder_right':
          p.glance = 'right_shoulder';
          break;
        case 'acknowledge':
          p.acknowledge = true;
          break;
        case 'pause':
          p.pause = true;
          break;
        case 'help':
          p.help = true;
          break;
        case 'chase_camera':
          p.chaseToggle = true;
          break;
        default:
          break; // held actions are read from the key set
      }
    }
    this.keys.add(code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    if (e.code === 'KeyD') this.keyDAsGear = false;
  }

  private releaseAll(): void {
    this.keys.clear();
    this.keyDAsGear = false;
    this.dragging = false;
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.button !== 0 && e.button !== 2) return;
    this.dragging = true;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragNow = { x: e.clientX, y: e.clientY };
    try {
      this.target.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best effort */
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragNow = { x: e.clientX, y: e.clientY };
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    try {
      this.target.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // ---- per frame ------------------------------------------------------------------

  private held(action: InputAction): boolean {
    for (const [code, actions] of KEY_TO_ACTIONS) {
      if (!actions.includes(action)) continue;
      if (!this.keys.has(code)) continue;
      if (code === 'KeyD' && this.keyDAsGear) continue;
      return true;
    }
    return false;
  }

  private pollGamepad(time: number): MappedInput | null {
    let best: GamepadLike | null = null;
    for (const p of this.getPads()) {
      if (p && p.connected) {
        best = p;
        if (isWheelId(p.id)) break; // a wheel wins over a pad
      }
    }
    if (!best) return null;
    const prev = this.prevButtons.get(best.index);
    let mapped: MappedInput;
    if (isWheelId(best.id)) {
      const cfg = wheelConfigFor(best, this.wheelConfig);
      let rest = this.wheelRest.get(best.index);
      if (!rest) {
        rest = Array.from(best.axes); // pedals assumed released when first seen
        this.wheelRest.set(best.index, rest);
      }
      mapped = mapWheel(best, cfg, rest, prev);
      this.state.source = 'wheel';
    } else {
      mapped = mapStandardGamepad(best, prev);
      if (this.state.source !== 'wheel') this.state.source = 'gamepad';
    }
    this.prevButtons.set(best.index, buttonSnapshot(best));
    const active = Math.abs(mapped.steer) > 0.02 || mapped.throttle > 0.02 || mapped.brake > 0.02 || Math.abs(mapped.lookYaw) > 0.02 || mapped.horn || mapped.gearRequest !== undefined || mapped.indicatorRequest !== undefined;
    if (active) this.lastGamepadActivity = time;
    return mapped;
  }

  update(ctx: SimContext): void {
    const dt = Math.min(ctx.dt > 0 ? ctx.dt : 1 / 60, 0.1);
    const s = this.state;
    this.speed = ctx.player.speed;
    const assist = this.settings.steeringAssist ?? ctx.settings.steeringAssist;

    // clear one-frame fields
    s.gearRequest = undefined;
    s.gearCycle = 0;
    s.indicatorRequest = undefined;
    s.glance = undefined;
    s.lightsToggle = s.wipersToggle = s.ignitionToggle = s.seatbeltToggle = false;
    s.pause = s.help = s.acknowledge = s.chaseToggle = false;

    // keyboard
    const left = this.held('steer_left');
    const right = this.held('steer_right');
    const kbSteer = this.kb.update(dt, left, right, this.speed, assist);
    this.pedalT = rampPedal(this.pedalT, this.held('throttle'), dt, PEDAL_RISE, PEDAL_FALL);
    this.pedalB = rampPedal(this.pedalB, this.held('brake'), dt, PEDAL_RISE * 0.8, PEDAL_FALL);
    let horn = this.held('horn');
    const p = this.pending;
    this.pending = freshPending();
    if (p.handbrakeToggle) s.handbrake = !s.handbrake;

    // gamepad / wheel
    const gp = this.pollGamepad(ctx.time);
    let steer = kbSteer;
    let throttle = this.pedalT;
    let brake = this.pedalB;
    let lookYaw = 0;
    let lookPitch = 0;
    if (gp) {
      const wheel = s.source === 'wheel';
      this.gpSteer = wheel ? gp.steer : smoothAnalog(this.gpSteer, gp.steer, dt, assist);
      const recentlyActive = ctx.time - this.lastGamepadActivity < 2;
      if (recentlyActive && !(left || right)) steer = this.gpSteer;
      throttle = Math.max(throttle, gp.throttle);
      brake = Math.max(brake, gp.brake);
      horn = horn || gp.horn;
      lookYaw = gp.lookYaw;
      lookPitch = gp.lookPitch;
      if (gp.gearRequest) p.gearRequest = gp.gearRequest;
      if (gp.gearUp) p.gearCycle = 1;
      if (gp.gearDown) p.gearCycle = -1;
      if (gp.indicatorRequest) p.indicatorRequest = gp.indicatorRequest;
      if (gp.glance) p.glance = gp.glance;
      p.lightsToggle ||= gp.lightsToggle;
      p.wipersToggle ||= gp.wipersToggle;
      p.ignitionToggle ||= gp.ignitionToggle;
      p.seatbeltToggle ||= gp.seatbeltToggle;
      p.pause ||= gp.pause;
      p.acknowledge ||= gp.acknowledge;
      if (gp.handbrakeToggle) s.handbrake = !s.handbrake;
    } else if (this.keys.size > 0) {
      s.source = 'keyboard';
    }

    // mouse free look while dragging; released → 0 (the camera eases back)
    if (this.dragging) {
      lookYaw = Math.max(-1, Math.min(1, (this.dragNow.x - this.dragStart.x) / MOUSE_YAW_PX));
      lookPitch = Math.max(-1, Math.min(1, -(this.dragNow.y - this.dragStart.y) / MOUSE_PITCH_PX));
    }

    s.steer = steer;
    s.throttle = throttle;
    s.brake = brake;
    s.horn = horn;
    s.lookYaw = lookYaw;
    s.lookPitch = lookPitch;
    s.gearRequest = p.gearRequest;
    s.gearCycle = p.gearCycle;
    s.indicatorRequest = p.indicatorRequest;
    s.lightsToggle = p.lightsToggle;
    s.wipersToggle = p.wipersToggle;
    s.ignitionToggle = p.ignitionToggle;
    s.seatbeltToggle = p.seatbeltToggle;
    s.glance = p.glance;
    s.pause = p.pause;
    s.help = p.help;
    s.acknowledge = p.acknowledge;
    s.chaseToggle = p.chaseToggle;
    if (p.glance) this.bus.emit('input:glance', { target: p.glance, time: ctx.time });
  }

  /** Test / script hook: inject a key press without DOM events. */
  pressKey(code: string, shift = false): void {
    this.onKeyDown({ code, shiftKey: shift, repeat: false, preventDefault() {}, target: null } as unknown as KeyboardEvent);
  }

  releaseKey(code: string): void {
    this.onKeyUp({ code } as KeyboardEvent);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.releaseAll();
  }
}
