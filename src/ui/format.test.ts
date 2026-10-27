import { describe, expect, it } from 'vitest';
import { formatClock, formatDateHe, formatDistance, formatDuration, formatHour, formatNavDistance } from './format';

describe('format', () => {
  it('formats distances in metres and kilometres', () => {
    expect(formatDistance(1234)).toBe('1.2 ק״מ');
    expect(formatDistance(950)).toBe('1.0 ק״מ');
    expect(formatDistance(123)).toBe('120 מ׳');
    expect(formatDistance(47)).toBe('45 מ׳');
    expect(formatDistance(12.4)).toBe('12 מ׳');
    expect(formatNavDistance(10)).toBe('עכשיו');
    expect(formatNavDistance(60)).toBe('בעוד 60 מ׳');
  });

  it('formats clocks and durations', () => {
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3661)).toBe('1:01:01');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatDuration(1421)).toBe('23 דק׳ 41 שנ׳');
    expect(formatDuration(120)).toBe('2 דק׳');
    expect(formatDuration(45)).toBe('45 שנ׳');
    expect(formatDuration(3900)).toBe('1 שע׳ 5 דק׳');
    expect(formatHour(10.5)).toBe('10:30');
  });

  it('formats dates as dd.mm.yyyy', () => {
    const { date, time } = formatDateHe(new Date(2026, 9, 27, 9, 5));
    expect(date).toBe('27.10.2026');
    expect(time).toBe('09:05');
  });
});
