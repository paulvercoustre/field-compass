
import React from 'react';
import { Submission } from '../types';
import { Badge, AlertIcon } from './Badge';

interface SubmissionListItemProps {
    submission: Submission;
    onSelect: (id: number) => void;
    isSelected: boolean;
}

const SubmissionListItem: React.FC<SubmissionListItemProps> = ({ submission, onSelect, isSelected }) => {
    const { _id, _submission_time, kobo_validation_status, data_quality_issues } = submission;

    // No focus:outline-none: the global :focus-visible ring (index.css) is the
    // only sign of keyboard focus on this list.
    const baseClasses = "block w-full text-left p-4 border-b border-gray-200 dark:border-gray-800 transition-colors duration-150";
    const selectedClasses = "bg-gray-200 dark:bg-gray-700/50";
    const hoverClasses = "hover:bg-gray-100 dark:hover:bg-gray-800";

    // Display validation status, default to "Not Reviewed" if null
    const displayStatus = kobo_validation_status || 'Not Reviewed';

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
            {data_quality_issues.length > 0 && (
                <div className={`flex items-center mt-3 text-xs ${isSelected ? 'text-amber-800' : 'text-amber-700'} dark:text-yellow-400`}>
                    <AlertIcon />
                    <span>{data_quality_issues.length} Issues</span>
                </div>
            )}
        </button>
    );
}

export default SubmissionListItem;