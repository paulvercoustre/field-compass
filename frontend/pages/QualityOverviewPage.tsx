import React, { useCallback, useEffect, useState } from 'react';
import { FilterState, QualityOverviewResponse } from '../types';
import { useSurvey } from '../contexts/SurveyContext';
import { RequestedTab, useNavigation } from '../contexts/NavigationContext';
import { fetchQualityOverview } from '../services/qualityApi';
import { getSurveyConfig, SurveyConfig } from '../services/progressApi';
import { QUALITY_TABS, QualityTab } from '../utils/appUrl';
import { GLOSSARY } from '../utils/glossary';
import { Period, periodDates } from '../utils/period';
import { Spinner } from '../components/Spinner';
import PageHeader from '../components/ui/PageHeader';
import PeriodSelect from '../components/ui/PeriodSelect';
import Banner from '../components/ui/Banner';
import { Card, CardHeader } from '../components/ui/Card';
import { SubTabButton } from '../components/ui/SubTabButton';
import TermInfo from '../components/ui/TermInfo';
import { PullButton, PullStartError, usePull } from '../components/activity/PullButton';
import SummaryTiles, { NoChecksNotice } from '../components/metrics/SummaryTiles';
import { ReviewCount } from '../components/metrics/ReviewBar';
import IssuesPerDayChart from '../components/charts/IssuesPerDayChart';
import ReviewCard from '../components/quality-dashboard/ReviewCard';
import SubmissionStatusChart from '../components/quality-dashboard/SubmissionStatusChart';
import ByCheckTable from '../components/quality-dashboard/ByCheckTable';

const isQualityTab = (tab: string | undefined): tab is QualityTab => QUALITY_TABS.some((t) => t.id === tab);

interface QualityOverviewPageProps {
  onNavigateToSubmissions?: (filters?: FilterState) => void;
  /** The view the address names: Overview or By check. */
  requestedTab?: RequestedTab;
  /** The view shown, for the address. */
  onTabChange?: (tab: string) => void;
}

/**
 * Data quality: what is going wrong in the data, and how far review has got.
 * Overview, and By check at /surveys/<id>/quality/by-check
 * (docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md).
 */
const QualityOverviewPage: React.FC<QualityOverviewPageProps> = ({
  onNavigateToSubmissions,
  requestedTab,
  onTabChange,
}) => {
  const { selectedSurvey } = useSurvey();
  const { navigate } = useNavigation();
  const [data, setData] = useState<QualityOverviewResponse | null>(null);
  const [config, setConfig] = useState<SurveyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('all');
  const [tab, setTab] = useState<QualityTab>(() => (isQualityTab(requestedTab?.tab) ? requestedTab.tab : 'overview'));

  useEffect(() => {
    if (isQualityTab(requestedTab?.tab)) setTab(requestedTab.tab);
  }, [requestedTab]);
  useEffect(() => onTabChange?.(tab), [tab, onTabChange]);

  // `quiet`: re-read after a pull without swapping the page for a spinner.
  const load = useCallback(
    async (quiet = false) => {
      if (!selectedSurvey) return;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        setData(await fetchQualityOverview(selectedSurvey.survey_id, periodDates(period)));
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : err && typeof err === 'object' && 'detail' in err
              ? String((err as { detail: unknown }).detail)
              : 'Failed to load quality data'
        );
      } finally {
        setLoading(false);
      }
    },
    [selectedSurvey, period]
  );

  useEffect(() => {
    load();
  }, [load]);

  // The form, for naming outliers by their question. The page works without it.
  useEffect(() => {
    if (!selectedSurvey) return;
    getSurveyConfig(selectedSurvey.survey_id)
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [selectedSurvey]);

  const pull = usePull(() => load(true));

  if (!selectedSurvey) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white mb-1">No Survey Selected</h2>
          <p className="text-gray-500 dark:text-gray-400">
            Please select a survey from the sidebar to view quality overview.
          </p>
        </div>
      </div>
    );
  }

  // A review state opens the Submissions tab of the same name; Approved and
  // Not approved share Reviewed, so they also filter to their decision.
  const openState = onNavigateToSubmissions
    ? (state: ReviewCount) => {
        if (state === 'needs_review') onNavigateToSubmissions({ review: 'needs_review' });
        else if (state === 'on_hold') onNavigateToSubmissions({ review: 'on_hold' });
        else
          onNavigateToSubmissions({
            review: 'reviewed',
            validationStatuses: [state === 'approved' ? 'Approved' : 'Not Approved'],
          });
      }
    : undefined;
  const openSettings = () => navigate({ view: 'settings', tab: 'quality' });

  const body = () => {
    if (loading)
      return (
        <div className="flex h-64 items-center justify-center">
          <Spinner />
        </div>
      );
    if (error)
      return (
        <Banner tone="error">
          <p>{error}</p>
          <button
            onClick={() => load()}
            className="mt-1 text-sm font-medium underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        </Banner>
      );
    if (!data) return null;
    const summary = data.summary;
    if (summary.submissions === 0)
      return (
        <div className="mx-auto max-w-xl py-16 text-center">
          <h2 className="mb-1 text-sm font-medium text-gray-900 dark:text-white">
            {period === 'all' ? 'No submissions yet' : 'No submissions in this period'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {period === 'all' ? 'Refresh from Kobo to pull them.' : 'Choose a longer period, or all time.'}
          </p>
        </div>
      );

    return tab === 'overview' ? (
      <>
        <NoChecksNotice checks={data} onOpenSettings={openSettings} />
        <ReviewCard summary={summary} oldestNeedsReview={data.oldest_needs_review} onOpen={openState} />
        <SummaryTiles summary={summary} checks={data} onOpenSettings={openSettings} />
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-4">
            <CardHeader
              className="mb-3"
              title={
                <span className="flex items-center gap-1">
                  {GLOSSARY.issuesPerSubmission.name}, by day
                  <TermInfo term={GLOSSARY.issuesPerSubmission} />
                </span>
              }
              description="Each day of collection. Is it getting better?"
            />
            <IssuesPerDayChart daily={summary.daily} average={summary.issues_per_submission} name="Everyone" />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Dashed: {summary.issues_per_submission ?? 0} for the whole period.
            </p>
          </Card>
          <Card className="p-4">
            <CardHeader
              className="mb-3"
              title="Submissions by the day they were collected"
              description="Coloured by where each one stands now."
            />
            <SubmissionStatusChart data={data.temporal_data} />
          </Card>
        </div>
      </>
    ) : (
      <>
        <NoChecksNotice checks={data} onOpenSettings={openSettings} />
        <ByCheckTable
          rows={data.by_check}
          submissions={summary.submissions}
          lastDay={data.date_range.end}
          config={config}
          onOpenCheck={
            onNavigateToSubmissions ? (check) => onNavigateToSubmissions({ review: 'all', issues: [check] }) : undefined
          }
          onNeedsReview={
            onNavigateToSubmissions
              ? (check) => onNavigateToSubmissions({ review: 'needs_review', issues: [check] })
              : undefined
          }
          onOpenEnumerator={(id) => navigate({ view: 'enumeratorPerformance', tab: id })}
          onOpenSettings={openSettings}
        />
      </>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Data quality"
        actions={
          <>
            <PeriodSelect value={period} onChange={setPeriod} />
            <PullButton pull={pull} />
          </>
        }
      >
        <PullStartError pull={pull} />
      </PageHeader>
      <div className="flex-1 overflow-y-auto p-4 text-gray-700 md:p-6 dark:text-gray-300">
        <div className="mx-auto max-w-screen-2xl space-y-5">
          <div
            role="group"
            aria-label="View"
            className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900"
          >
            {QUALITY_TABS.map((t) => (
              <SubTabButton<QualityTab> key={t.id} tabId={t.id} activeTab={tab} onClick={setTab}>
                {t.label}
              </SubTabButton>
            ))}
          </div>
          {body()}
        </div>
      </div>
    </div>
  );
};

export default QualityOverviewPage;
