
import React, { useState, useEffect, useCallback } from 'react';
import { progressApi, triggerETL, ETLStats } from '../services/progressApi';
import { useSurvey } from '../contexts/SurveyContext';
import { ProgressData } from '../types';
import { Spinner } from '../components/Spinner';
import ProgressDataView, { ProgressSubTab } from '../components/progress-tracker/ProgressDataView';

const DataCollectionProgressPage: React.FC = () => {
  const { selectedSurvey } = useSurvey();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningETL, setIsRunningETL] = useState(false);
  const [etlStats, setEtlStats] = useState<ETLStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [approvedOnly, setApprovedOnly] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<ProgressSubTab>('overall');
  const [filter, setFilter] = useState('');

  const fetchData = useCallback(async () => {
    if (!selectedSurvey) return;

    setIsLoading(true);
    setError(null);
    try {
      const progress = await progressApi.getProgressData(selectedSurvey.survey_id, { approvedOnly });
      setProgressData(progress);
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
    if (!selectedSurvey) {
      setError('Please select a survey first');
      return;
    }

    setIsRunningETL(true);
    setError(null);
    setSuccess(null);
    setEtlStats(null);

    try {
      const stats = await triggerETL(selectedSurvey.survey_id);
      setEtlStats(stats);
      
      await fetchData();
      
      setSuccess(
        `ETL completed: ${stats.fetched} fetched, ${stats.created} created, ${stats.updated} updated`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run ETL pipeline');
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
            {etlStats && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                <span className="text-green-600 dark:text-green-400">✓</span> Last run: {etlStats.duration_seconds.toFixed(1)}s
              </div>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRunningETL || !selectedSurvey}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
            >
              {isRunningETL ? (
                <>
                  <Spinner />
                  <span>Running ETL...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Refresh from Kobo</span>
                </>
              )}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-700 rounded-md text-red-800 dark:text-red-200 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/50 border border-green-200 dark:border-green-700 rounded-md text-green-800 dark:text-green-200 text-sm">
            {success}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 text-gray-700 dark:text-gray-300">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner />
          </div>
        ) : error && !isRunningETL ? (
          <div className="p-4 text-center text-red-600 dark:text-red-400">{error}</div>
        ) : (
          <div className="bg-gray-100 dark:bg-gray-850 rounded-xl shadow-2xl p-4 md:p-6 mx-auto max-w-screen-2xl">
            {progressData && (
              <ProgressDataView 
                data={progressData} 
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