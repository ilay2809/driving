// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { theoryStatsLine } from './theoryMode';

describe('theoryStatsLine', () => {
  it('is empty before anything was answered', () => {
    expect(theoryStatsLine({ attempts: 0, correct: 0, exams: { taken: 0, passed: 0, best: 0 } })).toBe('');
  });

  it('reports answers (engine "attempts", not "answered") and mock exams', () => {
    expect(theoryStatsLine({ attempts: 5, correct: 3, exams: { taken: 0, passed: 0, best: 0 } })).toBe('ענית על 5 שאלות, 3 נכונות');
    expect(theoryStatsLine({ attempts: 35, correct: 30, exams: { taken: 1, passed: 1, best: 27 } })).toBe('ענית על 35 שאלות, 30 נכונות · 1 מבחנים מדומים, 1 עברת');
  });
});
