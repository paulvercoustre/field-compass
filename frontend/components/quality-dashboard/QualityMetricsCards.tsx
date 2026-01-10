import React from 'react';
import { QualityMetricsSummary } from '../../types';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, subtitle }) => (
  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 min-w-[160px]">
    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
      {label}
    </span>
    <div className="mt-1">
      <span className="text-2xl font-bold text-gray-900 dark:text-white">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
    {subtitle && (
      <span className="text-sm text-gray-500 dark:text-gray-400">
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
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">
        Quality Metrics
      </h3>
      <div className="flex flex-wrap gap-3">
        <MetricCard
          label="Total Issues"
          value={data.total_issues}
          subtitle={`across ${data.submissions_with_issues} submissions`}
        />
        <MetricCard
          label="Avg Issues / Submission"
          value={data.avg_issues_per_submission.toFixed(2)}
        />
      </div>
    </div>
  );
};

export default QualityMetricsCards;
