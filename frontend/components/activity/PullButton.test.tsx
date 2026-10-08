import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSurvey } from '../../contexts/SurveyContext';
import { getSurveyRuns, RunSummary } from '../../services/activityApi';
import { PullButton, usePull } from './PullButton';

vi.mock('../../contexts/SurveyContext', () => ({ useSurvey: vi.fn() }));
vi.mock('../../contexts/ActivityContext', () => ({
  useActivity: () => ({ startPull: vi.fn(), latestRunFor: () => null }),
}));
vi.mock('../../services/activityApi', () => ({ getSurveyRuns: vi.fn() }));

const Harness = () => <PullButton pull={usePull()} />;

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const as = (permission: string) =>
  vi.mocked(useSurvey).mockReturnValue({
    selectedSurvey: { survey_id: 's1', permission },
  } as unknown as ReturnType<typeof useSurvey>);

const runs = (list: Array<Partial<RunSummary>>) =>
  vi.mocked(getSurveyRuns).mockResolvedValue({ runs: list as RunSummary[] });

describe('PullButton', () => {
  afterEach(cleanup);

  it('says when the data last came from Kobo, from the latest pull that stored it', async () => {
    as('editor');
    runs([
      { kind: 'pull', status: 'failed', started_at: hoursAgo(1) },
      { kind: 'ai_rerun', status: 'finished', started_at: hoursAgo(2) },
      { kind: 'pull', status: 'finished', started_at: hoursAgo(3) },
    ]);
    const view = render(<Harness />);
    await waitFor(() => expect(view.getByText('Last pulled 3 h ago')).toBeTruthy());
    expect(view.getByRole('button', { name: /Refresh from Kobo/ })).toBeTruthy();
  });

  it('shows viewers when, without a button they can’t use', async () => {
    as('viewer');
    runs([]);
    const view = render(<Harness />);
    await waitFor(() => expect(view.getByText('Not pulled from Kobo yet')).toBeTruthy());
    expect(view.queryByRole('button', { name: /Refresh from Kobo/ })).toBeNull();
  });
});
