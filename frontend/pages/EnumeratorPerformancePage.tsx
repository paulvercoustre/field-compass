
import React, { useState, useEffect } from 'react';
import { progressApi } from '../services/progressApi';
import { useSurvey } from '../contexts/SurveyContext';
import { PerformanceData } from '../types';
import { Spinner } from '../components/Spinner';
import PerformanceDataView from '../components/progress-tracker/PerformanceDataView';

const EnumeratorPerformancePage: React.FC = () => {
  const { selectedSurvey } = useSurvey();
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const performance = await progressApi.getPerformanceData(selectedSurvey?.survey_id);
        setPerformanceData(performance);
      } catch (e) {
        setError('Failed to fetch tracking data.');
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [selectedSurvey]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-center text-red-400">{error}</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 text-gray-300">
      <div className="bg-gray-850 rounded-xl shadow-2xl p-4 md:p-6 mx-auto max-w-screen-2xl">
        {performanceData && <PerformanceDataView data={performanceData} />}
      </div>
    </div>
  );
};

export default EnumeratorPerformancePage;