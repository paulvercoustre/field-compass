import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgressData } from '../../types';
import ProgressSummary from './ProgressSummary';
import ProgressTable from './ProgressTable';

afterEach(cleanup);

const row = (value: string, target: number | null, conducted: number, over: object = {}) => ({
  value,
  target,
  conducted,
  progress: target ? Math.round((conducted / target) * 1000) / 10 : null,
  share: null,
  approved: 1,
  clean: conducted - 1,
  on_hold: 0,
  needs_review: 0,
  last_7_days: 0,
  not_approved: 0,
  ...over,
});

const data = (over: Partial<ProgressData> = {}): ProgressData => ({
  mode: 'by_variable',
  overall: {
    conducted: 138,
    target: 160,
    // 5 in d_central, which has no target; 3 more in d_south than its 40.
    toward_target: 130,
    over_target: 3,
    no_target: 5,
    progress: 81.3,
    days_active: 28,
    submissions_per_day: 4.9,
    approved: 35,
    clean: 60,
    on_hold: 2,
    needs_review: 33,
    last_7_days: 14,
  },
  byColumn: {
    district: [
      row('d_central', null, 5),
      row('d_east', 40, 22, { not_approved: 2 }),
      row('d_north', 40, 34),
      row('d_south', 40, 43),
      row('d_west', 40, 34),
    ],
  },
  detailed: [],
  samplingColumns: ['district'],
  not_approved: 9,
  daily: [{ day: '2026-09-01', counted: 5, toward: 5 }],
  planned_end: null,
  today: '2026-10-10',
  ...over,
});

describe('ProgressSummary', () => {
  it('counts toward the targets as the sampling plan does, and says what doesn’t count', () => {
    const view = render(<ProgressSummary data={data()} />);
    const text = view.container.textContent;
    expect(text).toContain('130 of 160 done');
    expect(text).toContain('81%');
    expect(text).toContain('35 of them approved');
    expect(text).toContain('9 Not approved, not counted');
    expect(text).toContain(
      '8 more don’t count toward a target: 5 in a district with no target, 3 beyond their district’s target.'
    );
    // 14 toward the targets in the last 7 days: 2 a day, 15 days for the 30 left.
    expect(text).toContain('2 a day');
    expect(text).toContain('About 15 days');
  });

  it('splits what is done in the review states’ own words', () => {
    const text = render(<ProgressSummary data={data()} />).container.textContent;
    expect(text).toContain('Approved 35Clean 60On hold 2Needs review 33To go 30');
  });

  it('says when nothing came in lately, and when the target is reached', () => {
    const stalled = data({ overall: { ...data().overall, last_7_days: 0 } });
    expect(render(<ProgressSummary data={stalled} />).container.textContent).toContain('no recent pace to go by');
    cleanup();
    const reached = data({ overall: { ...data().overall, conducted: 168, toward_target: 160, progress: 100 } });
    expect(render(<ProgressSummary data={reached} />).container.textContent).toContain('Target reached');
  });

  it('offers to add targets when there are none', () => {
    const onOpenSettings = vi.fn();
    const none = data({
      mode: 'none',
      overall: { ...data().overall, target: null, toward_target: null, over_target: 0, no_target: 0, progress: null },
    });
    const view = render(<ProgressSummary data={none} onOpenSettings={onOpenSettings} />);
    expect(view.container.textContent).toContain('138 done');
    fireEvent.click(view.getByRole('button', { name: 'Add targets' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe('ProgressTable', () => {
  it('puts the most behind first and groups without a target last; their To go adds up to the headline’s', () => {
    const view = render(<ProgressTable data={data()} surveyConfig={null} />);
    const rows = view.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('td')?.textContent)).toEqual([
      'd_east',
      'd_north',
      'd_west',
      'd_south',
      'd_centralno target',
    ]);
    // The To go column: 18 + 6 + 6 + 0 = 30, the summary's.
    const toGo = rows.map((r) => r.querySelectorAll('td')[6].textContent);
    expect(toGo).toEqual(['18', '6', '6', '0', '—']);
  });

  it('opens a group’s submissions', () => {
    const onOpen = vi.fn();
    const view = render(<ProgressTable data={data()} surveyConfig={null} onOpen={onOpen} />);
    fireEvent.click(view.getByRole('button', { name: 'Open the submissions for d_east' }));
    expect(onOpen).toHaveBeenCalledWith([{ variable: 'district', values: ['d_east'] }]);
  });
});
