
import React from 'react';
import { Submission, QAStatus } from '../types';
import SubmissionListItem from './SubmissionListItem';

interface SubmissionListProps {
  submissions: Submission[];
  onSelect: (id: number) => void;
  selectedSubmissionId: number | null;
}

const SubmissionList: React.FC<SubmissionListProps> = ({ submissions, onSelect, selectedSubmissionId }) => {
  const triageSubmissions = submissions.filter(s =>
    s.qa_status === QAStatus.HFC_FLAGGED || s.qa_status === QAStatus.PENDING_RE_QA
  );

  return (
    <div className="flex flex-col h-full">
        <div className="p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">Triage Queue</h2>
            <p className="text-sm text-gray-400">{triageSubmissions.length} submissions require attention.</p>
        </div>
        <div className="flex-1 overflow-y-auto">
            {triageSubmissions.length > 0 ? (
                <ul>
                    {triageSubmissions.map(submission => (
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
                <div className="flex items-center justify-center h-full p-4 text-center text-gray-500">
                    <p>The triage queue is empty.</p>
                </div>
            )}
        </div>
    </div>
  );
};

export default SubmissionList;