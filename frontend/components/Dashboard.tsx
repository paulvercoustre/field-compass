
import React, { useState, useEffect, useCallback } from 'react';
import { Submission, SubmissionHistory } from '../types';
import { api } from '../services/api';
import { useSurvey } from '../contexts/SurveyContext';
import { triggerETL, ETLStats } from '../services/progressApi';
import SubmissionList from './SubmissionList';
import SubmissionDetail from './SubmissionDetail';
import { Spinner } from './Spinner';

const Dashboard: React.FC = () => {
  const { selectedSurvey } = useSurvey();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [history, setHistory] = useState<SubmissionHistory[]>([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState<boolean>(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [isRunningETL, setIsRunningETL] = useState<boolean>(false);
  const [etlStats, setEtlStats] = useState<ETLStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchSubmissions = useCallback(async () => {
    if (!selectedSurvey) return;
    
    try {
      setIsLoadingSubmissions(true);
      setError(null);
      const data = await api.getSubmissions(
        undefined, // qaStatus
        selectedSurvey.survey_id // surveyId
      );
      setSubmissions(data);
    } catch (err) {
      setError('Failed to fetch submissions.');
      console.error(err);
    } finally {
      setIsLoadingSubmissions(false);
    }
  }, [selectedSurvey]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const handleRefresh = async () => {
    if (!selectedSurvey) {
      setError('Please select a survey first');
      return;
    }

    setIsRunningETL(true);
    setError(null);
    setSuccess(null);
    setEtlStats(null);

    try {
      // Trigger ETL pipeline
      const stats = await triggerETL(selectedSurvey.survey_id);
      setEtlStats(stats);
      
      // Refresh submissions after ETL completes
      await fetchSubmissions();
      
      setSuccess(
        `ETL completed: ${stats.fetched} fetched, ${stats.created} created, ${stats.updated} updated, ${stats.hfc_flagged} flagged`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run ETL pipeline');
      console.error(err);
    } finally {
      setIsRunningETL(false);
    }
  };

  const handleSelectSubmission = useCallback(async (submissionId: number) => {
    const submission = submissions.find(s => s._id === submissionId);
    if (submission) {
      if (selectedSubmission?._id === submissionId) return; // Avoid refetching for the same submission
      setSelectedSubmission(submission);
      try {
        setIsLoadingHistory(true);
        setHistory([]);
        const historyData = await api.getSubmissionHistory(submissionId);
        setHistory(historyData);
      } catch (err) {
        setError('Failed to fetch submission history.');
        console.error(err);
      } finally {
        setIsLoadingHistory(false);
      }
    }
  }, [submissions, selectedSubmission]);

  return (
    <div className="flex flex-col h-full">
      {/* Header with Refresh Button */}
      <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">QA Dashboard</h2>
          <div className="flex items-center gap-3">
            {etlStats && (
              <div className="text-sm text-gray-400">
                <span className="text-green-400">✓</span> Last run: {etlStats.duration_seconds.toFixed(1)}s
              </div>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRunningETL || !selectedSurvey}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
            >
              {isRunningETL ? (
                <>
                  <Spinner />
                  <span>Running ETL...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Refresh from Kobo</span>
                </>
              )}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-2 p-2 bg-red-900/50 border border-red-700 rounded-md text-red-200 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-2 p-2 bg-green-900/50 border border-green-700 rounded-md text-green-200 text-sm">
            {success}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-shrink-0 w-full border-r border-gray-700 md:w-1/3 lg:w-1/4 xl:w-1/5 bg-gray-850">
          {isLoadingSubmissions ? (
            <div className="flex items-center justify-center h-full">
              <Spinner />
            </div>
          ) : error && !isRunningETL ? (
            <div className="p-4 text-center text-red-400">{error}</div>
          ) : (
            <SubmissionList
              submissions={submissions}
              onSelect={handleSelectSubmission}
              selectedSubmissionId={selectedSubmission?._id ?? null}
            />
          )}
        </div>
        <div className="flex-1 hidden md:block">
          <SubmissionDetail
            submission={selectedSubmission}
            history={history}
            isLoading={isLoadingHistory}
          />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;