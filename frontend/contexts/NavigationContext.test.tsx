import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Survey } from '../services/progressApi';
import { NavigationProvider, useNavigation } from './NavigationContext';
import { SurveyProvider, useSurvey } from './SurveyContext';

const survey = (id: string): Survey => ({ survey_id: id, survey_name: id, kobo_asset_id: null }) as Survey;

vi.mock('../services/progressApi', () => ({
  getSurveys: vi.fn(async () => [survey('s1'), survey('s2')]),
}));

type Seen = ReturnType<typeof useNavigation> & { selected: string | undefined };

const renderNavigation = async () => {
  const seen = { current: undefined as unknown as Seen };
  const Probe = () => {
    const navigation = useNavigation();
    const { selectedSurvey, surveys } = useSurvey();
    seen.current = { ...navigation, selected: selectedSurvey?.survey_id };
    return <span>{surveys.length}</span>;
  };
  const view = render(
    <SurveyProvider>
      <NavigationProvider>
        <Probe />
      </NavigationProvider>
    </SurveyProvider>
  );
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  return seen;
};

describe('NavigationProvider', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  afterEach(cleanup);

  it('selects the survey, opens the tab and switches view in one call', async () => {
    const seen = await renderNavigation();
    act(() => seen.current.navigate({ view: 'settings', survey_id: 's2', tab: 'quality' }));
    expect(seen.current.view).toBe('settings');
    expect(seen.current.selected).toBe('s2');
    expect(seen.current.requestedTab?.tab).toBe('quality');
  });

  it('selects a survey passed by value, even one the list does not have yet', async () => {
    const seen = await renderNavigation();
    act(() => seen.current.navigate({ view: 'settings', survey: survey('new'), tab: 'quality' }));
    expect(seen.current.selected).toBe('new');
  });

  it('forgets the last tab and filters on plain navigation', async () => {
    const seen = await renderNavigation();
    act(() => seen.current.navigate({ view: 'dashboard', filters: { aiReview: 'failed' } }));
    expect(seen.current.dashboardFilters).toEqual({ aiReview: 'failed' });
    act(() => seen.current.navigate({ view: 'settings', tab: 'access' }));
    act(() => seen.current.navigate({ view: 'dashboard' }));
    expect(seen.current.requestedTab).toBeUndefined();
    expect(seen.current.dashboardFilters).toEqual({});
  });

  it('opens where the address says', async () => {
    window.history.replaceState(null, '', '/surveys/s2/settings/quality');
    const seen = await renderNavigation();
    expect(seen.current.view).toBe('settings');
    expect(seen.current.selected).toBe('s2');
    expect(seen.current.requestedTab?.tab).toBe('quality');
    await waitFor(() => expect(document.title).toBe('Settings · s2 · Field Compass'));
  });

  it('writes the address as the user moves, and follows Back', async () => {
    window.history.replaceState(null, '', '/surveys/s1/submissions');
    const seen = await renderNavigation();
    const length = window.history.length;

    act(() => seen.current.navigate({ view: 'qualityOverview' }));
    expect(window.location.pathname).toBe('/surveys/s1/quality');
    // Another page is a step Back can undo.
    expect(window.history.length).toBe(length + 1);

    act(() => seen.current.navigate({ view: 'dashboard', filters: { issues: ['dk_percentage_high'] } }));
    act(() => seen.current.reportPlace({ filters: { issues: ['dk_percentage_high'] }, submissionId: 7 }));
    expect(window.location.pathname + window.location.search).toBe(
      '/surveys/s1/submissions/7?issue=dk_percentage_high'
    );

    // Back, to the list: the queue keeps its filters and closes the submission.
    act(() => {
      window.history.replaceState(null, '', '/surveys/s1/submissions?issue=dk_percentage_high');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(seen.current.view).toBe('dashboard');
    expect(seen.current.requestedSubmission?.id).toBeNull();
    expect(seen.current.dashboardFilters).toEqual({ issues: ['dk_percentage_high'] });
  });
});
