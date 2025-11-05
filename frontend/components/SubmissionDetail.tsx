
import React, { useState } from 'react';
import { Submission, SubmissionHistory, QualityIssue } from '../types';
import JsonViewer from './JsonViewer';
import HistoryViewer from './HistoryViewer';
import { Spinner } from './Spinner';
import { Badge, EditIcon, AlertIcon } from './Badge';

interface SubmissionDetailProps {
  submission: Submission | null;
  history: SubmissionHistory[];
  isLoading: boolean;
}

type Tab = 'data' | 'history';

const SubmissionDetail: React.FC<SubmissionDetailProps> = ({ submission, history, isLoading }) => {
  const [activeTab, setActiveTab] = useState<Tab>('data');

  if (!submission) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>Select a submission from the queue to view details.</p>
      </div>
    );
  }

  const { _id, submission_data, is_edited, data_quality_issues, qa_status } = submission;

  const QualityIssueCard: React.FC<{ issue: QualityIssue }> = ({ issue }) => (
    <div className="p-3 text-sm bg-yellow-900/50 border border-yellow-700/50 rounded-md">
        <p className="font-semibold text-yellow-300">{issue.check}: <span className="font-mono">{issue.field}</span></p>
        <p className="text-yellow-400">{issue.message}</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Submission <span className="font-mono">#{_id}</span></h2>
          <Badge status={qa_status} size="lg" />
        </div>
        
        <div className="flex items-center mt-3 space-x-4">
            {is_edited && (
                <div className="flex items-center text-sm text-blue-400">
                    <EditIcon />
                    <span>Edited Submission</span>
                </div>
            )}
            {data_quality_issues.length > 0 && (
                <div className="flex items-center text-sm text-yellow-400">
                    <AlertIcon />
                    <span>{data_quality_issues.length} Quality Issues Found</span>
                </div>
            )}
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        {data_quality_issues.length > 0 && (
            <div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold text-gray-200">Quality Flags</h3>
                <div className="space-y-2">
                    {data_quality_issues.map((issue, index) => <QualityIssueCard key={index} issue={issue} />)}
                </div>
            </div>
        )}
        
        <div>
            <div className="border-b border-gray-700">
                <nav className="flex -mb-px space-x-6" aria-label="Tabs">
                    <button onClick={() => setActiveTab('data')} className={`px-1 py-3 text-sm font-medium border-b-2 ${activeTab === 'data' ? 'border-indigo-400 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>
                        Current Data
                    </button>
                    <button onClick={() => setActiveTab('history')} className={`px-1 py-3 text-sm font-medium border-b-2 ${activeTab === 'history' ? 'border-indigo-400 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>
                        Change History
                    </button>
                </nav>
            </div>
            <div className="py-4">
                {isLoading ? (
                    <div className="flex justify-center mt-8">
                        <Spinner />
                    </div>
                ) : (
                    <>
                        {activeTab === 'data' && <JsonViewer data={submission_data} />}
                        {activeTab === 'history' && <HistoryViewer history={history} />}
                    </>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default SubmissionDetail;