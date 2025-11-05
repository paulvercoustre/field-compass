
import React, { useState, useEffect } from 'react';
import { progressApi } from '../services/progressApi';
import { ProgressData } from '../types';
import { Spinner } from '../components/Spinner';
import ProgressDataView from '../components/progress-tracker/ProgressDataView';

const DataCollectionProgressPage: React.FC = () => {
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const progress = await progressApi.getProgressData();
        setProgressData(progress);
      } catch (e) {
        setError('Failed to fetch tracking data.');
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

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
        {progressData && <ProgressDataView data={progressData} />}
      </div>
    </div>
  );
};

export default DataCollectionProgressPage;