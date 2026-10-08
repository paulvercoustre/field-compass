import React from 'react';
import { Submission } from '../types';
import { SurveyConfig } from '../services/progressApi';
import { statusDotClass } from './Badge';
import { findAnswer } from '../utils/answers';
import { formatValueForDisplay, questionText } from '../utils/koboLabelUtils';
import { issueName } from '../utils/issueNames';

interface SubmissionListItemProps {
  submission: Submission;
  onSelect: (id: number) => void;
  isSelected: boolean;
  /** Decided and folding away: tinted in the decision's colour. */
  leaving?: boolean;
  surveyConfig: SurveyConfig | null;
  showStatus: boolean;
}

// "27 Sept"; the year only when it is not this one.
const formatSubmitted = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
};

// A decided row's colour as it leaves, matching its decision button.
const LEAVING_TINT: Record<string, string> = {
  Approved: 'bg-emerald-50 dark:bg-emerald-500/15',
  'Not Approved': 'bg-rose-50 dark:bg-rose-500/15',
  'On Hold': 'bg-amber-50 dark:bg-amber-500/15',
};

const STATUS_LABEL: Record<string, string> = {
  Approved: 'Approved',
  'Not Approved': 'Not approved',
  'On Hold': 'On hold',
};

/** An answer as the row shows it: its choice label, or nothing when blank. */
const answerLabel = (submission: Submission, question: string | undefined, config: SurveyConfig | null) => {
  if (!question) return null;
  const value = findAnswer(submission.submission_data, question);
  return value === undefined || value === null || value === '' ? null : formatValueForDisplay(value, question, config);
};

/**
 * One row of the queue, laid out like an inbox: who and when on the first
 * line; where, its status and how many issues on the second. The issue
 * count is the only coloured mark, so rows that need attention stand out;
 * its names are in the tooltip, since a row can have several.
 */
const SubmissionListItem: React.FC<SubmissionListItemProps> = ({
  submission,
  onSelect,
  isSelected,
  leaving = false,
  surveyConfig,
  showStatus,
}) => {
  const { _id, _submission_time, kobo_validation_status, data_quality_issues, transcript_summary } = submission;
  const transcripts = transcript_summary;
  const ids = surveyConfig?.config_data?.core_identifiers;
  const enumerator = answerLabel(submission, ids?.enumerator, surveyConfig);
  const place = (surveyConfig?.config_data?.sampling_frame?.sampling_cols ?? [])
    .map((col) => answerLabel(submission, col, surveyConfig))
    .filter(Boolean)
    .join(' › ');
  const status = kobo_validation_status || 'Not Reviewed';
  const issueCount = data_quality_issues.length;
  const issueNames = Array.from(
    new Set(
      data_quality_issues.map((i) =>
        issueName(i.check, (name) => questionText(name, surveyConfig, submission.submission_data))
      )
    )
  );

  // The selected row has no background of its own: the list's marker, which
  // glides from row to row, sits behind it.
  return (
    <button
      type="button"
      onClick={() => onSelect(_id)}
      aria-current={isSelected ? 'true' : undefined}
      className={`relative block w-full border-b border-gray-100 px-4 py-2.5 text-left transition-colors duration-100 focus-visible:ring-inset focus-visible:ring-offset-0 dark:border-gray-800/80 ${
        leaving
          ? (LEAVING_TINT[status] ?? 'bg-gray-50 dark:bg-gray-900')
          : isSelected
            ? ''
            : 'hover:bg-gray-50 dark:hover:bg-gray-900'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="tabular text-sm font-semibold text-gray-900 dark:text-white">
          <span className="font-normal text-gray-400 dark:text-gray-500">#</span>
          {_id}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
          {enumerator ??
            (ids?.enumerator ? <span className="text-gray-400 dark:text-gray-500">No enumerator</span> : null)}
        </span>
        <span className="tabular flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {formatSubmitted(_submission_time)}
        </span>
      </div>
      <div className="mt-1 flex h-5 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        {showStatus && (
          <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-gray-600 dark:text-gray-400">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`} aria-hidden="true" />
            {STATUS_LABEL[status] ?? 'Not reviewed'}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{place}</span>
        {transcripts && transcripts.count > 0 && (
          <span
            className={`inline-flex flex-shrink-0 items-center ${transcripts.failed > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}
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
          <span
            title={issueNames.join('\n')}
            className="tabular inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25"
          >
            {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
            <span className="sr-only">: {issueNames.join(', ')}</span>
          </span>
        )}
      </div>
    </button>
  );
};

export default SubmissionListItem;
