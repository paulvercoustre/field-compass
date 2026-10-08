import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FilterState } from '../types';
import { Survey } from '../services/progressApi';
import { useSurvey } from './SurveyContext';
import { DEFAULT_TABS, Place, placeFrom, titleFor, urlFor, View } from '../utils/appUrl';
import { buildFilterParams } from '../utils/filterUtils';

export type { View } from '../utils/appUrl';

/** Where a link should take the user. */
export interface NavigationTarget {
  view: View;
  /** Select this survey first: by id, or the survey itself when the list may not have it yet. */
  survey_id?: string | null;
  survey?: Survey;
  /** Survey settings: 'settings' | 'access' | 'quality' | ...; account: 'profile' | 'kobo' | 'ai' | ... */
  tab?: string;
  /** Submissions filters, for the dashboard. */
  filters?: FilterState;
}

/** A tab a link asked for; `at` makes the same tab asked for twice still switch. */
export interface RequestedTab {
  tab: string;
  at: number;
}

/** A submission the address asked to open, or to close (null). */
export interface RequestedSubmission {
  id: number | null;
  at: number;
}

/** What a page says about where it is, for its address: its tab, the queue's filters and open submission. */
export type PagePlace = Pick<Place, 'tab' | 'filters' | 'submissionId'>;

interface NavigationContextValue {
  view: View;
  requestedTab?: RequestedTab;
  dashboardFilters: FilterState;
  requestedSubmission?: RequestedSubmission;
  navigate: (target: NavigationTarget) => void;
  /** Pages call this as their tab, filters or open submission change. */
  reportPlace: (place: PagePlace) => void;
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined);

const sameFilters = (a?: FilterState, b?: FilterState) =>
  buildFilterParams(a ?? {}).toString() === buildFilterParams(b ?? {}).toString();

const samePlace = (a: PagePlace, b: PagePlace) =>
  a.tab === b.tab && (a.submissionId ?? null) === (b.submissionId ?? null) && sameFilters(a.filters, b.filters);

/**
 * The one way to move around the app: the view, the tab a link asked for,
 * and the submissions filters it carried, with the survey selected first so
 * the page that opens is about the right one.
 *
 * The address follows (utils/appUrl.ts). Another page, another survey or a
 * submission opened is a step Back undoes; moving between submissions,
 * filtering or switching tabs only updates the address. A link, a reload, and
 * Back and Forward put the app where the address says.
 */
export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { surveys, selectedSurvey, setSelectedSurvey, isLoading } = useSurvey();
  const [start] = useState(() => placeFrom(window.location));
  const [view, setView] = useState<View>(start.view);
  const [requestedTab, setRequestedTab] = useState<RequestedTab | undefined>(() =>
    start.tab ? { tab: start.tab, at: Date.now() } : undefined
  );
  const [dashboardFilters, setDashboardFilters] = useState<FilterState>(start.filters ?? {});
  const [requestedSubmission, setRequestedSubmission] = useState<RequestedSubmission | undefined>(() =>
    start.submissionId != null ? { id: start.submissionId, at: Date.now() } : undefined
  );
  const [page, setPage] = useState<PagePlace>({
    tab: start.tab,
    filters: start.filters,
    submissionId: start.submissionId,
  });

  const navigate = useCallback(
    (target: NavigationTarget) => {
      const survey = target.survey ?? surveys.find((s) => s.survey_id === target.survey_id);
      if (survey) setSelectedSurvey(survey);
      // A link without a tab clears the last one, so plain navigation lands on
      // the page's first tab rather than wherever an old link pointed.
      setRequestedTab(target.tab ? { tab: target.tab, at: Date.now() } : undefined);
      if (target.view === 'dashboard') setDashboardFilters(target.filters ?? {});
      setRequestedSubmission(undefined);
      setPage({ tab: target.tab, filters: target.filters });
      setView(target.view);
    },
    [surveys, setSelectedSurvey]
  );

  const reportPlace = useCallback(
    (place: PagePlace) => setPage((current) => (samePlace(current, place) ? current : place)),
    []
  );

  // Back and Forward: the address is already right, and the app follows it.
  const latest = useRef({ surveys, selectedSurvey, page });
  latest.current = { surveys, selectedSurvey, page };
  useEffect(() => {
    const onPop = () => {
      const place = placeFrom(window.location);
      const { surveys: list, selectedSurvey: selected, page: current } = latest.current;
      if (place.surveyId && place.surveyId !== selected?.survey_id) {
        const survey = list.find((s) => s.survey_id === place.surveyId);
        if (survey) setSelectedSurvey(survey);
      }
      const tab = place.tab ?? DEFAULT_TABS[place.view];
      setRequestedTab(tab ? { tab, at: Date.now() } : undefined);
      if (place.view === 'dashboard') {
        // The same filters keep the queue as it is; only the open submission changes.
        if (!sameFilters(place.filters, current.filters)) setDashboardFilters(place.filters ?? {});
        setRequestedSubmission({ id: place.submissionId ?? null, at: Date.now() });
      }
      setPage({ tab: place.tab, filters: place.filters, submissionId: place.submissionId });
      setView(place.view);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setSelectedSurvey]);

  const place: Place = {
    view,
    surveyId: selectedSurvey?.survey_id,
    tab: page.tab,
    submissionId: view === 'dashboard' ? page.submissionId : undefined,
    filters: view === 'dashboard' ? page.filters : undefined,
  };
  const url = urlFor(place);

  // The address follows where the user is; not before the surveys are known,
  // since until then a link's survey isn't selected and its address would be lost.
  const written = useRef<Place | null>(null);
  useEffect(() => {
    if (isLoading && !written.current) return;
    const last = written.current;
    written.current = place;
    if (url === window.location.pathname + window.location.search) return;
    const step =
      !!last &&
      (last.view !== place.view ||
        last.surveyId !== place.surveyId ||
        (last.submissionId == null && place.submissionId != null));
    window.history[step ? 'pushState' : 'replaceState'](null, '', url);
    // `place` is what `url` is made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isLoading]);

  const title = titleFor(place, selectedSurvey?.survey_name);
  useEffect(() => {
    document.title = title;
  }, [title]);

  const value = useMemo(
    () => ({ view, requestedTab, dashboardFilters, requestedSubmission, navigate, reportPlace }),
    [view, requestedTab, dashboardFilters, requestedSubmission, navigate, reportPlace]
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
};

export const useNavigation = (): NavigationContextValue => {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used within a NavigationProvider');
  return context;
};
