import React from 'react';
import { SubmissionSummary } from '../../types';
import { GLOSSARY, Term, formatPercent, percentOf } from '../../utils/glossary';
import { SectionLabel } from '../ui/Card';
import TermInfo from '../ui/TermInfo';

interface MetricCardProps {
  term: Term;
  value: string;
  subtitle?: string;
  /** Nothing to measure: the value is shown muted, never as a 0. */
  muted?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ term, value, subtitle, muted }) => (
  <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-card dark:border-gray-800 dark:bg-gray-900">
    <span className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
      {term.name}
      <TermInfo term={term} />
    </span>
    <div className="mt-2">
      <span
        className={`tabular text-2xl font-semibold tracking-tight ${
          muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'
        }`}
      >
        {value}
      </span>
    </div>
    {subtitle && <span className="tabular mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{subtitle}</span>}
  </div>
);

interface QualityMetricsCardsProps {
  summary: SubmissionSummary;
}

const QualityMetricsCards: React.FC<QualityMetricsCardsProps> = ({ summary }) => {
  const fromStartEnd = summary.duration_from_start_end;
  return (
    <div>
      <SectionLabel>Quality</SectionLabel>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
        <MetricCard
          term={GLOSSARY.flagged}
          value={formatPercent(percentOf(summary.flagged, summary.submissions))}
          subtitle={`${summary.flagged} of ${summary.submissions} submissions`}
        />
        <MetricCard
          term={GLOSSARY.issuesPerSubmission}
          value={summary.issues_per_submission === null ? '—' : summary.issues_per_submission.toFixed(2)}
          subtitle={`${summary.issues} issues`}
        />
        <MetricCard
          term={GLOSSARY.duration}
          value={summary.duration_minutes === null ? 'Not measured' : `${summary.duration_minutes} min`}
          subtitle={
            summary.duration_minutes === null
              ? 'No audit log, and no start and end times'
              : fromStartEnd > 0
                ? `median; ${fromStartEnd} of ${summary.duration_measured} from start and end times`
                : 'median'
          }
          muted={summary.duration_minutes === null}
        />
        <MetricCard
          term={GLOSSARY.dkRate}
          value={summary.dk_rate === null ? 'Not measured' : `${summary.dk_rate}%`}
          subtitle={summary.dk_rate === null ? 'No don’t-know codes, or no answers yet' : undefined}
          muted={summary.dk_rate === null}
        />
      </div>
    </div>
  );
};

export default QualityMetricsCards;
