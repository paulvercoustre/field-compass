
import React from 'react';
import { Submission } from '../types';
import { Badge, AlertIcon } from './Badge';

interface SubmissionListItemProps {
    submission: Submission;
    onSelect: (id: number) => void;
    isSelected: boolean;
}

const SubmissionListItem: React.FC<SubmissionListItemProps> = ({ submission, onSelect, isSelected }) => {
    const { _id, _submission_time, kobo_validation_status, data_quality_issues, llm_check_status } = submission;

    const baseClasses = "block w-full text-left p-4 border-b border-gray-200 dark:border-gray-800 transition-colors duration-150 focus:outline-none";
    const selectedClasses = "bg-gray-200 dark:bg-gray-700/50";
    const hoverClasses = "hover:bg-gray-100 dark:hover:bg-gray-800";

    // Display validation status, default to "Not Reviewed" if null
    const displayStatus = kobo_validation_status || 'Not Reviewed';
    const llmStatusLabel = llm_check_status
      ? llm_check_status.charAt(0).toUpperCase() + llm_check_status.slice(1)
      : 'Skipped';
    const llmStatusClass =
      llm_check_status === 'running' || llm_check_status === 'pending'
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
        : llm_check_status === 'success'
        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
        : llm_check_status === 'failed'
        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';

    return (
        <button
            onClick={() => onSelect(_id)}
            className={`${baseClasses} ${isSelected ? selectedClasses : hoverClasses}`}
        >
            <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-sm font-semibold text-gray-900 dark:text-white">ID: {_id}</p>
                <Badge status={displayStatus} />
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
                Submitted: {new Date(_submission_time).toLocaleString()}
            </div>
            <div className="mt-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${llmStatusClass}`}>
                    AI check: {llmStatusLabel}
                </span>
            </div>
            {data_quality_issues.length > 0 && (
                <div className="flex items-center mt-3 text-xs text-yellow-600 dark:text-yellow-400">
                    <AlertIcon />
                    <span>{data_quality_issues.length} Issues</span>
                </div>
            )}
        </button>
    );
}

export default SubmissionListItem;