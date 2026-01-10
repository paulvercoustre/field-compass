import React, { useState, useEffect } from 'react';
import { QualityOverviewResponse, QualityOverviewFilters } from '../../types';
import { fetchQualityOverview } from '../../services/qualityApi';
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
  onNavigateToEnumerators?: () => void;
}

const QualityOverviewDashboard: React.FC<QualityOverviewDashboardProps> = ({ 
  surveyId,
  onStatusClick,
  onIssueClick,
  onNavigateToEnumerators,
}) => {
  const [data, setData] = useState<QualityOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<QualityOverviewFilters>({});

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

  const handleRefresh = () => {
    loadData();
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Quality Overview
          </h2>
          {data.date_range.start && data.date_range.end && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {data.date_range.start} to {data.date_range.end}
            </span>
          )}
        </div>
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
            className="text-sm px-3 py-1.5 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Refresh
          </button>
          {onNavigateToEnumerators && (
            <button
              onClick={onNavigateToEnumerators}
              className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              View by Enumerator →
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <StatusSummaryCards data={data.status_summary} onStatusClick={onStatusClick} />
      <QualityMetricsCards data={data.quality_metrics} />

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
