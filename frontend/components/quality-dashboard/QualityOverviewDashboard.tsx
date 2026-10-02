import React, { useState, useEffect } from 'react';
import { QualityOverviewResponse, QualityOverviewFilters } from '../../types';
import { fetchQualityOverview, triggerETL } from '../../services/qualityApi';
import StatusSummaryCards from './StatusSummaryCards';
import QualityMetricsCards from './QualityMetricsCards';
import IssueFrequencyChart from './IssueFrequencyChart';
import SubmissionStatusChart from './SubmissionStatusChart';
import IssueTimeSeriesChart from './IssueTimeSeriesChart';
import { Spinner } from '../Spinner';
import PageHeader from '../ui/PageHeader';
import Button from '../ui/Button';
import Banner from '../ui/Banner';
import { RefreshIcon } from '../ui/icons';

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
      <Banner tone="error">
        <p>{error}</p>
        <button 
          onClick={handleRefresh}
          className="mt-1 text-sm font-medium underline underline-offset-2 hover:no-underline"
        >
          Try again
        </button>
      </Banner>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="-mx-6 -mt-6 mb-6">
        <PageHeader
          title="Data quality"
          actions={
            <>
              <select
                value={datePreset}
                onChange={(e) => handleDatePresetChange(e.target.value)}
                aria-label="Date range"
                className="h-8 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs pl-2.5 pr-8 py-0 text-gray-700 dark:text-gray-200"
              >
                <option value="all">All time</option>
                <option value="last7">Last 7 days</option>
                <option value="last30">Last 30 days</option>
                <option value="last90">Last 90 days</option>
              </select>
              <Button variant="primary" onClick={handleRefresh} loading={isRunningETL} icon={<RefreshIcon />}>
                {isRunningETL ? 'Running ETL…' : 'Refresh from Kobo'}
              </Button>
            </>
          }
        >
          {/* ETL success message */}
          {etlMessage && <Banner tone="success" className="mt-3">{etlMessage}</Banner>}
        </PageHeader>
      </div>

      {/* Summary Cards */}
      <div className="space-y-6">
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
