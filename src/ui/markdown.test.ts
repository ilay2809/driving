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

  it('renders numbered lists, also after a lead-in line in the same block', () => {
    expect(markdownHtml('1. ראשון\n2. שני\n3) שלישי')).toBe('<ol><li>ראשון</li><li>שני</li><li>שלישי</li></ol>');
    expect(markdownHtml('סדר הפעולות:\n1. מראה\n2. איתות\n- הערה')).toBe('<p>סדר הפעולות:</p><ol><li>מראה</li><li>איתות</li></ol><ul><li>הערה</li></ul>');
  });

  it('escapes HTML', () => {
    expect(markdownHtml('<script>x</script> **b**')).toBe('<p>&lt;script&gt;x&lt;/script&gt; <strong>b</strong></p>');
  });
});
