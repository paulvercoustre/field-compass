import React from 'react';
import { Submission } from '../types';
import { Badge } from './Badge';

interface SubmissionListItemProps {
    submission: Submission;
    onSelect: (id: number) => void;
    isSelected: boolean;
}

const formatSubmitted = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

const SubmissionListItem: React.FC<SubmissionListItemProps> = ({ submission, onSelect, isSelected }) => {
    const { _id, _submission_time, kobo_validation_status, data_quality_issues } = submission;

    // Display validation status, default to "Not Reviewed" if null
    const displayStatus = kobo_validation_status || 'Not Reviewed';
    const issueCount = data_quality_issues.length;

    return (
        <button
            onClick={() => onSelect(_id)}
            aria-current={isSelected ? 'true' : undefined}
            className={`relative block w-full text-left px-4 py-2.5 border-b border-gray-100 dark:border-gray-800/80 transition-colors duration-100 focus-visible:ring-inset focus-visible:ring-offset-0 ${
                isSelected
                    ? 'bg-indigo-50/70 dark:bg-indigo-500/10'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-900'
            }`}
        >
            {isSelected && <span className="absolute inset-y-0 left-0 w-0.5 bg-indigo-600 dark:bg-indigo-400" aria-hidden="true" />}
            <div className="flex items-center justify-between gap-2">
                <p className="tabular text-13 font-semibold text-gray-900 dark:text-white">
                    <span className="font-normal text-gray-400 dark:text-gray-500">#</span>{_id}
                </p>
                <Badge status={displayStatus} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
                <span className="tabular truncate text-xs text-gray-500 dark:text-gray-400">
                    {formatSubmitted(_submission_time)}
                </span>
                {issueCount > 0 && (
                    <span className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                            <path d="M12 9v4M12 17h.01" />
                        </svg>
                        {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
                    </span>
                )}
            </div>
        </button>
    );
}

export default SubmissionListItem;
