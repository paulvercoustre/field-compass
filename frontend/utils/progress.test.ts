import { describe, expect, it } from 'vitest';
import { chartEnd, collectionDays, daysAtPace, niceScale, pacePerDay, toGo } from './progress';

describe('progress arithmetic', () => {
  it('is never below zero to go, and has none without a target', () => {
    expect(toGo(160, 138)).toBe(22);
    expect(toGo(160, 170)).toBe(0);
    expect(toGo(null, 10)).toBeNull();
  });

  it('paces over the last 7 days and projects no further than 2 months', () => {
    expect(pacePerDay(70)).toBe(10);
    expect(daysAtPace(22, 10)).toBe(3);
    expect(daysAtPace(22, 0)).toBeNull();
    expect(daysAtPace(1000, 1)).toBeNull();
  });

  it('runs to today while collection is under way, else stops at the last submission', () => {
    expect(chartEnd([{ day: '2026-10-01' }], '2026-10-10')).toBe('2026-10-10');
    expect(chartEnd([{ day: '2026-09-01' }], '2026-10-10')).toBe('2026-09-01');
    expect(chartEnd([], '2026-10-10')).toBeNull();
  });
});

describe('the chart’s scale', () => {
  it('ends on a round number above the target, in round steps', () => {
    expect(niceScale(160 * 1.04)).toEqual({ max: 200, ticks: [0, 50, 100, 150, 200] });
    expect(niceScale(9)).toEqual({ max: 10, ticks: [0, 5, 10] });
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
  });
});

describe('the chart’s days', () => {
  const daily = [
    { day: '2026-10-07', counted: 4 },
    { day: '2026-10-09', counted: 10 },
  ];

  it('fills the gaps and adds up as it goes', () => {
    const days = collectionDays(daily, '2026-10-09', null, null);
    expect(days.map((d) => [d.day, d.counted, d.total])).toEqual([
      ['2026-10-07', 4, 4],
      ['2026-10-08', 0, 4],
      ['2026-10-09', 10, 14],
    ]);
  });

  it('projects to the target at the recent pace: 14 in 7 days is 2 a day', () => {
    const days = collectionDays(daily, '2026-10-09', 20, null);
    expect(days.slice(2).map((d) => [d.day, d.projected])).toEqual([
      ['2026-10-09', 14],
      ['2026-10-10', 16],
      ['2026-10-11', 18],
      ['2026-10-12', 20],
    ]);
  });

  it('runs on to a planned end that is near', () => {
    const days = collectionDays(daily, '2026-10-09', null, '2026-10-12');
    expect(days.map((d) => d.day).slice(-1)).toEqual(['2026-10-12']);
    expect(days[days.length - 1].total).toBeUndefined();
  });

  it('projects nothing once collection has stopped', () => {
    const days = collectionDays(daily, '2026-11-30', 20, null);
    expect(days.some((d) => d.projected !== undefined)).toBe(false);
  });
});
