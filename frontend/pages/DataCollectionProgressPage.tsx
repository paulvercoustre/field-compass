
import React, { useState, useEffect, useCallback } from 'react';
import { progressApi, getSurveyConfig, SurveyConfig } from '../services/progressApi';
import { useSurvey } from '../contexts/SurveyContext';
import { ProgressData } from '../types';
import { Spinner } from '../components/Spinner';
import PageHeader from '../components/ui/PageHeader';
import { PullButton, PullStartError, usePull } from '../components/activity/PullButton';
import ProgressDataView, { ProgressSubTab } from '../components/progress-tracker/ProgressDataView';

const DataCollectionProgressPage: React.FC = () => {
  const { selectedSurvey } = useSurvey();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [surveyConfig, setSurveyConfig] = useState<SurveyConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<ProgressSubTab>('overall');
  const [filter, setFilter] = useState('');

  // `quiet`: re-read after a pull without swapping the page for a spinner.
  const fetchData = useCallback(async (quiet = false) => {
    if (!selectedSurvey) return;

    if (!quiet) setIsLoading(true);
    setError(null);
    try {
      const [progress, config] = await Promise.all([
        progressApi.getProgressData(selectedSurvey.survey_id, { approvedOnly }),
        getSurveyConfig(selectedSurvey.survey_id)
      ]);
      setProgressData(progress);
      setSurveyConfig(config);
    } catch (e) {
      setError('Failed to fetch tracking data.');
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedSurvey, approvedOnly]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pull = usePull(() => fetchData(true));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Progress"
        actions={
          <>
            <label className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300">
              <button
                type="button"
                role="switch"
                aria-checked={approvedOnly}
                onClick={() => setApprovedOnly((prev) => !prev)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                  approvedOnly ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${
                    approvedOnly ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
              Approved submissions only
            </label>
            <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
            <PullButton pull={pull} />
          </>
        }
      >
        <PullStartError pull={pull} />
      </PageHeader>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 text-gray-700 dark:text-gray-300">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : (
          <div className="mx-auto max-w-screen-2xl">
            {progressData && (
              <ProgressDataView 
                data={progressData}
                surveyConfig={surveyConfig}
                approvedOnly={approvedOnly}
                activeSubTab={activeSubTab}
                setActiveSubTab={setActiveSubTab}
                filter={filter}
                setFilter={setFilter}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DataCollectionProgressPage;