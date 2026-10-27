/**
 * Hebrew strings produced by the rules engine (violation `context` and `details`).
 * Keep them short — they are appended to the instructor's sentences.
 */
import type { Junction, Road } from '@/world/schema';

const ROAD_TYPE_PREFIXES = ['רחוב ', 'שדרות ', "שד' ", 'דרך ', 'סמטת ', 'סמטה ', 'כיכר ', 'מעבר '];

/** "רחוב הדקל" → "הדקל" (for junction names such as "הדקל/הראשיים"). */
export function shortStreetName(name: string): string {
  for (const p of ROAD_TYPE_PREFIXES) if (name.startsWith(p) && !p.startsWith('כיכר')) return name.slice(p.length).trim();
  return name.trim();
}

/** "רחוב הדקל" → "ברחוב הדקל"; "שדרות הראשיים" → "בשדרות הראשיים"; "הדקל" → "ברחוב הדקל". */
export function atStreet(name: string): string {
  const n = name.trim();
  for (const p of ROAD_TYPE_PREFIXES) if (n.startsWith(p)) return `ב${n}`;
  return `ברחוב ${n}`;
}

/** "צומת 11" → "בצומת 11"; "הדקל/הראשיים" → "בצומת הדקל/הראשיים"; "כיכר האילנות" → "בכיכר האילנות". */
export function atJunction(name: string): string {
  const n = name.trim();
  if (n.startsWith('צומת') || n.startsWith('כיכר')) return `ב${n}`;
  return `בצומת ${n}`;
}

/** Junction display name: its own name, otherwise the short street names of its approaches. */
export function junctionDisplayName(junction: Junction, roadOf: (id: string) => Road | undefined): string | undefined {
  if (junction.name) return junction.name;
  const names: string[] = [];
  for (const a of junction.approaches) {
    const r = roadOf(a.roadId);
    if (!r?.name) continue;
    // a named roundabout ring ("כיכר האילנות") names the whole junction
    if (r.name.startsWith('כיכר')) return r.name;
    const s = shortStreetName(r.name);
    if (!names.includes(s)) names.push(s);
  }
  if (names.length === 0) return undefined;
  const joined = names.join('/');
  return junction.kind === 'roundabout' ? `כיכר ${joined}` : joined;
}

export const HE = {
  insideJunction: 'בתוך הצומת',
  onCrossing: 'על מעבר חצייה',
  beforeCrossing: 'לפני מעבר חצייה',
  atBusStop: 'בתחנת אוטובוס',
  // parking contexts (why the parking is illegal)
  kerb: {
    red_white: 'אבן שפה אדומה-לבנה',
    red_yellow: 'תחנת אוטובוס',
    disabled: 'חניית נכים',
    loading: 'אזור פריקה וטעינה',
  } as Record<string, string>,
  nearJunction: 'פחות מ-12 מטר מצומת',
  nearCrossing: 'פחות מ-12 מטר לפני מעבר חצייה',
  // collision partners
  collision: {
    vehicle: 'ברכב אחר',
    pedestrian: 'בהולך רגל',
    building: 'בבניין',
    object: 'בעצם בדרך',
    kerb: 'באבן השפה',
  } as Record<string, string>,
  // yielding
  oncoming: 'מול רכב שבא ממול',
  inRoundabout: 'מול רכב בתוך הכיכר',
  crossTraffic: 'מול רכב בצומת',
  // lanes
  wrongSide: 'בצד הנגדי של הכביש',
  busLane: 'בנתיב תחבורה ציבורית',
  // instructions
  expectedTurn: {
    left: 'שמאלה',
    right: 'ימינה',
    straight: 'ישר',
    uturn: 'פניית פרסה',
    any: 'לכל כיוון',
  } as Record<string, string>,
  pullOver: 'עצירה בצד',
  pullOut: 'ביציאה מהחניה',
  // scoring
  fail: {
    critical: 'שגיאה חמורה (פסילה מיידית)',
    major: 'יותר מדי שגיאות משמעותיות',
    points: 'חריגה ממכסת הנקודות',
  },
} as const;
