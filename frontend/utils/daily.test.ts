import { describe, expect, it } from 'vitest';
import { byDay } from './daily';

const days = [
  { day: '2026-09-14', submissions: 8, flagged: 3, issues: 5 },
  { day: '2026-09-15', submissions: 2, flagged: 0, issues: 0 },
];

describe('quality by day', () => {
  it('is a share of the day’s submissions, not a count', () => {
    expect(byDay(days, 'flagged')).toEqual([
      { day: '2026-09-14', value: 38, detail: '3 of 8 flagged' },
      { day: '2026-09-15', value: 0, detail: '0 of 2 flagged' },
    ]);
  });

  it('gives issues per submission for each day collected', () => {
    expect(byDay(days, 'issues').map((d) => d.value)).toEqual([0.63, 0]);
  });
});
