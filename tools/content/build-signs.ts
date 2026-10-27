/**
 * Build the sign catalogue: public/signs/<code>.svg (generated drawings),
 * data/content/signs.json (SignCatalogSchema) and public/signs/index.html (an index page
 * for eyeballing every drawing).
 *
 * Usage: pnpm content:signs
 */
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignCatalogSchema, type SignDef } from '../../src/content/schema';
import { esc, svgDoc } from './sign-primitives';
import { SIGN_TABLE, type SignSpec } from './sign-table';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SIGNS_DIR = join(ROOT, 'public/signs');
export const OUT_JSON = join(ROOT, 'data/content/signs.json');

export const CATEGORY_LABELS: Record<SignDef['category'], string> = {
  warning: 'תמרורי אזהרה והתראה (1xx)',
  mandatory: 'תמרורי הוריה (2xx)',
  priority: 'תמרורי זכות קדימה (3xx)',
  prohibition: 'תמרורי איסורים והגבלות (4xx)',
  public_transport: 'תחבורה ציבורית (5xx)',
  information: 'תמרורי מודיעין והדרכה (6xx)',
  signals: 'רמזורים ובקרת נתיבים (7xx)',
  markings: 'סימון על פני הדרך (8xx)',
  work_zone: 'תמרורים באתר עבודה (9xx)',
};

export const CATEGORY_ORDER: SignDef['category'][] = ['warning', 'mandatory', 'priority', 'prohibition', 'public_transport', 'information', 'signals', 'markings', 'work_zone'];

/** Strip the drawing function and fill schema defaults. */
export function toSignDef(s: SignSpec): SignDef {
  return {
    code: s.code,
    name: s.name,
    category: s.category,
    meaning: s.meaning,
    action: s.action,
    shape: s.shape,
    svg: `${s.code}.svg`,
    hasValue: s.hasValue ?? false,
    topics: s.topics ?? [],
  };
}

export function renderSvg(s: SignSpec): string {
  return svgDoc(`תמרור ${s.code} — ${s.name}`, s.draw());
}

export function renderIndexHtml(signs: SignDef[]): string {
  const sections = CATEGORY_ORDER.map((cat) => {
    const items = signs.filter((s) => s.category === cat);
    if (items.length === 0) return '';
    const cards = items
      .map(
        (s) => `      <figure class="card" data-code="${esc(s.code)}">
        <img src="./${esc(s.svg)}" alt="${esc(s.name)}" width="120" height="120" loading="lazy" />
        <figcaption><b>${esc(s.code)}</b> ${esc(s.name)}</figcaption>
      </figure>`,
      )
      .join('\n');
    return `    <section>
      <h2>${esc(CATEGORY_LABELS[cat])} <small>${items.length}</small></h2>
      <div class="grid">
${cards}
      </div>
    </section>`;
  });
  return `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>קטלוג התמרורים — סימולטור נהיגה</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; padding: 24px; background: #f3f4f6; color: #111; font-family: Rubik, Arial, Helvetica, sans-serif; }
      h1 { margin: 0 0 4px; font-size: 24px; }
      p.note { margin: 0 0 20px; color: #555; font-size: 14px; }
      h2 { font-size: 18px; margin: 28px 0 10px; border-bottom: 2px solid #d1d5db; padding-bottom: 4px; }
      h2 small { color: #6b7280; font-weight: 400; font-size: 14px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
      .card { margin: 0; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; text-align: center; }
      .card img { display: block; margin: 0 auto 6px; width: 120px; height: 120px; }
      .card figcaption { font-size: 12px; line-height: 1.3; }
      .card b { display: inline-block; background: #111; color: #fff; border-radius: 4px; padding: 0 6px; margin-inline-end: 4px; font-family: Arial, sans-serif; }
    </style>
  </head>
  <body>
    <h1>קטלוג התמרורים של הסימולטור</h1>
    <p class="note">${signs.length} תמרורים, מצוירים מחדש לפי לוח התמרורים הרשמי (הודעת התעבורה (קביעת תמרורים), התשע״א-2010, נוסח משולב 2020). נוצר על ידי <code>pnpm content:signs</code>.</p>
${sections.filter(Boolean).join('\n')}
  </body>
</html>
`;
}

function main(): void {
  const defs = SignCatalogSchema.parse(SIGN_TABLE.map(toSignDef));
  const codes = new Set<string>();
  for (const d of defs) {
    if (codes.has(d.code)) throw new Error(`duplicate sign code ${d.code}`);
    codes.add(d.code);
  }
  mkdirSync(SIGNS_DIR, { recursive: true });
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  // remove stale generated drawings so the folder mirrors the table
  for (const f of readdirSync(SIGNS_DIR)) {
    if (/^\d{3}[a-z]?\.svg$/.test(f) && !codes.has(f.replace(/\.svg$/, ''))) unlinkSync(join(SIGNS_DIR, f));
  }
  for (const s of SIGN_TABLE) writeFileSync(join(SIGNS_DIR, `${s.code}.svg`), renderSvg(s));
  writeFileSync(OUT_JSON, JSON.stringify(defs, null, 1) + '\n');
  writeFileSync(join(SIGNS_DIR, 'index.html'), renderIndexHtml(defs));
  const byCat = new Map<string, number>();
  for (const d of defs) byCat.set(d.category, (byCat.get(d.category) ?? 0) + 1);
  console.log(`wrote ${defs.length} signs → ${SIGNS_DIR}, ${OUT_JSON}`);
  for (const [k, n] of byCat) console.log(`  ${k}: ${n}`);
}

if (process.argv[1] && /build-signs\.ts$/.test(process.argv[1])) {
  main();
}
