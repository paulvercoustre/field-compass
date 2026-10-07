import React from 'react';
import { Submission } from '../types';
import { statusDotClass } from './Badge';

interface SubmissionListItemProps {
  submission: Submission;
  onSelect: (id: number) => void;
  isSelected: boolean;
}

// "27 Sept, 08:39"; the year only when it is not this one.
const formatSubmitted = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * One row of the queue, laid out like an inbox: what it is and when on the
 * first line, its state on the second. The issue count is the only coloured
 * chip, so rows that need attention stand out when scanning the column.
 */
const SubmissionListItem: React.FC<SubmissionListItemProps> = ({ submission, onSelect, isSelected }) => {
  const { _id, _submission_time, kobo_validation_status, data_quality_issues, transcript_summary } = submission;
  const transcripts = transcript_summary;

  // Display validation status, default to "Not Reviewed" if null
  const displayStatus = kobo_validation_status || 'Not Reviewed';
  const issueCount = data_quality_issues.length;

  return (
    <button
      onClick={() => onSelect(_id)}
      aria-current={isSelected ? 'true' : undefined}
      className={`relative block w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800/80 transition-colors duration-100 focus-visible:ring-inset focus-visible:ring-offset-0 ${
        isSelected ? 'bg-indigo-50/70 dark:bg-indigo-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-900'
      }`}
    >
      {isSelected && (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-indigo-600 dark:bg-indigo-400" aria-hidden="true" />
      )}
      <div className="flex items-baseline justify-between gap-3">
        <span className="tabular text-sm font-semibold text-gray-900 dark:text-white">
          <span className="font-normal text-gray-400 dark:text-gray-500">#</span>
          {_id}
        </span>
        <span className="tabular flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {formatSubmitted(_submission_time)}
        </span>
      </div>
      <div className="mt-1.5 flex h-5 items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(displayStatus)}`} aria-hidden="true" />
          {displayStatus}
        </span>
        <span className="flex flex-shrink-0 items-center gap-2">
          {transcripts && transcripts.count > 0 && (
            <span
              className={`inline-flex items-center ${transcripts.failed > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}
              title={
                transcripts.failed > 0
                  ? `${transcripts.failed} recording${transcripts.failed === 1 ? '' : 's'} couldn't be transcribed`
                  : transcripts.in_progress > 0
                    ? 'Being transcribed'
                    : `${transcripts.success} recording${transcripts.success === 1 ? '' : 's'} transcribed`
              }
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
              </svg>
              <span className="sr-only">
                {transcripts.failed > 0 ? 'Transcription failed' : 'Has recordings transcribed'}
              </span>
            </span>
          )}
          {issueCount > 0 && (
            <span className="tabular inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25">
              <svg
                className="w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
              {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
            </span>
          )}
        </span>
      </div>
    </button>
  );
};

export default SubmissionListItem;
