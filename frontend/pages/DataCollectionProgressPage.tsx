
import React, { useState, useEffect, useCallback } from 'react';
import { progressApi, triggerETL, getSurveyConfig, SurveyConfig } from '../services/progressApi';
import { useSurvey } from '../contexts/SurveyContext';
import { ProgressData } from '../types';
import { Spinner } from '../components/Spinner';
import { PullButton, PullOutcomeBanner, PullOutcome, describePullResult, describePullFailure } from '../components/PullStatus';
import ProgressDataView, { ProgressSubTab } from '../components/progress-tracker/ProgressDataView';

const DataCollectionProgressPage: React.FC = () => {
  const { selectedSurvey } = useSurvey();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [surveyConfig, setSurveyConfig] = useState<SurveyConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningETL, setIsRunningETL] = useState(false);
  // The page's data could not be loaded. Shown in place of the content.
  const [error, setError] = useState<string | null>(null);
  // How the last pull from Kobo went; shown in the header only.
  const [pullOutcome, setPullOutcome] = useState<PullOutcome | null>(null);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<ProgressSubTab>('overall');
  const [filter, setFilter] = useState('');

  const fetchData = useCallback(async () => {
    if (!selectedSurvey) return;

    setIsLoading(true);
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

  const handleRefresh = async () => {
    if (!selectedSurvey) return;

    setIsRunningETL(true);
    setPullOutcome(null);

    try {
      const stats = await triggerETL(selectedSurvey.survey_id);
      setPullOutcome(describePullResult(stats));
      await fetchData();
    } catch (err) {
      setPullOutcome(describePullFailure(err));
      console.error(err);
    } finally {
      setIsRunningETL(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with Refresh Button */}
      <div className="flex-shrink-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Data Collection Progress</h2>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Approved surveys only</span>
              <button
                type="button"
                role="switch"
                aria-checked={approvedOnly}
                aria-label="Toggle approved surveys only"
                onClick={() => setApprovedOnly((prev) => !prev)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 ${
                  approvedOnly ? 'bg-indigo-500 shadow-lg shadow-indigo-500/30' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                    approvedOnly ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <PullButton onClick={handleRefresh} isPulling={isRunningETL} disabled={!selectedSurvey} />
          </div>
        </div>
        <PullOutcomeBanner outcome={pullOutcome} onRetry={handleRefresh} isPulling={isRunningETL} />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 text-gray-700 dark:text-gray-300">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner />
          </div>
        ) : error && !isRunningETL ? (
          <div role="alert" className="p-4 text-center text-red-700 dark:text-red-400">{error}</div>
        ) : (
          <div className="bg-gray-100 dark:bg-gray-850 rounded-xl shadow-2xl p-4 md:p-6 mx-auto max-w-screen-2xl">
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