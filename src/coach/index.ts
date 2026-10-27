/**
 * Coach layer — public API.
 *
 * Wiring (integration layer / modes):
 *
 *   const dialogue = new DialogueManager(bus, settings);          // WebSpeechTts when available
 *   await dialogue.lines.load();                                  // optional data/content/dialogue.json
 *   const navigator = new Navigator(graph, bus, dialogue);
 *   const instructor = new Instructor(bus, dialogue, graph, { navigator });
 *   const runner = new LessonRunner(bus, dialogue, navigator, instructor, graph, { questionLookup: theory.lookup, onTimeScale });
 *   const examiner = new Examiner(bus, dialogue, graph, navigator, { route, routeId });
 *   systems: [..., rules, navigator, instructor | examiner, runner, dialogue, profile, ...]
 *
 * Everything the coach says goes through 'coach:say' / 'coach:said' on the bus (the UI
 * renders subtitles); navigation is published as 'coach:instruction' every tick.
 */
export { DialogueManager, type DialogueOptions } from './dialogue';
export { WebSpeechTts, SilentTts, chunkSentences, estimateSpeechSeconds, type TtsBackend, type WebSpeechOptions } from './tts';
export { LineTable, substitute, type LineParams } from './lines';
export { STRINGS_HE, type LineDef } from './strings.he';
export { Navigator, roundDistance, type NavManeuver, type Destination, type RouteOptions, type NavigatorOptions, type DeviationInfo } from './navigator';
export { RouteModel, type RouteSegment, type RouteLocation } from './routeModel';
export { Instructor, type InstructorOptions, type Verbosity } from './instructor';
export { Examiner, legalKerbAt, type ExaminerOptions, type ExaminerPhase, type PlannedManeuver } from './examiner';
export { TestScorer, CATEGORY_OF, CATEGORIES, type Rubric, type ViolationCategory } from './scoring';
export { LessonRunner, type LessonRunnerOptions, type RunnerState, type StepState, type LessonProgress } from './lessonRunner';
export { TheoryEngine, EXAM_DEFAULTS, type PickOptions, type TheoryStats, type ExamState, type ExamResult } from './theory';
export { Profile, ProfileDataSchema, MemoryStore, LocalStorageStore, createIdbStore, defaultStore, emptyProfileData, PROFILE_KEY, PROFILE_VERSION, type ProfileData, type ProfileStore, type TheoryEntry } from './profile';
export { predictDanger, distanceToCrossing, stoppingDistance, agentBehind, type DangerOptions } from './danger';
export { ParkingMonitor, estimateParking, kerbLegality, legalKerbStretches, type KerbLegality } from './parking';
export { coarseTurn, type ManeuverKind, type NavKind, type ParkingReport, type ParkingReporter, type DangerKind, type DangerPrediction, type TestVerdict } from './types';
export * from './lessonSchema';
