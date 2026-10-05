import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { FilterState } from '../types';
import { Survey } from '../services/progressApi';
import { useSurvey } from './SurveyContext';

export type View =
  | 'dashboard'
  | 'dataCollectionProgress'
  | 'enumeratorPerformance'
  | 'qualityOverview'
  | 'createSurvey'
  | 'settings'
  | 'userSettings';

const VIEWS: readonly View[] = [
  'dashboard',
  'dataCollectionProgress',
  'enumeratorPerformance',
  'qualityOverview',
  'createSurvey',
  'settings',
  'userSettings',
];

/** Where a link should take the user. */
export interface NavigationTarget {
  view: View;
  /** Select this survey first: by id, or the survey itself when the list may not have it yet. */
  survey_id?: string | null;
  survey?: Survey;
  /** Survey settings: 'settings' | 'access' | 'quality' | ...; account: 'profile' | 'kobo' | 'ai' | ... */
  tab?: string;
  /** Submissions filters, for the dashboard. */
  filters?: Record<string, unknown>;
}

/** A tab a link asked for; `at` makes the same tab asked for twice still switch. */
export interface RequestedTab {
  tab: string;
  at: number;
}

interface NavigationContextValue {
  view: View;
  requestedTab?: RequestedTab;
  dashboardFilters: FilterState;
  navigate: (target: NavigationTarget) => void;
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined);

const VIEW_KEY = 'currentView';

/** A fresh sign-in starts on the dashboard, whatever the last session showed. */
export const forgetView = () => {
  try {
    localStorage.removeItem(VIEW_KEY);
  } catch {
    // Nothing remembered.
  }
};

const savedView = (): View => {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return VIEWS.includes(saved as View) ? (saved as View) : 'dashboard';
  } catch {
    return 'dashboard';
  }
};

/**
 * The one way to move around the app: the view, the tab a link asked for,
 * and the submissions filters it carried, with the survey selected first so
 * the page that opens is about the right one.
 */
export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { surveys, setSelectedSurvey } = useSurvey();
  const [view, setView] = useState<View>(savedView);
  const [requestedTab, setRequestedTab] = useState<RequestedTab | undefined>();
  const [dashboardFilters, setDashboardFilters] = useState<FilterState>({});

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Remembering the view is a convenience.
    }
  }, [view]);

  const navigate = useCallback(
    (target: NavigationTarget) => {
      const survey = target.survey ?? surveys.find((s) => s.survey_id === target.survey_id);
      if (survey) setSelectedSurvey(survey);
      // A link without a tab clears the last one, so plain navigation lands on
      // the page's first tab rather than wherever an old link pointed.
      setRequestedTab(target.tab ? { tab: target.tab, at: Date.now() } : undefined);
      if (target.view === 'dashboard') setDashboardFilters((target.filters as FilterState) ?? {});
      setView(target.view);
    },
    [surveys, setSelectedSurvey]
  );

  const value = useMemo(
    () => ({ view, requestedTab, dashboardFilters, navigate }),
    [view, requestedTab, dashboardFilters, navigate]
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
};

export const useNavigation = (): NavigationContextValue => {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used within a NavigationProvider');
  return context;
};
