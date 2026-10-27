/**
 * Interpretation of OSM tags for the simulator: which ways are drivable, how many
 * lanes they have, turn lanes, speed limits, parking / bus lanes, names, and the
 * kinds of buildings and areas. Pure functions over tag maps.
 */
import { ROAD_DEFAULTS, type Area, type Building, type KerbMarking, type Road, type RoadClass, type Turn } from '@/world/schema';
import type { Tags } from './parse';

export const ALL_TURNS: Turn[] = ['straight', 'left', 'right', 'slight_left', 'slight_right', 'sharp_left', 'sharp_right', 'uturn'];

const HIGHWAY_CLASS: Record<string, { cls: RoadClass; link: boolean }> = {
  motorway: { cls: 'motorway', link: false },
  trunk: { cls: 'trunk', link: false },
  primary: { cls: 'primary', link: false },
  secondary: { cls: 'secondary', link: false },
  tertiary: { cls: 'tertiary', link: false },
  unclassified: { cls: 'unclassified', link: false },
  residential: { cls: 'residential', link: false },
  living_street: { cls: 'living_street', link: false },
  service: { cls: 'service', link: false },
  motorway_link: { cls: 'motorway', link: true },
  trunk_link: { cls: 'trunk', link: true },
  primary_link: { cls: 'primary', link: true },
  secondary_link: { cls: 'secondary', link: true },
  tertiary_link: { cls: 'tertiary', link: true },
};

const EXCLUDED_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through', 'drive_through', 'emergency_access']);

export function roadClassOf(tags: Tags): { cls: RoadClass; link: boolean } | undefined {
  const hw = tags.highway;
  return hw ? HIGHWAY_CLASS[hw] : undefined;
}

export type ExclusionReason = 'highway' | 'service' | 'area' | 'access' | 'construction';

/** Why a highway way is not part of the drivable network (undefined = drivable). */
export function exclusionReason(tags: Tags): ExclusionReason | undefined {
  const cls = roadClassOf(tags);
  if (!cls) return 'highway';
  if (tags.area === 'yes') return 'area';
  if (tags.highway === 'service' && tags.service && EXCLUDED_SERVICE.has(tags.service)) return 'service';
  if (tags.construction && tags.highway === 'construction') return 'construction';
  const psv = tags.psv ?? tags.bus;
  const psvAllowed = psv === 'yes' || psv === 'designated';
  const motor = tags.motor_vehicle ?? tags.motorcar;
  if (motor === 'no' || motor === 'private') return psvAllowed ? undefined : 'access';
  if (motor === 'yes' || motor === 'designated' || motor === 'permissive') return undefined;
  if (tags.access === 'private' || tags.access === 'no') return psvAllowed ? undefined : 'access';
  return undefined;
}

export function isDrivableWay(tags: Tags): boolean {
  return exclusionReason(tags) === undefined;
}

export type OnewayValue = 'yes' | 'no' | '-1';

export function parseOneway(tags: Tags): OnewayValue {
  const v = tags.oneway;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return v === '-1' || v === 'reverse' ? '-1' : 'yes';
  if (v === 'yes' || v === 'true' || v === '1') return 'yes';
  if (v === '-1' || v === 'reverse') return '-1';
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return v === 'no' ? 'no' : 'yes';
  return 'no';
}

const TURN_VALUES: Record<string, Turn | null> = {
  left: 'left',
  right: 'right',
  through: 'straight',
  straight: 'straight',
  slight_left: 'slight_left',
  slight_right: 'slight_right',
  sharp_left: 'sharp_left',
  sharp_right: 'sharp_right',
  reverse: 'uturn',
  // A merging lane simply ends: let the builder map it onto the neighbouring lane
  // (an explicit 'merge_*' restriction would leave the lane without connectors).
  merge_to_left: null,
  merge_to_right: null,
  none: null,
  '': null,
};

export interface TurnLanesResult {
  lanes: (Turn[] | null)[];
  unknown: string[];
}

/** `left|through;right|` → [['left'], ['straight','right'], null] */
export function parseTurnLanes(value: string): TurnLanesResult {
  const unknown: string[] = [];
  const lanes = value.split('|').map((lane) => {
    const parts = lane.split(';').map((p) => p.trim());
    const turns: Turn[] = [];
    let unrestricted = false;
    for (const p of parts) {
      if (!(p in TURN_VALUES)) {
        unknown.push(p);
        unrestricted = true;
        continue;
      }
      const t = TURN_VALUES[p] as Turn | null;
      if (t === null) unrestricted = true;
      else if (!turns.includes(t)) turns.push(t);
    }
    return unrestricted || turns.length === 0 ? null : turns;
  });
  return { lanes, unknown };
}

const IMPLICIT_MAXSPEED: Record<string, number> = {
  'IL:urban': 50,
  'IL:rural': 80,
  'IL:motorway': 110,
  'IL:trunk': 90,
  'IL:living_street': 30,
  'IL:zone30': 30,
  'IL:30': 30,
  'IL:zone:30': 30,
  walk: 10,
  none: 110,
};

/** Returns km/h, or undefined when the tag is missing / unparsable (the caller records unknown values). */
export function parseMaxspeedValue(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t in IMPLICIT_MAXSPEED) return IMPLICIT_MAXSPEED[t];
  const m = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?$/i.exec(t);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return m[2]?.toLowerCase() === 'mph' ? Math.round(n * 1.609) : n;
}

export function parseMaxspeed(tags: Tags): { value?: number; unknown?: string } {
  for (const key of ['maxspeed', 'maxspeed:forward', 'zone:maxspeed', 'maxspeed:type']) {
    const v = tags[key];
    if (v === undefined) continue;
    const n = parseMaxspeedValue(v);
    if (n !== undefined) return { value: n };
    if (key === 'maxspeed') return { unknown: v };
  }
  return {};
}

export type ParkingKind = 'no' | 'no_stopping' | 'paid' | 'free';

export interface ParkingInfo {
  kind: ParkingKind;
  layout?: 'parallel' | 'perpendicular' | 'diagonal';
  zone?: string;
}

function parkingLayoutOf(v: string | undefined): ParkingInfo['layout'] | undefined {
  if (v === 'parallel' || v === 'perpendicular' || v === 'diagonal') return v;
  return undefined;
}

/**
 * Parking on one side of the way (new `parking:<side>` scheme first, then the old
 * `parking:lane:<side>` scheme). `side` is relative to the way direction.
 */
export function parseParking(tags: Tags, side: 'left' | 'right'): ParkingInfo | undefined {
  const sides = [side, 'both'] as const;
  for (const s of sides) {
    const v = tags[`parking:${s}`];
    const restriction = tags[`parking:${s}:restriction`];
    const zone = tags[`parking:${s}:zone`];
    const fee = tags[`parking:${s}:fee`];
    const layout = parkingLayoutOf(tags[`parking:${s}:orientation`]);
    if (v === 'no' || v === 'no_parking' || restriction === 'no_parking') return { kind: 'no' };
    if (v === 'no_stopping' || restriction === 'no_stopping') return { kind: 'no_stopping' };
    if (v === 'separate' || v === 'missing') return undefined;
    if (v || zone || fee) {
      if (zone || fee === 'yes') return { kind: 'paid', layout, zone };
      return { kind: 'free', layout };
    }
  }
  for (const s of sides) {
    const v = tags[`parking:lane:${s}`];
    if (!v) continue;
    if (v === 'no' || v === 'no_parking') return { kind: 'no' };
    if (v === 'no_stopping') return { kind: 'no_stopping' };
    const cond = tags[`parking:condition:${s}`];
    const layout = parkingLayoutOf(v);
    if (cond === 'ticket' || cond === 'residents' || cond === 'disc') return { kind: 'paid', layout };
    return { kind: 'free', layout };
  }
  return undefined;
}

export function kerbOfParking(p: ParkingInfo | undefined): KerbMarking {
  if (!p) return 'none';
  if (p.kind === 'no' || p.kind === 'no_stopping') return 'red_white';
  if (p.kind === 'paid') return 'blue_white';
  return 'none';
}

export interface LaneInfo {
  lanesForward: number;
  lanesBackward: number;
  busLaneForward: boolean;
  busLaneBackward: boolean;
  turnLanesForward?: (Turn[] | null)[];
  turnLanesBackward?: (Turn[] | null)[];
  unknownTurns: string[];
}

function intTag(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 12 ? n : undefined;
}

function defaultLanesPerDirection(cls: RoadClass, link: boolean): number {
  if (link) return 1;
  return ROAD_DEFAULTS[cls].lanes;
}

/** `yes|yes|designated` → index of the bus lane, or -1. */
function designatedIndex(v: string | undefined): number {
  if (!v) return -1;
  return v.split('|').findIndex((x) => x.trim() === 'designated');
}

export function parseLanes(tags: Tags, cls: RoadClass, link: boolean, oneway: boolean): LaneInfo {
  const total = intTag(tags.lanes);
  const fwdTag = intTag(tags['lanes:forward']);
  const bwdTag = intTag(tags['lanes:backward']);
  const unknownTurns: string[] = [];
  let turnLanesForward: (Turn[] | null)[] | undefined;
  let turnLanesBackward: (Turn[] | null)[] | undefined;
  const parseTL = (key: string): (Turn[] | null)[] | undefined => {
    const v = tags[key];
    if (!v) return undefined;
    const r = parseTurnLanes(v);
    unknownTurns.push(...r.unknown);
    return r.lanes;
  };

  let lanesForward: number;
  let lanesBackward: number;
  if (oneway) {
    turnLanesForward = parseTL('turn:lanes') ?? parseTL('turn:lanes:forward');
    lanesForward = total ?? fwdTag ?? turnLanesForward?.length ?? defaultLanesPerDirection(cls, link);
    if (turnLanesForward && turnLanesForward.length !== lanesForward) {
      // trust turn:lanes when `lanes` is missing, otherwise drop the mismatched turn info
      if (total === undefined) lanesForward = turnLanesForward.length;
      else turnLanesForward = undefined;
    }
    lanesBackward = 0;
  } else {
    turnLanesForward = parseTL('turn:lanes:forward');
    turnLanesBackward = parseTL('turn:lanes:backward');
    const perDir = defaultLanesPerDirection(cls, link);
    if (fwdTag !== undefined || bwdTag !== undefined) {
      lanesForward = fwdTag ?? (total !== undefined && bwdTag !== undefined ? Math.max(1, total - bwdTag) : perDir);
      lanesBackward = bwdTag ?? (total !== undefined && fwdTag !== undefined ? Math.max(1, total - fwdTag) : perDir);
    } else if (total !== undefined) {
      lanesForward = Math.max(1, Math.ceil(total / 2));
      lanesBackward = Math.max(1, total - lanesForward);
    } else {
      lanesForward = turnLanesForward?.length ?? perDir;
      lanesBackward = turnLanesBackward?.length ?? perDir;
    }
    if (turnLanesForward && turnLanesForward.length !== lanesForward) turnLanesForward = undefined;
    if (turnLanesBackward && turnLanesBackward.length !== lanesBackward) turnLanesBackward = undefined;
    // a plain turn:lanes on a two-way road is ambiguous; accept it only when it matches the forward count
    if (!turnLanesForward) {
      const plain = parseTL('turn:lanes');
      if (plain && plain.length === lanesForward) turnLanesForward = plain;
    }
  }

  // ---- bus lanes (always the kerb-side lane in the builder) ----
  let busLaneForward = false;
  let busLaneBackward = false;
  const psvLanes = tags['psv:lanes'] ?? tags['bus:lanes'];
  const psvFwd = tags['psv:lanes:forward'] ?? tags['bus:lanes:forward'];
  const psvBwd = tags['psv:lanes:backward'] ?? tags['bus:lanes:backward'];
  const busway = tags.busway;
  const buswayRight = tags['busway:right'] ?? (busway === 'lane' || busway === 'yes' ? 'lane' : undefined);
  const buswayLeft = tags['busway:left'] ?? (busway === 'lane' || busway === 'yes' ? 'lane' : undefined);
  const lanesPsv = intTag(tags['lanes:psv'] ?? tags['lanes:bus']);
  const lanesPsvFwd = intTag(tags['lanes:psv:forward'] ?? tags['lanes:bus:forward']);
  const lanesPsvBwd = intTag(tags['lanes:psv:backward'] ?? tags['lanes:bus:backward']);
  if (oneway) {
    const idx = designatedIndex(psvLanes ?? psvFwd);
    if (idx >= 0) {
      busLaneForward = true;
      lanesForward = Math.max(lanesForward, idx + 1);
    }
    if (buswayRight === 'lane' || (lanesPsv ?? lanesPsvFwd ?? 0) > 0) busLaneForward = true;
  } else {
    if (designatedIndex(psvFwd) >= 0 || buswayRight === 'lane' || (lanesPsvFwd ?? 0) > 0) busLaneForward = true;
    if (designatedIndex(psvBwd) >= 0 || buswayLeft === 'lane' || (lanesPsvBwd ?? 0) > 0) busLaneBackward = true;
    if ((lanesPsv ?? 0) > 0 && !busLaneForward && !busLaneBackward) {
      busLaneForward = true;
      busLaneBackward = true;
    }
  }
  // the builder needs at least one general lane next to a bus lane
  if (busLaneForward && lanesForward < 2) lanesForward = 2;
  if (busLaneBackward && lanesBackward < 2) lanesBackward = 2;
  return { lanesForward, lanesBackward, busLaneForward, busLaneBackward, turnLanesForward, turnLanesBackward, unknownTurns };
}

const HEBREW = /[֐-׿]/;

export function namesOf(tags: Tags): { name?: string; nameEn?: string } {
  const he = tags['name:he'];
  const raw = tags.name;
  const en = tags['name:en'];
  const name = he ?? (raw && HEBREW.test(raw) ? raw : undefined);
  const nameEn = en ?? (raw && !HEBREW.test(raw) ? raw : undefined);
  return { name: name?.trim() || undefined, nameEn: nameEn?.trim() || undefined };
}

export function zoneOf(tags: Tags, cls: RoadClass, maxSpeed: number | undefined): Road['zone'] {
  if (cls === 'living_street') return 'living_street';
  if (maxSpeed !== undefined && maxSpeed <= 30 && cls !== 'service') return 'calming_30';
  const z = tags['zone:maxspeed'] ?? tags['maxspeed:type'] ?? tags['source:maxspeed'];
  if (z && /30|living_street/.test(z)) return 'calming_30';
  return 'none';
}

export function sidewalksOf(tags: Tags, cls: RoadClass): { left: boolean; right: boolean } {
  const defaultSidewalk = cls !== 'motorway' && cls !== 'trunk' && cls !== 'service';
  const sw = tags.sidewalk;
  let left = defaultSidewalk;
  let right = defaultSidewalk;
  if (sw === 'both' || sw === 'yes') left = right = true;
  else if (sw === 'left') {
    left = true;
    right = false;
  } else if (sw === 'right') {
    left = false;
    right = true;
  } else if (sw === 'no' || sw === 'none') left = right = false;
  const l = tags['sidewalk:left'];
  const r = tags['sidewalk:right'];
  const b = tags['sidewalk:both'];
  if (b === 'yes' || b === 'separate') left = right = true;
  if (b === 'no') left = right = false;
  if (l === 'yes' || l === 'separate') left = true;
  if (l === 'no') left = false;
  if (r === 'yes' || r === 'separate') right = true;
  if (r === 'no') right = false;
  return { left, right };
}

const BUILDING_KIND: Record<string, Building['kind']> = {
  apartments: 'residential',
  residential: 'residential',
  house: 'residential',
  detached: 'residential',
  semidetached_house: 'residential',
  terrace: 'residential',
  dormitory: 'residential',
  bungalow: 'residential',
  hostel: 'commercial',
  hotel: 'commercial',
  retail: 'commercial',
  commercial: 'commercial',
  office: 'commercial',
  supermarket: 'commercial',
  kiosk: 'commercial',
  school: 'education',
  university: 'education',
  college: 'education',
  kindergarten: 'education',
  synagogue: 'religious',
  church: 'religious',
  mosque: 'religious',
  religious: 'religious',
  industrial: 'industrial',
  warehouse: 'industrial',
  silo: 'industrial',
  garages: 'industrial',
  public: 'public',
  civic: 'public',
  hospital: 'public',
  government: 'public',
  train_station: 'public',
  public_building: 'public',
  transportation: 'public',
  stadium: 'public',
  sports_hall: 'public',
  sports_centre: 'public',
  roof: 'other',
  shed: 'other',
  garage: 'other',
  greenhouse: 'other',
  construction: 'other',
  tent: 'other',
  container: 'other',
  ruins: 'other',
  bunker: 'other',
  toilets: 'other',
  shelter: 'other',
  parking: 'other',
  bridge: 'other',
};

export function buildingKindOf(tags: Tags): Building['kind'] {
  const b = tags.building ?? 'yes';
  const k = BUILDING_KIND[b];
  if (k && b !== 'yes') return k;
  const amenity = tags.amenity;
  if (amenity === 'school' || amenity === 'university' || amenity === 'college' || amenity === 'kindergarten' || amenity === 'music_school') return 'education';
  if (amenity === 'place_of_worship') return 'religious';
  if (amenity === 'hospital' || amenity === 'clinic' || amenity === 'community_centre' || amenity === 'library' || amenity === 'police' || amenity === 'townhall' || amenity === 'public_building' || amenity === 'theatre' || amenity === 'post_office') return 'public';
  if (tags.shop || amenity === 'restaurant' || amenity === 'cafe' || amenity === 'bank' || amenity === 'fuel' || tags.office) return 'commercial';
  if (tags.landuse === 'industrial' || tags.industrial) return 'industrial';
  return k ?? 'residential';
}

/** Default height when neither TLV nor OSM give one. */
export function defaultBuildingHeight(tags: Tags): number {
  const b = tags.building ?? 'yes';
  if (b === 'garage' || b === 'garages' || b === 'shed' || b === 'roof' || b === 'greenhouse' || b === 'kiosk' || b === 'hut' || b === 'shelter' || b === 'toilets' || b === 'container' || b === 'tent') return 4;
  return 7;
}

export function parseHeightTag(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*(m)?$/i.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 400 ? n : undefined;
}

/** Area kind for a closed way / multipolygon, or undefined when it is not a ground area we draw. */
export function areaKindOf(tags: Tags): Area['kind'] | undefined {
  if (tags.building) return undefined;
  if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.water || tags.landuse === 'reservoir' || tags.landuse === 'basin') return 'water';
  if (tags.natural === 'beach' || tags.natural === 'sand' || tags.natural === 'dune') return 'sand';
  if (tags.natural === 'wood' || tags.landuse === 'forest' || tags.natural === 'forest') return 'forest';
  if (tags.natural === 'scrub' || tags.natural === 'heath' || tags.natural === 'grassland' || tags.natural === 'shrubbery') return 'grass';
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'dog_park' || tags.leisure === 'playground' || tags.leisure === 'nature_reserve') return 'park';
  if (tags.landuse === 'grass' || tags.landuse === 'meadow' || tags.landuse === 'village_green' || tags.landuse === 'recreation_ground' || tags.landuse === 'flowerbed' || tags.landuse === 'orchard' || tags.landuse === 'farmland' || tags.landuse === 'greenfield') return 'grass';
  if (tags.landuse === 'cemetery' || tags.amenity === 'grave_yard') return 'cemetery';
  if (tags.landuse === 'construction' || tags.landuse === 'brownfield') return 'construction';
  if (tags.leisure === 'pitch' || tags.leisure === 'sports_centre' || tags.leisure === 'stadium' || tags.leisure === 'track' || tags.leisure === 'swimming_pool') return 'sports';
  if (tags.amenity === 'school' || tags.amenity === 'university' || tags.amenity === 'college' || tags.amenity === 'kindergarten') return 'school';
  if (tags.amenity === 'parking' && tags.parking !== 'multi-storey' && tags.parking !== 'underground' && tags.parking !== 'rooftop') return 'parking_lot';
  if (tags.place === 'square' || (tags.highway === 'pedestrian' && tags.area === 'yes') || tags.leisure === 'plaza') return 'plaza';
  return undefined;
}

export type CrossingKind = 'zebra' | 'signals' | 'unmarked' | 'raised';

/** Crossing kind for a highway=crossing node (undefined = ignore). */
export function crossingKindOf(tags: Tags): { kind: CrossingKind; refuge: boolean } | undefined {
  const c = tags.crossing ?? '';
  const markings = tags['crossing:markings'];
  const refuge = tags['crossing:island'] === 'yes' || c === 'island';
  if (c === 'no' || c === 'unmarked' || markings === 'no') return undefined;
  if (c.includes('traffic_signals') || c === 'pelican' || c === 'toucan') return { kind: 'signals', refuge };
  if (tags.traffic_calming === 'table' || c === 'raised') return { kind: 'raised', refuge };
  return { kind: 'zebra', refuge };
}
