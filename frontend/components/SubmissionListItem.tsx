
import React from 'react';
import { Submission } from '../types';
import { Badge, AlertIcon } from './Badge';

interface SubmissionListItemProps {
    submission: Submission;
    onSelect: (id: number) => void;
    isSelected: boolean;
}

const SubmissionListItem: React.FC<SubmissionListItemProps> = ({ submission, onSelect, isSelected }) => {
    const { _id, _submission_time, qa_status, data_quality_issues } = submission;

    const baseClasses = "block w-full text-left p-4 border-b border-gray-200 dark:border-gray-800 transition-colors duration-150 focus:outline-none";
    const selectedClasses = "bg-gray-200 dark:bg-gray-700/50";
    const hoverClasses = "hover:bg-gray-100 dark:hover:bg-gray-800";

    return (
        <button
            onClick={() => onSelect(_id)}
            className={`${baseClasses} ${isSelected ? selectedClasses : hoverClasses}`}
        >
            <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-sm font-semibold text-gray-900 dark:text-white">ID: {_id}</p>
                <Badge status={qa_status} />
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
                Submitted: {new Date(_submission_time).toLocaleString()}
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