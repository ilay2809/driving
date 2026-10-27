import { describe, expect, it } from 'vitest';
import { cleanHtml, deriveTopics, parseDescription, parseTheoryXml, selectForClass } from './import-theory';

const item = (id: string, title: string, answers: string[], correct: number, classes: string[], category: string, img?: string): string => {
  const lis = answers.map((a, i) => `<li><span${i === correct ? ` id="correctAnswer${id}"` : ''}>${a}</span></li>`).join('');
  const image = img ? `<img src="${img}" style="margin: 2px" />` : '';
  const marks = classes.map((c) => `«${c}» | `).join('');
  return `<item><title>${id}. ${title}</title><link></link><guid></guid><description><![CDATA[<div dir="rtl" style="text-align: right"><ul>${lis}</ul>${image}<div style="padding-top: 4px;"><span><button type="button" onclick="x">הצג תשובה נכונה</button></span><br/><span style="float: left;">| ${marks}</span></div></div>]]></description><author></author><category>${category}</category><pubDate>09-11-2011 10:44:17</pubDate></item>`;
};

const XML = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><?xml-stylesheet type="text/css" href="x.css"?><channel><title>מאגר</title>
${item('1759', 'האם אוטובוס הנוסע בנתיב שיועד לתחבורה ציבורית רשאי לעקוף רכב עוקף?', ['רשאי, רק כאשר הרכב העוקף הוא רכב משא.', 'רשאי, רק בדרך שאינה עירונית.', 'רשאי.', 'רשאי, אם באוטובוס אין נוסעים.'], 2, ['D'], 'חוקי התנועה')}
${item('1073', 'מה פירוש התמרור?', ['המרחק עד הכביש הקרוב (בק"מ).', 'מספרה של דרך ראשית.', 'מספרה של דרך מהירה.', 'המרחק עד לצומת הקרוב (בק"מ). '], 1, ['C1', 'C', 'D', 'A', '1', 'В'], 'תמרורים', 'http://tqpic.mot.gov.il/31073.jpg')}
${item('0042', 'כיצד תנהג בהתקרבך לכיכר שבה נמצא רכב?', ['תיתן זכות קדימה לרכב הנמצא בכיכר.', 'תיכנס לכיכר.', 'תצפור.', 'תעקוף.'], 0, ['B'], 'חוקי התנועה')}
</channel></rss>`;

describe('import-theory', () => {
  it('cleans html and entities', () => {
    expect(cleanHtml('  <b>שלום</b>&nbsp;&quot;עולם&quot;  <br/> &#1488; ')).toBe('שלום "עולם" א');
  });

  it('parses a description with the correct answer, classes (Cyrillic В → B) and image', () => {
    const d = parseDescription(
      '<ul><li><span>א</span></li><li><span id="correctAnswer7">ב</span></li></ul><img src="http://tqpic.mot.gov.il/37.jpg" /><span>| «C1» | «В» | «1» | </span>',
    );
    expect(d.answers).toEqual(['א', 'ב']);
    expect(d.correctIndex).toBe(1);
    expect(d.classes).toEqual(['C1', 'B', '1']);
    expect(d.imageUrl).toBe('http://tqpic.mot.gov.il/37.jpg');
  });

  it('parses the RSS and keeps only class-B questions, sorted by id', () => {
    const all = parseTheoryXml(XML);
    expect(all.length).toBe(3);
    expect(all[0]!.id).toBe('1759');
    expect(all[0]!.text).toBe('האם אוטובוס הנוסע בנתיב שיועד לתחבורה ציבורית רשאי לעקוף רכב עוקף?');
    expect(all[0]!.classes).toEqual(['D']);
    const b = selectForClass(all, 'B');
    expect(b.map((q) => q.id)).toEqual(['0042', '1073']);
    const q1073 = b.find((q) => q.id === '1073')!;
    expect(q1073.image).toBeNull();
    expect(q1073.topics).toContain('has_image');
    expect(q1073.topics).toContain('signs');
    expect(q1073.correctIndex).toBe(1);
    expect(q1073.answers[3]).toBe('המרחק עד לצומת הקרוב (בק"מ).');
    expect(q1073.classes).toEqual(['C1', 'C', 'D', 'A', '1', 'B']);
    const q42 = b.find((q) => q.id === '0042')!;
    expect(q42.topics).toEqual(expect.arrayContaining(['roundabout', 'priority', 'rules']));
  });

  it('derives topics from keywords', () => {
    expect(deriveTopics('מהי המהירות המרבית המותרת בדרך עירונית?', [], 'חוקי התנועה', false)).toEqual(expect.arrayContaining(['speed', 'rules']));
    expect(deriveTopics('כיצד תנהג כשהולך רגל ממתין במעבר חצייה?', [], 'בטיחות', false)).toEqual(expect.arrayContaining(['pedestrians', 'safety']));
    expect(deriveTopics('מה חובת הליווי של נהג חדש?', [], 'חוקי התנועה', false)).toContain('new_driver');
    expect(deriveTopics('מה פירוש האור הצהוב המהבהב ברמזור?', [], 'תמרורים', true)).toEqual(expect.arrayContaining(['signals', 'signs', 'has_image']));
  });
});
