/**
 * Dev harness for the learning content: loads every content file through the real
 * loaders (dynamic JSON imports + import.meta.glob, exactly as the app will) and renders a
 * summary so a Playwright screenshot can confirm the bundle works end to end.
 * Served at /dev/content.html (see dev/README.md).
 */
import { VIOLATION_TYPES } from '@/rules/violations';
import { indexDialogue, loadDialogue, loadLessons, loadRules, loadSigns, loadTheory, questionsByTopic, sayLine, signUrl } from '@/content/loaders';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function main(): Promise<void> {
  const root = document.getElementById('root')!;
  const t0 = performance.now();
  const [theory, signs, rules, dialogue, lessons] = await Promise.all([loadTheory(), loadSigns(), loadRules(), loadDialogue(), loadLessons()]);
  const ms = Math.round(performance.now() - t0);
  const dIndex = indexDialogue(dialogue);
  const missingViolationLines = VIOLATION_TYPES.filter((t) => !dIndex.has(`violation.${t}`));
  const withImage = theory.filter((q) => q.topics.includes('has_image')).length;
  const sample = questionsByTopic(theory, 'roundabout')[0];

  const tiles = [
    [theory.length, 'שאלות תיאוריה (B)'],
    [withImage, 'מתוכן עם תמונה'],
    [signs.length, 'תמרורים'],
    [rules.length, 'מאמרי חוקים'],
    [dialogue.length, 'מפתחות דיאלוג'],
    [lessons.length, 'שיעורים'],
    [ms, 'מילישניות טעינה'],
  ]
    .map(([n, label]) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`)
    .join('');

  const lessonRows = lessons
    .map(
      (l) =>
        `<tr><td>${esc(l.id)}</td><td>${esc(l.title)}</td><td>${esc(l.world)}</td><td>${esc(l.spawnId)}</td><td>${l.steps.length}</td><td>${l.steps.reduce((n, s) => n + s.quiz.length, 0)}</td><td>${l.minutes}</td><td>${l.pass.maxMinor}/${l.pass.maxMajor}</td></tr>`,
    )
    .join('');

  const signImgs = signs.map((s) => `<img src="${esc(signUrl(s.code))}" alt="${esc(s.name)}" title="${esc(s.code)} ${esc(s.name)}" />`).join('');

  const nav = sayLine(dIndex, 'nav.turn_right', { distance: 120, street: 'איינשטיין' }) ?? '';
  const violationLine = sayLine(dIndex, 'violation.STOP_SIGN_NO_STOP') ?? '';

  root.innerHTML = `
    <h1>תוכן לימודי — בדיקת טעינה דרך הלודרים</h1>
    <div class="tiles">${tiles}</div>
    <h2>כיסוי דיאלוג</h2>
    <p class="${missingViolationLines.length === 0 ? 'ok' : 'bad'}">${missingViolationLines.length === 0 ? `כל ${VIOLATION_TYPES.length} סוגי העבירות מכוסים.` : `חסרים: ${esc(missingViolationLines.join(', '))}`}</p>
    <p>ניווט: ${esc(nav)}<br/>עבירה: ${esc(violationLine)}</p>
    <h2>שיעורים</h2>
    <table><thead><tr><th>מזהה</th><th>שם</th><th>עולם</th><th>התחלה</th><th>צעדים</th><th>שאלות</th><th>דקות</th><th>סף קלות/חמורות</th></tr></thead><tbody>${lessonRows}</tbody></table>
    <h2>תמרורים (${signs.length})</h2>
    <div class="signs">${signImgs}</div>
    <h2>שאלה לדוגמה (כיכר)</h2>
    <pre>${esc(JSON.stringify(sample, null, 2))}</pre>
  `;
  root.setAttribute('data-ready', '1');
  (window as unknown as { __content: unknown }).__content = { theory: theory.length, signs: signs.length, rules: rules.length, dialogue: dialogue.length, lessons: lessons.length };
}

main().catch((err) => {
  const root = document.getElementById('root')!;
  root.innerHTML = `<pre class="bad">${esc(String(err?.stack ?? err))}</pre>`;
  root.setAttribute('data-ready', 'error');
});
