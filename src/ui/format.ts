/**
 * Pure formatting helpers (Hebrew, km/h at the UI boundary).
 */
import { NAV } from './strings.he';

/** Distance text for the navigation banner: "120 מ׳" / "1.2 ק״מ". */
export function formatDistance(metres: number): string {
  const m = Math.max(0, metres);
  if (m >= 950) return NAV.km((Math.round(m / 100) / 10).toFixed(1));
  let n: number;
  if (m >= 100) n = Math.round(m / 10) * 10;
  else if (m >= 30) n = Math.round(m / 5) * 5;
  else n = Math.round(m);
  return NAV.metres(n);
}

/** "בעוד 120 מ׳" or "עכשיו" when the manoeuvre point is right here. */
export function formatNavDistance(metres: number, nowThreshold = 15): string {
  if (metres < nowThreshold) return NAV.now;
  return NAV.inDistance(formatDistance(metres));
}

/** mm:ss (or h:mm:ss above one hour). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** "24 דק׳" / "1 שעה 5 דק׳" style duration for result sheets. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} שנ׳`;
  if (m < 60) return s > 0 ? `${m} דק׳ ${s} שנ׳` : `${m} דק׳`;
  const h = Math.floor(m / 60);
  return `${h} שע׳ ${m % 60} דק׳`;
}

export function formatDateHe(d: number | Date): { date: string; time: string } {
  const dt = typeof d === 'number' ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}`,
    time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
  };
}

export function formatHour(h: number): string {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function kmh(mps: number): number {
  return Math.round(Math.abs(mps) * 3.6);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function percent(v: number): string {
  return `${Math.round(clamp(v, 0, 1) * 100)}%`;
}
