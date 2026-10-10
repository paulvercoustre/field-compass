import React, { useState, useEffect, useCallback } from 'react';
import { progressApi, getSurveyConfig, SurveyConfig } from '../services/progressApi';
import { useSurvey } from '../contexts/SurveyContext';
import { RequestedTab, useNavigation } from '../contexts/NavigationContext';
import { FilterState, PerformanceData } from '../types';
import { Spinner } from '../components/Spinner';
import PageHeader from '../components/ui/PageHeader';
import { PullButton, PullStartError, usePull } from '../components/activity/PullButton';
import CapabilityNotice from '../components/ui/CapabilityNotice';
import FieldTeamTiles from '../components/field-team/FieldTeamTiles';
import FollowUpTable from '../components/field-team/FollowUpTable';
import EnumeratorList from '../components/field-team/EnumeratorList';
import CallSheet, { CallSheetLink } from '../components/field-team/CallSheet';
import { NO_ENUMERATOR } from '../utils/filterUtils';

type Period = 'all' | 'last7' | 'last30';

const PERIODS: { value: Period; label: string; days?: number }[] = [
  { value: 'all', label: 'All time' },
  { value: 'last7', label: 'Last 7 days', days: 7 },
  { value: 'last30', label: 'Last 30 days', days: 30 },
];

const periodDates = (period: Period): { startDate?: string; endDate?: string } => {
  const days = PERIODS.find((p) => p.value === period)?.days;
  if (!days) return {};
  const today = new Date();
  const day = (d: Date) => d.toISOString().split('T')[0];
  return { startDate: day(new Date(today.getTime() - days * 24 * 60 * 60 * 1000)), endDate: day(today) };
};

interface EnumeratorPerformancePageProps {
  onNavigateToSubmissions?: (filters?: FilterState) => void;
  /** The enumerator the address names, opened on arrival and on Back and Forward. */
  requestedTab?: RequestedTab;
  /** Reports the open enumerator to the address, or '' when none is. */
  onTabChange?: (tab: string) => void;
}

/**
 * Field team: which enumerator needs a call, and about what. The follow-up
 * table, and each enumerator's call sheet at /surveys/<id>/team/<enumerator>.
 */
const EnumeratorPerformancePage: React.FC<EnumeratorPerformancePageProps> = ({
  onNavigateToSubmissions,
  requestedTab,
  onTabChange,
}) => {
  const { selectedSurvey } = useSurvey();
  const { navigate } = useNavigation();
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [config, setConfig] = useState<SurveyConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('all');
  const [openId, setOpenId] = useState<string | null>(requestedTab?.tab || null);

  // The address decides on arrival, Back and Forward; a link here without one closes the sheet.
  useEffect(() => {
    setOpenId(requestedTab?.tab || null);
  }, [requestedTab]);

  // `quiet`: re-read after a pull without swapping the page for a spinner.
  const fetchData = useCallback(
    async (quiet = false) => {
      if (!selectedSurvey) return;
      if (!quiet) setIsLoading(true);
      setError(null);
      try {
        setPerformanceData(await progressApi.getPerformanceData(selectedSurvey.survey_id, periodDates(period)));
      } catch (e) {
        setError('Failed to fetch tracking data.');
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    },
    [selectedSurvey, period]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // The form, for naming outliers by their question. The page works without it.
  useEffect(() => {
    if (!selectedSurvey) return;
    getSurveyConfig(selectedSurvey.survey_id)
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [selectedSurvey]);

  const pull = usePull(() => fetchData(true));

  const open = (id: string | null) => {
    setOpenId(id);
    onTabChange?.(id ?? '');
  };

  const toSubmissions = (enumeratorId: string, link: CallSheetLink) =>
    onNavigateToSubmissions?.({
      review: link.review,
      enumerators: [enumeratorId],
      ...(link.issue ? { issues: [link.issue] } : {}),
    });

  const openSettings = () => navigate({ view: 'settings', tab: 'quality' });

  if (!selectedSurvey) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white mb-1">No Survey Selected</h2>
          <p className="text-gray-500 dark:text-gray-400">
            Please select a survey from the sidebar to view enumerator performance.
          </p>
        </div>
      </div>
    );
  }

  const unavailable = performanceData?.unavailable ?? [];
  const team = performanceData?.team ?? null;
  const noEnumerator = performanceData?.no_enumerator?.submissions ?? 0;
  const openEnumerator = openId ? performanceData?.enumerators.find((e) => e.id === openId) : undefined;
  const sheet =
    !isLoading && !error && unavailable.length === 0 && performanceData && team && openEnumerator
      ? { enumerators: performanceData.enumerators, team, enumerator: openEnumerator }
      : null;
  const openNoEnumerator = onNavigateToSubmissions
    ? () => onNavigateToSubmissions({ review: 'all', enumerators: [NO_ENUMERATOR] })
    : undefined;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Field team"
        actions={
          <>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              aria-label="Period"
              className="h-8 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs pl-2.5 pr-8 py-0 text-gray-700 dark:text-gray-200"
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <PullButton pull={pull} />
          </>
        }
      >
        <PullStartError pull={pull} />
      </PageHeader>

      {sheet ? (
        // As in Submissions: the list in its own scrolling column, the open
        // enumerator beside it; on a phone, the sheet alone.
        <div className="flex min-h-0 flex-1 text-gray-700 dark:text-gray-300">
          <aside className="hidden min-h-0 w-[22rem] flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-white md:block lg:w-[24rem] dark:border-gray-800 dark:bg-gray-950">
            <EnumeratorList
              enumerators={sheet.enumerators}
              team={sheet.team}
              config={config}
              openId={sheet.enumerator.id}
              onOpen={open}
            />
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
            <CallSheet
              enumerator={sheet.enumerator}
              team={sheet.team}
              config={config}
              onClose={() => open(null)}
              onOpenSubmissions={
                onNavigateToSubmissions ? (link) => toSubmissions(sheet.enumerator.id, link) : undefined
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 text-gray-700 dark:text-gray-300">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Spinner />
            </div>
          ) : error ? (
            <div className="p-4 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : unavailable.length > 0 ? (
            // The survey has no enumerator configured. Everything here groups
            // by enumerator, so rendering it would show a single synthetic
            // bucket holding the whole dataset -- which reads as real data.
            <CapabilityNotice
              title="Field team needs to know who did each interview"
              message="Choose the question that records the enumerator. Data quality and Progress work without it."
              onOpenSettings={() => navigate({ view: 'settings' })}
            />
          ) : performanceData && team && team.submissions === 0 ? (
            <div className="mx-auto max-w-xl py-16 text-center">
              <h2 className="mb-1 text-sm font-medium text-gray-900 dark:text-white">No submissions in this period</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Choose a longer period, or all time.</p>
            </div>
          ) : performanceData && team ? (
            <div className="mx-auto max-w-screen-2xl space-y-5">
              {openId && (
                <p className="text-sm text-gray-600 dark:text-gray-400" role="status">
                  {openId} has no submissions in this period.
                </p>
              )}
              <FieldTeamTiles data={performanceData} onOpenSettings={openSettings} />
              {performanceData.checks_on.length === 0 && (
                <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-gray-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-gray-200">
                  No checks are on, so nothing has been flagged. That doesn’t mean the submissions are clean.{' '}
                  <button
                    type="button"
                    onClick={openSettings}
                    className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                  >
                    Choose checks
                  </button>
                </p>
              )}
              {/* In the team's figures, so they match Data quality's; never an enumerator of their own. */}
              {noEnumerator > 0 && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {noEnumerator} submission{noEnumerator === 1 ? ' has' : 's have'} no enumerator recorded.{' '}
                  {noEnumerator === 1 ? 'It counts' : 'They count'} in the team’s figures, not as an enumerator.{' '}
                  {openNoEnumerator && (
                    <button
                      type="button"
                      onClick={openNoEnumerator}
                      className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                    >
                      See {noEnumerator === 1 ? 'it' : 'them'}
                    </button>
                  )}
                </p>
              )}
              <FollowUpTable
                data={performanceData}
                config={config}
                onOpen={open}
                onNeedsReview={
                  onNavigateToSubmissions
                    ? (id) => onNavigateToSubmissions({ review: 'needs_review', ...(id ? { enumerators: [id] } : {}) })
                    : undefined
                }
                onNoEnumerator={openNoEnumerator}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default EnumeratorPerformancePage;
