import React, { useState, useEffect, useCallback } from 'react';
import { progressApi, getSurveyConfig, SurveyConfig } from '../services/progressApi';
import { useSurvey } from '../contexts/SurveyContext';
import { useNavigation } from '../contexts/NavigationContext';
import { FilterState, ProgressData } from '../types';
import { Spinner } from '../components/Spinner';
import PageHeader from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { PullButton, PullStartError, usePull } from '../components/activity/PullButton';
import ProgressSummary from '../components/progress-tracker/ProgressSummary';
import CollectionChart from '../components/progress-tracker/CollectionChart';
import ProgressTable from '../components/progress-tracker/ProgressTable';

interface DataCollectionProgressPageProps {
  onNavigateToSubmissions?: (filters?: FilterState) => void;
}

/**
 * Progress: will we reach the sample, and where are we behind? Collection
 * apart from quality: every submission but Not approved counts, with the
 * Approved part shown (docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md).
 */
const DataCollectionProgressPage: React.FC<DataCollectionProgressPageProps> = ({ onNavigateToSubmissions }) => {
  const { selectedSurvey } = useSurvey();
  const { navigate } = useNavigation();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [surveyConfig, setSurveyConfig] = useState<SurveyConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `quiet`: re-read after a pull without swapping the page for a spinner.
  const fetchData = useCallback(
    async (quiet = false) => {
      if (!selectedSurvey) return;

      if (!quiet) setIsLoading(true);
      setError(null);
      try {
        const [progress, config] = await Promise.all([
          progressApi.getProgressData(selectedSurvey.survey_id),
          getSurveyConfig(selectedSurvey.survey_id),
        ]);
        setProgressData(progress);
        setSurveyConfig(config);
      } catch (e) {
        setError('Failed to fetch tracking data.');
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    },
    [selectedSurvey]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pull = usePull(() => fetchData(true));

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Progress" actions={<PullButton pull={pull} />}>
        <PullStartError pull={pull} />
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 text-gray-700 dark:text-gray-300">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : progressData ? (
          <div className="mx-auto max-w-screen-2xl space-y-5">
            <ProgressSummary data={progressData} onOpenSettings={() => navigate({ view: 'settings' })} />
            <Card className="p-5">
              <CardHeader className="mb-3" title="Collection over time" />
              <CollectionChart data={progressData} />
            </Card>
            <ProgressTable
              data={progressData}
              surveyConfig={surveyConfig}
              onOpen={
                onNavigateToSubmissions
                  ? (samplingFilters) => onNavigateToSubmissions({ review: 'all', samplingFilters })
                  : undefined
              }
            />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              How far review has got, and what is flagged, is on{' '}
              <button
                type="button"
                onClick={() => navigate({ view: 'qualityOverview' })}
                className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
              >
                Data quality
              </button>
              .
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default DataCollectionProgressPage;
