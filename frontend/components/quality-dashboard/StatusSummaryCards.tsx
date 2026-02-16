import React from 'react';
import { SubmissionStatusSummary } from '../../types';

interface StatusCardProps {
  label: string;
  count: number;
  percentage?: number;
  colorClass: string;
  onClick?: () => void;
}

const StatusCard: React.FC<StatusCardProps> = ({ label, count, percentage, colorClass, onClick }) => (
  <div
    onClick={onClick}
    className={`
      bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 
      p-4 flex flex-col items-center justify-center min-w-[120px]
      ${onClick ? 'cursor-pointer hover:border-indigo-500 dark:hover:border-indigo-400 transition-colors' : ''}
    `}
  >
    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
      {label}
    </span>
    <span className={`text-2xl font-bold ${colorClass}`}>
      {count.toLocaleString()}
    </span>
    {percentage !== undefined && (
      <span className="text-sm text-gray-500 dark:text-gray-400">
        ({percentage.toFixed(1)}%)
      </span>
    )}
  </div>
);

interface StatusSummaryCardsProps {
  data: SubmissionStatusSummary;
  onStatusClick?: (status: string) => void;
}

const StatusSummaryCards: React.FC<StatusSummaryCardsProps> = ({ data, onStatusClick }) => {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">
        Submission Status
      </h3>
      <div className="flex flex-wrap gap-3">
        <StatusCard
          label="Total"
          count={data.total_submissions}
          colorClass="text-gray-900 dark:text-white"
        />
        <StatusCard
          label="Approved"
          count={data.approved_count}
          percentage={data.approved_percentage}
          colorClass="text-green-600 dark:text-green-400"
          onClick={onStatusClick ? () => onStatusClick('Approved') : undefined}
        />
        <StatusCard
          label="Not Approved"
          count={data.not_approved_count}
          percentage={data.not_approved_percentage}
          colorClass="text-red-600 dark:text-red-400"
          onClick={onStatusClick ? () => onStatusClick('Not Approved') : undefined}
        />
        <StatusCard
          label="On Hold"
          count={data.on_hold_count}
          percentage={data.on_hold_percentage}
          colorClass="text-yellow-600 dark:text-yellow-400"
          onClick={onStatusClick ? () => onStatusClick('On Hold') : undefined}
        />
        <StatusCard
          label="Not Reviewed"
          count={data.not_reviewed_count}
          percentage={data.not_reviewed_percentage}
          colorClass="text-gray-600 dark:text-gray-400"
          onClick={onStatusClick ? () => onStatusClick('Not Reviewed') : undefined}
        />
      </div>
    </div>
  );
};

export default StatusSummaryCards;
