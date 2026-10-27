# Integration notes (app shell, modes, wiring decisions)

This file records how the independently built modules are wired together in
`src/app.ts` / `src/modes/*`, and the decisions that resolve overlaps between them.

## Frame order

`input → vehicle → localiser → signals → traffic → judge → coach systems → mode → ui`
then `mirrors.render()` and the main render (`WorldRenderer.update(cameraPos)` first).

## Single sources of truth

| Concern | Owner | Notes |
|---|---|---|
| `ctx.player` | `PlayerVehicle` | written every frame |
| `ctx.localisation` | `Localiser` (rules) | mutated in place |
| `ctx.traffic` | `TrafficSystem.agents` | assigned each frame |
| `ctx.signals` | `SignalSystem` (traffic) | also given to `WorldRenderer.setSignalProvider` |
| Violations | `Judge` (rules) | **Examiner** additionally emits `EXAMINER_INTERVENTION`, `WRONG_TURN`, `MISSED_INSTRUCTION` in test mode; the Judge's `InstructionsDetector` is therefore NOT fed (`setExpectedTurn` unused) in test mode to avoid double counting. In lessons the Navigator's deviation callback is informational only. |
| Dual brake | `Instructor` / `Examiner` emit `coach:intervention`; `PlayerVehicle` applies the brake | only one coach system is active per mode |
| Theory answers | `TheoryEngine.answer()` records to the profile; lesson quizzes go through `LessonRunner` → `theory:answered` events (Profile attached with `theoryEvents: true`). In theory mode the app must NOT also emit `theory:answered` for engine answers. |
| Parking legality | `Judge.parkingReport` → passed to `Examiner.setParkingReporter` and `LessonRunner.setParkingReporter` so the coach uses the rules engine's verdict |
| Time scale | `GameLoop.setTimeScale` ← `LessonRunner` `onTimeScale` callback |
| Reset / respawn | `sim:reset` {reason} → `PlayerVehicle` teleports to the current spawn; the mode re-arms the lesson step |

## `coach:request` payloads (coach → traffic/signals/renderer)

- `spawn_vehicle` { where, distance, speedKmh, vehicle, parked?, side?, laneId? } — the Examiner
  requests two parked cars (`parked: true, side: 'right', speedKmh: 0, laneId`) to create a
  parallel-parking gap; traffic must honour `parked` (spawn a stationary car at the kerb side
  of `laneId`, `distance` m ahead of the player).
- `spawn_pedestrian` { crossingId?, nearest? }
- `set_signal` { junctionId?, controllerId?, groupId?, state }
- `slow_motion` { factor, seconds } (also delivered via the `onTimeScale` callback)
- `clear_traffic` {}
- `highlight` { target, seconds } → UI

## Modes

- **menu**: no world systems running; UI screens only.
- **lesson**: world = lesson.world (training-ground or north-tlv), spawn = lesson.spawnId, traffic from
  lesson.traffic, hour/weather from the lesson; systems: Instructor (verbosity high, focus =
  lesson steps' focus, muted until the first step so the greeting comes first), LessonRunner
  (questionLookup = TheoryEngine.lookup), Navigator; on `lesson:completed` → Profile.recordLesson
  (via Profile.attach) + `profile.save()` + debrief screen (violations since the first step).
  `lesson.startAtKerb` moves the spawned car to the right-hand kerb (pull-out practice; the pose
  becomes the respawn pose). Enter (`input.acknowledge`) → `ui:acknowledged` {context:'continue'}
  for steps with an `acknowledged` condition. Quiz questions: asked at step start when `done`
  waits for `quiz_answered`, otherwise once the rest of `done` holds; 2.5 s between questions.
  `lesson:step` carries the step `title` (HUD pill) and is emitted before the step's hint, so the
  UI clears the previous step's hints on it.
- **free**: spawn chosen in the setup screen; coachPresent toggles the Instructor; "law monitor"
  shows violations even without the instructor; optional "police" (future).
- **test**: route = one of the world's `routes` of kind 'test' (random unless chosen); Examiner with
  the route path (`graph.routeViaJunctions(startLane, waypoints)`), coachPresent = true, instructor
  absent; `test:finished` → Profile.recordTest + result sheet.
- **theory**: no 3D; TheoryEngine + quiz screens; sign library; rule book.
- **training_ground**: free drive on the synthetic town with the instructor.

## Loading

Boot: settings → Profile.getOrCreate → content (lessons/signs/theory/dialogue lazily) → renderer
created once (WebGLRenderer on #scene) → mode start loads the world (`loadWorld` or
`loadTrainingGround`), builds `RoadGraph`, physics + colliders, `WorldRenderer`, traffic, coach.
Switching modes disposes the world-bound systems.
