/**
 * NPC traffic module — public entry point.
 *
 *   import { SignalSystem, TrafficSystem, TrafficRenderer } from '@/traffic';
 *   const signals = new SignalSystem(world, graph);
 *   const traffic = new TrafficSystem(world, graph, bus, signals, { seed: 1, density: 0.5, pedestrians: 0.4 });
 *   const renderer = new TrafficRenderer(scene);      // three.js only (not used in node tests)
 *   frame: signals.update(ctx); traffic.update(ctx); renderer.update(traffic.agents, ctx.dt);
 */
export { SignalSystem, buildControllerPlan, PEDESTRIAN_FLASH_SECONDS } from './signals';
export { TrafficSystem, type TrafficOptions, type TrafficStats } from './TrafficSystem';
export { TrafficRenderer } from './render';
export type { TrafficAgentView, HoldReason } from './agents';
export type { SpawnWhere, SpawnVehicleOptions } from './spawner';
export { VehicleAgent, yieldConflicts } from './vehicles';
export { PedestrianAgent, crossingSafe } from './pedestrians';
export { TrafficNetwork } from './network';
export { SidewalkNetwork } from './sidewalks';
export * from './constants';
export { createTrafficHarness, localisePlayer, type TrafficHarness } from './harness';
