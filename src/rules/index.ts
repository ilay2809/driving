/**
 * Rules engine — public API.
 *
 *   const localiser = new Localiser(graph);            // System: writes ctx.localisation
 *   const judge = new Judge(graph, bus, { coachPresent: true });   // System: emits 'violation'
 *   systems = [input, vehicle, localiser, signals, traffic, judge, …]
 *
 *   judge.history / judge.summary() / judge.scorer   — results for the examiner & result sheet
 *   judge.setExpectedTurn('n11', 'right'), judge.setExpectedStop(pos, 8) — navigator / examiner hooks
 *   judge.parkingReport(ctx)                         — {legal, reasons, kerbDistance, angleDeg}
 *
 * Tests: ScriptedDrive / ScriptedAgent / makeTestContext / runDrive (src/rules/scripted.ts).
 */
export { Localiser, currentApproach, upcomingCrossings, distanceToStopLine, laneAlong } from './localiser';
export type { ApproachInfo, CrossingAhead } from './localiser';
export { Judge } from './judge';
export type { JudgeOptions } from './judge';
export type { JudgeApi, Detector, ReportOptions, CollisionEvent } from './api';
export { RulesScorer } from './scoring';
export type { ScoreSummary, Rubric } from './scoring';
export { ScriptedDrive, ScriptedAgent, StubSignals, makeTestContext, runDrive, runScenario, timeToFirstStop, typesOf, nonInfo } from './scripted';
export type { PathSegment, SpeedPoint, DriveEvent, ScriptedDriveOptions, ScriptedAgentOptions, TestContext, TestContextOverrides, RunOptions, ScenarioOptions, ScenarioResult } from './scripted';
export { THRESHOLDS as thresholds, THRESHOLDS } from './thresholds';
export { parkingReport } from './detectors/parking';
export type { ParkingReport } from './detectors/parking';
export type { ExpectedTurn, ExpectedStop } from './detectors/instructions';
export { requiredIndicator, turnClass, isLeftTurn, isRightTurn } from './turns';
export { atStreet, atJunction, junctionDisplayName, HE } from './strings.he';
export * from './violations';
