/** Application entry (loaded by src/main.ts). */
import { AppShell } from './app/AppShell';
import './modes/modes.css';

export async function startApp(): Promise<AppShell> {
  const app = new AppShell();
  (window as unknown as { __app?: AppShell }).__app = app;
  await app.boot();
  return app;
}
