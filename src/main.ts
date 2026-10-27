/**
 * Entry point. The real application shell (menu → modes) is assembled in src/app.ts;
 * this file only bootstraps it so that modules can be developed independently.
 */
import './ui/styles.css';

async function boot(): Promise<void> {
  const mod = await import('./app');
  await mod.startApp();
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('ui');
  if (el) el.innerHTML = `<div class="fatal" dir="rtl"><h2>שגיאה בטעינת הסימולטור</h2><pre>${String(err)}</pre></div>`;
});
