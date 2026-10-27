/**
 * Per-way attributes derived from OSM tags (everything the builder needs for a road,
 * plus a few pipeline-only fields). Two consecutive way segments are merged into one
 * road only when their `attrsKey` is identical.
 */
import { ROAD_DEFAULTS, type KerbMarking, type Road, type RoadClass, type Turn } from '@/world/schema';
import type { Tags } from './parse';
import { exclusionReason, kerbOfParking, namesOf, parseLanes, parseMaxspeed, parseOneway, parseParking, roadClassOf, sidewalksOf, zoneOf, type ParkingInfo } from './tags';

export interface WayAttrs {
  cls: RoadClass;
  link: boolean;
  name?: string;
  nameEn?: string;
  oneway: boolean;
  lanesForward: number;
  lanesBackward: number;
  laneWidth?: number;
  maxSpeed: number;
  /** maxspeed came from a tag (vs. the class default). */
  maxSpeedExplicit: boolean;
  turnLanesForward?: (Turn[] | null)[];
  turnLanesBackward?: (Turn[] | null)[];
  busLaneForward: boolean;
  busLaneBackward: boolean;
  kerbLeft: KerbMarking;
  kerbRight: KerbMarking;
  parkingLeft?: ParkingInfo;
  parkingRight?: ParkingInfo;
  zone: Road['zone'];
  sidewalkLeft: boolean;
  sidewalkRight: boolean;
  bridge: boolean;
  tunnel: boolean;
  lit: boolean;
  roundabout: boolean;
  /** access=no/private but open to buses (kept per spec; see stats TODO). */
  busOnly: boolean;
  layer: number;
}

/** Collects tag values the pipeline did not understand (reported in world-stats.json). */
export class UnknownCollector {
  readonly counts = new Map<string, Map<string, number>>();
  add(category: string, value: string): void {
    let m = this.counts.get(category);
    if (!m) {
      m = new Map();
      this.counts.set(category, m);
    }
    m.set(value, (m.get(value) ?? 0) + 1);
  }
  toJSON(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [cat, m] of this.counts) {
      const entries = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
      out[cat] = Object.fromEntries(entries);
    }
    return out;
  }
}

function defaultMaxSpeed(cls: RoadClass, link: boolean, zone: Road['zone']): number {
  if (zone !== 'none') return 30;
  // ramps and slip roads are never signed at the motorway limit
  if (link && (cls === 'motorway' || cls === 'trunk')) return 60;
  return ROAD_DEFAULTS[cls].maxSpeed;
}

/**
 * Attributes of a drivable way, or undefined when the way is excluded. For
 * oneway=-1 the caller reverses the node order and the attributes are returned as
 * if the way had been drawn in the direction of travel (see `reverseAttrs`).
 */
export function wayAttrsOf(tags: Tags, unknown: UnknownCollector): { attrs: WayAttrs; reversed: boolean } | undefined {
  const reason = exclusionReason(tags);
  if (reason) {
    if (reason === 'highway') unknown.add('excluded_highway', tags.highway ?? '?');
    else if (reason === 'service') unknown.add('excluded_service', tags.service ?? '?');
    else if (reason === 'access') unknown.add('excluded_access', `${tags.access ?? ''}/${tags.motor_vehicle ?? ''}`);
    else unknown.add('excluded_other', reason);
    return undefined;
  }
  const { cls, link } = roadClassOf(tags)!;
  const ow = parseOneway(tags);
  const oneway = ow !== 'no';
  const ms = parseMaxspeed(tags);
  if (ms.unknown) unknown.add('maxspeed', ms.unknown);
  const zone = zoneOf(tags, cls, ms.value);
  const lanes = parseLanes(tags, cls, link, oneway);
  for (const t of lanes.unknownTurns) unknown.add('turn:lanes', t);
  const names = namesOf(tags);
  const sw = sidewalksOf(tags, cls);
  const parkingLeft = parseParking(tags, 'left');
  const parkingRight = parseParking(tags, 'right');
  const total = Number(tags.lanes);
  const layer = Number(tags.layer);
  const psv = tags.psv ?? tags.bus;
  const busOnly = (tags.access === 'no' || tags.access === 'private' || tags.motor_vehicle === 'no' || tags.motor_vehicle === 'private') && (psv === 'yes' || psv === 'designated');
  let attrs: WayAttrs = {
    cls,
    link,
    name: names.name,
    nameEn: names.nameEn,
    oneway,
    lanesForward: lanes.lanesForward,
    lanesBackward: oneway ? 0 : lanes.lanesBackward,
    laneWidth: !oneway && total === 1 ? 2.6 : undefined,
    maxSpeed: ms.value ?? defaultMaxSpeed(cls, link, zone),
    maxSpeedExplicit: ms.value !== undefined,
    turnLanesForward: lanes.turnLanesForward,
    turnLanesBackward: oneway ? undefined : lanes.turnLanesBackward,
    busLaneForward: lanes.busLaneForward,
    busLaneBackward: oneway ? false : lanes.busLaneBackward,
    kerbLeft: kerbOfParking(parkingLeft),
    kerbRight: kerbOfParking(parkingRight),
    parkingLeft,
    parkingRight,
    zone,
    sidewalkLeft: sw.left,
    sidewalkRight: sw.right,
    bridge: !!tags.bridge && tags.bridge !== 'no',
    tunnel: !!tags.tunnel && tags.tunnel !== 'no',
    lit: tags.lit !== 'no',
    roundabout: tags.junction === 'roundabout' || tags.junction === 'circular',
    busOnly,
    layer: Number.isFinite(layer) ? layer : 0,
  };
  if (ow === '-1') attrs = reverseAttrs(attrs);
  return { attrs, reversed: ow === '-1' };
}

/** Attributes seen from the opposite geometry direction (left↔right, forward↔backward). */
export function reverseAttrs(a: WayAttrs): WayAttrs {
  return {
    ...a,
    lanesForward: a.oneway ? a.lanesForward : a.lanesBackward,
    lanesBackward: a.oneway ? 0 : a.lanesForward,
    turnLanesForward: a.oneway ? a.turnLanesForward : a.turnLanesBackward,
    turnLanesBackward: a.oneway ? undefined : a.turnLanesForward,
    busLaneForward: a.oneway ? a.busLaneForward : a.busLaneBackward,
    busLaneBackward: a.oneway ? false : a.busLaneForward,
    kerbLeft: a.kerbRight,
    kerbRight: a.kerbLeft,
    parkingLeft: a.parkingRight,
    parkingRight: a.parkingLeft,
    sidewalkLeft: a.sidewalkRight,
    sidewalkRight: a.sidewalkLeft,
  };
}

/** True when the attributes are the same in both directions (so a segment may be flipped when merging). */
export function attrsSymmetric(a: WayAttrs): boolean {
  if (a.oneway) return false;
  return a.lanesForward === a.lanesBackward && !a.turnLanesForward && !a.turnLanesBackward && a.busLaneForward === a.busLaneBackward && a.kerbLeft === a.kerbRight && a.sidewalkLeft === a.sidewalkRight && (a.parkingLeft?.kind ?? '') === (a.parkingRight?.kind ?? '');
}

export function attrsKey(a: WayAttrs): string {
  return JSON.stringify([
    a.cls,
    a.link,
    a.name ?? '',
    a.nameEn ?? '',
    a.oneway,
    a.lanesForward,
    a.lanesBackward,
    a.laneWidth ?? 0,
    a.maxSpeed,
    a.turnLanesForward ?? null,
    a.turnLanesBackward ?? null,
    a.busLaneForward,
    a.busLaneBackward,
    a.kerbLeft,
    a.kerbRight,
    a.parkingLeft?.kind ?? '',
    a.parkingRight?.kind ?? '',
    a.zone,
    a.sidewalkLeft,
    a.sidewalkRight,
    a.bridge,
    a.tunnel,
    a.lit,
    a.roundabout,
    a.busOnly,
    a.layer,
  ]);
}
