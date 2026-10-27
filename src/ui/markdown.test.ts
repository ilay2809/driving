// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markdownHtml, renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders paragraphs, bold and bullet lists', () => {
    const frag = renderMarkdown('שלום **עולם**\n\nפסקה שנייה\n\n- אחד\n- שניים');
    const div = document.createElement('div');
    div.appendChild(frag);
    expect(div.querySelectorAll('p')).toHaveLength(2);
    expect(div.querySelector('p strong')!.textContent).toBe('עולם');
    expect(div.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('escapes HTML', () => {
    expect(markdownHtml('<script>x</script> **b**')).toBe('<p>&lt;script&gt;x&lt;/script&gt; <strong>b</strong></p>');
  });
});
