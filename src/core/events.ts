/**
 * Typed, synchronous event bus. One instance per simulation session.
 *
 * Systems publish facts; nobody calls across modules directly for notifications.
 */
import type { Violation } from '@/rules/violations';
import type { Gear, GlanceEvent, Indicator, SimMode, VehicleState } from './types';

export type Speaker = 'instructor' | 'examiner' | 'system';

export interface SpeechRequest {
  id: string;
  who: Speaker;
  text: string;
  /** 0 = chit-chat … 3 = safety-critical (interrupts current speech). */
  priority: 0 | 1 | 2 | 3;
  /** If set, the request is dropped when the same key was spoken within `cooldown` seconds. */
  key?: string;
  cooldown?: number;
  /** Extra seconds to keep the subtitle visible after speech ends. */
  linger?: number;
}

export interface NavInstruction {
  /** e.g. 'turn_right', 'turn_left', 'straight', 'roundabout_exit', 'stop_here', 'park', 'uturn', 'pull_over', 'reverse' */
  kind: string;
  text: string;
  /** Distance from the car to the manoeuvre point (m). */
  distance: number;
  junctionId?: string;
  exitNumber?: number;
  streetName?: string;
}

export interface SimEventMap {
  /** A violation / observation produced by the rules engine. */
  violation: Violation;
  /** Vehicle state snapshot each tick (for UI; systems usually read state directly). */
  'vehicle:tick': VehicleState;
  'vehicle:indicator': { indicator: Indicator; time: number };
  'vehicle:gear': { gear: Gear; time: number };
  'vehicle:collision': { with: 'kerb' | 'vehicle' | 'pedestrian' | 'object' | 'building'; impulse: number; pos: [number, number]; time: number };
  'vehicle:horn': { time: number };
  'input:glance': GlanceEvent;
  /** The coach wants something spoken / shown. */
  'coach:say': SpeechRequest;
  /** Speech finished (or was skipped). */
  'coach:said': { id: string };
  'coach:instruction': NavInstruction;
  /** The examiner / instructor pressed the dual brake (or grabbed the wheel). */
  'coach:intervention': { kind: 'brake' | 'wheel'; reason: string; time: number };
  'mode:changed': { mode: SimMode };
  'lesson:step': { lessonId: string; stepId: string; index: number; total: number };
  'lesson:completed': { lessonId: string; passed: boolean; score: number };
  'test:started': { routeId: string };
  'test:finished': { passed: boolean; points: number; violations: Violation[]; durationSec: number };
  'theory:answered': { questionId: string; correct: boolean };
  /** Generic request from lesson scripts / coach to other systems (traffic, signals, renderer, vehicle). */
  'coach:request': { kind: 'spawn_vehicle' | 'spawn_pedestrian' | 'set_signal' | 'highlight' | 'slow_motion' | 'brake' | 'clear_traffic'; payload: Record<string, unknown> };
  'lesson:briefing': { lessonId: string; title: string; slides: { title: string; text: string; signs: string[]; diagram?: string }[] };
  'lesson:hint': { text: string; icon?: string; seconds: number };
  'lesson:highlight': { target: string; seconds: number };
  /** The user pressed "continue" / closed a modal (context tells what was acknowledged). */
  'ui:acknowledged': { context: string };
  'theory:question': { questionId: string; text: string; answers: string[]; image: string | null };
  'theory:answer': { questionId: string; index: number };
  'examiner:maneuver': { kind: 'parallel_park' | 'pull_over' | 'reverse' | 'uturn' | 'emergency_stop' | 'hill_start'; text: string; status: 'requested' | 'completed' | 'failed' };
  'world:loaded': { name: string; lanes: number; junctions: number };
  'sim:paused': { paused: boolean };
  'sim:reset': { reason: string };
}

export type SimEventName = keyof SimEventMap;
export type Handler<K extends SimEventName> = (payload: SimEventMap[K]) => void;

export class EventBus {
  private handlers: { [K in SimEventName]?: Set<Handler<K>> } = {};

  on<K extends SimEventName>(name: K, handler: Handler<K>): () => void {
    let set = this.handlers[name] as Set<Handler<K>> | undefined;
    if (!set) {
      set = new Set();
      (this.handlers as any)[name] = set;
    }
    set.add(handler);
    return () => this.off(name, handler);
  }

  once<K extends SimEventName>(name: K, handler: Handler<K>): () => void {
    const off = this.on(name, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  off<K extends SimEventName>(name: K, handler: Handler<K>): void {
    (this.handlers[name] as Set<Handler<K>> | undefined)?.delete(handler);
  }

  emit<K extends SimEventName>(name: K, payload: SimEventMap[K]): void {
    const set = this.handlers[name] as Set<Handler<K>> | undefined;
    if (!set) return;
    for (const h of Array.from(set)) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[events] handler for ${String(name)} threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers = {};
  }
}
