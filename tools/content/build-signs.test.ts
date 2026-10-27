import { describe, expect, it } from 'vitest';
import { SignCatalogSchema } from '../../src/content/schema';
import { renderIndexHtml, renderSvg, toSignDef } from './build-signs';
import { REQUIRED_SIGN_CODES, SIGN_TABLE } from './sign-table';

describe('sign table', () => {
  const defs = SIGN_TABLE.map(toSignDef);

  it('validates against SignCatalogSchema with unique codes', () => {
    expect(() => SignCatalogSchema.parse(defs)).not.toThrow();
    const codes = defs.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(defs.length).toBeGreaterThanOrEqual(80);
  });

  it('contains every code the simulator relies on', () => {
    const codes = new Set(defs.map((d) => d.code));
    for (const c of REQUIRED_SIGN_CODES) expect(codes.has(c), `missing sign ${c}`).toBe(true);
  });

  it('uses consistent shapes per category and numbering', () => {
    for (const d of defs) {
      expect(d.svg).toBe(`${d.code}.svg`);
      if (d.category === 'signals') expect(d.shape).toBe('light');
      if (d.category === 'markings') expect(d.shape).toBe('marking');
      if (d.category === 'warning') expect(d.shape).toBe('triangle');
      const n = Number.parseInt(d.code, 10);
      const expected: Record<string, number> = { warning: 1, mandatory: 2, priority: 3, prohibition: 4, public_transport: 5, information: 6, signals: 7, markings: 8, work_zone: 9 };
      expect(Math.floor(n / 100), `category/number mismatch for ${d.code}`).toBe(expected[d.category]);
      expect(d.name.length).toBeGreaterThan(2);
      expect(d.meaning.length).toBeGreaterThan(10);
      expect(d.action.length).toBeGreaterThan(5);
    }
  });

  it('renders well-formed 120×120 SVG for every sign', () => {
    for (const s of SIGN_TABLE) {
      const svg = renderSvg(s);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      expect(svg, `${s.code} has NaN/undefined`).not.toMatch(/NaN|undefined|null/);
      // balanced tags (rough check): every opening <g has a closing </g
      const open = (svg.match(/<g[\s>]/g) ?? []).length;
      const close = (svg.match(/<\/g>/g) ?? []).length;
      expect(open, `${s.code} unbalanced <g>`).toBe(close);
    }
  });

  it('renders an RTL index page listing every sign', () => {
    const html = renderIndexHtml(SignCatalogSchema.parse(defs));
    expect(html).toContain('dir="rtl"');
    for (const d of defs) expect(html).toContain(`./${d.code}.svg`);
  });
});
