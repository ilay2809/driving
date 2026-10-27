/**
 * Hebrew strings and place specifications for the North Tel Aviv world: spawn points
 * (resolved to lanes by street name / position after the first build), test & tour
 * routes (resolved to junction ids), and names of generated features.
 *
 * Street names are matched fuzzily (see geom.normaliseName) against OSM `name` /
 * `name:en`; the first entry of `streets` that matches wins. `near` is a [lon, lat]
 * hint used to choose among several matching roads and as a fallback position.
 * Positions were taken from the OSM place nodes / junction nodes of the data set
 * (query them with `tsx tools/world/query.ts junctions <street>`).
 */
import type { SpawnPoint } from '@/world/schema';

export type SpawnTag = SpawnPoint['tags'][number];

export const WORLD_NAME = 'north-tlv';

export const STRINGS = {
  sea: 'הים התיכון',
};

export interface SpawnSpec {
  id: string;
  name: string;
  streets: string[];
  near: [number, number];
  tags: SpawnTag[];
  /** Prefer a quiet two-way residential street when several roads match. */
  quiet?: boolean;
  /** Compass bearing (deg, clockwise from north) the car should face, if it matters. */
  bearingDeg?: number;
}

export type WaypointSpec = { streets: [string, string] } | { near: [number, number] } | { junction: string };

export interface RouteSpec {
  id: string;
  name: string;
  kind: 'test' | 'tour' | 'lesson';
  spawnId: string;
  waypoints: WaypointSpec[];
  notes?: string;
}

export const SPAWN_SPECS: SpawnSpec[] = [
  { id: 'tlv_test_start', name: 'נקודת התחלה לטסט — רב אשי, נווה אביבים', streets: ['רב אשי', 'אריה פסטרנק', 'יהודה הנשיא'], near: [34.7965, 32.1191], tags: ['start', 'test', 'lesson', 'quiet'], quiet: true },
  { id: 'tlv_university', name: 'חיים לבנון — שערי האוניברסיטה', streets: ['חיים לבנון', 'Haim Levanon'], near: [34.8015, 32.115], tags: ['main_road', 'lesson', 'free'] },
  { id: 'tlv_einstein', name: 'איינשטיין — ליד קניון רמת אביב', streets: ['אינשטיין', 'איינשטיין', 'Einstein'], near: [34.7975, 32.113], tags: ['main_road', 'lesson', 'free'] },
  { id: 'tlv_namir_rokach', name: 'דרך נמיר — לפני צומת רוקח', streets: ['דרך נמיר', 'Namir'], near: [34.7937, 32.1012], tags: ['main_road', 'free'], bearingDeg: 200 },
  { id: 'tlv_kochav', name: 'כוכב הצפון — הרצל רוזנבלום', streets: ['הרצל רוזנבלום', 'Herzl Rosenblum'], near: [34.792, 32.1395], tags: ['quiet', 'lesson', 'free'], quiet: true },
  { id: 'tlv_afeka', name: 'אפקה — דב גרונר', streets: ['דב גרונר', 'Dov Gruner'], near: [34.8063, 32.1241], tags: ['quiet', 'lesson', 'free'], quiet: true },
  { id: 'tlv_telbaruch', name: 'תל ברוך — יגאל מוסינזון', streets: ['יגאל מוסינזון', 'קהילת סופיה', 'הרבסט קרול'], near: [34.8159, 32.1198], tags: ['quiet', 'free'], quiet: true },
  { id: 'tlv_hadaryosef', name: 'הדר יוסף — קהילת לבוב', streets: ['קהילת לבוב', 'קהילת יאסי', 'שלום אש'], near: [34.8236, 32.1083], tags: ['quiet', 'free'], quiet: true },
  { id: 'tlv_tzahala', name: 'צהלה — בת חן', streets: ['בת חן', 'עשהאל', 'צה"ל'], near: [34.8362, 32.1226], tags: ['quiet', 'free'], quiet: true },
  { id: 'tlv_ramathahayal', name: 'רמת החייל — ראול ולנברג', streets: ['ראול ולנברג', 'Raoul Wallenberg'], near: [34.8385, 32.1125], tags: ['main_road', 'free'] },
  { id: 'tlv_lamed', name: 'שיכון למ״ד — יהודה בורלא', streets: ['יהודה בורלא', 'ש״י עגנון', 'Shai Agnon'], near: [34.7903, 32.1078], tags: ['quiet', 'lesson', 'free'], quiet: true },
  { id: 'tlv_neveavivim', name: 'נווה אביבים — טאגור', streets: ['טאגור', 'Tagore'], near: [34.7975, 32.1185], tags: ['quiet', 'lesson', 'free'], quiet: true },
  { id: 'tlv_glilot', name: 'דרך נמיר צפון — לקראת גלילות', streets: ['דרך נמיר', 'Namir'], near: [34.8, 32.136], tags: ['main_road', 'free'], bearingDeg: 20 },
];

/**
 * Routes are written as street pairs (= the junction where both streets meet) or a
 * [lon, lat] near a junction (roundabouts whose arms all carry the same name). The
 * build validates every route with RoadGraph.routeViaJunctions and drops invalid ones
 * (reported in world-stats.json). Test routes should be 6–9 km (≈ 20–30 min).
 */
export const ROUTE_SPECS: RouteSpec[] = [
  {
    id: 'test_a',
    name: 'מסלול טסט א׳ — נווה אביבים, נמיר, רוקח וחיים לבנון',
    kind: 'test',
    spawnId: 'tlv_test_start',
    waypoints: [
      { streets: ['אינשטיין', 'דרך נמיר'] },
      { streets: ['דרך נמיר', 'שדרות רוקח'] },
      { streets: ['חיים לבנון', 'רדינג'] },
      { near: [34.7946, 32.1049] }, // כיכר יגאל גריפל (רדינג)
      { streets: ['חיים לבנון', 'ד"ר ג\'ורג וייז'] },
      { streets: ['חיים לבנון', 'אינשטיין'] },
      { streets: ['חיים לבנון', 'קלצ\'קין'] },
      { streets: ['דרך נמיר', 'שדרות קק"ל'] },
      { streets: ['אינשטיין', 'דרך נמיר'] },
    ],
    notes: 'רחובות מגורים, דרך נמיר ושדרות רוקח (כבישים ראשיים), צמתים מרומזרים, כיכר, פניות שמאלה',
  },
  {
    id: 'test_b',
    name: 'מסלול טסט ב׳ — חיים לבנון, רמת אביב ג׳ ושדרות לוי אשכול',
    kind: 'test',
    spawnId: 'tlv_test_start',
    waypoints: [
      { streets: ['אינשטיין', 'דרך נמיר'] },
      { streets: ['אינשטיין', 'חיים לבנון'] },
      { streets: ['חיים לבנון', 'קלצ\'קין'] },
      { streets: ['דרך נמיר', 'שדרות קק"ל'] },
      { streets: ['שדרות לוי אשכול', 'קדושי השואה'] },
      { near: [34.792, 32.1251] }, // כיכר בקדושי השואה
      { near: [34.7924, 32.1273] }, // הכיכר הבאה צפונה
      { streets: ['שדרות לוי אשכול', 'קדושי השואה'] },
      { streets: ['שדרות לוי אשכול', 'אינשטיין'] },
      { streets: ['אינשטיין', 'דרך נמיר'] },
    ],
    notes: 'כביש ראשי (חיים לבנון, נמיר), צמתים מרומזרים, כיכרות, שדרות לוי אשכול, רחובות שקטים',
  },
  {
    id: 'test_c',
    name: 'מסלול טסט ג׳ — אפקה, מבצע קדש ופנחס רוזן',
    kind: 'test',
    spawnId: 'tlv_test_start',
    waypoints: [
      { streets: ['אינשטיין', 'חיים לבנון'] },
      { streets: ['חיים לבנון', 'שדרות קק"ל'] },
      { streets: ['מבצע קדש', 'בני אפרים'] },
      { near: [34.8186, 32.1135] }, // כיכר במבצע קדש
      { streets: ['מבצע קדש', 'פנחס רוזן'] },
      { streets: ['מבצע קדש', 'בני אפרים'] },
    ],
    notes: 'מבצע קדש (כביש ראשי), כיכר, צמתים מרומזרים, רחובות מגורים באפקה',
  },
  {
    id: 'test_d',
    name: 'מסלול טסט ד׳ — שיכון למ״ד, רוקח ורדינג',
    kind: 'test',
    spawnId: 'tlv_test_start',
    waypoints: [
      { streets: ['אינשטיין', 'דרך נמיר'] },
      { streets: ['דרך נמיר', 'חיים לבנון'] },
      { near: [34.7909, 32.105] }, // שיכון למ״ד — כיכר ביהודה בורלא
      { streets: ['דרך נמיר', 'שדרות רוקח'] },
      { near: [34.7946, 32.1049] }, // כיכר יגאל גריפל (רדינג)
      { streets: ['חיים לבנון', 'רדינג'] },
      { streets: ['חיים לבנון', 'ד"ר ג\'ורג וייז'] },
      { streets: ['חיים לבנון', 'אינשטיין'] },
      { streets: ['אינשטיין', 'דרך נמיר'] },
    ],
    notes: 'דרך נמיר ושדרות רוקח, שיכון למ״ד, כיכר, חיים לבנון לאורך האוניברסיטה',
  },
  {
    id: 'tour_north',
    name: 'סיור צפוני — אפקה, צהלה ורמת החייל',
    kind: 'tour',
    spawnId: 'tlv_afeka',
    waypoints: [{ streets: ['מבצע קדש', 'פנחס רוזן'] }, { streets: ['דבורה הנביאה', 'משמר הירדן'] }, { streets: ['דבורה הנביאה', 'צה"ל'] }, { near: [34.8409, 32.1145] }, { streets: ['ראול ולנברג', 'פנחס רוזן'] }],
  },
  {
    id: 'tour_coast',
    name: 'סיור חוף — כוכב הצפון, קדושי השואה ונמיר',
    kind: 'tour',
    spawnId: 'tlv_kochav',
    waypoints: [{ near: [34.7927, 32.1288] }, { streets: ['שדרות לוי אשכול', 'קדושי השואה'] }, { streets: ['דרך נמיר', 'שדרות קק"ל'] }, { streets: ['דרך נמיר', 'שדרות רוקח'] }],
  },
];
