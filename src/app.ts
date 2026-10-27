/** Application shell placeholder — replaced by the integration step. */
export async function startApp(): Promise<void> {
  const el = document.getElementById('ui');
  if (el) el.innerHTML = '<div class="boot" dir="rtl"><h1>סימולטור נהיגה — צפון תל אביב</h1><p>טוען…</p></div>';
}
