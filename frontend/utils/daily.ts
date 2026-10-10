/**
 * Quality by day, for the daily charts and the By check view's last 14 days.
 * Always a share of that day's submissions, never a count: a busy day must not
 * look worse than a quiet one, and how many came in is progress, not quality.
 */
import { DayPoint } from '../types';
import { percentOf } from './glossary';

export type DailyMeasure = 'flagged' | 'issues';

export interface DayValue {
  day: string;
  value: number;
  /** What the value is made of, for the tooltip: "3 of 8 flagged". */
  detail: string;
}

/** Each day with submissions: its share flagged, or its issues per submission. */
export const byDay = (daily: DayPoint[], measure: DailyMeasure): DayValue[] =>
  daily
    .filter((d) => d.submissions > 0)
    .map((d) =>
      measure === 'flagged'
        ? {
            day: d.day,
            value: percentOf(d.flagged, d.submissions) ?? 0,
            detail: `${d.flagged} of ${d.submissions} flagged`,
          }
        : {
            day: d.day,
            value: Math.round((d.issues / d.submissions) * 100) / 100,
            detail: `${d.issues} issues in ${d.submissions} submissions`,
          }
    );

/** "14 Sep": a date alone is read as UTC midnight, so it is read here as the local day. */
export const shortDay = (iso: string): string =>
  new Date(`${iso}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
