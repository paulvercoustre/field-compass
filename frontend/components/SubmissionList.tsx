
import React, { useState, useMemo } from 'react';
import { Submission, QAStatus } from '../types';
import SubmissionListItem from './SubmissionListItem';

interface SubmissionListProps {
  submissions: Submission[];
  onSelect: (id: number) => void;
  selectedSubmissionId: number | null;
}

type FilterType = 'all' | 'triage' | QAStatus;

const SubmissionList: React.FC<SubmissionListProps> = ({ submissions, onSelect, selectedSubmissionId }) => {
  const [activeFilter, setActiveFilter] = useState<FilterType>('triage');

  const filteredSubmissions = useMemo(() => {
    if (activeFilter === 'all') {
      return submissions;
    } else if (activeFilter === 'triage') {
      return submissions.filter(s =>
        s.qa_status === QAStatus.HFC_FLAGGED || s.qa_status === QAStatus.PENDING_RE_QA
      );
    } else {
      return submissions.filter(s => s.qa_status === activeFilter);
    }
  }, [submissions, activeFilter]);

  const triageCount = submissions.filter(s =>
    s.qa_status === QAStatus.HFC_FLAGGED || s.qa_status === QAStatus.PENDING_RE_QA
  ).length;

  const getStatusCount = (status: QAStatus) => {
    return submissions.filter(s => s.qa_status === status).length;
  };

  return (
    <div className="flex flex-col h-full">
        <div className="p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white mb-2">Submissions</h2>
            
            {/* Filter Tabs */}
            <div className="flex flex-wrap gap-1 mb-2">
              <button
                onClick={() => setActiveFilter('triage')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  activeFilter === 'triage'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Triage ({triageCount})
              </button>
              <button
                onClick={() => setActiveFilter('all')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  activeFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                All ({submissions.length})
              </button>
              <button
                onClick={() => setActiveFilter(QAStatus.PENDING_QA)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  activeFilter === QAStatus.PENDING_QA
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Pending ({getStatusCount(QAStatus.PENDING_QA)})
              </button>
              <button
                onClick={() => setActiveFilter(QAStatus.APPROVED)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  activeFilter === QAStatus.APPROVED
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Approved ({getStatusCount(QAStatus.APPROVED)})
              </button>
            </div>

            <p className="text-xs text-gray-400">
              {activeFilter === 'triage' && `${triageCount} submissions require attention.`}
              {activeFilter === 'all' && `Showing all ${submissions.length} submissions.`}
              {activeFilter === QAStatus.PENDING_QA && `Showing ${getStatusCount(QAStatus.PENDING_QA)} pending submissions.`}
              {activeFilter === QAStatus.APPROVED && `Showing ${getStatusCount(QAStatus.APPROVED)} approved submissions.`}
              {activeFilter === QAStatus.HFC_FLAGGED && `Showing ${getStatusCount(QAStatus.HFC_FLAGGED)} flagged submissions.`}
              {activeFilter === QAStatus.PENDING_RE_QA && `Showing ${getStatusCount(QAStatus.PENDING_RE_QA)} submissions pending re-review.`}
            </p>
        </div>
        <div className="flex-1 overflow-y-auto">
            {filteredSubmissions.length > 0 ? (
                <ul>
                    {filteredSubmissions.map(submission => (
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
                    <p>No submissions found for this filter.</p>
                </div>
            )}
        </div>
    </div>
  );
};

export default SubmissionList;