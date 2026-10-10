/**
 * Progress's arithmetic: what is left, the pace, and the days the chart draws
 * (docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md).
 *
 * Every submission but Not approved counts toward the target. The pace is
 * the last 7 days, today included, so a stall shows; there is no daily
 * objective (decided 2026-10-09).
 */

const PACE_DAYS = 7;
/** Collection seems under way while something arrived this recently; the chart then runs to today. */
const ACTIVE_DAYS = 14;
/** A projection further out than this says "more than 2 months" rather than drawing a line. */
const PROJECTION_MAX_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const toTime = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const toIso = (time: number): string => new Date(time).toISOString().slice(0, 10);

const addDays = (iso: string, days: number): string => toIso(toTime(iso) + days * DAY_MS);
const daysBetween = (from: string, to: string): number => Math.round((toTime(to) - toTime(from)) / DAY_MS);

/** What is left to the target; null without one. Never below zero: over the target is done. */
export const toGo = (target: number | null, done: number): number | null =>
  target === null ? null : Math.max(0, target - done);

/** Submissions a day over the last 7 days, to one decimal. */
export const pacePerDay = (lastSevenDays: number): number => Math.round((lastSevenDays / PACE_DAYS) * 10) / 10;

/** Days to the target at this pace; null when nothing came in lately, or when it is further than 2 months. */
export const daysAtPace = (left: number, perDay: number): number | null => {
  if (perDay <= 0) return null;
  const days = Math.ceil(left / perDay);
  return days > PROJECTION_MAX_DAYS ? null : days;
};

/** Where the chart's days end: today while collection seems under way, else the last submission. */
export const chartEnd = (daily: { day: string }[], today: string): string | null => {
  if (daily.length === 0) return null;
  const last = daily[daily.length - 1].day;
  return daysBetween(last, today) <= ACTIVE_DAYS ? today : last;
};

export interface CollectionDay {
  day: string;
  /** Counted that day; undefined on a projected day. */
  counted?: number;
  /** Counted up to and including that day; undefined on a projected day. */
  total?: number;
  /** Where the total would be at the recent pace, from the last day on. */
  projected?: number;
}

/**
 * Every day from the first submission to the end, gaps as 0, with the total
 * so far; then, when there is a pace and something left, the days to the
 * target at that pace, and on to the planned end if that is later and near.
 */
export const collectionDays = (
  daily: { day: string; counted: number }[],
  today: string,
  target: number | null,
  plannedEnd: string | null
): CollectionDay[] => {
  const end = chartEnd(daily, today);
  if (!end) return [];
  const counts = new Map(daily.map((d) => [d.day, d.counted]));
  const days: CollectionDay[] = [];
  let total = 0;
  for (let day = daily[0].day; day <= end; day = addDays(day, 1)) {
    total += counts.get(day) ?? 0;
    days.push({ day, counted: counts.get(day) ?? 0, total });
  }

  const recent = daily.filter((d) => daysBetween(d.day, today) < PACE_DAYS).reduce((n, d) => n + d.counted, 0);
  const perDay = pacePerDay(recent);
  const left = toGo(target, total);
  const needed = end === today && left ? daysAtPace(left, perDay) : null;
  let last = end;
  if (needed !== null) {
    days[days.length - 1].projected = total;
    for (let n = 1; n <= needed; n++) {
      last = addDays(end, n);
      days.push({ day: last, projected: Math.min(target!, Math.round(total + perDay * n)) });
    }
  }
  if (plannedEnd && plannedEnd > last && daysBetween(last, plannedEnd) <= PROJECTION_MAX_DAYS) {
    for (let day = addDays(last, 1); day <= plannedEnd; day = addDays(day, 1)) days.push({ day });
  }
  return days;
};

/** A y-axis that ends on a round number above `value`, with about four round steps. */
export const niceScale = (value: number, steps = 4): { max: number; ticks: number[] } => {
  if (value <= 0) return { max: 1, ticks: [0, 1] };
  const raw = value / steps;
  const base = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * base).find((s) => s >= raw)!;
  const max = Math.ceil(value / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) };
};
