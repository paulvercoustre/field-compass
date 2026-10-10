import { FilterState } from '../types';
import { buildFilterParams, filtersFromParams } from './filterUtils';

/**
 * The app's address: which page, of which survey, and where in it, so a link
 * opens the same place, Back goes back, and a reload keeps it.
 *
 *   /surveys/<id>/submissions[/<kobo id>]?review=…&issue=…   the queue, and a submission
 *   /surveys/<id>/quality | progress | team
 *   /surveys/<id>/team/<enumerator>                           an enumerator's call sheet
 *   /surveys/<id>/settings[/<tab>]
 *   /new                                                      a new survey
 *   /account[/<tab>]                                          account settings
 *
 * Anything else is the start: no page of a survey asked for.
 */

export type View =
  | 'dashboard'
  | 'dataCollectionProgress'
  | 'enumeratorPerformance'
  | 'qualityOverview'
  | 'createSurvey'
  | 'settings'
  | 'userSettings';

type SurveyView = Exclude<View, 'createSurvey' | 'userSettings'>;

/** A page's name, in the navigation and the browser tab. */
export const VIEW_LABELS: Record<View, string> = {
  dashboard: 'Submissions',
  qualityOverview: 'Data quality',
  dataCollectionProgress: 'Progress',
  enumeratorPerformance: 'Field team',
  settings: 'Settings',
  createSurvey: 'New survey',
  userSettings: 'Account settings',
};

const SEGMENTS: Record<SurveyView, string> = {
  dashboard: 'submissions',
  qualityOverview: 'quality',
  dataCollectionProgress: 'progress',
  enumeratorPerformance: 'team',
  settings: 'settings',
};

/** The tab a page opens on, left out of its address. */
export const DEFAULT_TABS: Partial<Record<View, string>> = { settings: 'settings', userSettings: 'profile' };

/** Where someone is. */
export interface Place {
  view: View;
  surveyId?: string | null;
  /** Survey or account settings: the tab. Field team: the enumerator whose call sheet is open. */
  tab?: string;
  /** Submissions: the one open. */
  submissionId?: number | null;
  /** Submissions: the tab, filters, search and sort. */
  filters?: FilterState;
}

export function urlFor(place: Place): string {
  if (place.view === 'createSurvey') return '/new';
  const tab = place.tab && place.tab !== DEFAULT_TABS[place.view] ? `/${encodeURIComponent(place.tab)}` : '';
  if (place.view === 'userSettings') return `/account${tab}`;
  if (!place.surveyId) return '/';
  const base = `/surveys/${encodeURIComponent(place.surveyId)}/${SEGMENTS[place.view]}`;
  if (place.view === 'settings' || place.view === 'enumeratorPerformance') return `${base}${tab}`;
  if (place.view !== 'dashboard') return base;
  const open = place.submissionId != null ? `/${place.submissionId}` : '';
  const query = place.filters ? buildFilterParams(place.filters).toString() : '';
  return `${base}${open}${query ? `?${query}` : ''}`;
}

export function placeFrom(location: { pathname: string; search: string }): Place {
  const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'new') return { view: 'createSurvey' };
  if (parts[0] === 'account') return { view: 'userSettings', tab: parts[1] };
  if (parts[0] === 'surveys' && parts[1]) {
    const view = (Object.keys(SEGMENTS) as SurveyView[]).find((v) => SEGMENTS[v] === parts[2]) ?? 'dashboard';
    const place: Place = { view, surveyId: parts[1] };
    if (view === 'settings' || view === 'enumeratorPerformance') place.tab = parts[3];
    if (view === 'dashboard') {
      const id = Number(parts[3]);
      place.submissionId = parts[3] && Number.isInteger(id) ? id : null;
      place.filters = filtersFromParams(new URLSearchParams(location.search));
    }
    return place;
  }
  return { view: 'dashboard' };
}

/** The survey an address names, if any: a link names the survey it is about. */
export const surveyIdInUrl = (): string | null => placeFrom(window.location).surveyId ?? null;

/** The browser tab's title: the page, the submission open, the survey. */
export function titleFor(place: Place, surveyName?: string | null): string {
  const parts = [VIEW_LABELS[place.view]];
  if (place.view === 'dashboard' && place.submissionId != null) parts.unshift(`#${place.submissionId}`);
  if (place.view === 'enumeratorPerformance' && place.tab) parts.unshift(place.tab);
  const surveyPage = place.view !== 'createSurvey' && place.view !== 'userSettings';
  if (surveyPage && !surveyName) return 'Field Compass';
  if (surveyPage) parts.push(surveyName!);
  return [...parts, 'Field Compass'].join(' · ');
}
