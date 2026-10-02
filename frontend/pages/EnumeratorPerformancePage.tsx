import React, { useState, useEffect, useCallback } from 'react';
import { progressApi, triggerETL, ETLStats } from '../services/progressApi';
import { useSurvey } from '../contexts/SurveyContext';
import { PerformanceData } from '../types';
import { Spinner } from '../components/Spinner';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Banner from '../components/ui/Banner';
import { RefreshIcon } from '../components/ui/icons';
import PerformanceDataView from '../components/progress-tracker/PerformanceDataView';
import EnumeratorSummaryCards from '../components/progress-tracker/EnumeratorSummaryCards';
import SubmissionsBarChart from '../components/progress-tracker/SubmissionsBarChart';
import QualityScatterPlot from '../components/progress-tracker/QualityScatterPlot';
import EnumeratorLeaderboard from '../components/progress-tracker/EnumeratorLeaderboard';
import CapabilityNotice from '../components/ui/CapabilityNotice';

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

  const unavailable = performanceData?.unavailable ?? [];

  if (!selectedSurvey) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
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
      <PageHeader
        title="Field team"
        actions={
          <>
            {etlStats && (
              <span className="tabular text-xs text-gray-500 dark:text-gray-400">
                Last run took {etlStats.duration_seconds.toFixed(1)}s
              </span>
            )}
            <Button
              variant="primary"
              onClick={handleRefresh}
              disabled={!selectedSurvey}
              loading={isRunningETL}
              icon={<RefreshIcon />}
            >
              {isRunningETL ? 'Running ETL…' : 'Refresh from Kobo'}
            </Button>
          </>
        }
      >
        {error && <Banner tone="error" className="mt-3">{error}</Banner>}
        {success && <Banner tone="success" className="mt-3">{success}</Banner>}
      </PageHeader>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 text-gray-700 dark:text-gray-300">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner />
          </div>
        ) : error && !isRunningETL ? (
          <div className="p-4 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : unavailable.length > 0 ? (
          // The survey has no enumerator configured. Every chart below groups
          // by enumerator, so rendering them would show a single synthetic
          // bucket holding the whole dataset -- which reads as real data.
          <CapabilityNotice
            title="Field team performance"
            message="Please set up the enumerator variable in the settings."
            onOpenSettings={() => window.dispatchEvent(new Event('navigateToSettings'))}
          />
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
