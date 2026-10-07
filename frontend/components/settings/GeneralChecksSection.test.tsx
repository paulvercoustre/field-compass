import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_CHECKS, QualityChecksForm } from '../../utils/qualityCheckSettings';
import GeneralChecksSection from './GeneralChecksSection';

const controls = { editing: false, saving: false, edit: vi.fn(), save: vi.fn(), cancel: vi.fn() };

const renderSection = (initial: Partial<QualityChecksForm> = {}, hasCollectionDates = true) => {
  let latest: QualityChecksForm = { ...DEFAULT_QUALITY_CHECKS, ...initial };
  const Harness = () => {
    const [checks, setChecks] = useState(latest);
    latest = checks;
    return (
      <GeneralChecksSection
        checks={checks}
        setChecks={setChecks}
        durations={{ min_survey_duration_minutes: null, max_survey_duration_minutes: null }}
        onDurationChange={vi.fn()}
        hasCollectionDates={hasCollectionDates}
        canEdit
        dirty={false}
        controls={controls}
      />
    );
  };
  const view = render(<Harness />);
  return { view, checks: () => latest };
};

describe('GeneralChecksSection', () => {
  afterEach(cleanup);

  it('cannot turn on the out-of-period check without collection dates', () => {
    const { view } = renderSection({ flag_out_of_period: true }, false);
    const box = view.getByLabelText('Flag submissions outside the collection period') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(view.getByText(/Needs a collection start or end date/)).toBeTruthy();
  });

  it('toggles weekend days and keeps them in order', () => {
    const { view, checks } = renderSection({ flag_weekend: true, weekend_days: [5, 6] });
    fireEvent.click(view.getByRole('button', { name: 'Sat' }));
    fireEvent.click(view.getByRole('button', { name: 'Fri' }));
    expect(checks().weekend_days).toEqual([4, 6]);
  });

  it('keeps a threshold between 0 and 100', () => {
    const { view, checks } = renderSection({ flag_dk_percentage: true });
    fireEvent.change(view.getByRole('spinbutton', { name: 'Threshold (%)' }), { target: { value: '140' } });
    expect(checks().dk_percentage_threshold).toBe(100);
  });

  it('shows options only while their check is on', () => {
    const { view } = renderSection();
    expect(view.queryByText('Start Time')).toBeNull();
    fireEvent.click(view.getByLabelText('Flag submissions outside office hours'));
    expect(view.getByText('Start Time')).toBeTruthy();
  });
});
