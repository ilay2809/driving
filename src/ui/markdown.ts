/**
 * Minimal "markdown-ish" renderer for content text: paragraphs separated by blank
 * lines, **bold**, and bullet lines starting with "- ". Output is safe (text is escaped).
 */
import { esc } from './dom';

function inline(text: string): string {
  // escape first, then turn **x** into <strong>
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function renderMarkdown(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      const ul = document.createElement('ul');
      for (const l of lines) {
        const li = document.createElement('li');
        li.innerHTML = inline(l.replace(/^\s*[-•]\s+/, ''));
        ul.appendChild(li);
      }
      frag.appendChild(ul);
      continue;
    }
    const p = document.createElement('p');
    p.innerHTML = lines.map(inline).join('<br>');
    frag.appendChild(p);
  }
  return frag;
}

export function markdownHtml(text: string): string {
  const div = document.createElement('div');
  div.appendChild(renderMarkdown(text));
  return div.innerHTML;
}
