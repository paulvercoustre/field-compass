
import React, { useState, useEffect } from 'react';
import { Submission, SubmissionHistory, QualityIssue } from '../types';
import JsonViewer from './JsonViewer';
import HistoryViewer from './HistoryViewer';
import { Spinner } from './Spinner';
import { Badge, EditIcon, AlertIcon } from './Badge';
import { useSurvey } from '../contexts/SurveyContext';
import { getSurveyConfig, SurveyConfig } from '../services/progressApi';

interface SubmissionDetailProps {
  submission: Submission | null;
  history: SubmissionHistory[];
  isLoading: boolean;
}

type Tab = 'data' | 'history';

const SubmissionDetail: React.FC<SubmissionDetailProps> = ({ submission, history, isLoading }) => {
  const [activeTab, setActiveTab] = useState<Tab>('data');
  const [surveyConfig, setSurveyConfig] = useState<SurveyConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const { selectedSurvey } = useSurvey();

  // Fetch survey config when submission or survey changes
  useEffect(() => {
    const fetchConfig = async () => {
      if (!selectedSurvey) return;
      
      setIsLoadingConfig(true);
      try {
        const config = await getSurveyConfig(selectedSurvey.survey_id);
        setSurveyConfig(config);
      } catch (error) {
        console.error('Failed to load survey config:', error);
      } finally {
        setIsLoadingConfig(false);
      }
    };

    fetchConfig();
  }, [selectedSurvey]);

  if (!submission) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>Select a submission from the queue to view details.</p>
      </div>
    );
  }

  const { _id, submission_data, is_edited, data_quality_issues, qa_status, kobo_validation_status, _submission_time, end } = submission;
  
  // Construct Kobo edit URL dynamically from selected survey's kobo_asset_id
  const koboEditUrl = selectedSurvey?.kobo_asset_id && submission?._id
    ? `https://kf.kobotoolbox.org/#/forms/${selectedSurvey.kobo_asset_id}/data/table`
    : null;

  const QualityIssueCard: React.FC<{ issue: QualityIssue }> = ({ issue }) => (
    <div className="p-3 text-sm bg-yellow-900/50 border border-yellow-700/50 rounded-md">
        <p className="font-semibold text-yellow-300">{issue.check}: <span className="font-mono">{issue.field}</span></p>
        <p className="text-yellow-400">{issue.message}</p>
    </div>
  );

  // Helper function to get value from submission data, handling Kobo path-based field names.
  // This matches the backend implementation in backend/etl/hfc_engine.py and backend/routers/progress.py
  // Kobo stores fields with full paths like 'module/variable' or 'module1/module2/variable',
  // but config may only specify 'variable'. This function searches for the field by:
  // 1. Direct lookup (exact match)
  // 2. Path-based search (field name at end of path, e.g., 'module/variable' matches 'variable')
  const getFieldValue = (fieldName: string): any => {
    if (!submission_data || !fieldName) return undefined;
    
    // First try direct lookup
    if (fieldName in submission_data) {
      return submission_data[fieldName];
    }
    
    // Search for fields that end with the field name (path-based)
    // e.g., 'enumerator_id' should match 'sampling_information/enumerator_id'
    // e.g., 'sampling_admin2' should match 'sampling_information/sampling_admin2'
    for (const key in submission_data) {
      if (key.endsWith(`/${fieldName}`) || key === fieldName) {
        return submission_data[key];
      }
    }
    
    // Not found
    return undefined;
  };

  // Extract metadata from submission data using survey config
  const getMetadata = () => {
    if (!surveyConfig || !submission_data) return null;

    const config = surveyConfig.config_data;
    const metadata: {
      enumerator?: string | null;
      enumeratorField?: string;
      sampling?: Record<string, any>;
      dateInterview?: string;
      duration?: number;
    } = {};

    // Get enumerator - always try to get it if field is configured
    if (config.core_identifiers?.enumerator) {
      metadata.enumeratorField = config.core_identifiers.enumerator;
      const enumeratorValue = getFieldValue(config.core_identifiers.enumerator);
      // Include even if empty/null so we can show the field
      metadata.enumerator = enumeratorValue !== undefined ? String(enumeratorValue || 'N/A') : null;
    }

    // Get sampling information - always show configured columns
    if (config.sampling_frame?.sampling_cols && config.sampling_frame.sampling_cols.length > 0) {
      metadata.sampling = {};
      config.sampling_frame.sampling_cols.forEach((col: string) => {
        const value = getFieldValue(col);
        // Show all configured columns, even if empty
        metadata.sampling[col] = value !== undefined && value !== null && value !== '' ? value : 'N/A';
      });
    }

    // Get interview date
    if (config.core_identifiers?.date_interview) {
      metadata.dateInterview = getFieldValue(config.core_identifiers.date_interview);
    }

    // Calculate duration if start and end times are available
    if (config.core_identifiers?.start_time && config.core_identifiers?.end_time) {
      const startTime = getFieldValue(config.core_identifiers.start_time);
      const endTime = getFieldValue(config.core_identifiers.end_time);
      
      if (startTime && endTime) {
        try {
          const start = new Date(startTime);
          const end = new Date(endTime);
          if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            const diffMs = end.getTime() - start.getTime();
            metadata.duration = Math.round(diffMs / 1000 / 60); // Duration in minutes
          }
        } catch (e) {
          // Ignore date parsing errors
        }
      }
    }

    return metadata;
  };

  const metadata = getMetadata();

  // Helper function to format field names (convert snake_case or path format to readable)
  const formatFieldName = (fieldName: string): string => {
    return fieldName
      .replace(/\//g, ' / ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

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
      </div>

      <div className="flex-1 p-4 overflow-y-auto min-w-0">
        {/* Metadata Panel */}
        {metadata && (
          <div className="mb-6">
            <h3 className="mb-3 text-lg font-semibold text-gray-200">Submission Overview</h3>
            <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Enumerator - Always show if field is configured */}
              {metadata.enumeratorField && (
                <div className="md:col-span-1">
                  <span className="text-xs text-gray-400 block mb-1">Enumerator</span>
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className={`text-sm font-semibold ${metadata.enumerator && metadata.enumerator !== 'N/A' ? 'text-white' : 'text-gray-500'}`}>
                      {metadata.enumerator || 'Not available'}
                    </span>
                  </div>
                </div>
              )}

              {/* Interview Date - Show this instead of submission date */}
              {metadata.dateInterview ? (
                <div>
                  <span className="text-xs text-gray-400 block mb-1">Interview Date</span>
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm font-medium text-white">{String(metadata.dateInterview)}</span>
                  </div>
                </div>
              ) : _submission_time ? (
                <div>
                  <span className="text-xs text-gray-400 block mb-1">Submitted</span>
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm font-medium text-white">
                      {new Date(_submission_time).toLocaleString()}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Duration */}
              {metadata.duration !== undefined && (
                <div>
                  <span className="text-xs text-gray-400 block mb-1">Duration</span>
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-medium text-white">{metadata.duration} min</span>
                  </div>
                </div>
              )}

              {/* Sampling Information - Always show if configured */}
              {metadata.sampling && Object.keys(metadata.sampling).length > 0 && (
                <div className="md:col-span-2 lg:col-span-3">
                  <span className="text-xs text-gray-400 block mb-2">Sampling Information</span>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(metadata.sampling).map(([key, value]) => (
                      <div key={key} className="flex items-center">
                        <span className="text-xs text-gray-400 mr-2">{formatFieldName(key)}:</span>
                        <span className={`text-sm font-medium ${
                          value !== 'N/A' && value !== null && value !== '' 
                            ? 'text-white' 
                            : 'text-gray-500'
                        }`}>
                          {String(value !== null && value !== '' ? value : 'Not available')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        )}

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
                <nav className="flex -mb-px space-x-6" aria-label="Tabs">
                    <button onClick={() => setActiveTab('data')} className={`px-1 py-3 text-sm font-medium border-b-2 ${activeTab === 'data' ? 'border-indigo-400 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>
                        Current Data
                    </button>
                    <button onClick={() => setActiveTab('history')} className={`px-1 py-3 text-sm font-medium border-b-2 ${activeTab === 'history' ? 'border-indigo-400 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}>
                        Change History
                    </button>
                </nav>
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