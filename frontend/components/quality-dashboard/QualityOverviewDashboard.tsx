import React, { useState, useEffect } from 'react';
import { QualityOverviewResponse, QualityOverviewFilters } from '../../types';
import { fetchQualityOverview, triggerETL } from '../../services/qualityApi';
import StatusSummaryCards from './StatusSummaryCards';
import QualityMetricsCards from './QualityMetricsCards';
import IssueFrequencyChart from './IssueFrequencyChart';
import SubmissionStatusChart from './SubmissionStatusChart';
import IssueTimeSeriesChart from './IssueTimeSeriesChart';
import { Spinner } from '../Spinner';

interface QualityOverviewDashboardProps {
  surveyId: string;
  onStatusClick?: (status: string) => void;
  onIssueClick?: (check: string) => void;
}

const QualityOverviewDashboard: React.FC<QualityOverviewDashboardProps> = ({ 
  surveyId,
  onStatusClick,
  onIssueClick,
}) => {
  const [data, setData] = useState<QualityOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<QualityOverviewFilters>({});
  const [isRunningETL, setIsRunningETL] = useState(false);
  const [etlMessage, setEtlMessage] = useState<string | null>(null);

  // Date range presets
  const [datePreset, setDatePreset] = useState<string>('all');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchQualityOverview(surveyId, filters);
      setData(response);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else if (typeof err === 'string') {
        setError(err);
      } else if (err && typeof err === 'object' && 'detail' in err) {
        setError(String((err as { detail: unknown }).detail));
      } else {
        setError('Failed to load quality data');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [surveyId, filters]);

  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    
    const today = new Date();
    let startDate: string | undefined;
    let endDate: string | undefined = today.toISOString().split('T')[0];
    
    switch (preset) {
      case 'last7':
        startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case 'last30':
        startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case 'last90':
        startDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case 'all':
      default:
        startDate = undefined;
        endDate = undefined;
        break;
    }
    
    setFilters(prev => ({ ...prev, startDate, endDate }));
  };

  const handleRefresh = async () => {
    setIsRunningETL(true);
    setEtlMessage(null);
    setError(null);
    
    try {
      // Run ETL pipeline to refresh data from Kobo
      const stats = await triggerETL(surveyId);
      
      // Show success message with stats
      const checkedCount = (stats.validated || 0);
      const skippedCount = (stats.skipped || 0);
      setEtlMessage(
        `ETL completed: ${stats.fetched} fetched, ${stats.created} created, ${stats.updated} updated, ${checkedCount} checked${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}, ${stats.hfc_flagged} flagged`
      );
      
      // Reload the dashboard data
      await loadData();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(`Failed to run ETL: ${err.message}`);
      } else if (typeof err === 'string') {
        setError(`Failed to run ETL: ${err}`);
      } else {
        setError('Failed to run ETL');
      }
    } finally {
      setIsRunningETL(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <p className="text-red-700 dark:text-red-300">{error}</p>
        <button 
          onClick={handleRefresh}
          className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex-shrink-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 -mx-6 -mt-6 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Quality Overview
          </h2>
          <div className="flex items-center gap-3">
            <select
              value={datePreset}
              onChange={(e) => handleDatePresetChange(e.target.value)}
              className="text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 text-gray-700 dark:text-gray-300"
            >
              <option value="all">All Time</option>
              <option value="last7">Last 7 Days</option>
              <option value="last30">Last 30 Days</option>
              <option value="last90">Last 90 Days</option>
            </select>
            <button
              onClick={handleRefresh}
              disabled={isRunningETL}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
            >
              {isRunningETL ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
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
        
        {/* ETL success message */}
        {etlMessage && (
          <div className="mt-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
            <p className="text-sm text-green-700 dark:text-green-300">{etlMessage}</p>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <StatusSummaryCards data={data.status_summary} onStatusClick={onStatusClick} />
        <QualityMetricsCards data={data.quality_metrics} />
      </div>

      {/* Issue Frequency Chart */}
      <IssueFrequencyChart data={data.issue_frequency} onIssueClick={onIssueClick} />

      {/* Time Series Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SubmissionStatusChart data={data.temporal_data} />
        <IssueTimeSeriesChart data={data.issue_time_series} issueFrequency={data.issue_frequency} />
      </div>
    </div>
  );
};

export default QualityOverviewDashboard;
