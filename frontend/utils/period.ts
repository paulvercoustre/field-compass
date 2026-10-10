/**
 * The period a data page covers: the whole survey unless someone narrows it
 * (decided 2026-10-09). Data quality and Field team offer the same choices.
 */

export type Period = 'all' | 'last7' | 'last30';

export const PERIODS: { value: Period; label: string; days?: number }[] = [
  { value: 'all', label: 'All time' },
  { value: 'last7', label: 'Last 7 days', days: 7 },
  { value: 'last30', label: 'Last 30 days', days: 30 },
];

/** The dates the API takes for a period; none for all time. */
export const periodDates = (period: Period): { startDate?: string; endDate?: string } => {
  const days = PERIODS.find((p) => p.value === period)?.days;
  if (!days) return {};
  const today = new Date();
  const day = (d: Date) => d.toISOString().split('T')[0];
  return { startDate: day(new Date(today.getTime() - days * 24 * 60 * 60 * 1000)), endDate: day(today) };
};
