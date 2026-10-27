/**
 * Import the official Ministry of Transport theory question bank ("מאגר השאלות והתשובות
 * הרשמי למבחן נהיגה עיוני ממוחשב", published as RSS XML on data.gov.il) into
 * data/content/theory.json (validated by TheoryBankSchema), keeping the questions that
 * apply to licence class B.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm content:theory
 *
 * The raw XML is cached in data/raw/content/theory.xml (git-ignored); delete it to re-download.
 * Each <item> holds: <title>"1759. question text", <description> (CDATA with an <ul> of
 * <li><span [id=correctAnswerNNNN]>answer</span></li>, an optional <img src=".../31073.jpg">
 * and the licence classes as «C1» «C» «D» «A» «1» «В» markers), and <category> (Hebrew).
 *
 * Notes (see docs/CONTENT_NOTES.md):
 * - Class B is marked in the source with the CYRILLIC letter «В» (U+0412), not a Latin B.
 * - The question pictures (tqpic.mot.gov.il) are not reachable from the build environment,
 *   so `image` is null and the topic tag "has_image" is set; the original picture URLs are
 *   kept in data/content/theory-images.json for a future download step.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { TheoryBankSchema, type TheoryQuestion } from '../../src/content/schema';

export const THEORY_URL =
  'https://data.gov.il/dataset/618dd157-8df3-43e7-bf9a-00974b4919e9/resource/8c0f314f-583d-48b6-9f5f-4483d95f6848/download/theoryexamhe-data.xml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RAW_PATH = join(ROOT, 'data/raw/content/theory.xml');
export const OUT_PATH = join(ROOT, 'data/content/theory.json');
export const IMAGES_PATH = join(ROOT, 'data/content/theory-images.json');

/** Licence-class markers as they appear in the source → schema class codes. */
const CLASS_MARKERS: Record<string, TheoryQuestion['classes'][number]> = {
  A: 'A',
  A1: 'A1',
  A2: 'A2',
  B: 'B',
  В: 'B', // Cyrillic capital Ve (U+0412) — this is how the official file marks class B
  C: 'C',
  C1: 'C1',
  D: 'D',
  D1: 'D1',
  D2: 'D2',
  D3: 'D3',
  '1': '1',
};

/**
 * Topic heuristics on the question text (and answers). Order matters only for readability;
 * a question gets every topic whose keyword appears. Hebrew prefixes (ב, ל, ה, ו, מ, ש) are
 * attached to the word, so plain substring matching catches "ברמזור", "לצומת", "מהכיכר"…
 */
export const TOPIC_KEYWORDS: Record<string, string[]> = {
  priority: ['זכות קדימה', 'זכות-קדימה', 'צומת', 'הצטלבות'],
  roundabout: ['כיכר', 'מעגל תנועה', 'מעגל התנועה'],
  signals: ['רמזור', 'אור אדום', 'אור ירוק', 'אור צהוב', 'אור מהבהב', 'ירוק מהבהב', 'צהוב מהבהב', 'באור '],
  signs: ['תמרור', 'שלט'],
  speed: ['מהירות', 'קמ"ש', 'קמ״ש'],
  parking: ['חניה', 'חנייה', 'לחנות', 'חונה', 'עצירה', 'לעצור', 'אבן שפה', 'אבני שפה'],
  pedestrians: ['הולך רגל', 'הולכי רגל', 'הולכי-רגל', 'מעבר חצייה', 'מעבר חציה', 'מעברי חצייה', 'מעברי חציה'],
  overtaking: ['עקיפה', 'לעקוף', 'עוקף', 'נעקף'],
  lanes: ['נתיב', 'קו הפרדה', 'קו ההפרדה', 'החלפת נתיב'],
  turning: ['פנייה', 'פניה', 'לפנות', 'פונה', 'פרסה', 'איתות', 'מאותת', 'לאותת'],
  safety: ['חגורה', 'חגורת', 'בטיחות', 'משענת ראש', 'כרית אוויר', 'מושב בטיחות'],
  vehicle: ['בלמים', 'בלם', 'צמיגים', 'צמיג', 'מנוע', 'הגה', 'אורות', 'פנסי', 'מצבר', 'שמן', 'בולם', 'תיבת הילוכים', 'הילוך'],
  lights: ['אורות', 'אור גבוה', 'אור נמוך', 'אור דרך', 'אור מעבר', 'פנסי', 'פנס ערפל', 'אורות ערפל'],
  new_driver: ['נהג חדש', 'מלווה', 'ליווי'],
  alcohol: ['אלכוהול', 'סמים', 'סם ', 'שיכור', 'שכרות', 'משקה משכר', 'תרופ'],
  weather: ['גשם', 'ערפל', 'לילה', 'חשיכה', 'כביש רטוב', 'רטוב', 'שלג', 'קרח', 'סנוור'],
  emergency: ['רכב ביטחון', 'רכב בטחון', 'אמבולנס', 'כיבוי', 'משטרה', 'צופר', 'סירנה', 'תאונה', 'תקלה', 'משולש אזהרה'],
  distance: ['מרחק', 'רווח', 'שתי שניות', 'שניות'],
  reverse: ['נסיעה לאחור', 'לאחור', 'אחורנית'],
  one_way: ['חד-סטרי', 'חד סטרי', 'חד-סיטרי', 'חד סיטרי', 'אין כניסה'],
  bus_lane: ['תחבורה ציבורית', 'אוטובוס'],
  mirrors: ['מראה', 'מראות', 'שטח מת', 'שדה ראייה'],
  licence: ['רישיון', 'רשיון', 'ביטוח', 'רישוי', 'פוליסה'],
  test: ['מבחן', 'בוחן', 'טסט'],
};

/** Official category (Hebrew) → topic tag, so that every question has at least one topic. */
const CATEGORY_TOPICS: Record<string, string> = {
  תמרורים: 'signs',
  'חוקי התנועה': 'rules',
  בטיחות: 'safety',
  'הכרת הרכב': 'vehicle',
};

export interface RawTheoryItem {
  id: string;
  text: string;
  answers: string[];
  correctIndex: number;
  category: string;
  classes: TheoryQuestion['classes'];
  imageUrl: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Strip tags, decode the few entities the bank uses and collapse whitespace. */
export function cleanHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[\u200e\u200f\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Derive topic tags from the question text + answers. */
export function deriveTopics(text: string, answers: string[], category: string, hasImage: boolean): string[] {
  const hay = `${text} ${answers.join(' ')}`;
  const topics = new Set<string>();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((k) => hay.includes(k))) topics.add(topic);
  }
  const cat = CATEGORY_TOPICS[category.trim()];
  if (cat) topics.add(cat);
  if (hasImage) topics.add('has_image');
  return [...topics];
}

/** Parse one <description> HTML blob. */
export function parseDescription(html: string): { answers: string[]; correctIndex: number; classes: TheoryQuestion['classes']; imageUrl: string | null } {
  const answers: string[] = [];
  let correctIndex = -1;
  const li = /<li>\s*<span([^>]*)>([\s\S]*?)<\/span>\s*<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = li.exec(html)) !== null) {
    const attrs = m[1] ?? '';
    const txt = cleanHtml(m[2] ?? '');
    if (/id\s*=\s*"?correctAnswer/i.test(attrs)) correctIndex = answers.length;
    answers.push(txt);
  }
  const img = /<img[^>]*src\s*=\s*"([^"]+)"/i.exec(html);
  const classes: TheoryQuestion['classes'] = [];
  const marker = /«\s*([^»]+?)\s*»/g;
  while ((m = marker.exec(html)) !== null) {
    const code = CLASS_MARKERS[(m[1] ?? '').trim()];
    if (code && !classes.includes(code)) classes.push(code);
  }
  return { answers, correctIndex, classes, imageUrl: img?.[1] ?? null };
}

/** Parse the whole RSS XML into raw items (all licence classes). */
export function parseTheoryXml(xml: string): RawTheoryItem[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === 'item',
  });
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: Record<string, unknown>[] } } };
  const items = doc.rss?.channel?.item ?? [];
  const out: RawTheoryItem[] = [];
  for (const it of items) {
    const title = cleanHtml(String(it.title ?? ''));
    const description = String(it.description ?? '');
    const category = cleanHtml(String(it.category ?? ''));
    const tm = /^(\d+)\s*\.\s*([\s\S]*)$/.exec(title);
    const d = parseDescription(description);
    const idFromAnswer = /correctAnswer(\d+)/i.exec(description)?.[1];
    const id = tm?.[1] ?? idFromAnswer;
    const text = (tm?.[2] ?? title).trim();
    if (!id || !text || d.answers.length < 2 || d.correctIndex < 0) {
      console.warn(`skipping malformed item: ${title.slice(0, 60)}`);
      continue;
    }
    out.push({ id, text, answers: d.answers, correctIndex: d.correctIndex, category, classes: d.classes, imageUrl: d.imageUrl });
  }
  return out;
}

/**
 * Picture questions whose (unavailable) picture is simply an official sign — curated by
 * looking at the question/answer text. Lets the UI show the sign drawing instead of the
 * missing photo. Keys are question ids, values sign codes from the catalogue.
 */
export const PICTURED_SIGNS: Record<string, string[]> = {
  '0430': ['121'],
  '0553': ['121'],
  '0461': ['139'],
  '0551': ['303'],
  '0443': ['301'],
  '0535': ['302'],
  '0495': ['307'],
  '0579': ['308'],
  '0385': ['427'],
  '0521': ['424'],
  '0629': ['222'],
  '0631': ['222'],
  '0632': ['223'],
  '0630': ['221'],
  '0154': ['220'],
  '0556': ['624'],
  '0586': ['623'],
  '0592': ['504'],
  '0675': ['724'],
  '0664': ['701'],
  '0608': ['702'],
  '0667': ['705'],
  '0672': ['706'],
  '0673': ['722'],
  '0693': ['701'],
  '0633': ['503'],
  '0634': ['801'],
  '0636': ['803'],
  '0637': ['803'],
  '0639': ['805'],
  '0640': ['806'],
  '0642': ['806'],
  '0643': ['807'],
  '0644': ['808'],
  '0647': ['810'],
  '0648': ['810'],
  '0649': ['811'],
  '0657': ['817'],
  '0658': ['818'],
  '0609': ['511'],
};

/** Sign codes referenced by the text/answers ("תמרור 302", or answers that are bare catalogue numbers). */
export function extractSignCodes(id: string, text: string, answers: string[]): string[] {
  const codes = new Set<string>(PICTURED_SIGNS[id] ?? []);
  const inText = text.matchAll(/תמרור\s*(?:מס'|מספר)?\s*([1-9]\d{2})\b/g);
  for (const m of inText) codes.add(m[1]!);
  for (const a of answers) {
    const trimmed = a.replace(/\.$/, '').trim();
    if (/^[1-9]\d{2}(\s*[,ו]\s*[1-9]\d{2})*$/.test(trimmed)) for (const c of trimmed.match(/[1-9]\d{2}/g) ?? []) codes.add(c);
  }
  return [...codes];
}

/** Convert a raw item to the schema shape. */
export function toQuestion(item: RawTheoryItem): TheoryQuestion {
  return {
    id: item.id,
    text: item.text,
    answers: item.answers,
    correctIndex: item.correctIndex,
    category: item.category,
    classes: item.classes,
    image: null,
    signs: extractSignCodes(item.id, item.text, item.answers),
    topics: deriveTopics(item.text, item.answers, item.category, item.imageUrl !== null),
  };
}

/** Keep the questions that apply to the given class, sorted by numeric id. */
export function selectForClass(items: RawTheoryItem[], cls: TheoryQuestion['classes'][number] = 'B'): TheoryQuestion[] {
  return items
    .filter((it) => it.classes.includes(cls))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(toQuestion);
}

export function summarise(questions: TheoryQuestion[]): string {
  const count = (keyOf: (q: TheoryQuestion) => string[]): [string, number][] => {
    const m = new Map<string, number>();
    for (const q of questions) for (const k of keyOf(q)) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const lines: string[] = [];
  lines.push(`questions (class B): ${questions.length}`);
  lines.push('by category:');
  for (const [k, n] of count((q) => [q.category])) lines.push(`  ${k}: ${n}`);
  lines.push('by topic:');
  for (const [k, n] of count((q) => q.topics)) lines.push(`  ${k}: ${n}`);
  lines.push(`with picture (image null, topic has_image): ${questions.filter((q) => q.topics.includes('has_image')).length}`);
  lines.push(`with sign codes (signs[]): ${questions.filter((q) => q.signs.length > 0).length}`);
  return lines.join('\n');
}

async function loadXml(): Promise<string> {
  if (existsSync(RAW_PATH)) {
    console.log('using cached', RAW_PATH);
    return readFileSync(RAW_PATH, 'utf8');
  }
  console.log('downloading', THEORY_URL);
  const res = await fetch(THEORY_URL, { headers: { Accept: 'application/xml' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${THEORY_URL} (hint: NODE_USE_ENV_PROXY=1)`);
  const xml = await res.text();
  mkdirSync(dirname(RAW_PATH), { recursive: true });
  writeFileSync(RAW_PATH, xml);
  console.log('saved', RAW_PATH, (xml.length / 1e6).toFixed(2), 'MB');
  return xml;
}

async function main(): Promise<void> {
  const xml = await loadXml();
  const items = parseTheoryXml(xml);
  console.log(`parsed ${items.length} items (all classes)`);
  const questions = TheoryBankSchema.parse(selectForClass(items, 'B'));
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) throw new Error(`duplicate question id ${q.id}`);
    ids.add(q.id);
  }
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(questions, null, 1) + '\n');
  const images: Record<string, string> = {};
  for (const it of items) if (it.imageUrl && it.classes.includes('B')) images[it.id] = it.imageUrl;
  writeFileSync(IMAGES_PATH, JSON.stringify(images, null, 1) + '\n');
  console.log(summarise(questions));
  console.log(`wrote ${OUT_PATH} and ${IMAGES_PATH}`);
}

if (process.argv[1] && /import-theory\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
