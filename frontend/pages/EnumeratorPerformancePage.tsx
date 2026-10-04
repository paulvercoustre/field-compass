import React, { useState, useEffect, useCallback } from 'react';
import { progressApi } from '../services/progressApi';
import { useSurvey } from '../contexts/SurveyContext';
import { PerformanceData } from '../types';
import { Spinner } from '../components/Spinner';
import PageHeader from '../components/ui/PageHeader';
import { PullButton, PullStartError, usePull } from '../components/activity/PullButton';
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
  const [error, setError] = useState<string | null>(null);

  // `quiet`: re-read after a pull without swapping the page for a spinner.
  const fetchData = useCallback(async (quiet = false) => {
    if (!selectedSurvey) return;

    if (!quiet) setIsLoading(true);
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

  const pull = usePull(() => fetchData(true));

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
