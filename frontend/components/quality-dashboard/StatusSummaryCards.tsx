import React from 'react';
import { SubmissionStatusSummary } from '../../types';
import { statusDotClass } from '../Badge';
import { SectionLabel } from '../ui/Card';

interface StatusCardProps {
  label: string;
  count: number;
  percentage?: number;
  /** Tailwind background class for the status dot; none for the total. */
  dotClass?: string;
  onClick?: () => void;
}

const StatusCard: React.FC<StatusCardProps> = ({ label, count, percentage, dotClass, onClick }) => {
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        {dotClass && <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />}
        {label}
      </span>
      <span className="mt-2 flex items-baseline gap-2">
        <span className="tabular text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
          {count.toLocaleString()}
        </span>
        {percentage !== undefined && (
          <span className="tabular text-sm text-gray-500 dark:text-gray-400">
            {percentage.toFixed(1)}%
          </span>
        )}
      </span>
    </>
  );
  const cardClass =
    'flex flex-col items-start rounded-xl border border-gray-200 bg-white p-4 text-left shadow-card dark:border-gray-800 dark:bg-gray-900';
  return onClick ? (
    <button onClick={onClick} className={`${cardClass} transition-colors hover:border-gray-300 hover:bg-gray-50/60 dark:hover:border-gray-700 dark:hover:bg-gray-900/60`}>
      {body}
    </button>
  ) : (
    <div className={cardClass}>{body}</div>
  );
};

interface StatusSummaryCardsProps {
  data: SubmissionStatusSummary;
  onStatusClick?: (status: string) => void;
}

const StatusSummaryCards: React.FC<StatusSummaryCardsProps> = ({ data, onStatusClick }) => {
  return (
    <div>
      <SectionLabel>Submission status</SectionLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatusCard
          label="Total"
          count={data.total_submissions}
        />
        <StatusCard
          label="Approved"
          count={data.approved_count}
          percentage={data.approved_percentage}
          dotClass={statusDotClass('Approved')}
          onClick={onStatusClick ? () => onStatusClick('Approved') : undefined}
        />
        <StatusCard
          label="Not Approved"
          count={data.not_approved_count}
          percentage={data.not_approved_percentage}
          dotClass={statusDotClass('Not Approved')}
          onClick={onStatusClick ? () => onStatusClick('Not Approved') : undefined}
        />
        <StatusCard
          label="On Hold"
          count={data.on_hold_count}
          percentage={data.on_hold_percentage}
          dotClass={statusDotClass('On Hold')}
          onClick={onStatusClick ? () => onStatusClick('On Hold') : undefined}
        />
        <StatusCard
          label="Not Reviewed"
          count={data.not_reviewed_count}
          percentage={data.not_reviewed_percentage}
          dotClass={statusDotClass('Not Reviewed')}
          onClick={onStatusClick ? () => onStatusClick('Not Reviewed') : undefined}
        />
      </div>
    </div>
  );
};

export default StatusSummaryCards;
