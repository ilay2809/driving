/**
 * Dialogue line table: seeded variant selection + {placeholder} substitution.
 * Starts from the inline Hebrew table (strings.he.ts) and can be overlaid with
 * data/content/dialogue.json (validated with DialogueSchema) when that file exists.
 */
import type { Speaker } from '@/core/events';
import { createRng } from '@/core/sim';
import { DialogueSchema, type DialogueLine } from '@/content/schema';
import { STRINGS_HE, type LineDef } from './strings.he';

export type LineParams = Record<string, string | number | boolean | undefined>;

export function substitute(text: string, params?: LineParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}

/**
 * Lazy reference to the optional content file. `import.meta.glob` yields an empty map
 * when the file is absent, so the simulator runs on the inline table alone.
 */
const CONTENT_FILES: Record<string, () => Promise<unknown>> = import.meta.glob('/data/content/dialogue.json');

export class LineTable {
  private readonly table = new Map<string, LineDef>();
  private rng: () => number;
  private warned = new Set<string>();

  constructor(seed = 1, fallback: Record<string, LineDef> = STRINGS_HE) {
    this.rng = createRng(seed);
    for (const [k, v] of Object.entries(fallback)) this.table.set(k, { who: v.who, variants: [...v.variants] });
  }

  reseed(seed: number): void {
    this.rng = createRng(seed);
  }

  has(key: string): boolean {
    return this.table.has(key);
  }

  keys(): string[] {
    return [...this.table.keys()];
  }

  /** Overlay lines (same key replaces the inline variants). Returns the number of keys added/replaced. */
  add(lines: DialogueLine[]): number {
    let n = 0;
    for (const l of lines) {
      if (!l.variants.length) continue;
      this.table.set(l.key, { who: l.who, variants: [...l.variants] });
      n++;
    }
    return n;
  }

  /** Pick a variant (seeded) and substitute params. Undefined when the key is unknown. */
  get(key: string, params?: LineParams): { who: Speaker; text: string } | undefined {
    const def = this.table.get(key);
    if (!def) return undefined;
    const i = def.variants.length === 1 ? 0 : Math.min(def.variants.length - 1, Math.floor(this.rng() * def.variants.length));
    return { who: def.who, text: substitute(def.variants[i]!, params) };
  }

  /** Like `get` but never fails: an unknown key is returned as-is (and logged once). */
  line(key: string, params?: LineParams): string {
    const got = this.get(key, params);
    if (got) return got.text;
    if (!this.warned.has(key)) {
      this.warned.add(key);
      console.warn(`[coach] missing dialogue line: ${key}`);
    }
    return key;
  }

  who(key: string, fallback: Speaker = 'instructor'): Speaker {
    return this.table.get(key)?.who ?? fallback;
  }

  /**
   * Load data/content/dialogue.json (if bundled) or an explicit JSON value, validate it
   * and overlay it. Resolves with the number of keys loaded (0 when absent/invalid).
   */
  async load(source?: unknown): Promise<number> {
    try {
      let json = source;
      if (json === undefined) {
        const loader = Object.values(CONTENT_FILES)[0];
        if (!loader) return 0;
        const mod = (await loader()) as { default?: unknown };
        json = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
      }
      const parsed = DialogueSchema.safeParse(json);
      if (!parsed.success) {
        console.warn('[coach] dialogue.json failed validation; using inline lines', parsed.error.issues.slice(0, 3));
        return 0;
      }
      return this.add(parsed.data);
    } catch (err) {
      console.warn('[coach] could not load dialogue.json; using inline lines', err);
      return 0;
    }
  }
}
