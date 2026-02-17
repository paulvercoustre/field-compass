
import React, { useState, useEffect } from 'react';
import { progressApi, getSurveys } from '../services/progressApi';
import { ProgressData, PerformanceData } from '../types';
import { Spinner } from '../components/Spinner';
import ProgressDataView from '../components/progress-tracker/ProgressDataView';
import PerformanceDataView from '../components/progress-tracker/PerformanceDataView';

type MainTab = 'progress' | 'performance';

const ProgressTracker: React.FC = () => {
  const [activeTab, setActiveTab] = useState<MainTab>('progress');
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Get the first survey (or we could add survey selection UI later)
        const surveys = await getSurveys();
        if (surveys.length === 0) {
          setError('No surveys found. Please create a survey first.');
          setIsLoading(false);
          return;
        }
        
        const surveyId = surveys[0].survey_id;
        
        const [progress, performance] = await Promise.all([
          progressApi.getProgressData(surveyId),
          progressApi.getPerformanceData(surveyId),
        ]);
        setProgressData(progress);
        setPerformanceData(performance);
      } catch (e) {
        setError('Failed to fetch tracking data.');
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const TabButton: React.FC<{ tabId: MainTab; children: React.ReactNode }> = ({ tabId, children }) => {
    const isActive = activeTab === tabId;
    return (
      <button
        onClick={() => setActiveTab(tabId)}
        className={`font-semibold py-2 px-5 rounded-md transition-colors duration-200 ${
          isActive
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
      >
        {children}
      </button>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-center text-red-600 dark:text-red-400">{error}</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 text-gray-700 dark:text-gray-300">
      <div className="bg-gray-100 dark:bg-gray-850 rounded-xl shadow-2xl p-4 md:p-6 mx-auto max-w-screen-2xl">
        <h1 className="text-3xl md:text-4xl font-bold text-center mb-6 text-gray-900 dark:text-white">
          Monitoring Tracker: Livelihood Actors
        </h1>

        <div className="flex flex-col md:flex-row justify-center space-y-4 md:space-y-0 md:space-x-4 mb-8">
          <TabButton tabId="progress">Data Collection Progress</TabButton>
          <TabButton tabId="performance">Field Team</TabButton>
        </div>

        <div>
          {activeTab === 'progress' && progressData && <ProgressDataView data={progressData} />}
          {activeTab === 'performance' && performanceData && <PerformanceDataView data={performanceData} />}
        </div>
      </div>
    </div>
  );
};

export default ProgressTracker;