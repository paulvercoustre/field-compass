import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterState, QAStatus, Submission, SubmissionFacets } from '../types';
import { api } from '../services/api';
import { useReviewPreferences } from '../contexts/AuthContext';
import Dashboard from './Dashboard';

vi.mock('../services/api', () => ({
  api: {
    getSubmissions: vi.fn(),
    getSubmissionFacets: vi.fn(),
    updateValidationStatus: vi.fn(),
    updateReviewerNotes: vi.fn(),
    approveCleanSubmissions: vi.fn(),
    getKoboEditUrl: vi.fn(),
  },
}));
vi.mock('../services/progressApi', () => ({
  getSurveyConfig: vi
    .fn()
    .mockResolvedValue({ survey_id: 's1', survey_name: 'S', kobo_asset_id: 'a', config_data: {} }),
  getValidationRules: vi.fn().mockResolvedValue([]),
}));
vi.mock('../contexts/SurveyContext', () => {
  const survey = { selectedSurvey: { survey_id: 's1', survey_name: 'S', kobo_asset_id: 'a', permission: 'owner' } };
  return { useSurvey: () => survey };
});
vi.mock('../contexts/ActivityContext', () => ({ useActivity: () => ({ runs: [] }) }));
vi.mock('../contexts/AuthContext', () => ({ useReviewPreferences: vi.fn() }));
vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigate: vi.fn(), reportPlace: vi.fn() }),
}));
vi.mock('./activity/PullButton', () => ({
  usePull: () => ({ run: undefined, pulling: false }),
  PullButton: () => null,
  PullStartError: () => null,
}));
vi.mock('./transcription/AudioAnswers', () => ({
  useSubmissionTranscripts: () => null,
  Player: () => null,
  RecordingDetails: () => null,
  RecordingStatus: () => null,
}));
vi.mock('./translation/TranslationBlock', () => ({
  useSubmissionTranslations: () => null,
  TranslationBlock: () => null,
}));

const submission = (id: number, checks: string[], status: string | null = null): Submission => ({
  _id: id,
  _uuid: `u${id}`,
  _submission_time: '2026-09-28T10:00:00Z',
  end: '2026-09-28T10:30:00Z',
  submission_data: {},
  is_edited: false,
  has_edit_history: false,
  data_quality_issues: checks.map((check) => ({ check, field: 'submission', value: null, message: '' })),
  qa_status: checks.length ? QAStatus.FLAGGED : QAStatus.PENDING_APPROVAL,
  kobo_validation_status: status,
});

const facets = (review: SubmissionFacets['review']): SubmissionFacets => ({
  review,
  tabs: { needs_review: 2, on_hold: 0, reviewed: 0, all: 3 },
  issues: [],
  enumerators: [],
  sampling: [],
  clean: { ready: 1, waiting: 0 },
});

let store: Submission[];

// jsdom lays nothing out, so it has no scrolling.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  store = [
    submission(1, ['duration_too_short', 'dk_percentage_high']),
    submission(2, ['missing_uuid']),
    submission(3, []),
  ];
  vi.mocked(useReviewPreferences).mockReturnValue({ autoAdvance: true, shortcuts: true });
  vi.mocked(api.getSubmissionFacets).mockImplementation(async (filters: FilterState) =>
    facets(filters.review ?? 'needs_review')
  );
  vi.mocked(api.getSubmissions).mockImplementation(async (filters: FilterState) => {
    // Like the server: with no tab asked for, it opens on Needs review.
    const review = filters.review ?? 'needs_review';
    const shown =
      review === 'needs_review'
        ? store.filter((s) => !s.kobo_validation_status && s.data_quality_issues.length)
        : store;
    return { submissions: shown, total: shown.length, page: 1, page_size: 50, review, sort: 'issues' };
  });
  vi.mocked(api.updateValidationStatus).mockImplementation(
    async (id: number, _survey: string, status: string | null) => {
      store = store.map((s) => (s._id === id ? { ...s, kobo_validation_status: status } : s));
      return store.find((s) => s._id === id)!;
    }
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-submission-id]')).map((row) =>
    Number(row.getAttribute('data-submission-id'))
  );

// The open submission's number, from its heading.
const heading = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('h2'))
    .map((h) => h.textContent)
    .find((text) => text?.startsWith('#'));

const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }));

describe('Dashboard review loop', () => {
  it('opens on Needs review and moves on after a decision, with Undo', async () => {
    const view = render(<Dashboard />);
    await waitFor(() => expect(rows(view.container)).toEqual([1, 2]));
    expect(vi.mocked(api.getSubmissionFacets).mock.calls[0][0].review).toBeUndefined();
    expect(view.getByRole('tab', { name: /Needs review/ }).getAttribute('aria-selected')).toBe('true');
    expect(view.getByText('2 issues')).toBeTruthy();

    await key('j');
    expect(heading(view.container)).toBe('#1');

    fireEvent.click(view.getByRole('button', { name: /^Approved/ }));
    // The decision shows on this submission first, then the next one opens.
    await waitFor(() =>
      expect(view.getByRole('button', { name: /^Approved/ }).getAttribute('aria-pressed')).toBe('true')
    );
    expect(heading(view.container)).toBe('#1');
    await waitFor(() => expect(heading(view.container)).toBe('#2'));
    expect(api.updateValidationStatus).toHaveBeenCalledWith(1, 's1', 'Approved');
    expect(rows(view.container)).toEqual([2]);
    expect(view.getByRole('status').textContent).toContain('Approved #1');

    fireEvent.click(view.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(rows(view.container)).toEqual([1, 2]));
    expect(api.updateValidationStatus).toHaveBeenLastCalledWith(1, 's1', null);
    expect(heading(view.container)).toBe('#1');
  });

  it('stays on the submission when auto-advance is off, and decides with keys', async () => {
    vi.mocked(useReviewPreferences).mockReturnValue({ autoAdvance: false, shortcuts: true });
    const view = render(<Dashboard />);
    await waitFor(() => expect(rows(view.container)).toEqual([1, 2]));

    await key('j');
    await key('h');
    await waitFor(() => expect(api.updateValidationStatus).toHaveBeenCalledWith(1, 's1', 'On Hold'));
    await waitFor(() => expect(rows(view.container)).toEqual([2]));
    expect(heading(view.container)).toBe('#1');
    // Only the button changes, so the card doesn't shift under the reviewer.
    expect(view.getByRole('button', { name: /^On hold/ }).getAttribute('aria-pressed')).toBe('true');
    expect(view.container.textContent).toContain('2 things to check');
    expect(view.container.textContent).not.toContain('Marked on hold in Kobo.');
  });

  it('ignores letter keys when shortcuts are off, but arrows still move', async () => {
    vi.mocked(useReviewPreferences).mockReturnValue({ autoAdvance: true, shortcuts: false });
    const view = render(<Dashboard />);
    await waitFor(() => expect(rows(view.container)).toEqual([1, 2]));

    await key('j');
    expect(heading(view.container)).toBeUndefined();
    await key('ArrowDown');
    expect(heading(view.container)).toBe('#1');
    await key('a');
    expect(api.updateValidationStatus).not.toHaveBeenCalled();
  });

  it('offers to approve clean submissions once nothing needs review', async () => {
    store = store.map((s) => (s._id === 3 ? s : { ...s, kobo_validation_status: 'Approved' }));
    vi.mocked(api.getSubmissionFacets).mockImplementation(async (filters: FilterState) => ({
      ...facets(filters.review ?? 'needs_review'),
      tabs: { needs_review: 0, on_hold: 0, reviewed: 2, all: 3 },
    }));
    vi.mocked(api.approveCleanSubmissions).mockResolvedValue({ approved: 1, failed: 0 });
    const view = render(<Dashboard />);
    await waitFor(() => expect(view.getByText('Nothing needs review')).toBeTruthy());

    fireEvent.click(view.getByRole('button', { name: 'Approve 1 clean…' }));
    fireEvent.click(view.getByRole('button', { name: 'Approve 1' }));
    await waitFor(() => expect(api.approveCleanSubmissions).toHaveBeenCalled());
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('Approved 1 clean submission in Kobo.'));
  });

  it('loads a long queue in parts, and J reads on past the end of what is loaded', async () => {
    store = Array.from({ length: 60 }, (_, i) => submission(i + 1, ['duration_too_short']));
    vi.mocked(api.getSubmissions).mockImplementation(async (_filters: FilterState, _survey, part) => {
      const { offset = 0, limit = 50 } = part ?? {};
      return {
        submissions: store.slice(offset, offset + limit),
        total: store.length,
        page: 1,
        page_size: limit,
        review: 'needs_review',
        sort: 'issues',
      };
    });
    const view = render(<Dashboard />);
    await waitFor(() => expect(rows(view.container)).toHaveLength(50));
    expect(view.container.textContent).toContain('60 to review');

    // Opening the 50th brings the next part in ahead of J.
    fireEvent.click(view.container.querySelector('[data-submission-id="50"] button')!);
    await waitFor(() => expect(rows(view.container)).toHaveLength(60));
    await key('j');
    expect(heading(view.container)).toBe('#51');
    expect(view.queryByRole('button', { name: /Load more/ })).toBeNull();
  });
});
