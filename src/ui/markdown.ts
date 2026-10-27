/**
 * Minimal "markdown-ish" renderer for content text: paragraphs separated by blank
 * lines, **bold**, bullet lines starting with "- " / "• " and numbered lines starting
 * with "1. " / "1) ". A block may mix a lead-in line with a list that follows it.
 * Output is safe (text is escaped).
 */
import { esc } from './dom';

const BULLET = /^\s*[-•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

function inline(text: string): string {
  // escape first, then turn **x** into <strong>
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

type Run = { kind: 'p' | 'ul' | 'ol'; lines: string[] };

function kindOf(line: string): Run['kind'] {
  if (BULLET.test(line)) return 'ul';
  if (NUMBERED.test(line)) return 'ol';
  return 'p';
}

export function renderMarkdown(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    // group consecutive lines of the same kind (paragraph / bullet list / numbered list)
    const runs: Run[] = [];
    for (const line of lines) {
      const kind = kindOf(line);
      const last = runs[runs.length - 1];
      if (last && last.kind === kind) last.lines.push(line);
      else runs.push({ kind, lines: [line] });
    }
    for (const run of runs) {
      if (run.kind === 'p') {
        const p = document.createElement('p');
        p.innerHTML = run.lines.map(inline).join('<br>');
        frag.appendChild(p);
        continue;
      }
      const list = document.createElement(run.kind);
      const strip = run.kind === 'ul' ? BULLET : NUMBERED;
      for (const l of run.lines) {
        const li = document.createElement('li');
        li.innerHTML = inline(l.replace(strip, ''));
        list.appendChild(li);
      }
      frag.appendChild(list);
    }
  }
  return frag;
}

export function markdownHtml(text: string): string {
  const div = document.createElement('div');
  div.appendChild(renderMarkdown(text));
  return div.innerHTML;
}
