import React from 'react';
import { QualityMetricsSummary } from '../../types';
import { SectionLabel } from '../ui/Card';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, subtitle }) => (
  <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-card dark:border-gray-800 dark:bg-gray-900">
    <span className="text-13 text-gray-500 dark:text-gray-400">
      {label}
    </span>
    <div className="mt-2">
      <span className="tabular text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
    {subtitle && (
      <span className="tabular mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
        {subtitle}
      </span>
    )}
  </div>
);

interface QualityMetricsCardsProps {
  data: QualityMetricsSummary;
}

const QualityMetricsCards: React.FC<QualityMetricsCardsProps> = ({ data }) => {
  return (
    <div>
      <SectionLabel>Quality metrics</SectionLabel>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
        <MetricCard
          label="Total issues"
          value={data.total_issues}
          subtitle={`across ${data.submissions_with_issues} submissions`}
        />
        <MetricCard
          label="Issues per submission"
          value={data.avg_issues_per_submission.toFixed(2)}
        />
        {data.avg_dk_percentage != null && (
          <MetricCard
            label="Don’t-know answers, average"
            value={`${data.avg_dk_percentage.toFixed(1)}%`}
          />
        )}
        {data.avg_active_duration_minutes != null && (
          <MetricCard
            label="Active duration, average"
            value={`${data.avg_active_duration_minutes.toFixed(1)} min`}
          />
        )}
      </div>
    </div>
  );
};

export default QualityMetricsCards;
