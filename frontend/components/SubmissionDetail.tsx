
import React, { useState } from 'react';
import { Submission, SubmissionHistory, QualityIssue } from '../types';
import JsonViewer from './JsonViewer';
import HistoryViewer from './HistoryViewer';
import { Spinner } from './Spinner';
import { Badge, EditIcon, AlertIcon } from './Badge';
import { useSurvey } from '../contexts/SurveyContext';

interface SubmissionDetailProps {
  submission: Submission | null;
  history: SubmissionHistory[];
  isLoading: boolean;
}

type Tab = 'data' | 'history';

const SubmissionDetail: React.FC<SubmissionDetailProps> = ({ submission, history, isLoading }) => {
  const [activeTab, setActiveTab] = useState<Tab>('data');
  const { selectedSurvey } = useSurvey();

  if (!submission) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>Select a submission from the queue to view details.</p>
      </div>
    );
  }

  const { _id, submission_data, is_edited, data_quality_issues, qa_status, kobo_validation_status } = submission;
  
  // Construct Kobo edit URL dynamically from selected survey's kobo_asset_id
  const koboEditUrl = selectedSurvey?.kobo_asset_id 
    ? `https://kf.kobotoolbox.org/#/forms/${selectedSurvey.kobo_asset_id}/data/table`
    : null;

  const QualityIssueCard: React.FC<{ issue: QualityIssue }> = ({ issue }) => (
    <div className="p-3 text-sm bg-yellow-900/50 border border-yellow-700/50 rounded-md">
        <p className="font-semibold text-yellow-300">{issue.check}: <span className="font-mono">{issue.field}</span></p>
        <p className="text-yellow-400">{issue.message}</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gray-900 min-w-0">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white">Submission <span className="font-mono">#{_id}</span></h2>
            
            <div className="flex items-center mt-3 space-x-4 flex-wrap gap-2">
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
                {kobo_validation_status && (
                    <div className="flex items-center text-sm text-gray-400">
                        <span>Kobo Status: <span className="font-semibold">{kobo_validation_status}</span></span>
                    </div>
                )}
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-2 ml-4">
            <Badge status={qa_status} size="lg" />
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto min-w-0">
        {data_quality_issues.length > 0 && (
            <div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold text-gray-200">Quality Flags</h3>
                <div className="space-y-2">
                    {data_quality_issues.map((issue, index) => <QualityIssueCard key={index} issue={issue} />)}
                </div>
            </div>
        )}
        
        <div className="min-w-0">
            <div className="border-b border-gray-700">
                <div className="flex items-center justify-between">
                    <nav className="flex -mb-px space-x-6" aria-label="Tabs">
                        <button onClick={() => setActiveTab('data')} className={`px-1 py-3 text-sm font-medium border-b-2 ${activeTab === 'data' ? 'border-indigo-400 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>
                            Current Data
                        </button>
                        <button onClick={() => setActiveTab('history')} className={`px-1 py-3 text-sm font-medium border-b-2 ${activeTab === 'history' ? 'border-indigo-400 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>
                            Change History
                        </button>
                    </nav>
                    {koboEditUrl && (
                        <a
                            href={koboEditUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            View in Kobo
                        </a>
                    )}
                </div>
            </div>
            <div className="py-4 min-w-0">
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