import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnumeratorSummary, PerformanceData, SubmissionSummary } from '../../types';
import FollowUpTable from './FollowUpTable';
import CallSheet from './CallSheet';

const summary = (over: Partial<SubmissionSummary> = {}): SubmissionSummary => ({
  submissions: 10,
  flagged: 1,
  issues: 1,
  needs_review: 1,
  on_hold: 0,
  clean: 7,
  reviewed: 2,
  approved: 2,
  not_approved: 0,
  issues_per_submission: 0.1,
  duration_minutes: 25,
  duration_measured: 10,
  duration_from_start_end: 0,
  dk_rate: 2,
  duration_p25: 20,
  duration_p75: 30,
  checks: { duration_too_short: 1 },
  first_submission: '2026-09-15T08:00:00',
  last_submission: '2026-09-28T15:38:00',
  daily: [],
  ...over,
});

const enumerator = (id: string, over: Partial<SubmissionSummary> = {}): EnumeratorSummary => ({
  id,
  durations: [24, 26],
  ...summary(over),
});

const enum07 = enumerator('enum_07', {
  flagged: 10,
  not_approved: 3,
  needs_review: 6,
  checks: { duration_too_short: 10, outlier_income: 2 },
  durations: [6, 7],
} as Partial<SubmissionSummary>);

const data = (): PerformanceData => ({
  // 20% flagged, 5% not approved, 10% too short across the team.
  team: summary({ submissions: 60, flagged: 12, not_approved: 3, needs_review: 9, checks: { duration_too_short: 6 } }),
  enumerators: [enumerator('enum_03'), enum07, enumerator('enum_08', { submissions: 4, flagged: 4 })],
  no_enumerator: summary({ submissions: 3, flagged: 3 }),
  checks_on: ['duration_too_short'],
  checks_off: [],
  custom_checks: 0,
});

const cellTexts = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

afterEach(cleanup);

describe('FollowUpTable', () => {
  it('puts the team first, the most flagged next, too few apart, and no enumerator last', () => {
    const view = render(<FollowUpTable data={data()} config={null} onOpen={vi.fn()} />);
    const firsts = view.getAllByRole('row').map((row) => row.querySelector('td')?.textContent);
    expect(firsts).toEqual([
      undefined, // the header
      'Whole team',
      'enum_07',
      'enum_03',
      'Too few submissions to compare (under 5)',
      'enum_08',
      'No enumerator recorded',
    ]);
  });

  it('highlights flags at twice the team’s, and only for enough submissions', () => {
    const view = render(<FollowUpTable data={data()} config={null} onOpen={vi.fn()} />);
    const row = (id: string) => view.getAllByRole('row').find((r) => r.querySelector('td')?.textContent === id)!;
    const highlighted = (id: string) =>
      Array.from(row(id).querySelectorAll('.bg-amber-100, .bg-amber-50')).map((el) => el.textContent);
    expect(highlighted('enum_07')).toEqual(['100%', '30%', 'Interview too short ×10']);
    expect(highlighted('enum_03')).toEqual([]);
    expect(highlighted('enum_08')).toEqual([]);
    expect(cellTexts(row('enum_07'))).toContain('2 of 10');
  });

  it('opens a call sheet from a row, and Needs review from its link', () => {
    const onOpen = vi.fn();
    const onNeedsReview = vi.fn();
    const view = render(<FollowUpTable data={data()} config={null} onOpen={onOpen} onNeedsReview={onNeedsReview} />);
    fireEvent.click(view.getByRole('button', { name: 'enum_07' }));
    expect(onOpen).toHaveBeenCalledWith('enum_07');
    fireEvent.click(view.getByRole('button', { name: 'Open 6 in Needs review for enum_07' }));
    expect(onNeedsReview).toHaveBeenCalledWith('enum_07');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('CallSheet', () => {
  const renderSheet = (onOpenSubmissions = vi.fn()) =>
    render(
      <CallSheet
        enumerator={enum07}
        team={data().team!}
        config={null}
        onClose={vi.fn()}
        onOpenSubmissions={onOpenSubmissions}
      />
    );

  it('starts with Not approved, then Flagged', () => {
    const view = renderSheet();
    // The ⓘ sits in the heading; its own button names it.
    const titles = view.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.replace('ⓘ', ''));
    expect(titles.slice(0, 4)).toEqual(['Not approved', 'Flagged', 'Duration', 'Don’t-know rate']);
  });

  it('opens their submissions for one check, or their Needs review', () => {
    const open = vi.fn();
    const view = renderSheet(open);
    const checks = view.getByRole('region', { name: 'Checks that flagged them' });
    fireEvent.click(within(checks).getAllByRole('button', { name: 'See them' })[0]);
    expect(open).toHaveBeenCalledWith({ review: 'all', issue: 'duration_too_short' });
    fireEvent.click(view.getByRole('button', { name: 'Open Needs review 6' }));
    expect(open).toHaveBeenCalledWith({ review: 'needs_review' });
  });

  it('copies the summary', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const view = renderSheet();
    fireEvent.click(view.getByRole('button', { name: 'Copy' }));
    expect(await view.findByText('Copied')).toBeTruthy();
    expect(writeText.mock.calls[0][0]).toContain('enum_07');
    expect(writeText.mock.calls[0][0]).toContain('3 not approved (30%; team 5%).');
  });
});
