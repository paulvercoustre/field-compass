import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckRow, SubmissionSummary } from '../../types';
import ByCheckTable from './ByCheckTable';
import ReviewCard from './ReviewCard';

afterEach(cleanup);

const summary: SubmissionSummary = {
  submissions: 100,
  flagged: 40,
  issues: 55,
  needs_review: 30,
  on_hold: 2,
  clean: 40,
  reviewed: 28,
  approved: 20,
  not_approved: 8,
  issues_per_submission: 0.55,
  duration_minutes: 27,
  duration_measured: 100,
  duration_from_start_end: 0,
  dk_rate: 2.6,
  duration_p25: 21,
  duration_p75: 34,
  checks: {},
  first_submission: '2026-09-01T08:00:00',
  last_submission: '2026-09-28T15:00:00',
  daily: [],
};

const row = (check: string, over: Partial<CheckRow> = {}): CheckRow => ({
  check,
  on: true,
  flagged: 0,
  issues: 0,
  needs_review: 0,
  last_14_days: [],
  top_enumerator: null,
  ...over,
});

describe('ReviewCard', () => {
  it('opens each review tab, but Clean has none', () => {
    const onOpen = vi.fn();
    const view = render(<ReviewCard summary={summary} oldestNeedsReview={null} onOpen={onOpen} />);
    fireEvent.click(view.getByRole('button', { name: 'Open Needs review 30' }));
    fireEvent.click(view.getByRole('button', { name: /^Not approved 8/ }));
    expect(onOpen.mock.calls).toEqual([['needs_review'], ['not_approved']]);
    expect(view.queryByRole('button', { name: /^Clean/ })).toBeNull();
    expect(view.getByText(/Reviewed 28 \(28%\)/)).toBeTruthy();
  });

  it('says how long the oldest has waited', () => {
    const view = render(<ReviewCard summary={summary} oldestNeedsReview={new Date().toISOString()} />);
    expect(view.getByText(/Oldest still waiting: sent .*, today/)).toBeTruthy();
  });
});

describe('ByCheckTable', () => {
  const rows: CheckRow[] = [
    row('duration_too_short', {
      flagged: 30,
      issues: 30,
      needs_review: 12,
      last_14_days: [0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 4],
      // 25 of their 25 against 30% for the team.
      top_enumerator: { id: 'enum_07', flagged: 25, submissions: 25 },
    }),
    row('my_rule', { on: null, flagged: 2, issues: 2, top_enumerator: { id: 'enum_03', flagged: 1, submissions: 60 } }),
    row('outliers'),
    row('interview_on_weekend', { on: false }),
  ];

  // Submissions each of the 14 days: none on the first.
  const daySubmissions = [0, 2, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 8];

  const renderTable = (handlers = {}) =>
    render(
      <ByCheckTable
        rows={rows}
        submissions={100}
        lastDay="2026-09-28"
        daySubmissions={daySubmissions}
        config={null}
        onOpenSettings={vi.fn()}
        {...handlers}
      />
    );

  it('lists what flagged, then what is on and quiet, then what is off', () => {
    const view = renderTable();
    const firsts = view.getAllByRole('row').map((r) => r.querySelector('td')?.textContent);
    expect(firsts).toEqual([
      undefined, // the header
      'Interview too short',
      'My rule',
      'Outliers',
      'Off: these checks did not run',
      'Interview on a weekend',
    ]);
    const weekend = view.getAllByRole('row').at(-1)!;
    expect(within(weekend).getByRole('button', { name: 'Turn on in Settings' })).toBeTruthy();
  });

  it('highlights the enumerator a check flags at twice the team’s share', () => {
    const view = renderTable();
    const highlighted = Array.from(view.container.querySelectorAll('.bg-amber-100')).map((el) => el.textContent);
    expect(highlighted).toEqual(['enum_0725 of 25', 'Highlighted']);
  });

  it('draws each day as a share of its submissions, not a count', () => {
    const view = renderTable();
    // 10 flagged of the 65 sent in the 14 days.
    const spark = view.getByRole('img', { name: /^15% flagged in the 14 days to / });
    const titles = Array.from(spark.querySelectorAll('title')).map((t) => t.textContent);
    expect(titles[0]).toMatch(/: no submissions$/);
    expect(titles[12]).toMatch(/: 3 of 6 \(50%\)$/);
    expect(titles[13]).toMatch(/: 4 of 8 \(50%\)$/);
    // Equal shares, equal bars, though the days differ in size.
    const bars = Array.from(spark.querySelectorAll('rect.fill-amber-600')).map((r) => r.getAttribute('height'));
    expect(bars.slice(-2)).toEqual(['20', '20']);
  });

  it('opens a check’s submissions, its Needs review, and the enumerator', () => {
    const onOpenCheck = vi.fn();
    const onNeedsReview = vi.fn();
    const onOpenEnumerator = vi.fn();
    const view = renderTable({ onOpenCheck, onNeedsReview, onOpenEnumerator });
    fireEvent.click(view.getByRole('button', { name: 'Open the 30 submissions Interview too short flagged' }));
    fireEvent.click(view.getByRole('button', { name: 'Open 12 in Needs review for Interview too short' }));
    fireEvent.click(view.getByRole('button', { name: 'Open enum_07’s call sheet' }));
    expect(onOpenCheck).toHaveBeenCalledWith('duration_too_short');
    expect(onNeedsReview).toHaveBeenCalledWith('duration_too_short');
    expect(onOpenEnumerator).toHaveBeenCalledWith('enum_07');
    // Nothing flagged, nothing to open.
    expect(view.queryByRole('button', { name: /Outliers/ })).toBeNull();
  });
});
