import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EnumeratorSummary, PerformanceData, SubmissionSummary } from '../../types';
import PerformanceDataView from './PerformanceDataView';

const summary = (over: Partial<SubmissionSummary> = {}): SubmissionSummary => ({
  submissions: 10,
  flagged: 2,
  issues: 2,
  needs_review: 1,
  on_hold: 0,
  clean: 6,
  reviewed: 3,
  approved: 3,
  not_approved: 0,
  issues_per_submission: 0.2,
  duration_minutes: 25,
  duration_measured: 10,
  duration_from_start_end: 0,
  dk_rate: 2,
  ...over,
});

const enumerator = (id: string, over: Partial<SubmissionSummary> = {}): EnumeratorSummary => ({
  id,
  ...summary(over),
});

const data = (enumerators: EnumeratorSummary[]): PerformanceData => ({
  // 20% flagged, 5% not approved across the team.
  team: summary({ submissions: 40, flagged: 8, not_approved: 2 }),
  enumerators,
  no_enumerator: 0,
});

const row = (view: ReturnType<typeof render>, id: string) =>
  view.getAllByRole('row').find((r) => within(r).queryByText(id)) as HTMLElement;

afterEach(cleanup);

describe('PerformanceDataView', () => {
  it('highlights a share at least twice the team’s, given enough submissions', () => {
    const view = render(
      <PerformanceDataView
        data={data([
          enumerator('enum_07', { submissions: 10, flagged: 10, not_approved: 3 }),
          enumerator('enum_03', { submissions: 10, flagged: 3, not_approved: 0 }),
          // As often flagged as enum_07, but four submissions are too few to say.
          enumerator('enum_08', { submissions: 4, flagged: 4 }),
        ])}
      />
    );
    const highlighted = (id: string) =>
      Array.from(row(view, id).querySelectorAll('span.bg-amber-100')).map((el) => el.textContent);

    expect(highlighted('enum_07')).toEqual(['100% (10)', '30% (3)']);
    expect(highlighted('enum_03')).toEqual([]);
    expect(highlighted('enum_08')).toEqual([]);
  });

  it('shows the team’s own figures, and “not measured” rather than a 0', () => {
    const view = render(
      <PerformanceDataView data={data([enumerator('enum_01', { dk_rate: null, duration_minutes: null })])} />
    );
    expect(within(row(view, 'Whole team')).getByText('20% (8)')).toBeTruthy();
    expect(within(row(view, 'enum_01')).getAllByText('not measured')).toHaveLength(2);
  });

  it('never colours review progress', () => {
    const view = render(
      <PerformanceDataView data={data([enumerator('enum_07', { submissions: 10, flagged: 10, not_approved: 3 })])} />
    );
    fireEvent.click(view.getByRole('button', { name: 'Review' }));
    expect(row(view, 'enum_07').querySelectorAll('span.bg-amber-100')).toHaveLength(0);
  });
});
