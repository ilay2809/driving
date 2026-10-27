/**
 * Vehicle module — the player's car.
 *
 * Wiring (see src/dev/vehicle.ts for a complete example):
 *   const physics = await createPhysics();            // Rapier, 60 Hz FixedStep
 *   physics.addGroundPlane(); physics.addWorldColliders(world);
 *   const vehicle = new PlayerVehicle(physics, scene, bus, spawn);
 *   const input = new InputSystem(canvas, bus, settings); vehicle.bindInput(input);
 *   const rig = new CameraRig(camera, { originHeight: vehicle.body.restHeight });
 *   const mirrors = new MirrorSystem({ enabled: settings.mirrors });
 *   mirrors.attach(vehicle.model.mirrorGlass, vehicle.model.root);
 *   const audio = new VehicleAudio(settings, bus);
 *   each frame: input.update(ctx); vehicle.update(ctx);
 *               rig.update(ctx.dt, ctx.player, input.state, vehicle.pose);
 *               mirrors.render(renderer, scene); renderer.render(scene, camera);
 *               audio.update(ctx.player, { slip: vehicle.body.slip, time: ctx.time, indicatorSince: vehicle.body.indicators.since });
 */
export { createPhysics, PhysicsWorld, PHYSICS_STEP, quatFromHeading, quatFromRotY, RAPIER } from './physics';
export type { ColliderTag, CollisionRecord, CollisionListener } from './physics';
export { PlayerVehicle, DUAL_BRAKE_SECONDS, isNight } from './PlayerVehicle';
export type { PlayerVehicleOptions } from './PlayerVehicle';
export { VehicleBody, DEFAULT_VEHICLE_SPEC } from './VehicleBody';
export type { VehicleSpec, WheelPose, VehicleControls, SpawnOptions } from './VehicleBody';
export { InputSystem, emptyInputState } from './input';
export type { InputState, InputSource } from './input';
export { CameraRig, DEFAULT_CAMERA_OPTIONS, GLANCE_PRESETS } from './camera';
export type { CameraMode, CameraRigOptions, CameraInput, CarPose } from './camera';
export { MirrorSystem, DEFAULT_MIRROR_PLACEMENTS, flipUVsHorizontally } from './mirrors';
export type { MirrorSurfaces, MirrorName, MirrorPlacement } from './mirrors';
export { CarModel } from './CarModel';
export type { CarModelOptions, WheelVisual, CarModelFrame } from './CarModel';
export { DashboardTexture } from './dashboard';
export { VehicleAudio } from './audio';
export type { AudioFrameInfo } from './audio';
export { KEYMAP, KEY_TO_ACTIONS, PREVENT_DEFAULT_KEYS } from './keymap';
export type { InputAction, KeyBinding, KeyGroup } from './keymap';
export { ACTION_LABELS_HE, GROUP_LABELS_HE, KEY_LABELS_HE, GAMEPAD_LABELS_HE } from './strings.he';
export { describeGamepads, isWheelId, DEFAULT_WHEEL_CONFIG } from './gamepad';
export type { GamepadDescription, GamepadLike, WheelConfig } from './gamepad';
export { Drivetrain, DEFAULT_DRIVETRAIN, engineTorque, rpmFromSpeed, speedFromRpm, selectGear } from './drivetrain';
export type { DrivetrainSpec, DrivetrainInput, DrivetrainOutput } from './drivetrain';
export { IndicatorLogic, indicatorLampOn, INDICATOR_BLINK_HZ } from './indicator';
export { KeyboardSteering, keyboardMaxSteer, keyboardSteerRate } from './steering';
export { kerbSegments, buildingHulls, propColliders, worldColliderSpecs, KERB_HEIGHT, KERB_WIDTH } from './colliders';
export type { ColliderSpec, ColliderKind, BoxSpec, CylinderSpec, HullSpec } from './colliders';
