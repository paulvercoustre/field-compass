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
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

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

  it('remembers the view, and ignores a remembered value that is not a view', async () => {
    localStorage.setItem('currentView', 'qualityOverview');
    expect((await renderNavigation()).current.view).toBe('qualityOverview');
    cleanup();
    localStorage.setItem('currentView', 'nonsense');
    expect((await renderNavigation()).current.view).toBe('dashboard');
  });
});
