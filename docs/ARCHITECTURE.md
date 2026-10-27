# Architecture & contributor guide

Browser-based 3D driving-school simulator for the Israeli class-B licence (automatic
car, right-hand traffic, left-hand-drive car). Hebrew UI (RTL). World = North Tel Aviv
(north of the Yarkon) rebuilt from OpenStreetMap + Tel Aviv municipal GIS.

Stack: **Vite + TypeScript + three.js + @dimforge/rapier3d-compat + zod**; HTML/CSS overlay
UI; Web Speech API for the instructor's voice (always with subtitles); Vitest unit
tests; Playwright e2e (headless Chromium with SwiftShader WebGL). Deployed as a static
site (GitHub Pages).

## Commands

```
pnpm dev            # vite dev server
pnpm build          # production build → dist/
pnpm preview        # serve dist/ on :4173
pnpm typecheck      # tsc for src + tools
pnpm lint           # eslint
pnpm test           # vitest (src/**/*.test.ts, tools/**/*.test.ts)
pnpm e2e            # playwright (builds must exist: run pnpm build first)
pnpm check          # typecheck + lint + test  ← must pass before every commit
pnpm world:all      # fetch OSM + TLV GIS (cached in data/raw) and build public/world/north-tlv.json.gz
pnpm content:theory # import the official theory question bank
pnpm content:signs  # build the sign catalogue + SVGs
```

Headless note: `NODE_USE_ENV_PROXY=1` is required for node scripts that fetch over HTTPS
in the cloud build environment.

## Layout & module ownership

```
src/
  core/      events.ts (EventBus), types.ts (VehicleState, TrafficAgentState, Localisation…),
             sim.ts (SimContext, System, FixedStep, createRng, Settings)      ← SHARED CONTRACTS
  world/     geo.ts, schema.ts, builder.ts, graph.ts, testWorld.ts            ← SHARED CONTRACTS
             loader.ts, render/ (WorldRenderer: roads, markings, buildings, props, signals, signs, env)
  vehicle/   physics (Rapier raycast vehicle), transmission, input (keyboard/gamepad/wheel),
             camera (POV + head look + mirror glances), mirrors (render targets), dashboard model, audio
  traffic/   signals.ts (SignalStateProvider), TrafficSystem (NPC vehicles: IDM + lane following,
             lane changes, yielding via connector.yieldTo + signals), pedestrians, spawner
  rules/     violations.ts (SHARED), localiser.ts, judge.ts + detectors/* (produce `violation` events)
  coach/     lessonSchema.ts (SHARED), dialogue.ts (DialogueManager + TTS + subtitles),
             navigator.ts (turn-by-turn from a path), instructor.ts, examiner.ts (rubric, intervention),
             lessonRunner.ts (interprets the DSL), theory.ts (quiz engine)
  modes/     menu, lesson, free, test, theory, trainingGround
  ui/        HUD (speed, gear, indicators, speed-limit sign, law monitor), subtitles, minimap,
             menus/screens (RTL Hebrew), result sheet, settings, styles.css
  content/   schema.ts (SHARED) + typed loaders for data/content/*.json
tools/
  world/     area.ts, fetch-osm.ts, fetch-tlv.ts, osm/ (parse + semantics → BuildInput),
             build-world.ts, overrides, debug-viewer (2D canvas HTML for validation)
  content/   import-theory.ts, build-signs.ts
data/
  raw/       git-ignored caches (OSM tiles, GIS layers)
  overrides/ hand-authored patches: junction controls, extra signs, spawn points, routes
  content/   lessons/*.json, signs.json, theory.json, rules.json, dialogue.json
public/
  world/     north-tlv.json.gz (generated), signs/*.svg, audio/, theory/
docs/        SPEC.md (אפיון), ARCHITECTURE.md, DATA_SOURCES.md
```

Each module lives in its own folder and only imports from `src/core`, `src/world` (geo,
schema, graph, builder, testWorld) and its own folder, unless stated otherwise. The
integration layer (`src/app.ts`, `src/modes/*`) is the only place that wires modules
together.

## Conventions (read before coding)

- **Coordinates & headings**: `src/world/geo.ts`. +x east, +z south, y up, metres.
  Heading `h` is the math angle of the forward vector in the x/z plane (east = 0, north = -π/2);
  `headingToRotationY(h)` converts to `Object3D.rotation.y`. The right-hand side of travel is `h + π/2`.
  Positive lateral offset = right of travel direction.
- **Units**: metres, seconds, m/s inside the simulation; km/h only at the UI/content boundary
  (`kmhToMps`, `mpsToKmh`).
- **Determinism**: no `Math.random()` in simulation code — use `createRng(seed)` from `src/core/sim.ts`.
  All time comes from `SimContext.time` / `dt`.
- **Events**: publish through `EventBus` (`src/core/events.ts`); never reach into another system
  to notify it. Rules publish `violation`; coach publishes `coach:say`; UI listens.
- **Hebrew text** goes into content JSON (`data/content`) or `src/**/strings.he.ts`, not inline in logic.
  Keep strings short and spoken-style for the instructor.
- **zod schemas are the contracts**. Validate every JSON file at load (`parseWorld`, `parseLessons`, …).
- **No new dependencies** unless indispensable; if you add one, say so in your final report.
- **Tests**: pure logic (rules, traffic, navigator, lesson runner, builder) must have Vitest tests
  that run in node using `buildTrainingGround()` as the world. Rendering code: keep it thin and
  behind interfaces so it can be stubbed.
- **Performance targets**: 60 fps on a mid-range laptop. Merge static geometry per 250 m tile;
  `InstancedMesh` for trees/lamps/signs; ≤ 150 draw calls in view; traffic ≤ 60 vehicles + 40
  pedestrians simulated, only the nearest ~25 rendered with full detail.
- Run `pnpm check` before you finish. Do not commit `dist/` or `data/raw/`.

## Shared contracts (summary)

- `WorldFile` (`src/world/schema.ts`): roads → lanes (directed, lane-level polylines in travel
  direction, index 0 = leftmost), junctions (approaches with `control`, `stopLine`, `crossingId`,
  `signalGroup`; exits; `connectors`), connectors (paths through junctions with `turn`,
  `yieldTo`, `crossings`, `signalGroup`), signal controllers (groups + phases; runtime adds
  transitions per `SIGNAL_TIMING`), crossings, signs (Israeli catalogue codes), parking strips
  (kerb colours), buildings, areas, props, spawn points, routes.
- `RoadGraph` (`src/world/graph.ts`): `nearestLane(pos, {heading})`, `nearestConnector`,
  `approachOf(laneId)`, `connectorsFrom`, `siblingLanes`, `laneAt`, `findPath`, `routeViaJunctions`,
  `insideJunction`, `crossingsByLane`, `signsByLane`, `signalGroups`.
- `buildWorld(BuildInput)` (`src/world/builder.ts`): the ONLY way to produce a WorldFile.
  The OSM pipeline must produce a `BuildInput` (nodes, roads with attributes, crossings, signs,
  parking, buildings, areas, props, spawn points, routes).
- `SimContext` / `System` (`src/core/sim.ts`): every runtime module is a `System` with
  `update(ctx)`. `SignalStateProvider` is the traffic module's signal API used by rules/coach/renderer.
- `VehicleState`, `TrafficAgentState`, `Localisation` (`src/core/types.ts`).
- `Violation` / `VIOLATIONS` (`src/rules/violations.ts`): Hebrew labels, advice, severity, cooldown.
- Lesson DSL (`src/coach/lessonSchema.ts`): briefing slides, steps with `done`/`fail` conditions,
  triggers → actions (say/hint/highlight/brake/spawn/set_signal…), quiz hooks.
- Content (`src/content/schema.ts`): theory questions, sign catalogue, rule articles, dialogue lines.

## Frame loop (integration)

```
const systems: System[] = [input, vehicle, localiser, signals, traffic, judge, coach, mode, ui];
each frame: ctx.dt = clamp(realDt, 0, 0.1) * timeScale; if (!paused) ctx.time += ctx.dt;
            for (s of systems) s.update(ctx);  renderer.render(ctx);
```

The vehicle system runs Rapier with `FixedStep` (60 Hz) and writes `ctx.player`.
The localiser writes `ctx.localisation`. Traffic exposes `ctx.traffic` (array of
`TrafficAgentState`) and `ctx.signals`. The judge reads all of these and emits `violation`.
The coach turns violations, navigation and lesson scripts into `coach:say` and HUD hints.

## Israeli rules the simulation encodes (reference for rules/content/traffic)

- Right-hand traffic; default urban speed limit 50 km/h, 30 in traffic-calmed zones (sign 222/426).
- Stop sign (302): full stop before the stop line; give way (301); roundabout entry (303) yields to
  traffic inside the roundabout; without signs, yield to the vehicle coming from the right
  (תקנה 64); a left-turner yields to oncoming traffic going straight or right.
- Traffic lights (701–706): red = stop before the line; red+amber = prepare, do not move;
  green; flashing green = green is ending; amber = stop unless unsafe; flashing amber = proceed
  with caution. Pedestrian signals 718/719.
- Pedestrian crossings: a pedestrian waiting to cross or crossing has priority (תקנה 67).
- Signalling before every turn, lane change, pulling out and stopping at the kerb; mirror and
  shoulder checks before lane changes and pulling out.
- Parking: no parking on red-white kerb, within 12 m of a junction, on/near a crossing (12 m
  before), at a bus stop (red-yellow), on a sidewalk; blue-white = paid/regulated.
- Bus lanes (yellow, 501/613): no entry for private cars. One-way (618) / no entry (402).
- Following distance ≥ 2 s (3 s in rain). Seat belt always. Headlights in low visibility.
- The practical test ("טסט") lasts ≈ 20–30 min; the examiner gives route instructions, asks for
  manoeuvres (parking, reversing, pulling over, U-turn, emergency stop) and fails the candidate
  on a critical error or when the examiner has to intervene.
