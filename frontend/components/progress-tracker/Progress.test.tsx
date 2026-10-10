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
  last_7_days: 0,
  not_approved: 0,
  ...over,
});

const data = (over: Partial<ProgressData> = {}): ProgressData => ({
  mode: 'by_variable',
  overall: {
    conducted: 138,
    target: 160,
    progress: 86.3,
    days_active: 28,
    submissions_per_day: 4.9,
    approved: 35,
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
  daily: [{ day: '2026-09-01', counted: 5 }],
  planned_end: null,
  today: '2026-10-10',
  ...over,
});

describe('ProgressSummary', () => {
  it('says what is done, the Approved part, what is left out, and the pace', () => {
    const view = render(<ProgressSummary data={data()} />);
    const text = view.container.textContent;
    expect(text).toContain('138 of 160 done');
    expect(text).toContain('35 of them approved');
    expect(text).toContain('9 Not approved, not counted');
    expect(text).toContain('86%');
    // 14 in the last 7 days: 2 a day, 11 days for the 22 left.
    expect(text).toContain('2 a day');
    expect(text).toContain('About 11 days');
    expect(text).toContain('Not decided yet 103');
  });

  it('says when nothing came in lately, and when the target is reached', () => {
    const stalled = data({ overall: { ...data().overall, last_7_days: 0 } });
    expect(render(<ProgressSummary data={stalled} />).container.textContent).toContain('no recent pace to go by');
    cleanup();
    const reached = data({ overall: { ...data().overall, conducted: 170, progress: 106.3 } });
    expect(render(<ProgressSummary data={reached} />).container.textContent).toContain('10 over the target');
  });

  it('offers to add targets when there are none', () => {
    const onOpenSettings = vi.fn();
    const none = data({ mode: 'none', overall: { ...data().overall, target: null, progress: null } });
    const view = render(<ProgressSummary data={none} onOpenSettings={onOpenSettings} />);
    expect(view.container.textContent).toContain('138 done');
    fireEvent.click(view.getByRole('button', { name: 'Add targets' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe('ProgressTable', () => {
  it('puts the most behind first, groups without a target last, and says why the To go differs', () => {
    const view = render(<ProgressTable data={data()} surveyConfig={null} />);
    const firsts = view.getAllByRole('row').map((r) => r.querySelector('td')?.textContent);
    expect(firsts).toEqual([undefined, 'd_east', 'd_north', 'd_west', 'd_south', 'd_centralno target']);
    expect(view.container.textContent).toContain(
      'The districts are 30 short in all, not 22: 5 submissions are in d_central, which has no target, and d_south is 3 over its target.'
    );
  });

  it('opens a group’s submissions', () => {
    const onOpen = vi.fn();
    const view = render(<ProgressTable data={data()} surveyConfig={null} onOpen={onOpen} />);
    fireEvent.click(view.getByRole('button', { name: 'Open the submissions for d_east' }));
    expect(onOpen).toHaveBeenCalledWith([{ variable: 'district', values: ['d_east'] }]);
  });
});
