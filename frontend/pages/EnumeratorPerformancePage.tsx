import React, { useState, useEffect, useCallback } from 'react';
import { progressApi, triggerETL, ETLStats } from '../services/progressApi';
import { useSurvey } from '../contexts/SurveyContext';
import { PerformanceData } from '../types';
import { Spinner } from '../components/Spinner';
import PerformanceDataView from '../components/progress-tracker/PerformanceDataView';
import EnumeratorSummaryCards from '../components/progress-tracker/EnumeratorSummaryCards';
import SubmissionsBarChart from '../components/progress-tracker/SubmissionsBarChart';
import QualityScatterPlot from '../components/progress-tracker/QualityScatterPlot';
import EnumeratorLeaderboard from '../components/progress-tracker/EnumeratorLeaderboard';

interface EnumeratorPerformancePageProps {
  onNavigateToSubmissions?: (filters?: { enumerators?: string[] }) => void;
}

const EnumeratorPerformancePage: React.FC<EnumeratorPerformancePageProps> = ({
  onNavigateToSubmissions,
}) => {
  const { selectedSurvey } = useSurvey();
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningETL, setIsRunningETL] = useState(false);
  const [etlStats, setEtlStats] = useState<ETLStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!selectedSurvey) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const performance = await progressApi.getPerformanceData(selectedSurvey.survey_id);
      setPerformanceData(performance);
    } catch (e) {
      setError('Failed to fetch tracking data.');
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedSurvey]);

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
      
      const checkedCount = (stats.validated || 0);
      const skippedCount = (stats.skipped || 0);
      setSuccess(
        `ETL completed: ${stats.fetched} fetched, ${stats.created} created, ${stats.updated} updated, ${checkedCount} checked${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run ETL pipeline');
      console.error(err);
    } finally {
      setIsRunningETL(false);
    }
  };

  const handleEnumeratorClick = (enumeratorId: string) => {
    if (onNavigateToSubmissions) {
      onNavigateToSubmissions({ enumerators: [enumeratorId] });
    }
  };

  if (!selectedSurvey) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No Survey Selected
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Please select a survey from the sidebar to view enumerator performance.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with Refresh Button */}
      <div className="flex-shrink-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Enumerator Performance
          </h2>
          <div className="flex items-center gap-3">
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
      <div className="flex-1 overflow-y-auto p-4 md:p-6 text-gray-700 dark:text-gray-300">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner />
          </div>
        ) : error && !isRunningETL ? (
          <div className="p-4 text-center text-red-600 dark:text-red-400">{error}</div>
        ) : performanceData ? (
          <div className="max-w-screen-2xl mx-auto space-y-6">
            {/* Summary Cards */}
            <EnumeratorSummaryCards data={performanceData} />
            
            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 items-stretch">
              <div className="lg:col-span-1 xl:col-span-2 flex">
                <SubmissionsBarChart 
                  data={performanceData.collection} 
                  onEnumeratorClick={handleEnumeratorClick}
                />
              </div>
              <div className="lg:col-span-1 flex">
                <EnumeratorLeaderboard 
                  data={performanceData}
                  onEnumeratorClick={handleEnumeratorClick}
                />
              </div>
            </div>
            
            {/* Scatter Plot */}
            <QualityScatterPlot 
              data={performanceData}
              onEnumeratorClick={handleEnumeratorClick}
            />
            
            {/* Detailed Tables */}
            <div className="bg-gray-100 dark:bg-gray-850 rounded-xl shadow-lg p-4 md:p-6">
              <PerformanceDataView 
                data={performanceData}
                onEnumeratorClick={handleEnumeratorClick}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default EnumeratorPerformancePage;
