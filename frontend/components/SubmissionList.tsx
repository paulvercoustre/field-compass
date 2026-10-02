
import React from 'react';
import { Submission } from '../types';
import SubmissionListItem from './SubmissionListItem';

interface SubmissionListProps {
  submissions: Submission[];
  onSelect: (id: number) => void;
  selectedSubmissionId: number | null;
}

const SubmissionList: React.FC<SubmissionListProps> = ({ submissions, onSelect, selectedSubmissionId }) => {

  return (
    <div className="flex flex-col h-full min-h-0">
        <div className="flex-shrink-0 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
            <p className="tabular text-xs text-gray-500 dark:text-gray-400">
              {submissions.length === 0
                ? "No submissions match your filters."
                : `${submissions.length.toLocaleString()} submission${submissions.length !== 1 ? 's' : ''}`
              }
            </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
            {submissions.length > 0 ? (
                <ul>
                    {submissions.map(submission => (
                        <li key={submission._id}>
                            <SubmissionListItem
                                submission={submission}
                                onSelect={onSelect}
                                isSelected={submission._id === selectedSubmissionId}
                            />
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="flex items-center justify-center h-full p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    <p>No submissions found.</p>
                </div>
            )}
        </div>
    </div>
  );
};

export default SubmissionList;